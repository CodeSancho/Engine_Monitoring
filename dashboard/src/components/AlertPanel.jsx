// src/components/AlertPanel.jsx
//
// FIXES APPLIED (see conversation):
//  1. SEV_COLOR had no 'ANOMALY' entry (only the old four-tier
//     NORMAL/WARNING/CAUTION/CRITICAL scheme) -- every real alert fell
//     through to the '|| #64748b' default gray instead of red. Same bug
//     class already fixed in TruckDetail.jsx; this file was missed.
//  2. alert.rul_hours?.toFixed(0) always rendered blank -- rul_hours was
//     removed from alertService.js/simulatorService.js (see their own
//     comments) but this dead chip was never removed here. Replaced
//     with the alert's top anomalous feature + its likely component,
//     which the alert object now actually carries.
//  3. `counts` initializer used the old four-tier keys (WARNING/CAUTION/
//     CRITICAL) -- none of which are ever set on a real alert anymore
//     (severity is two-tier: NORMAL/ANOMALY, and only ANOMALY alerts
//     are created), so the count chips silently never rendered.
//  4. STYLE PASS: SEV_COLOR's bright #22c55e/#ef4444 swapped for the
//     same muted green/red used everywhere else (EngineSensorCard,
//     TruckDetail). sev-badge and count-chip were filled colored boxes
//     (backgroundColor set inline) -- both are now plain colored text,
//     no box, matching the rest of the app. The "likely part" note was
//     still using leftover dark-theme colors (#94a3b8 on a light page,
//     and #cbd5e1 -- a *light* slate meant for dark backgrounds, nearly
//     invisible here) -- fixed to the light-theme text tokens.
//  5. NEW: "Export CSV" button in the header, next to the count chips
//     -- downloads the currently-active alerts (with their sensor
//     snapshot and top anomalous feature) via the shared csvExport
//     util. Only shown when there are active alerts to export.
import { acknowledgeAlert } from '../services/api';
import { getComponentInfo } from '../utils/engineComponents';
import { getSeverityColor } from '../constants/Severity';
import { downloadCsv } from '../utils/csvExport';

function AlertCard({ alert, onAcknowledge, onSelectTruck }) {
  const color = getSeverityColor(alert.severity);
  const time  = new Date(alert.timestamp).toLocaleTimeString();
  const snap  = alert.feature_snapshot || {};
  const topFeature = alert.top_anomalous_features?.[0];
  const comp = topFeature ? getComponentInfo(topFeature) : null;

  async function handleAck() {
    try {
      await acknowledgeAlert(alert.id);
      onAcknowledge(alert.id);
    } catch { onAcknowledge(alert.id); }
  }

  return (
    <div className="alert-card" style={{ borderLeftColor: color }}>
      <div className="alert-card__header">
        <div className="alert-card__left">
          <span className="sev-badge" data-sev={alert.severity} style={{ color }}>{alert.severity}</span>
          <span className="alert-card__equip" onClick={() => onSelectTruck(alert.equipment_id)}>
            {alert.equipment_id}
          </span>
          <span className="alert-card__time">{time}</span>
        </div>
        <div className="alert-card__scores">
          <span className="score-chip" style={{ color }}>
            Score: {(alert.anomaly_score * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="alert-card__msg">{alert.message}</div>

      {snap.temperature_mean != null && (
        <div className="alert-card__sensors">
          <span>Temp: {parseFloat(snap.temperature_mean).toFixed(1)}°C</span>
          <span>RPM: {Math.round(snap.rpm_mean)}</span>
          <span>Vib: {parseFloat(snap.vibration_magnitude || 0).toFixed(3)}</span>
          <span>Slope: {parseFloat(snap.temperature_slope || 0).toFixed(4)}</span>
        </div>
      )}

      {comp && (
        <div className="alert-card__component" style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
          Likely part: <strong style={{ color: 'var(--text)' }}>{comp.component}</strong> ({comp.detail})
          <div style={{ fontSize: 11, marginTop: 2 }}>{comp.note}</div>
        </div>
      )}

      <div className="alert-card__actions">
        <button className="btn-secondary" onClick={() => onSelectTruck(alert.equipment_id)}>
          View Truck →
        </button>
        <button className="btn-acknowledge" onClick={handleAck}>
          ✓ Acknowledge
        </button>
      </div>
    </div>
  );
}

export default function AlertPanel({ alerts, onAcknowledge, onSelectTruck }) {
  const active = alerts.filter(a => !a.acknowledged);
  // FIX: severity is two-tier now (NORMAL/ANOMALY); only ANOMALY alerts
  // are ever created, but count generically so this doesn't silently
  // break again if a new tier is added later.
  const counts = {};
  active.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1; });

  function handleExport() {
    const rows = active.map(a => ({
      id: a.id,
      equipment_id: a.equipment_id,
      severity: a.severity,
      anomaly_score: a.anomaly_score,
      timestamp: a.timestamp,
      message: a.message,
      temperature_mean: a.feature_snapshot?.temperature_mean,
      rpm_mean: a.feature_snapshot?.rpm_mean,
      vibration_magnitude: a.feature_snapshot?.vibration_magnitude,
      temperature_slope: a.feature_snapshot?.temperature_slope,
      top_anomalous_feature: a.top_anomalous_features?.[0],
    }));
    downloadCsv(`active-alerts-${new Date().toISOString().slice(0, 10)}`, rows);
  }

  return (
    <div className="alert-panel">
      <div className="alert-panel__header">
        <h2 className="section-title">Active Alerts</h2>
        <div className="alert-panel__header-right">
          <div className="alert-counts">
            {Object.entries(counts).map(([sev, cnt]) => cnt > 0 && (
              <span key={sev} className="count-chip"
                style={{ color: getSeverityColor(sev) }}>
                {cnt} {sev}
              </span>
            ))}
          </div>
          {active.length > 0 && (
            <button className="btn-secondary" onClick={handleExport}>
              Export CSV
            </button>
          )}
        </div>
      </div>

      {active.length === 0
        ? (
          <div className="empty-state">
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <div>No active alerts — all engines operating normally.</div>
          </div>
        )
        : active.map(a => (
          <AlertCard key={a.id} alert={a}
            onAcknowledge={onAcknowledge} onSelectTruck={onSelectTruck} />
        ))
      }
    </div>
  );
}