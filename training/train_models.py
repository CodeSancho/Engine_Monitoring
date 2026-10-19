"""
train_models.py
Isolation Forest is fit on normal windows from the new multi-engine
synthetic dataset. Complete engine IDs define train, validation and test
splits, so no engine's windows leak across those sets.
"""
import os, sys, json, logging, argparse, hashlib
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import IsolationForest, RandomForestRegressor
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import (precision_score, recall_score, f1_score,
                              confusion_matrix, mean_absolute_error, mean_squared_error)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

# Portable root resolution: this file lives at ENGINE_MONTORING/training/train_models.py,
# so the project root is exactly one directory up. Using __file__ instead of a
# hardcoded string means "python3 training/train_models.py" works correctly
# no matter which machine or folder path the project is checked out into.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'python_service', 'data'))
sys.path.insert(0, ROOT)

from preprocessor import Preprocessor
from feature_engineer import extract_cmapss_features, get_feature_cols_cmapss
from synthetic_anomaly_pipeline import (
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
RAW_ZIYA = os.path.join(ROOT, 'data', 'raw', 'engine_failure_dataset.csv')
RAW_SYNTHETIC_ANOMALY = os.path.join(ROOT, 'data', 'raw', 'synthetic_anomaly_records.csv')
RAW_CMAPSS = os.path.join(ROOT, 'data', 'raw', 'train_FD001.txt')


def train_isolation_forest():
    log.info("=" * 60)
    log.info("Training Isolation Forest on synthetic_anomaly_records.csv")
    log.info("=" * 60)

    data = load_synthetic_anomaly_dataset(RAW_SYNTHETIC_ANOMALY)
    train = build_anomaly_windows(data, 'train')
    validation = build_anomaly_windows(data, 'val')
    test = build_anomaly_windows(data, 'test')
    if train.empty or validation.empty or test.empty:
        raise ValueError('Train, val and test must each contain complete sensor windows.')

    feat_cols = get_anomaly_feature_columns(train)
    scaler = MinMaxScaler()
    # Isolation Forest is unsupervised: fit on every training window but do
    # not pass is_anomaly or any other label into fit(). Labels are used only
    # below for validation threshold selection and held-out evaluation.
    X_train = scaler.fit_transform(train[feat_cols])
    X_val = scaler.transform(validation[feat_cols])
    y_val = validation['is_anomaly'].to_numpy(dtype=int)
    X_test = scaler.transform(test[feat_cols])
    y_test = test['is_anomaly'].to_numpy(dtype=int)

    log.info(f"Train engines={data.loc[data.split == 'train', 'engine_id'].nunique()}, all unlabeled fit windows={len(X_train)}")
    log.info(f"Validation engines={data.loc[data.split == 'val', 'engine_id'].nunique()}, windows={len(X_val)}, anomalies={int(y_val.sum())}")
    log.info(f"Test engines={data.loc[data.split == 'test', 'engine_id'].nunique()}, windows={len(X_test)}, anomalies={int(y_test.sum())}")
    log.info(f"Window size={ANOMALY_WINDOW_SIZE} readings; features={len(feat_cols)}")

    # Fit the unsupervised forest once. Choose only its decision threshold on
    # validation engine IDs, with a 5% false-alarm ceiling on labelled-normal
    # windows. Labels do not enter fit(X_train).
    best_model = IsolationForest(n_estimators=300, contamination='auto',
                                 max_samples='auto', random_state=42, n_jobs=-1)
    best_model.fit(X_train)
    val_scores = best_model.score_samples(X_val)
    normal_mask = y_val == 0
    normal_scores = val_scores[normal_mask]
    threshold_candidates = np.unique(np.quantile(normal_scores, [0.01, 0.02, 0.03, 0.04, 0.05], method='lower'))
    candidates = []
    for threshold in threshold_candidates:
        val_pred = (val_scores < threshold).astype(int)
        false_alarm_rate = float((val_pred[normal_mask] == 1).mean())
        val_f1 = f1_score(y_val, val_pred, zero_division=0)
        candidates.append((float(threshold), false_alarm_rate, val_f1))
        log.info(f"  score_threshold={threshold:.6f} validation false-alarm={false_alarm_rate:.3%} F1={val_f1:.4f}")

    acceptable = [item for item in candidates if item[1] <= 0.05]
    if acceptable:
        decision_threshold, val_far, val_f1 = max(acceptable, key=lambda item: (item[2], -item[1]))
    else:
        decision_threshold, val_far, val_f1 = min(candidates, key=lambda item: (item[1], -item[2]))
        log.warning('No candidate met the 5%% validation false-alarm target; selected lowest validation false-alarm rate.')
    best_model.offset_ = decision_threshold
    best_cont = 'auto'

    test_pred = (best_model.predict(X_test) == -1).astype(int)
    prec = precision_score(y_test, test_pred, zero_division=0)
    rec = recall_score(y_test, test_pred, zero_division=0)
    f1 = f1_score(y_test, test_pred, zero_division=0)
    cm = confusion_matrix(y_test, test_pred, labels=[0, 1])
    score_scale = float(np.std(normal_scores)) if len(normal_scores) else 0.0
    if not np.isfinite(score_scale) or score_scale < 1e-9:
        score_scale = 0.1

    joblib.dump(best_model, f'{MODELS_DIR}/isolation_forest.pkl')
    joblib.dump(scaler, f'{MODELS_DIR}/synthetic_anomaly_scaler.pkl')
    with open(f'{MODELS_DIR}/synthetic_anomaly_feature_cols.json', 'w') as file:
        json.dump(feat_cols, file, indent=2)
    dataset_hash = hashlib.sha256(open(RAW_SYNTHETIC_ANOMALY, 'rb').read()).hexdigest()
    metadata = {
        'model_version': 'synthetic-anomaly-if-v2-all-training-windows',
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
        'contamination': best_cont,
        'threshold_policy': 'validation F1 maximized subject to a 5% normal false-alarm cap',
        'decision_threshold_score_samples': decision_threshold,
        'validation_false_alarm_rate': round(val_far, 6),
        'validation_f1': round(val_f1, 6),
        'score_scale': score_scale,
        'fitted_on_all_training_windows_without_labels': True,
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
        'contamination': best_cont,
        'threshold_policy': 'validation F1 maximized subject to a 5% normal false-alarm cap',
        'decision_threshold_score_samples': decision_threshold,
        'validation_false_alarm_rate': round(val_far, 4),
        'test_precision': round(prec, 4),
        'test_recall': round(rec, 4),
        'test_f1': round(f1, 4),
        'test_false_alarm_rate': round(float(cm[0, 1] / max(1, cm[0].sum())), 4),
        'confusion_matrix': cm.tolist(),
        'confusion_matrix_labels': ['normal', 'anomaly'],
        'eval_methodology': 'Isolation Forest fit on all training windows without labels; threshold selected using validation labels subject to a 5% false-alarm cap; final metrics on separate test engines. Labels are not model inputs.',
    }
    with open(f'{RESULTS_DIR}/isolation_forest_results.json', 'w') as file:
        json.dump(results, file, indent=2)
    log.info(f"Held-out test: precision={prec:.4f} recall={rec:.4f} F1={f1:.4f}")
    log.info(f"Test confusion matrix [normal, anomaly]:\n{cm}")
    return results


def train_rul_regressor():
    log.info("\n" + "=" * 60)
    log.info("Training Random Forest Regressor on CMAPSS (fixed pipeline)")
    log.info("=" * 60)

    pp = Preprocessor()
    c = pp.load_cmapss(RAW_CMAPSS)
    cf = extract_cmapss_features(c)
    feat_cols = get_feature_cols_cmapss(cf)

    X = cf[feat_cols].values
    y = cf['rul'].values

    engine_ids = cf['engine_id'].unique()
    rng = np.random.RandomState(42)
    rng.shuffle(engine_ids)
    split = int(len(engine_ids) * 0.8)
    train_engs, test_engs = set(engine_ids[:split]), set(engine_ids[split:])

    train_mask = cf['engine_id'].isin(train_engs)
    test_mask = cf['engine_id'].isin(test_engs)
    X_train, y_train = X[train_mask], y[train_mask]
    X_test, y_test = X[test_mask], y[test_mask]

    scaler = MinMaxScaler()
    X_train = scaler.fit_transform(X_train)
    X_test = scaler.transform(X_test)

    rf = RandomForestRegressor(n_estimators=200, min_samples_split=5, min_samples_leaf=2,
                                n_jobs=-1, random_state=42)
    rf.fit(X_train, y_train)

    preds = rf.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    naive_mae = mean_absolute_error(y_test, np.full_like(y_test, y_train.mean()))

    log.info(f"Test MAE: {mae:.2f} cycles (capped RUL, honest engine-level split)")
    log.info(f"Test RMSE: {rmse:.2f} cycles")
    log.info(f"Naive baseline MAE: {naive_mae:.2f} cycles")

    joblib.dump(rf, f'{MODELS_DIR}/rul_regressor.pkl')
    joblib.dump(scaler, f'{MODELS_DIR}/cmapss_scaler.pkl')
    with open(f'{MODELS_DIR}/cmapss_feature_cols.json', 'w') as f:
        json.dump(feat_cols, f, indent=2)

    results = {'test_mae_cycles': round(float(mae),2), 'test_rmse_cycles': round(float(rmse),2),
               'naive_mae_cycles': round(float(naive_mae),2), 'features': len(feat_cols),
               'rul_capped_at': 125}
    with open(f'{RESULTS_DIR}/rul_regressor_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--anomaly-only', action='store_true',
                        help='Train/evaluate the live synthetic-data anomaly detector only.')
    args = parser.parse_args()
    if_results = train_isolation_forest()
    print(f"Isolation Forest ({if_results['dataset']}) - Precision: {if_results['test_precision']}, "
          f"Recall: {if_results['test_recall']}, F1: {if_results['test_f1']}")
    if not args.anomaly_only:
        rf_results = train_rul_regressor()
        print(f"CMAPSS demo RUL - MAE: {rf_results['test_mae_cycles']} cycles, "
              f"RMSE: {rf_results['test_rmse_cycles']} cycles")
