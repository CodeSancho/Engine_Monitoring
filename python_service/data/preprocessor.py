"""
preprocessor.py
Handles ziya07 engine failure dataset and NASA CMAPSS FD001.
Outputs a unified schema for the feature engineering pipeline.

FIXES APPLIED (see conversation for full reasoning):
  1. Torque rename key corrected: raw column is 'Torque', not 'Torque (Nm)'.
     The old mapping silently failed to match, so Torque_Nm never existed
     downstream and torque was dropped from every model, invisibly.
  2. CMAPSS RUL now uses piecewise-linear capping at RUL_CAP cycles instead
     of raw linear countdown. Uncapped RUL asks the regressor to learn
     precise values during the "healthy plateau" phase where sensors show
     no distinguishing signal -- validated by sensor_11 trend inspection.
"""

import os, logging
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
import joblib

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

ZIYA_SENSORS = ['Temperature_C','RPM','Fuel_Efficiency',
                 'Vibration_X','Vibration_Y','Vibration_Z',
                 'Torque_Nm','Power_Output_kW']

CMAPSS_SENSORS = ['s2','s3','s4','s7','s8','s9',
                   's11','s12','s13','s14','s15','s17','s20','s21']

CMAPSS_ALL_COLS = (
    ['engine_id','cycle','setting_1','setting_2','setting_3'] +
    [f's{i}' for i in range(1, 22)]
)

RUL_CAP = 125  # Heimes (2008) standard for FD001, makes MAE comparable to published baselines.


class Preprocessor:

    def __init__(self, scaler_path=None):
        self.scaler      = MinMaxScaler()
        self.scaler_path = scaler_path
        self._fitted     = False

    def load_ziya07(self, filepath):
        """Load and clean the ziya07 engine failure dataset."""
        log.info(f"Loading ziya07: {filepath}")
        df = pd.read_csv(filepath)
        df.columns = [c.strip() for c in df.columns]

        # FIX 1: 'Torque' (not 'Torque (Nm)') is the real raw column name.
        rename = {
            'Temperature (°C)':  'Temperature_C',
            'Torque':             'Torque_Nm',
            'Power_Output (kW)': 'Power_Output_kW',
        }
        df = df.rename(columns=rename)

        # Guardrail: fail loudly instead of silently dropping a sensor if a
        # future raw-file schema change breaks this rename again.
        missing = [c for c in ZIYA_SENSORS if c not in df.columns]
        assert not missing, f"Expected sensor columns missing after rename: {missing}"

        df['failure'] = (df['Fault_Condition'] > 0).astype(int)

        if 'Time_Stamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['Time_Stamp'])
        else:
            df['timestamp'] = pd.date_range('2024-01-01 06:00', periods=len(df), freq='5min')

        df['equipment_id'] = df['Operational_Mode'] if 'Operational_Mode' in df.columns else 'ENGINE-001'

        df = df.sort_values('timestamp').reset_index(drop=True)
        df = self._clean_ziya07(df)

        log.info(f"After cleaning: {df.shape}  normal={(df['failure']==0).sum()}  fault={(df['failure']==1).sum()}")
        return df

    def load_cmapss(self, filepath):
        """Load NASA CMAPSS FD001 and compute piecewise-linear RUL for every row."""
        log.info(f"Loading CMAPSS: {filepath}")
        rows = []
        with open(filepath) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 26:
                    rows.append([float(p) for p in parts[:26]])

        df = pd.DataFrame(rows, columns=CMAPSS_ALL_COLS)
        df['engine_id'] = df['engine_id'].astype(int)
        df['cycle']     = df['cycle'].astype(int)

        # FIX 2: piecewise-linear RUL, capped, not raw linear countdown.
        max_cycles  = df.groupby('engine_id')['cycle'].max()
        rul_linear  = df['engine_id'].map(max_cycles) - df['cycle']
        df['rul']   = np.minimum(rul_linear, RUL_CAP)
        df['failure'] = (rul_linear == 0).astype(int)  # true end-of-life flag, independent of the cap

        keep = ['engine_id','cycle','rul','failure'] + CMAPSS_SENSORS
        df   = df[keep]

        log.info(f"CMAPSS shape: {df.shape}  engines: {df['engine_id'].nunique()}  "
                 f"RUL range: {df['rul'].min()}-{df['rul'].max()} (capped at {RUL_CAP})")
        return df

    def fit_scale_ziya07(self, df):
        df = df.copy()
        cols = [c for c in ZIYA_SENSORS if c in df.columns]
        df[cols] = self.scaler.fit_transform(df[cols])
        self._fitted = True
        if self.scaler_path:
            self._save_scaler('ziya07_scaler.pkl')
        return df

    def fit_scale_cmapss(self, df):
        df = df.copy()
        cols = [c for c in CMAPSS_SENSORS if c in df.columns]
        scaler = MinMaxScaler()
        df[cols] = scaler.fit_transform(df[cols])
        if self.scaler_path:
            path = os.path.join(os.path.dirname(self.scaler_path), 'cmapss_scaler.pkl')
            joblib.dump(scaler, path)
            log.info(f"CMAPSS scaler saved -> {path}")
        return df, scaler

    def _clean_ziya07(self, df):
        """
        NOTE: 3xIQR outlier clipping REMOVED (see conversation).
        Clipping statistical outliers before Isolation Forest training
        directly removes the extreme readings the model is meant to learn
        to flag -- backwards for an anomaly-detection pipeline. Only
        drop true nulls here; leave outlier/anomaly judgment to the model.
        """
        n0 = len(df)
        avail = [c for c in ZIYA_SENSORS if c in df.columns]
        df = df.dropna(subset=avail)
        log.info(f"Cleaned ziya07 (nulls only, no outlier clipping): {n0} -> {len(df)}")
        return df.reset_index(drop=True)

    def _save_scaler(self, name='scaler.pkl'):
        path = os.path.join(os.path.dirname(self.scaler_path), name) if self.scaler_path else name
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        joblib.dump(self.scaler, path)
        log.info(f"Scaler saved -> {path}")


if __name__ == '__main__':
    # Portable root resolution: this file lives at
    # ENGINE_MONTORING/python_service/data/preprocessor.py, so the project
    # root is two directories up. Using __file__ (this file's own path)
    # instead of a hardcoded string means this works on ANY machine --
    # your laptop, Skywave's server, another dev's clone of the repo --
    # without ever needing to know that machine's folder layout in advance.
    ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    pp = Preprocessor()
    z = pp.load_ziya07(os.path.join(ROOT, 'data', 'raw', 'engine_failure_dataset.csv'))
    print("\nziya07 sample (torque should now be present and populated):")
    print(z[ZIYA_SENSORS].head(3).to_string())

    c = pp.load_cmapss(os.path.join(ROOT, 'data', 'raw', 'train_FD001.txt'))
    print("\nCMAPSS sample (rul should now be capped at 125):")
    print(c[['engine_id','cycle','rul']].head(3).to_string())
    print(f"\nMax RUL in dataset: {c['rul'].max()} (should be exactly 125)")
