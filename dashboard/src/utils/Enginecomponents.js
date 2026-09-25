// src/utils/engineComponents.js
//
// Translates a sensor/feature name (e.g. "Vibration_X", "Vibration_X_slope")
// into the physical engine component it's actually measuring, so alerts and
// detail views can say "Bearing / Rotating Assembly" instead of just
// "Vibration_X: +0.0234" -- useful to someone who isn't going to mentally
// map sensor column names to hardware themselves.
//
// IMPORTANT ON HONESTY: this is a general, textbook association between a
// sensor type and the subsystem it typically monitors on a diesel haul
// truck engine -- it is NOT a diagnosis, and it is NOT derived from any
// data or model in this project (the anomaly detector has no concept of
// "components" -- it only sees the 8 raw sensor columns). Every label
// below is phrased as "commonly monitors" / "often associated with",
// never "this IS the fault", to avoid implying a certainty the model
// doesn't actually have. Treat this purely as a reader's aid layered on
// top of the real model output, not a new inference.
export const COMPONENT_MAP = {
  Temperature_C: {
    component: 'Cooling System',
    detail: 'radiator, coolant circuit, thermostat',
    note: 'Sustained high readings here commonly point to the cooling circuit rather than the engine core itself.',
  },
  RPM: {
    component: 'Engine Speed Control',
    detail: 'fuel governor, throttle response',
    note: 'Unexpected RPM swings independent of load often trace back to governor or fuel-delivery response, not a mechanical fault.',
  },
  Fuel_Efficiency: {
    component: 'Fuel System',
    detail: 'injectors, combustion efficiency',
    note: 'A drop here alongside rising temperature is a classic combustion-inefficiency signature.',
  },
  Power_Output_kW: {
    component: 'Engine Power Output',
    detail: 'overall combustion / drivetrain output',
    note: 'A composite figure -- worth cross-checking against Torque and RPM before pointing at one part.',
  },
  Vibration_X: {
    component: 'Bearing / Rotating Assembly',
    detail: 'axial vibration -- often thrust bearing or shaft alignment',
    note: 'Axial (X-axis) vibration is commonly associated with thrust-bearing wear or shaft misalignment.',
  },
  Vibration_Y: {
    component: 'Bearing / Rotating Assembly',
    detail: 'radial vibration -- often main/rod bearings or mounting',
    note: 'Radial vibration on this axis commonly reflects main or rod bearing wear, or a loose mount.',
  },
  Vibration_Z: {
    component: 'Bearing / Rotating Assembly',
    detail: 'radial vibration -- often main/rod bearings or mounting',
    note: 'Radial vibration on this axis commonly reflects main or rod bearing wear, or a loose mount.',
  },
  Torque_Nm: {
    component: 'Drivetrain / Transmission',
    detail: 'torque converter, clutch, driveline',
    note: 'A torque spike paired with an RPM drop is the classic signature of a mechanical bind in the driveline.',
  },
};

// Strip predictor.py's feature-engineering suffixes (_slope, _mean, _std,
// _min, _max, _range) to recover the base sensor key, e.g.
// "Vibration_X_slope" -> "Vibration_X".
const SUFFIXES = ['_slope', '_mean', '_std', '_min', '_max', '_range'];
export function baseSensorKey(featureKey) {
  let key = featureKey.trim();
  for (const suf of SUFFIXES) {
    if (key.endsWith(suf)) return key.slice(0, -suf.length);
  }
  return key;
}

// Accepts either a raw sensor key ("Vibration_X") or a feature-engineered
// one ("Vibration_X_slope: +0.0234" or just "Vibration_X_slope"). Returns
// null for anything not in COMPONENT_MAP (e.g. "vibration_magnitude",
// which is a composite, not a single sensor) rather than guessing.
export function getComponentInfo(featureKeyOrString) {
  const key = baseSensorKey(featureKeyOrString.split(':')[0].trim());
  return COMPONENT_MAP[key] || null;
}