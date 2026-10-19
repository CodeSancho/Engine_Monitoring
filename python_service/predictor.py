"""
predictor.py  —  Flask ML Microservice  (port 5001)
====================================================
Wraps both trained models behind a single /predict endpoint.
Node.js backend calls this internally — never exposed to the internet.

Live anomaly scoring uses the trained synthetic-anomaly artifact bundle.
The legacy CMAPSS RUL demonstration remains separate from live truck telemetry.
"""

import os, json, logging, time
import numpy as np
import pandas as pd
import joblib
from flask import Flask, request, jsonify
from flask_cors import CORS
from scipy import stats as sp_stats

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

app      = Flask(__name__)
CORS(app)


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "saved_models")

# ── Load models at startup ────────────────────────────────────────────────────
log.info("Loading models...")
IF_MODEL     = joblib.load(f'{MODELS_DIR}/isolation_forest.pkl')
RUL_MODEL    = joblib.load(f'{MODELS_DIR}/rul_regressor.pkl')
ANOMALY_SCALER = joblib.load(f'{MODELS_DIR}/synthetic_anomaly_scaler.pkl')
CMAPSS_SCALER= joblib.load(f'{MODELS_DIR}/cmapss_scaler.pkl')
log.info("Models loaded [OK]")

# Feature schema and calibration are generated alongside the trained model.
with open(f'{MODELS_DIR}/synthetic_anomaly_model_metadata.json') as _f:
    IF_METADATA = json.load(_f)
with open(f'{MODELS_DIR}/synthetic_anomaly_feature_cols.json') as _f:
    ANOMALY_FEAT_COLS = json.load(_f)
with open(f'{MODELS_DIR}/cmapss_feature_cols.json') as _f:
    CMAPSS_FEAT_COLS = json.load(_f)

ANOMALY_SENSOR_BASE = IF_METADATA['sensor_columns']
ANOMALY_WINDOW_SIZE = int(IF_METADATA['window_size_readings'])
CMAPSS_SENSOR_BASE = ['s2','s3','s4','s7','s8','s9',
                       's11','s12','s13','s14','s15','s17','s20','s21']
assert len(ANOMALY_FEAT_COLS) == int(IF_METADATA['feature_count']), (
    'Synthetic anomaly metadata and feature-column artifact disagree.'
)
assert ANOMALY_SCALER.n_features_in_ == len(ANOMALY_FEAT_COLS)
assert len(ANOMALY_SENSOR_BASE) == len(set(ANOMALY_SENSOR_BASE))
log.info(f"Feature column check passed: {len(ANOMALY_FEAT_COLS)} synthetic-data features, "
         f"{len(CMAPSS_FEAT_COLS)} CMAPSS features")

# Load results JSON for metadata
with open(os.path.join(BASE_DIR, "data", "processed", "isolation_forest_results.json")) as f:
    IF_RESULTS = json.load(f)
with open(os.path.join(BASE_DIR, "data", "processed", "rul_regressor_results.json")) as f:
    RUL_RESULTS = json.load(f)


# ── Feature extraction helpers ────────────────────────────────────────────────

def _slope(vals):
    if len(vals) < 2: return 0.0
    x = np.arange(len(vals), dtype=float)
    return float(sp_stats.linregress(x, np.array(vals, dtype=float))[0])


def _extract_window_features(readings, sensor_cols):
    """
    Extract 6 stats per sensor + 3 derived features from a list of readings.
    readings: list of dicts, each dict is one timestep of sensor values.
    """
    df  = pd.DataFrame(readings)
    feats = {}

    for col in sensor_cols:
        if col not in df.columns:
            for stat in ['mean','std','min','max','slope','range']:
                feats[f'{col}_{stat}'] = 0.0
            continue
        v = df[col].values.astype(float)
        feats[f'{col}_mean']  = float(np.mean(v))
        feats[f'{col}_std']   = float(np.std(v))
        feats[f'{col}_min']   = float(np.min(v))
        feats[f'{col}_max']   = float(np.max(v))
        feats[f'{col}_slope'] = _slope(v)
        feats[f'{col}_range'] = float(np.max(v) - np.min(v))

    temp   = feats.get('Temperature_C_mean', 1e-9)
    rpm    = feats.get('RPM_mean',           1e-9)
    power  = feats.get('Power_Output_kW_mean', 0.0)
    torque = feats.get('Torque_Nm_mean',     1e-9)
    vx     = feats.get('Vibration_X_mean',   0.0)
    vy     = feats.get('Vibration_Y_mean',   0.0)
    vz     = feats.get('Vibration_Z_mean',   0.0)
    feats['vibration_magnitude']  = float(np.sqrt(vx**2 + vy**2 + vz**2))
    feats['power_efficiency']     = power / max(torque * rpm / 9549, 1e-9)
    feats['thermal_load_per_rpm'] = temp  / max(rpm, 1e-9)

    return feats


