// src/components/AnomalyInjector.jsx
//
// Testing/demo tool: sets EXACT sensor values on a running engine's live
// buffer (e.g. "set Temperature to 140°C"), then lets the real,
// unmodified prediction+alert pipeline react to it naturally on its next
// tick. Does not fake an alert directly.
//
// REDESIGN (see conversation):
//  1. Engine picker is now a row of live status cards (name + current
//     severity, polled from /api/fleet/status) instead of a plain
//     <select> -- you can see which engine is already flagged before
//     you even pick one.
//  2. Severity-in-σ slider removed entirely. Instead, each sensor has a
//     real numeric input for the EXACT value to inject, with the real
//     measured typical range (mean/min/max from the raw ziya07 CSV,
//     served by GET /api/inject/sensor-info) shown alongside it as
//     guidance -- not a guess.
//  3. The old 3 fault-type presets (bearing_wear / overheat /
//     mechanical_bind) are now just "fill with a realistic fault"
//     buttons: they populate the relevant sensors' number inputs with
//     mean ± 4σ (computed from the real stats above), which you can
//     then see and edit before injecting -- the exact number sent is
//     always visible, never hidden behind a multiplier.
import { useState, useEffect, useRef } from 'react';
import { injectAnomaly, fetchInjectSensorInfo, fetchFleetStatus } from '../services/api';

const SEV_COLOR = { NORMAL: '#22c55e', ANOMALY: '#ef4444' };

// Preset fault bundles -- which sensors they touch and which direction
// (+1 = push toward mean + 4σ, -1 = push toward mean - 4σ). The actual
// numbers are computed from real sensor-info once it loads, not hardcoded.
const PRESETS = [
  { key: 'bearing_wear',    label: 'Bearing wear',    sensors: [{ key: 'Vibration_X', dir: 1 }, { key: 'Vibration_Y', dir: 1 }, { key: 'Vibration_Z', dir: 1 }] },
  { key: 'overheat',        label: 'Overheat',        sensors: [{ key: 'Temperature_C', dir: 1 }, { key: 'Fuel_Efficiency', dir: -1 }] },
  { key: 'mechanical_bind', label: 'Mechanical bind', sensors: [{ key: 'Torque_Nm', dir: 1 }, { key: 'RPM', dir: -1 }] },
];
const PRESET_SIGMA = 4; // how many std devs a preset reaches for -- only used to pre-fill, always shown/editable after

