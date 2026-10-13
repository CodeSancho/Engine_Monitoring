import { useEffect, useMemo, useState } from 'react';
import {
  Area, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fetchComponentRul, fetchComponentRulEngines } from '../services/api';
import engineImage from '../assets/engine-card.webp';

const PARTS = [
  { key: 'main_bearings', label: 'Main bearings', color: '#237f8d', routine: false },
  { key: 'fuel_injectors', label: 'Fuel injectors', color: '#526caa', routine: false },
  { key: 'turbocharger', label: 'Turbocharger', color: '#8b6ab0', routine: false },
  { key: 'cooling_system', label: 'Cooling system', color: '#43836d', routine: false },
  { key: 'air_filter', label: 'Air filter', color: '#bd8743', routine: true },
];

const SIGNAL_LABELS = {
  payload_t: 'Payload', speed_kmh: 'Travel speed', total_resistance_pct: 'Total resistance',
  Temperature_C: 'Engine temperature', Exhaust_Temp_C: 'Exhaust temperature', RPM: 'Engine RPM',
  Torque_Nm: 'Torque', Power_Output_kW: 'Power output', Fuel_Consumption_Lph: 'Fuel consumption',
  Fuel_Efficiency_tkm_per_L: 'Fuel efficiency', Oil_Pressure_kPa: 'Oil pressure',
  Boost_Pressure_kPa: 'Boost pressure', Vibration_X: 'Vibration X', Vibration_Y: 'Vibration Y', Vibration_Z: 'Vibration Z',
};

function partStatus(part, months) {
  if (part.routine) return months <= 1 ? { text: 'Service due', key: 'routine-due' } : { text: 'Routine interval', key: 'routine' };
  if (months < 3) return { text: 'Critical', key: 'critical' };
  if (months < 6) return { text: 'Watch', key: 'watch' };
  return { text: 'Healthy', key: 'healthy' };
}

function formatMonths(months) {
  return months >= 12 ? `${(months / 12).toFixed(1)} yr` : `${months.toFixed(1)} mo`;
}

function RulTooltip({ active, payload, label, selectedPart }) {
  if (!active || !payload?.length) return null;
  const visible = payload.filter(item => item.dataKey === selectedPart.key || PARTS.some(part => item.dataKey === part.key));
  return (
    <div className="component-rul-tooltip">
      <strong>{Number(label).toFixed(1)} months into cycle</strong>
      {visible.map(item => (
        <div key={item.dataKey} style={{ color: item.color }}>
          {item.name}: {Number(item.value).toFixed(1)} months remaining
        </div>
      ))}
    </div>
  );
}

