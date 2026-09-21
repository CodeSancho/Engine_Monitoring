/**
 * simulatorService.js
 * Replays the ziya07 CSV as a live multi-engine sensor stream.
 * Maintains a rolling 30-reading buffer per engine.
 * When buffer is full, calls Flask /predict and broadcasts result.
 *
 * FIXES APPLIED (see conversation):
 *  1. rul_hours removed from fleetStatus and createAlert -- /predict no
 *     longer returns it. Previously this silently became `undefined` on
 *     every update (no error, just quietly wrong/missing data forever).
 *  2. severity is now the new two-tier scheme ('NORMAL' / 'ANOMALY'),
 *     matching what /predict actually returns.
 *  3. Truck naming (Komatsu/Cat models) replaced with plain "Engine 1/2/3"
 *     -- the project scope is engine-level anomaly detection, not
 *     truck-specific, so the naming now matches what's actually validated.
 */

const fs          = require('fs');
const csv         = require('csv-parser');
const axios       = require('axios');
const { createAlert } = require('./alertService');

// ── Engine config — 3 virtual engines pulling from the same dataset ───────────
const ENGINES = [
  { id: 'ENGINE-1', name: 'Engine 1' },
  { id: 'ENGINE-2', name: 'Engine 2' },
  { id: 'ENGINE-3', name: 'Engine 3' },
];

const WINDOW_SIZE    = 30;   // readings per prediction window
const EMIT_INTERVAL  = 1500; // ms between readings (1.5s = fast demo)

// Per-engine state
const engineState = {};
ENGINES.forEach(e => {
  engineState[e.id] = {
    buffer:        [],
    latestResult:  null,
    readingCount:  0,
    info:          e,
  };
});

// Shared in-memory fleet status for REST endpoint
const fleetStatus = {};
ENGINES.forEach(e => {
  fleetStatus[e.id] = {
    equipment_id:  e.id,
    name:          e.name,
    severity:      'NORMAL',
    anomaly_score: 0,
    message:       'Awaiting first prediction...',
    last_reading:  null,
    reading_count: 0,
  };
});

// ── Map ziya07 columns to display-friendly sensor names ──────────────────────
function mapReading(row, engineId, offset = 0) {
  // Add slight per-engine variation to simulate different units
  const factor = engineId === 'ENGINE-1' ? 1.0
               : engineId === 'ENGINE-2' ? 1.02
               : 0.98;

  return {
    Temperature_C:    (parseFloat(row['Temperature (°C)']) * factor).toFixed(2),
    RPM:              (parseFloat(row['RPM']) * factor).toFixed(0),
    Fuel_Efficiency:  (parseFloat(row['Fuel_Efficiency'])).toFixed(2),
    Vibration_X:      (parseFloat(row['Vibration_X']) * factor).toFixed(4),
    Vibration_Y:      (parseFloat(row['Vibration_Y'])).toFixed(4),
    Vibration_Z:      (parseFloat(row['Vibration_Z'])).toFixed(4),
    Torque_Nm:        (parseFloat(row['Torque']) * factor).toFixed(2),
    Power_Output_kW:  (parseFloat(row['Power_Output (kW)']) * factor).toFixed(2),
    Fault_Condition:  parseInt(row['Fault_Condition']),
    Operational_Mode: row['Operational_Mode'],
    timestamp:        new Date().toISOString(),
  };
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
  if (!fs.existsSync(dataPath)) {
    console.error(`[Simulator] Data file not found: ${dataPath}`);
    return;
  }

  fs.createReadStream(dataPath)
    .pipe(csv())
    .on('data', row => allRows.push(row))
    .on('end', () => {
      console.log(`[Simulator] Loaded ${allRows.length} rows from CSV`);
      replayRows(allRows, io, flaskUrl);
    });
}

