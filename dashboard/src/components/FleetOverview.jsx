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
//  4. STYLE PASS: removed the top summary strip (NORMAL / ANOMALY /
//     TOTAL counts) per request -- the grid of engine cards below
//     already shows each truck's own status, so the legend was a
//     redundant extra readout.
import EngineSensorCard from './Enginesensorcard';

export default function FleetOverview({ fleet, onSelectTruck }) {
  return (
    <div className="fleet-view">
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