def _get_anomaly_feature_vector(feats):
    values = [feats.get(column, 0.0) for column in ANOMALY_FEAT_COLS]
    return np.asarray(values, dtype=float).reshape(1, -1), ANOMALY_FEAT_COLS


def _get_cmapss_feature_vector(feats):
    """Build ordered feature array for CMAPSS RUL model, from the same
    single-source-of-truth JSON list."""
    return np.array([feats.get(c, 0.0) for c in CMAPSS_FEAT_COLS]).reshape(1, -1), CMAPSS_FEAT_COLS


def _classify_severity(anomaly_score, rul_hours):
    ANOMALY_THRESHOLD = 0.45
    if anomaly_score < ANOMALY_THRESHOLD:
        return "NORMAL", "Engine operating within normal parameters."
    if rul_hours > 48:
        return "WARNING", (f"Anomaly detected. Estimated {rul_hours:.0f}h remaining. "
                            "Schedule inspection at next planned opportunity.")
    if rul_hours > 12:
        return "CAUTION", (f"Anomaly detected. Estimated {rul_hours:.0f}h remaining. "
                            "Inspect before next shift.")
    return "CRITICAL", (f"Anomaly detected. Estimated {rul_hours:.0f}h remaining. "
                         "Complete current cycle and report to maintenance bay immediately.")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'models_loaded': {'isolation_forest': True, 'rul_regressor': True},
        'timestamp': time.time()
    })


@app.route('/model-info', methods=['GET'])
def model_info():
    return jsonify({
        'isolation_forest': {
            'dataset': IF_RESULTS.get('dataset'),
            'model_version': IF_RESULTS.get('model_version'),
            'feature_count': IF_RESULTS.get('feature_count'),
            'window_size_readings': IF_RESULTS.get('window_size_readings'),
            'test_precision': IF_RESULTS.get('test_precision'),
            'test_recall': IF_RESULTS.get('test_recall'),
            'test_f1': IF_RESULTS.get('test_f1'),
            'test_false_alarm_rate': IF_RESULTS.get('test_false_alarm_rate'),
            'validation_false_alarm_rate': IF_RESULTS.get('validation_false_alarm_rate'),
            'contamination': IF_RESULTS.get('contamination'),
            'threshold_policy': IF_RESULTS.get('threshold_policy'),
            'test_engine_count': IF_RESULTS.get('test_engine_count'),
        },
        'rul_regressor': {
            'dataset': RUL_RESULTS.get('dataset'),
            'test_mae_cycles': RUL_RESULTS.get('test_mae_cycles'),
            'test_rmse_cycles': RUL_RESULTS.get('test_rmse_cycles'),
        },
        'warning': ('RUL predictions are served from a model trained on NASA CMAPSS turbofan '
                    'data, mapped from ziya07 sensor readings. This mapping has not been '
                    'validated as physically meaningful for haul truck engines -- see project notes.')
    })


