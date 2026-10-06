# Invisible Queue AI — Machine Learning Waiting-Time Prediction Service

## 1. Overview & Research Problem

The waiting-time prediction microservice for **Invisible Queue AI** forecasts outpatient waiting times in minutes until consultation begins. 

### Core Contribution
> **"We integrate intelligent waiting-time prediction directly with a real-time virtual hospital queue, enabling patients to remotely monitor their queue position and make informed decisions about when to return for consultation."**

The system does not fabricate arbitrary wait estimates (e.g. `± 5 min`), but instead learns from queue state variables and produces statistically grounded empirical prediction intervals (e.g., `15–22 min`).

---

## 2. Microservice Architecture

```text
React Frontend (Vercel)
       ↓
Node.js + Express Backend (Render)
       ↓
Python FastAPI ML Microservice (:8000)
       ↓
Serialized ML Pipeline (waiting_time_model.joblib)
```

- **Framework**: FastAPI + Uvicorn
- **Language**: Python 3.12+ / 3.14
- **Libraries**: scikit-learn, pandas, numpy, joblib, pydantic

---

## 3. Dataset Characteristics

- **Path**: `ml-service/data/synthetic_training_data.csv`
- **Type**: `SYNTHETIC_DEVELOPMENT` (Clearly separated development dataset modeling outpatient queue physics).
- **Records**: 5,000 completed consultation records across 60 clinic days.
- **Consultation Dynamics**:
  - Medical consultation durations follow empirical **log-normal distributions** with positive skew (most visits 10–14 min, complex visits 25–35 min).
  - Department-specific pacing (General Medicine, Cardiology, Pediatrics, Orthopedics, Dermatology).
  - Doctor-specific efficiencies and clinic rush periods (peak hours: 9–11 AM, 2–4 PM; higher volume on Mondays and Saturdays).
  - Queue turnaround buffer (sanitization, patient entry/exit: 0.5–1.5 min per visit).
- **Production Retraining**: Once sufficient real hospital records are gathered in the PostgreSQL database, the service supports automated retraining via `POST /train` or `python train.py`.

---

## 4. Feature Engineering (Strictly Zero Data Leakage)

All features are restricted to variables known **at arrival / prediction time**. No future consultation durations, future completion timestamps, or future cancellations are leaked.

| Feature Name | Type | Description |
|---|---|---|
| `token_position` | Integer | 1-indexed queue order position for the doctor |
| `patients_ahead` | Integer | Number of active patients waiting ahead in line |
| `doctor_avg_duration` | Float | Doctor's historical average consultation speed (min) |
| `doctor_id` | Integer | Doctor identifier / clinical pacing profile |
| `queue_length` | Integer | Total active queue load for doctor at prediction moment |
| `department_id` | Integer | Clinical specialty code (e.g. GM, CAR, PED) |
| `completed_today` | Integer | Number of patients completed so far today (fatigue proxy) |
| `hour_of_day` | Integer | Hour of prediction (0–23) |
| `day_of_week` | Integer | Day of week (0=Mon, 6=Sun) |
| `is_peak_hour` | Binary | 1 during peak outpatient rush, 0 otherwise |

**Target**: `waiting_time_minutes` (actual elapsed minutes from arrival until consultation starts).

---

## 5. Chronological Train / Val / Test Split

To prevent temporal leakage in time-dependent queue data, records are sorted chronologically:
- **Training Set**: 3,500 records (Older 70%)
- **Validation Set**: 750 records (Intermediate 15%)
- **Test Set**: 750 records (Recent 15%)

---

## 6. Model Evaluation Benchmark

All models were evaluated on the held-out chronological test partition:

| Model | Test MAE (min) | Test RMSE (min) | Test R² Score | Validation MAE (min) | Validation R² |
|---|---|---|---|---|---|
| **Baseline (Doctor/Dept Median)** | 8.89 | 12.77 | 0.9150 | 8.66 | 0.9177 |
| **Linear Regression (Ridge L2)** | 9.89 | 12.76 | 0.9151 | 10.37 | 0.8989 |
| **Random Forest Regressor** | 8.46 | 10.95 | 0.9375 | 8.31 | 0.9322 |
| **Gradient Boosting Regressor** | **7.92** | **10.20** | **0.9458** | **7.85** | **0.9405** |

### Selected Final Model: **Gradient Boosting Regressor**
- **Reasoning**:
  1. **Lowest MAE (7.92 min)**: Outperforms linear baseline by ~20% error reduction on outpatient wait times.
  2. **High Generalization (R² = 0.9458)**: Explains 94.6% of wait time variance without overfitting.
  3. **Non-linear Dynamics**: Effectively captures compounding queue congestion during peak clinic hours.
  4. **Compact Serialization**: Fast inference latency (<15ms per request).

---

## 7. Derived Feature Importance

Calculated from Gradient Boosting decision trees:

1. **`token_position`**: 53.54%
2. **`patients_ahead`**: 25.95%
3. **`doctor_avg_duration`**: 18.46%
4. **`doctor_id`**: 1.11%
5. **`queue_length`**: 0.28%
6. **`department_id`**: 0.26%
7. **`completed_today`**: 0.22%
8. **`hour_of_day`**: 0.08%

---

## 8. Empirical Prediction Intervals (Confidence Bounds)

Rather than showing arbitrary numbers or `± 5 min`, intervals are computed from the 10th and 90th percentiles of validation residuals ($q_{10} = -11.34$, $q_{90} = +14.80$ min), dynamically scaled by queue depth uncertainty ($\sqrt{\text{patients\_ahead}}$):

$$\text{Lower Bound} = \max(1, \text{round}(\hat{y} - \delta_{\text{lower}}))$$
$$\text{Upper Bound} = \max(\text{Lower Bound} + 2, \text{round}(\hat{y} + \delta_{\text{upper}}))$$

For immediate patients ($\text{patients\_ahead} = 0$), the model outputs an immediate buffer ($\sim 2\text{ min}$, $[1, 4]\text{ min}$) with label *"You are next in line"*.

---

## 9. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health and loaded model version |
| `POST` | `/predict` | Predict waiting time with empirical interval bounds |
| `GET` | `/model/info` | Model metadata, feature list, and feature importances |
| `GET` | `/model/metrics` | Regression benchmark comparison table |
| `POST` | `/train` | Trigger retraining pipeline |

---

## 10. Fault Tolerance & Resilient Fallback

If the ML microservice is unreachable, timing out (>2.5s), or degraded:
1. Node.js backend client catches the exception.
2. Gracefully falls back to doctor/department historical median duration heuristic.
3. Flags `is_fallback: true` with message *"Estimated wait based on historical queue flow"*.
4. **Never displays `0 min`, `NaN`, `undefined`, or raw 500 errors to patients.**

---

## 11. Research Limitations

1. **Synthetic Development Data**: Model is trained on 5,000 synthetic outpatient records until sufficient real clinical volume accumulates.
2. **Clinical Emergencies**: Sudden emergency room cases prioritized ahead of the queue cannot be predicted prior to arrival.
3. **Doctor Interruptions**: Phone consultations or urgent ward rounds create unavoidable queue pauses.
4. **Disclaimer**: Waiting time forecasts are operational estimates, **not** deterministic scheduling guarantees or clinical outcome predictions.
