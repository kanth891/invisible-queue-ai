"""
Unit tests for Invisible Queue AI ML Service.
Tests cover:
- Model artifact loading
- Feature preprocessing and predictions
- Prediction ranges and edge cases (0 patients ahead)
- Schema validation for invalid and missing inputs
- Model info and research metrics
"""

import os
import sys
import pytest
from fastapi.testclient import TestClient

# Add ml-service to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app
from app.services.predictor import predictor
from app.schemas import PredictionRequest

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["model_loaded"] is True
    assert "gradient-boosting" in data["model_version"]

def test_model_loaded_successfully():
    assert predictor.is_ready() is True
    assert predictor.artifact is not None
    assert "model" in predictor.artifact
    assert "feature_cols" in predictor.artifact

def test_valid_prediction():
    payload = {
        "patients_ahead": 3,
        "queue_length": 6,
        "token_position": 4,
        "hour_of_day": 10,
        "day_of_week": 1,
        "is_peak_hour": 1,
        "department_id": 1,
        "doctor_id": 1,
        "doctor_avg_duration": 12.0,
        "completed_today": 4
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "predicted_wait_minutes" in data
    assert "lower_bound_minutes" in data
    assert "upper_bound_minutes" in data
    assert data["predicted_wait_minutes"] > 0
    assert data["lower_bound_minutes"] <= data["predicted_wait_minutes"] <= data["upper_bound_minutes"]
    assert data["lower_bound_minutes"] >= 1

def test_zero_patients_ahead_prediction():
    """Edge case: patient is next in line."""
    payload = {"patients_ahead": 0}
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["predicted_wait_minutes"] == 2.0
    assert data["lower_bound_minutes"] == 1
    assert data["upper_bound_minutes"] <= 5

def test_missing_optional_features():
    """Service should handle missing optional features using realistic defaults."""
    payload = {"patients_ahead": 2}
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["predicted_wait_minutes"] > 0

def test_invalid_negative_patients_ahead():
    """Pydantic validation should reject negative patients_ahead."""
    payload = {"patients_ahead": -3}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422

def test_model_info_endpoint():
    response = client.get("/model/info")
    assert response.status_code == 200
    data = response.json()
    assert "model_name" in data
    assert "features" in data
    assert "feature_importances" in data
    assert len(data["features"]) > 0

def test_model_metrics_endpoint():
    response = client.get("/model/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "evaluation_summary" in data
    assert len(data["evaluation_summary"]) >= 4  # Baseline, Ridge, RF, GBR
    assert "selected_model_metrics" in data
    assert data["selected_model_metrics"]["test_mae"] > 0
    assert data["selected_model_metrics"]["test_r2"] > 0.8
