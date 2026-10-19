"""Feature pipeline for the labelled, multi-engine synthetic anomaly dataset."""

import numpy as np
import pandas as pd


SENSOR_COLUMNS = [
    'payload_t', 'speed_kmh', 'total_resistance_pct', 'ambient_C',
    'Temperature_C', 'Exhaust_Temp_C', 'RPM', 'Torque_Nm',
    'Power_Output_kW', 'Fuel_Consumption_Lph', 'Fuel_Efficiency_km_per_L',
    'Oil_Pressure_kPa', 'Boost_Pressure_kPa',
    'Vibration_X', 'Vibration_Y', 'Vibration_Z',
]
WINDOW_SIZE = 30  # 30 five-minute records = a 150-minute monitoring window
WINDOW_STEP = 5


def load_dataset(path):
    frame = pd.read_csv(path)
    required = {'engine_id', 'record', 'timestamp', 'is_anomaly', 'split', *SENSOR_COLUMNS}
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise ValueError(f'Synthetic anomaly dataset is missing columns: {missing}')

    frame['timestamp'] = pd.to_datetime(frame['timestamp'], errors='coerce')
    for column in SENSOR_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors='coerce')
    frame['record'] = pd.to_numeric(frame['record'], errors='coerce')
    frame['is_anomaly'] = pd.to_numeric(frame['is_anomaly'], errors='coerce')
    frame = frame.dropna(subset=['engine_id', 'record', 'timestamp', 'is_anomaly', *SENSOR_COLUMNS])
    frame['is_anomaly'] = frame['is_anomaly'].astype(int)
    frame['split'] = frame['split'].astype(str).str.strip().str.lower()
    frame = frame[frame['split'].isin(['train', 'val', 'test'])]
    frame = frame.sort_values(['engine_id', 'record', 'timestamp']).drop_duplicates(
        ['engine_id', 'timestamp'], keep='first')

    split_counts = frame.groupby('engine_id')['split'].nunique()
    if (split_counts != 1).any():
        raise ValueError('Each engine_id must belong to exactly one dataset split.')
    return frame.reset_index(drop=True)


def _features(values):
    x = np.arange(values.shape[0], dtype=float)
    x -= x.mean()
    slope = (x[:, None] * values).sum(axis=0) / max(float((x * x).sum()), 1e-12)

    result = {}
    for index, column in enumerate(SENSOR_COLUMNS):
        series = values[:, index]
        result[f'{column}_mean'] = float(series.mean())
        result[f'{column}_std'] = float(series.std())
        result[f'{column}_min'] = float(series.min())
        result[f'{column}_max'] = float(series.max())
        result[f'{column}_slope'] = float(slope[index])
        result[f'{column}_range'] = float(series.max() - series.min())

    mean = {column: result[f'{column}_mean'] for column in SENSOR_COLUMNS}
    result['vibration_magnitude'] = float(np.sqrt(sum(mean[k] ** 2 for k in
        ('Vibration_X', 'Vibration_Y', 'Vibration_Z'))))
    result['power_efficiency'] = mean['Power_Output_kW'] / max(
        mean['Torque_Nm'] * mean['RPM'] / 9549, 1e-9)
    result['thermal_load_per_rpm'] = mean['Temperature_C'] / max(mean['RPM'], 1e-9)
    return result


def build_windows(frame, split):
    """Build independent windows within each engine; never cross engine IDs."""
    rows = []
    subset = frame[frame['split'] == split]
    for engine_id, engine in subset.groupby('engine_id', sort=True):
        engine = engine.sort_values(['record', 'timestamp']).reset_index(drop=True)
        values = engine[SENSOR_COLUMNS].to_numpy(dtype=float)
        labels = engine['is_anomaly'].to_numpy(dtype=int)
        records = engine['record'].to_numpy(dtype=int)
        for end in range(WINDOW_SIZE - 1, len(engine), WINDOW_STEP):
            features = _features(values[end - WINDOW_SIZE + 1:end + 1])
            features.update({
                'engine_id': int(engine_id),
                'window_end_record': int(records[end]),
                'is_anomaly': int(labels[end]),
            })
            rows.append(features)
    return pd.DataFrame(rows)


def feature_columns(windows):
    excluded = {'engine_id', 'window_end_record', 'is_anomaly'}
    return [column for column in windows.columns if column not in excluded]
