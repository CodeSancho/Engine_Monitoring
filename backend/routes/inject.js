/**
 * routes/inject.js  —  Manual anomaly injection (testing/demo only)
 *
 * Corrupts the last few readings in a running engine's live buffer with
 * a physically-grounded fault signature, so the NEXT natural prediction
 * tick genuinely flags it through the real, unmodified alert pipeline.
 * This does not fake an alert directly -- it only corrupts input data
 * and lets the existing pipeline react to it honestly.
 */
const express = require('express');
const router  = express.Router();
const { injectAnomaly } = require('../services/simulatorService');

// POST /api/inject  { equipment_id, fault_type, severity }
router.post('/', (req, res) => {
  const { equipment_id, fault_type, severity } = req.body;
  try {
    const result = injectAnomaly({ equipment_id, fault_type, severity });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;