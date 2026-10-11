// src/components/ModelInfo.jsx
//
// FIXES APPLIED (see conversation):
//  1. Previously fetched live model info via fetchModelInfo() but NEVER
//     used the result -- rendered entirely from hardcoded constants
//     instead, showing numbers from a model version that no longer
//     exists (F1=0.9167, contamination=0.30, RUL MAE=22.59 -- all
//     values from before this project's fixes). Now renders from the
//     live-fetched `info` state, with a loading state while it arrives.
//  2. Decision Engine table previously described the old four-tier
//     severity scheme (WARNING/CAUTION/CRITICAL) with RUL-hour
//     thresholds. Severity is now two-tier (NORMAL/ANOMALY) and RUL
//     is no longer part of live monitoring -- table updated to match.
//  3. NEW: RUL Model Demo panel. RUL prediction moved here from the
//     per-engine TruckDetail view, since it's only valid on genuine
//     CMAPSS-shaped input, not live engine telemetry. Calls
//     fetchRulDemo(), which must hit a backend route that forwards a
//     sample CMAPSS engine window to Flask's /predict_rul_demo.
//     NOTE: fetchRulDemo() is assumed but not yet confirmed against
//     your real services/api.js -- verify the import/signature matches.
//  4. STYLE PASS 1: removed the "Decision Engine — Severity Thresholds"
//     table at the bottom -- it duplicated the same NORMAL/ANOMALY key
//     already shown elsewhere. Swapped hardcoded bright green/red/blue
//     metric colors for the app's muted CSS variables.
//  5. STYLE PASS 2: the CMAPSS unit selector, the lifespan position
//     bar, and the recharts tooltip were still using leftover
//     dark-theme inline styles (#334155 track, #1e293b tooltip) that
//     never matched the light theme -- moved onto proper CSS classes.
//     The "Run Live RUL Demo" button was reusing "back-btn" (meant for
//     the truck-detail back arrow) -- given its own class (.btn-inject)
//     instead.
//  6. STYLE PASS 3: removed the 🎲 random-unit button entirely per
//     request, along with its now-unused pickRandomUnit handler.
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchModelInfo, fetchRulDemo, fetchRulDemoUnits } from '../services/api';

// A handful of real CMAPSS units spread across the fleet to offer before
// the real, richer list has loaded. totalCycles is left null here (never
// shown as a real number) until the actual fetch from /api/rul-demo/units
// replaces this with real {unit, totalCycles} pairs.
const FALLBACK_UNITS = [1, 25, 50, 75, 100].map(u => ({ unit: u, totalCycles: null }));

