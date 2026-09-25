/**
 * routes/rulDemo.js  —  RUL model demo endpoint
 *
 * Reads a sliding 30-cycle window from the real CMAPSS training file,
 * forwards it to Flask's /predict_rul_demo. Supports a `start` query
 * param so the frontend can step through an engine's full life --
 * early/healthy through late/declining -- and watch predicted RUL
 * genuinely drop as it approaches real failure.
 *
 * NEW: also supports a `unit` query param (1-100) so the frontend can
 * pick from CMAPSS's 100 genuinely distinct, real engine units instead
 * of always demoing unit 1. This is the honest version of "assign
 * multiple engines" for this dataset -- CMAPSS actually HAS separate
 * engine units (unlike ziya07, see simulatorService.js), so here
 * "multiple engines" means real different units, not invented variation.
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

// Cache is now per-unit, not a single hardcoded unit-1 array.
const _unitRowsCache = new Map();   // unitId -> rows[]
let _allUnitsMeta = null;           // [{ unit, totalCycles }, ...] sorted by unit id, real values from the file

// Real total cycle count per unit (its last recorded cycle number before
// failure) -- computed once from the actual file, not estimated. This is
// what lets the frontend show "Unit 50 — 198 real cycles" instead of a
// bare number, so picking a unit means picking a genuinely different
// engine life, not an arbitrary id.
function loadAllUnitsMeta() {
  if (_allUnitsMeta) return _allUnitsMeta;
  if (!fs.existsSync(CMAPSS_PATH)) {
    throw new Error(`CMAPSS data file not found at ${CMAPSS_PATH}`);
  }
  const maxCycle = new Map(); // unit -> highest cycle seen
  const lines = fs.readFileSync(CMAPSS_PATH, 'utf-8').trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const unit  = Number(parts[0]);
    const cycle = Number(parts[1]);
    if (!maxCycle.has(unit) || cycle > maxCycle.get(unit)) maxCycle.set(unit, cycle);
  }
  _allUnitsMeta = Array.from(maxCycle.entries())
    .map(([unit, totalCycles]) => ({ unit, totalCycles }))
    .sort((a, b) => a.unit - b.unit);
  return _allUnitsMeta;
}

function loadUnitRows(unitId) {
  if (_unitRowsCache.has(unitId)) return _unitRowsCache.get(unitId);

  if (!fs.existsSync(CMAPSS_PATH)) {
    throw new Error(`CMAPSS data file not found at ${CMAPSS_PATH}`);
  }
  const lines = fs.readFileSync(CMAPSS_PATH, 'utf-8').trim().split('\n');
  const rows = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts[0] === unitId) rows.push(parts);   // this unit, ALL its real cycles
  }
  if (rows.length < WINDOW_SIZE) {
    throw new Error(`Not enough rows found for unit ${unitId} in CMAPSS data`);
  }
  _unitRowsCache.set(unitId, rows);
  return rows;
}

// GET /api/rul-demo/units  — every real CMAPSS unit id, each with its
// real total cycle count, so the frontend can offer a genuine selection
// instead of guessing valid ids or fabricating lifespans.
router.get('/units', (req, res) => {
  try {
    res.json({ units: loadAllUnitsMeta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rul-demo?start=0&unit=1
// `unit`  = which real CMAPSS engine unit to demo (defaults to 1).
// `start` = index of the window's first cycle (0-based) within that unit.
// The route also reports maxStart so the frontend knows when it's
// reached this engine's real end of life and should stop advancing.
router.get('/', async (req, res) => {
  try {
    let unit = parseInt(req.query.unit, 10);
    if (isNaN(unit) || unit < 1) unit = 1;
    const allUnitsMeta = loadAllUnitsMeta();
    const allUnitIds = allUnitsMeta.map(u => u.unit);
    if (!allUnitIds.includes(unit)) {
      return res.status(400).json({ error: `Unit ${unit} not found. Valid units: ${allUnitIds[0]}-${allUnitIds[allUnitIds.length - 1]}` });
    }

    const allRows = loadUnitRows(unit);
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
      engine_id: `demo-engine-${unit} (CMAPSS unit ${unit}, cycles ${windowRows[0][1]}-${windowRows[windowRows.length-1][1]})`,
      cycles,
    }, { timeout: 5000 });

    res.json({
      ...response.data,
      unit,
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