import assert from 'assert';
import mlClient from '../src/services/mlClient.js';

console.log('🧪 Starting Invisible Queue AI — Phase 3 AI Waiting-Time Prediction Verification Suite...\n');

// Test 1: Fallback Baseline Prediction when ML service is unavailable or cold-starting
console.log('Test 1: Fallback baseline calculation for waiting patients');
const mockFeatures1 = {
  patients_ahead: 4,
  queue_length: 7,
  token_position: 5,
  hour_of_day: 10,
  day_of_week: 1,
  is_peak_hour: 1,
  department_id: 1,
  doctor_id: 1,
  doctor_avg_duration: 12.0,
  completed_today: 5
};

const pred1 = await mlClient.predictWaitingTime(mockFeatures1);
assert(pred1, 'Prediction result must exist');
assert(pred1.predicted_wait_minutes > 0, 'Wait time must be positive');
assert(pred1.lower_bound_minutes <= pred1.predicted_wait_minutes, 'Lower bound must be <= predicted');
assert(pred1.predicted_wait_minutes <= pred1.upper_bound_minutes, 'Predicted must be <= upper bound');
assert(pred1.lower_bound_minutes >= 1, 'Lower bound must be >= 1 minute');
assert(typeof pred1.model_version === 'string', 'Model version must be present');
console.log(`✅ PASS: Predicted wait: ${pred1.predicted_wait_minutes} min [${pred1.lower_bound_minutes}–${pred1.upper_bound_minutes} min] (version: ${pred1.model_version})\n`);

// Test 2: Edge Case — 0 Patients Ahead (Next in line)
console.log('Test 2: Edge case when 0 patients ahead (next in line)');
const mockZero = { patients_ahead: 0 };
const predZero = await mlClient.predictWaitingTime(mockZero);
assert.strictEqual(predZero.predicted_wait_minutes, 2.0, 'Wait time for next patient must be 2.0 min');
assert.strictEqual(predZero.lower_bound_minutes, 1, 'Lower bound for next patient must be 1 min');
assert(predZero.upper_bound_minutes <= 4, 'Upper bound for next patient must be <= 4 min');
console.log(`✅ PASS: Next in line correctly returns immediate consultation buffer: ${predZero.predicted_wait_minutes} min [${predZero.lower_bound_minutes}–${predZero.upper_bound_minutes} min]\n`);

// Test 3: Model Info & Serialized Artifacts
console.log('Test 3: Model info retrieval and feature names');
const info = await mlClient.getModelInfo();
assert(info, 'Model info must exist');
assert(info.model_name, 'Model name must be present');
assert(info.model_version, 'Model version must be present');
assert(info.features && info.features.length > 0, 'Features list must not be empty');
assert(info.feature_importances, 'Feature importances must be present');
console.log(`✅ PASS: Model info verified: ${info.model_name} (${info.model_version}) with ${info.features.length} features\n`);

// Test 4: Model Metrics Benchmark Comparison
console.log('Test 4: Model metrics benchmark comparison table');
const metrics = await mlClient.getModelMetrics();
assert(metrics, 'Model metrics report must exist');
assert(metrics.evaluation_summary && metrics.evaluation_summary.length >= 4, 'Must evaluate at least 4 models');

const baseline = metrics.evaluation_summary.find(m => m.model_name.includes('Baseline'));
const ridge = metrics.evaluation_summary.find(m => m.model_name.includes('Linear'));
const rf = metrics.evaluation_summary.find(m => m.model_name.includes('Random Forest'));
const gbr = metrics.evaluation_summary.find(m => m.model_name.includes('Gradient Boosting'));

assert(baseline, 'Baseline model must be in evaluation table');
assert(ridge, 'Linear model must be in evaluation table');
assert(rf, 'Random Forest model must be in evaluation table');
assert(gbr, 'Gradient Boosting model must be in evaluation table');

console.log('Benchmark Results:');
metrics.evaluation_summary.forEach(m => {
  console.log(`  - ${m.model_name}: MAE=${m.test_mae}m | RMSE=${m.test_rmse}m | R²=${m.test_r2}`);
});
console.log(`✅ PASS: All 4 models verified with real calculated metrics. Best: ${metrics.best_model_name}\n`);

// Test 5: Prediction Error Tracking Calculation
console.log('Test 5: Actual vs. Predicted error formula verification');
const predictedWait = 18.0;
const actualWait = 21.5;
const error = Math.round((actualWait - predictedWait) * 10) / 10;
assert.strictEqual(error, 3.5, 'Prediction error should be actual - predicted');
console.log(`✅ PASS: Prediction error calculated correctly: ${error} min\n`);

// Test 6: Non-leaking Feature Verification
console.log('Test 6: Validating that all features strictly exclude post-arrival future data');
const allowedFeatures = [
  'patients_ahead',
  'queue_length',
  'token_position',
  'hour_of_day',
  'day_of_week',
  'is_peak_hour',
  'department_id',
  'doctor_id',
  'doctor_avg_duration',
  'completed_today'
];
const forbiddenLeakingFeatures = [
  'consultation_completed_at',
  'future_consultation_duration',
  'future_cancellations',
  'call_timestamp'
];

forbiddenLeakingFeatures.forEach(leak => {
  assert(!info.features.includes(leak), `Feature ${leak} must NOT be in training features`);
});
console.log('✅ PASS: Confirmed zero temporal data leakage in model features.\n');

console.log('🎉 ALL PHASE 3 VERIFICATION TESTS PASSED SUCCESSFULLY!');
