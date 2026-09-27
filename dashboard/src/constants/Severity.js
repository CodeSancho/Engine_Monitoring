// src/constants/severity.js
//
// Single source of truth for severity -> color mapping. Previously
// duplicated (inconsistently) across TruckDetail.jsx, AlertPanel.jsx,
// EngineSensorCard.jsx, and AnomalyInjector.jsx -- one copy had no
// 'ANOMALY' entry at all and fell through to green, the same color as
// NORMAL. Import from here instead of redefining SEV_COLOR locally, so
// a future palette tweak (or bug fix) only has to happen once.
export const SEV_COLOR = { NORMAL: '#5f9b74', ANOMALY: '#b25c53' };

// Every consumer had its own slightly-different fallback for an
// unrecognized severity ('#94a3b8', '#94a0a8', 'var(--text3)', ...).
// Centralized here too -- always a neutral gray, never green or red.
const FALLBACK_COLOR = 'var(--text3)';

export function getSeverityColor(sev) {
  return SEV_COLOR[sev] || FALLBACK_COLOR;
}