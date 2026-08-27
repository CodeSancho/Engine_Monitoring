// src/App.jsx
import { useState, useEffect, useCallback } from 'react';
import { socket, fetchFleetStatus, fetchActiveAlerts } from './services/api';
import FleetOverview   from './components/FleetOverview';
import TruckDetail     from './components/TruckDetail';
import AlertPanel      from './components/AlertPanel';
import Header          from './components/Header';
import ModelInfo       from './components/ModelInfo';
import './index.css';

export default function App() {
  const [view,         setView]         = useState('fleet');
  const [selectedTruck,setSelectedTruck]= useState(null);
  const [fleet,        setFleet]        = useState([]);
  const [alerts,       setAlerts]       = useState([]);
  const [predictions,  setPredictions]  = useState({});
  const [sensorHistory,setSensorHistory]= useState({});
  const [connected,    setConnected]    = useState(false);

  const loadFleet = useCallback(async () => {
    try { const d = await fetchFleetStatus(); setFleet(d.trucks || []); } catch {}
  }, []);

  const loadAlerts = useCallback(async () => {
    try { const d = await fetchActiveAlerts(); setAlerts(d.alerts || []); } catch {}
  }, []);

  useEffect(() => {
    loadFleet(); loadAlerts();
    const p = setInterval(() => { loadFleet(); loadAlerts(); }, 8000);
    return () => clearInterval(p);
  }, [loadFleet, loadAlerts]);

  useEffect(() => {
    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('prediction', data => {
      setPredictions(prev => ({ ...prev, [data.equipment_id]: data }));
      setFleet(prev => prev.map(t => t.equipment_id === data.equipment_id
        ? { ...t, severity: data.severity, anomaly_score: data.anomaly_score,
            rul_hours: data.rul_hours, message: data.message,
            reading_count: data.reading_count, feature_snapshot: data.feature_snapshot }
        : t));
    });
    socket.on('sensor_reading', data => {
      setSensorHistory(prev => {
        const hist = prev[data.equipment_id] || [];
        return { ...prev, [data.equipment_id]: [...hist, { ...data.reading, ts: Date.now() }].slice(-60) };
      });
    });
    socket.on('new_alert', alert => setAlerts(prev => [alert, ...prev].slice(0, 100)));
    socket.on('alert_acknowledged', ({ id }) => setAlerts(prev => prev.filter(a => a.id !== id)));
    return () => socket.off();
  }, []);

  const sorted = [...fleet].sort((a, b) => {
    const o = { CRITICAL: 0, CAUTION: 1, WARNING: 2, NORMAL: 3 };
    return (o[a.severity] ?? 4) - (o[b.severity] ?? 4);
  });

  const activeAlertCount = alerts.filter(a => !a.acknowledged).length;
  const openTruck = id => { setSelectedTruck(id); setView('truck'); };
  const goFleet   = ()  => { setView('fleet'); setSelectedTruck(null); };

  return (
    <div className="app">
      <Header connected={connected} activeAlerts={activeAlertCount}
        view={view} setView={setView} goFleet={goFleet} />
      <main className="main-content">
        {view === 'fleet'  && <FleetOverview fleet={sorted} predictions={predictions} onSelectTruck={openTruck} />}
        {view === 'truck'  && selectedTruck && <TruckDetail truckId={selectedTruck} fleet={fleet}
            prediction={predictions[selectedTruck]} sensorHistory={sensorHistory[selectedTruck] || []} onBack={goFleet} />}
        {view === 'alerts' && <AlertPanel alerts={alerts}
            onAcknowledge={id => setAlerts(prev => prev.filter(a => a.id !== id))} onSelectTruck={openTruck} />}
        {view === 'model'  && <ModelInfo />}
      </main>
    </div>
  );
}
