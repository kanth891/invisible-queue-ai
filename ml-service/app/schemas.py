"""
Pydantic schemas for ML waiting-time prediction service.
"""

from typing import Optional, Dict, List, Any
from pydantic import BaseModel, Field

class PredictionRequest(BaseModel):
    patients_ahead: int = Field(..., ge=0, description="Number of active patients waiting ahead in queue")
    queue_length: Optional[int] = Field(None, ge=0, description="Total active queue length for doctor today")
    token_position: Optional[int] = Field(None, ge=1, description="1-indexed token queue position")
    hour_of_day: Optional[int] = Field(None, ge=0, le=23, description="Hour of arrival/prediction (0-23)")
    day_of_week: Optional[int] = Field(None, ge=0, le=6, description="Day of week (0=Monday, 6=Sunday)")
    is_peak_hour: Optional[int] = Field(None, ge=0, le=1, description="Binary peak hour indicator (1/0)")
    department_id: Optional[int] = Field(1, ge=1, description="Hospital department ID")
    doctor_id: Optional[int] = Field(1, ge=1, description="Doctor ID")
    doctor_avg_duration: Optional[float] = Field(None, ge=1.0, le=60.0, description="Historical avg duration in min")
    completed_today: Optional[int] = Field(0, ge=0, description="Number of completed patients today for doctor")
    department_name: Optional[str] = Field(None, description="Department clinical specialty name for cold-start prior")
    dept_avg_duration: Optional[float] = Field(None, description="Specialty baseline duration in minutes")
    is_cold_start: Optional[bool] = Field(False, description="Flag indicating new department/doctor with <3 consultations")

class PredictionResponse(BaseModel):
    predicted_wait_minutes: float = Field(..., description="Estimated wait time in minutes")
    lower_bound_minutes: int = Field(..., description="Lower bound of estimated wait interval")
    upper_bound_minutes: int = Field(..., description="Upper bound of estimated wait interval")
    model_version: str = Field(..., description="Model version used for prediction")
    confidence_interval: str = Field("80% empirical interval", description="Interval description")
    is_cold_start: Optional[bool] = Field(False, description="Whether clinical specialty prior was utilized for cold start")
    message: Optional[str] = Field(None, description="Clinical description of estimation method")

class ModelInfoResponse(BaseModel):
    model_name: str
    model_version: str
    trained_at: str
    dataset_type: str
    features: List[str]
    feature_importances: Dict[str, float]

class ModelMetricsResponse(BaseModel):
    model_version: str
    best_model_name: str
    evaluation_summary: List[Dict[str, Any]]
    selected_model_metrics: Dict[str, Any]
    feature_importances: Dict[str, float]
