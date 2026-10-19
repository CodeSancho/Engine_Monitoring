"""Train and evaluate the synthetic anomaly and component-RUL models.

Complete engine IDs define train, validation and test splits so no engine's
windows leak across those sets. Isolation Forest is fit without anomaly labels.
"""
import os, sys, json, logging, argparse, hashlib
import numpy as np
import joblib
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import precision_score, recall_score, f1_score, confusion_matrix

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)





ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from python_service.data.synthetic_anomaly_pipeline import (
    SENSOR_COLUMNS as ANOMALY_SENSOR_COLUMNS,
    WINDOW_SIZE as ANOMALY_WINDOW_SIZE,
    build_windows as build_anomaly_windows,
    feature_columns as get_anomaly_feature_columns,
    load_dataset as load_synthetic_anomaly_dataset,
)

MODELS_DIR = os.path.join(ROOT, 'saved_models')
RESULTS_DIR = os.path.join(ROOT, 'data', 'processed')
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)
RAW_SYNTHETIC_ANOMALY = os.path.join(ROOT, 'data', 'raw', 'synthetic_anomaly_records.csv')


def train_isolation_forest():
    log.info("=" * 60)
    log.info("Selecting an anomaly model using synthetic training and validation engines")
    log.info("=" * 60)

    data = load_synthetic_anomaly_dataset(RAW_SYNTHETIC_ANOMALY)
    train = build_anomaly_windows(data, 'train')
    validation = build_anomaly_windows(data, 'val')
    test = build_anomaly_windows(data, 'test')
    if train.empty or validation.empty or test.empty:
        raise ValueError('Train, val and test must each contain complete sensor windows.')

    all_feat_cols = get_anomaly_feature_columns(train)
    y_val = validation['is_anomaly'].to_numpy(dtype=int)
    y_test = test['is_anomaly'].to_numpy(dtype=int)

    log.info(f"Train engines={data.loc[data.split == 'train', 'engine_id'].nunique()}, unlabeled fit windows={len(train)}")
    log.info(f"Validation engines={data.loc[data.split == 'val', 'engine_id'].nunique()}, windows={len(validation)}, anomalies={int(y_val.sum())}")
    log.info(f"Test engines={data.loc[data.split == 'test', 'engine_id'].nunique()}, windows={len(test)}, anomalies={int(y_test.sum())}")
    log.info(f"Window size={ANOMALY_WINDOW_SIZE} readings; candidate features={len(all_feat_cols)}")

    normal_mask = y_val == 0
    derived = {'vibration_magnitude', 'power_efficiency', 'thermal_load_per_rpm'}
    fault_sensors = {
        'Vibration_X', 'Vibration_Y', 'Vibration_Z', 'Temperature_C',
        'Exhaust_Temp_C', 'Fuel_Efficiency_km_per_L', 'RPM', 'Torque_Nm',
        'Oil_Pressure_kPa', 'Boost_Pressure_kPa', 'Power_Output_kW',
        'Fuel_Consumption_Lph',
    }
    feature_sets = {
        'all': all_feat_cols,
        'mean_derived': [c for c in all_feat_cols if c.endswith('_mean') or c in derived],
        'level_spread': [c for c in all_feat_cols if c.endswith(('_mean', '_std', '_min', '_max')) or c in derived],
        'mean_std_slope': [c for c in all_feat_cols if c.endswith(('_mean', '_std', '_slope')) or c in derived],
        'mean_range_slope': [c for c in all_feat_cols if c.endswith(('_mean', '_range', '_slope')) or c in derived],
        'fault_sensors': [c for c in all_feat_cols if c in derived or any(
            c.startswith(f'{sensor}_') for sensor in fault_sensors)],
        'mechanical_sensors': [c for c in all_feat_cols if c == 'vibration_magnitude' or any(
            c.startswith(f'{sensor}_') for sensor in (
                'Vibration_X', 'Vibration_Y', 'Vibration_Z', 'Temperature_C',
                'Exhaust_Temp_C', 'RPM', 'Torque_Nm', 'Oil_Pressure_kPa'))],
    }
    candidates = [
        (name, cols, {'n_estimators': 200, 'max_samples': max_samples})
        for name, cols in feature_sets.items()
        if cols
        for max_samples in (256, 512, 1024)
    ]
    comparisons = []
    best_model = None
    best_choice = None
    best_val_f1 = -1.0
    best_scaler = None
    best_feat_cols = None
    best_params = None
    best_feature_set = None
    best_selection_key = None
    for feature_set, feat_cols, params in candidates:
        scaler_candidate = MinMaxScaler().fit(train[feat_cols])
        X_train_candidate = scaler_candidate.transform(train[feat_cols])
        X_val_candidate = scaler_candidate.transform(validation[feat_cols])
        candidate = IsolationForest(**params, contamination='auto',
                                     random_state=42, n_jobs=-1)
        candidate.fit(X_train_candidate)
        scores = candidate.score_samples(X_val_candidate)
        thresholds = np.unique(np.quantile(
            scores, np.linspace(0.002, 0.50, 250), method='lower'))
        options = []
        for threshold in thresholds:
            pred = (scores < threshold).astype(int)
            precision = precision_score(y_val, pred, zero_division=0)
            recall = recall_score(y_val, pred, zero_division=0)
            far = float(pred[normal_mask].mean())
            f1 = f1_score(y_val, pred, zero_division=0)
            options.append((f1, min(precision, recall), -far,
                            float(threshold), far, precision, recall))
        selected = max(options, key=lambda item: (
            item[5] >= 0.70 and item[6] >= 0.70,
            item[1], item[0], item[2]))
        comparisons.append({
            'model_type': 'isolation_forest',
            'feature_set': feature_set,
            'feature_count': len(feat_cols),
            'model_parameters': params,
            'validation_precision': round(selected[5], 6),
            'validation_recall': round(selected[6], 6),
            'validation_f1': round(selected[0], 6),
            'validation_false_alarm_rate': round(selected[4], 6),
            'threshold': selected[3],
        })
        log.info(f"IsolationForest {feature_set} max_samples={params['max_samples']}: validation "
                 f"precision={selected[5]:.4f} recall={selected[6]:.4f} "
                 f"F1={selected[0]:.4f} FAR={selected[4]:.3%}")
        selection_key = (
            selected[5] >= 0.70 and selected[6] >= 0.70,
            selected[1], selected[0], selected[2])
        if best_selection_key is None or selection_key > best_selection_key:
            best_model, best_choice = candidate, selected
            best_scaler, best_feat_cols = scaler_candidate, feat_cols
            best_params, best_feature_set = params, feature_set
            best_val_f1 = selected[0]
            best_selection_key = selection_key
    scaler = best_scaler
    feat_cols = best_feat_cols
    X_test = scaler.transform(test[feat_cols])
    log.info(f"Selected IsolationForest with {best_feature_set}: {len(feat_cols)} features")
    best_val_f1, _, _, decision_threshold, best_val_far, val_precision, val_recall = best_choice
    best_model.offset_ = decision_threshold
    normal_scores = best_model.score_samples(
        scaler.transform(validation.loc[normal_mask, feat_cols]))
    test_pred = (best_model.score_samples(X_test) < decision_threshold).astype(int)
    prec = precision_score(y_test, test_pred, zero_division=0)
    rec = recall_score(y_test, test_pred, zero_division=0)
    f1 = f1_score(y_test, test_pred, zero_division=0)
    cm = confusion_matrix(y_test, test_pred, labels=[0, 1])
    joblib.dump(best_model, f'{MODELS_DIR}/isolation_forest.pkl')
    joblib.dump(scaler, f'{MODELS_DIR}/synthetic_anomaly_scaler.pkl')
    with open(f'{MODELS_DIR}/synthetic_anomaly_feature_cols.json', 'w') as file:
        json.dump(feat_cols, file, indent=2)
    dataset_hash = hashlib.sha256(open(RAW_SYNTHETIC_ANOMALY, 'rb').read()).hexdigest()
    metadata = {
        'model_version': 'synthetic-anomaly-isolation-forest-v8-validation-tuning',
        'dataset': os.path.basename(RAW_SYNTHETIC_ANOMALY),
        'dataset_sha256': dataset_hash,
        'sensor_columns': [column for column in data.columns if column in ANOMALY_SENSOR_COLUMNS],
        'window_size_readings': ANOMALY_WINDOW_SIZE,
        'window_step_readings': 5,
        'feature_count': len(feat_cols),
        'feature_columns': feat_cols,
        'training_engine_ids': sorted(int(x) for x in data.loc[data.split == 'train', 'engine_id'].unique()),
        'validation_engine_ids': sorted(int(x) for x in data.loc[data.split == 'val', 'engine_id'].unique()),
        'test_engine_ids': sorted(int(x) for x in data.loc[data.split == 'test', 'engine_id'].unique()),
        'model_class': type(best_model).__name__,
        'model_type': 'isolation_forest',
        'selected_feature_set': best_feature_set,
        'model_parameters': best_params,
        'validation_model_comparisons': comparisons,
        'threshold_policy': ('Validation selection first prefers precision and recall both at least 0.70, '
                             'then maximizes the lower of precision and recall, followed by F1 and lower '
                             'false-alarm rate; test engines are reserved for final evaluation.'),
        'decision_threshold': decision_threshold,
        'decision_threshold_score_samples': decision_threshold,
        'validation_false_alarm_rate': round(best_val_far, 6),
        'validation_f1': round(best_val_f1, 6),
        'score_scale': float(max(np.std(normal_scores), 1e-9)),
        'fit_population': 'all training windows; labels excluded from model fitting',
        'fit_training_windows': int(len(train)),
    }
    with open(f'{MODELS_DIR}/synthetic_anomaly_model_metadata.json', 'w') as file:
        json.dump(metadata, file, indent=2)

    results = {
        'dataset': os.path.basename(RAW_SYNTHETIC_ANOMALY),
        'dataset_sha256': dataset_hash,
        'model_version': metadata['model_version'],
        'window_size_readings': ANOMALY_WINDOW_SIZE,
        'window_step_readings': 5,
        'feature_count': len(feat_cols),
        'train_engine_count': len(metadata['training_engine_ids']),
        'validation_engine_count': len(metadata['validation_engine_ids']),
        'test_engine_count': len(metadata['test_engine_ids']),
        'train_windows': len(train),
        'validation_windows': len(validation),
        'test_windows': len(test),
        'test_normal_windows': int((y_test == 0).sum()),
        'test_anomaly_windows': int((y_test == 1).sum()),
        'model_class': type(best_model).__name__,
        'selected_feature_set': best_feature_set,
        'model_type': 'isolation_forest',
        'model_parameters': best_params,
        'validation_model_comparisons': comparisons,
        'threshold_policy': ('Validation selection first prefers precision and recall both at least 0.70, '
                             'then maximizes the lower of precision and recall, followed by F1 and lower '
                             'false-alarm rate.'),
        'decision_threshold': decision_threshold,
        'validation_precision': round(val_precision, 4),
        'validation_recall': round(val_recall, 4),
        'validation_f1': round(best_val_f1, 4),
        'validation_false_alarm_rate': round(best_val_far, 4),
        'test_precision': round(prec, 4),
        'test_recall': round(rec, 4),
        'test_f1': round(f1, 4),
        'test_false_alarm_rate': round(float(cm[0, 1] / max(1, cm[0].sum())), 4),
        'confusion_matrix': cm.tolist(),
        'confusion_matrix_labels': ['normal', 'anomaly'],
        'eval_methodology': ('Isolation Forest fit on training windows without labels; feature set, '
                             'max_samples and threshold selected using validation engines; final metrics '
                             'measured once on separate test engines; window label is positive if any '
                             'reading in the window is anomalous.'),
    }
    with open(f'{RESULTS_DIR}/isolation_forest_results.json', 'w') as file:
        json.dump(results, file, indent=2)
    log.info(f"Held-out test: precision={prec:.4f} recall={rec:.4f} F1={f1:.4f}")
    log.info(f"Test confusion matrix [normal, anomaly]:\n{cm}")
    return results


