import joblib
import numpy as np
import pandas as pd
import sys
sys.path.insert(0, 'python_service')
from sklearn.metrics import mean_absolute_error, mean_squared_error
from models.component_rul import DATA_PATH, SIGNALS, COMPONENTS, WINDOW, _window_features

old = joblib.load('.tmp/component-rul-baseline.joblib')['models']
frame = pd.read_csv(DATA_PATH)
features, labels = [], {name: [] for name in COMPONENTS}
for _, group in frame.groupby('engine_id', sort=True):
    group = group.sort_values('record')
    if group['split'].iloc[0] != 'test' or len(group) < WINDOW:
        continue
    features.append(_window_features(group[SIGNALS].to_numpy(dtype=np.float32)))
    ends = group.iloc[WINDOW - 1:]
    for name, target in COMPONENTS.items():
        labels[name].append(ends[target].to_numpy(dtype=np.float32))
X = np.concatenate(features)
for name, model in old.items():
    y = np.concatenate(labels[name])
    pred = model.predict(X)
    print(name, 'old model on full target MAE=', round(mean_absolute_error(y, pred), 3), 'RMSE=', round(np.sqrt(mean_squared_error(y, pred)), 3))
