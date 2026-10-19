






import { useState, useEffect, useRef } from 'react';
import { injectAnomaly, fetchInjectSensorInfo, fetchFleetStatus, socket } from '../services/api';
import { getComponentInfo } from '../utils/engineComponents';
import { getSeverityColor } from '../constants/Severity';
import engineCardImg from '../assets/engine-card.webp';




const PRESETS = [
  { key: 'bearing_wear', label: 'Bearing wear', cause: 'Bearing fatigue or rotating-assembly imbalance', sensors: [{ key: 'Vibration_X', dir: 1 }, { key: 'Vibration_Y', dir: 1 }, { key: 'Vibration_Z', dir: 1 }] },
  { key: 'overheat', label: 'Overheat', cause: 'Cooling restriction, coolant loss or thermal overload', sensors: [{ key: 'Temperature_C', dir: 1 }, { key: 'Fuel_Efficiency_km_per_L', dir: -1 }] },
  { key: 'mechanical_bind', label: 'Mechanical bind', cause: 'Drivetrain load, seizure or torque-transfer resistance', sensors: [{ key: 'Torque_Nm', dir: 1 }, { key: 'RPM', dir: -1 }] },
  { key: 'fuel_injector', label: 'Fuel injector fault', cause: 'Poor atomisation, leaking injector or over-fuelling', sensors: [{ key: 'Fuel_Consumption_Lph', dir: 1 }, { key: 'Fuel_Efficiency_km_per_L', dir: -1 }, { key: 'Exhaust_Temp_C', dir: 1 }] },
  { key: 'oil_starvation', label: 'Oil pressure loss', cause: 'Low oil level, pump wear, blockage or bearing clearance', sensors: [{ key: 'Oil_Pressure_kPa', dir: -1 }, { key: 'Temperature_C', dir: 1 }, { key: 'Vibration_X', dir: 1 }] },
  { key: 'turbo_boost', label: 'Turbo / boost fault', cause: 'Turbocharger wear, intake leak or restricted air path', sensors: [{ key: 'Boost_Pressure_kPa', dir: -1 }, { key: 'Power_Output_kW', dir: -1 }, { key: 'Fuel_Consumption_Lph', dir: 1 }] },
  { key: 'cooling_loss', label: 'Cooling system fault', cause: 'Radiator restriction, fan/pump fault or coolant loss', sensors: [{ key: 'Temperature_C', dir: 1 }, { key: 'Exhaust_Temp_C', dir: 1 }, { key: 'Fuel_Consumption_Lph', dir: 1 }] },
  { key: 'load_resistance', label: 'Payload / resistance', cause: 'Overload, haul-road resistance or tyre/rolling condition', sensors: [{ key: 'total_resistance_pct', dir: 1 }, { key: 'payload_t', dir: 1 }, { key: 'speed_kmh', dir: -1 }] },
];
const PRESET_SIGMA = 4;

