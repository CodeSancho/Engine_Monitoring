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
            Fit on all training windows without labels, as an unsupervised detector. Validation labels are used only to choose the alert threshold; the held-out test engines report performance. Synthetic labels do not trigger live alerts.
          </div>
        </div>
        <div className="model-card">
          <div className="model-card__header" style={{ borderColor: '#B87333' }}>
            <div className="model-card__title">Component RUL</div>
            <div className="model-card__sub">Five Random Forest regressors</div>
            <div className="model-card__dataset">Synthetic haul-truck component histories</div>
          </div>
          <div className="model-card__note">
            Each forest predicts one component’s remaining life in months from six recent records. Estimates and tree spread are available on the Component RUL page; the synthetic data does not validate real-truck accuracy.
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(value) {
  return typeof value === 'number' ? value.toFixed(4) : '—';
}

function MetricRow({ label, value }) {
  return <div className="metric-row"><span className="metric-row__label">{label}</span><span className="metric-row__val">{value}</span></div>;
}
