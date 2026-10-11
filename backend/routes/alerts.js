/**
 * routes/alerts.js  —  Alert REST endpoints
 */
const express = require('express');
const router  = express.Router();
const {
  listActiveAlerts,
  listAllAlerts,
  acknowledgeAlertById,
  listAlertsByEquipment,
} = require('../services/alertService');

// GET /api/alerts/active
router.get('/active', async (req, res) => {
  res.json({ alerts: await listActiveAlerts(), timestamp: new Date().toISOString() });
});

// GET /api/alerts/all
router.get('/all', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ alerts: await listAllAlerts({ limit }), timestamp: new Date().toISOString() });
});

// GET /api/alerts/equipment/:id
router.get('/equipment/:id', async (req, res) => {
  res.json({ alerts: await listAlertsByEquipment(req.params.id) });
});

// POST /api/alerts/:id/acknowledge
router.post('/:id/acknowledge', async (req, res) => {
  const alert = await acknowledgeAlertById(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const io = req.app.get('io');
  io.emit('alert_acknowledged', { id: alert.id, equipment_id: alert.equipment_id });
  res.json({ success: true, alert });
});

module.exports = router;
