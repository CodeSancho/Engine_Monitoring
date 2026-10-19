


import IMG_SRC from '../assets/engine-card.webp';
import { getSeverityColor } from '../constants/Severity';




const CALLOUTS = [
  { key: 'temperature_mean',     label: 'Temperature', unit: '°C',  decimals: 1, side: 'left',  anchor: [48, 22], labelY: 18 },
  { key: 'rpm_mean',             label: 'Engine RPM',  unit: 'rpm', decimals: 0, side: 'left',  anchor: [28, 62], labelY: 68 },
  { key: 'vibration_magnitude',  label: 'Vibration',   unit: '',    decimals: 3, side: 'right', anchor: [55, 55], labelY: 30 },
  { key: 'fuel_efficiency_km_per_l_mean', label: 'Fuel Eff.',   unit: 'km/L', decimals: 2, side: 'right', anchor: [70, 35], labelY: 75 },
];

function fmtVal(v, unit, decimals) {
  if (v == null) return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(decimals)}${unit ? ' ' + unit : ''}`;
}

export default function EngineSensorCard({ truck, onSelect }) {
  const sev = truck.severity || 'NORMAL';
  const snap = truck.feature_snapshot || {};
  const hasSnap = snap.temperature_mean != null;
  const hasAssessment = sev !== 'NORMAL' || Number(truck.reading_count) >= 30;
  const displaySeverity = sev === 'WARNING' || sev === 'ANOMALY' ? 'CRITICAL' : sev;
  const badgeSeverity = hasAssessment ? displaySeverity : 'PENDING';
  const color = hasAssessment ? getSeverityColor(displaySeverity) : 'var(--text3)';
  const hasScore = truck.anomaly_score != null && Number.isFinite(Number(truck.anomaly_score));
  const scoreLabel = hasScore
    ? `${Math.max(4.9, Math.min(98, Number(truck.anomaly_score) * 100)).toFixed(1)}%` : null;
  const modelStatus = hasAssessment
    ? `${displaySeverity === 'TAKE_NOTE' ? 'TAKE NOTE' : displaySeverity}${scoreLabel ? ` · ${scoreLabel}` : ''}`
    : 'Awaiting assessment';

  return (
    <div
      className="engine-card"
      onClick={() => onSelect(truck.equipment_id)}
      style={{ borderColor: color + '55' }}
    >
      <div className="engine-card__header">
        <div>
          <div className="engine-card__id">Engine {truck.label_number}</div>
        </div>
        <span className="sev-badge" data-sev={badgeSeverity} style={{ color }}>
          {hasAssessment ? (displaySeverity === 'TAKE_NOTE' ? 'TAKE NOTE' : displaySeverity) : 'AWAITING'}
        </span>
      </div>

      <div className="engine-card__art">
        <img src={IMG_SRC} alt="Engine" className="engine-card__photo" />

        {                                                                                 }
        <svg className="engine-card__lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          {hasSnap && CALLOUTS.map(c => {
            const labelX = c.side === 'left' ? 4 : 96;
            const bendX = c.side === 'left' ? c.anchor[0] - 14 : c.anchor[0] + 14;
            return (
              <g key={c.key}>
                <circle cx={c.anchor[0]} cy={c.anchor[1]} r="0.9" fill="#c99a4a" />
                <polyline
                  points={`${c.anchor[0]},${c.anchor[1]} ${bendX},${c.labelY} ${labelX},${c.labelY}`}
                  fill="none" stroke="#c99a4a" strokeWidth="0.35" opacity="0.85" vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>

        {hasSnap ? CALLOUTS.map(c => (
          <div
            key={c.key}
            className={`engine-card__label engine-card__label--${c.side}`}
            style={{ top: `${c.labelY}%` }}
          >
            <div className="engine-card__label-name">{c.label}</div>
            <div className="engine-card__label-val">{fmtVal(snap[c.key], c.unit, c.decimals)}</div>
          </div>
        )) : (
          <div className="engine-card__waiting">Awaiting sensor data…</div>
        )}
      </div>

      <div className="engine-card__footer">
        <div>
          <span>Model status </span>
          <span className="mono" style={{ color, fontWeight: 700 }}>{modelStatus}</span>
        </div>
        {truck.reading_count > 0 && <span>{truck.reading_count} readings</span>}
      </div>
      <div className="engine-card__msg">{truck.message || 'Awaiting data...'}</div>
    </div>
  );
}
