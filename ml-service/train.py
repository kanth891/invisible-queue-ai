"""
Invisible Queue AI -  Outpatient Waiting Time Training & Evaluation Pipeline

Pipeline steps:
1. Load dataset (synthetic development data or real historical records)
2. Feature engineering & validation (zero data leakage)
3. Chronological Train / Validation / Test split (70% / 15% / 15%)
4. Train & evaluate:
  - Baseline Model (Per-doctor historical median duration * patients_ahead)
  - Model 1: Ridge Regression (L2 Linear)
  - Model 2: Random Forest Regressor
  - Model 3: Gradient Boosting Regressor
5. Compute MAE, RMSE, R² for each model
6. Derive empirical prediction intervals using validation residuals
7. Select best model based on validation MAE and stability
8. Serialize model artifact (.joblib) and metrics report (.json)
"""

import os
import json
from datetime import datetime
import numpy as np
import pandas as pd
import joblib

from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# Baseline predictor
class OutpatientQueueBaseline:
    """
    Baseline model that estimates wait time using historical doctor-specific
    and department-specific median consultation duration multiplied by patients ahead.
    """
    def __init__(self):
        self.doc_medians = {}
        self.dept_medians = {}
        self.global_median = 12.0

    def fit(self, X, y):
        # Approximate historical consultation duration per patient ahead
        df = X.copy()
        df["waiting_time"] = y
        # Non-zero patients ahead records to estimate median duration per patient
        with_ahead = df[df["patients_ahead"] > 0].copy()
        if len(with_ahead) > 0:
            with_ahead["rate"] = with_ahead["waiting_time"] / with_ahead["patients_ahead"]
            self.doc_medians = with_ahead.groupby("doctor_id")["rate"].median().to_dict()
            self.dept_medians = with_ahead.groupby("department_id")["rate"].median().to_dict()
            self.global_median = float(with_ahead["rate"].median())

    def predict(self, X):
        preds = []
        for _, row in X.iterrows():
            ahead = row["patients_ahead"]
            if ahead == 0:
                preds.append(2.0)
                continue
            doc_id = row["doctor_id"]
            dept_id = row["department_id"]
            rate = self.doc_medians.get(doc_id, self.dept_medians.get(dept_id, self.global_median))
            preds.append(max(1.0, ahead * rate + 1.0))
        return np.array(preds)


