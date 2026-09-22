/**
 * routes/inject.js  —  Manual anomaly injection (testing/demo only)
 *
 * Sets exact caller-supplied values on a running engine's live buffer,
 * so the NEXT natural prediction tick genuinely evaluates them through
 * the real, unmodified alert pipeline. This does not fake an alert
 * directly -- it only sets input data honestly to whatever value the
 * caller chose, and lets the existing pipeline react to it.
 */
const express = require('express');
const router  = express.Router();
const { injectAnomaly, getSensorInfo } = require('../services/simulatorService');

// GET /api/inject/sensor-info — real mean/std/min/max per injectable
// sensor (measured from the raw ziya07 CSV), so the frontend can show
// honest "typical range" guidance and build preset buttons from real
// numbers instead of guessing plausible-looking values.
router.get('/sensor-info', (req, res) => {
  res.json({ sensors: getSensorInfo() });
});

// POST /api/inject  { equipment_id, sensors: [{ key, value }, ...] }
// `value` is the EXACT reading to set for that sensor -- not a severity
// multiplier. The caller picks the actual number (e.g. Temperature_C: 140).
router.post('/', (req, res) => {
  const { equipment_id, sensors } = req.body;
  try {
    const result = injectAnomaly({ equipment_id, sensors });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;