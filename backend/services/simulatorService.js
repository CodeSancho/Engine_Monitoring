/**
 * simulatorService.js
 * Replays the ziya07 CSV as a live multi-truck sensor stream.
 * Maintains a rolling 30-reading buffer per truck.
 * When buffer is full, calls Flask /predict and broadcasts result.
 */

const fs          = require('fs');
const csv         = require('csv-parser');
const axios       = require('axios');
const { createAlert } = require('./alertService');

// ── Truck config — 3 virtual trucks pulling from the same dataset ─────────────
const TRUCKS = [
  { id: 'TRUCK-047', name: 'Komatsu 930E #47', model: 'Komatsu 930E'  },
  { id: 'TRUCK-022', name: 'Komatsu 930E #22', model: 'Komatsu 930E'  },
  { id: 'TRUCK-003', name: 'Cat 793F #03',      model: 'Caterpillar 793F' },
];

const WINDOW_SIZE    = 30;   // readings per prediction window
const EMIT_INTERVAL  = 1500; // ms between readings (1.5s = fast demo)

// Per-truck state
const truckState = {};
TRUCKS.forEach(t => {
  truckState[t.id] = {
    buffer:        [],
    latestResult:  null,
    readingCount:  0,
    info:          t,
  };
});

// Shared in-memory fleet status for REST endpoint
const fleetStatus = {};
TRUCKS.forEach(t => {
  fleetStatus[t.id] = {
    equipment_id:  t.id,
    name:          t.name,
    model:         t.model,
    severity:      'NORMAL',
    anomaly_score: 0,
    rul_hours:     200,
    message:       'Awaiting first prediction...',
    last_reading:  null,
    reading_count: 0,
  };
});

// ── Map ziya07 columns to display-friendly sensor names ──────────────────────
function mapReading(row, truckId, offset = 0) {
  // Add slight per-truck variation to simulate different engines
  const factor = truckId === 'TRUCK-047' ? 1.0
               : truckId === 'TRUCK-022' ? 1.02
               : 0.98;

  return {
    Temperature_C:    (parseFloat(row['Temperature (°C)']) * factor).toFixed(2),
    RPM:              (parseFloat(row['RPM']) * factor).toFixed(0),
    Fuel_Efficiency:  (parseFloat(row['Fuel_Efficiency'])).toFixed(2),
    Vibration_X:      (parseFloat(row['Vibration_X']) * factor).toFixed(4),
    Vibration_Y:      (parseFloat(row['Vibration_Y'])).toFixed(4),
    Vibration_Z:      (parseFloat(row['Vibration_Z'])).toFixed(4),
    Power_Output_kW:  (parseFloat(row['Power_Output (kW)']) * factor).toFixed(2),
    Fault_Condition:  parseInt(row['Fault_Condition']),
    Operational_Mode: row['Operational_Mode'],
    timestamp:        new Date().toISOString(),
  };
}

// ── Call Flask predictor ──────────────────────────────────────────────────────
async function callPredictor(truckId, buffer, flaskUrl) {
  try {
    const response = await axios.post(`${flaskUrl}/predict`, {
      equipment_id: truckId,
      readings:     buffer,
    }, { timeout: 5000 });
    return response.data;
  } catch (err) {
    console.warn(`[Simulator] Flask call failed for ${truckId}: ${err.message}`);
    return null;
  }
}

// ── Main simulator ────────────────────────────────────────────────────────────
function startSimulator({ io, flaskUrl, dataPath }) {
  console.log(`[Simulator] Starting — data: ${dataPath}`);

  // Load all CSV rows into memory then replay
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

    // Each tick: advance each truck by one reading
    for (const truck of TRUCKS) {
      const rowIdx   = (globalIdx + TRUCKS.indexOf(truck) * 7) % rows.length;
      const rawRow   = rows[rowIdx];
      const reading  = mapReading(rawRow, truck.id);
      const state    = truckState[truck.id];

      state.buffer.push(reading);
      state.readingCount++;

      // Emit live reading to dashboard
      io.emit('sensor_reading', {
        equipment_id: truck.id,
        name:         truck.name,
        reading,
        buffer_size:  state.buffer.length,
      });

      // When buffer full — run prediction
      if (state.buffer.length >= WINDOW_SIZE) {
        const result = await callPredictor(truck.id, state.buffer, flaskUrl);

        if (result) {
          state.latestResult = result;

          // Update fleet status
          fleetStatus[truck.id] = {
            ...fleetStatus[truck.id],
            severity:      result.severity,
            anomaly_score: result.anomaly_score,
            rul_hours:     result.rul_hours,
            message:       result.message,
            last_reading:  reading,
            reading_count: state.readingCount,
            top_features:  result.top_anomalous_features,
            feature_snapshot: result.feature_snapshot,
          };

          // Create alert for non-normal severities
          if (result.severity !== 'NORMAL') {
            const alert = createAlert({
              equipment_id:     truck.id,
              severity:         result.severity,
              anomaly_score:    result.anomaly_score,
              rul_hours:        result.rul_hours,
              message:          result.message,
              feature_snapshot: result.feature_snapshot,
            });

            io.emit('new_alert', alert);
          }

          // Broadcast prediction result
          io.emit('prediction', {
            equipment_id:     truck.id,
            name:             truck.name,
            ...result,
            reading_count:    state.readingCount,
          });

          console.log(`[${truck.id}] ${result.severity} | `
                    + `score=${result.anomaly_score.toFixed(3)} | `
                    + `RUL=${result.rul_hours}h`);
        }

        // Slide window — remove oldest reading
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

module.exports = { startSimulator, getFleetStatus, getTruckStatus };
