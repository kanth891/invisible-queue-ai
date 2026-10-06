"""
ML Waiting-Time Predictor Service
Loads the serialized model artifact and executes predictions with confidence bounds.
"""

import os
import json
import math
from datetime import datetime
import numpy as np
import pandas as pd
import joblib

from ..schemas import PredictionRequest, PredictionResponse

# Comprehensive medical specialty clinical priors (median duration in minutes & baseline department mapping)
SPECIALTY_CLINICAL_PRIORS = {
    "general medicine": {"mean_dur": 11.5, "base_dept_id": 1, "specialty": "General Medicine"},
    "internal medicine": {"mean_dur": 12.0, "base_dept_id": 1, "specialty": "Internal Medicine"},
    "cardiology":       {"mean_dur": 18.0, "base_dept_id": 2, "specialty": "Cardiology"},
    "heart":            {"mean_dur": 18.0, "base_dept_id": 2, "specialty": "Cardiology"},
    "pediatrics":       {"mean_dur": 13.0, "base_dept_id": 3, "specialty": "Pediatrics"},
    "child":            {"mean_dur": 13.0, "base_dept_id": 3, "specialty": "Pediatrics"},
    "orthopedics":      {"mean_dur": 15.0, "base_dept_id": 4, "specialty": "Orthopedics"},
    "ortho":            {"mean_dur": 15.0, "base_dept_id": 4, "specialty": "Orthopedics"},
    "dermatology":      {"mean_dur": 10.0, "base_dept_id": 5, "specialty": "Dermatology"},
    "skin":             {"mean_dur": 10.0, "base_dept_id": 5, "specialty": "Dermatology"},
    "neurology":        {"mean_dur": 22.0, "base_dept_id": 2, "specialty": "Neurology"},
    "neuro":            {"mean_dur": 22.0, "base_dept_id": 2, "specialty": "Neurology"},
    "oncology":         {"mean_dur": 25.0, "base_dept_id": 2, "specialty": "Oncology"},
    "cancer":           {"mean_dur": 25.0, "base_dept_id": 2, "specialty": "Oncology"},
    "ent":              {"mean_dur": 11.0, "base_dept_id": 1, "specialty": "ENT"},
    "ear":              {"mean_dur": 11.0, "base_dept_id": 1, "specialty": "ENT"},
    "ophthalmology":    {"mean_dur": 12.0, "base_dept_id": 1, "specialty": "Ophthalmology"},
    "eye":              {"mean_dur": 12.0, "base_dept_id": 1, "specialty": "Ophthalmology"},
    "psychiatry":       {"mean_dur": 28.0, "base_dept_id": 2, "specialty": "Psychiatry"},
    "mental":           {"mean_dur": 28.0, "base_dept_id": 2, "specialty": "Psychiatry"},
    "gynecology":       {"mean_dur": 14.5, "base_dept_id": 1, "specialty": "Gynecology"},
    "urology":          {"mean_dur": 15.0, "base_dept_id": 4, "specialty": "Urology"},
    "emergency":        {"mean_dur": 9.0,  "base_dept_id": 1, "specialty": "Emergency"},
    "default":          {"mean_dur": 14.0, "base_dept_id": 1, "specialty": "Outpatient Clinic"},
}

def resolve_specialty_prior(dept_name: str | None) -> dict:
    if not dept_name:
        return SPECIALTY_CLINICAL_PRIORS["default"]
    lower = dept_name.lower().strip()
    for key, val in SPECIALTY_CLINICAL_PRIORS.items():
        if key in lower:
            return val
    return SPECIALTY_CLINICAL_PRIORS["default"]

