import { useEffect, useState } from 'react';
import { fetchModelInfo } from '../services/api';

export default function ModelInfo() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchModelInfo().then(setInfo).catch(() => setError(true));
  }, []);

  if (error) return <div className="model-info"><div className="empty-state">Model information unavailable — is the backend running?</div></div>;
  if (!info) return <div className="model-info"><div className="empty-state">Loading model information…</div></div>;

  const model = info.isolation_forest || {};
  const componentRul = info.component_rul || {};
  const componentMetrics = [
    ['Main bearings', componentRul.metrics?.main_bearings?.test],
    ['Fuel injectors', componentRul.metrics?.fuel_injectors?.test],
    ['Turbocharger', componentRul.metrics?.turbocharger?.test],
    ['Cooling system', componentRul.metrics?.cooling_system?.test],
    ['Air filter', componentRul.metrics?.air_filter?.test],
  ];
  return (
    <div className="model-info">
      <h2 className="section-title">Model information</h2>
      <div className="model-sub">The RUL component estimates are on the separate Component RUL page and do not include anomaly status.</div>
      <div className="model-grid">
        <div className="model-card">
          <div className="model-card__header" style={{ borderColor: '#2E86AB' }}>
            <div className="model-card__title">Isolation Forest</div>
            <div className="model-card__sub">Anomaly detection</div>
            <div className="model-card__dataset">{model.dataset || 'Synthetic engine telemetry'}</div>
          </div>
          <div className="model-card__body">
            <MetricRow label="Test precision" value={fmt(model.test_precision)} />
            <MetricRow label="Test recall" value={fmt(model.test_recall)} />
            <MetricRow label="Held-out test F1" value={fmt(model.test_f1)} />
            <MetricRow label="Test false-alarm rate" value={fmt(model.test_false_alarm_rate)} />
            <MetricRow label="Held-out test engines" value={model.test_engine_count ?? '—'} />
            <MetricRow label="Window length" value={model.window_size_readings ? `${model.window_size_readings} readings` : '—'} />
            <MetricRow label="Features per window" value={model.feature_count ?? '—'} />
          </div>
          <div className="model-card__note">
            The forest is fit on training windows without labels. Validation labels select its feature/parameter configuration and decision threshold; held-out test engines report performance. Synthetic labels do not trigger live alerts.
          </div>
        </div>
        <div className="model-card">
          <div className="model-card__header" style={{ borderColor: '#B87333' }}>
            <div className="model-card__title">Component RUL</div>
            <div className="model-card__sub">Five gradient-boosting regressors</div>
            <div className="model-card__dataset">Synthetic haul-truck component histories</div>
          </div>
          <div className="model-card__body">
            <MetricRow label="Held-out test engines" value={componentRul.test_engines ?? '—'} />
            {componentMetrics.map(([label, metrics]) => (
              <div key={label}>
                <MetricRow label={`${label} test MAE`} value={formatMonths(metrics?.mae_months)} />
                <MetricRow label={`${label} test RMSE`} value={formatMonths(metrics?.rmse_months)} />
              </div>
            ))}
          </div>
          <div className="model-card__note">
            Lower error is better. Each model predicts remaining life in months from recent sensor history and operating time. Results are measured on held-out synthetic test engines and do not establish real-truck accuracy.
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(value) {
  return typeof value === 'number' ? value.toFixed(4) : '—';
}

function formatMonths(value) {
  return typeof value === 'number' ? `${value.toFixed(3)} mo` : '—';
}

function MetricRow({ label, value }) {
  return <div className="metric-row"><span className="metric-row__label">{label}</span><span className="metric-row__val">{value}</span></div>;
}
