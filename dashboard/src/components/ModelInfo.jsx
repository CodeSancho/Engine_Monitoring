// src/components/ModelInfo.jsx
import { useState, useEffect } from 'react';
import { fetchModelInfo }       from '../services/api';

export default function ModelInfo() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    fetchModelInfo().then(setInfo).catch(() => {});
  }, []);

  const IF_RESULTS = {
    f1_score:  0.9167, precision: 0.9375, recall: 0.8967,
    contamination: 0.30,
    baseline_f1: 0.7181,
    improvement: 0.1986,
  };
  const RUL_RESULTS = {
    test_mae:  22.59, test_rmse: 34.70,
    naive_mae: 53.00, improvement: 30.41,
    top_features: ['s17_mean','s3_mean','s11_slope','s4_mean','s9_slope',
                   's12_mean','s3_slope','fuel_thermal_index','s2_mean','s17_slope'],
  };

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
            <MetricRow label="F1 Score"  val={IF_RESULTS.f1_score.toFixed(4)}  color="#22c55e" />
            <MetricRow label="Precision" val={IF_RESULTS.precision.toFixed(4)} color="#60a5fa" />
            <MetricRow label="Recall"    val={IF_RESULTS.recall.toFixed(4)}    color="#a78bfa" />
            <div className="metric-divider" />
            <MetricRow label="Threshold Baseline F1" val={IF_RESULTS.baseline_f1.toFixed(4)} color="#94a3b8" />
            <MetricRow label="F1 Improvement" val={`+${IF_RESULTS.improvement.toFixed(4)}`} color="#22c55e" highlight />
          </div>
          <div className="model-card__note">
            Trained exclusively on <b>normal</b> engine readings.<br />
            Detects anomalies by identifying patterns that deviate<br />
            from learned healthy engine behaviour.
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
            <MetricRow label="Test MAE"   val={`${RUL_RESULTS.test_mae} cycles`}  color="#22c55e" />
            <MetricRow label="Test RMSE"  val={`${RUL_RESULTS.test_rmse} cycles`} color="#60a5fa" />
            <div className="metric-divider" />
            <MetricRow label="Naive Baseline MAE" val={`${RUL_RESULTS.naive_mae} cycles`} color="#94a3b8" />
            <MetricRow label="MAE Improvement"   val={`-${RUL_RESULTS.improvement} cycles`} color="#22c55e" highlight />
          </div>
          <div className="model-card__note">
            Trained on complete engine run-to-failure trajectories.<br />
            Predicts remaining operational cycles which map to<br />
            hours when calibrated to Mopani engine data.
          </div>
        </div>
      </div>

      {/* Feature importance */}
      <div className="feature-importance">
        <div className="detail-section-title">Top Features — RUL Regressor</div>
        <div className="feat-list">
          {RUL_RESULTS.top_features.map((f, i) => {
            const widths = [100,95,89,82,76,70,65,60,55,50];
            return (
              <div key={f} className="feat-row">
                <span className="feat-rank">{i+1}</span>
                <span className="feat-name">{f}</span>
                <div className="feat-bar-wrap">
                  <div className="feat-bar" style={{ width: `${widths[i]}%`,
                    backgroundColor: i < 3 ? '#B87333' : i < 6 ? '#2E86AB' : '#64748b' }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="feat-note">
          Slope features (rate of change) appearing in top 10 validates the 30-minute
          sliding window design. Derived cross-sensor features (fuel_thermal_index)
          confirm cross-sensor engineering adds real signal.
        </div>
      </div>

      {/* Decision engine */}
      <div className="decision-engine">
        <div className="detail-section-title">Decision Engine — Severity Thresholds</div>
        <div className="sev-table">
          {[
            ['NORMAL',   '#22c55e', 'Anomaly score < 0.45',               '—',       'Continue operation'],
            ['WARNING',  '#f59e0b', 'Anomaly score ≥ 0.45',               '> 48h',   'Schedule inspection'],
            ['CAUTION',  '#f97316', 'Anomaly score ≥ 0.45',               '12–48h',  'Inspect before next shift'],
            ['CRITICAL', '#ef4444', 'Anomaly score ≥ 0.45',               '≤ 12h',   'Report to maintenance bay immediately'],
          ].map(([sev, col, cond, rul, action]) => (
            <div key={sev} className="sev-row" style={{ borderLeftColor: col }}>
              <span className="sev-badge" style={{ backgroundColor: col }}>{sev}</span>
              <span className="sev-cond">{cond}</span>
              <span className="sev-rul">RUL {rul}</span>
              <span className="sev-action">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, val, color, highlight }) {
  return (
    <div className={`metric-row ${highlight ? 'metric-row--highlight' : ''}`}>
      <span className="metric-row__label">{label}</span>
      <span className="metric-row__val" style={{ color }}>{val}</span>
    </div>
  );
}
