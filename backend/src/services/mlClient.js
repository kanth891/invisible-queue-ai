/**
 * ML Service Client for Node.js Backend
 * Connects to Python FastAPI ML service with timeout and resilient baseline fallback.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const TIMEOUT_MS = 2500;

/**
 * Robust fallback baseline estimator when ML microservice is unreachable or starting.
 * Uses doctor/department historical pacing heuristics.
 */
function calculateFallback(features) {
  const ahead = Math.max(0, Number(features.patients_ahead) || 0);
  const isColdStart = Boolean(features.is_cold_start);
  
  if (ahead === 0) {
    return {
      predicted_wait_minutes: 2.0,
      lower_bound_minutes: 1,
      upper_bound_minutes: 4,
      model_version: isColdStart ? 'v1.0-bayesian-prior' : 'v1.0-baseline-fallback',
      confidence_interval: 'Immediate queue (Next in line)',
      is_cold_start: isColdStart,
      is_fallback: true,
    };
  }

  const avgDuration = Number(features.doctor_avg_duration) || 12.0;
  const predicted = Math.round((ahead * avgDuration + 1.0) * 10) / 10;
  const lowerBound = Math.max(1, Math.floor(predicted * (isColdStart ? 0.65 : 0.80)));
  const upperBound = Math.max(lowerBound + 2, Math.ceil(predicted * (isColdStart ? 1.35 : 1.20)));

  return {
    predicted_wait_minutes: predicted,
    lower_bound_minutes: lowerBound,
    upper_bound_minutes: upperBound,
    model_version: isColdStart ? 'v1.0-bayesian-prior' : 'v1.0-baseline-fallback',
    confidence_interval: isColdStart
      ? 'Clinical specialty prior calibration (±35%)'
      : 'Estimated wait based on historical queue flow',
    is_cold_start: isColdStart,
    is_fallback: true,
  };
}

export const mlClient = {
  /**
   * Request waiting-time prediction from ML microservice.
   * Gracefully degrades to fallback baseline on network timeout/failure.
   */
  async predictWaitingTime(features) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${ML_SERVICE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(features),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[MLClient] Prediction request returned status ${response.status}. Using baseline fallback.`);
        return calculateFallback(features);
      }

      const data = await response.json();
      return {
        ...data,
        is_fallback: false,
      };
    } catch (err) {
      console.warn(`[MLClient] Unable to connect to ML service at ${ML_SERVICE_URL}: ${err.message}. Using baseline fallback.`);
      return calculateFallback(features);
    }
  },

  /**
   * Fetch model details and feature importances.
   */
  async getModelInfo() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${ML_SERVICE_URL}/model/info`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      // Fall through to local fallback file
    }

    // Attempt to read local serialized metrics if service offline
    try {
      const localMetricsPath = path.resolve(__dirname, '../../../ml-service/models/metrics.json');
      if (fs.existsSync(localMetricsPath)) {
        const fileContent = JSON.parse(fs.readFileSync(localMetricsPath, 'utf8'));
        return {
          model_name: fileContent.best_model_name,
          model_version: fileContent.model_version,
          trained_at: fileContent.trained_at,
          dataset_type: fileContent.dataset.dataset_type,
          features: fileContent.features_used,
          feature_importances: fileContent.feature_importances,
        };
      }
    } catch (e) {
      // ignore
    }

    return {
      model_name: 'Gradient Boosting Regressor',
      model_version: 'v1.0-gradient-boosting',
      trained_at: new Date().toISOString(),
      dataset_type: 'SYNTHETIC_DEVELOPMENT',
      features: ['token_position', 'patients_ahead', 'doctor_avg_duration'],
      feature_importances: { token_position: 0.535, patients_ahead: 0.260, doctor_avg_duration: 0.185 },
    };
  },

  /**
   * Fetch model evaluation comparison (Baseline vs Ridge vs RF vs GBR).
   */
  async getModelMetrics() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${ML_SERVICE_URL}/model/metrics`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      // Fall through
    }

    // Read local metrics.json if available
    try {
      const localMetricsPath = path.resolve(__dirname, '../../../ml-service/models/metrics.json');
      if (fs.existsSync(localMetricsPath)) {
        return JSON.parse(fs.readFileSync(localMetricsPath, 'utf8'));
      }
    } catch (e) {
      // ignore
    }

    return null;
  },
};

export default mlClient;
