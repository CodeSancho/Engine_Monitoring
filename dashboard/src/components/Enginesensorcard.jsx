// src/components/EngineSensorCard.jsx
//
// Fleet-grid card: real engine photo as the card art, with live sensor
// callouts overlaid on top -- same feature_snapshot fields AlertPanel.jsx
// reads (temperature_mean, rpm_mean, vibration_magnitude,
// fuel_efficiency_mean). One shared photo across all cards (it's not
// per-truck imagery, just a representative engine shot), anchor points
// are eyeballed against that photo -- nudge the `anchor` percentages
// below if you swap in a different image.
//
// Put the photo at src/assets/engine-card.webp (or wherever your app
// serves static assets) and adjust IMG_SRC below to match.
import IMG_SRC from '../assets/engine-card.webp';

const SEV_COLOR = { NORMAL: '#5f9b74', ANOMALY: '#b25c53' };

// anchor: [x%, y%] point on the photo the leader line touches.
// label: [x%, y%] where the text box sits (left-aligned near the left
// edge, right-aligned near the right edge).
const CALLOUTS = [
  { key: 'temperature_mean',     label: 'Temperature', unit: '°C',  decimals: 1, side: 'left',  anchor: [48, 22], labelY: 18 },
  { key: 'rpm_mean',             label: 'Engine RPM',  unit: 'rpm', decimals: 0, side: 'left',  anchor: [28, 62], labelY: 68 },
  { key: 'vibration_magnitude',  label: 'Vibration',   unit: '',    decimals: 3, side: 'right', anchor: [55, 55], labelY: 30 },
  { key: 'fuel_efficiency_mean', label: 'Fuel Eff.',   unit: 'k/L', decimals: 1, side: 'right', anchor: [70, 35], labelY: 75 },
];

function fmtVal(v, unit, decimals) {
  if (v == null) return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(decimals)}${unit ? ' ' + unit : ''}`;
}

export default function EngineSensorCard({ truck, onSelect }) {
  const sev = truck.severity || 'NORMAL';
  const color = SEV_COLOR[sev] || '#94a3b8';
  const snap = truck.feature_snapshot || {};
  const hasSnap = snap.temperature_mean != null;

  return (
    <div
      className="engine-card"
      onClick={() => onSelect(truck.equipment_id)}
      style={{ borderColor: color + '55' }}
    >
      <div className="engine-card__header">
        <div>
          <div className="engine-card__id">{truck.equipment_id}</div>
          <div className="engine-card__name">{truck.name}</div>
        </div>
        <span className="sev-badge" style={{ backgroundColor: color }}>{sev}</span>
      </div>

      <div className="engine-card__art">
        <img src={IMG_SRC} alt="Engine" className="engine-card__photo" />

        {/* leader lines, drawn in percentage space so they track the image at any size */}
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
          <span>Anomaly </span>
          <span className="mono" style={{ color, fontWeight: 700 }}>
            {((truck.anomaly_score || 0) * 100).toFixed(0)}%
          </span>
        </div>
        {truck.reading_count > 0 && <span>{truck.reading_count} readings</span>}
      </div>
      <div className="engine-card__msg">{truck.message || 'Awaiting data...'}</div>
    </div>
  );
}