def train_component_rul_models():
    from python_service.models import component_rul
    component_rul._MODELS = None
    component_rul._MODEL_INFO = None
    models, info = component_rul._ensure_models()
    path = os.path.join(MODELS_DIR, 'component_rul', 'component-rul-models.joblib')
    with open(os.path.join(RESULTS_DIR, 'component_rul_results.json'), 'w') as file:
        json.dump(info, file, indent=2)
    log.info(f"Component RUL results written to {RESULTS_DIR}/component_rul_results.json")
    for component, metric in info['metrics'].items():
        log.info(f"{component}: test MAE={metric['test']['mae_months']:.3f} months; "
                 f"mean baseline={info['baseline_metrics'][component]['test']['mae_months']:.3f}")
    return info


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--anomaly-only', action='store_true',
                        help='Train/evaluate the live synthetic-data anomaly detector only.')
    args = parser.parse_args()
    if_results = train_isolation_forest()
    print(f"Isolation Forest ({if_results['dataset']}) - Precision: {if_results['test_precision']}, "
          f"Recall: {if_results['test_recall']}, F1: {if_results['test_f1']}")
    if not args.anomaly_only:
        component_results = train_component_rul_models()
        print('Synthetic component RUL test MAE (months): ' + ', '.join(
            f"{name}={metrics['test']['mae_months']}" for name, metrics in component_results['metrics'].items()))
