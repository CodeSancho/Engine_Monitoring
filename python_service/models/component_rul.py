"""Component-level RUL models trained from synthetic_component_rul.csv.

Inputs are six consecutive operating records plus engine operating time (not
component target, health, or age fields). Five independent gradient-boosting
regressors predict RUL in months. A residual range is calibrated on validation
engines and shown as an estimate range, not a guaranteed confidence interval.
"""

import os
import threading

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_PATH = os.environ.get(
    "COMPONENT_RUL_DATA_PATH",
    os.path.join(BASE_DIR, "data", "raw", "synthetic_component_rul.csv"),
)
MODEL_DIR = os.environ.get(
    "COMPONENT_RUL_MODEL_DIR",
    os.path.join(BASE_DIR, "saved_models", "component_rul"),
)
WINDOW = 6
COMPONENTS = {
    "main_bearings": "RUL_months_main_bearings",
    "fuel_injectors": "RUL_months_fuel_injectors",
    "turbocharger": "RUL_months_turbocharger",
    "cooling_system": "RUL_months_cooling_system",
    "air_filter": "RUL_months_air_filter",
}
MAJOR_COMPONENTS = tuple(k for k in COMPONENTS if k != "air_filter")
SIGNALS = [
    "payload_t", "speed_kmh", "total_resistance_pct", "Temperature_C",
    "Exhaust_Temp_C", "RPM", "Torque_Nm", "Power_Output_kW",
    "Fuel_Consumption_Lph", "Fuel_Efficiency_tkm_per_L", "Oil_Pressure_kPa",
    "Boost_Pressure_kPa", "Vibration_X", "Vibration_Y", "Vibration_Z",
]
FEATURE_NAMES = [f"{signal}_{stat}" for stat in ("mean", "std", "slope", "latest") for signal in SIGNALS]
FEATURE_NAMES += ["operating_hours", "month_index"]
MODEL_VERSION = "synthetic-component-rul-random-forest-v1"
_MODELS = None
_MODEL_INFO = None
_LOCK = threading.Lock()
_SLOPE_COEFFICIENTS = np.arange(WINDOW, dtype=np.float32) - (WINDOW - 1) / 2
_SLOPE_DENOMINATOR = float(np.square(_SLOPE_COEFFICIENTS).sum())


def _window_features(values):
    """Build mean, spread, slope, and latest value for each signal."""
    windows = np.lib.stride_tricks.sliding_window_view(values, WINDOW, axis=0)
    means = windows.mean(axis=2)
    stds = windows.std(axis=2)
    slopes = np.einsum("nft,t->nf", windows, _SLOPE_COEFFICIENTS) / _SLOPE_DENOMINATOR
    latest = windows[:, :, -1]
    return np.concatenate((means, stds, slopes, latest), axis=1).astype(np.float32, copy=False)


def _prepare_data():
    if not os.path.isfile(DATA_PATH):
        raise FileNotFoundError(f"Component RUL dataset missing: {DATA_PATH}")
    frame = pd.read_csv(DATA_PATH)
    required = {"engine_id", "record", "operating_hours", "month_index", "split", *SIGNALS, *COMPONENTS.values()}
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise ValueError(f"Component RUL dataset is missing required columns: {', '.join(missing)}")

    matrices, labels, metadata = [], {name: [] for name in COMPONENTS}, []
    for engine_id, group in frame.groupby("engine_id", sort=True):
        group = group.sort_values("record")
        if len(group) < WINDOW:
            continue
        values = group[SIGNALS].to_numpy(dtype=np.float32)
        end_rows = group.iloc[WINDOW - 1:]
        sensor_features = _window_features(values)
        time_features = end_rows[["operating_hours", "month_index"]].to_numpy(dtype=np.float32)
        matrices.append(np.concatenate((sensor_features, time_features), axis=1))
        for component, target in COMPONENTS.items():
            labels[component].append(end_rows[target].to_numpy(dtype=np.float32))
        metadata.append(end_rows[["engine_id", "record", "operating_hours", "month_index", "split"]].copy())

    X = np.concatenate(matrices, axis=0)
    y = {name: np.concatenate(parts, axis=0) for name, parts in labels.items()}
    meta = pd.concat(metadata, ignore_index=True)
    return X, y, meta


