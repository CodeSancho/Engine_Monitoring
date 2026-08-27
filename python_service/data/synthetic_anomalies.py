"""
synthetic_anomalies_v2.py
FIX over synthetic_anomalies.py: injects perturbations into RAW sensor rows
BEFORE windowing, then runs the actual feature engineering pipeline on the
perturbed raw data. This guarantees every derived/statistical feature
(std, min, max, slope, range, vibration_magnitude, thermal_load_per_rpm,
power_efficiency) is internally consistent with the injected fault -- unlike
the earlier version, which patched only the _mean feature after windowing
and left correlated features stale (proven via thermal_load_per_rpm test).
"""
import sys, os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineer import _build_ziya_time_windows, ZIYA_SENSORS

RAW_SENSOR_STDS_CACHE = {}


def inject_raw_level_anomalies(raw_df: pd.DataFrame, n_windows: int, seed: int = 42) -> pd.DataFrame:
    """
    Takes raw (row-level) ziya07 data, picks n_windows random anchor points
    that are genuinely normal, perturbs the RAW rows feeding into each
    window (all 6 rows, not just the window's summary), then re-runs real
    feature engineering so every derived feature is consistent.
    """
    rng = np.random.RandomState(seed)
    stds = raw_df[[c for c in ZIYA_SENSORS if c in raw_df.columns]].std()

    normal_rows = raw_df[raw_df['Fault_Condition'] == 0].reset_index(drop=True)
    anchor_times = normal_rows['timestamp'].sample(n=n_windows, random_state=seed).values

    fault_types = np.tile(['bearing_wear', 'overheat', 'mechanical_bind'],
                           int(np.ceil(n_windows / 3)))[:n_windows]
    rng.shuffle(fault_types)

    perturbed_frames = []
    for anchor_time, ftype in zip(anchor_times, fault_types):
        anchor_time = pd.Timestamp(anchor_time)
        window_raw = raw_df[(raw_df['timestamp'] > anchor_time - pd.Timedelta(minutes=30)) &
                             (raw_df['timestamp'] <= anchor_time)].copy()
        if len(window_raw) < 6:
            continue

        severity = rng.uniform(3, 5)
        if ftype == 'bearing_wear':
            for col in ['Vibration_X', 'Vibration_Y', 'Vibration_Z']:
                window_raw[col] += severity * stds[col]
        elif ftype == 'overheat':
            window_raw['Temperature_C'] += severity * stds['Temperature_C']
            window_raw['Fuel_Efficiency'] -= severity * stds['Fuel_Efficiency']
        elif ftype == 'mechanical_bind':
            window_raw['Torque_Nm'] += severity * stds['Torque_Nm']
            window_raw['RPM'] -= severity * stds['RPM']

        window_raw['Fault_Condition'] = 0  # keep last row "normal" so it survives the normal_only filter
        window_raw['_injected_fault_type'] = ftype
        window_raw['_window_id'] = f"{ftype}_{anchor_time}"
        perturbed_frames.append(window_raw)

    if not perturbed_frames:
        return pd.DataFrame()

    all_windows_feats = []
    for wdf in perturbed_frames:
        feats_df = _build_ziya_time_windows(wdf, window_minutes=30, normal_only=False)
        if len(feats_df) == 0:
            continue
        feats_df = feats_df.tail(1).copy()  # only the fully-perturbed window
        feats_df['injected_fault_type'] = wdf['_injected_fault_type'].iloc[0]
        all_windows_feats.append(feats_df)

    result = pd.concat(all_windows_feats, ignore_index=True)
    result['window_label'] = 1
    return result


if __name__ == '__main__':
    from preprocessor import Preprocessor
    ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    pp = Preprocessor()
    z = pp.load_ziya07(os.path.join(ROOT, 'data', 'raw', 'engine_failure_dataset.csv'))

    anomalies = inject_raw_level_anomalies(z, n_windows=30)
    print(f"Generated {len(anomalies)} internally-consistent synthetic anomaly windows")
    print()

    # Verify consistency this time
    row = anomalies[anomalies['injected_fault_type']=='overheat'].iloc[[0]]
    print(f"Overheat example: Temperature_C_mean={row['Temperature_C_mean'].values[0]:.2f}, "
          f"thermal_load_per_rpm={row['thermal_load_per_rpm'].values[0]:.6f}")
    print("(this derived feature should now genuinely reflect the perturbed temperature)")
