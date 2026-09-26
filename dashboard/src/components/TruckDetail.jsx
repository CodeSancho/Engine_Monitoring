// src/components/TruckDetail.jsx
//
// FIXES APPLIED (see conversation):
//  1. SEV_COLOR previously had no entry for 'ANOMALY' (only the old
//     four-tier NORMAL/WARNING/CAUTION/CRITICAL scheme), so an anomalous
//     engine fell through to the '|| #22c55e' default -- GREEN, the same
//     color as normal. Confirmed live: this made real anomalies visually
//     indistinguishable from healthy engines. Now maps the real two-tier
//     scheme explicitly.
//  2. RULGauge and all RUL display removed from this view. RUL is no
//     longer part of live per-engine monitoring (the ziya07-to-CMAPSS
//     sensor mapping was proven physically invalid); it now lives as a
//     separate demo panel in ModelInfo.jsx, validated on CMAPSS-native
//     data only.
//  3. truck.model reference removed -- simulatorService.js no longer
//     assigns engine "models" (Komatsu/Cat naming was dropped in favor
//     of generic Engine 1/2/3).
//  4. STYLE PASS: SEV_COLOR's bright #22c55e/#ef4444 swapped for the
//     same muted green/red used everywhere else in the app. The sensor
//     chart tooltip was still the leftover dark-theme style (#1e293b
//     background) from before the light-theme pass -- fixed. The six
//     sensor line colors were saturated Tailwind-400 accents that read
//     "neon" next to the rest of the muted palette -- replaced with a
//     desaturated set. Misc inline grays (#94a3b8, #f97316) swapped for
//     the app's --text3 / --copper variables so they track future
//     palette tweaks automatically instead of drifting out of sync.
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { getComponentInfo } from '../utils/engineComponents';

const SEV_COLOR = { NORMAL: '#5f8f72', ANOMALY: '#b3564c' };

const SENSOR_KEYS = [
  { key: 'Temperature_C',   label: 'Temperature',    unit: '°C',   color: '#bf7d68', warn: 100 },
  { key: 'RPM',             label: 'Engine RPM',     unit: 'rpm',  color: '#5f84a3', warn: 3800 },
  { key: 'Fuel_Efficiency', label: 'Fuel Efficiency', unit: 'k/L', color: '#74a382', warn: null },
  { key: 'Power_Output_kW', label: 'Power Output',   unit: 'kW',   color: '#8f7fa8', warn: null },
  { key: 'Vibration_X',     label: 'Vibration X',    unit: '',     color: '#b87333', warn: 0.8  },
  { key: 'Vibration_Y',     label: 'Vibration Y',    unit: '',     color: '#b99b52', warn: 0.8  },
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
          <YAxis domain={[mn, mx]} tick={{ fontSize: 9, fill: 'var(--text3)' }} width={40} />
          <Tooltip
            contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, color: 'var(--text)' }}
            formatter={v => [`${v.toFixed(2)} ${sensor.unit}`, sensor.label]}
            labelFormatter={() => ''}
          />
          {sensor.warn && <ReferenceLine y={sensor.warn} stroke="#b3564c" strokeDasharray="3 3" />}
          <Line type="monotone" dataKey="val" stroke={sensor.color}
            dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function TruckDetail({ truckId, fleet, prediction, sensorHistory, onBack }) {
  const truck = fleet.find(t => t.equipment_id === truckId) || {};
  const sev   = truck.severity || 'NORMAL';
  const color = SEV_COLOR[sev] || 'var(--text3)'; // unrecognized severity -> neutral gray, never green

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

        <div className="detail-stat">
          <div className="detail-stat__label">Readings Processed</div>
          <div className="detail-stat__val" style={{ color: 'var(--text3)' }}>
            {truck.reading_count || 0}
          </div>
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
          <div className="model-sub" style={{ marginBottom: 8 }}>
            "Likely part" is a general association, not a diagnosis — the model itself only sees raw sensor numbers.
          </div>
          {prediction.top_anomalous_features.map((f, i) => {
            const comp = getComponentInfo(f);
            return (
              <div key={i} className="feature-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="feature-row__name">{f.split(':')[0]}</span>
                  <span className="feature-row__val" style={{ color: 'var(--copper)' }}>
                    {f.split(':')[1]}
                  </span>
                </div>
                {comp && (
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    Likely part: <strong>{comp.component}</strong> ({comp.detail})
                  </div>
                )}
              </div>
            );
          })}
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