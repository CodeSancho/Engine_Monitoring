






const database = require('./databaseService');

let alerts     = [];
let alertIdSeq = 1;
const activeAlertsByPart = new Map();

function partKeyForAlert({ top_anomalous_features = [], feature_snapshot = {} }) {
  const candidates = [
    ...top_anomalous_features.map(item => String(item).split(':')[0].trim()),
    ...Object.keys(feature_snapshot),
  ];
  const groups = [
    ['bearing_rotating_assembly', /vibration/i],
    ['fuel_system', /fuel|injector/i],
    ['lubrication_system', /oil_pressure/i],
    ['air_induction', /boost_pressure/i],
    ['cooling_system', /temperature|exhaust|ambient/i],
    ['power_output', /power_output/i],
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
  return `${alert.equipment_id}:${alert.part_key || partKeyForAlert(alert)}`;
}

function forgetActiveAlert(alert) {
  const key = activeKey(alert);
  if (activeAlertsByPart.get(key)?.id === alert.id) activeAlertsByPart.delete(key);
}

function initAlertStore() {
  alerts     = [];
  alertIdSeq = 1;
  activeAlertsByPart.clear();
  if (database.isDatabaseEnabled()) {
    database.getAlerts({ activeOnly: true, limit: 500 }).then(rows => {
      for (const alert of rows || []) activeAlertsByPart.set(activeKey(alert), alert);
    }).catch(err => console.error('[Database] Could not load active alert keys:', err.message));
  }
  console.log('[AlertService] Initialised');
}

function createAlert({ equipment_id, severity, anomaly_score, message, feature_snapshot, top_anomalous_features }) {
  const details = { equipment_id, feature_snapshot: feature_snapshot || {}, top_anomalous_features: top_anomalous_features || [] };
  const part_key = partKeyForAlert(details);
  const key = `${equipment_id}:${part_key}`;
  const existing = activeAlertsByPart.get(key);
  if (existing) {
    existing.anomaly_score = anomaly_score;
    existing.message = message;
    existing.feature_snapshot = details.feature_snapshot;
    existing.top_anomalous_features = details.top_anomalous_features;
    existing.last_seen_at = new Date().toISOString();
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
  activeAlertsByPart.set(key, alert);
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
    try { return await database.getAlerts({ activeOnly: true, limit: 500 }); }
    catch (err) { console.error('[Database] Could not load active alerts:', err.message); }
  }
  return getActiveAlerts();
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
      activeAlertsByPart.clear();
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
  activeAlertsByPart.clear();
  return cleared;
}

function getActiveAlerts() {
  return alerts
    .filter(a => !a.acknowledged)


    .sort((a, b) => (b.anomaly_score ?? 0) - (a.anomaly_score ?? 0));
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
