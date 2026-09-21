// src/components/FleetOverview.jsx



const SEV_COLOR = { NORMAL:'#22c55e', WARNING:'#f59e0b', CAUTION:'#f97316', CRITICAL:'#ef4444' };
const SEV_BG    = { NORMAL:'#052e16', WARNING:'#451a03', CAUTION:'#431407', CRITICAL:'#450a0a' };

function TruckCard({ truck, onClick }) {
  const sev   = truck.severity || 'NORMAL';
  const color = SEV_COLOR[sev];
  const bg    = SEV_BG[sev];
  const score = (truck.anomaly_score * 100).toFixed(0);
  const rul   = truck.rul_hours ?? '—';
  const snap  = truck.feature_snapshot || {};

  return (
    <div className="truck-card" onClick={() => onClick(truck.equipment_id)}
      style={{ borderColor: color, backgroundColor: bg }}>

      <div className="truck-card__header">
        <div>
          <div className="truck-card__id">{truck.equipment_id}</div>
          <div className="truck-card__name">{truck.name}</div>
          <div className="truck-card__model">{truck.model}</div>
        </div>
        <div className="sev-badge" style={{ backgroundColor: color }}>
          {sev}
        </div>
      </div>

      <div className="truck-card__meters">
        {/* Anomaly score bar */}
        <div className="meter-label">Anomaly Score</div>
        <div className="meter-bar">
          <div className="meter-fill" style={{ width: `${score}%`, backgroundColor: color }} />
        </div>
        <div className="meter-val" style={{ color }}>{score}%</div>

        {/* RUL gauge */}
        <div className="meter-label" style={{ marginTop: 8 }}>Remaining Useful Life</div>
        <div className="rul-val" style={{ color }}>
          {typeof rul === 'number' ? `${rul.toFixed(0)}h` : rul}
        </div>
      </div>

      {snap.temperature_mean && (
        <div className="truck-card__sensors">
          <SensorPill label="Temp"  val={`${parseFloat(snap.temperature_mean).toFixed(1)}°C`} />
          <SensorPill label="RPM"   val={Math.round(snap.rpm_mean)} />
          <SensorPill label="Vib"   val={parseFloat(snap.vibration_magnitude || 0).toFixed(3)} />
          <SensorPill label="Fuel"  val={`${parseFloat(snap.fuel_efficiency_mean || 0).toFixed(1)}k/L`} />
        </div>
      )}

      <div className="truck-card__msg">{truck.message || 'Awaiting data...'}</div>
      {truck.reading_count > 0 && (
        <div className="truck-card__count">Readings: {truck.reading_count}</div>
      )}
    </div>
  );
}

function SensorPill({ label, val }) {
  return (
    <div className="sensor-pill">
      <span className="sensor-pill__label">{label}</span>
      <span className="sensor-pill__val">{val}</span>
    </div>
  );
}

export default function FleetOverview({ fleet, predictions, onSelectTruck }) {
  const counts = { NORMAL:0, WARNING:0, CAUTION:0, CRITICAL:0 };
  fleet.forEach(t => { counts[t.severity] = (counts[t.severity]||0) + 1; });

  return (
    <div className="fleet-view">
      {/* Summary strip */}
      <div className="fleet-summary">
        {Object.entries(counts).map(([sev, cnt]) => (
          <div key={sev} className="fleet-summary__item">
            <div className="fleet-summary__count" style={{ color: SEV_COLOR[sev] }}>{cnt}</div>
            <div className="fleet-summary__label">{sev}</div>
          </div>
        ))}
        <div className="fleet-summary__item">
          <div className="fleet-summary__count" style={{ color: '#94a3b8' }}>{fleet.length}</div>
          <div className="fleet-summary__label">TOTAL</div>
        </div>
      </div>

      {/* Truck grid */}
      <div className="truck-grid">
        {fleet.length === 0
          ? <div className="empty-state">Connecting to backend...</div>
          : fleet.map(t => (
              <TruckCard key={t.equipment_id} truck={t}
                prediction={predictions[t.equipment_id]}
                onClick={onSelectTruck} />
            ))
        }
      </div>
    </div>
  );
}
