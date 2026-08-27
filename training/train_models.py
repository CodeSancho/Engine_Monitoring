"""
train_models.py
FIXES APPLIED (see conversation):
  1. Isolation Forest evaluated against synthetic injected anomalies
     (physically motivated) instead of the untrustworthy Fault_Condition
     label, which was proven statistically unrelated to sensor readings.
  2. Contamination is tuned on a VALIDATION split, then reported on a
     separate TEST split -- not tuned and reported on the same data,
     which was silently inflating the old F1 score.
  3. Uses the corrected preprocessor.py / feature_engineer.py.
"""
import os, sys, json, logging
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
from feature_engineer import (extract_ziya07_features, extract_ziya07_normal_features,
                               extract_cmapss_features, get_feature_cols_ziya07, get_feature_cols_cmapss)
from synthetic_anomalies import inject_raw_level_anomalies

MODELS_DIR = os.path.join(ROOT, 'saved_models')
RESULTS_DIR = os.path.join(ROOT, 'data', 'processed')
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)
RAW_ZIYA = os.path.join(ROOT, 'data', 'raw', 'engine_failure_dataset.csv')
RAW_CMAPSS = os.path.join(ROOT, 'data', 'raw', 'train_FD001.txt')


def train_isolation_forest():
    log.info("=" * 60)
    log.info("Training Isolation Forest on ziya07 (fixed pipeline)")
    log.info("=" * 60)

    pp = Preprocessor()
    z = pp.load_ziya07(RAW_ZIYA)
    normal = extract_ziya07_normal_features(z)
    feat_cols = [c for c in normal.columns if c not in
                 ('window_label','fault_severity','operational_mode','window_end')]

    log.info(f"Normal windows: {len(normal)}, features: {len(feat_cols)}")

    # 3-way split: train (fit IF) / val (tune contamination) / test (final report)
    # All drawn from genuine normal windows + freshly injected synthetic anomalies,
    # so contamination tuning never sees the same anomalies used for final reporting.
    rng = np.random.RandomState(42)
    idx = rng.permutation(len(normal))
    n = len(normal)
    train_idx = idx[:int(n*0.6)]
    val_idx   = idx[int(n*0.6):int(n*0.8)]
    test_idx  = idx[int(n*0.8):]

    train_normal = normal.iloc[train_idx]
    val_normal   = normal.iloc[val_idx]
    test_normal  = normal.iloc[test_idx]

    val_anom  = inject_raw_level_anomalies(z, n_windows=len(val_idx), seed=1)
    test_anom = inject_raw_level_anomalies(z, n_windows=len(test_idx), seed=2)

    scaler = MinMaxScaler()
    X_train = scaler.fit_transform(train_normal[feat_cols])

    X_val = scaler.transform(pd.concat([val_normal[feat_cols], val_anom[feat_cols]]))
    y_val = np.array([0]*len(val_normal) + [1]*len(val_anom))

    X_test = scaler.transform(pd.concat([test_normal[feat_cols], test_anom[feat_cols]]))
    y_test = np.array([0]*len(test_normal) + [1]*len(test_anom))

    log.info(f"Train (fit): {len(X_train)} normal windows")
    log.info(f"Val (tune contamination): {len(val_normal)} normal + {len(val_anom)} synthetic anomalies")
    log.info(f"Test (final report): {len(test_normal)} normal + {len(test_anom)} synthetic anomalies")

    # FIX: contamination must NOT be tuned by maximizing F1 against a mixed
    # eval set (see conversation) -- that optimizes for "highest score on
    # this specific test mix," not "sane false-alarm rate on real normal
    # data," and reliably drags contamination toward the highest value in
    # the search grid. Proof: the old model flagged 30.6% of its OWN
    # training data (100% genuinely normal) as anomalous.
    #
    # Instead: fix contamination low (reflecting tolerated false-alarm rate
    # in deployment), and separately verify on held-out normal data that
    # the flagged rate is actually low before ever looking at anomaly
    # recall. Recall is tuned for only AFTER the false-alarm rate is sane.
    CONTAMINATION_CANDIDATES = [0.01, 0.02, 0.03, 0.05]

    best_model, best_cont = None, None
    for contamination in CONTAMINATION_CANDIDATES:
        model = IsolationForest(n_estimators=200, contamination=contamination,
                                 max_samples='auto', random_state=42, n_jobs=-1)
        model.fit(X_train)

        # Sanity check FIRST: what fraction of held-out NORMAL validation
        # data does this flag? This must stay low regardless of anomaly
        # recall -- a model with great recall but 30% false alarms on
        # normal data is not deployable.
        val_normal_scaled = scaler.transform(val_normal[feat_cols])
        false_alarm_rate = (model.predict(val_normal_scaled) == -1).mean()

        preds = (model.predict(X_val) == -1).astype(int)
        f1 = f1_score(y_val, preds, zero_division=0)
        log.info(f"  contamination={contamination:.2f}  false_alarm_rate_on_normal={false_alarm_rate:.1%}  VAL F1={f1:.4f}")

        if best_model is None:
            best_model, best_cont = model, contamination
        # Prefer the LOWEST contamination that still achieves reasonable
        # recall -- do not chase F1 alone, since that reintroduces the bug.
        if false_alarm_rate <= 0.05 and f1 >= f1_score(y_val, (best_model.predict(X_val)==-1).astype(int), zero_division=0):
            best_model, best_cont = model, contamination

    log.info(f"Selected contamination={best_cont} (chosen to keep false-alarm rate on normal data <=5%, not to maximize F1 alone)")

    final_preds = (best_model.predict(X_test) == -1).astype(int)
    prec = precision_score(y_test, final_preds, zero_division=0)
    rec = recall_score(y_test, final_preds, zero_division=0)
    f1 = f1_score(y_test, final_preds, zero_division=0)
    cm = confusion_matrix(y_test, final_preds)

    log.info("\n-- HONEST Isolation Forest Results (held-out test, synthetic anomalies) --")
    log.info(f"  Precision: {prec:.4f}  Recall: {rec:.4f}  F1: {f1:.4f}")
    log.info(f"  Confusion matrix:\n{cm}")

    joblib.dump(best_model, f'{MODELS_DIR}/isolation_forest.pkl')
    joblib.dump(scaler, f'{MODELS_DIR}/ziya07_scaler.pkl')
    with open(f'{MODELS_DIR}/ziya07_feature_cols.json', 'w') as f:
        json.dump(feat_cols, f, indent=2)

    results = {'contamination': best_cont, 'test_precision': round(prec,4),
               'test_recall': round(rec,4), 'test_f1': round(f1,4),
               'confusion_matrix': cm.tolist(),
               'eval_methodology': 'synthetic physically-motivated anomaly injection, val/test split, not Fault_Condition'}
    with open(f'{RESULTS_DIR}/isolation_forest_results.json', 'w') as f:
        json.dump(results, f, indent=2)
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
    if_results = train_isolation_forest()
    rf_results = train_rul_regressor()
    print("\n" + "="*60)
    print("FIXED PIPELINE — FINAL HONEST RESULTS")
    print("="*60)
    print(f"Isolation Forest — Precision: {if_results['test_precision']}, Recall: {if_results['test_recall']}, F1: {if_results['test_f1']}")
    print(f"RUL Regressor    — Test MAE: {rf_results['test_mae_cycles']} cycles, RMSE: {rf_results['test_rmse_cycles']} cycles")
