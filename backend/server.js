/**
 * server.js  —  Mopani Engine Monitoring Backend  (port 3000)
 * ============================================================
 * Orchestrates:
 *  - REST API  (Express)
 *  - WebSocket streaming (Socket.io)
 *  - Simulator replaying CSV sensor data as live stream
 *  - Prediction calls to Flask ML microservice
 *  - Alert management
 */

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const { Server } = require('socket.io');
const path       = require('path');


const { startSimulator }     = require('./services/simulatorService');
const { initAlertStore }     = require('./services/alertService');
const fleetRoutes            = require('./routes/fleet');
const alertRoutes            = require('./routes/alerts');
const { setupWebSocket }     = require('./websocket/liveStream');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT        = process.env.PORT        || 3000;
const FLASK_URL   = process.env.FLASK_URL   || 'http://localhost:5001';
const DATA_PATH   = process.env.DATA_PATH   ||
  path.join(__dirname, '../data/raw/engine_failure_dataset.csv');

app.use(cors());
app.use(express.json());

// ── Make io and config available to routes ──────────────────────────────────
app.set('io',       io);
app.set('flaskUrl', FLASK_URL);

// ── REST Routes ──────────────────────────────────────────────────────────────
app.use('/api/fleet',  fleetRoutes);
app.use('/api/alerts', alertRoutes);
const rulDemoRoutes = require('./routes/rulDemo');
app.use('/api/rul-demo', rulDemoRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    services: {
      backend:  'running',
      flaskUrl: FLASK_URL,
    }
  });
});

app.get('/api/model-info', async (req, res) => {
  const axios = require('axios');
  try {
    const r = await axios.get(`${FLASK_URL}/model-info`, { timeout: 3000 });
    res.json(r.data);
  } catch {
    res.json({ error: 'Flask ML service not reachable' });
  }
});

// ── WebSocket ────────────────────────────────────────────────────────────────
setupWebSocket(io);

// ── Start simulator ──────────────────────────────────────────────────────────
initAlertStore();

// Start simulator after 1 second to let server bind
setTimeout(() => {
  startSimulator({ io, flaskUrl: FLASK_URL, dataPath: DATA_PATH });
}, 1000);

// ── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════════╗`);
  console.log(`║  Mopani Engine Monitoring Backend                 ║`);
  console.log(`║  REST API  : http://localhost:${PORT}               ║`);
  console.log(`║  WebSocket : ws://localhost:${PORT}                 ║`);
  console.log(`║  Flask ML  : ${FLASK_URL}              ║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);
});

module.exports = { app, server, io };
