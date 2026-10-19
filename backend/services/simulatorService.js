







const fs          = require('fs');
const csv         = require('csv-parser');
const axios       = require('axios');
const { createAlert } = require('./alertService');
const database = require('./databaseService');



const ENGINE_COUNT = 21;
const SIMULATOR_SPLIT = (process.env.SIMULATOR_SPLIT || 'all').toLowerCase();
let ENGINES = [];

const WINDOW_SIZE    = 30;
const EMIT_INTERVAL  = 1500;




const HIGH_LIMITS = {
  Temperature_C: 250, RPM: 3000,
  Vibration_X: 10, Vibration_Y: 10, Vibration_Z: 10,
  Torque_Nm: 20000, Fuel_Efficiency_km_per_L: 10,
  Power_Output_kW: 4000, Exhaust_Temp_C: 1000,
  Fuel_Consumption_Lph: 500, Oil_Pressure_kPa: 2000,
  Boost_Pressure_kPa: 500, payload_t: 500, speed_kmh: 100,
  total_resistance_pct: 100, ambient_C: 80,
};
const LOW_LIMITS = { Temperature_C: -50, RPM: 0, Vibration_X: -10, Vibration_Y: -10,
  Vibration_Z: -10, Torque_Nm: 0, Fuel_Efficiency_km_per_L: 0,
  Power_Output_kW: 0, Exhaust_Temp_C: 0, Fuel_Consumption_Lph: 0,
  Oil_Pressure_kPa: -500, Boost_Pressure_kPa: -100, payload_t: 0,
  speed_kmh: 0, total_resistance_pct: 0, ambient_C: -50 };

function getHighLimitBreaches(reading) {
  return Object.entries(HIGH_LIMITS)
    .filter(([key, high]) => Number.isFinite(Number(reading[key]))
      && (Number(reading[key]) > high || (LOW_LIMITS[key] !== undefined && Number(reading[key]) < LOW_LIMITS[key])))
    .map(([key, limit]) => ({ key, limit, min: LOW_LIMITS[key], value: Number(reading[key]) }));
}

function createHighLimitAlert(engine, reading, io) {
  const breaches = getHighLimitBreaches(reading);
  const state = engineState[engine.id];
  if (breaches.length === 0) {
    if (state) {
      state.highLimitAlertSignature = null;
      state.highLimitAlert = null;
    }
    return null;
  }

  const details = breaches.map(({ key, limit, min, value }) =>
    `${key} ${value} is outside ${min === undefined ? 'no lower bound' : min} to ${limit}`);
  const signature = breaches.map(({ key, value }) => `${key}:${value}`).join('|');
  if (state?.highLimitAlertSignature === signature) return state.highLimitAlert || null;
  if (state) state.highLimitAlertSignature = signature;
  const alert = createAlert({
    equipment_id: engine.id,
    severity: 'CRITICAL',
    anomaly_score: 0.98,
    message: `Sensor safety bound exceeded: ${details.join('; ')}.`,
    feature_snapshot: Object.fromEntries(breaches.map(({ key, value }) => [key, value])),
    top_anomalous_features: details,
  });
  if (state) state.highLimitAlert = alert;
  if (fleetStatus[engine.id]) {
    fleetStatus[engine.id] = {
      ...fleetStatus[engine.id],
      severity: 'CRITICAL',
      anomaly_score: 0.98,
      message: alert.message,
      last_reading: reading,
      feature_snapshot: alert.feature_snapshot,
      top_features: details,
    };
  }
  if (io) io.emit(alert.is_duplicate ? 'alert_updated' : 'new_alert', alert);
  return alert;
}


const engineState = {};


const fleetStatus = {};

function registerEngine(engine) {
  ENGINES.push(engine);
  engineState[engine.id] = {
    buffer: [], cursor: 0, latestResult: null, readingCount: 0, info: engine,
    emittedEventIds: new Set(),
  };
  fleetStatus[engine.id] = {
    equipment_id: engine.id, name: engine.name,
    label_number: engine.label_number,
    source_engine_id: engine.source_engine_id,
    severity: 'NORMAL', anomaly_score: null,
    message: 'Awaiting first reading...', last_reading: null, reading_count: 0,
  };
}




