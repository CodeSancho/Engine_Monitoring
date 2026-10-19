






const database = require('./databaseService');

let alerts     = [];
let alertIdSeq = 1;
// An engine can only have one active alert.  The likely part is a detail of
// that alert, not a second dimension for creating another alert.
const activeAlertsByEngine = new Map();

function partKeyForAlert({ top_anomalous_features = [], feature_snapshot = {} }) {
  const candidates = [
    ...top_anomalous_features.map(item => String(item).split(':')[0].trim()),
    ...Object.keys(feature_snapshot),
  ];
  const groups = [
    ['bearing_rotating_assembly', /vibration/i],
    ['fuel_system', /fuel|injector|exhaust/i],
    ['lubrication_system', /oil_pressure/i],
    ['air_induction', /boost_pressure/i],
    ['cooling_system', /temperature|ambient/i],
    ['turbo_air_induction', /boost|power_output/i],
    ['drivetrain', /torque|resistance|payload|speed/i],
    ['engine_speed_control', /rpm/i],
  ];
  for (const candidate of candidates) {
    const match = groups.find(([, pattern]) => pattern.test(candidate));
    if (match) return match[0];
  }
  return 'general_anomaly';
}

function activeKey(alert) {
  return String(alert.equipment_id);
}

function forgetActiveAlert(alert) {
  const key = activeKey(alert);
  if (activeAlertsByEngine.get(key)?.id === alert.id) activeAlertsByEngine.delete(key);
}

function initAlertStore() {
  alerts     = [];
  alertIdSeq = 1;
  activeAlertsByEngine.clear();
  if (database.isDatabaseEnabled()) {
    database.getAlerts({ activeOnly: true, limit: 500 }).then(rows => {
      for (const alert of rows || []) {
        // If old data contains multiple active alerts for an engine, keep the
        // newest one in the in-memory index so new readings consolidate there.
        if (!activeAlertsByEngine.has(activeKey(alert))) activeAlertsByEngine.set(activeKey(alert), alert);
      }
    }).catch(err => console.error('[Database] Could not load active alert keys:', err.message));
  }
  console.log('[AlertService] Initialised');
}

function createAlert({ equipment_id, severity, anomaly_score, message, feature_snapshot, top_anomalous_features }) {
  const details = { equipment_id, feature_snapshot: feature_snapshot || {}, top_anomalous_features: top_anomalous_features || [] };
  const part_key = partKeyForAlert(details);
  const key = String(equipment_id);
  const existing = activeAlertsByEngine.get(key);
  if (existing) {
    // An alert is an immutable snapshot of the first detected event. Later
    // readings may count as occurrences, but must not rewrite its diagnosis,
    // score, message, or sensor values.
    existing.occurrences = (existing.occurrences || 1) + 1;
    return { ...existing, is_duplicate: true };
  }
  const alert = {
    id:             alertIdSeq++,
    equipment_id,
    severity,
    anomaly_score,
    message,
    feature_snapshot: feature_snapshot || {},
    top_anomalous_features: top_anomalous_features || [],
    part_key,
    occurrences: 1,
    timestamp:      new Date().toISOString(),
    acknowledged:   false,
    acknowledged_at: null,
  };
  alerts.push(alert);
  activeAlertsByEngine.set(key, alert);
  if (database.isDatabaseEnabled()) {
    database.createAlertRecord(alert).then(persisted => {
      if (persisted) alert.id = persisted.id;
    }).catch(err => console.error('[Database] Could not persist alert:', err.message));
  }
  console.log(`[Alert] ${severity} | ${equipment_id} | score=${anomaly_score.toFixed(3)}`);
  return alert;
}

async function listActiveAlerts() {
  if (database.isDatabaseEnabled()) {
    try {
      const rows = await database.getAlerts({ activeOnly: true, limit: 500 });
      return uniqueActiveAlertsByEngine(rows);
    }
    catch (err) { console.error('[Database] Could not load active alerts:', err.message); }
  }
  return getActiveAlerts();
}

function uniqueActiveAlertsByEngine(rows) {
  const byEngine = new Map();
  for (const alert of rows || []) {
    // Database results are newest first; retain only one alert per engine.
    if (!byEngine.has(String(alert.equipment_id))) byEngine.set(String(alert.equipment_id), alert);
  }
  return [...byEngine.values()];
}

async function listAllAlerts({ limit = 50 } = {}) {
  if (database.isDatabaseEnabled()) {
    try { return await database.getAlerts({ limit }); }
    catch (err) { console.error('[Database] Could not load alerts:', err.message); }
  }
  return getAllAlerts({ limit });
}

async function listAlertsByEquipment(equipment_id) {
  if (database.isDatabaseEnabled()) {
    try { return await database.getAlerts({ equipmentId: equipment_id, limit: 500 }); }
    catch (err) { console.error('[Database] Could not load equipment alerts:', err.message); }
  }
  return getAlertsByEquipment(equipment_id);
}

async function acknowledgeAlertById(id) {
  if (database.isDatabaseEnabled()) {
    try {
      const alert = await database.acknowledgeAlertRecord(id);
      if (alert) forgetActiveAlert(alert);
      return alert;
    }
    catch (err) { console.error('[Database] Could not acknowledge alert:', err.message); }
  }
  const alert = acknowledgeAlert(id);
  if (alert) forgetActiveAlert(alert);
  return alert;
}

async function acknowledgeAllAlerts() {
  if (database.isDatabaseEnabled()) {
    try {
      const cleared = await database.acknowledgeAllAlertRecords();
      activeAlertsByEngine.clear();
      return cleared;
    }
    catch (err) { console.error('[Database] Could not clear active alerts:', err.message); }
  }
  const cleared = [];
  for (const alert of alerts) {
    if (!alert.acknowledged) {
      alert.acknowledged = true;
      alert.acknowledged_at = new Date().toISOString();
      cleared.push(alert);
    }
  }
  activeAlertsByEngine.clear();
  return cleared;
}

function getActiveAlerts() {
  return uniqueActiveAlertsByEngine(
    alerts.filter(a => !a.acknowledged)
      .sort((a, b) => (b.anomaly_score ?? 0) - (a.anomaly_score ?? 0))
  );
}

function getAllAlerts({ limit = 50 } = {}) {
  return [...alerts].reverse().slice(0, limit);
}

function acknowledgeAlert(id) {
  const alert = alerts.find(a => a.id === Number(id));
  if (!alert) return null;
  alert.acknowledged    = true;
  alert.acknowledged_at = new Date().toISOString();
  return alert;
}

function getAlertsByEquipment(equipment_id) {
  return alerts.filter(a => a.equipment_id === equipment_id).reverse();
}

module.exports = {
  initAlertStore,
  createAlert,
  getActiveAlerts,
  getAllAlerts,
  acknowledgeAlert,
  getAlertsByEquipment,
  listActiveAlerts,
  listAllAlerts,
  listAlertsByEquipment,
  acknowledgeAlertById,
  acknowledgeAllAlerts,
};
