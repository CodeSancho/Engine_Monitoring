

import { useState } from 'react';
import { acknowledgeAlert, acknowledgeAllAlerts } from '../services/api';
import { getComponentInfo } from '../utils/engineComponents';
import { getSeverityColor } from '../constants/Severity';
import { downloadCsv } from '../utils/csvExport';

function AlertCard({ alert, engineLabel, onAcknowledge, onSelectTruck }) {
  const color = getSeverityColor(alert.severity);
  const time  = new Date(alert.timestamp).toLocaleTimeString();
  const snap  = alert.feature_snapshot || {};
  const severityLabel = alert.severity === 'TAKE_NOTE' ? 'TAKE NOTE'
    : ['WARNING', 'ANOMALY'].includes(alert.severity) ? 'CRITICAL' : alert.severity;
  const topFeature = alert.top_anomalous_features?.[0];
  const comp = topFeature ? getComponentInfo(topFeature) : null;
  const likelyPart = snap.likely_part || alert.likely_part;
  const likelyCause = snap.likely_cause || alert.likely_cause;

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
          <span className="sev-badge" data-sev={severityLabel} style={{ color }}>{severityLabel}</span>
          <span className="alert-card__equip" onClick={() => onSelectTruck(alert.equipment_id)}>
            {engineLabel || alert.equipment_id}
          </span>
          <span className="alert-card__time">{time}</span>
        </div>
        <div className="alert-card__scores">
          <span className="score-chip" style={{ color }}>
            Score: {Math.min(98, Math.max(4.9, Number(alert.anomaly_score) * 100 || 0)).toFixed(1)}%
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

      {(likelyPart || comp) && (
        <div className="alert-card__component" style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
          Likely part: <strong style={{ color: 'var(--text)' }}>{likelyPart || comp.component}</strong>
          {likelyCause ? <div style={{ fontSize: 11, marginTop: 2 }}>Possible cause: {likelyCause}</div> : <><span> ({comp.detail})</span><div style={{ fontSize: 11, marginTop: 2 }}>{comp.note}</div></>}
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

export default function AlertPanel({ alerts, fleet = [], onAcknowledge, onSelectTruck }) {
  const [clearing, setClearing] = useState(false);
  const active = alerts.filter(a => !a.acknowledged);



  const counts = {};
  active.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1; });

  async function handleClearAll() {
    setClearing(true);
    try {
      const result = await acknowledgeAllAlerts();
      (result.alerts || []).forEach(alert => onAcknowledge(alert.id));
    } finally {
      setClearing(false);
    }
  }

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
            <>
            <button className="btn-acknowledge" onClick={handleClearAll} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Clear all'}
            </button>
            <button className="btn-secondary" onClick={handleExport}>
              Export CSV
            </button>
            </>
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
            engineLabel={fleet.find(engine => engine.equipment_id === a.equipment_id)?.name}
            onAcknowledge={onAcknowledge} onSelectTruck={onSelectTruck} />
        ))
      }
    </div>
  );
}
