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
 *  4. Removed the per-engine "factor" fudge (1.0 / 1.02 / 0.98) that used
 *     to fake variation between engines by multiplying the SAME rows.
 *     ziya07 has no real per-unit column, so instead of inventing a
 *     multiplier, each virtual engine is now assigned its own genuinely
 *     distinct, non-overlapping segment of the real CSV and loops within
 *     that segment independently -- real data assignment, not fabricated
 *     variation. See assignSegments() / replayRows() below.
 *  5. Engine count is now configurable (ENGINE_COUNT below) instead of a
 *     hardcoded 3-entry array -- see the honest ceiling note on
 *     ENGINE_COUNT for why "a lot" has a real, data-driven limit here.
 */

const fs          = require('fs');
const csv         = require('csv-parser');
const axios       = require('axios');
const { createAlert } = require('./alertService');

// ── Engine config ──────────────────────────────────────────────────────────
// How many virtual engines to run, each replaying its OWN real, non-
// overlapping segment of the 1000-row ziya07 CSV (see assignSegments()).
// Override with the ENGINE_COUNT env var; defaults to 20 here.
//
// THE HONEST CEILING: ziya07 has only 1000 total rows and no real per-
// engine column (unlike CMAPSS, which genuinely has 100 separate units --
// see rulDemo.js). More engines means smaller segments:
//   1000 rows / N engines = rows per engine
// Each prediction needs a full WINDOW_SIZE (30) rows to form one window.
// So up to floor(1000 / 30) = 33 engines, every engine gets a genuinely
// unique row for every reading in its window. Past 33, an engine's
// segment is smaller than one window, so its buffer starts repeating
// real rows WITHIN a single prediction window -- not fabricated data,
// just less variety feeding one prediction. 20 is chosen as a solid
// jump from 3 while staying comfortably under that 33-engine line.
const ENGINE_COUNT = parseInt(process.env.ENGINE_COUNT, 10) || 20;
const ENGINES = Array.from({ length: ENGINE_COUNT }, (_, i) => ({
  id:   `ENGINE-${i + 1}`,
  name: `Engine ${i + 1}`,
}));

const WINDOW_SIZE    = 30;   // readings per prediction window
const EMIT_INTERVAL  = 1500; // ms between readings (1.5s = fast demo)

if (ENGINE_COUNT > 33) {
  console.warn(`[Simulator] ENGINE_COUNT=${ENGINE_COUNT} exceeds 33 -- each engine's `
    + `segment (${Math.floor(1000 / ENGINE_COUNT)} rows) is now smaller than the `
    + `${WINDOW_SIZE}-row prediction window, so buffers will repeat real rows within `
    + `a single window. Not fabricated, just less real variety per prediction.`);
}

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
// No per-engine factor here anymore -- each engine's realism now comes from
// which real rows it's assigned (see assignSegments), not an invented scale.
function mapReading(row) {
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

// ── Assign each virtual engine its own real, non-overlapping slice of the
// CSV. ziya07 has no unit/equipment column of its own (unlike CMAPSS, which
// genuinely has 100 distinct engine units) -- so "multiple engines" here
// means each engine gets a distinct contiguous chunk of the SAME real
// dataset and loops within just that chunk, rather than all three reading
// the same rows dressed up with a fake multiplier.
function assignSegments(rowCount) {
  const segLen = Math.floor(rowCount / ENGINES.length);
  return ENGINES.map((engine, i) => {
    const start = i * segLen;
    const end   = (i === ENGINES.length - 1) ? rowCount : start + segLen; // last engine absorbs the remainder
    return { id: engine.id, start, end };
  });
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
  if (rows.length < ENGINES.length) {
    console.error(`[Simulator] Only ${rows.length} rows loaded -- not enough to give each of ${ENGINES.length} engines its own segment.`);
    return;
  }

  const segments = assignSegments(rows.length);
  segments.forEach(seg => {
    const state = engineState[seg.id];
    state.segment = seg;
    state.cursor  = seg.start;
    console.log(`[Simulator] ${seg.id} <- rows [${seg.start}, ${seg.end}) of ${rows.length}`);
  });

  const tick = async () => {
    for (const engine of ENGINES) {
      const state    = engineState[engine.id];
      const rawRow   = rows[state.cursor];
      const reading  = mapReading(rawRow);

      // Advance this engine's cursor within its OWN real segment only --
      // loops back to its own start, never bleeds into another engine's rows.
      state.cursor++;
      if (state.cursor >= state.segment.end) state.cursor = state.segment.start;

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
              top_anomalous_features: result.top_anomalous_features,
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
  return Object.entries(SENSOR_STATS).map(([key, s]) => ({ key, ...s }));
}

// Sets one or more sensors on a running engine's live buffer to EXACT
// caller-supplied values.
// sensors: [{ key: 'Temperature_C', value: 140 }, ...]
function injectAnomaly({ equipment_id, sensors }) {
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
    if (isNaN(value)) throw new Error(`Value for ${key} must be a number, got: ${s.value}`);
    return { key, value };
  });

  state.buffer = state.buffer.map(reading => {
    const r = { ...reading };
    targets.forEach(({ key, value }) => {
      r[key] = value.toFixed(SENSOR_DECIMALS[key]);
    });
    return r;
  });

  const fieldsChanged = targets.map(t => t.key);

  console.log(`[Inject] ${equipment_id} <- set [${targets.map(t => `${t.key}=${t.value}`).join(', ')}]`
            + ' (next tick will reflect this)');
  return {
    equipment_id,
    sensors_applied: targets,
    buffer_size: state.buffer.length,
    readings_affected: state.buffer.length,   // every buffered reading was set, matching count
    fields_changed: fieldsChanged,
  };
}

module.exports = { startSimulator, getFleetStatus, getTruckStatus, injectAnomaly, getSensorInfo };