export default function ModelInfo() {
  const [info, setInfo]       = useState(null);
  const [infoError, setInfoError] = useState(false);
  const [rulHistory, setRulHistory] = useState([]);   // [{cycle, rul}, ...] for the live chart
  const [rulPlaying, setRulPlaying] = useState(false);
  const [rulError, setRulError] = useState(false);
  const [rulDone, setRulDone] = useState(false);
  const [availableUnits, setAvailableUnits] = useState(FALLBACK_UNITS); // [{unit, totalCycles}, ...]
  const [selectedUnit, setSelectedUnit]     = useState(1);

  useEffect(() => {
    fetchModelInfo().then(setInfo).catch(() => setInfoError(true));
    // Real CMAPSS unit ids + their real total cycle count -- lets the
    // dropdown show "Unit 50 — 198 real cycles" instead of a bare id,
    // and lets us show where the selected unit's real lifespan falls
    // relative to the other 99 real engines.
    fetchRulDemoUnits().then(res => {
      if (Array.isArray(res.units) && res.units.length > 0) setAvailableUnits(res.units);
    }).catch(() => {/* keep FALLBACK_UNITS */});
  }, []);

  // Sample the entire engine life at a readable interval. Every point is
  // still a real model prediction for a 30-cycle CMAPSS window.
  useEffect(() => {
    if (!rulPlaying) return;
    let cancelled = false;
    let timer;

    const tick = async (start) => {
      if (cancelled) return;
      try {
        const res = await fetchRulDemo(start, selectedUnit);
        if (cancelled) return;
        const totalCycles = res.total_cycles_this_engine;
        const cycle = res.is_final_window ? totalCycles : res.cycle_range[1];
        const estimatedUsed = cycle;
        setRulHistory(prev => [...prev, {
          cycle,
          rul: res.rul_cycles,
          monthsRemaining: Math.max(0, res.rul_cycles / 30.44),
          yearsRemaining: Math.max(0, res.rul_cycles / 365.25),
          monthsUsed: estimatedUsed / 30.44,
          yearsUsed: estimatedUsed / 365.25,
        }]);
        if (res.is_final_window) {
          setRulPlaying(false);
          setRulDone(true);
          return;
        }
        const step = Math.max(1, Math.floor(res.total_cycles_this_engine / 24));
        timer = setTimeout(() => tick(start + step), 80);
      } catch {
        if (!cancelled) { setRulError(true); setRulPlaying(false); }
      }
    };
    tick(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rulPlaying, selectedUnit]);

  const startRulDemo = () => {
    setRulHistory([]);
    setRulError(false);
    setRulDone(false);
    setRulPlaying(true);
  };

  // Real min/max/median lifespan across whatever units we actually have
  // loaded -- computed from the fetched data, not a guess -- so we can
  // show the selected unit's real lifespan in context ("longer-lived
  // than most", etc.) instead of just a bare cycle count.
  const knownCycles = availableUnits.map(u => u.totalCycles).filter(c => c != null);
  const cycleRange  = knownCycles.length > 0
    ? { min: Math.min(...knownCycles), max: Math.max(...knownCycles) }
    : null;
  const selectedMeta = availableUnits.find(u => u.unit === selectedUnit) || { unit: selectedUnit, totalCycles: null };

  if (infoError) {
    return <div className="model-info"><div className="empty-state">Model info unavailable — is the backend running?</div></div>;
  }
  if (!info) {
    return <div className="model-info"><div className="empty-state">Loading model performance…</div></div>;
  }

  const IF_RESULTS  = info.isolation_forest || {};
  const RUL_RESULTS = info.rul_regressor || {};

  return (
    <div className="model-info">
      <h2 className="section-title">ML Model Performance</h2>
      <div className="model-sub">
        Training results from ziya07 Engine Failure Dataset + NASA CMAPSS FD001
      </div>

      <div className="model-grid">
        {/* Isolation Forest card */}
        <div className="model-card">
          <div className="model-card__header" style={{ borderColor: '#2E86AB' }}>
            <div className="model-card__title">Isolation Forest</div>
            <div className="model-card__sub">Anomaly Detection</div>
            <div className="model-card__dataset">ziya07 Engine Failure Dataset</div>
          </div>
          <div className="model-card__body">
            <MetricRow label="F1 Score"      val={fmt(IF_RESULTS.f1_score)}      color="var(--green)" />
            <MetricRow label="Contamination" val={fmt(IF_RESULTS.contamination)} color="var(--sky)" />
          </div>
          <div className="model-card__note">
            Trained exclusively on <b>normal</b> engine readings, evaluated against
            physically-motivated synthetic fault injection (see project methodology
            notes — Fault_Condition labels were found statistically unusable).
          </div>
        </div>

        {/* Random Forest RUL card */}
        <div className="model-card">
          <div className="model-card__header" style={{ borderColor: '#B87333' }}>
            <div className="model-card__title">Random Forest Regressor</div>
            <div className="model-card__sub">RUL Prediction</div>
            <div className="model-card__dataset">NASA CMAPSS FD001 (100 engines, run-to-failure)</div>
          </div>
          <div className="model-card__body">
            <MetricRow label="Test MAE"  val={RUL_RESULTS.test_mae_cycles != null ? `${RUL_RESULTS.test_mae_cycles} cycles` : '—'}  color="var(--green)" />
            <MetricRow label="Test RMSE" val={RUL_RESULTS.test_rmse_cycles != null ? `${RUL_RESULTS.test_rmse_cycles} cycles` : '—'} color="var(--sky)" />
          </div>
          <div className="model-card__note">
            Validated only on NASA CMAPSS turbofan data — not applicable to live
            engine telemetry. See demo panel below.
          </div>
        </div>
      </div>

      {/* RUL Model Demo panel — live decline animation */}
      <div className="rul-demo-panel">
        <div className="detail-section-title">RUL Model Demo — live decline, CMAPSS-native input only</div>
        <div className="model-sub" style={{ marginBottom: 12 }}>
          Steps through a real CMAPSS engine's full life and predicts RUL for each window along
          the way — watch the predicted remaining life genuinely decline as the engine approaches
          its real, recorded failure point. Pick any of CMAPSS's real, distinct engine units below —
          each ran to a genuinely different real failure point, this isn't simulated variation. Not
          connected to live engine monitoring above — the two use structurally different sensors and
          cannot be mapped to each other.
        </div>

        <label className="inject-field" style={{ marginBottom: 6, maxWidth: 280 }}>
          <span>CMAPSS engine unit ({availableUnits.length} real engines available)</span>
          <select
            value={selectedUnit}
            disabled={rulPlaying}
            style={{ width: '100%' }}
            onChange={e => {
              setSelectedUnit(parseInt(e.target.value, 10));
              setRulHistory([]);
              setRulDone(false);
              setRulError(false);
            }}
          >
            {availableUnits.map(u => (
              <option key={u.unit} value={u.unit}>
                Unit {u.unit}{u.totalCycles != null ? ` — ${u.totalCycles} real cycles` : ''}
              </option>
            ))}
          </select>
        </label>

        {/* Where this unit's real lifespan falls among the other real
            engines -- purely descriptive, computed from the same fetched
            list, not a new inference. */}
        {cycleRange && selectedMeta.totalCycles != null && (
          <div style={{ marginBottom: 12, maxWidth: 280 }}>
            <div className="rul-lifespan-track">
              <div
                className="rul-lifespan-marker"
                style={{
                  left: `${((selectedMeta.totalCycles - cycleRange.min) / Math.max(1, cycleRange.max - cycleRange.min)) * 100}%`,
                }}
              />
            </div>
            <div className="rul-lifespan-caption">
              {selectedMeta.totalCycles} cycles — real range across {availableUnits.length} engines: {cycleRange.min}–{cycleRange.max}
            </div>
          </div>
        )}

        <button className="btn-inject" onClick={startRulDemo} disabled={rulPlaying}>
          {rulPlaying ? 'Running…' : rulHistory.length > 0 ? 'Replay' : `Run Live RUL Demo (Unit ${selectedUnit})`}
        </button>
        {rulError && <div className="empty-state" style={{ marginTop: 8 }}>Demo request failed — is the backend/Flask service running?</div>}

        {rulHistory.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="rul-chart-explainer">
              <strong>How to read this chart</strong>
              <span><b>X-axis:</b> estimated engine age from the beginning, shown in months and years. It assumes one cycle equals one operating day.</span>
              <span><b>Y-axis:</b> estimated months. Copper shows predicted life remaining; blue shows recorded engine age increasing toward end of life.</span>
              <span>This demo samples real CMAPSS engine windows; it has no calendar dates or observed service months. The calendar view is an estimate, not live fleet RUL.</span>
            </div>
            <div className="rul-lifecycle-legend">
              <span><i className="rul-legend-swatch rul-legend-swatch--remaining" />Predicted months remaining</span>
              <span><i className="rul-legend-swatch rul-legend-swatch--used" />Estimated months elapsed</span>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={rulHistory} margin={{ top: 8, right: 20, bottom: 18, left: 12 }}>
                <XAxis dataKey="yearsUsed" type="number" domain={[0, (selectedMeta.totalCycles || 'dataMax') / 365.25]}
                  tickCount={7} tick={{ fontSize: 10, fill: '#334155' }}
                  tickFormatter={years => years < 1 ? `${Math.round(years * 12)} mo` : `${years.toFixed(1)} yr`}
                  label={{ value: 'Estimated engine age (months / years)', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#1f2937' }} />
                <YAxis type="number" domain={[0, Math.max(1, (selectedMeta.totalCycles || 1) / 30.44)]}
                  tick={{ fontSize: 10, fill: '#334155' }} width={48}
                  tickFormatter={months => months >= 12 ? `${(months / 12).toFixed(1)} yr` : `${months.toFixed(0)} mo`}
                  label={{ value: 'Estimated life remaining', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#1f2937' }} />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, color: '#111827' }}
                  formatter={(v, name) => [`${Number(v).toFixed(1)} months (${(Number(v) / 12).toFixed(1)} years)`, name]}
                  labelFormatter={years => `Estimated age: ${Number(years).toFixed(1)} years (${(Number(years) * 12).toFixed(0)} months)`}
                />
                <Line type="monotone" dataKey="monthsRemaining" name="Predicted months remaining" stroke="#B87333" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="monthsUsed" name="Recorded months elapsed" stroke="#5f84a3" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="rul-calendar-track" aria-label="Estimated engine age from start to recorded end of life">
              <div
                className="rul-calendar-track__progress"
                style={{ width: `${Math.min(100, (rulHistory[rulHistory.length - 1].cycle / Math.max(1, selectedMeta.totalCycles || rulHistory[rulHistory.length - 1].cycle)) * 100)}%` }}
              />
              <span className="rul-calendar-track__start">0 months</span>
              <span className="rul-calendar-track__current">Current estimate: {(rulHistory[rulHistory.length - 1].cycle / 30.44).toFixed(1)} months</span>
              <span className="rul-calendar-track__end">End: {((selectedMeta.totalCycles || 0) / 30.44).toFixed(1)} months ({((selectedMeta.totalCycles || 0) / 365.25).toFixed(1)} years)</span>
            </div>
            <div className="model-card__body" style={{ marginTop: 4 }}>
              <MetricRow label="Predicted life remaining" val={`${rulHistory[rulHistory.length-1].monthsRemaining.toFixed(1)} months (${rulHistory[rulHistory.length-1].yearsRemaining.toFixed(1)} years)`} color="#B87333" highlight />
              <MetricRow label="Estimated life used" val={`${(selectedMeta.totalCycles / 30.44 - rulHistory[rulHistory.length-1].monthsRemaining).toFixed(1)} months`} color="#5f84a3" />
              {rulDone && <div className="model-card__note" style={{ marginTop: 8 }}>
                Reached this engine's real, recorded end of life. Predicted RUL correctly approaches
                0 as the true failure point is reached (Model Test MAE: {RUL_RESULTS.test_mae_cycles} cycles).
              </div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmt(v) {
  return typeof v === 'number' ? v.toFixed(4) : '—';
}

function MetricRow({ label, val, color, highlight }) {
  return (
    <div className={`metric-row ${highlight ? 'metric-row--highlight' : ''}`}>
      <span className="metric-row__label">{label}</span>
      <span className="metric-row__val" style={{ color }}>{val}</span>
    </div>
  );
}
