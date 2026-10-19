

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { getComponentInfo } from '../utils/engineComponents';
import { getSeverityColor } from '../constants/Severity';
import { downloadCsv } from '../utils/csvExport';

const SENSOR_KEYS = [
  { key: 'Temperature_C', label: 'Engine temperature', unit: '°C', color: '#bf7d68', guide: 104 },
  { key: 'Exhaust_Temp_C', label: 'Exhaust temperature', unit: '°C', color: '#ce805a', guide: 569 },
  { key: 'RPM', label: 'Engine RPM', unit: 'rpm', color: '#5f84a3', guide: 2444 },
  { key: 'Fuel_Efficiency_km_per_L', label: 'Fuel efficiency', unit: 'km/L', color: '#74a382', guide: 2.08 },
  { key: 'Oil_Pressure_kPa', label: 'Oil pressure', unit: 'kPa', color: '#8f7fa8', guide: 479 },
  { key: 'Vibration_X', label: 'Vibration X', unit: '', color: '#b87333', guide: 1.69 },
];

function SensorTooltip({ active, payload, label, sensor }) {
  if (!active || !payload?.length) return null;
  const reading = payload[0].payload;
  const timestamp = reading.timestamp ? new Date(reading.timestamp) : null;
  const timeLabel = timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toLocaleString() : `Reading ${Number(label) + 1}`;
  const decimals = sensor.key.startsWith('Vibration') ? 3 : sensor.key === 'RPM' ? 0 : 1;

  return (
    <div className="sensor-tooltip">
      <div className="sensor-tooltip__time">{timeLabel}</div>
      <div className="sensor-tooltip__value" style={{ color: sensor.color }}>
        {sensor.label}: {Number(reading.val).toFixed(decimals)}{sensor.unit ? ` ${sensor.unit}` : ''}
      </div>
    </div>
  );
}

function SensorChart({ data, sensor }) {
  const rawVals = data.map(r => parseFloat(r[sensor.key]));




  const vals = rawVals.filter(Number.isFinite);
  const mn = vals.length ? Math.min(...vals, sensor.guide) : 0;
  const mx = vals.length ? Math.max(...vals, sensor.guide) : sensor.guide;
  const range = mx - mn;
  const pad = range === 0 ? (Math.abs(mx) || 1) * 0.1 : range * 0.12;
  const domain = [mn - pad, mx + pad];
  const chartData = data.map((r, i) => ({
    i,
    val: Number.isFinite(parseFloat(r[sensor.key])) ? parseFloat(r[sensor.key]) : null,
    timestamp: r.source_timestamp || r.timestamp || r.recorded_at,
  }));

  return (
    <div className="sensor-chart">
      <div className="sensor-chart__header">
        <div className="sensor-chart__title" style={{ '--sensor-color': sensor.color }}>
          <span className="sensor-chart__dot" />
          {sensor.label} <span className="sensor-chart__unit">{sensor.unit}</span>
        </div>
        <span className="sensor-chart__limit">+3σ guide {sensor.guide}{sensor.unit ? ` ${sensor.unit}` : ''}</span>
      </div>
      <ResponsiveContainer width="100%" height={92}>
        <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 1, left: 0 }}>
          <XAxis dataKey="i" hide />
          <YAxis
            domain={domain}
            tick={{ fontSize: 9, fill: '#748091' }}
            width={sensor.key === 'RPM' ? 43 : 39}
            tickFormatter={v => {
              const abs = Math.abs(v);
              if (abs >= 100) return v.toFixed(0);
              if (abs >= 10) return v.toFixed(1);
              return v.toFixed(2);
            }}
          />
          <Tooltip content={<SensorTooltip sensor={sensor} />} />
          <ReferenceLine
            y={sensor.guide}
            stroke="#b87333"
            strokeDasharray="4 3"
            strokeWidth={1.25}
            label={{ value: '+3σ', position: 'insideTopRight', fill: '#9b6127', fontSize: 8, fontWeight: 700 }}
          />
          <Line type="linear" dataKey="val" stroke={sensor.color}
            dot={{ r: 2.4, fill: sensor.color, strokeWidth: 0 }}
            strokeWidth={2} activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 1.5 }}
            isAnimationActive animationDuration={700} animationEasing="linear" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function TruckDetail({ truckId, fleet, prediction, sensorHistory, onBack }) {
  const truck = fleet.find(t => t.equipment_id === truckId) || {};
  const sev   = truck.severity || 'NORMAL';
  const hasAssessment = sev !== 'NORMAL' || Number(truck.reading_count) >= 30;
  const displaySeverity = sev === 'WARNING' || sev === 'ANOMALY' ? 'CRITICAL' : sev;
  const badgeSeverity = hasAssessment ? displaySeverity : 'PENDING';
  const color = hasAssessment ? getSeverityColor(displaySeverity) : 'var(--text3)';
  const hasScore = truck.anomaly_score != null && Number.isFinite(Number(truck.anomaly_score));
  const scorePercent = hasScore
    ? Math.max(4.9, Math.min(98, Number(truck.anomaly_score) * 100)) : null;
  const scoreLabel = hasScore
    ? `${scorePercent.toFixed(1)}%` : null;
  const modelStatus = hasAssessment
    ? `${displaySeverity === 'TAKE_NOTE' ? 'TAKE NOTE' : displaySeverity}${scoreLabel ? ` · ${scoreLabel}` : ''}`
    : 'AWAITING ASSESSMENT';

  return (
    <div className="truck-detail">
      {              }
      <div className="truck-detail__nav">
        <button className="back-btn" onClick={onBack}>← Fleet Overview</button>
        <div>
          <div className="truck-detail__title">Engine {truck.label_number}</div>
        </div>
        <div className="sev-badge" data-sev={badgeSeverity} style={{ color }}>
          {hasAssessment ? (displaySeverity === 'TAKE_NOTE' ? 'TAKE NOTE' : displaySeverity) : 'AWAITING'}
        </div>
      </div>

      {                   }
      <div className="detail-stats">
        <div className="detail-stat">
          <div className="detail-stat__label">Model status</div>
          <div className="detail-stat__val" style={{ color }}>
            {modelStatus}
          </div>
          {hasScore && (
            <div className="anomaly-bar" aria-label={`Anomaly score ${scoreLabel}`}>
              <div className="anomaly-fill" style={{
                width: `${scorePercent}%`,
                backgroundColor: color,
              }} />
            </div>
          )}
        </div>

        <div className="detail-stat">
          <div className="detail-stat__label">Readings Processed</div>
          <div className="detail-stat__val" style={{ color: 'var(--text3)' }}>
            {truck.reading_count || 0}
          </div>
        </div>
      </div>

      {             }
      <div className="detail-message" style={{ borderColor: color }}>
        {truck.message || 'Awaiting prediction...'}
      </div>

      {                       }
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

      {                        }
      <div className="truck-detail__section-header" style={{ marginTop: 20 }}>
        <div className="detail-section-title" style={{ margin: 0 }}>
          Live Sensor Readings (last {Math.min(sensorHistory.length, 20)} readings)
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
              <SensorChart key={s.key} data={sensorHistory.slice(-20)} sensor={s} />
            ))}
          </div>
        )
        : <div className="empty-state">Collecting sensor data — charts appear after 30 readings...</div>
      }
    </div>
  );
}