function replayRows(rows, io, flaskUrl) {
  let globalIdx = 0;

  const tick = async () => {
    if (rows.length === 0) return;

    for (const engine of ENGINES) {
      const rowIdx   = (globalIdx + ENGINES.indexOf(engine) * 7) % rows.length;
      const rawRow   = rows[rowIdx];
      const reading  = mapReading(rawRow, engine.id);
      const state    = engineState[engine.id];

      state.buffer.push(reading);
      state.readingCount++;

      io.emit('sensor_reading', {
        equipment_id: engine.id,
        name:         engine.name,
        reading,
        buffer_size:  state.buffer.length,
      });

      if (state.buffer.length >= WINDOW_SIZE) {
        const result = await callPredictor(engine.id, state.buffer, flaskUrl);

        if (result) {
          state.latestResult = result;

          fleetStatus[engine.id] = {
            ...fleetStatus[engine.id],
            severity:      result.severity,
            anomaly_score: result.anomaly_score,
            message:       result.message,
            last_reading:  reading,
            reading_count: state.readingCount,
            top_features:  result.top_anomalous_features,
            feature_snapshot: result.feature_snapshot,
          };

          // FIX: severity is now 'NORMAL' or 'ANOMALY' only.
          if (result.severity !== 'NORMAL') {
            const alert = createAlert({
              equipment_id:     engine.id,
              severity:         result.severity,
              anomaly_score:    result.anomaly_score,
              message:          result.message,
              feature_snapshot: result.feature_snapshot,
            });

            io.emit('new_alert', alert);
          }

          io.emit('prediction', {
            equipment_id:     engine.id,
            name:             engine.name,
            ...result,
            reading_count:    state.readingCount,
          });

          console.log(`[${engine.id}] ${result.severity} | `
                    + `score=${result.anomaly_score.toFixed(3)}`);
        }

        state.buffer.shift();
      }
    }

    globalIdx = (globalIdx + 1) % rows.length;
    setTimeout(tick, EMIT_INTERVAL);
  };

  tick();
  console.log(`[Simulator] Running — emitting every ${EMIT_INTERVAL}ms`);
}

function getFleetStatus() { return fleetStatus; }
function getTruckStatus(id) { return fleetStatus[id] || null; }

// ── Live anomaly injection (for manual demo/testing) ─────────────────────────
// Mutates a running engine's live buffer in place, using the same
// physically-grounded fault signatures as synthetic_anomalies.py -- but
// applied here to the LIVE stream instead of offline evaluation data.
// The next natural tick's /predict call will see the corrupted buffer
// and (if the perturbation is large enough) flag it through the normal,
// unmodified alert pipeline -- nothing about createAlert() or the
// Socket.io emit path changes.
//
// Std values below are the REAL values measured from ziya07 windowed
// features earlier in this project (see conversation) -- not guessed.
const SENSOR_STDS = {
  Temperature_C:   6.80,
  RPM:            332.82,
  Vibration_X:      0.12,
  Vibration_Y:      0.12,
  Vibration_Z:      0.12,
  Torque_Nm:       17.86,
  Fuel_Efficiency:  1.94,
};

const FAULT_TYPES = ['bearing_wear', 'overheat', 'mechanical_bind'];

const FIELDS_CHANGED = {
  bearing_wear:    ['Vibration_X', 'Vibration_Y', 'Vibration_Z'],
  overheat:        ['Temperature_C', 'Fuel_Efficiency'],
  mechanical_bind: ['Torque_Nm', 'RPM'],
};

function injectAnomaly({ equipment_id, fault_type, severity }) {
  const state = engineState[equipment_id];
  if (!state) throw new Error(`Unknown engine: ${equipment_id}`);
  if (!FAULT_TYPES.includes(fault_type)) throw new Error(`Unknown fault_type: ${fault_type} (expected one of ${FAULT_TYPES.join(', ')})`);
  if (state.buffer.length === 0) throw new Error(`${equipment_id}'s buffer is empty -- wait for the simulator to warm up`);

  const sev = Number(severity);
  if (isNaN(sev) || sev <= 0) throw new Error('severity must be a positive number (e.g. 1-6 standard deviations)');

  state.buffer = state.buffer.map(reading => {
    const r = { ...reading };
    if (fault_type === 'bearing_wear') {
      ['Vibration_X', 'Vibration_Y', 'Vibration_Z'].forEach(k => {
        r[k] = (parseFloat(r[k]) + sev * SENSOR_STDS[k]).toFixed(4);
      });
    } else if (fault_type === 'overheat') {
      r.Temperature_C   = (parseFloat(r.Temperature_C)   + sev * SENSOR_STDS.Temperature_C).toFixed(2);
      r.Fuel_Efficiency = (parseFloat(r.Fuel_Efficiency) - sev * SENSOR_STDS.Fuel_Efficiency).toFixed(2);
    } else if (fault_type === 'mechanical_bind') {
      r.Torque_Nm = (parseFloat(r.Torque_Nm) + sev * SENSOR_STDS.Torque_Nm).toFixed(2);
      r.RPM       = (parseFloat(r.RPM)       - sev * SENSOR_STDS.RPM).toFixed(0);
    }
    return r;
  });

  console.log(`[Inject] ${equipment_id} <- ${fault_type} @ severity=${sev} (next tick will reflect this)`);
  return {
    equipment_id,
    fault_type,
    severity: sev,
    buffer_size: state.buffer.length,
    readings_affected: state.buffer.length,   // every buffered reading was perturbed, matching count
    fields_changed: FIELDS_CHANGED[fault_type],
  };
}

module.exports = { startSimulator, getFleetStatus, getTruckStatus, injectAnomaly };