class WaitingTimePredictor:
    def __init__(self, model_dir=None):
        if model_dir is None:
            # Default to ../../models relative to this file
            curr_dir = os.path.dirname(os.path.abspath(__file__))
            model_dir = os.path.abspath(os.path.join(curr_dir, "..", "..", "models"))
        
        self.model_dir = model_dir
        self.artifact = None
        self.metrics = None
        self.load_model()

    def load_model(self):
        model_path = os.path.join(self.model_dir, "waiting_time_model.joblib")
        metrics_path = os.path.join(self.model_dir, "metrics.json")

        if os.path.exists(model_path):
            try:
                self.artifact = joblib.load(model_path)
                print(f"[ML-Service] Loaded model: {self.artifact.get('model_name')} ({self.artifact.get('model_version')})")
            except Exception as e:
                print(f"[ML-Service] Error loading model artifact: {e}")
                self.artifact = None
        else:
            print(f"[ML-Service] Model file not found at: {model_path}")
            self.artifact = None

        if os.path.exists(metrics_path):
            try:
                with open(metrics_path, "r") as f:
                    self.metrics = json.load(f)
            except Exception as e:
                print(f"[ML-Service] Error loading metrics JSON: {e}")
                self.metrics = None

    def is_ready(self) -> bool:
        return self.artifact is not None and "model" in self.artifact

    def predict(self, req: PredictionRequest) -> PredictionResponse:
        now = datetime.now()
        patients_ahead = req.patients_ahead
        
        # When 0 patients ahead, patient is next in line
        if patients_ahead == 0:
            return PredictionResponse(
                predicted_wait_minutes=2.0,
                lower_bound_minutes=1,
                upper_bound_minutes=4,
                model_version=self.artifact.get("model_version", "v1.0-default") if self.artifact else "v1.0-baseline",
                confidence_interval="Immediate queue (Next in line)",
                is_cold_start=bool(req.is_cold_start),
                message="You are next in line. Please be prepared."
            )

        # Detect cold start condition (explicit flag or new department/doctor with unmapped metadata)
        prior_info = resolve_specialty_prior(req.department_name)
        is_cold_start = bool(
            req.is_cold_start or 
            (req.department_id is not None and req.department_id > 5) or
            (req.doctor_id is not None and req.doctor_id > 7)
        )

        # Impute clinical consultation duration using Bayesian specialty prior when in cold-start
        if req.doctor_avg_duration is not None and req.doctor_avg_duration > 0 and not (req.is_cold_start and req.doctor_avg_duration == 12.0):
            doctor_avg_dur = req.doctor_avg_duration
        else:
            doctor_avg_dur = prior_info["mean_dur"]

        # Default imputations from context if omitted
        hour_of_day = req.hour_of_day if req.hour_of_day is not None else now.hour
        day_of_week = req.day_of_week if req.day_of_week is not None else now.weekday()
        is_peak_hour = req.is_peak_hour if req.is_peak_hour is not None else (1 if hour_of_day in [9, 10, 11, 14, 15] else 0)
        token_position = req.token_position if req.token_position is not None else (patients_ahead + 1)
        queue_length = req.queue_length if req.queue_length is not None else (patients_ahead + 2)
        
        # Map out-of-training categorical IDs to valid specialty baseline partition (1-5)
        dept_id_feature = prior_info["base_dept_id"] if (req.department_id is None or req.department_id > 5) else req.department_id
        doctor_id_feature = min(req.doctor_id or 1, 7)
        completed_today = req.completed_today if req.completed_today is not None else 0

        # Construct input DataFrame matching feature order
        feature_cols = self.artifact.get("feature_cols", [
            "patients_ahead", "queue_length", "token_position", "hour_of_day",
            "day_of_week", "is_peak_hour", "department_id", "doctor_id",
            "doctor_avg_duration", "completed_today"
        ])

        row_dict = {
            "patients_ahead": patients_ahead,
            "queue_length": queue_length,
            "token_position": token_position,
            "hour_of_day": hour_of_day,
            "day_of_week": day_of_week,
            "is_peak_hour": is_peak_hour,
            "department_id": dept_id_feature,
            "doctor_id": doctor_id_feature,
            "doctor_avg_duration": doctor_avg_dur,
            "completed_today": completed_today
        }
        df_input = pd.DataFrame([row_dict])[feature_cols]

        model = self.artifact["model"]
        if self.artifact.get("uses_scaled") and self.artifact.get("scaler"):
            df_scaled = self.artifact["scaler"].transform(df_input)
            raw_pred = float(model.predict(df_scaled)[0])
        else:
            raw_pred = float(model.predict(df_input)[0])

        # If cold-start specialty has higher baseline pacing than the mapped base dept, scale accordingly
        base_dept_mean = 17.5 if dept_id_feature == 2 else 11.5 if dept_id_feature == 1 else 13.0
        if is_cold_start and doctor_avg_dur != base_dept_mean and base_dept_mean > 0:
            scale_ratio = doctor_avg_dur / base_dept_mean
            # Dampen scaling to maintain realistic bounds
            effective_scale = 1.0 + (scale_ratio - 1.0) * 0.75
            raw_pred = raw_pred * effective_scale

        # Ensure prediction is positive and realistic
        predicted_wait = max(1.0, round(raw_pred, 1))

        # Dynamic empirical prediction interval scaled by queue depth uncertainty sqrt(patients_ahead)
        base_q10 = abs(self.artifact.get("residual_q10", -8.0))
        base_q90 = abs(self.artifact.get("residual_q90", 10.0))
        
        # Scaling factor: uncertainty is slightly wider during cold-start prior calibration (±35%)
        uncertainty_multiplier = 1.35 if is_cold_start else 1.0
        depth_scale = (math.sqrt(max(1, patients_ahead)) / 2.5) * uncertainty_multiplier
        delta_lower = max(2.0, min(base_q10 * depth_scale, predicted_wait * (0.40 if is_cold_start else 0.35)))
        delta_upper = max(2.0, min(base_q90 * depth_scale, predicted_wait * (0.45 if is_cold_start else 0.40)))

        lower_bound = max(1, int(round(predicted_wait - delta_lower)))
        upper_bound = max(lower_bound + 2, int(round(predicted_wait + delta_upper)))

        return PredictionResponse(
            predicted_wait_minutes=predicted_wait,
            lower_bound_minutes=lower_bound,
            upper_bound_minutes=upper_bound,
            model_version="v1.0-bayesian-prior" if is_cold_start else self.artifact.get("model_version", "v1.0-gradient-boosting"),
            confidence_interval="Clinical specialty prior calibration (±35%)" if is_cold_start else "80% empirical prediction interval",
            is_cold_start=is_cold_start,
            message="Wait estimated using clinical specialty prior and queue pacing" if is_cold_start else "Predicted wait based on current queue conditions"
        )

# Global singleton predictor instance
predictor = WaitingTimePredictor()
