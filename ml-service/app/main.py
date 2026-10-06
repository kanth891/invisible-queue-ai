"""
Invisible Queue AI — FastAPI Machine Learning Service
Provides intelligent outpatient waiting-time predictions and model research metrics.
"""

import os
import sys
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

# Ensure parent directory is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.schemas import (
    PredictionRequest,
    PredictionResponse,
    ModelInfoResponse,
    ModelMetricsResponse
)
from app.services.predictor import predictor
from train import train_and_evaluate

app = FastAPI(
    title="Invisible Queue AI — Waiting-Time Prediction Service",
    description="Machine Learning service for real-time outpatient waiting-time forecasting.",
    version="1.0.0"
)

# Enable CORS for internal Node backend calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", tags=["System"])
def health_check():
    """Health check endpoint confirming ML service and model availability."""
    ready = predictor.is_ready()
    return {
        "status": "ok" if ready else "degraded",
        "service": "invisible-queue-ml-service",
        "model_loaded": ready,
        "model_version": predictor.artifact.get("model_version") if ready else None,
        "model_name": predictor.artifact.get("model_name") if ready else None
    }

@app.post("/predict", response_model=PredictionResponse, tags=["Prediction"])
def predict_waiting_time(request: PredictionRequest):
    """
    Predict outpatient waiting time in minutes with 80% empirical prediction interval.
    Features strictly use arrival/queue state variables to avoid temporal data leakage.
    """
    if not predictor.is_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ML Model not loaded or unavailable on service."
        )

    try:
        response = predictor.predict(request)
        return response
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction error: {str(e)}"
        )

@app.get("/model/info", response_model=ModelInfoResponse, tags=["Research & Admin"])
def get_model_info():
    """Returns technical metadata, feature columns, and calculated feature importances."""
    if not predictor.is_ready():
        raise HTTPException(status_code=503, detail="Model artifact unavailable")

    artifact = predictor.artifact
    metrics = predictor.metrics or {}
    
    return ModelInfoResponse(
        model_name=artifact.get("model_name", "Unknown"),
        model_version=artifact.get("model_version", "v1.0"),
        trained_at=artifact.get("trained_at", ""),
        dataset_type=artifact.get("dataset_type", "SYNTHETIC_DEVELOPMENT"),
        features=artifact.get("feature_cols", []),
        feature_importances=metrics.get("feature_importances", {})
    )

@app.get("/model/metrics", response_model=ModelMetricsResponse, tags=["Research & Admin"])
def get_model_metrics():
    """Returns model comparison table (Baseline, Ridge, RF, GBR) and test evaluation metrics."""
    if not predictor.metrics:
        raise HTTPException(status_code=404, detail="Metrics report not found")

    metrics = predictor.metrics
    return ModelMetricsResponse(
        model_version=metrics.get("model_version", "v1.0"),
        best_model_name=metrics.get("best_model_name", "Gradient Boosting Regressor"),
        evaluation_summary=metrics.get("evaluation_summary", []),
        selected_model_metrics=metrics.get("selected_model_metrics", {}),
        feature_importances=metrics.get("feature_importances", {})
    )

@app.post("/train", tags=["Training"])
def trigger_training():
    """Trigger model training and re-evaluation pipeline."""
    try:
        report = train_and_evaluate()
        predictor.load_model()
        return {
            "status": "ok",
            "message": "Training pipeline completed successfully",
            "selected_model": report.get("best_model_name"),
            "test_mae": report.get("selected_model_metrics", {}).get("test_mae")
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Training pipeline failed: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
