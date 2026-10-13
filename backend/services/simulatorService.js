/**
 * simulatorService.js
 * Replays the ziya07 CSV as a live multi-engine sensor stream.
 * Maintains a rolling 30-reading buffer per engine.
 * When buffer is full, calls Flask /predict and broadcasts result.
 *
 */

const fs          = require('fs');
const csv         = require('csv-parser');
const axios       = require('axios');
const { createAlert } = require('./alertService');
const database = require('./databaseService');

// ── Engine config ──────────────────────────────────────────────────────────
// Bound the default replay workload. Raise ENGINE_COUNT (up to 100) to run
// more source engines after checking the host/database capacity.
const ENGINE_COUNT = Math.min(100, Math.max(1, Number.parseInt(process.env.ENGINE_COUNT, 10) || 20));
let ENGINES = [];
let usesSourceLabels = false;

const WINDOW_SIZE    = 30;   // readings per prediction window
const EMIT_INTERVAL  = 1500; // ms between readings (1.5s = fast demo)

// Independent high-side safety limits. Low values remain the ML model's
// responsibility; these limits catch an over-range sensor even when the
// window-level anomaly model does not flag it.
const HIGH_LIMITS = {
  Temperature_C: 120,
  RPM: 4000,
  Vibration_X: 1,
  Vibration_Y: 1,
  Vibration_Z: 1,
  Torque_Nm: 200,
  Fuel_Efficiency: 30,
  Power_Output_kW: 100,
};

function getHighLimitBreaches(reading) {
  return Object.entries(HIGH_LIMITS)
    .filter(([key, limit]) => Number.isFinite(Number(reading[key])) && Number(reading[key]) > limit)
    .map(([key, limit]) => ({ key, limit, value: Number(reading[key]) }));
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

  const details = breaches.map(({ key, limit, value }) => `${key} ${value} exceeds ${limit}`);
  const signature = breaches.map(({ key, value }) => `${key}:${value}`).join('|');
  if (state?.highLimitAlertSignature === signature) return state.highLimitAlert || null;
  if (state) state.highLimitAlertSignature = signature;
  const alert = createAlert({
    equipment_id: engine.id,
    severity: 'ANOMALY',
    anomaly_score: 1,
    message: `High sensor limit exceeded: ${details.join('; ')}.`,
    feature_snapshot: Object.fromEntries(breaches.map(({ key, value }) => [key, value])),
    top_anomalous_features: details,
  });
  if (state) state.highLimitAlert = alert;
  if (fleetStatus[engine.id]) {
    fleetStatus[engine.id] = {
      ...fleetStatus[engine.id],
      severity: 'ANOMALY',
      anomaly_score: 1,
      message: alert.message,
      last_reading: reading,
      feature_snapshot: alert.feature_snapshot,
      top_features: details,
    };
  }
  if (io) io.emit('new_alert', alert);
  return alert;
}

// Per-engine state
const engineState = {};

// Shared in-memory fleet status for REST endpoint
const fleetStatus = {};

function registerEngine(engine) {
  ENGINES.push(engine);
  engineState[engine.id] = {
    buffer: [], cursor: 0, latestResult: null, readingCount: 0, info: engine,
    emittedEventIds: new Set(),
  };
  fleetStatus[engine.id] = {
    equipment_id: engine.id, name: engine.name,
    source_engine_id: engine.source_engine_id,
    severity: 'NORMAL', anomaly_score: 0,
    message: 'Awaiting first reading...', last_reading: null, reading_count: 0,
  };
}

// ── Map ziya07 columns to display-friendly sensor names ──────────────────────
// No per-engine factor here anymore -- each engine's realism now comes from
  // which source rows belong to its source engine ID, not an invented scale.
