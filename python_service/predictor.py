"""
predictor.py  —  Flask ML Microservice  (port 5001)
====================================================
Serves live anomaly inference and a separate synthetic component-RUL endpoint.
Node.js backend calls these routes internally.

Live anomaly scoring uses the trained synthetic-anomaly artifact bundle.
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


log.info("Loading models...")
IF_MODEL     = joblib.load(f'{MODELS_DIR}/isolation_forest.pkl')
ANOMALY_SCALER = joblib.load(f'{MODELS_DIR}/synthetic_anomaly_scaler.pkl')
log.info("Models loaded [OK]")


with open(f'{MODELS_DIR}/synthetic_anomaly_model_metadata.json') as _f:
    IF_METADATA = json.load(_f)
with open(f'{MODELS_DIR}/synthetic_anomaly_feature_cols.json') as _f:
    ANOMALY_FEAT_COLS = json.load(_f)

ANOMALY_SENSOR_BASE = IF_METADATA['sensor_columns']
ANOMALY_WINDOW_SIZE = int(IF_METADATA['window_size_readings'])
MIN_DISPLAY_ANOMALY_SCORE = 0.049
assert len(ANOMALY_FEAT_COLS) == int(IF_METADATA['feature_count']), (
    'Synthetic anomaly metadata and feature-column artifact disagree.'
)
assert ANOMALY_SCALER.n_features_in_ == len(ANOMALY_FEAT_COLS)
assert len(ANOMALY_SENSOR_BASE) == len(set(ANOMALY_SENSOR_BASE))
log.info(f"Feature column check passed: {len(ANOMALY_FEAT_COLS)} synthetic-data features")


with open(os.path.join(BASE_DIR, "data", "processed", "isolation_forest_results.json")) as f:
    IF_RESULTS = json.load(f)
COMPONENT_RUL_RESULTS_PATH = os.path.join(
    BASE_DIR, "data", "processed", "component_rul_results.json")
COMPONENT_RUL_RESULTS = None
if os.path.isfile(COMPONENT_RUL_RESULTS_PATH):
    with open(COMPONENT_RUL_RESULTS_PATH) as f:
        COMPONENT_RUL_RESULTS = json.load(f)




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


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'models_loaded': {'anomaly_classifier': True},
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
            'model_class': IF_RESULTS.get('model_class'),
            'threshold_policy': IF_RESULTS.get('threshold_policy'),
            'test_engine_count': IF_RESULTS.get('test_engine_count'),
        },
        'component_rul': COMPONENT_RUL_RESULTS,
        'warning': ('Component RUL estimates use the project synthetic component dataset; '
                    'their test errors measure that synthetic domain and are not field accuracy.')
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
        raw_score = float(IF_MODEL.score_samples(X_scaled)[0])
        score_scale = max(float(IF_METADATA.get('score_scale', 0.1)), 1e-9)
        model_threshold = float(IF_METADATA.get(
            'decision_threshold_score_samples', IF_MODEL.offset_))
        score_distance = (model_threshold - raw_score) / score_scale
        score_span = 4 if score_distance >= 0 else 16
        anomaly_score = 0.5 + score_distance / score_span
        is_anomalous = raw_score < model_threshold
        anomaly_score = float(np.clip(anomaly_score, MIN_DISPLAY_ANOMALY_SCORE, 0.98))
        if is_anomalous:
            anomaly_score = max(anomaly_score, 0.1)
        score_threshold = 0.5

        if not is_anomalous:
            severity = 'NORMAL'
            message = 'Engine operating within normal parameters.'
        elif anomaly_score >= 0.75:
            severity = 'CRITICAL'
            message = 'Critical anomaly detected in truck engine telemetry. Inspect the engine immediately.'
        else:
            severity = 'TAKE_NOTE'
            message = 'Anomaly detected in truck engine telemetry. Take note and monitor the engine.'

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
            'score_threshold': score_threshold,
            'feature_snapshot': {
                'temperature_mean':    round(feats.get('Temperature_C_mean', 0), 2),
                'rpm_mean':            round(feats.get('RPM_mean', 0), 2),
                'vibration_magnitude': round(feats.get('vibration_magnitude', 0), 4),
                'fuel_efficiency_km_per_l_mean': round(feats.get('Fuel_Efficiency_km_per_L_mean', 0), 3),
                'exhaust_temperature_mean': round(feats.get('Exhaust_Temp_C_mean', 0), 2),
                'oil_pressure_mean': round(feats.get('Oil_Pressure_kPa_mean', 0), 2),
                'temperature_slope':   round(feats.get('Temperature_C_slope', 0), 6),
            },
            'note': ('Component RUL is served separately from the synthetic component '
                     'trajectory endpoint; this display score is not a calibrated failure probability.')
        }

        if is_anomalous:
            log.info(f"[{equipment_id}] {severity} anomaly_score={anomaly_score:.4f} "
                     f"is_anomalous=True ({processing_ms}ms)")
        else:
            log.info(f"[{equipment_id}] NORMAL score={anomaly_score:.4f} "
                     f"({processing_ms}ms)")

        return jsonify(response)

    except Exception as e:
        log.error(f"Prediction error: {e}", exc_info=True)
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
