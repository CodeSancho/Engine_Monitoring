const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const datasetPath = path.join(root, 'data', 'raw', 'synthetic_anomaly_records.csv');
const text = fs.readFileSync(datasetPath, 'utf8');
const newline = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.trimEnd().split(/\r?\n/);
const header = lines[0].split(',');
const index = Object.fromEntries(header.map((name, i) => [name, i]));
const variants = {
  overheating: ['overheating', 'coolant_leak', 'radiator_restriction'],
  injector_fault: ['injector_fault', 'fuel_filter_blockage', 'exhaust_restriction'],
  mechanical_binding: ['mechanical_binding', 'transmission_slip'],
  oil_pressure_drop: ['oil_pressure_drop', 'oil_pump_wear'],
  sensor_fault: ['unclassified_anomaly'],
  turbo_loss: ['unclassified_anomaly'],
};

const eventLabels = new Map();
const nextVariant = new Map();
const labelCounts = new Map();
for (let i = 1; i < lines.length; i++) {
  const cells = lines[i].split(',');
  if (cells[index.is_anomaly] !== '1') continue;
  const oldType = cells[index.anomaly_type];
  const options = variants[oldType];
  if (!options) continue;

  const eventKey = [cells[index.split], cells[index.engine_id], cells[index.event_id], oldType].join('|');
  if (!eventLabels.has(eventKey)) {
    const counterKey = `${cells[index.split]}|${oldType}`;
    const next = nextVariant.get(counterKey) || 0;
    eventLabels.set(eventKey, options[next % options.length]);
    nextVariant.set(counterKey, next + 1);
  }
  cells[index.anomaly_type] = eventLabels.get(eventKey);
  labelCounts.set(cells[index.anomaly_type], (labelCounts.get(cells[index.anomaly_type]) || 0) + 1);
  lines[i] = cells.join(',');
}

const updated = `${lines.join(newline)}${newline}`;
const temporaryPath = `${datasetPath}.tmp`;
fs.writeFileSync(temporaryPath, updated, 'utf8');
fs.renameSync(temporaryPath, datasetPath);

const datasetHash = crypto.createHash('sha256').update(updated, 'utf8').digest('hex');
for (const metadataPath of [
  path.join(root, 'saved_models', 'synthetic_anomaly_model_metadata.json'),
  path.join(root, 'data', 'processed', 'isolation_forest_results.json'),
]) {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  metadata.dataset_sha256 = datasetHash;
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

console.log(`Updated ${eventLabels.size} anomaly events; SHA-256 ${datasetHash}`);
console.log([...labelCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
  .map(([type, count]) => `${type}: ${count}`).join('\n'));
