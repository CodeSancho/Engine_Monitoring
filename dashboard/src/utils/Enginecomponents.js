
















export const COMPONENT_MAP = {
  Temperature_C: {
    component: 'Cooling System',
    detail: 'radiator, coolant circuit, thermostat',
    note: 'Sustained high readings here commonly point to the cooling circuit rather than the engine core itself.',
  },
  Exhaust_Temp_C: {
    component: 'Cooling / Combustion System',
    detail: 'coolant circuit, exhaust flow, injectors',
    note: 'High exhaust temperature can indicate cooling restriction or poor fuel atomisation; confirm with fuel and coolant readings.',
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
  Fuel_Efficiency_km_per_L: {
    component: 'Fuel System',
    detail: 'injectors, fuel delivery, combustion efficiency',
    note: 'Reduced efficiency is a fuel/combustion lead and should be checked with consumption and exhaust temperature.',
  },
  Fuel_Consumption_Lph: {
    component: 'Fuel Injection System',
    detail: 'injectors, fuel pressure, combustion control',
    note: 'Unexpected consumption changes commonly point to injector or fuel-delivery problems.',
  },
  Oil_Pressure_kPa: {
    component: 'Lubrication System',
    detail: 'oil pump, filter, galleries, bearing clearance',
    note: 'Low oil pressure is a lubrication-system warning and can become bearing damage if sustained.',
  },
  Boost_Pressure_kPa: {
    component: 'Turbocharger / Air Induction',
    detail: 'turbocharger, intake piping, charge-air system',
    note: 'Low boost with rising consumption points toward turbo or intake restriction/leakage.',
  },
  payload_t: {
    component: 'Load / Drivetrain',
    detail: 'payload, tyres, haul-road resistance',
    note: 'Payload is an operating-load signal, not by itself evidence of a failed drivetrain part.',
  },
  total_resistance_pct: {
    component: 'Load / Drivetrain',
    detail: 'haul-road resistance, tyres, rolling condition',
    note: 'High resistance should be checked as an operating condition before diagnosing transmission damage.',
  },
  speed_kmh: {
    component: 'Engine / Drivetrain Control',
    detail: 'speed control, load response, transmission',
    note: 'Speed deviations need to be interpreted alongside payload, torque and RPM.',
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
