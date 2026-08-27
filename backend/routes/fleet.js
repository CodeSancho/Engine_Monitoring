/**
 * routes/fleet.js  —  Fleet REST endpoints
 */
const express = require('express');
const router  = express.Router();
const { getFleetStatus, getTruckStatus } = require('../services/simulatorService');

// GET /api/fleet/status  — all trucks current state
router.get('/status', (req, res) => {
  const status = getFleetStatus();
  const trucks = Object.values(status).sort((a, b) => {
    const order = { CRITICAL: 0, CAUTION: 1, WARNING: 2, NORMAL: 3 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });
  res.json({ trucks, count: trucks.length, timestamp: new Date().toISOString() });
});

// GET /api/fleet/summary  — aggregate stats
router.get('/summary', (req, res) => {
  const status = getFleetStatus();
  const trucks = Object.values(status);
  const counts = { NORMAL: 0, WARNING: 0, CAUTION: 0, CRITICAL: 0 };
  trucks.forEach(t => { counts[t.severity] = (counts[t.severity] || 0) + 1; });
  res.json({
    total:  trucks.length,
    counts,
    critical_trucks: trucks.filter(t => t.severity === 'CRITICAL').map(t => t.equipment_id),
    timestamp: new Date().toISOString(),
  });
});

// GET /api/fleet/:id  — single truck detail
router.get('/:id', (req, res) => {
  const truck = getTruckStatus(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  res.json(truck);
});

module.exports = router;
