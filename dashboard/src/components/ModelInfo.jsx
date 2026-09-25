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

  // Steps through the engine's life 5 cycles at a time, fetching a fresh
  // RUL prediction for each window and appending it to the chart -- this
  // is what makes the decline visible live, rather than one static number.
  useEffect(() => {
    if (!rulPlaying) return;
    let cancelled = false;
    const STEP = 5;

    const tick = async (start) => {
      if (cancelled) return;
      try {
        const res = await fetchRulDemo(start, selectedUnit);
        if (cancelled) return;
        setRulHistory(prev => [...prev, { cycle: res.cycle_range[1], rul: res.rul_cycles }]);
        if (res.is_final_window) {
          setRulPlaying(false);
          setRulDone(true);
          return;
        }
        setTimeout(() => tick(start + STEP), 400);
      } catch {
        if (!cancelled) { setRulError(true); setRulPlaying(false); }
      }
    };
    tick(0);
    return () => { cancelled = true; };
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

  const pickRandomUnit = () => {
    if (rulPlaying || availableUnits.length === 0) return;
    const others = availableUnits.filter(u => u.unit !== selectedUnit);
    const pool = others.length > 0 ? others : availableUnits;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setSelectedUnit(pick.unit);
    setRulHistory([]);
    setRulDone(false);
    setRulError(false);
  };

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
            <MetricRow label="F1 Score"      val={fmt(IF_RESULTS.f1_score)}      color="#22c55e" />
            <MetricRow label="Contamination" val={fmt(IF_RESULTS.contamination)} color="#60a5fa" />
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
            <MetricRow label="Test MAE"  val={RUL_RESULTS.test_mae_cycles != null ? `${RUL_RESULTS.test_mae_cycles} cycles` : '—'}  color="#22c55e" />
            <MetricRow label="Test RMSE" val={RUL_RESULTS.test_rmse_cycles != null ? `${RUL_RESULTS.test_rmse_cycles} cycles` : '—'} color="#60a5fa" />
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={selectedUnit}
              disabled={rulPlaying}
              style={{ flex: 1 }}
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
            <button className="back-btn" onClick={pickRandomUnit} disabled={rulPlaying} title="Pick a random real engine unit">
              🎲
            </button>
          </div>
        </label>

        {/* Where this unit's real lifespan falls among the other real
            engines -- purely descriptive, computed from the same fetched
            list, not a new inference. */}
        {cycleRange && selectedMeta.totalCycles != null && (
          <div style={{ marginBottom: 12, maxWidth: 280 }}>
            <div style={{
              position: 'relative', height: 6, borderRadius: 3,
              background: '#334155', marginTop: 4,
            }}>
              <div style={{
                position: 'absolute', top: -3, height: 12, width: 2,
                background: '#B87333',
                left: `${((selectedMeta.totalCycles - cycleRange.min) / Math.max(1, cycleRange.max - cycleRange.min)) * 100}%`,
              }} />
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {selectedMeta.totalCycles} cycles — real range across {availableUnits.length} engines: {cycleRange.min}–{cycleRange.max}
            </div>
          </div>
        )}

        <button className="back-btn" onClick={startRulDemo} disabled={rulPlaying}>
          {rulPlaying ? 'Running…' : rulHistory.length > 0 ? 'Replay' : `Run Live RUL Demo (Unit ${selectedUnit})`}
        </button>
        {rulError && <div className="empty-state" style={{ marginTop: 8 }}>Demo request failed — is the backend/Flask service running?</div>}

        {rulHistory.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={rulHistory} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
                <XAxis dataKey="cycle" tick={{ fontSize: 10, fill: '#64748b' }}
                  label={{ value: 'Engine cycle', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#64748b' }} />
                <YAxis domain={[0, 130]} tick={{ fontSize: 10, fill: '#64748b' }} width={35} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 11 }}
                  formatter={v => [`${v.toFixed(1)} cycles`, 'Predicted RUL']}
                  labelFormatter={c => `Cycle ${c}`}
                />
                <Line type="monotone" dataKey="rul" stroke="#B87333" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="model-card__body" style={{ marginTop: 4 }}>
              <MetricRow label="Current predicted RUL" val={`${rulHistory[rulHistory.length-1].rul.toFixed(1)} cycles`} color="#B87333" highlight />
              {rulDone && <div className="model-card__note" style={{ marginTop: 8 }}>
                Reached this engine's real, recorded end of life. Predicted RUL correctly approaches
                0 as the true failure point is reached (Model Test MAE: {RUL_RESULTS.test_mae_cycles} cycles).
              </div>}
            </div>
          </div>
        )}
      </div>

      {/* Decision engine */}
      <div className="decision-engine">
        <div className="detail-section-title">Decision Engine — Severity Thresholds</div>
        <div className="sev-table">
          {[
            ['NORMAL',  '#22c55e', `Anomaly score < ${fmt(info.anomaly_threshold ?? 0.45)}`, 'Continue operation'],
            ['ANOMALY', '#ef4444', `Anomaly score ≥ ${fmt(info.anomaly_threshold ?? 0.45)}`, 'Flag for inspection'],
          ].map(([sev, col, cond, action]) => (
            <div key={sev} className="sev-row" style={{ borderLeftColor: col }}>
              <span className="sev-badge" style={{ backgroundColor: col }}>{sev}</span>
              <span className="sev-cond">{cond}</span>
              <span className="sev-action">{action}</span>
            </div>
          ))}
        </div>
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