def _fit_models():
    X, y, meta = _prepare_data()
    train = meta["split"].to_numpy() == "train"
    validation = meta["split"].to_numpy() == "val"
    test = meta["split"].to_numpy() == "test"
    if not train.any() or not validation.any() or not test.any():
        raise ValueError("Dataset must provide engine-separated train, val, and test splits")

    models = {}
    metrics = {}
    feature_importance = {}
    residual_ranges = {}
    comparisons = {}
    rul_max_months = max(float(np.max(y[name][train])) for name in COMPONENTS)
    for index, component in enumerate(COMPONENTS):
        model = RandomForestRegressor(
            n_estimators=100,
            max_features=1.0,
            min_samples_leaf=2,
            random_state=410 + index,
            n_jobs=-1,
        )
        model.fit(X[train], y[component][train])
        validation_prediction = model.predict(X[validation])
        comparisons[component] = [{"model": type(model).__name__,
                                   "validation_mae_months": round(float(mean_absolute_error(y[component][validation], validation_prediction)), 3)}]
        validation_residuals = y[component][validation] - validation_prediction
        residual_ranges[component] = [
            float(np.quantile(validation_residuals, 0.10)),
            float(np.quantile(validation_residuals, 0.90)),
        ]
        models[component] = model
        metrics[component] = {}
        for split_name, mask in (("validation", validation), ("test", test)):
            predicted = validation_prediction if split_name == "validation" else model.predict(X[mask])
            metrics[component][split_name] = {
                "mae_months": round(float(mean_absolute_error(y[component][mask], predicted)), 3),
                "rmse_months": round(float(np.sqrt(mean_squared_error(y[component][mask], predicted))), 3),
            }
        if hasattr(model, "feature_importances_"):
            importance = model.feature_importances_
            feature_importance[component] = [
                {"feature": FEATURE_NAMES[i], "importance": round(float(importance[i]), 5)}
                for i in np.argsort(importance)[-5:][::-1]
            ]
        else:
            feature_importance[component] = []

    info = {
        "version": MODEL_VERSION,
        "dataset": os.path.basename(DATA_PATH),
        "engines": int(meta["engine_id"].nunique()),
        "window_records": WINDOW,
        "rul_cap_months": None,
        "rul_max_months": round(rul_max_months, 2),
        "training_rows": int(train.sum()),
        "feature_count": int(X.shape[1]),
        "validation_engines": int(meta.loc[validation, "engine_id"].nunique()),
        "test_engines": int(meta.loc[test, "engine_id"].nunique()),
        "metrics": metrics,
        "model_comparisons": comparisons,
        "model_parameters": {
            "estimator": "RandomForestRegressor",
            "n_estimators": 100,
            "max_features": 1.0,
            "min_samples_leaf": 2,
        },
        "validation_residual_ranges": residual_ranges,
        "uncertainty_method": "10th-90th percentile of residuals on engine-held-out validation data",
        "feature_importance": feature_importance,
        "baseline_metrics": _baseline_metrics(y, meta, train, validation, test),
    }
    return models, info


def _baseline_metrics(y, meta, train, validation, test):
    result = {}
    for component in COMPONENTS:
        result[component] = {}
        for split_name, mask in (("validation", validation), ("test", test)):
            prediction = np.full(int(mask.sum()), float(np.mean(y[component][train])))
            result[component][split_name] = {
                "mae_months": round(float(mean_absolute_error(y[component][mask], prediction)), 3),
                "rmse_months": round(float(np.sqrt(mean_squared_error(y[component][mask], prediction))), 3),
            }
    return result


