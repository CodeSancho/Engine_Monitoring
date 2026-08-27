"""
feature_engineer.py
Sliding window feature extraction for both ziya07 and CMAPSS datasets.

FIXES APPLIED (see conversation for full reasoning):
  1. ziya07 windowing is now TIME-based (pandas timestamp rolling), not
     row-position-within-Operational_Mode-group. The old approach grouped
     by mode first, which scatters rows across the whole 3.5-day span --
     a "30-row window" ended up spanning up to 7 hours of real time.
  2. window_label now uses the LAST row of the window (Fault_Condition of
     the most recent reading), not .max() across the whole window. A
     window represents "state as of right now" -- consistent with how
     CMAPSS windows are labeled by their last row's RUL.
  3. extract_ziya07_normal_features now filters AFTER building time-correct
     windows (checking the last row's Fault_Condition), not before. Filtering
     raw rows first breaks time-adjacency for the same reason as fix #1.
"""

import os, logging
import numpy as np
import pandas as pd
from scipy import stats as sp_stats

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

WINDOW_SIZE_CMAPSS = 30   # cycles
WINDOW_MINUTES_ZIYA = 30  # real minutes
STEP_SIZE = 5

ZIYA_SENSORS  = ['Temperature_C','RPM','Fuel_Efficiency',
                  'Vibration_X','Vibration_Y','Vibration_Z',
                  'Torque_Nm','Power_Output_kW']

CMAPSS_SENSORS = ['s2','s3','s4','s7','s8','s9',
                   's11','s12','s13','s14','s15','s17','s20','s21']


def _slope(vals):
    if len(vals) < 2: return 0.0
    x = np.arange(len(vals), dtype=float)
    return float(sp_stats.linregress(x, vals.astype(float))[0])


def _window_features(window, sensor_cols):
    feats = {}
    for col in sensor_cols:
        if col not in window.columns: continue
        v = window[col].values.astype(float)
        feats[f'{col}_mean']  = float(np.mean(v))
        feats[f'{col}_std']   = float(np.std(v))
        feats[f'{col}_min']   = float(np.min(v))
        feats[f'{col}_max']   = float(np.max(v))
        feats[f'{col}_slope'] = _slope(v)
        feats[f'{col}_range'] = float(np.max(v) - np.min(v))
    return feats


def _ziya_derived(feats):
    temp  = feats.get('Temperature_C_mean', 1e-9)
    rpm   = feats.get('RPM_mean',           1e-9)
    power = feats.get('Power_Output_kW_mean', 0.0)
    torque= feats.get('Torque_Nm_mean',     1e-9)
    vx    = feats.get('Vibration_X_mean',   0.0)
    vy    = feats.get('Vibration_Y_mean',   0.0)
    vz    = feats.get('Vibration_Z_mean',   0.0)

    feats['vibration_magnitude']  = float(np.sqrt(vx**2 + vy**2 + vz**2))
    feats['power_efficiency']     = power / max(torque * rpm / 9549, 1e-9)
    feats['thermal_load_per_rpm'] = temp  / max(rpm, 1e-9)
    return feats


def _cmapss_derived(feats):
    s2  = feats.get('s2_mean',  1e-9)
    s4  = feats.get('s4_mean',  0.0)
    s8  = feats.get('s8_mean',  1e-9)
    s9  = feats.get('s9_mean',  1e-9)
    s12 = feats.get('s12_mean', 0.0)
    s17 = feats.get('s17_mean', 0.0)

    feats['thermal_efficiency']  = s4  / max(s2, 1e-9)
    feats['speed_ratio']         = s9  / max(s8, 1e-9)
    feats['fuel_thermal_index']  = s12 * s17
    return feats


# ── ziya07: time-based windowing ────────────────────────────────────────────

