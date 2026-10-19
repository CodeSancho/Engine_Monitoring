
















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




const SUFFIXES = ['_slope', '_mean', '_std', '_min', '_max', '_range'];
export function baseSensorKey(featureKey) {
  let key = featureKey.trim();
  for (const suf of SUFFIXES) {
    if (key.endsWith(suf)) return key.slice(0, -suf.length);
  }
  return key;
}





export function getComponentInfo(featureKeyOrString) {
  const key = baseSensorKey(featureKeyOrString.split(':')[0].trim());
  return COMPONENT_MAP[key] || null;
}