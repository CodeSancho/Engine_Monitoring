







export const SEV_COLOR = {
  NORMAL: '#5f9b74',
  TAKE_NOTE: '#c28b35',
  CRITICAL: '#b25c53',
  WARNING: '#b25c53',
  ANOMALY: '#b25c53',
};




const FALLBACK_COLOR = 'var(--text3)';

export function getSeverityColor(sev) {
  return SEV_COLOR[sev] || FALLBACK_COLOR;
}