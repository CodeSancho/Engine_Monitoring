// src/components/FleetOverview.jsx
//

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