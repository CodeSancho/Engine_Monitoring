


import EngineSensorCard from './Enginesensorcard';

export default function FleetOverview({ fleet, onSelectTruck }) {
  const enginesInLabelOrder = [...fleet].sort((a, b) =>
    (a.label_number ?? Number.MAX_SAFE_INTEGER) - (b.label_number ?? Number.MAX_SAFE_INTEGER));
  return (
    <div className="fleet-view">
      {                }
      <div className="truck-grid">
        {enginesInLabelOrder.length === 0
          ? <div className="empty-state">Connecting to backend...</div>
          : enginesInLabelOrder.map(t => (
              <EngineSensorCard key={t.equipment_id} truck={t} onSelect={onSelectTruck} />
            ))
        }
      </div>
    </div>
  );
}