function mapReading(row) {
  return {
    Temperature_C: Number(row.Temperature_C).toFixed(2),
    RPM: Number(row.RPM).toFixed(1),
    Vibration_X: Number(row.Vibration_X).toFixed(3),
    Vibration_Y: Number(row.Vibration_Y).toFixed(3),
    Vibration_Z: Number(row.Vibration_Z).toFixed(3),
    Torque_Nm: Number(row.Torque_Nm).toFixed(2),
    Power_Output_kW: Number(row.Power_Output_kW).toFixed(2),
    Operational_Mode: row.haul_phase,
    timestamp: new Date().toISOString(), recorded_at: new Date().toISOString(),
    source_engine_id: Number(row.engine_id), source_record: Number(row.record),
    source_timestamp: row.timestamp, haul_phase: row.haul_phase,
    payload_t: Number(row.payload_t), speed_kmh: Number(row.speed_kmh),
    total_resistance_pct: Number(row.total_resistance_pct), ambient_C: Number(row.ambient_C),
    Exhaust_Temp_C: Number(row.Exhaust_Temp_C), Fuel_Consumption_Lph: Number(row.Fuel_Consumption_Lph),
    Fuel_Efficiency_km_per_L: Number(row.Fuel_Efficiency_km_per_L),
    Oil_Pressure_kPa: Number(row.Oil_Pressure_kPa), Boost_Pressure_kPa: Number(row.Boost_Pressure_kPa),
    is_anomaly: Number(row.is_anomaly) === 1, anomaly_type: row.anomaly_type,
    anomaly_severity: Number(row.anomaly_severity), event_id: Number(row.event_id),
    context_tag: row.context_tag, split: row.split,
  };
}

function isSyntheticAnomalyDataset(rows) {
  return rows.length > 0 && Object.hasOwn(rows[0], 'engine_id')
    && Object.hasOwn(rows[0], 'is_anomaly') && Object.hasOwn(rows[0], 'event_id');
}

function prepareReplay(rows) {
  if (!isSyntheticAnomalyDataset(rows)) {
    throw new Error('Expected synthetic_anomaly_records.csv with engine_id, is_anomaly and event_id columns.');
  }

  const byId = new Map();
  for (const row of rows) {
    const sourceId = String(row.engine_id || '').trim();
    const record = Number(row.record);
    if (!sourceId || !Number.isFinite(record) || !Number.isFinite(Date.parse(row.timestamp))) continue;
    if (!byId.has(sourceId)) byId.set(sourceId, { records: new Map(), timestamps: new Set() });
    const engineRows = byId.get(sourceId);

    if (!engineRows.timestamps.has(row.timestamp)) {
      engineRows.timestamps.add(row.timestamp);
      engineRows.records.set(record, row);
    }
  }
  const sourceIds = [...byId.keys()].sort((a, b) => Number(a) - Number(b));
  const selectedIds = sourceIds.slice(0, ENGINE_COUNT);
  for (const [index, sourceId] of selectedIds.entries()) {
    const labelNumber = index + 1;
    const engine = {
      id: `ENGINE-${sourceId}`,
      name: `Engine ${labelNumber}`,
      label_number: labelNumber,
      source_engine_id: Number(sourceId),
    };
    registerEngine(engine);
    engineState[engine.id].rows = [...byId.get(sourceId).records.values()]
      .sort((a, b) => Number(a.record) - Number(b.record));
  }
  console.log(`[Simulator] Registered ${selectedIds.length} independent source engines.`);
  return ENGINES;
}


async function callPredictor(engineId, buffer, flaskUrl) {
  try {
    const response = await axios.post(`${flaskUrl}/predict`, {
      equipment_id: engineId,
      readings:     buffer,
    }, { timeout: 5000 });
    return response.data;
  } catch (err) {
    console.warn(`[Simulator] Flask call failed for ${engineId}: ${err.message}`);
    return null;
  }
}