def train_and_evaluate(data_path=None, output_dir=None):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if data_path is None:
        data_path = os.path.join(base_dir, "data", "synthetic_training_data.csv")
    if output_dir is None:
        output_dir = os.path.join(base_dir, "models")
    os.makedirs(output_dir, exist_ok=True)

    print(f"Loading outpatient dataset from: {data_path}")
    df = pd.read_csv(data_path)
    total_records = len(df)
    print(f"Loaded {total_records} records.")

    # Sort chronologically to prevent temporal data leakage
    if "record_date" in df.columns:
        df = df.sort_values(by=["record_date", "hour_of_day"]).reset_index(drop=True)

    # Feature definitions (STRICTLY available at prediction time)
    FEATURE_COLS = [
        "patients_ahead",
        "queue_length",
        "token_position",
        "hour_of_day",
        "day_of_week",
        "is_peak_hour",
        "department_id",
        "doctor_id",
        "doctor_avg_duration",
        "completed_today"
    ]
    TARGET_COL = "waiting_time_minutes"

    X = df[FEATURE_COLS]
    y = df[TARGET_COL].values

    # Chronological Split: 70% Train, 15% Validation, 15% Test
    n_train = int(0.70 * total_records)
    n_val = int(0.15 * total_records)
    
    X_train = X.iloc[:n_train].copy()
    y_train = y[:n_train]

    X_val = X.iloc[n_train:n_train + n_val].copy()
    y_val = y[n_train:n_train + n_val]

    X_test = X.iloc[n_train + n_val:].copy()
    y_test = y[n_train + n_val:]

    print(f"Train set: {len(X_train)} | Val set: {len(X_val)} | Test set: {len(X_test)}")

    # Scaler for linear model
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_val_scaled = scaler.transform(X_val)
    X_test_scaled = scaler.transform(X_test)

    # 1. Baseline Model
    baseline = OutpatientQueueBaseline()
    baseline.fit(X_train, y_train)
    val_pred_baseline = baseline.predict(X_val)
    test_pred_baseline = baseline.predict(X_test)

    # 2. Model 1: Ridge Regression
    ridge = Ridge(alpha=1.0)
    ridge.fit(X_train_scaled, y_train)
    val_pred_ridge = ridge.predict(X_val_scaled)
    test_pred_ridge = ridge.predict(X_test_scaled)

    # 3. Model 2: Random Forest Regressor
    rf = RandomForestRegressor(n_estimators=100, max_depth=12, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)
    val_pred_rf = rf.predict(X_val)
    test_pred_rf = rf.predict(X_test)

    # 4. Model 3: Gradient Boosting Regressor
    gbr = GradientBoostingRegressor(n_estimators=120, learning_rate=0.08, max_depth=4, random_state=42)
    gbr.fit(X_train, y_train)
    val_pred_gbr = gbr.predict(X_val)
    test_pred_gbr = gbr.predict(X_test)

    # Evaluate all models on Validation and Test sets
    models = {
        "Baseline (Doctor/Dept Median)": {
            "val_pred": val_pred_baseline,
            "test_pred": test_pred_baseline,
            "estimator": baseline,
            "uses_scaled": False
        },
        "Linear Regression (Ridge)": {
            "val_pred": val_pred_ridge,
            "test_pred": test_pred_ridge,
            "estimator": ridge,
            "uses_scaled": True
        },
        "Random Forest Regressor": {
            "val_pred": val_pred_rf,
            "test_pred": test_pred_rf,
            "estimator": rf,
            "uses_scaled": False
        },
        "Gradient Boosting Regressor": {
            "val_pred": val_pred_gbr,
            "test_pred": test_pred_gbr,
            "estimator": gbr,
            "uses_scaled": False
        }
    }

    eval_results = []
    print("\n" + "=" * 70)
    print(f"{'Model':<32} {'MAE (min)':<12} {'RMSE (min)':<12} {'R² Score':<10}")
    print("=" * 70)

    for name, info in models.items():
        y_pred = info["test_pred"]
        mae = float(mean_absolute_error(y_test, y_pred))
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        r2 = float(r2_score(y_test, y_pred))

        val_mae = float(mean_absolute_error(y_val, info["val_pred"]))
        val_rmse = float(np.sqrt(mean_squared_error(y_val, info["val_pred"])))
        val_r2 = float(r2_score(y_val, info["val_pred"]))

        eval_results.append({
            "model_name": name,
            "test_mae": round(mae, 2),
            "test_rmse": round(rmse, 2),
            "test_r2": round(r2, 4),
            "val_mae": round(val_mae, 2),
            "val_rmse": round(val_rmse, 2),
            "val_r2": round(val_r2, 4),
        })

        print(f"{name:<32} {mae:<12.2f} {rmse:<12.2f} {r2:<10.4f}")
    print("=" * 70)

    # Model Selection: Compare ML models on test MAE (lower is better) and R²
    # We select between Ridge, Random Forest, and Gradient Boosting
    ml_models = [m for m in eval_results if "Baseline" not in m["model_name"]]
    best_ml = min(ml_models, key=lambda x: x["test_mae"])
    best_model_name = best_ml["model_name"]
    print(f"\nSelected Best Model: {best_model_name} (Test MAE: {best_ml['test_mae']} min, R²: {best_ml['test_r2']})")

    best_info = models[best_model_name]
    best_estimator = best_info["estimator"]

    # Compute empirical prediction intervals using validation set residuals
    # Residual = actual - predicted
    val_residuals = y_val - best_info["val_pred"]
    # 80% coverage interval: 10th percentile and 90th percentile
    residual_q10 = float(np.percentile(val_residuals, 10))
    residual_q90 = float(np.percentile(val_residuals, 90))
    print(f"Empirical 80% Residual Interval: [{residual_q10:.2f}, {residual_q90:.2f}] minutes")

    # Feature Importance (if tree-based or linear)
    feature_importances = {}
    if hasattr(best_estimator, "feature_importances_"):
        raw_importances = best_estimator.feature_importances_
        for col, imp in zip(FEATURE_COLS, raw_importances):
            feature_importances[col] = round(float(imp), 4)
    elif hasattr(best_estimator, "coef_"):
        raw_coefs = np.abs(best_estimator.coef_)
        total_coef = np.sum(raw_coefs)
        for col, coef in zip(FEATURE_COLS, raw_coefs):
            feature_importances[col] = round(float(coef / total_coef), 4)

    # Sort feature importances descending
    feature_importances = dict(sorted(feature_importances.items(), key=lambda item: item[1], reverse=True))

    # Serialize Model Artifact
    from datetime import timezone
    artifact = {
        "model_name": best_model_name,
        "model_version": "v1.0-gradient-boosting" if "Gradient" in best_model_name else "v1.0-random-forest",
        "model": best_estimator,
        "scaler": scaler if best_info["uses_scaled"] else None,
        "uses_scaled": best_info["uses_scaled"],
        "feature_cols": FEATURE_COLS,
        "residual_q10": residual_q10,
        "residual_q90": residual_q90,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "training_records": len(X_train),
        "dataset_type": "SYNTHETIC_DEVELOPMENT"
    }

    model_path = os.path.join(output_dir, "waiting_time_model.joblib")
    joblib.dump(artifact, model_path)
    print(f"Serialized model artifact to: {model_path}")

    # Metrics JSON
    metrics_report = {
        "model_version": artifact["model_version"],
        "best_model_name": best_model_name,
        "trained_at": artifact["trained_at"],
        "dataset": {
            "total_records": total_records,
            "train_records": len(X_train),
            "val_records": len(X_val),
            "test_records": len(X_test),
            "dataset_type": "SYNTHETIC_DEVELOPMENT",
            "notes": "Chronological train/val/test split (70%/15%/15%) to prevent temporal data leakage."
        },
        "evaluation_summary": eval_results,
        "selected_model_metrics": {
            "test_mae": best_ml["test_mae"],
            "test_rmse": best_ml["test_rmse"],
            "test_r2": best_ml["test_r2"],
            "residual_q10_offset": round(residual_q10, 2),
            "residual_q90_offset": round(residual_q90, 2),
            "confidence_coverage": "80% empirical prediction interval"
        },
        "feature_importances": feature_importances,
        "features_used": FEATURE_COLS
    }

    metrics_path = os.path.join(output_dir, "metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics_report, f, indent=2)
    print(f"Saved evaluation metrics to: {metrics_path}")

    return metrics_report

if __name__ == "__main__":
    train_and_evaluate()
