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
import { acknowledgeAlert } from '../services/api';
import { getComponentInfo } from '../utils/engineComponents';

const SEV_COLOR = { NORMAL: '#22c55e', ANOMALY: '#ef4444' };

function AlertCard({ alert, onAcknowledge, onSelectTruck }) {
  const color = SEV_COLOR[alert.severity] || '#94a3b8'; // unrecognized severity -> neutral gray, never green
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
          <span className="sev-badge" style={{ backgroundColor: color }}>{alert.severity}</span>
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
        <div className="alert-card__component" style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
          Likely part: <strong style={{ color: '#cbd5e1' }}>{comp.component}</strong> ({comp.detail})
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

  return (
    <div className="alert-panel">
      <div className="alert-panel__header">
        <h2 className="section-title">Active Alerts</h2>
        <div className="alert-counts">
          {Object.entries(counts).map(([sev, cnt]) => cnt > 0 && (
            <span key={sev} className="count-chip"
              style={{ backgroundColor: SEV_COLOR[sev] || '#94a3b8', color: '#fff' }}>
              {cnt} {sev}
            </span>
          ))}
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