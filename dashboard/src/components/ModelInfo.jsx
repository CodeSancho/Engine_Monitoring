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
            <div className="model-card__dataset">ziya07 Engine Failure Dataset</div>
          </div>
          <div className="model-card__body">
            <MetricRow label="F1 score" value={fmt(model.f1_score)} />
            <MetricRow label="Contamination" value={fmt(model.contamination)} />
          </div>
          <div className="model-card__note">
            This model detects unusual sensor windows. It is independent from the five component-level RUL forests.
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
