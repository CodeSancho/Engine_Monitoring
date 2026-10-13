/** Component RUL demo backed by held-out synthetic engine trajectories. */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');

const DATA_PATH = process.env.COMPONENT_RUL_DATA_PATH ||
  path.join(__dirname, '..', '..', 'data', 'raw', 'synthetic_component_rul.csv');
const SENSOR_FIELDS = [
  'payload_t', 'speed_kmh', 'total_resistance_pct', 'Temperature_C',
  'Exhaust_Temp_C', 'RPM', 'Torque_Nm', 'Power_Output_kW',
  'Fuel_Consumption_Lph', 'Fuel_Efficiency_tkm_per_L', 'Oil_Pressure_kPa',
  'Boost_Pressure_kPa', 'Vibration_X', 'Vibration_Y', 'Vibration_Z',
];
let engineMetadataPromise;
const rowCache = new Map();

function readEngineMetadata() {
  if (engineMetadataPromise) return engineMetadataPromise;
  engineMetadataPromise = new Promise((resolve, reject) => {
    if (!fs.existsSync(DATA_PATH)) return reject(new Error(`Component RUL data not found: ${DATA_PATH}`));
    const engines = new Map();
    fs.createReadStream(DATA_PATH).pipe(csv())
      .on('data', row => {
        if (row.split !== 'test' && row.split !== 'val') return;
        const id = String(row.engine_id);
        if (!engines.has(id)) engines.set(id, { engine_id: id, split: row.split, records: 0, total_months: 0, total_hours: 0 });
        const engine = engines.get(id);
        engine.records++;
        engine.total_months = Number(row.month_index);
        engine.total_hours = Number(row.operating_hours);
      })
      .on('error', reject)
      .on('end', () => resolve([...engines.values()].sort((a, b) => Number(a.engine_id) - Number(b.engine_id))));
  }).catch(err => {
    engineMetadataPromise = null;
    throw err;
  });
  return engineMetadataPromise;
}

function readEngineRecords(engineId) {
  if (rowCache.has(engineId)) return Promise.resolve(rowCache.get(engineId));
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DATA_PATH)) return reject(new Error(`Component RUL data not found: ${DATA_PATH}`));
    const rows = [];
    fs.createReadStream(DATA_PATH).pipe(csv())
      .on('data', row => {
        if (String(row.engine_id) !== engineId) return;
        const clean = { engine_id: row.engine_id, record: Number(row.record), operating_hours: Number(row.operating_hours), month_index: Number(row.month_index) };
        SENSOR_FIELDS.forEach(key => { clean[key] = Number(row[key]); });
        rows.push(clean);
      })
      .on('error', reject)
      .on('end', () => {
        if (rows.length < 6) return reject(new Error(`No usable trajectory for engine ${engineId}`));
        rowCache.set(engineId, rows);
        if (rowCache.size > 6) rowCache.delete(rowCache.keys().next().value);
        resolve(rows);
      });
  });
}

router.get('/engines', async (req, res) => {
  try {
    const engines = await readEngineMetadata();
    res.json({ engines, count: engines.length, dataset: path.basename(DATA_PATH) });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/:engineId', async (req, res) => {
  const engineId = String(req.params.engineId);
  try {
    const engines = await readEngineMetadata();
    const selected = engines.find(engine => engine.engine_id === engineId);
    if (!selected) return res.status(404).json({ error: `Engine ${engineId} is not in the validation or test split` });
    const records = await readEngineRecords(engineId);
    const flaskUrl = req.app.get('flaskUrl');
    const response = await axios.post(`${flaskUrl}/predict_component_rul`, {
      engine_id: engineId,
      records,
      sample_points: 48,
    }, { timeout: 600000 });
    res.json({ ...response.data, source_split: selected.split, total_records: records.length });
  } catch (err) {
    console.error('[Component RUL] Error:', err.message);
    res.status(503).json({ error: err.response?.data?.error || err.message });
  }
});

module.exports = router;
