/**
 * routes/alerts.js  —  Alert REST endpoints
 */
const express = require('express');
const router  = express.Router();
const {
  getActiveAlerts,
  getAllAlerts,
  acknowledgeAlert,
  getAlertsByEquipment,
} = require('../services/alertService');

// GET /api/alerts/active
router.get('/active', (req, res) => {
  res.json({ alerts: getActiveAlerts(), timestamp: new Date().toISOString() });
});

// GET /api/alerts/all
router.get('/all', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ alerts: getAllAlerts({ limit }), timestamp: new Date().toISOString() });
});

// GET /api/alerts/equipment/:id
router.get('/equipment/:id', (req, res) => {
  res.json({ alerts: getAlertsByEquipment(req.params.id) });
});

// POST /api/alerts/:id/acknowledge
router.post('/:id/acknowledge', (req, res) => {
  const alert = acknowledgeAlert(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const io = req.app.get('io');
  io.emit('alert_acknowledged', { id: alert.id, equipment_id: alert.equipment_id });
  res.json({ success: true, alert });
});

module.exports = router;
