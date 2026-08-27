/**
 * alertService.js
 * In-memory alert store (replaces PostgreSQL for prototype).
 * Swap for pg queries when deploying to production.
 */

let alerts     = [];   // all alerts ever created
let alertIdSeq = 1;

function initAlertStore() {
  alerts     = [];
  alertIdSeq = 1;
  console.log('[AlertService] Initialised');
}

function createAlert({ equipment_id, severity, anomaly_score, rul_hours, message, feature_snapshot }) {
  const alert = {
    id:             alertIdSeq++,
    equipment_id,
    severity,
    anomaly_score,
    rul_hours,
    message,
    feature_snapshot: feature_snapshot || {},
    timestamp:      new Date().toISOString(),
    acknowledged:   false,
    acknowledged_at: null,
  };
  alerts.push(alert);
  console.log(`[Alert] ${severity} | ${equipment_id} | score=${anomaly_score.toFixed(3)} | RUL=${rul_hours}h`);
  return alert;
}

function getActiveAlerts() {
  return alerts
    .filter(a => !a.acknowledged)
    .sort((a, b) => {
      const order = { CRITICAL: 0, CAUTION: 1, WARNING: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });
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
