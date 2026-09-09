/**
 * routes/rulDemo.js  —  RUL model demo endpoint
 *
 * Reads a sliding 30-cycle window from the real CMAPSS training file
 * (unit 1), forwards it to Flask's /predict_rul_demo. Supports a
 * `start` query param so the frontend can step through the engine's
 * full life -- early/healthy through late/declining -- and watch
 * predicted RUL genuinely drop as it approaches real failure.
 *
 * NOTE: uses the 's2', 's3', ... key naming that predictor.py's
 * CMAPSS_SENSOR_BASE actually expects -- NOT the 'sensor_2' naming shown
 * in predictor.py's own docstring example, which was inconsistent with
 * its real code (CMAPSS_SENSOR_BASE = ['s2','s3',...]).
 */
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');

const CMAPSS_PATH = process.env.CMAPSS_DATA_PATH ||
  path.join(__dirname, '..', '..', 'data', 'raw', 'train_FD001.txt');

const SENSOR_KEYS = ['s2','s3','s4','s7','s8','s9','s11','s12','s13','s14','s15','s17','s20','s21'];
// Raw file column order: unit, cycle, setting_1-3, sensor_1..sensor_21
const COL_INDEX = { s2:6, s3:7, s4:8, s7:11, s8:12, s9:13, s11:15, s12:16, s13:17, s14:18, s15:19, s17:21, s20:24, s21:25 };
const WINDOW_SIZE = 30;

let _cachedUnit1Rows = null;

function loadUnit1Rows() {
  if (_cachedUnit1Rows) return _cachedUnit1Rows;

  if (!fs.existsSync(CMAPSS_PATH)) {
    throw new Error(`CMAPSS data file not found at ${CMAPSS_PATH}`);
  }
  const lines = fs.readFileSync(CMAPSS_PATH, 'utf-8').trim().split('\n');
  const rows = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts[0] === 1) rows.push(parts);   // unit == 1, ALL cycles this time
  }
  if (rows.length < WINDOW_SIZE) {
    throw new Error('Not enough rows found for unit 1 in CMAPSS data');
  }
  _cachedUnit1Rows = rows;
  return rows;
}

// GET /api/rul-demo?start=0
// `start` = index of the window's first cycle (0-based). The route also
// reports maxStart so the frontend knows when it's reached this engine's
// real end of life and should stop advancing.
router.get('/', async (req, res) => {
  try {
    const allRows = loadUnit1Rows();
    const maxStart = allRows.length - WINDOW_SIZE;
    let start = parseInt(req.query.start, 10);
    if (isNaN(start) || start < 0) start = 0;
    if (start > maxStart) start = maxStart;

    const windowRows = allRows.slice(start, start + WINDOW_SIZE);
    const cycles = windowRows.map(parts => {
      const cycle = {};
      for (const key of SENSOR_KEYS) cycle[key] = parts[COL_INDEX[key]];
      return cycle;
    });

    const flaskUrl = req.app.get('flaskUrl');
    const response = await axios.post(`${flaskUrl}/predict_rul_demo`, {
      engine_id: `demo-engine-1 (CMAPSS unit 1, cycles ${windowRows[0][1]}-${windowRows[windowRows.length-1][1]})`,
      cycles,
    }, { timeout: 5000 });

    res.json({
      ...response.data,
      window_start: start,
      max_start: maxStart,
      cycle_range: [windowRows[0][1], windowRows[windowRows.length - 1][1]],
      total_cycles_this_engine: allRows[allRows.length - 1][1],
      is_final_window: start >= maxStart,
    });
  } catch (err) {
    console.error('[RUL Demo] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;