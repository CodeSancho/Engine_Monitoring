/**
 * alertService.js
 * In-memory alert store (replaces PostgreSQL for prototype).
 * Swap for pg queries when deploying to production.
 *
 */

const database = require('./databaseService');

let alerts     = [];   // all alerts ever created
let alertIdSeq = 1;

function initAlertStore() {
  alerts     = [];
  alertIdSeq = 1;
  console.log('[AlertService] Initialised');
}

function createAlert({ equipment_id, severity, anomaly_score, message, feature_snapshot, top_anomalous_features }) {
  const alert = {
    id:             alertIdSeq++,
    equipment_id,
    severity,
    anomaly_score,
    message,
    feature_snapshot: feature_snapshot || {},
    top_anomalous_features: top_anomalous_features || [],
    timestamp:      new Date().toISOString(),
    acknowledged:   false,
    acknowledged_at: null,
  };
  alerts.push(alert);
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
    try { return await database.acknowledgeAlertRecord(id); }
    catch (err) { console.error('[Database] Could not acknowledge alert:', err.message); }
  }
  return acknowledgeAlert(id);
}

function getActiveAlerts() {
  return alerts
    .filter(a => !a.acknowledged)
    // FIX: sort by anomaly_score descending -- most anomalous first.
    // Real, continuous signal, unlike the old fixed-tier map.
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
};
