const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const pool = connectionString ? new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
}) : null;
const equipmentUpserts = new Map();
let supportsSourceDeviceId = true;

if (pool) {
  pool.on('error', err => console.error('[Database] Unexpected pool error:', err.message));
  console.log('[Database] PostgreSQL persistence enabled');
} else {
  console.log('[Database] DATABASE_URL not set; using in-memory prototype stores');
}

function isDatabaseEnabled() { return Boolean(pool); }

async function checkDatabase() {
  if (!pool) return { configured: false, connected: false };
  try {
    await pool.query('select 1');
    return { configured: true, connected: true };
  } catch (err) {
    return { configured: true, connected: false, error: err.code || 'DATABASE_ERROR' };
  }
}

async function query(text, values) {
  if (!pool) throw new Error('Database is not configured');
  return pool.query(text, values);
}

async function upsertEquipment(equipmentId, name, sourceDeviceId = null) {
  if (!pool) return;
  if (equipmentUpserts.has(equipmentId)) return equipmentUpserts.get(equipmentId);
  const registration = (async () => {
    if (supportsSourceDeviceId) {
      try {
        await query(`insert into public.equipment (equipment_id, name, source_device_id)
          values ($1, $2, $3) on conflict (equipment_id) do update
            set name = excluded.name,
                source_device_id = coalesce(excluded.source_device_id, public.equipment.source_device_id)`,
        [equipmentId, name, sourceDeviceId === null ? null : String(sourceDeviceId)]);
        return;
      } catch (err) {
        // Keep existing databases usable until migration 002 is applied.
        if (err.code !== '42703') throw err;
        supportsSourceDeviceId = false;
        console.warn('[Database] equipment.source_device_id is missing; storing source identity in metadata until migration 002 is applied.');
      }
    }
    await query(`insert into public.equipment (equipment_id, name, metadata)
      values ($1, $2, $3::jsonb) on conflict (equipment_id) do update
        set name = excluded.name,
            metadata = public.equipment.metadata || excluded.metadata`,
    [equipmentId, name, JSON.stringify(sourceDeviceId === null ? {} : { source_engine_id: sourceDeviceId })]);
  })();
  equipmentUpserts.set(equipmentId, registration);
  try { await registration; }
  catch (err) { equipmentUpserts.delete(equipmentId); throw err; }
}

async function saveReading(equipmentId, name, reading, sourceDeviceId = null) {
  if (!pool) return;
  await upsertEquipment(equipmentId, name, sourceDeviceId);
  await query(`insert into public.sensor_readings (
    equipment_id, recorded_at, temperature_c, rpm, fuel_efficiency,
    vibration_x, vibration_y, vibration_z, torque_nm, power_output_kw,
    fault_condition, operational_mode, raw_reading
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`, [
    equipmentId, reading.recorded_at || reading.timestamp || new Date().toISOString(),
    numberOrNull(reading.Temperature_C), numberOrNull(reading.RPM),
    numberOrNull(reading.Fuel_Efficiency), numberOrNull(reading.Vibration_X),
    numberOrNull(reading.Vibration_Y), numberOrNull(reading.Vibration_Z),
    numberOrNull(reading.Torque_Nm), numberOrNull(reading.Power_Output_kW),
    numberOrNull(reading.Fault_Condition), reading.Operational_Mode || null,
    JSON.stringify(reading),
  ]);
}

async function getSensorReadings(equipmentId, limit = 60) {
  if (!pool) return null;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 500));
  const { rows } = await query(`select raw_reading, recorded_at
    from public.sensor_readings where equipment_id = $1
    order by recorded_at desc limit $2`, [equipmentId, safeLimit]);
  return rows.reverse().map(row => ({
    ...(row.raw_reading || {}),
    timestamp: row.recorded_at.toISOString(),
  }));
}

async function savePrediction(equipmentId, name, result, sourceDeviceId = null) {
  if (!pool) return;
  await upsertEquipment(equipmentId, name, sourceDeviceId);
  await query(`insert into public.predictions (
    equipment_id, severity, anomaly_score, message, feature_snapshot,
    top_anomalous_features, model_metadata
  ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`, [
    equipmentId, result.severity, numberOrNull(result.anomaly_score), result.message || null,
    JSON.stringify(result.feature_snapshot || {}),
    JSON.stringify(result.top_anomalous_features || []),
    JSON.stringify(result.model_metadata || {}),
  ]);
}

async function createAlertRecord(alert) {
  if (!pool) return null;
  await upsertEquipment(alert.equipment_id, alert.name || alert.equipment_id,
    alert.feature_snapshot?.source_engine_id ?? null);
  const { rows } = await query(`insert into public.alerts (
    equipment_id, severity, anomaly_score, message, feature_snapshot,
    top_anomalous_features, created_at
  ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
  returning id, equipment_id, severity, anomaly_score, message,
    feature_snapshot, top_anomalous_features, created_at as timestamp,
    acknowledged, acknowledged_at`, [
    alert.equipment_id, alert.severity, numberOrNull(alert.anomaly_score), alert.message || null,
    JSON.stringify(alert.feature_snapshot || {}),
    JSON.stringify(alert.top_anomalous_features || []), alert.timestamp,
  ]);
  return normalizeAlert(rows[0]);
}

async function getAlerts({ activeOnly = false, limit = 50, equipmentId } = {}) {
  if (!pool) return null;
  const conditions = [];
  const values = [];
  if (activeOnly) conditions.push('acknowledged = false');
  if (equipmentId) { values.push(equipmentId); conditions.push(`equipment_id = $${values.length}`); }
  values.push(limit);
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const { rows } = await query(`select id, equipment_id, severity, anomaly_score,
    message, feature_snapshot, top_anomalous_features, created_at as timestamp,
    acknowledged, acknowledged_at from public.alerts ${where}
    order by created_at desc limit $${values.length}`, values);
  return rows.map(normalizeAlert);
}

async function acknowledgeAlertRecord(id) {
  if (!pool) return null;
  const { rows } = await query(`update public.alerts set acknowledged = true,
    acknowledged_at = coalesce(acknowledged_at, now()) where id = $1
    returning id, equipment_id, severity, anomaly_score, message,
      feature_snapshot, top_anomalous_features, created_at as timestamp,
      acknowledged, acknowledged_at`, [id]);
  return rows[0] ? normalizeAlert(rows[0]) : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAlert(row) {
  return { ...row, timestamp: new Date(row.timestamp).toISOString(),
    acknowledged_at: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null };
}

module.exports = {
  isDatabaseEnabled, checkDatabase, query, saveReading, getSensorReadings,
  savePrediction, createAlertRecord,
  getAlerts, acknowledgeAlertRecord,
};