export default function AnomalyInjector() {
  const [engines, setEngines]         = useState([]);
  const [equipmentId, setEquipmentId] = useState(null);
  const [sensorInfo, setSensorInfo]   = useState([]);
  const [infoError, setInfoError]     = useState(false);
  const [values, setValues]           = useState({});
  const [status, setStatus]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const pollRef = useRef(null);
  const awaitingRef = useRef(null);


  useEffect(() => {
    const poll = () => {
      fetchFleetStatus()
        .then(res => {
          setEngines(res.trucks || []);
          setEquipmentId(prev => prev ?? (res.trucks?.[0]?.equipment_id ?? null));
        })
        .catch(() => {                                               });
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, []);



  useEffect(() => {
    const onPrediction = prediction => {
      const current = awaitingRef.current;
      if (!current || current.equipmentId !== prediction.equipment_id) return;
      const score = Number(prediction.anomaly_score);
      const scoreText = prediction.severity !== 'NORMAL' && Number.isFinite(score)
        ? ` Model anomaly score: ${Math.min(98, Math.max(4.9, score * 100)).toFixed(1)}%.` : '';
      setStatus({
        ok: true,
        message: prediction.severity === 'NORMAL'
          ? `The model evaluated ${current.fields.join(', ')} on ${current.equipmentId} and classified the current sensor window as NORMAL.${scoreText} No alert was generated. The detector evaluates a rolling window, so one extreme value does not guarantee an alert.`
          : `Alert generated for ${current.equipmentId} after evaluating ${current.fields.join(', ')}.${scoreText}`,
      });
      awaitingRef.current = null;
    };
    const onAlert = alert => {
      const current = awaitingRef.current;
      if (!current || current.equipmentId !== alert.equipment_id) return;
      setStatus({ ok: true, message: alert.message || `Alert generated for ${alert.equipment_id}.` });
      awaitingRef.current = null;
    };
    socket.on('prediction', onPrediction);
    socket.on('new_alert', onAlert);
    return () => {
      socket.off('prediction', onPrediction);
      socket.off('new_alert', onAlert);
    };
  }, []);


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
    awaitingRef.current = { equipmentId, fields: sensors.map(sensor => sensor.key) };
    injectAnomaly({ equipment_id: equipmentId, sensors })
      .then(res => {
        if (res.high_limit_alert) {
          awaitingRef.current = null;
          setStatus({ ok: true, message: res.high_limit_alert.message });
          return;
        }
        setStatus({
          ok: true,
          pending: true,
          message: `Applied ${res.fields_changed.join(', ')} to ${res.equipment_id} (${res.readings_affected} buffered readings). Waiting for the next model evaluation…`,
        });
        const pending = { equipmentId: res.equipment_id, fields: res.fields_changed };
        awaitingRef.current = pending;
      })
      .catch(err => {
        awaitingRef.current = null;
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
      <p className="injector__intro">
        The detector evaluates statistics across a rolling window. A sensor value
        outside its typical range can still be classified as normal; combined or
        sustained changes may be needed. The ranges below describe the dataset,
        not guaranteed alert thresholds.
      </p>

      {                                                              }
      <div className="injector-section">
        <span className="injector-section__label">Engine</span>
        <div className="engine-pick-row">
          {engines.length === 0 && (
            <div className="injector__waiting">Waiting for live fleet status…</div>
          )}
          {engines.map(e => {
            const selected = e.equipment_id === equipmentId;
            const displaySeverity = e.severity === 'TAKE_NOTE' ? 'TAKE NOTE'
              : ['WARNING', 'ANOMALY'].includes(e.severity) ? 'CRITICAL' : e.severity;
            const color = getSeverityColor(displaySeverity);
            return (
              <button
                key={e.equipment_id}
                onClick={() => setEquipmentId(e.equipment_id)}
                className={`engine-pick${selected ? ' engine-pick--selected' : ''}`}
              >
                <div className="engine-pick__art">
                  <img className="engine-pick__photo" src={engineCardImg} alt={e.name || e.equipment_id} />
                </div>
                <div className="engine-pick__meta">
                  <span className="engine-pick__name">{e.name || e.equipment_id}</span>
                  <span className="sev-badge" data-sev={displaySeverity} style={{ color }}>{displaySeverity}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {                                                                         }
      <div className="injector-section">
        <span className="injector-section__label">
          Quick-fill a realistic fault <span className="injector-section__hint">({PRESET_SIGMA}σ from real mean, then editable)</span>
        </span>
        <div className="injector-preset-row">
              {PRESETS.map(p => (
            <button key={p.key} title={p.cause} className="btn-util" onClick={() => applyPreset(p)} disabled={sensorInfo.length === 0}>
              {p.label}
            </button>
          ))}
          {Object.keys(values).length > 0 && (
            <button className="btn-util btn-util--muted" onClick={() => setValues({})}>Clear all</button>
          )}
        </div>
      </div>

      {                                                               }
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
                    <>
                      <input
                        type="number"
                        step="any"
                        value={values[s.key]}
                        onChange={e => setSensorValue(s.key, e.target.value)}
                        className="sensor-card__input"
                        placeholder={`e.g. ${s.mean}`}
                      />
                      {Number.isFinite(Number(values[s.key])) && s.std > 0 && (
                        <div className="injector-deviation">
                          {((Number(values[s.key]) - s.mean) / s.std).toFixed(1)} standard deviations from average
                        </div>
                      )}
                    </>
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
        <div className={`injector-status${status.pending ? ' injector-status--pending' : status.ok ? ' injector-status--ok' : ' injector-status--error'}`}>
          {status.message}
        </div>
      )}
    </div>
  );
}
