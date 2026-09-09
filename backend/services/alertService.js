/**
 * alertService.js
 * In-memory alert store (replaces PostgreSQL for prototype).
 * Swap for pg queries when deploying to production.
 *
 * FIXES APPLIED (see conversation):
 *  1. rul_hours removed entirely. /predict no longer returns it -- RUL
 *     was moved to /predict_rul_demo since the ziya07-to-CMAPSS sensor
 *     mapping was proven physically invalid. Keeping rul_hours here would
 *     have silently stored `undefined` on every alert with no error.
 *  2. getActiveAlerts now sorts by anomaly_score (continuous, real signal)
 *     instead of a fixed severity-tier map (CRITICAL/CAUTION/WARNING) that
 *     no longer matches the new two-tier severity ('NORMAL'/'ANOMALY').
 *     The old map would have silently given every alert the same sort
 *     priority, since 'ANOMALY' was never a key in it.
 */

let alerts     = [];   // all alerts ever created
let alertIdSeq = 1;

function initAlertStore() {
  alerts     = [];
  alertIdSeq = 1;
  console.log('[AlertService] Initialised');
}

function createAlert({ equipment_id, severity, anomaly_score, message, feature_snapshot }) {
  const alert = {
    id:             alertIdSeq++,
    equipment_id,
    severity,
    anomaly_score,
    message,
    feature_snapshot: feature_snapshot || {},
    timestamp:      new Date().toISOString(),
    acknowledged:   false,
    acknowledged_at: null,
  };
  alerts.push(alert);
  console.log(`[Alert] ${severity} | ${equipment_id} | score=${anomaly_score.toFixed(3)}`);
  return alert;
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
};