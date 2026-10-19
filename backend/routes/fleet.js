


const express = require('express');
const router  = express.Router();
const { getFleetStatus, getTruckStatus } = require('../services/simulatorService');
const database = require('../services/databaseService');


router.get('/status', (req, res) => {
  const status = getFleetStatus();
  const trucks = Object.values(status).sort((a, b) => {
    const order = { CRITICAL: 0, WARNING: 0, ANOMALY: 0, TAKE_NOTE: 1, NORMAL: 2 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });
  res.json({ trucks, count: trucks.length, timestamp: new Date().toISOString() });
});


router.get('/summary', (req, res) => {
  const status = getFleetStatus();
  const trucks = Object.values(status);
  const counts = { NORMAL: 0, TAKE_NOTE: 0, CRITICAL: 0 };
  trucks.forEach(t => {
    const tier = ['WARNING', 'ANOMALY'].includes(t.severity) ? 'CRITICAL' : t.severity;
    if (Object.hasOwn(counts, tier)) counts[tier] += 1;
  });
  res.json({
    total:  trucks.length,
    counts,
    critical_trucks: trucks.filter(t => ['CRITICAL', 'WARNING', 'ANOMALY'].includes(t.severity)).map(t => t.equipment_id),
    timestamp: new Date().toISOString(),
  });
});


router.get('/:id/readings', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 60;
  try {
    const readings = await database.getSensorReadings(req.params.id, limit);
    if (readings === null) {
      return res.status(503).json({ error: 'Database is not configured' });
    }
    res.json({ equipment_id: req.params.id, readings });
  } catch (err) {
    console.error('[Fleet] Could not load sensor history:', err.message);
    res.status(503).json({ error: 'Could not load sensor history' });
  }
});


router.get('/:id', (req, res) => {
  const truck = getTruckStatus(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  res.json(truck);
});

module.exports = router;
