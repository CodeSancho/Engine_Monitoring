// src/components/TruckDetail.jsx

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { getComponentInfo } from '../utils/engineComponents';
import { SEV_COLOR, getSeverityColor } from '../constants/Severity';
import { downloadCsv } from '../utils/csvExport';

const SENSOR_KEYS = [
  { key: 'Temperature_C',   label: 'Temperature',    unit: '°C',   color: '#bf7d68', warn: 100 },
  { key: 'RPM',             label: 'Engine RPM',     unit: 'rpm',  color: '#5f84a3', warn: 3800 },
  { key: 'Fuel_Efficiency', label: 'Fuel Efficiency', unit: 'k/L', color: '#74a382', warn: null },
  { key: 'Power_Output_kW', label: 'Power Output',   unit: 'kW',   color: '#8f7fa8', warn: null },
  { key: 'Vibration_X',     label: 'Vibration X',    unit: '',     color: '#b87333', warn: 0.8  },
  { key: 'Vibration_Y',     label: 'Vibration Y',    unit: '',     color: '#b99b52', warn: 0.8  },
];

function SensorChart({ data, sensor }) {
  const rawVals = data.map(r => parseFloat(r[sensor.key]));
  // A single non-numeric reading (null, "N/A", missing field, etc.)
  // turns into NaN, and NaN poisons Math.min/Math.max for the *entire*
  // array -- that can blank out the whole chart, not just one point.
  // Filter to finite values before computing the range.
  const vals = rawVals.filter(Number.isFinite);
  const mn = vals.length ? Math.min(...vals) : 0;
  const mx = vals.length ? Math.max(...vals) : 1;
  // Additive padding, not multiplicative: multiplying by 0.98/1.02 only
  // pads correctly when every value is positive. Vibration_X/Vibration_Y
  // oscillate around zero and go negative, where mn * 0.98 pulls the
  // floor *toward* zero (i.e. above the real minimum) and clips the
  // line instead of padding it. A flat signal (mn === mx) also
  // collapsed to a zero-height domain and could make the line vanish.
  const range = mx - mn;
  const pad = range === 0 ? (Math.abs(mx) || 1) * 0.1 : range * 0.08;
  const domain = [mn - pad, mx + pad];
  const chartData = data.map((r, i) => ({ i, val: parseFloat(r[sensor.key]) }));

  return (
    <div className="sensor-chart">
      <div className="sensor-chart__title" style={{ color: sensor.color }}>
        {sensor.label} <span className="sensor-chart__unit">({sensor.unit})</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
          <XAxis dataKey="i" hide />
          <YAxis
            domain={domain}
            tick={{ fontSize: 9, fill: '#7a828d' }}
            width={52}
            tickFormatter={v => {
              const abs = Math.abs(v);
              if (abs >= 100) return v.toFixed(0);
              if (abs >= 10) return v.toFixed(1);
              return v.toFixed(2);
            }}
          />
          <Tooltip
            contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, color: '#2b3138' }}
            formatter={v => [`${v.toFixed(2)} ${sensor.unit}`, sensor.label]}
            labelFormatter={() => ''}
          />
          {sensor.warn && <ReferenceLine y={sensor.warn} stroke={SEV_COLOR.ANOMALY} strokeDasharray="3 3" />}
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
  const color = getSeverityColor(sev);

  return (
    <div className="truck-detail">
      {/* Back nav */}
      <div className="truck-detail__nav">
        <button className="back-btn" onClick={onBack}>← Fleet Overview</button>
        <div className="truck-detail__title">{truck.name || truckId}</div>
        <div className="sev-badge" data-sev={sev} style={{ color }}>{sev}</div>
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
      <div className="truck-detail__section-header" style={{ marginTop: 20 }}>
        <div className="detail-section-title" style={{ margin: 0 }}>
          Live Sensor Readings (last {sensorHistory.length} readings)
        </div>
        {sensorHistory.length > 0 && (
          <button
            className="btn-secondary"
            onClick={() => downloadCsv(`${truckId}-sensor-history-${new Date().toISOString().slice(0, 10)}`, sensorHistory)}
          >
            Export CSV
          </button>
        )}
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