@app.route('/predict', methods=['POST'])
def predict():
    t_start = time.time()
    try:
        body         = request.get_json(force=True)
        equipment_id = body.get('equipment_id', 'UNKNOWN')
        readings     = body.get('readings', [])

        if len(readings) < ANOMALY_WINDOW_SIZE:
            return jsonify({'error': f'Need at least {ANOMALY_WINDOW_SIZE} readings, got {len(readings)}'}), 400

        feats = _extract_window_features(readings[-ANOMALY_WINDOW_SIZE:], ANOMALY_SENSOR_BASE)
        X_anomaly, _ = _get_anomaly_feature_vector(feats)
        X_scaled = ANOMALY_SCALER.transform(X_anomaly)
        raw_score = float(IF_MODEL.score_samples(X_scaled)[0])  # lower values are more anomalous
        score_scale = max(float(IF_METADATA.get('score_scale', 0.1)), 1e-9)
        anomaly_score = float(np.clip(0.5 + (float(IF_MODEL.offset_) - raw_score) / (4 * score_scale), 0, 1))
        is_anomalous = IF_MODEL.predict(X_scaled)[0] == -1

        severity = 'ANOMALY' if is_anomalous else 'NORMAL'
        message = ('Anomaly detected in truck engine telemetry.' if is_anomalous
                    else 'Engine operating within normal parameters.')

        slope_features = {k: v for k, v in feats.items() if '_slope' in k}
        top_slopes     = sorted(slope_features.items(), key=lambda x: abs(x[1]), reverse=True)[:3]
        top_features   = [f"{k}: {v:+.4f}" for k, v in top_slopes]

        processing_ms = round((time.time() - t_start) * 1000, 1)

        response = {
            'equipment_id':          equipment_id,
            'anomaly_score':         round(anomaly_score, 4),
            'is_anomalous':          bool(is_anomalous),
            'severity':              severity,
            'message':               message,
            'top_anomalous_features': top_features,
            'processing_time_ms':    processing_ms,
            'model_version': IF_METADATA['model_version'],
            'score_threshold': 0.5,
            'feature_snapshot': {
                'temperature_mean':    round(feats.get('Temperature_C_mean', 0), 2),
                'rpm_mean':            round(feats.get('RPM_mean', 0), 2),
                'vibration_magnitude': round(feats.get('vibration_magnitude', 0), 4),
                'fuel_efficiency_km_per_l_mean': round(feats.get('Fuel_Efficiency_km_per_L_mean', 0), 3),
                'exhaust_temperature_mean': round(feats.get('Exhaust_Temp_C_mean', 0), 2),
                'oil_pressure_mean': round(feats.get('Oil_Pressure_kPa_mean', 0), 2),
                'temperature_slope':   round(feats.get('Temperature_C_slope', 0), 6),
            },
            'note': ('RUL prediction removed from this endpoint -- the RUL model was trained '
                     'on NASA CMAPSS turbofan data and has no valid mapping to truck sensor '
                     'readings. See /predict_rul_demo for a genuine RUL demonstration on '
                     'CMAPSS-native data.')
        }

        log.info(f"[{equipment_id}] anomaly_score={anomaly_score:.3f} "
                 f"is_anomalous={is_anomalous} ({processing_ms}ms)")

        return jsonify(response)

    except Exception as e:
        log.error(f"Prediction error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/predict_rul_demo', methods=['POST'])
def predict_rul_demo():
    """
    Genuine RUL demonstration on CMAPSS-native input ONLY.
    Does NOT accept ziya07 truck sensor readings -- there is no valid
    mapping between the two datasets (see project notes).

    Request body:
    {
      "engine_id": "demo-engine-1",
      "cycles": [
        {"sensor_2": 641.82, "sensor_3": 1589.70, "sensor_4": 1400.60,
         "sensor_7": 554.36, "sensor_8": 2388.06, "sensor_9": 9046.19,
         "sensor_11": 47.47, "sensor_12": 521.66, "sensor_13": 2388.02,
         "sensor_14": 8138.62, "sensor_15": 8.4195, "sensor_17": 392,
         "sensor_20": 39.06, "sensor_21": 23.4190},
        ... (30 cycles = one window, in real CMAPSS units)
      ]
    }
    """
    t_start = time.time()
    try:
        body = request.get_json(force=True)
        engine_id = body.get('engine_id', 'UNKNOWN')
        cycles = body.get('cycles', [])

        if len(cycles) < 5:
            return jsonify({'error': f'Need at least 5 cycles, got {len(cycles)}'}), 400

        feats = _extract_window_features(cycles, CMAPSS_SENSOR_BASE)
        s2_m, s4_m = feats.get('sensor_2_mean', 1e-9), feats.get('sensor_4_mean', 0.0)
        s8_m, s9_m = feats.get('sensor_8_mean', 1e-9), feats.get('sensor_9_mean', 1e-9)
        s12_m, s17_m = feats.get('sensor_12_mean', 0.0), feats.get('sensor_17_mean', 0.0)
        feats['thermal_efficiency'] = s4_m / max(s2_m, 1e-9)
        feats['speed_ratio']        = s9_m / max(s8_m, 1e-9)
        feats['fuel_thermal_index'] = s12_m * s17_m

        X_cmapss, _ = _get_cmapss_feature_vector(feats)
        X_scaled = CMAPSS_SCALER.transform(X_cmapss)
        rul_cycles = max(0.0, float(RUL_MODEL.predict(X_scaled)[0]))

        processing_ms = round((time.time() - t_start) * 1000, 1)
        return jsonify({
            'engine_id': engine_id,
            'rul_cycles': round(rul_cycles, 1),
            'model_test_mae_cycles': RUL_RESULTS.get('test_mae_cycles'),
            'note': 'Validated on NASA CMAPSS turbofan data only. Not applicable to truck telemetry.',
            'processing_time_ms': processing_ms,
        })
    except Exception as e:
        log.error(f"RUL demo prediction error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/predict_component_rul', methods=['POST'])
def predict_component_rul():
    """Predict five component lifetimes over a held-out synthetic trajectory."""
    try:
        from models.component_rul import predict_trajectory

        body = request.get_json(force=True)
        records = body.get('records', [])
        sample_points = max(2, int(body.get('sample_points', 48)))
        step = max(1, int(np.ceil(max(1, len(records) - 5) / sample_points)))
        result = predict_trajectory(records, step=step)
        result['engine_id'] = body.get('engine_id', result['engine_id'])
        return jsonify(result)
    except Exception as e:
        log.error(f"Component RUL prediction error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500



if __name__ == '__main__':
    log.info("Starting Flask ML microservice on port 5001...")
    app.run(host='0.0.0.0', port=5001, debug=False)
