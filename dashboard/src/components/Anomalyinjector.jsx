// src/components/AnomalyInjector.jsx
//
// Testing/demo tool: corrupts a running engine's live buffer with a
// physically-grounded fault signature (bearing_wear / overheat /
// mechanical_bind), then lets the real, unmodified prediction+alert
// pipeline react to it naturally on its next tick. Does not fake an
// alert directly.
import { useState } from 'react';
import { injectAnomaly } from '../services/api';

const ENGINES = ['ENGINE-1', 'ENGINE-2', 'ENGINE-3'];
const FAULT_TYPES = [
  { value: 'bearing_wear',    label: 'Bearing wear (vibration spike)' },
  { value: 'overheat',        label: 'Overheat (temperature spike, efficiency drop)' },
  { value: 'mechanical_bind', label: 'Mechanical bind (torque spike, RPM drop)' },
];

export default function AnomalyInjector() {
  const [equipmentId, setEquipmentId] = useState(ENGINES[0]);
  const [faultType, setFaultType]     = useState(FAULT_TYPES[0].value);
  const [severity, setSeverity]       = useState(4);
  const [status, setStatus]           = useState(null); // { ok, message }
  const [loading, setLoading]         = useState(false);

  const handleInject = () => {
    setLoading(true);
    setStatus(null);
    injectAnomaly({ equipment_id: equipmentId, fault_type: faultType, severity })
      .then(res => {
        setStatus({
          ok: true,
          message: `Injected ${res.fault_type} (severity ${res.severity}) into ${res.equipment_id} — `
                  + `${res.readings_affected} readings corrupted (${res.fields_changed.join(', ')}). `
                  + `Watch the dashboard for the next prediction tick.`,
        });
      })
      .catch(err => {
        const msg = err.response?.data?.error || err.message;
        setStatus({ ok: false, message: msg });
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="anomaly-injector model-card">
      <div className="detail-section-title">Manual Anomaly Injection (testing/demo)</div>
      <div className="model-sub" style={{ marginBottom: 12 }}>
        Corrupts a running engine's live sensor buffer with a real fault signature.
        The next natural prediction tick will genuinely evaluate it — this does not
        fake an alert, it only corrupts input data honestly.
      </div>

      <div className="inject-controls">
        <label className="inject-field">
          <span>Engine</span>
          <select value={equipmentId} onChange={e => setEquipmentId(e.target.value)}>
            {ENGINES.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>

        <label className="inject-field">
          <span>Fault type</span>
          <select value={faultType} onChange={e => setFaultType(e.target.value)}>
            {FAULT_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>

        <label className="inject-field">
          <span>Severity: {severity}σ</span>
          <input
            type="range" min="0.5" max="6" step="0.5"
            value={severity}
            onChange={e => setSeverity(parseFloat(e.target.value))}
          />
        </label>

        <button className="back-btn" onClick={handleInject} disabled={loading}>
          {loading ? 'Injecting…' : 'Inject Anomaly'}
        </button>
      </div>

      {status && (
        <div className="model-card__note" style={{
          marginTop: 12,
          color: status.ok ? '#22c55e' : '#ef4444',
        }}>
          {status.message}
        </div>
      )}
    </div>
  );
}