def _ensure_models():
    global _MODELS, _MODEL_INFO
    if _MODELS is not None:
        return _MODELS, _MODEL_INFO
    with _LOCK:
        if _MODELS is not None:
            return _MODELS, _MODEL_INFO
        os.makedirs(MODEL_DIR, exist_ok=True)
        artifact_path = os.path.join(MODEL_DIR, "component-rul-models.joblib")
        stat = os.stat(DATA_PATH) if os.path.isfile(DATA_PATH) else None
        dataset_signature = (stat.st_size, stat.st_mtime_ns) if stat else None
        if os.path.isfile(artifact_path):
            try:
                artifact = joblib.load(artifact_path)
                if artifact.get("version") == MODEL_VERSION and artifact.get("dataset_signature") == dataset_signature:
                    _MODELS, _MODEL_INFO = artifact["models"], artifact["info"]
                    return _MODELS, _MODEL_INFO
            except (ImportError, ModuleNotFoundError, AttributeError, ValueError, EOFError) as exc:
                # A previous sklearn/joblib artifact may reference private
                # modules that no longer exist (for example sklearn._loss).
                # Treat it as stale and rebuild using the current estimator.
                print(f"[component_rul] Ignoring incompatible artifact: {exc}")
        _MODELS, _MODEL_INFO = _fit_models()
        joblib.dump({"version": MODEL_VERSION, "dataset_signature": dataset_signature, "models": _MODELS, "info": _MODEL_INFO}, artifact_path, compress=3)
    return _MODELS, _MODEL_INFO


def predict_trajectory(records, step=8):
    """Predict all five parts along one held-out synthetic engine trajectory."""
    if not isinstance(records, list) or len(records) < WINDOW:
        raise ValueError(f"At least {WINDOW} records are required")
    required = set(SIGNALS + ["record", "operating_hours", "month_index"])
    missing = sorted(required.difference(records[0].keys()))
    if missing:
        raise ValueError(f"Trajectory is missing sensor fields: {', '.join(missing)}")
    frame = pd.DataFrame(records)
    values = frame[SIGNALS].to_numpy(dtype=np.float32)
    sensor_features = _window_features(values)
    time_features = frame.iloc[WINDOW - 1:][["operating_hours", "month_index"]].to_numpy(dtype=np.float32)
    features = np.concatenate((sensor_features, time_features), axis=1)
    indexes = list(range(0, len(features), max(1, int(step))))
    if indexes[-1] != len(features) - 1:
        indexes.append(len(features) - 1)
    models, info = _ensure_models()

    predictions = {}
    for component, model in models.items():
        selected = features[indexes]
        predicted = model.predict(selected)
        residual_low, residual_high = info["validation_residual_ranges"][component]
        predictions[component] = {
            "mean": np.clip(predicted, 0, info["rul_max_months"]),
            "low": np.clip(predicted + residual_low, 0, info["rul_max_months"]),
            "high": np.clip(predicted + residual_high, 0, info["rul_max_months"]),
        }

    points = []
    for point_index, feature_index in enumerate(indexes):
        row = frame.iloc[feature_index + WINDOW - 1]
        parts = {
            component: {
                "months": round(float(values["mean"][point_index]), 2),
                "range_low": round(float(values["low"][point_index]), 2),
                "range_high": round(float(values["high"][point_index]), 2),
            }
            for component, values in predictions.items()
        }
        weakest = min(MAJOR_COMPONENTS, key=lambda name: parts[name]["months"])
        points.append({
            "record": int(row["record"]),
            "operating_hours": float(row["operating_hours"]),
            "month_index": float(row["month_index"]),
            "parts": parts,
            "weakest_major_component": weakest,
        })

    return {
        "engine_id": records[0].get("engine_id"),
        "window_records": WINDOW,
        "sampled_points": len(points),
        "points": points,
        "latest": points[-1],
        "likely_cause": points[-1]["weakest_major_component"],
        "model_info": info,
        "note": "Component RUL is a synthetic-data estimate; its displayed residual range is calibrated on validation engines. It is separate from anomaly detection and is not a validated truck-life forecast.",
    }