export default function AnomalyInjector() {
  const [engines, setEngines]         = useState([]);   // live fleet status, for the card picker
  const [equipmentId, setEquipmentId] = useState(null);
  const [sensorInfo, setSensorInfo]   = useState([]);   // real mean/std/min/max per sensor
  const [infoError, setInfoError]     = useState(false);
  const [values, setValues]           = useState({});   // { Temperature_C: '140', ... } -- only checked sensors present
  const [status, setStatus]           = useState(null); // { ok, message }
  const [loading, setLoading]         = useState(false);
  const pollRef = useRef(null);

  // Live engine cards -- poll fleet status while this panel is open.
  useEffect(() => {
    const poll = () => {
      fetchFleetStatus()
        .then(res => {
          setEngines(res.trucks || []);
          setEquipmentId(prev => prev ?? (res.trucks?.[0]?.equipment_id ?? null));
        })
        .catch(() => {/* fleet not up yet -- keep last known cards */});
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  // Real per-sensor stats, once, to drive inputs + presets.
  useEffect(() => {
    fetchInjectSensorInfo()
      .then(res => setSensorInfo(res.sensors || []))
      .catch(() => setInfoError(true));
  }, []);

  const statsFor = key => sensorInfo.find(s => s.key === key);

  const toggleSensor = (key) => {
    setValues(prev => {
      const next = { ...prev };
      if (key in next) {
        delete next[key];
      } else {
        const s = statsFor(key);
        next[key] = s ? String(s.mean) : '';
      }
      return next;
    });
  };

  const setSensorValue = (key, val) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const applyPreset = (preset) => {
    setValues(prev => {
      const next = { ...prev };
      preset.sensors.forEach(({ key, dir }) => {
        const s = statsFor(key);
        if (!s) return;
        const raw = s.mean + dir * PRESET_SIGMA * s.std;
        next[key] = String(Math.round(raw * 10000) / 10000);
      });
      return next;
    });
    setStatus(null);
  };

  const handleInject = () => {
    const sensors = Object.entries(values)
      .filter(([, v]) => v !== '' && !isNaN(Number(v)))
      .map(([key, v]) => ({ key, value: Number(v) }));

    if (!equipmentId) {
      setStatus({ ok: false, message: 'No engine available yet -- wait for the simulator to come online.' });
      return;
    }
    if (sensors.length === 0) {
      setStatus({ ok: false, message: 'Pick at least one sensor and give it a value.' });
      return;
    }

    setLoading(true);
    setStatus(null);
    injectAnomaly({ equipment_id: equipmentId, sensors })
      .then(res => {
        setStatus({
          ok: true,
          message: `Set ${res.fields_changed.join(', ')} on ${res.equipment_id} — `
                  + `${res.readings_affected} buffered readings updated. `
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
        Sets exact values on a running engine's live sensor buffer. The next natural
        prediction tick will genuinely evaluate them — this does not fake an alert,
        it only sets input data honestly to whatever value you choose.
      </div>

      {/* Engine picker -- live status cards, not a plain dropdown */}
      <div className="inject-field" style={{ marginBottom: 14 }}>
        <span>Engine</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {engines.length === 0 && (
            <div className="model-sub">Waiting for live fleet status…</div>
          )}
          {engines.map(e => {
            const selected = e.equipment_id === equipmentId;
            const color = SEV_COLOR[e.severity] || '#94a3b8';
            return (
              <button
                key={e.equipment_id}
                onClick={() => setEquipmentId(e.equipment_id)}
                className="back-btn"
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                  padding: '8px 12px', minWidth: 120,
                  border: selected ? `2px solid ${color}` : '1px solid #334155',
                  background: selected ? 'rgba(96,165,250,0.10)' : 'transparent',
                }}
              >
                <span style={{ fontWeight: 600 }}>{e.name || e.equipment_id}</span>
                <span className="sev-badge" style={{ backgroundColor: color, fontSize: 11 }}>{e.severity}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fault presets -- fill in real computed values, still editable below */}
      <div className="inject-field" style={{ marginBottom: 14 }}>
        <span>Quick-fill a realistic fault ({PRESET_SIGMA}σ from real mean, then editable)</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {PRESETS.map(p => (
            <button key={p.key} className="back-btn" onClick={() => applyPreset(p)} disabled={sensorInfo.length === 0}>
              {p.label}
            </button>
          ))}
          {Object.keys(values).length > 0 && (
            <button className="back-btn" onClick={() => setValues({})}>Clear all</button>
          )}
        </div>
      </div>

      {/* Per-sensor value inputs, with real typical-range guidance */}
      {infoError && <div className="empty-state">Sensor info unavailable — is the backend running?</div>}
      {!infoError && (
        <div className="inject-field">
          <span>Sensor values to set</span>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8, marginTop: 6,
          }}>
            {sensorInfo.map(s => {
              const checked = s.key in values;
              return (
                <div key={s.key} style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '8px 10px', borderRadius: 6,
                  border: '1px solid #334155',
                  background: checked ? 'rgba(96,165,250,0.08)' : 'transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSensor(s.key)} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>{s.unit}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    typical {s.min}–{s.max} (avg {s.mean})
                  </div>
                  {checked && (
                    <input
                      type="number"
                      step="any"
                      value={values[s.key]}
                      onChange={e => setSensorValue(s.key, e.target.value)}
                      style={{ fontSize: 13, padding: '4px 6px' }}
                      placeholder={`e.g. ${s.mean}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button className="back-btn" onClick={handleInject} disabled={loading} style={{ marginTop: 14 }}>
        {loading ? 'Injecting…' : 'Inject Values'}
      </button>

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
