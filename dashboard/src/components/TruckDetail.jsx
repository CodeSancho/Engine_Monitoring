// src/components/TruckDetail.jsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const SEV_COLOR = { NORMAL:'#22c55e', WARNING:'#f59e0b', CAUTION:'#f97316', CRITICAL:'#ef4444' };
const SENSOR_KEYS = [
  { key: 'Temperature_C',   label: 'Temperature',    unit: '°C',   color: '#f87171', warn: 100 },
  { key: 'RPM',             label: 'Engine RPM',     unit: 'rpm',  color: '#60a5fa', warn: 3800 },
  { key: 'Fuel_Efficiency', label: 'Fuel Efficiency', unit: 'k/L', color: '#4ade80', warn: null },
  { key: 'Power_Output_kW', label: 'Power Output',   unit: 'kW',   color: '#c084fc', warn: null },
  { key: 'Vibration_X',     label: 'Vibration X',    unit: '',     color: '#fb923c', warn: 0.8  },
  { key: 'Vibration_Y',     label: 'Vibration Y',    unit: '',     color: '#fbbf24', warn: 0.8  },
];

function SensorChart({ data, sensor }) {
  const vals = data.map(r => parseFloat(r[sensor.key] || 0));
  const mn   = Math.min(...vals) * 0.98;
  const mx   = Math.max(...vals) * 1.02;
  const chartData = data.map((r, i) => ({ i, val: parseFloat(r[sensor.key] || 0) }));

  return (
    <div className="sensor-chart">
      <div className="sensor-chart__title" style={{ color: sensor.color }}>
        {sensor.label} <span className="sensor-chart__unit">({sensor.unit})</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <XAxis dataKey="i" hide />
          <YAxis domain={[mn, mx]} tick={{ fontSize: 9, fill: '#64748b' }} width={40} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 11 }}
            formatter={v => [`${v.toFixed(2)} ${sensor.unit}`, sensor.label]}
            labelFormatter={() => ''}
          />
          {sensor.warn && <ReferenceLine y={sensor.warn} stroke="#ef4444" strokeDasharray="3 3" />}
          <Line type="monotone" dataKey="val" stroke={sensor.color}
            dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RULGauge({ rul, severity }) {
  const color = SEV_COLOR[severity] || '#22c55e';
  const MAX   = 200;
  const pct   = Math.min(100, (rul / MAX) * 100);
  const angle = (pct / 100) * 180;
  const rad   = (angle - 90) * (Math.PI / 180);
  const cx = 60, cy = 60, r = 50;
  const nx  = cx + r * Math.cos(rad);
  const ny  = cy + r * Math.sin(rad);

  return (
    <div className="rul-gauge">
      <svg viewBox="0 0 120 70" width="140" height="82">
        {/* Background arc */}
        <path d={`M10,60 A50,50 0 0,1 110,60`} fill="none" stroke="#1e293b" strokeWidth="10" />
        {/* Value arc */}
        <path d={`M10,60 A50,50 0 0,1 110,60`} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${pct * 1.571} 157.1`} strokeLinecap="round" />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={color} />
      </svg>
      <div className="rul-gauge__val" style={{ color }}>
        {typeof rul === 'number' ? `${rul.toFixed(0)}h` : '—'}
      </div>
      <div className="rul-gauge__label">Remaining Useful Life</div>
    </div>
  );
}

export default function TruckDetail({ truckId, fleet, prediction, sensorHistory, onBack }) {
  const truck = fleet.find(t => t.equipment_id === truckId) || {};
  const sev   = truck.severity || 'NORMAL';
  const color = SEV_COLOR[sev];

  return (
    <div className="truck-detail">
      {/* Back nav */}
      <div className="truck-detail__nav">
        <button className="back-btn" onClick={onBack}>← Fleet Overview</button>
        <div className="truck-detail__title">{truck.name || truckId}</div>
        <div className="sev-badge" style={{ backgroundColor: color }}>{sev}</div>
      </div>

      {/* Top stats row */}
      <div className="detail-stats">
        <div className="detail-stat">
          <div className="detail-stat__label">Anomaly Score</div>
          <div className="detail-stat__val" style={{ color }}>
            {((truck.anomaly_score || 0) * 100).toFixed(1)}%
          </div>
          <div className="anomaly-bar">
            <div className="anomaly-fill" style={{ width: `${(truck.anomaly_score||0)*100}%`, backgroundColor: color }} />
          </div>
        </div>

        <RULGauge rul={truck.rul_hours || 0} severity={sev} />

        <div className="detail-stat">
          <div className="detail-stat__label">Readings Processed</div>
          <div className="detail-stat__val" style={{ color: '#94a3b8' }}>
            {truck.reading_count || 0}
          </div>
          <div className="detail-stat__label" style={{ marginTop: 8 }}>Model</div>
          <div className="detail-stat__sub">{truck.model}</div>
        </div>
      </div>

      {/* Message */}
      <div className="detail-message" style={{ borderColor: color }}>
        {truck.message || 'Awaiting prediction...'}
      </div>

      {/* Prediction detail */}
      {prediction && prediction.top_anomalous_features && (
        <div className="detail-features">
          <div className="detail-section-title">Top Anomalous Feature Slopes</div>
          {prediction.top_anomalous_features.map((f, i) => (
            <div key={i} className="feature-row">
              <span className="feature-row__name">{f.split(':')[0]}</span>
              <span className="feature-row__val" style={{ color: '#f97316' }}>
                {f.split(':')[1]}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Live sensor charts */}
      <div className="detail-section-title" style={{ marginTop: 20 }}>
        Live Sensor Readings (last {sensorHistory.length} readings)
      </div>
      {sensorHistory.length > 5
        ? (
          <div className="sensor-grid">
            {SENSOR_KEYS.map(s => (
              <SensorChart key={s.key} data={sensorHistory} sensor={s} />
            ))}
          </div>
        )
        : <div className="empty-state">Collecting sensor data — charts appear after 30 readings...</div>
      }
    </div>
  );
}
