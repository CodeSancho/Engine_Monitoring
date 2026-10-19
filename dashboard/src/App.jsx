
import { useState, useEffect, useCallback } from 'react';
import { socket, fetchFleetStatus, fetchActiveAlerts, fetchTruckReadings } from './services/api';
import FleetOverview   from './components/FleetOverview';
import TruckDetail     from './components/TruckDetail';
import AlertPanel      from './components/AlertPanel';
import Header          from './components/Header';
import ModelInfo       from './components/ModelInfo';
import ComponentRulDashboard from './components/ComponentRulDashboard';
import AnomalyInjector from './components/Anomalyinjector';
import Login from './components/Login';
import './index.css';

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem('engine-monitoring-auth') === 'true');
  const [view,         setView]         = useState('fleet');
  const [selectedTruck,setSelectedTruck]= useState(null);
  const [fleet,        setFleet]        = useState([]);
  const [alerts,       setAlerts]       = useState([]);
  const [predictions,  setPredictions]  = useState({});
  const [sensorHistory,setSensorHistory]= useState({});
  const [connected,    setConnected]    = useState(false);

  const loadFleet = useCallback(async () => {
    try { const d = await fetchFleetStatus(); setFleet(d.trucks || []); }
    catch (error) { console.error('Failed to load fleet status:', error); }
  }, []);

  const loadAlerts = useCallback(async () => {
    try { const d = await fetchActiveAlerts(); setAlerts(d.alerts || []); }
    catch (error) { console.error('Failed to load alerts:', error); }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => { loadFleet(); loadAlerts(); }, 0);
    const p = setInterval(() => { loadFleet(); loadAlerts(); }, 8000);
    return () => { clearTimeout(initialLoad); clearInterval(p); };
  }, [loadFleet, loadAlerts]);

  useEffect(() => {
    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('prediction', data => {
      setPredictions(prev => ({ ...prev, [data.equipment_id]: data }));
      const fleetMessage = String(data.message || '')
        .replace(/\s*Likely part:.*?\.\s*Cause:.*?\.?$/i, '')
        .trim();
      setFleet(prev => prev.map(t => t.equipment_id === data.equipment_id
        ? { ...t, severity: data.severity, anomaly_score: data.anomaly_score,
            message: fleetMessage,
            reading_count: data.reading_count, feature_snapshot: data.feature_snapshot }
        : t));
    });
    socket.on('sensor_reading', data => {
      setFleet(prev => prev.map(t => t.equipment_id === data.equipment_id
        ? { ...t, reading_count: data.reading_count ?? (Number(t.reading_count) || 0) + 1 }
        : t));
      setSensorHistory(prev => {
        const hist = prev[data.equipment_id] || [];
        return { ...prev, [data.equipment_id]: [...hist, { ...data.reading, ts: Date.now() }].slice(-20) };
      });
    });
    socket.on('new_alert', alert => setAlerts(prev => [alert, ...prev].slice(0, 100)));
    socket.on('alert_updated', alert => setAlerts(prev => prev.map(item =>
      item.id === alert.id ? { ...item, ...alert } : item)));
    socket.on('alert_acknowledged', ({ id }) => setAlerts(prev => prev.filter(a => a.id !== id)));
    socket.on('alerts_cleared', ({ ids = [] }) => {
      const cleared = new Set(ids.map(Number));
      setAlerts(prev => prev.filter(alert => !cleared.has(Number(alert.id))));
    });
    return () => socket.off();
  }, []);

  const sorted = [...fleet].sort((a, b) => {
    const o = { CRITICAL: 0, WARNING: 0, ANOMALY: 0, TAKE_NOTE: 1, NORMAL: 2 };
    return (o[a.severity] ?? 4) - (o[b.severity] ?? 4);
  });

  const activeAlertCount = alerts.filter(a => !a.acknowledged).length;
  const openTruck = id => {
    setSelectedTruck(id);
    setView('truck');
    fetchTruckReadings(id).then(({ readings = [] }) => {
      setSensorHistory(prev => {
        const live = prev[id] || [];
        const byTimestamp = new Map();
        [...readings, ...live].forEach(reading => {
          const key = reading.timestamp || reading.ts;
          byTimestamp.set(key, reading);
        });
        return {
          ...prev,
          [id]: [...byTimestamp.values()]
            .sort((a, b) => new Date(a.timestamp || a.ts) - new Date(b.timestamp || b.ts))
            .slice(-20),
        };
      });
    }).catch(err => {
      console.warn(`[Dashboard] Could not load saved readings for ${id}:`, err.message);
    });
  };
  const goFleet   = ()  => { setView('fleet'); setSelectedTruck(null); };

  if (!authenticated) return <Login onLogin={() => { sessionStorage.setItem('engine-monitoring-auth', 'true'); setAuthenticated(true); }} />;

  return (
    <div className="app">
      <Header connected={connected} activeAlerts={activeAlertCount}
        view={view} setView={setView} goFleet={goFleet}
        onLogout={() => { sessionStorage.removeItem('engine-monitoring-auth'); setAuthenticated(false); }} />
      <main className="main-content">
        {view === 'fleet'  && <FleetOverview fleet={sorted} predictions={predictions} onSelectTruck={openTruck} />}
        {view === 'truck'  && selectedTruck && <TruckDetail truckId={selectedTruck} fleet={fleet}
            prediction={predictions[selectedTruck]} sensorHistory={sensorHistory[selectedTruck] || []} onBack={goFleet} />}
        {view === 'alerts' && <AlertPanel alerts={alerts} fleet={fleet}
            onAcknowledge={id => setAlerts(prev => prev.filter(a => a.id !== id))} onSelectTruck={openTruck} />}
        {view === 'model'  && <ModelInfo />}
        {view === 'rul'    && <ComponentRulDashboard />}
        {view === 'inject' && <AnomalyInjector />}
      </main>
    </div>
  );
}
