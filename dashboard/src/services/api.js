
import axios from 'axios';
import { io }  from 'socket.io-client';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({ baseURL: BASE });

export const socket = io(BASE, { transports: ['websocket', 'polling'] });


export const fetchFleetStatus  = () => api.get('/api/fleet/status').then(r => r.data);
export const fetchFleetSummary = () => api.get('/api/fleet/summary').then(r => r.data);
export const fetchTruck        = id  => api.get(`/api/fleet/${id}`).then(r => r.data);
export const fetchTruckReadings = (id, limit=60) =>
  api.get(`/api/fleet/${id}/readings?limit=${limit}`).then(r => r.data);
export const fetchActiveAlerts = () => api.get('/api/alerts/active').then(r => r.data);
export const fetchAllAlerts    = (limit=50) => api.get(`/api/alerts/all?limit=${limit}`).then(r => r.data);
export const acknowledgeAlert  = id  => api.post(`/api/alerts/${id}/acknowledge`).then(r => r.data);
export const acknowledgeAllAlerts = () => api.post('/api/alerts/acknowledge-all').then(r => r.data);
export const fetchModelInfo    = () => api.get('/api/model-info').then(r => r.data);








export const fetchComponentRulEngines = () => api.get('/api/component-rul/engines').then(r => r.data);
export const fetchComponentRul = engineId => api.get(`/api/component-rul/${engineId}`).then(r => r.data);





export const injectAnomaly = ({ equipment_id, sensors }) =>
  api.post('/api/inject', { equipment_id, sensors }).then(r => r.data);




export const fetchInjectSensorInfo = () => api.get('/api/inject/sensor-info').then(r => r.data);