function mapReading(row) {
  if (usesSourceLabels) {
    return {
      Temperature_C: Number(row.Temperature_C).toFixed(2),
      RPM: Number(row.RPM).toFixed(1),
      Fuel_Efficiency: Number(row.Fuel_Efficiency_km_per_L).toFixed(3),
      Vibration_X: Number(row.Vibration_X).toFixed(3),
      Vibration_Y: Number(row.Vibration_Y).toFixed(3),
      Vibration_Z: Number(row.Vibration_Z).toFixed(3),
      Torque_Nm: Number(row.Torque_Nm).toFixed(2),
      Power_Output_kW: Number(row.Power_Output_kW).toFixed(2),
      Fault_Condition: Number(row.is_anomaly) || 0,
      Operational_Mode: row.haul_phase,
      timestamp: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
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
  return {
    Temperature_C:    parseFloat(row['Temperature (°C)']).toFixed(2),
    RPM:              parseFloat(row['RPM']).toFixed(0),
    Fuel_Efficiency:  parseFloat(row['Fuel_Efficiency']).toFixed(2),
    Vibration_X:      parseFloat(row['Vibration_X']).toFixed(4),
    Vibration_Y:      parseFloat(row['Vibration_Y']).toFixed(4),
    Vibration_Z:      parseFloat(row['Vibration_Z']).toFixed(4),
    Torque_Nm:        parseFloat(row['Torque']).toFixed(2),
    Power_Output_kW:  parseFloat(row['Power_Output (kW)']).toFixed(2),
    Fault_Condition:  parseInt(row['Fault_Condition']),
    Operational_Mode: row['Operational_Mode'],
    timestamp:        new Date().toISOString(),
  };
}

function isSyntheticAnomalyDataset(rows) {
  return rows.length > 0 && Object.hasOwn(rows[0], 'engine_id')
    && Object.hasOwn(rows[0], 'is_anomaly') && Object.hasOwn(rows[0], 'event_id');
}

function prepareReplay(rows) {
  usesSourceLabels = isSyntheticAnomalyDataset(rows);
  if (!usesSourceLabels) {
    const engineCount = Math.min(ENGINE_COUNT, rows.length);
    const engines = Array.from({ length: engineCount }, (_, i) => ({
      id: `ENGINE-${i + 1}`, name: `Engine ${i + 1}`, source_engine_id: null,
    }));
    engines.forEach(registerEngine);
    const segLen = Math.floor(rows.length / engines.length);
    engines.forEach((engine, i) => {
      const start = i * segLen;
      const end = i === engines.length - 1 ? rows.length : start + segLen;
      engineState[engine.id].rows = rows.slice(start, end);
    });
    return engines;
  }

  const byId = new Map();
  for (const row of rows) {
    const sourceId = String(row.engine_id || '').trim();
    const record = Number(row.record);
    if (!sourceId || !Number.isFinite(record) || !Number.isFinite(Date.parse(row.timestamp))) continue;
    if (!byId.has(sourceId)) byId.set(sourceId, { records: new Map(), timestamps: new Set() });
    const engineRows = byId.get(sourceId);
    // Ignore repeated source timestamps for one engine.
    if (!engineRows.timestamps.has(row.timestamp)) {
      engineRows.timestamps.add(row.timestamp);
      engineRows.records.set(record, row);
    }
  }
  const sourceIds = [...byId.keys()].sort((a, b) => Number(a) - Number(b));
  const selectedIds = sourceIds.slice(0, ENGINE_COUNT);
  for (const sourceId of selectedIds) {
    const engine = { id: `ENGINE-${sourceId}`, name: `Engine ${sourceId}`, source_engine_id: Number(sourceId) };
    registerEngine(engine);
    engineState[engine.id].rows = [...byId.get(sourceId).records.values()]
      .sort((a, b) => Number(a.record) - Number(b.record));
  }
  console.log(`[Simulator] Registered ${selectedIds.length} independent source engines.`);
  return ENGINES;
}

function createSourceEventAlert(engine, reading, io) {
  if (!reading.is_anomaly || reading.event_id < 0) return null;
  const state = engineState[engine.id];
  const eventKey = `${reading.event_id}:${reading.anomaly_type}`;
  if (state.emittedEventIds.has(eventKey)) return null;
  state.emittedEventIds.add(eventKey);
  const label = reading.anomaly_type || 'labelled anomaly';
  const alert = createAlert({
    equipment_id: engine.id, severity: 'ANOMALY',
    anomaly_score: Number(reading.anomaly_severity) || 1,
    message: `Synthetic dataset event: ${label} (event ${reading.event_id}).`,
    feature_snapshot: {
      source_engine_id: reading.source_engine_id, source_record: reading.source_record,
      source_timestamp: reading.source_timestamp, anomaly_type: label,
      anomaly_severity: reading.anomaly_severity,
    },
    top_anomalous_features: [label, `severity ${reading.anomaly_severity}`],
  });
  fleetStatus[engine.id] = {
    ...fleetStatus[engine.id], severity: 'ANOMALY',
    anomaly_score: Number(reading.anomaly_severity) || 1,
    message: alert.message, last_reading: reading, reading_count: state.readingCount,
  };
  io.emit('new_alert', alert);
  return alert;
}

// ── Call Flask predictor ──────────────────────────────────────────────────────
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

// ── Main simulator ────────────────────────────────────────────────────────────
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
        const sourceId = String(row.engine_id || '').trim();
        if (!sourceId) return;
        if (!selectedSourceIds.has(sourceId) && selectedSourceIds.size >= ENGINE_COUNT) return;
        selectedSourceIds.add(sourceId);
      }
      allRows.push(row);
    })
    .on('end', () => {
      console.log(`[Simulator] Loaded ${allRows.length} replay rows${syntheticRows ? ` for ${selectedSourceIds.size} source engines (cap ${ENGINE_COUNT})` : ''}.`);
      replayRows(allRows, io, flaskUrl);
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

      if (usesSourceLabels) createSourceEventAlert(engine, reading, io);
      else createHighLimitAlert(engine, reading, io);
      if (usesSourceLabels && !reading.is_anomaly) {
        fleetStatus[engine.id] = {
          ...fleetStatus[engine.id],
          severity: 'NORMAL', anomaly_score: 0,
          message: 'No labelled anomaly in the current source reading.',
          last_reading: reading, reading_count: state.readingCount,
        };
      }

      if (!usesSourceLabels && state.buffer.length >= WINDOW_SIZE) {
        const result = await callPredictor(engine.id, state.buffer, flaskUrl);

        if (result) {
          state.latestResult = result;

          const highBreaches = getHighLimitBreaches(reading);
          const effectiveSeverity = highBreaches.length ? 'ANOMALY' : result.severity;
          const effectiveMessage = highBreaches.length
            ? `High sensor limit exceeded: ${highBreaches.map(({ key, limit, value }) => `${key} ${value} exceeds ${limit}`).join('; ')}.`
            : result.message;

          if (database.isDatabaseEnabled()) {
            database.savePrediction(engine.id, engine.name, result, engine.source_engine_id)
              .catch(err => console.error('[Database] Could not persist prediction:', err.message));
          }

          fleetStatus[engine.id] = {
            ...fleetStatus[engine.id],
            source_engine_id: engine.source_engine_id,
            severity:      effectiveSeverity,
            anomaly_score: highBreaches.length ? 1 : result.anomaly_score,
            message:       effectiveMessage,
            last_reading:  reading,
            reading_count: state.readingCount,
            top_features:  result.top_anomalous_features,
            feature_snapshot: result.feature_snapshot,
          };

          // FIX: severity is now 'NORMAL' or 'ANOMALY' only.
          if (result.severity !== 'NORMAL' && !highBreaches.length) {
            const alert = createAlert({
              equipment_id:     engine.id,
              severity:         result.severity,
              anomaly_score:    result.anomaly_score,
              message:          result.message,
              feature_snapshot: result.feature_snapshot,
              top_anomalous_features: result.top_anomalous_features,
            });

            io.emit('new_alert', alert);
          }

          io.emit('prediction', {
            equipment_id:     engine.id,
            name:             engine.name,
            ...result,
            severity:         effectiveSeverity,
            anomaly_score:    highBreaches.length ? 1 : result.anomaly_score,
            message:          effectiveMessage,
            reading_count:    state.readingCount,
          });

          console.log(`[${engine.id}] ${result.severity} | `
                    + `score=${result.anomaly_score.toFixed(3)}`);
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

// ── Live anomaly injection (for manual demo/testing) ─────────────────────────
// Mutates a running engine's live buffer in place with ACTUAL target sensor
// values (e.g. "set Temperature to 140") instead of an abstract severity
// multiplier -- the caller sees and chooses the exact number that goes into
// the buffer, not a sigma scale. The next natural tick's /predict call will
// see the corrupted buffer and (if the values are anomalous enough) flag it
// through the normal, unmodified alert pipeline -- nothing about
// createAlert() or the Socket.io emit path changes.
//
// SENSOR_STATS below are the REAL mean/std/min/max measured directly from
// the raw ziya07 CSV (data/raw/engine_failure_dataset.csv, 1000 rows) --
// not guessed. They exist so the frontend can show honest "typical range"
// guidance next to each input and offer preset buttons that pre-fill
// real, computed anomalous values (mean ± Nσ) which the user can then
// see and edit before injecting -- the number injected is always visible,
// never hidden behind a slider.
const SENSOR_STATS = {
  Temperature_C:   { label: 'Temperature',     unit: '°C',  mean: 90.50, std: 17.26, min: 60.01,  max: 119.98 },
  RPM:             { label: 'RPM',              unit: 'rpm', mean: 2512.32, std: 867.54, min: 1000.74, max: 3996.04 },
  Vibration_X:     { label: 'Vibration X',      unit: '',    mean: 0.50, std: 0.30, min: 0.00, max: 1.00 },
  Vibration_Y:     { label: 'Vibration Y',      unit: '',    mean: 0.50, std: 0.28, min: 0.00, max: 1.00 },
  Vibration_Z:     { label: 'Vibration Z',      unit: '',    mean: 0.48, std: 0.29, min: 0.00, max: 1.00 },
  Torque_Nm:       { label: 'Torque',           unit: 'Nm',  mean: 123.57, std: 42.90, min: 50.06,  max: 199.91 },
  Fuel_Efficiency: { label: 'Fuel Efficiency',  unit: 'k/L', mean: 22.49, std: 4.42, min: 15.05,  max: 29.99 },
  Power_Output_kW: { label: 'Power Output',     unit: 'kW',  mean: 58.88, std: 22.54, min: 20.15,  max: 99.93 },
};

// Decimal places to match mapReading()'s own formatting per field.
const SENSOR_DECIMALS = {
  Temperature_C: 2, RPM: 0, Vibration_X: 4, Vibration_Y: 4, Vibration_Z: 4,
  Torque_Nm: 2, Fuel_Efficiency: 2, Power_Output_kW: 2,
};

function getSensorInfo() {
  return Object.entries(SENSOR_STATS).map(([key, s]) => ({
    key,
    ...s,
    high_limit: HIGH_LIMITS[key],
  }));
}

// Sets one or more sensors on a running engine's live buffer to EXACT
// caller-supplied values.
// sensors: [{ key: 'Temperature_C', value: 140 }, ...]
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

  // Immediate, deterministic safety check on the injected reading. The
  // ML predictor is still called on the next tick, but does not gate a
  // high-limit alert.
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
    readings_affected: state.buffer.length,   // every buffered reading was set, matching count
    fields_changed: fieldsChanged,
    high_limit_alert: highLimitAlert,
  };
}

module.exports = { startSimulator, getFleetStatus, getTruckStatus, injectAnomaly, getSensorInfo };
