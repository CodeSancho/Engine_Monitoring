// src/services/api.js
import axios from 'axios';
import { io }  from 'socket.io-client';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({ baseURL: BASE });

export const socket = io(BASE, { transports: ['websocket', 'polling'] });

// REST helpers
export const fetchFleetStatus  = () => api.get('/api/fleet/status').then(r => r.data);
export const fetchFleetSummary = () => api.get('/api/fleet/summary').then(r => r.data);
export const fetchTruck        = id  => api.get(`/api/fleet/${id}`).then(r => r.data);
export const fetchActiveAlerts = () => api.get('/api/alerts/active').then(r => r.data);
export const fetchAllAlerts    = (limit=50) => api.get(`/api/alerts/all?limit=${limit}`).then(r => r.data);
export const acknowledgeAlert  = id  => api.post(`/api/alerts/${id}/acknowledge`).then(r => r.data);
export const fetchModelInfo    = () => api.get('/api/model-info').then(r => r.data);

// NEW: RUL model demo -- forwards to backend route that reads a sample
// CMAPSS engine window server-side and calls Flask's /predict_rul_demo.
// Not connected to live engine monitoring -- validated on CMAPSS-native
// data only (see ModelInfo.jsx and project notes).
export const fetchRulDemo = (start = 0) => api.get(`/api/rul-demo?start=${start}`).then(r => r.data);