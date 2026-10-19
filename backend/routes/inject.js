






const express = require('express');
const router  = express.Router();
const { injectAnomaly, getSensorInfo } = require('../services/simulatorService');





router.get('/sensor-info', (req, res) => {
  res.json({ sensors: getSensorInfo() });
});




router.post('/', (req, res) => {
  const { equipment_id, sensors } = req.body;
  try {
    const result = injectAnomaly({ equipment_id, sensors, io: req.app.get('io') });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
