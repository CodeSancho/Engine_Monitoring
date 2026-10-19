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
WINDOW_SIZE = 30
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
    """Build vectorized, engine-local windows with any-reading anomaly labels."""
    rows = []
    subset = frame[frame['split'] == split]
    for engine_id, engine in subset.groupby('engine_id', sort=True):
        engine = engine.sort_values(['record', 'timestamp']).reset_index(drop=True)
        values = engine[SENSOR_COLUMNS].to_numpy(dtype=float)
        labels = engine['is_anomaly'].to_numpy(dtype=int)
        records = engine['record'].to_numpy(dtype=int)
        ends = np.arange(WINDOW_SIZE - 1, len(engine), WINDOW_STEP)
        if not len(ends):
            continue
        windows = np.lib.stride_tricks.sliding_window_view(values, WINDOW_SIZE, axis=0)[ends - WINDOW_SIZE + 1]
        mean = windows.mean(axis=2)
        std = windows.std(axis=2)
        minimum = windows.min(axis=2)
        maximum = windows.max(axis=2)
        x = np.arange(WINDOW_SIZE, dtype=float) - (WINDOW_SIZE - 1) / 2
        slopes = np.einsum('nft,t->nf', windows, x) / np.square(x).sum()
        block = {}
        for i, sensor in enumerate(SENSOR_COLUMNS):
            block[f'{sensor}_mean'] = mean[:, i]
            block[f'{sensor}_std'] = std[:, i]
            block[f'{sensor}_min'] = minimum[:, i]
            block[f'{sensor}_max'] = maximum[:, i]
            block[f'{sensor}_slope'] = slopes[:, i]
            block[f'{sensor}_range'] = maximum[:, i] - minimum[:, i]
        index = {name: i for i, name in enumerate(SENSOR_COLUMNS)}
        block['vibration_magnitude'] = np.sqrt(sum(mean[:, index[name]] ** 2 for name in ('Vibration_X', 'Vibration_Y', 'Vibration_Z')))
        block['power_efficiency'] = mean[:, index['Power_Output_kW']] / np.maximum(mean[:, index['Torque_Nm']] * mean[:, index['RPM']] / 9549, 1e-9)
        block['thermal_load_per_rpm'] = mean[:, index['Temperature_C']] / np.maximum(mean[:, index['RPM']], 1e-9)
        block['engine_id'] = int(engine_id)
        block['window_end_record'] = records[ends]
        block['is_anomaly'] = np.array([labels[end - WINDOW_SIZE + 1:end + 1].max() for end in ends], dtype=int)
        if 'anomaly_type' in engine:
            types = engine['anomaly_type'].astype(str).to_numpy()
            block['anomaly_type'] = [next((types[j] for j in range(end, end - WINDOW_SIZE, -1)
                                           if types[j].lower() not in ('', 'normal', 'none', 'nan')), 'normal')
                                     for end in ends]
        else:
            block['anomaly_type'] = 'unknown'
        rows.append(pd.DataFrame(block))
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def feature_columns(windows):
    excluded = {'engine_id', 'window_end_record', 'is_anomaly', 'anomaly_type'}
    return [column for column in windows.columns if column not in excluded]