function startSimulator({ io, flaskUrl, dataPath }) {
  console.log(`[Simulator] Starting — data: ${dataPath}`);

  const allRows = [];
  const selectedSourceIds = new Set();
  let syntheticRows = false;
  if (!fs.existsSync(dataPath)) {
    console.error(`[Simulator] Data file not found: ${dataPath}`);
    return;
  }

  fs.createReadStream(dataPath)
    .pipe(csv())
    .on('data', row => {
      if (Object.hasOwn(row, 'engine_id') && Object.hasOwn(row, 'is_anomaly')) {
        syntheticRows = true;
        if (SIMULATOR_SPLIT !== 'all' && row.split
          && String(row.split).toLowerCase() !== SIMULATOR_SPLIT) return;
        const sourceId = String(row.engine_id || '').trim();
        if (!sourceId) return;
        if (!selectedSourceIds.has(sourceId) && selectedSourceIds.size >= ENGINE_COUNT) return;
        selectedSourceIds.add(sourceId);
      }
      allRows.push(row);
    })
    .on('end', () => {
      if (!syntheticRows) {
        console.error('[Simulator] Refusing to replay a dataset without engine IDs and anomaly labels. Configure synthetic_anomaly_records.csv.');
        return;
      }
      console.log(`[Simulator] Loaded ${allRows.length} replay rows for ${selectedSourceIds.size} ${SIMULATOR_SPLIT} source engines (cap ${ENGINE_COUNT}).`);
      try { replayRows(allRows, io, flaskUrl); }
      catch (err) { console.error(`[Simulator] Could not prepare synthetic replay: ${err.message}`); }
    })
    .on('error', err => console.error(`[Simulator] Could not read ${dataPath}: ${err.message}`));
}

