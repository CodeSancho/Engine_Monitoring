// src/components/AlertPanel.jsx
import { acknowledgeAlert } from '../services/api';

const SEV_COLOR = { NORMAL:'#22c55e', WARNING:'#f59e0b', CAUTION:'#f97316', CRITICAL:'#ef4444' };

function AlertCard({ alert, onAcknowledge, onSelectTruck }) {
  const color = SEV_COLOR[alert.severity] || '#64748b';
  const time  = new Date(alert.timestamp).toLocaleTimeString();
  const snap  = alert.feature_snapshot || {};

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
          <span className="score-chip" style={{ color: '#94a3b8' }}>
            RUL: {alert.rul_hours?.toFixed(0)}h
          </span>
        </div>
      </div>

      <div className="alert-card__msg">{alert.message}</div>

      {snap.temperature_mean && (
        <div className="alert-card__sensors">
          <span>Temp: {parseFloat(snap.temperature_mean).toFixed(1)}°C</span>
          <span>RPM: {Math.round(snap.rpm_mean)}</span>
          <span>Vib: {parseFloat(snap.vibration_magnitude||0).toFixed(3)}</span>
          <span>Slope: {parseFloat(snap.temperature_slope||0).toFixed(4)}</span>
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
  const counts = { WARNING: 0, CAUTION: 0, CRITICAL: 0 };
  active.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1; });

  return (
    <div className="alert-panel">
      <div className="alert-panel__header">
        <h2 className="section-title">Active Alerts</h2>
        <div className="alert-counts">
          {Object.entries(counts).map(([sev, cnt]) => cnt > 0 && (
            <span key={sev} className="count-chip"
              style={{ backgroundColor: SEV_COLOR[sev], color: '#fff' }}>
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
