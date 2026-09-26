// src/components/AnomalyInjector.jsx
//
// Testing/demo tool: sets EXACT sensor values on a running engine's live
// buffer (e.g. "set Temperature to 140°C"), then lets the real,
// unmodified prediction+alert pipeline react to it naturally on its next
// tick. Does not fake an alert directly.
//
// STYLE PASS (see conversation):
//  - Moved off ad-hoc dark-theme inline styles (#334155 borders, neon
//    rgba(96,165,250,...) glows) onto the same light card system as the
//    rest of the app (FleetOverview / EngineSensorCard).
//  - SEV_COLOR now matches FleetOverview's muted sage/brick palette
//    instead of saturated green/red -- one status language app-wide.
//  - "back-btn" was being reused for three unrelated things (engine
//    picker, preset chips, the primary submit action). Split into
//    purpose-built classes: .engine-pick, .btn-util, .btn-inject.
import { useState, useEffect, useRef } from 'react';
import { injectAnomaly, fetchInjectSensorInfo, fetchFleetStatus } from '../services/api';
import { getComponentInfo } from '../utils/engineComponents';

const SEV_COLOR = { NORMAL: '#5f9b74', ANOMALY: '#b25c53' };

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
      setStatus({ ok: false, message: 'No engine available yet — wait for the simulator to come online.' });
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
    <div className="injector model-card">
      <div className="injector__header">
        <div className="detail-section-title">Manual Anomaly Injection</div>
        <span className="injector__tag">Testing / Demo</span>
      </div>
      <p className="injector__intro">
        Sets exact values on a running engine's live sensor buffer. The next natural
        prediction tick will genuinely evaluate them — this does not fake an alert,
        it only sets input data honestly to whatever value you choose.
      </p>

      {/* Engine picker -- live status cards, not a plain dropdown */}
      <div className="injector-section">
        <span className="injector-section__label">Engine</span>
        <div className="engine-pick-row">
          {engines.length === 0 && (
            <div className="injector__waiting">Waiting for live fleet status…</div>
          )}
          {engines.map(e => {
            const selected = e.equipment_id === equipmentId;
            const color = SEV_COLOR[e.severity] || '#9aa2ae';
            return (
              <button
                key={e.equipment_id}
                onClick={() => setEquipmentId(e.equipment_id)}
                className={`engine-pick${selected ? ' engine-pick--selected' : ''}`}
                style={selected ? { borderColor: color } : undefined}
              >
                <span className="engine-pick__name">{e.name || e.equipment_id}</span>
                <span className="sev-badge" style={{ backgroundColor: color }}>{e.severity}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fault presets -- fill in real computed values, still editable below */}
      <div className="injector-section">
        <span className="injector-section__label">
          Quick-fill a realistic fault <span className="injector-section__hint">({PRESET_SIGMA}σ from real mean, then editable)</span>
        </span>
        <div className="injector-preset-row">
          {PRESETS.map(p => (
            <button key={p.key} className="btn-util" onClick={() => applyPreset(p)} disabled={sensorInfo.length === 0}>
              {p.label}
            </button>
          ))}
          {Object.keys(values).length > 0 && (
            <button className="btn-util btn-util--muted" onClick={() => setValues({})}>Clear all</button>
          )}
        </div>
      </div>

      {/* Per-sensor value inputs, with real typical-range guidance */}
      {infoError && <div className="empty-state">Sensor info unavailable — is the backend running?</div>}
      {!infoError && (
        <div className="injector-section">
          <span className="injector-section__label">Sensor values to set</span>
          <div className="sensor-card-grid">
            {sensorInfo.map(s => {
              const checked = s.key in values;
              const comp = getComponentInfo(s.key);
              return (
                <div key={s.key} className={`sensor-card${checked ? ' sensor-card--active' : ''}`}>
                  <div className="sensor-card__row">
                    <input type="checkbox" checked={checked} onChange={() => toggleSensor(s.key)} />
                    <span className="sensor-card__label">{s.label}</span>
                    <span className="sensor-card__unit">{s.unit}</span>
                  </div>
                  {comp && (
                    <div className="sensor-card__component">{comp.component}</div>
                  )}
                  <div className="sensor-card__range">
                    typical {s.min}–{s.max} (avg {s.mean})
                  </div>
                  {checked && (
                    <input
                      type="number"
                      step="any"
                      value={values[s.key]}
                      onChange={e => setSensorValue(s.key, e.target.value)}
                      className="sensor-card__input"
                      placeholder={`e.g. ${s.mean}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button className="btn-inject" onClick={handleInject} disabled={loading}>
        {loading ? 'Injecting…' : 'Inject Values'}
      </button>

      {status && (
        <div className={`injector-status${status.ok ? ' injector-status--ok' : ' injector-status--error'}`}>
          {status.message}
        </div>
      )}
    </div>
  );
}