export default function ComponentRulDashboard() {
  const [engines, setEngines] = useState([]);
  const [selectedEngine, setSelectedEngine] = useState('');
  const [assessment, setAssessment] = useState(null);
  const [selectedPartKey, setSelectedPartKey] = useState('main_bearings');
  const [loadingEngines, setLoadingEngines] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchComponentRulEngines()
      .then(result => {
        const list = result.engines || [];
        setEngines(list);
        if (list.length) setSelectedEngine(String(list[0].engine_id));
      })
      .catch(err => setError(err.response?.data?.error || 'Could not load synthetic engine histories.'))
      .finally(() => setLoadingEngines(false));
  }, []);

  const runAssessment = async () => {
    if (!selectedEngine) return;
    setLoading(true);
    setError('');
    setAssessment(null);
    try {
      setAssessment(await fetchComponentRul(selectedEngine));
    } catch (err) {
      setError(err.response?.data?.error || 'Component RUL assessment failed. Check that the ML service and dataset are available.');
    } finally {
      setLoading(false);
    }
  };

  const selectedPart = PARTS.find(item => item.key === selectedPartKey) || PARTS[0];
  const latest = assessment?.latest;
  const majorParts = useMemo(() => PARTS.filter(part => !part.routine), []);
  const likelyCause = latest?.weakest_major_component;
  const likelyPart = PARTS.find(part => part.key === likelyCause);
  const likelyMetrics = assessment?.model_info?.metrics?.[likelyCause]?.test;
  const chartData = useMemo(() => (assessment?.points || []).map(point => {
    const item = { month: point.month_index };
    PARTS.forEach(part => {
      const values = point.parts[part.key];
      item[part.key] = values.months;
      item[`${part.key}_low`] = values.range_low;
      item[`${part.key}_spread`] = Math.max(0, values.range_high - values.range_low);
    });
    return item;
  }), [assessment]);

  const shortest = latest && majorParts
    .map(part => ({ ...part, ...latest.parts[part.key] }))
    .sort((a, b) => a.months - b.months)[0];
  const shortestState = shortest && partStatus(shortest, shortest.months);

  return (
    <main className="component-rul-page">
      <header className="component-rul-header">
        <div className="component-rul-engine-art">
          <img src={engineImage} alt="Engine illustration" />
        </div>
        <div className="component-rul-heading">
          <div className="component-rul-kicker">COMPONENT HEALTH · SYNTHETIC BENCHMARK</div>
          <h1>Engine component life</h1>
          <p>Five Random Forest estimates from recent sensor and operating-condition history.</p>
        </div>
        <div className="component-rul-controls">
          <label>
            <span>Benchmark engine</span>
            <select value={selectedEngine} disabled={loading || loadingEngines} onChange={event => { setSelectedEngine(event.target.value); setAssessment(null); }}>
              {engines.map(engine => <option key={engine.engine_id} value={engine.engine_id}>Sample engine {engine.engine_id} · {engine.split} set</option>)}
            </select>
          </label>
          <button className="component-rul-run" disabled={!selectedEngine || loading || loadingEngines} onClick={runAssessment}>
            {loading ? 'Assessing components…' : assessment ? 'Refresh assessment' : 'Assess component life'}
          </button>
        </div>
      </header>

      {error && <div className="component-rul-error">{error}</div>}
      {!error && loadingEngines && <div className="component-rul-empty">Loading held-out engine histories…</div>}
      {!assessment && !loading && !loadingEngines && !error && (
        <div className="component-rul-empty">Choose a held-out benchmark engine and run an assessment. The first run trains and caches five component models.</div>
      )}
      {loading && !assessment && (
        <div className="component-rul-empty">Building the component forests from 210 training engines, then scoring this held-out history… The first assessment can take a few minutes.</div>
      )}

      {assessment && latest && (
        <>
          <section className="component-rul-summary">
            <div className="component-rul-summary-card">
              <span>Shortest major-part life</span>
              <strong style={{ color: shortestState?.key === 'critical' ? 'var(--red-dark)' : shortest?.color }}>{formatMonths(shortest?.months || 0)}</strong>
              <small>{shortest?.label} · model range {shortest?.range_low.toFixed(1)}–{shortest?.range_high.toFixed(1)} months</small>
            </div>
            <div className="component-rul-summary-card">
              <span>Likely part to inspect</span>
              <strong>{likelyPart?.label}</strong>
              <small>Lowest estimate among the four major components</small>
            </div>
            <div className="component-rul-summary-card">
              <span>Engine history</span>
              <strong>{Number(latest.operating_hours).toLocaleString()} h</strong>
              <small>{assessment.total_records} records · {formatMonths(latest.month_index)} into the synthetic cycle</small>
            </div>
          </section>

          <section className="component-rul-layout">
            <div className="component-rul-panel component-rul-parts">
              <div className="component-rul-section-heading">
                <div><h2>Parts · remaining useful life</h2><p>Sorted by estimated life. Under 3 months is critical; 3–6 months is watch.</p></div>
              </div>
              {PARTS.map(part => {
                const values = latest.parts[part.key];
                const status = partStatus(part, values.months);
                const drivers = assessment.model_info.feature_importance[part.key].slice(0, 2);
                const topSignals = [...new Set(drivers.map(item => SIGNAL_LABELS[item.feature.replace(/_(mean|std|slope|latest)$/, '')] || item.feature))].slice(0, 2);
                return (
                  <button
                    type="button"
                    key={part.key}
                    className={`component-rul-part${selectedPartKey === part.key ? ' component-rul-part--selected' : ''}`}
                    onClick={() => setSelectedPartKey(part.key)}
                  >
                    <div className="component-rul-part-top">
                      <strong>{part.label}</strong>
                      <span className={`component-rul-status component-rul-status--${status.key}`}>{status.text}</span>
                    </div>
                    <div className="component-rul-part-value">
                      <strong>{formatMonths(values.months)}</strong>
                      <span>{values.range_low.toFixed(1)}–{values.range_high.toFixed(1)} mo tree spread</span>
                    </div>
                    <div className="component-rul-bar"><i style={{ width: `${Math.max(2, Math.min(100, values.months / 24 * 100))}%`, background: part.color }} /></div>
                    <small>Most-used model signals: {topSignals.join(', ')}</small>
                    {part.routine && <small className="component-rul-routine-note">Routine replacement item; excluded from likely major-part cause.</small>}
                  </button>
                );
              })}
              <div className="component-rul-footnote">Predictions are capped at 24 months. Range is the 10th–90th percentile across forest trees; it shows tree disagreement, not a formal confidence interval.</div>
            </div>

            <aside className="component-rul-side">
              <div className="component-rul-cause" style={{ '--part-color': likelyPart?.color || '#237f8d' }}>
                <span>MODEL ESTIMATE · LIKELY PART</span>
                <h2>{likelyPart?.label}</h2>
                <strong>{formatMonths(latest.parts[likelyCause].months)} remaining</strong>
                <p>This is the shortest prediction among the four major parts. Treat it as a maintenance lead to inspect, not a confirmed diagnosis.</p>
                <div className="component-rul-cause-range">Tree spread: {latest.parts[likelyCause].range_low.toFixed(1)}–{latest.parts[likelyCause].range_high.toFixed(1)} months</div>
                <div className="component-rul-cause-range">Held-out test MAE: {likelyMetrics?.mae_months ?? '—'} months</div>
              </div>
              <div className="component-rul-model-note">
                <h3>Assessment basis</h3>
                <p>Each forest uses six consecutive records with mean, spread, trend, and latest value for 15 sensor and operating signals.</p>
                <p>{assessment.model_info.validation_engines} validation engines and {assessment.model_info.test_engines} test engines are held out by engine ID.</p>
                <p>Source: {assessment.model_info.dataset}. Synthetic benchmark only; not a verified forecast for a real haul truck.</p>
              </div>
            </aside>
          </section>

          <section className="component-rul-panel component-rul-trend">
            <div className="component-rul-section-heading component-rul-trend-heading">
              <div><h2>Component life through the engine cycle</h2><p>All five estimates over operating months · select a part to show its tree-spread band.</p></div>
              <label className="component-rul-part-select"><span>Spread band</span><select value={selectedPartKey} onChange={event => setSelectedPartKey(event.target.value)}>{PARTS.map(part => <option key={part.key} value={part.key}>{part.label}</option>)}</select></label>
            </div>
            <div className="component-rul-chart-legend">{PARTS.map(part => <span key={part.key}><i style={{ background: part.color }} />{part.label}</span>)}</div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 12, right: 16, bottom: 18, left: 8 }}>
                <CartesianGrid stroke="#e7edf3" vertical={false} />
                <XAxis dataKey="month" type="number" domain={[0, 'dataMax']} tick={{ fill: '#5B6B82', fontSize: 11 }} tickFormatter={value => formatMonths(value)} label={{ value: 'Operating history (months)', position: 'insideBottom', offset: -8, fill: '#45546a', fontSize: 12 }} />
                <YAxis domain={[0, 24]} tick={{ fill: '#5B6B82', fontSize: 11 }} tickFormatter={value => `${value} mo`} label={{ value: 'Predicted life remaining', angle: -90, position: 'insideLeft', fill: '#45546a', fontSize: 12 }} />
                <Tooltip content={<RulTooltip selectedPart={selectedPart} />} />
                <ReferenceLine y={3} stroke="#b5483a" strokeDasharray="5 4" label={{ value: '3 mo · critical', position: 'insideTopRight', fill: '#984940', fontSize: 10 }} />
                <ReferenceLine y={6} stroke="#d18a2f" strokeDasharray="5 4" label={{ value: '6 mo · watch', position: 'insideTopRight', fill: '#9b681e', fontSize: 10 }} />
                <Area dataKey={`${selectedPart.key}_low`} stackId="spread" stroke="none" fill="#fff" fillOpacity={0} isAnimationActive={false} tooltipType="none" />
                <Area dataKey={`${selectedPart.key}_spread`} stackId="spread" stroke="none" fill={selectedPart.color} fillOpacity={0.14} isAnimationActive={false} tooltipType="none" />
                {PARTS.map(part => <Line key={part.key} dataKey={part.key} name={part.label} stroke={part.color} strokeWidth={selectedPartKey === part.key ? 3 : 1.8} strokeOpacity={selectedPartKey === part.key ? 1 : 0.72} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </section>
          <footer className="component-rul-footer">The component RUL view is independent of anomaly detection. It uses synthetic component histories for method demonstration; live fleet readings are not used for these estimates.</footer>
        </>
      )}
    </main>
  );
}
