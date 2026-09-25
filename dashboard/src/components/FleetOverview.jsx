// src/components/FleetOverview.jsx
//
// FIXES APPLIED (see conversation):
//  1. SEV_COLOR/SEV_BG/counts used the old four-tier severity scheme
//     (NORMAL/WARNING/CAUTION/CRITICAL). Severity is two-tier now
//     (NORMAL/ANOMALY) -- same bug already fixed in AlertPanel.jsx and
//     TruckDetail.jsx, this file was missed.
//  2. truck.rul_hours and truck.model no longer exist (RUL moved to the
//     CMAPSS-only demo in ModelInfo.jsx; "model" naming was dropped) --
//     both references removed.
//  3. TruckCard/SensorPill replaced with EngineSensorCard, which reads
//     truck.feature_snapshot (the fields actually present on a fleet
//     truck) instead of the old rul gauge + 4 flat sensor pills.
import EngineSensorCard from './Enginesensorcard';

const SEV_COLOR = { NORMAL: '#5f9b74', ANOMALY: '#b25c53' };

export default function FleetOverview({ fleet, onSelectTruck }) {
  const counts = { NORMAL: 0, ANOMALY: 0 };
  fleet.forEach(t => { counts[t.severity] = (counts[t.severity] || 0) + 1; });

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
          <div className="fleet-summary__count" style={{ color: '#9aa2ae' }}>{fleet.length}</div>
          <div className="fleet-summary__label">TOTAL</div>
        </div>
      </div>

      {/* Truck grid */}
      <div className="truck-grid">
        {fleet.length === 0
          ? <div className="empty-state">Connecting to backend...</div>
          : fleet.map(t => (
              <EngineSensorCard key={t.equipment_id} truck={t} onSelect={onSelectTruck} />
            ))
        }
      </div>
    </div>
  );
}