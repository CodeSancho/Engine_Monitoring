const fs = require('fs');
const path = require('path');

const header = [
  'engine_id', 'record', 'timestamp', 'haul_phase', 'payload_t', 'speed_kmh',
  'total_resistance_pct', 'ambient_C', 'Temperature_C', 'Exhaust_Temp_C', 'RPM',
  'Torque_Nm', 'Power_Output_kW', 'Fuel_Consumption_Lph',
  'Fuel_Efficiency_km_per_L', 'Oil_Pressure_kPa', 'Boost_Pressure_kPa',
  'Vibration_X', 'Vibration_Y', 'Vibration_Z', 'is_anomaly', 'anomaly_type',
  'anomaly_severity', 'event_id', 'context_tag', 'split',
];

const faults = new Map([
  [2,  ['overheating',              { Temperature_C: 150, Exhaust_Temp_C: 750 }]],
  [3,  ['exhaust_restriction',      { Exhaust_Temp_C: 820 }]],
  [4,  ['bearing_wear',             { Vibration_X: 4.5, Vibration_Y: 4.2, Vibration_Z: 4.8 }]],
  [5,  ['oil_pressure_drop',        { Oil_Pressure_kPa: 120 }]],
  [6,  ['injector_fault',           { Exhaust_Temp_C: 700, RPM: 2100 }]],
  [7,  ['excessive_engine_load',    { Torque_Nm: 15000, RPM: 2500 }]],
  [8,  ['cooling_loss',             { Temperature_C: 135, Exhaust_Temp_C: 650 }]],
  [9,  ['mechanical_binding',       { RPM: 2400, Torque_Nm: 14000 }]],
  [10, ['oil_pump_wear',            { Oil_Pressure_kPa: 90 }]],
  [11, ['combustion_misfire',       { RPM: 800, Torque_Nm: 2000, Exhaust_Temp_C: 600 }]],
  [12, ['fuel_filter_blockage',     { Exhaust_Temp_C: 720, RPM: 2200 }]],
  [13, ['unclassified_anomaly',     { Vibration_X: 5, Vibration_Y: 5, Vibration_Z: 5 }]],
]);

const sourcePath = path.join(__dirname, '..', 'data', 'raw', 'synthetic_anomaly_records.csv');
const modelMetadata = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'saved_models', 'synthetic_anomaly_model_metadata.json'), 'utf8'));
const testEngineIds = modelMetadata.test_engine_ids.map(String);
const sourceLines = fs.readFileSync(sourcePath, 'utf8').trimEnd().split(/\r?\n/);
const sourceHeader = sourceLines[0].split(',');
const sourceIndex = Object.fromEntries(sourceHeader.map((name, index) => [name, index]));
const normalRuns = new Map(testEngineIds.map(id => [id, []]));

for (const line of sourceLines.slice(1)) {
  const cells = line.split(',');
  const engineId = cells[sourceIndex.engine_id];
  if (normalRuns.has(engineId) && cells[sourceIndex.is_anomaly] === '0') {
    normalRuns.get(engineId).push(cells);
  }
}

const normalTemplates = testEngineIds.map(engineId => {
  const rows = normalRuns.get(engineId).sort((a, b) => Number(a[sourceIndex.record]) - Number(b[sourceIndex.record]));
  let run = [];
  let previousRecord = null;
  for (const row of rows) {
    const record = Number(row[sourceIndex.record]);
    run = previousRecord !== null && record === previousRecord + 1 ? [...run, row] : [row];
    previousRecord = record;
    if (run.length === 30) break;
  }
  if (run.length !== 30) {
    throw new Error(`No 30-reading normal run found for held-out test engine ${engineId}.`);
  }
  return run;
});

function quote(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function makeRow(engine, record, withFaults) {
  const values = Object.fromEntries(header.map((key, index) => [key, normalTemplates[engine - 1][record - 1][sourceIndex[key]]]));
  values.engine_id = engine;
  values.record = record;
  values.is_anomaly = 0;
  values.anomaly_type = 'none';
  values.anomaly_severity = 0;
  values.event_id = -1;
  values.context_tag = 'demo_normal';
  values.split = 'test';
  const fault = withFaults && faults.get(engine);
  if (fault && record >= 27 && record <= 30) {
    values.is_anomaly = 1;
    values.anomaly_type = fault[0];
    values.anomaly_severity = 0.85;
    values.event_id = engine * 1000 + 1;
    values.context_tag = 'demo_injected_fault';
    Object.assign(values, fault[1]);
  }
  return header.map(key => values[key]);
}

const outputDir = path.join(__dirname, '..', 'data', 'raw');
for (const [file, withFaults] of [['demo_anomalies_clean.csv', true], ['demo_smooth_clean.csv', false]]) {
  const lines = [header.join(',')];
  for (let engine = 1; engine <= 20; engine++) {
    for (let record = 1; record <= 30; record++) {
      lines.push(makeRow(engine, record, withFaults).map(value => {
        if (typeof value !== 'number') return quote(value);
        const rounded = Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(3));
        return quote(rounded);
      }).join(','));
    }
  }
  fs.writeFileSync(path.join(outputDir, file), `${lines.join('\n')}\n`, 'utf8');
}