function replayRows(rows, io, flaskUrl) {
  ENGINES = [];
  Object.keys(engineState).forEach(id => delete engineState[id]);
  Object.keys(fleetStatus).forEach(id => delete fleetStatus[id]);
  const engines = prepareReplay(rows);
  if (!engines.length) {
    console.error('[Simulator] No valid engine rows found in replay dataset.');
    return;
  }

  const tick = async () => {
    for (const engine of engines) {
      const state = engineState[engine.id];
      if (state.cursor === 0 && state.readingCount > 0) {
        state.buffer = [];
        state.emittedEventIds.clear();
      }
      const loopTimestamp = new Date().toISOString();
      const reading = mapReading(state.rows[state.cursor]);
      reading.timestamp = loopTimestamp;
      reading.recorded_at = loopTimestamp;
      state.cursor = (state.cursor + 1) % state.rows.length;

      state.buffer.push(reading);
      if (state.pendingInjectedReadings > 0) {
        for (const { key, value } of state.injectionTargets) {
          reading[key] = value.toFixed(SENSOR_DECIMALS[key]);
        }
        state.pendingInjectedReadings--;
        if (state.pendingInjectedReadings === 0) state.injectionTargets = [];
      }
      state.readingCount++;

      if (database.isDatabaseEnabled()) {
        database.saveReading(engine.id, engine.name, reading, engine.source_engine_id)
          .catch(err => console.error('[Database] Could not persist reading:', err.message));
      }

      io.emit('sensor_reading', {
        equipment_id: engine.id,
        name:         engine.name,
        source_engine_id: engine.source_engine_id,
        reading,
        buffer_size:  state.buffer.length,
      });

      createHighLimitAlert(engine, reading, io);

      if (state.buffer.length >= WINDOW_SIZE) {
        const result = await callPredictor(engine.id, state.buffer, flaskUrl);

        if (result) {
          state.latestResult = result;

          const highBreaches = getHighLimitBreaches(reading);
          const reportedModelScore = result.anomaly_score == null
            ? NaN : Number(result.anomaly_score);
          const modelDetected = result.is_anomalous === true
            || ['TAKE_NOTE', 'CRITICAL', 'WARNING', 'ANOMALY'].includes(result.severity)
            || (Number.isFinite(reportedModelScore) && reportedModelScore >= 0.5);
          const modelScore = modelDetected
            ? Math.min(0.98, Math.max(Number.isFinite(reportedModelScore) ? reportedModelScore : 0, 0.1))
            : Number.isFinite(reportedModelScore)
              ? Math.min(0.98, Math.max(reportedModelScore, 0.001)) : null;
          const effectiveScore = highBreaches.length ? 0.98 : modelScore;
          const effectiveSeverity = highBreaches.length
            ? 'CRITICAL'
            : !modelDetected ? 'NORMAL' : effectiveScore >= 0.75 ? 'CRITICAL' : 'TAKE_NOTE';
          const effectiveMessage = highBreaches.length
            ? `Sensor safety bound exceeded: ${highBreaches.map(({ key, limit, min, value }) => `${key} ${value} is outside ${min === undefined ? 'no lower bound' : min} to ${limit}`).join('; ')}.`
            : result.message;

          if (database.isDatabaseEnabled()) {
            database.savePrediction(engine.id, engine.name, {
              ...result,
              severity: effectiveSeverity,
              anomaly_score: effectiveScore,
              message: effectiveMessage,
            }, engine.source_engine_id)
              .catch(err => console.error('[Database] Could not persist prediction:', err.message));
          }

          fleetStatus[engine.id] = {
            ...fleetStatus[engine.id],
            source_engine_id: engine.source_engine_id,
            severity:      effectiveSeverity,
            anomaly_score: effectiveScore,
            message:       effectiveMessage,
            last_reading:  reading,
            reading_count: state.readingCount,
            top_features:  result.top_anomalous_features,
            feature_snapshot: result.feature_snapshot,
          };


          if (modelDetected && !highBreaches.length) {
            const alert = createAlert({
              equipment_id:     engine.id,
              severity:         effectiveSeverity,
              anomaly_score:    effectiveScore,
              message:          effectiveMessage,
              feature_snapshot: result.feature_snapshot,
              top_anomalous_features: result.top_anomalous_features,
            });

            io.emit(alert.is_duplicate ? 'alert_updated' : 'new_alert', alert);
          }

          io.emit('prediction', {
            equipment_id:     engine.id,
            name:             engine.name,
            ...result,
            severity:         effectiveSeverity,
            anomaly_score:    effectiveScore,
            message:          effectiveMessage,
            reading_count:    state.readingCount,
            ground_truth_anomaly: reading.is_anomaly,
            source_event_type: reading.anomaly_type,
            source_split: reading.split,
          });

          const scoreLabel = Number.isFinite(effectiveScore)
            ? effectiveScore.toFixed(5) : 'not-applicable';
          const scoreName = effectiveSeverity === 'NORMAL' ? 'score' : 'anomaly_score';
          console.log(`[${engine.id}] ${effectiveSeverity} | ${scoreName}=${scoreLabel}`);
        }

        state.buffer.shift();
      }
    }

    setTimeout(tick, EMIT_INTERVAL);
  };

  tick();
  console.log(`[Simulator] Running — emitting every ${EMIT_INTERVAL}ms`);
}

function getFleetStatus() { return fleetStatus; }
function getTruckStatus(id) { return fleetStatus[id] || null; }













