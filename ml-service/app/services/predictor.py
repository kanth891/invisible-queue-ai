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
                confidence_interval="Immediate queue (Next in line)"
            )

        # Default imputations from context if omitted
        hour_of_day = req.hour_of_day if req.hour_of_day is not None else now.hour
        day_of_week = req.day_of_week if req.day_of_week is not None else now.weekday()
        is_peak_hour = req.is_peak_hour if req.is_peak_hour is not None else (1 if hour_of_day in [9, 10, 11, 14, 15] else 0)
        token_position = req.token_position if req.token_position is not None else (patients_ahead + 1)
        queue_length = req.queue_length if req.queue_length is not None else (patients_ahead + 2)
        doctor_id = req.doctor_id or 1
        department_id = req.department_id or 1
        doctor_avg_dur = req.doctor_avg_duration if req.doctor_avg_duration is not None else 12.0
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
            "department_id": department_id,
            "doctor_id": doctor_id,
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

        # Ensure prediction is positive and realistic
        predicted_wait = max(1.0, round(raw_pred, 1))

        # Dynamic empirical prediction interval scaled by queue depth uncertainty sqrt(patients_ahead)
        # Base residual bounds from validation set
        base_q10 = abs(self.artifact.get("residual_q10", -8.0))
        base_q90 = abs(self.artifact.get("residual_q90", 10.0))
        
        # Scaling factor: uncertainty is narrower for 1-2 patients, wider for 8+ patients
        depth_scale = math.sqrt(max(1, patients_ahead)) / 2.5
        delta_lower = max(2.0, min(base_q10 * depth_scale, predicted_wait * 0.35))
        delta_upper = max(2.0, min(base_q90 * depth_scale, predicted_wait * 0.40))

        lower_bound = max(1, int(round(predicted_wait - delta_lower)))
        upper_bound = max(lower_bound + 2, int(round(predicted_wait + delta_upper)))

        return PredictionResponse(
            predicted_wait_minutes=predicted_wait,
            lower_bound_minutes=lower_bound,
            upper_bound_minutes=upper_bound,
            model_version=self.artifact.get("model_version", "v1.0-gradient-boosting"),
            confidence_interval="80% empirical prediction interval"
        )

# Global singleton predictor instance
predictor = WaitingTimePredictor()