def _build_ziya_time_windows(df, window_minutes=WINDOW_MINUTES_ZIYA, normal_only=False):
    """
    Shared implementation for both extract_ziya07_features and
    extract_ziya07_normal_features. Windows by real elapsed time, labels
    each window by its LAST row.
    """
    sensor_cols = [c for c in ZIYA_SENSORS if c in df.columns]
    df = df.sort_values('timestamp').reset_index(drop=True)
    indexed = df.set_index('timestamp')
    expected_rows = window_minutes // 5  # 5-min sampling interval, verified earlier

    all_windows = []
    for end_time in indexed.index:
        start_time = end_time - pd.Timedelta(minutes=window_minutes)
        w = indexed.loc[(indexed.index > start_time) & (indexed.index <= end_time)]

        if len(w) < expected_rows:
            continue  # not a genuine full-length window

        last_row_normal = (w['Fault_Condition'].iloc[-1] == 0)
        if normal_only and not last_row_normal:
            continue

        feats = _window_features(w, sensor_cols)
        feats = _ziya_derived(feats)
        feats['window_label']     = int(not last_row_normal)  # labeled by LAST row, not .max()
        feats['fault_severity']   = int(w['Fault_Condition'].iloc[-1])
        feats['operational_mode'] = str(w['Operational_Mode'].iloc[-1]) if 'Operational_Mode' in w.columns else ''
        feats['window_end']       = end_time
        all_windows.append(feats)

    return pd.DataFrame(all_windows).reset_index(drop=True)


def extract_ziya07_features(df, window_minutes=WINDOW_MINUTES_ZIYA, step=STEP_SIZE):
    df_feat = _build_ziya_time_windows(df, window_minutes, normal_only=False)
    log.info(f"ziya07 feature matrix: {df_feat.shape}  "
             f"normal={(df_feat['window_label']==0).sum()}  anomaly={(df_feat['window_label']==1).sum()}")
    return df_feat


def extract_ziya07_normal_features(df, window_minutes=WINDOW_MINUTES_ZIYA, step=STEP_SIZE):
    """Windows filtered to last-row-normal AFTER time-correct windowing (fix #3)."""
    df_feat = _build_ziya_time_windows(df, window_minutes, normal_only=True)
    log.info(f"Normal feature windows: {len(df_feat)}")
    return df_feat


# ── CMAPSS: cycle-based windowing (unchanged, was already correct) ─────────

def extract_cmapss_features(df, window_size=WINDOW_SIZE_CMAPSS, step=STEP_SIZE):
    sensor_cols = [c for c in CMAPSS_SENSORS if c in df.columns]
    all_windows = []

    for eng_id, group in df.groupby('engine_id'):
        group = group.sort_values('cycle').reset_index(drop=True)
        n = len(group)
        if n < window_size:
            log.warning(f"Engine {eng_id}: {n} cycles < window {window_size}, skipping")
            continue

        for start in range(0, n - window_size + 1, step):
            win = group.iloc[start:start + window_size]
            feats = _window_features(win, sensor_cols)
            feats = _cmapss_derived(feats)
            feats['rul']       = int(win['rul'].iloc[-1])  # already last-row-labeled, correct
            feats['engine_id'] = int(eng_id)
            feats['cycle_end'] = int(win['cycle'].iloc[-1])
            all_windows.append(feats)

    df_feat = pd.DataFrame(all_windows).reset_index(drop=True)
    log.info(f"CMAPSS feature matrix: {df_feat.shape}  RUL range: {df_feat['rul'].min()}-{df_feat['rul'].max()}")
    return df_feat


def get_feature_cols_ziya07(df):
    exclude = {'window_label','fault_severity','operational_mode','window_end'}
    return [c for c in df.columns if c not in exclude]


def get_feature_cols_cmapss(df):
    exclude = {'rul','engine_id','cycle_end'}
    return [c for c in df.columns if c not in exclude]


if __name__ == '__main__':
    import sys, os
    # Portable: resolve project root from THIS file's location, not a
    # hardcoded machine-specific path.
    ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.insert(0, ROOT)
    from python_service.data.preprocessor import Preprocessor

    pp = Preprocessor()
    z = pp.load_ziya07(os.path.join(ROOT, 'data', 'raw', 'engine_failure_dataset.csv'))

    zf = extract_ziya07_features(z)
    print(f"\nAll ziya07 windows: {zf.shape}")
    print(f"  Feature cols: {len(get_feature_cols_ziya07(zf))} (should be 8 sensors x 6 stats + 3 derived = 51)")

    zf_norm = extract_ziya07_normal_features(z)
    print(f"\nNormal-only ziya07 windows: {zf_norm.shape}")

    c = pp.load_cmapss(os.path.join(ROOT, 'data', 'raw', 'train_FD001.txt'))
    cf = extract_cmapss_features(c)
    print(f"\nCMAPSS windows: {cf.shape}")
    print(f"  Feature cols: {len(get_feature_cols_cmapss(cf))} (should stay 87)")