const SENSOR_STATS = {
  payload_t: { label: 'Payload', unit: 't', mean: 61.058, std: 97.947, min: 0, max: 270 },
  speed_kmh: { label: 'Speed', unit: 'km/h', mean: 13.838, std: 14.411, min: 0, max: 42.75 },
  total_resistance_pct: { label: 'Resistance', unit: '%', mean: 5.335, std: 3.625, min: 2, max: 21.14 },
  ambient_C: { label: 'Ambient temperature', unit: '°C', mean: 24.162, std: 5.071, min: 15.4, max: 38.3 },
  Temperature_C: { label: 'Engine temperature', unit: '°C', mean: 93.919, std: 3.32, min: 17.8, max: 178.6 },
  Exhaust_Temp_C: { label: 'Exhaust temperature', unit: '°C', mean: 480.423, std: 29.405, min: 397.1, max: 632.5 },
  RPM: { label: 'Engine RPM', unit: 'rpm', mean: 1256.085, std: 396.231, min: 690.1, max: 1779.5 },
  Torque_Nm: { label: 'Torque', unit: 'Nm', mean: 3685.603, std: 2544.899, min: 1327.7, max: 8422.8 },
  Power_Output_kW: { label: 'Power output', unit: 'kW', mean: 566.74, std: 529.884, min: 88.7, max: 1541.9 },
  Fuel_Consumption_Lph: { label: 'Fuel consumption', unit: 'L/h', mean: 60.562, std: 61.565, min: 13.1, max: 205.7 },
  Fuel_Efficiency_km_per_L: { label: 'Fuel efficiency', unit: 'km/L', mean: 0.405, std: 0.557, min: 0, max: 1.868 },
  Oil_Pressure_kPa: { label: 'Oil pressure', unit: 'kPa', mean: 432.002, std: 15.536, min: 278.1, max: 473 },
  Boost_Pressure_kPa: { label: 'Boost pressure', unit: 'kPa', mean: 106.074, std: 73.753, min: -4.9, max: 231.9 },
  Vibration_X: { label: 'Vibration X', unit: '', mean: 1.047, std: 0.214, min: 0.604, max: 2.185 },
  Vibration_Y: { label: 'Vibration Y', unit: '', mean: 0.89, std: 0.182, min: 0.499, max: 1.891 },
  Vibration_Z: { label: 'Vibration Z', unit: '', mean: 1.204, std: 0.246, min: 0.681, max: 2.527 },
};


const SENSOR_DECIMALS = {
  payload_t: 1, speed_kmh: 1, total_resistance_pct: 2, ambient_C: 1,
  Temperature_C: 2, Exhaust_Temp_C: 1, RPM: 1, Torque_Nm: 1,
  Power_Output_kW: 1, Fuel_Consumption_Lph: 1, Fuel_Efficiency_km_per_L: 3,
  Oil_Pressure_kPa: 1, Boost_Pressure_kPa: 1,
  Vibration_X: 3, Vibration_Y: 3, Vibration_Z: 3,
};

function getSensorInfo() {
  return Object.entries(SENSOR_STATS).map(([key, s]) => ({
    key,
    ...s,
    high_limit: HIGH_LIMITS[key],
  }));
}




function injectAnomaly({ equipment_id, sensors, io }) {
  const state = engineState[equipment_id];
  if (!state) throw new Error(`Unknown engine: ${equipment_id}`);
  if (state.buffer.length === 0) throw new Error(`${equipment_id}'s buffer is empty -- wait for the simulator to warm up`);
  if (!Array.isArray(sensors) || sensors.length === 0) {
    throw new Error(`sensors[] is required and must be non-empty, e.g. [{ "key": "Temperature_C", "value": 140 }]`);
  }

  const targets = sensors.map(s => {
    const key = s.key;
    if (!SENSOR_STATS[key]) throw new Error(`Unknown or non-injectable sensor: ${key} (expected one of ${Object.keys(SENSOR_STATS).join(', ')})`);
    const value = Number(s.value);
    if (!Number.isFinite(value)) throw new Error(`Value for ${key} must be a finite number, got: ${s.value}`);
    return { key, value };
  });

  state.buffer = state.buffer.map(reading => {
    const r = { ...reading };
    targets.forEach(({ key, value }) => {
      r[key] = value.toFixed(SENSOR_DECIMALS[key]);
    });
    return r;
  });




  const latestReading = state.buffer[state.buffer.length - 1];
  const highLimitAlert = createHighLimitAlert(state.info, latestReading, io);
  state.injectionTargets = targets;
  state.pendingInjectedReadings = Math.max(state.pendingInjectedReadings || 0, WINDOW_SIZE);

  const fieldsChanged = targets.map(t => t.key);

  console.log(`[Inject] ${equipment_id} <- set [${targets.map(t => `${t.key}=${t.value}`).join(', ')}]`
            + ' (next tick will reflect this)');
  return {
    equipment_id,
    sensors_applied: targets,
    buffer_size: state.buffer.length,
    readings_affected: state.buffer.length,
    fields_changed: fieldsChanged,
    high_limit_alert: highLimitAlert,
  };
}

module.exports = { startSimulator, getFleetStatus, getTruckStatus, injectAnomaly, getSensorInfo };
