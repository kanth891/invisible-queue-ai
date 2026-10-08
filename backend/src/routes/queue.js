import { Router } from 'express';
import crypto from 'crypto';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import mlClient from '../services/mlClient.js';
import { getSetting, getAllSettings, updateSettings } from '../services/settingsService.js';
import { logQueueEvent, getQueueEvents, QUEUE_EVENT_TYPES } from '../services/queueAuditService.js';
import { evaluateDoctorAvailability, pauseDoctorQueue, resumeDoctorQueue, getTodayDateString } from '../services/doctorAvailabilityService.js';
import { checkAndReconcileSingleEntry, reconcileMissedTokens } from '../services/missedTokenReconciler.js';
import {
  SOCKET_EVENTS,
  emitToPatient,
  emitToDoctor,
  emitToDepartment,
  emitToAdmin,
  broadcastQueueUpdate,
} from '../socket/index.js';

const router = Router();

export const APPROACHING_THRESHOLD = parseInt(process.env.APPROACHING_THRESHOLD || '2', 10);

// ── Valid state transitions ────────────────────────
const VALID_TRANSITIONS = {
  WAITING:          ['CALLED', 'CANCELLED', 'NO_SHOW'],
  CALLED:           ['IN_CONSULTATION', 'MISSED', 'NO_SHOW', 'CANCELLED'],
  MISSED:           ['WAITING', 'NO_SHOW', 'CANCELLED'],
  IN_CONSULTATION:  ['COMPLETED'],
  COMPLETED:        [],
  CANCELLED:        [],
  NO_SHOW:          [],
};

/**
 * Generate next token number for a department on a given date.
 * Format: {DEPT_CODE}-{SEQ} e.g. GM-001, CAR-002
 */
async function generateToken(client, departmentId, queueDate) {
  // Get department code
  const deptResult = await client.query('SELECT code FROM departments WHERE id = $1', [departmentId]);
  if (deptResult.rows.length === 0) throw new Error('Department not found');
  const code = deptResult.rows[0].code;

  // Get max token for this department today
  const countResult = await client.query(
    `SELECT COUNT(*) as count FROM queue_entries
     WHERE department_id = $1 AND queue_date = $2`,
    [departmentId, queueDate]
  );

  const seq = parseInt(countResult.rows[0].count) + 1;
  return `${code}-${String(seq).padStart(3, '0')}`;
}

// Comprehensive clinical specialty priors (in minutes) for Bayesian cold-start estimation
export const SPECIALTY_CLINICAL_PRIORS = {
  'general medicine': 11.5,
  'internal medicine': 12.0,
  'cardiology': 18.0,
  'heart': 18.0,
  'pediatrics': 13.0,
  'child': 13.0,
  'orthopedics': 15.0,
  'ortho': 15.0,
  'dermatology': 10.0,
  'skin': 10.0,
  'neurology': 22.0,
  'neuro': 22.0,
  'oncology': 25.0,
  'cancer': 25.0,
  'ent': 11.0,
  'ear': 11.0,
  'ophthalmology': 12.0,
  'eye': 12.0,
  'psychiatry': 28.0,
  'mental': 28.0,
  'gynecology': 14.5,
  'urology': 15.0,
  'emergency': 9.0,
  'default': 14.0,
};

export function resolveSpecialtyPrior(deptName, docSpecialization) {
  const target = `${deptName || ''} ${docSpecialization || ''}`.toLowerCase();
  for (const [key, dur] of Object.entries(SPECIALTY_CLINICAL_PRIORS)) {
    if (key !== 'default' && target.includes(key)) {
      return dur;
    }
  }
  return SPECIALTY_CLINICAL_PRIORS.default;
}

/**
 * Compute real-time ML waiting-time prediction for a queue entry.
 * Strictly uses features available at prediction time (no future data leakage).
 * Logs the prediction record to PostgreSQL `predictions` table for later evaluation.
 */
export async function computeQueuePrediction(entry, activeEntries = null) {
  try {
    if (!activeEntries) {
      const activeResult = await pool.query(
        `SELECT id, token_number, status, created_at
         FROM queue_entries
         WHERE doctor_id = $1 AND queue_date = $2
           AND status IN ('IN_CONSULTATION', 'CALLED', 'WAITING')
         ORDER BY
           CASE
             WHEN status = 'IN_CONSULTATION' THEN 1
             WHEN status = 'CALLED' THEN 2
             ELSE 3
           END,
           created_at ASC`,
        [entry.doctor_id, entry.queue_date]
      );
      activeEntries = activeResult.rows;
    }

    const patientIndex = activeEntries.findIndex(e => e.id === entry.id);

    // If patient is not in active queue
    if (patientIndex === -1) {
      if (entry.status === 'COMPLETED') {
        return {
          token: entry.token_number,
          status: entry.status,
          patients_ahead: 0,
          predicted_wait_minutes: 0,
          lower_bound_minutes: 0,
          upper_bound_minutes: 0,
          model_version: 'v1.0',
          message: 'Consultation completed',
          is_completed: true,
          generated_at: new Date().toISOString(),
        };
      }
      if (entry.status === 'MISSED') {
        return {
          token: entry.token_number,
          status: 'MISSED',
          patients_ahead: 0,
          predicted_wait_minutes: 0,
          lower_bound_minutes: 0,
          upper_bound_minutes: 0,
          model_version: 'v1.0',
          message: 'Your token was missed. You were not present when called. You may rejoin the queue.',
          is_missed: true,
          rejoin_count: entry.rejoin_count || 0,
          generated_at: new Date().toISOString(),
        };
      }
      if (entry.status === 'CANCELLED') {
        return {
          token: entry.token_number,
          status: 'CANCELLED',
          patients_ahead: 0,
          predicted_wait_minutes: 0,
          lower_bound_minutes: 0,
          upper_bound_minutes: 0,
          model_version: 'v1.0',
          message: 'Queue entry cancelled',
          is_cancelled: true,
          generated_at: new Date().toISOString(),
        };
      }
      return {
        token: entry.token_number,
        status: entry.status,
        patients_ahead: 0,
        predicted_wait_minutes: 0,
        lower_bound_minutes: 0,
        upper_bound_minutes: 0,
        model_version: 'v1.0',
        message: `Queue status: ${entry.status}`,
        generated_at: new Date().toISOString(),
      };
    }

    if (entry.status === 'IN_CONSULTATION') {
      return {
        token: entry.token_number,
        status: 'IN_CONSULTATION',
        patients_ahead: 0,
        predicted_wait_minutes: 0,
        lower_bound_minutes: 0,
        upper_bound_minutes: 0,
        model_version: 'v1.0',
        message: 'Currently in consultation with doctor',
        in_consultation: true,
        generated_at: new Date().toISOString(),
      };
    }

    if (entry.status === 'CALLED') {
      return {
        token: entry.token_number,
        status: 'CALLED',
        patients_ahead: 0,
        predicted_wait_minutes: 1.0,
        lower_bound_minutes: 1,
        upper_bound_minutes: 2,
        model_version: 'v1.0',
        message: 'You have been called! Please proceed to doctor consultation room.',
        is_called: true,
        generated_at: new Date().toISOString(),
      };
    }

    // WAITING status: extract features
    const patientsAhead = patientIndex;
    const queueLength = activeEntries.length;
    const tokenPosition = patientIndex + 1;

    const now = new Date();
    const hourOfDay = now.getHours();
    const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon, 6=Sun
    const isPeakHour = [9, 10, 11, 14, 15].includes(hourOfDay) ? 1 : 0;

    // Completed consultations today by doctor
    const completedRes = await pool.query(
      `SELECT COUNT(*) as count FROM queue_entries
       WHERE doctor_id = $1 AND queue_date = $2 AND status = 'COMPLETED'`,
      [entry.doctor_id, entry.queue_date]
    );
    const completedToday = parseInt(completedRes.rows[0]?.count || 0, 10);

    // Fetch department and doctor metadata
    let deptName = '';
    let docSpecialization = '';
    let docConfiguredDur = null;

    try {
      const deptDocRes = await pool.query(
        `SELECT d.name as dept_name, doc.specialization as doc_specialization, doc.avg_consultation_time as doc_configured_dur
         FROM departments d
         LEFT JOIN doctors doc ON doc.id = $2
         WHERE d.id = $1`,
        [entry.department_id, entry.doctor_id]
      );
      if (deptDocRes.rows.length > 0) {
        deptName = deptDocRes.rows[0].dept_name || '';
        docSpecialization = deptDocRes.rows[0].doc_specialization || '';
        docConfiguredDur = deptDocRes.rows[0].doc_configured_dur ? Number(deptDocRes.rows[0].doc_configured_dur) : null;
      }
    } catch (metaErr) {
      // Gracefully continue
    }

    const clinicalPrior = resolveSpecialtyPrior(deptName, docSpecialization);

    // Historical completed consultation telemetry for doctor
    const docDurRes = await pool.query(
      `SELECT 
         COUNT(*) as visit_count,
         AVG(EXTRACT(EPOCH FROM (consultation_completed_at - consultation_started_at))/60) as avg_dur
       FROM queue_entries
       WHERE doctor_id = $1 AND consultation_completed_at IS NOT NULL AND consultation_started_at IS NOT NULL`,
      [entry.doctor_id]
    );
    const docVisits = parseInt(docDurRes.rows[0]?.visit_count || 0, 10);
    const docObservedAvg = docDurRes.rows[0]?.avg_dur ? Number(docDurRes.rows[0].avg_dur) : null;

    // Historical completed consultation telemetry for department
    const deptDurRes = await pool.query(
      `SELECT 
         COUNT(*) as visit_count,
         AVG(EXTRACT(EPOCH FROM (consultation_completed_at - consultation_started_at))/60) as avg_dur
       FROM queue_entries
       WHERE department_id = $1 AND consultation_completed_at IS NOT NULL AND consultation_started_at IS NOT NULL`,
      [entry.department_id]
    );
    const deptVisits = parseInt(deptDurRes.rows[0]?.visit_count || 0, 10);
    const deptObservedAvg = deptDurRes.rows[0]?.avg_dur ? Number(deptDurRes.rows[0].avg_dur) : null;

    // 3-Tier Hierarchical Bayesian Duration Smoothing
    // Tier 1: Department Bayesian smoothed mean (M=5 pseudo-observations from clinical specialty prior)
    const M_dept = 5;
    const effectiveDeptDur = deptVisits > 0 && deptObservedAvg
      ? ((deptVisits * deptObservedAvg) + (M_dept * clinicalPrior)) / (deptVisits + M_dept)
      : clinicalPrior;

    // Tier 2: Doctor baseline prior incorporates configured duration if set, else department smoothed
    const docPrior = docConfiguredDur && docConfiguredDur > 0
      ? (docConfiguredDur + effectiveDeptDur) / 2
      : effectiveDeptDur;

    // Tier 3: Doctor Bayesian smoothed mean (M=3 pseudo-observations from docPrior)
    const M_doc = 3;
    const effectiveDoctorDur = docVisits > 0 && docObservedAvg
      ? ((docVisits * docObservedAvg) + (M_doc * docPrior)) / (docVisits + M_doc)
      : docPrior;

    const doctorAvgDuration = Math.round(effectiveDoctorDur * 10) / 10;
    const isColdStart = (docVisits < 3);

    const features = {
      patients_ahead: patientsAhead,
      queue_length: queueLength,
      token_position: tokenPosition,
      hour_of_day: hourOfDay,
      day_of_week: dayOfWeek,
      is_peak_hour: isPeakHour,
      department_id: entry.department_id,
      doctor_id: entry.doctor_id,
      doctor_avg_duration: doctorAvgDuration,
      completed_today: completedToday,
      department_name: deptName,
      dept_avg_duration: Math.round(effectiveDeptDur * 10) / 10,
      is_cold_start: isColdStart,
    };

    const prediction = await mlClient.predictWaitingTime(features);

    // Log prediction to database
    try {
      await pool.query(
        `INSERT INTO predictions
          (queue_entry_id, token_number, patients_ahead, predicted_wait_minutes,
           lower_bound_minutes, upper_bound_minutes, model_version, features_json, is_fallback, is_cold_start)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          entry.id,
          entry.token_number,
          patientsAhead,
          prediction.predicted_wait_minutes,
          prediction.lower_bound_minutes,
          prediction.upper_bound_minutes,
          prediction.model_version,
          JSON.stringify(features),
          prediction.is_fallback,
          prediction.is_cold_start !== undefined ? prediction.is_cold_start : isColdStart,
        ]
      );
    } catch (logErr) {
      try {
        await pool.query(
          `INSERT INTO predictions
            (queue_entry_id, token_number, patients_ahead, predicted_wait_minutes,
             lower_bound_minutes, upper_bound_minutes, model_version, features_json, is_fallback)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            entry.id,
            entry.token_number,
            patientsAhead,
            prediction.predicted_wait_minutes,
            prediction.lower_bound_minutes,
            prediction.upper_bound_minutes,
            prediction.model_version,
            JSON.stringify(features),
            prediction.is_fallback,
          ]
        );
      } catch (innerErr) {
        console.warn('[Prediction] Failed to insert prediction log:', innerErr.message);
      }
    }

    return {
      token: entry.token_number,
      status: entry.status,
      patients_ahead: patientsAhead,
      predicted_wait_minutes: prediction.predicted_wait_minutes,
      lower_bound_minutes: prediction.lower_bound_minutes,
      upper_bound_minutes: prediction.upper_bound_minutes,
      model_version: prediction.model_version,
      confidence_interval: prediction.confidence_interval || (isColdStart ? 'Clinical specialty prior calibration (±35%)' : '80% empirical prediction interval'),
      is_fallback: prediction.is_fallback,
      is_cold_start: prediction.is_cold_start !== undefined ? prediction.is_cold_start : isColdStart,
      message: (prediction.is_cold_start || isColdStart)
        ? (prediction.message || 'Wait estimated using clinical specialty prior and queue pacing')
        : (prediction.is_fallback
          ? 'Estimated wait based on historical queue flow'
          : 'Predicted wait based on current queue conditions'),
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[Prediction] computeQueuePrediction error:', err);
    return {
      token: entry.token_number,
      status: entry.status,
      patients_ahead: 0,
      predicted_wait_minutes: 5,
      lower_bound_minutes: 3,
      upper_bound_minutes: 8,
      model_version: 'v1.0-fallback',
      is_fallback: true,
      message: 'Wait estimate temporarily unavailable',
      generated_at: new Date().toISOString(),
    };
  }
}

/**
 * Synchronize queue state and trigger real-time Socket.IO notifications + ML predictions
 * across connected patient passes, doctor console, receptionist desk, and admin overview.
 */
export async function syncDoctorQueueRealtime(doctorId, departmentId, triggeredEntry = null, action = null) {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. If triggered entry exists, handle specific patient-targeted event
    if (triggeredEntry && triggeredEntry.queue_access_token) {
      if (triggeredEntry.status === 'CALLED') {
        if (!triggeredEntry.turn_notified_at) {
          try {
            await pool.query('UPDATE queue_entries SET turn_notified_at = NOW() WHERE id = $1', [triggeredEntry.id]);
          } catch (e) { /* ignore */ }
        }
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.PATIENT_TURN, {
          token: triggeredEntry.token_number,
          doctor: triggeredEntry.doctor_name,
          department: triggeredEntry.department_name,
          message: "It's your turn! Please proceed to the consultation room.",
        });
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.TOKEN_CALLED, {
          token: triggeredEntry.token_number,
          status: 'CALLED',
          currentToken: triggeredEntry.token_number,
          position: 1,
          patientsAhead: 0,
        });
      } else if (triggeredEntry.status === 'IN_CONSULTATION') {
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.CONSULTATION_STARTED, {
          token: triggeredEntry.token_number,
          status: 'IN_CONSULTATION',
          currentToken: triggeredEntry.token_number,
          message: 'Consultation has begun with doctor.',
        });
      } else if (triggeredEntry.status === 'COMPLETED') {
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.CONSULTATION_COMPLETED, {
          token: triggeredEntry.token_number,
          status: 'COMPLETED',
          message: 'Consultation completed. Wishing you good health!',
        });
      } else if (triggeredEntry.status === 'NO_SHOW') {
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.PATIENT_NO_SHOW, {
          token: triggeredEntry.token_number,
          status: 'NO_SHOW',
          message: 'Marked as no-show by hospital staff.',
        });
      } else if (triggeredEntry.status === 'CANCELLED') {
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.PATIENT_CANCELLED, {
          token: triggeredEntry.token_number,
          status: 'CANCELLED',
          message: 'Queue entry cancelled.',
        });
      } else if (triggeredEntry.status === 'MISSED') {
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.PATIENT_MISSED, {
          token: triggeredEntry.token_number,
          status: 'MISSED',
          message: 'Your token was missed. You were not present when your token was called. You may rejoin the queue.',
          rejoinCount: triggeredEntry.rejoin_count || 0,
          missedAt: triggeredEntry.missed_at,
        });
      } else if (triggeredEntry.status === 'WAITING' && action === 'REJOINED') {
        emitToPatient(triggeredEntry.queue_access_token, SOCKET_EVENTS.PATIENT_REJOINED, {
          token: triggeredEntry.token_number,
          status: 'WAITING',
          message: 'You have rejoined the queue at the end.',
          rejoinCount: triggeredEntry.rejoin_count || 0,
        });
      }
    }

    // 2. Fetch all active entries for this doctor today to update dynamic queue and predictions
    const activeResult = await pool.query(
      `SELECT qe.*, u.name as doctor_name, dep.name as department_name
       FROM queue_entries qe
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.doctor_id = $1 AND qe.queue_date = $2
         AND qe.status IN ('IN_CONSULTATION', 'CALLED', 'WAITING')
       ORDER BY
         CASE
           WHEN qe.status = 'IN_CONSULTATION' THEN 1
           WHEN qe.status = 'CALLED' THEN 2
           ELSE 3
         END,
         qe.created_at ASC`,
      [doctorId, today]
    );

    const activeEntries = activeResult.rows;
    const currentServing = activeEntries.find(e => e.status === 'IN_CONSULTATION') ||
                           activeEntries.find(e => e.status === 'CALLED') || null;
    const currentToken = currentServing ? currentServing.token_number : null;

    // 3. Update dynamic position, approaching status, and ML predictions for waiting patients
    for (let i = 0; i < activeEntries.length; i++) {
      const entry = activeEntries[i];
      if (entry.status !== 'WAITING') continue;

      const position = i + 1;
      const patientsAhead = i;
      const isApproaching = patientsAhead <= APPROACHING_THRESHOLD;

      // Approaching turn notification deduplication: emit ONLY if approaching_notified_at is not set
      if (isApproaching && !entry.approaching_notified_at) {
        try {
          await pool.query('UPDATE queue_entries SET approaching_notified_at = NOW() WHERE id = $1', [entry.id]);
          entry.approaching_notified_at = new Date();
        } catch (notifErr) { /* ignore */ }

        emitToPatient(entry.queue_access_token, SOCKET_EVENTS.PATIENT_APPROACHING, {
          token: entry.token_number,
          patientsAhead,
          position,
          message: `Your turn is approaching! You have ${patientsAhead} patient${patientsAhead === 1 ? '' : 's'} ahead. Please return to the consultation area.`,
        });
        emitToPatient(entry.queue_access_token, SOCKET_EVENTS.NOTIFICATION_CREATED, {
          type: 'APPROACHING',
          title: 'Turn Approaching',
          token: entry.token_number,
          patientsAhead,
          message: `Your turn is approaching! ${patientsAhead} patient${patientsAhead === 1 ? '' : 's'} ahead.`,
        });
      }

      // Recompute ML prediction with up-to-date queue state
      const prediction = await computeQueuePrediction(entry, activeEntries);

      // Emit updated real-time state to patient pass
      emitToPatient(entry.queue_access_token, SOCKET_EVENTS.WAIT_TIME_UPDATED, {
        token: entry.token_number,
        status: entry.status,
        doctor: entry.doctor_name,
        department: entry.department_name,
        currentToken,
        position,
        patientsAhead,
        isApproaching,
        approachingThreshold: APPROACHING_THRESHOLD,
        queueDate: entry.queue_date,
        prediction,
      });
    }

    // 4. Broadcast general queue update to staff and admin rooms
    broadcastQueueUpdate({
      departmentId,
      doctorId,
      event: SOCKET_EVENTS.QUEUE_UPDATED,
      data: {
        doctorId,
        departmentId,
        action,
        currentToken,
        activeCount: activeEntries.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (syncErr) {
    console.error('[Socket] syncDoctorQueueRealtime error:', syncErr);
  }
}


/**
 * GET /api/queue/access/:accessToken
 * Public endpoint: Returns real-time queue position and AI predicted wait time for a patient.
 * Does NOT expose sensitive patient data, phone numbers, or internal database IDs.
 */
export async function getPatientQueueAccess(req, res) {
  try {
    const { accessToken } = req.params;
    if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 8) {
      return res.status(400).json({ status: 'error', message: 'Invalid queue access token format' });
    }

    const entryResult = await pool.query(
      `SELECT qe.id, qe.token_number, qe.status, qe.doctor_id, qe.department_id, qe.queue_date,
              qe.called_at, qe.missed_at, qe.rejoin_count, qe.reschedule_count,
              qe.transferred_from_doctor_id, qe.transferred_at,
              u.name as doctor_name, dep.name as department_name,
              d.room_number, d.operational_status as doctor_operational_status,
              d.pause_reason as doctor_pause_reason, d.paused_at as doctor_paused_at,
              u_prev.name as transferred_from_doctor_name
       FROM queue_entries qe
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       LEFT JOIN doctors d_prev ON qe.transferred_from_doctor_id = d_prev.id
       LEFT JOIN users u_prev ON d_prev.user_id = u_prev.id
       WHERE qe.queue_access_token = $1`,
      [accessToken.trim()]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Queue entry not found or invalid access token',
      });
    }

    let entry = entryResult.rows[0];

    // Backend-authoritative missed-token check on access
    if (entry.status === 'CALLED') {
      entry = await checkAndReconcileSingleEntry(entry);
    }

    // Query active entries for this doctor on this queue_date
    // Active statuses are CALLED, IN_CONSULTATION, and WAITING
    const activeResult = await pool.query(
      `SELECT id, token_number, status, created_at, called_at, consultation_started_at
       FROM queue_entries
       WHERE doctor_id = $1 AND queue_date = $2
         AND status IN ('IN_CONSULTATION', 'CALLED', 'WAITING')
       ORDER BY
         CASE
           WHEN status = 'IN_CONSULTATION' THEN 1
           WHEN status = 'CALLED' THEN 2
           ELSE 3
         END,
         created_at ASC`,
      [entry.doctor_id, entry.queue_date]
    );

    const activeEntries = activeResult.rows;

    // Currently serving token (first IN_CONSULTATION, or first CALLED)
    const currentServing = activeEntries.find(e => e.status === 'IN_CONSULTATION') ||
                           activeEntries.find(e => e.status === 'CALLED') || null;
    const currentToken = currentServing ? currentServing.token_number : null;

    // Calculate dynamic queue position & patients ahead
    const patientIndex = activeEntries.findIndex(e => e.id === entry.id);

    let position = null;
    let patientsAhead = 0;

    if (patientIndex !== -1) {
      position = patientIndex + 1;
      patientsAhead = patientIndex;
    } else {
      position = null;
      patientsAhead = 0;
    }

    const approachingThreshold = parseInt(process.env.APPROACHING_THRESHOLD || '2', 10);
    const isApproaching = entry.status === 'WAITING' && patientsAhead <= approachingThreshold;

    // Phase 3: Compute intelligent waiting-time prediction
    const prediction = await computeQueuePrediction(entry, activeEntries);

    // Settings for policies
    const graceMinutes = await getSetting('missed_grace_period_minutes');
    const maxRejoins = await getSetting('max_rejoins');
    const maxReschedules = await getSetting('max_reschedules');
    const graceDeadline = entry.called_at
      ? new Date(new Date(entry.called_at).getTime() + graceMinutes * 60000).toISOString()
      : null;

    res.json({
      status: 'ok',
      data: {
        token: entry.token_number,
        doctor: entry.doctor_name,
        doctorId: entry.doctor_id,
        department: entry.department_name,
        departmentId: entry.department_id,
        status: entry.status,
        currentToken,
        position,
        patientsAhead,
        isApproaching,
        approachingThreshold,
        queueDate: entry.queue_date,
        prediction,
        calledAt: entry.called_at,
        missedAt: entry.missed_at,
        gracePeriodMinutes: graceMinutes,
        graceDeadline,
        rejoinCount: entry.rejoin_count || 0,
        maxRejoins,
        rescheduleCount: entry.reschedule_count || 0,
        maxReschedules,
        doctorOperationalStatus: entry.doctor_operational_status || 'AVAILABLE',
        doctorPauseReason: entry.doctor_pause_reason || null,
        doctorPausedAt: entry.doctor_paused_at || null,
        roomNumber: entry.room_number || 'Room 101',
        transferredAt: entry.transferred_at || null,
        transferredFromDoctorName: entry.transferred_from_doctor_name || null,
      },
    });
  } catch (err) {
    console.error('Patient queue access error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

/**
 * POST /api/queue/access/:accessToken/cancel
 * Public patient endpoint: Cancels own queue entry with confirmation.
 */
export async function patientCancelQueue(req, res) {
  try {
    const accessToken = req.params?.accessToken || req.body?.accessToken || req.query?.accessToken;
    if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 8) {
      return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
    }

    const entryRes = await pool.query(
      `SELECT qe.*, u.name as doctor_name, dep.name as department_name
       FROM queue_entries qe
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.queue_access_token = $1`,
      [accessToken.trim()]
    );

    if (entryRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }

    const entry = entryRes.rows[0];
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status)) {
      return res.status(400).json({ status: 'error', message: `Cannot cancel queue entry with status ${entry.status}` });
    }
    if (entry.status === 'IN_CONSULTATION') {
      return res.status(400).json({ status: 'error', message: 'Cannot cancel consultation already in progress' });
    }

    const updateRes = await pool.query(
      `UPDATE queue_entries SET status = 'CANCELLED' WHERE id = $1 RETURNING *`,
      [entry.id]
    );

    await logQueueEvent(pool, {
      queueEntryId: entry.id,
      eventType: QUEUE_EVENT_TYPES.CANCELLED,
      actorType: 'PATIENT',
      details: { token: entry.token_number, previousStatus: entry.status },
    });

    const updated = { ...entry, ...updateRes.rows[0] };
    syncDoctorQueueRealtime(entry.doctor_id, entry.department_id, updated, 'CANCELLED');

    res.json({
      status: 'ok',
      message: 'Queue entry cancelled successfully',
      data: { token: entry.token_number, status: 'CANCELLED' },
    });
  } catch (err) {
    console.error('Patient cancel queue error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

/**
 * POST /api/queue/access/:accessToken/rejoin
 * Public patient endpoint: Rejoin queue after being marked MISSED.
 * Places patient at the end of the current active queue.
 */
export async function patientRejoinQueue(req, res) {
  const client = await pool.connect();
  try {
    const accessToken = req.params?.accessToken || req.body?.accessToken || req.query?.accessToken;
    if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 8) {
      return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
    }

    const entryRes = await client.query(
      `SELECT qe.*, u.name as doctor_name, dep.name as department_name, d.status as doc_status, d.operational_status
       FROM queue_entries qe
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.queue_access_token = $1`,
      [accessToken.trim()]
    );

    if (entryRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }

    let entry = entryRes.rows[0];

    // If CALLED, check if grace period expired and reconcile
    if (entry.status === 'CALLED') {
      entry = await checkAndReconcileSingleEntry(entry);
    }

    if (entry.status !== 'MISSED') {
      return res.status(400).json({
        status: 'error',
        message: `Only missed tokens can rejoin the queue. Current status: ${entry.status}`,
      });
    }

    // Check rejoin limit
    const maxRejoins = await getSetting('max_rejoins');
    if ((entry.rejoin_count || 0) >= maxRejoins) {
      return res.status(400).json({
        status: 'error',
        message: `You have reached the maximum number of queue changes for this visit (${maxRejoins}). Please see reception.`,
      });
    }

    // Check doctor is active
    if (entry.doc_status === 'INACTIVE') {
      return res.status(400).json({ status: 'error', message: 'Assigned doctor is currently inactive. Please reschedule or visit reception.' });
    }

    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE queue_entries
       SET status = 'WAITING',
           created_at = NOW(),
           rejoin_count = rejoin_count + 1,
           called_at = NULL,
           missed_at = NULL,
           approaching_notified_at = NULL,
           turn_notified_at = NULL
       WHERE id = $1
       RETURNING *`,
      [entry.id]
    );

    await logQueueEvent(client, {
      queueEntryId: entry.id,
      eventType: QUEUE_EVENT_TYPES.REJOINED,
      actorType: 'PATIENT',
      details: {
        token: entry.token_number,
        rejoinCount: updateRes.rows[0].rejoin_count,
        previousMissedAt: entry.missed_at,
      },
    });

    await client.query('COMMIT');

    const updatedEntry = { ...entry, ...updateRes.rows[0] };

    // Broadcast and recompute predictions
    syncDoctorQueueRealtime(entry.doctor_id, entry.department_id, updatedEntry, 'REJOINED');

    // Compute updated prediction for the patient
    const prediction = await computeQueuePrediction(updatedEntry);

    res.json({
      status: 'ok',
      message: 'You have rejoined the queue at the end',
      data: {
        token: updatedEntry.token_number,
        status: 'WAITING',
        rejoinCount: updatedEntry.rejoin_count,
        prediction,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Patient rejoin queue error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
}

/**
 * GET /api/queue/access/:accessToken/reschedule-options
 * Public patient endpoint: Returns available doctors/queues today in same department.
 */
export async function getPatientRescheduleOptions(req, res) {
  try {
    const accessToken = req.params?.accessToken || req.body?.accessToken || req.query?.accessToken;
    if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 8) {
      return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
    }

    const entryRes = await pool.query(
      `SELECT qe.*, dep.name as department_name
       FROM queue_entries qe
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.queue_access_token = $1`,
      [accessToken.trim()]
    );

    if (entryRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }

    const entry = entryRes.rows[0];
    if (!['WAITING', 'MISSED'].includes(entry.status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot reschedule from status ${entry.status}`,
      });
    }

    const maxReschedules = await getSetting('max_reschedules');
    if ((entry.reschedule_count || 0) >= maxReschedules) {
      return res.status(400).json({
        status: 'error',
        message: `You have reached the maximum number of reschedules for this visit (${maxReschedules}).`,
      });
    }

    // Find all active doctors in this department
    const allAvailability = await getAllDoctorsTodayAvailability();
    const availableOptions = allAvailability.filter(d =>
      d.departmentId === entry.department_id &&
      d.id !== entry.doctor_id &&
      d.isAvailable &&
      !d.isAtCapacity &&
      d.accountStatus === 'ACTIVE'
    );

    res.json({
      status: 'ok',
      data: {
        currentDoctorId: entry.doctor_id,
        departmentName: entry.department_name,
        rescheduleCount: entry.reschedule_count || 0,
        maxReschedules,
        options: availableOptions.map(d => ({
          doctorId: d.id,
          name: d.name,
          specialization: d.specialization,
          roomNumber: d.roomNumber,
          patientsWaiting: d.patientsWaiting,
          estimatedWaitMinutes: Math.max(5, (d.patientsWaiting * 12) + 2),
        })),
      },
    });
  } catch (err) {
    console.error('Get reschedule options error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

/**
 * POST /api/queue/access/:accessToken/reschedule
 * Public patient endpoint: Reschedules patient to an alternative doctor today.
 */
export async function patientRescheduleQueue(req, res) {
  const client = await pool.connect();
  try {
    const accessToken = req.params?.accessToken || req.body?.accessToken || req.query?.accessToken;
    const target_doctor_id = req.body?.target_doctor_id || req.body?.newDoctorId;

    if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 8) {
      return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
    }
    if (!target_doctor_id) {
      return res.status(400).json({ status: 'error', message: 'Target doctor is required' });
    }

    const entryRes = await client.query(
      `SELECT qe.*, dep.name as department_name, d.user_id
       FROM queue_entries qe
       JOIN departments dep ON qe.department_id = dep.id
       JOIN doctors d ON qe.doctor_id = d.id
       WHERE qe.queue_access_token = $1`,
      [accessToken.trim()]
    );

    if (entryRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }

    const entry = entryRes.rows[0];
    if (!['WAITING', 'MISSED'].includes(entry.status)) {
      return res.status(400).json({ status: 'error', message: `Cannot reschedule from status ${entry.status}` });
    }

    const maxReschedules = await getSetting('max_reschedules');
    if ((entry.reschedule_count || 0) >= maxReschedules) {
      return res.status(400).json({
        status: 'error',
        message: `You have reached the maximum number of reschedules for this visit (${maxReschedules}).`,
      });
    }

    const targetDocId = parseInt(target_doctor_id, 10);
    if (targetDocId === entry.doctor_id) {
      return res.status(400).json({ status: 'error', message: 'Target doctor must be different from current doctor' });
    }

    // Verify target doctor
    const targetDocRes = await client.query(
      `SELECT d.*, u.name as doctor_name
       FROM doctors d JOIN users u ON d.user_id = u.id
       WHERE d.id = $1 AND d.department_id = $2 AND d.status = 'ACTIVE'`,
      [targetDocId, entry.department_id]
    );

    if (targetDocRes.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Selected doctor is not available in this department' });
    }

    const targetDoc = targetDocRes.rows[0];
    const targetAvail = await evaluateDoctorAvailability(targetDoc);
    if (!targetAvail.isAvailable) {
      return res.status(400).json({ status: 'error', message: `Target doctor is not currently available: ${targetAvail.reason}` });
    }

    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE queue_entries
       SET doctor_id = $1,
           created_at = NOW(),
           status = 'WAITING',
           reschedule_count = reschedule_count + 1,
           called_at = NULL,
           missed_at = NULL,
           approaching_notified_at = NULL,
           turn_notified_at = NULL
       WHERE id = $2
       RETURNING *`,
      [targetDocId, entry.id]
    );

    await logQueueEvent(client, {
      queueEntryId: entry.id,
      eventType: QUEUE_EVENT_TYPES.RESCHEDULED,
      actorType: 'PATIENT',
      details: {
        fromDoctorId: entry.doctor_id,
        toDoctorId: targetDocId,
        rescheduleCount: updateRes.rows[0].reschedule_count,
      },
    });

    await client.query('COMMIT');

    const updated = { ...entry, ...updateRes.rows[0], doctor_name: targetDoc.doctor_name };

    // Emit event and sync both queues
    emitToPatient(accessToken, SOCKET_EVENTS.PATIENT_RESCHEDULED, {
      token: updated.token_number,
      doctor: targetDoc.doctor_name,
      message: `Your queue has been rescheduled to Dr. ${targetDoc.doctor_name}.`,
    });

    syncDoctorQueueRealtime(entry.doctor_id, entry.department_id, null, 'RESCHEDULED');
    syncDoctorQueueRealtime(targetDocId, entry.department_id, updated, 'RESCHEDULED');

    const newPrediction = await computeQueuePrediction(updated);

    res.json({
      status: 'ok',
      message: `Rescheduled successfully to Dr. ${targetDoc.doctor_name}`,
      data: {
        token: updated.token_number,
        doctor: targetDoc.doctor_name,
        doctorId: targetDocId,
        roomNumber: targetDoc.room_number || 'Room 101',
        rescheduleCount: updated.reschedule_count,
        prediction: newPrediction,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Patient reschedule error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
}

/**
 * POST /api/queue/token
 * Create a new queue entry / generate token. Receptionist + Admin.
 */
router.post('/token', authorize('ADMIN', 'RECEPTIONIST'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { patient_id, doctor_id, department_id } = req.body;

    if (!patient_id || !doctor_id || !department_id) {
      return res.status(400).json({ status: 'error', message: 'Patient, doctor, and department are required' });
    }

    // Validate patient
    const patientCheck = await client.query('SELECT id, name FROM patients WHERE id = $1', [patient_id]);
    if (patientCheck.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Patient not found' });
    }

    // Validate doctor
    const doctorCheck = await client.query(
      `SELECT d.id, d.department_id, u.name as doctor_name, dep.name as department_name
       FROM doctors d JOIN users u ON d.user_id = u.id JOIN departments dep ON d.department_id = dep.id
       WHERE d.id = $1 AND d.status = 'ACTIVE'`,
      [doctor_id]
    );
    if (doctorCheck.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Doctor not found or inactive' });
    }

    // Validate department matches doctor
    if (doctorCheck.rows[0].department_id !== parseInt(department_id)) {
      return res.status(400).json({ status: 'error', message: 'Doctor does not belong to selected department' });
    }

    // Check department is active
    const deptCheck = await client.query('SELECT id FROM departments WHERE id = $1 AND status = $2', [department_id, 'ACTIVE']);
    if (deptCheck.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Department is inactive' });
    }

    // Doctor operational availability check (Leave, Schedule, Pause)
    const availability = await evaluateDoctorAvailability(doctorCheck.rows[0]);
    if (!availability.isAvailable) {
      return res.status(400).json({
        status: 'error',
        message: `Dr. ${doctorCheck.rows[0].doctor_name} is currently unavailable: ${availability.reason}`,
      });
    }

    // Queue capacity check
    const defaultCapacity = await getSetting('default_queue_capacity');
    const doctorCapacity = doctorCheck.rows[0].daily_capacity || defaultCapacity;
    const capacityCountRes = await client.query(
      'SELECT COUNT(*) as count FROM queue_entries WHERE doctor_id = $1 AND queue_date = CURRENT_DATE',
      [doctor_id]
    );
    if (parseInt(capacityCountRes.rows[0].count, 10) >= doctorCapacity) {
      return res.status(400).json({
        status: 'error',
        message: `Dr. ${doctorCheck.rows[0].doctor_name}'s queue has reached its daily capacity of ${doctorCapacity} patients. Please choose another available doctor.`,
      });
    }

    // Check for duplicate active token for same patient + doctor today
    const duplicateCheck = await client.query(
      `SELECT id FROM queue_entries
       WHERE patient_id = $1 AND doctor_id = $2 AND queue_date = CURRENT_DATE
       AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
      [patient_id, doctor_id]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: 'Patient already has an active token for this doctor today' });
    }

    await client.query('BEGIN');

    const today = new Date().toISOString().split('T')[0];
    const tokenNumber = await generateToken(client, department_id, today);

    // Phase 2: Generate cryptographically secure access token for virtual queue access
    const queueAccessToken = crypto.randomBytes(16).toString('hex');

    const result = await client.query(
      `INSERT INTO queue_entries (patient_id, doctor_id, department_id, token_number, queue_access_token, queue_date, status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'WAITING') RETURNING *`,
      [patient_id, doctor_id, department_id, tokenNumber, queueAccessToken]
    );

    await logQueueEvent(client, {
      queueEntryId: result.rows[0].id,
      eventType: QUEUE_EVENT_TYPES.QUEUE_CREATED,
      actorType: req.user?.role || 'RECEPTIONIST',
      actorId: req.user?.id || null,
      details: { token: tokenNumber, doctorId: doctor_id, departmentId: department_id },
    });

    await client.query('COMMIT');

    const createdData = {
      ...result.rows[0],
      patient_name: patientCheck.rows[0].name,
      doctor_name: doctorCheck.rows[0].doctor_name,
      department_name: doctorCheck.rows[0].department_name,
      queue_access_token: queueAccessToken,
    };

    // Phase 4: Real-time broadcast and initial AI prediction sync
    syncDoctorQueueRealtime(doctor_id, department_id, createdData, 'NEW_PATIENT');

    res.status(201).json({
      status: 'ok',
      message: 'Token generated successfully',
      data: createdData,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Generate token error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/queue
 * List queue entries for today. Filterable.
 */
router.get('/', async (req, res) => {
  try {
    const { doctor_id, department_id, status, date, search } = req.query;
    const queueDate = date || new Date().toISOString().split('T')[0];

    let query = `
      SELECT qe.*,
             p.name as patient_name, p.age as patient_age, p.gender as patient_gender, p.phone as patient_phone,
             u.name as doctor_name,
             dep.name as department_name, dep.code as department_code
      FROM queue_entries qe
      JOIN patients p ON qe.patient_id = p.id
      JOIN doctors d ON qe.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN departments dep ON qe.department_id = dep.id
      WHERE qe.queue_date = $1
    `;
    const params = [queueDate];

    if (doctor_id) {
      params.push(doctor_id);
      query += ` AND qe.doctor_id = $${params.length}`;
    }
    if (department_id) {
      params.push(department_id);
      query += ` AND qe.department_id = $${params.length}`;
    }
    if (status) {
      params.push(status.toUpperCase());
      query += ` AND qe.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name ILIKE $${params.length} OR qe.token_number ILIKE $${params.length})`;
    }

    query += ' ORDER BY qe.created_at ASC';
    const result = await pool.query(query, params);

    res.json({ status: 'ok', data: result.rows });
  } catch (err) {
    console.error('Get queue error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/queue/doctor/:doctorId
 * Get queue for a specific doctor (today).
 */
router.get('/doctor/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT qe.*,
              p.name as patient_name, p.age as patient_age, p.gender as patient_gender, p.phone as patient_phone,
              u.name as doctor_name,
              dep.name as department_name, dep.code as department_code
       FROM queue_entries qe
       JOIN patients p ON qe.patient_id = p.id
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.doctor_id = $1 AND qe.queue_date = $2
       ORDER BY qe.created_at ASC`,
      [doctorId, today]
    );

    let waitingCounter = 0;
    const enriched = result.rows.map(row => {
      if (row.status === 'WAITING') {
        const ahead = waitingCounter++;
        return {
          ...row,
          patients_ahead: ahead,
          predicted_wait_minutes: ahead === 0 ? 2 : Math.round(ahead * 12 + 1),
        };
      }
      return row;
    });

    res.json({ status: 'ok', data: enriched });
  } catch (err) {
    console.error('Get doctor queue error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/queue/department/:departmentId
 * Get queue for a department (today).
 */
router.get('/department/:departmentId', async (req, res) => {
  try {
    const { departmentId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT qe.*,
              p.name as patient_name, p.age as patient_age, p.gender as patient_gender, p.phone as patient_phone,
              u.name as doctor_name,
              dep.name as department_name, dep.code as department_code
       FROM queue_entries qe
       JOIN patients p ON qe.patient_id = p.id
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.department_id = $1 AND qe.queue_date = $2
       ORDER BY qe.created_at ASC`,
      [departmentId, today]
    );

    res.json({ status: 'ok', data: result.rows });
  } catch (err) {
    console.error('Get department queue error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/queue/stats
 * Get queue statistics for today. Used by admin and receptionist dashboards.
 */
// Public route for patient virtual queue access
router.get('/access/:accessToken', getPatientQueueAccess);

export async function getPatientPrediction(req, res) {
  try {
    const { accessToken } = req.params;
    if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 8) {
      return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
    }

    const entryResult = await pool.query(
      `SELECT qe.*, u.name as doctor_name, dep.name as department_name
       FROM queue_entries qe
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.queue_access_token = $1`,
      [accessToken.trim()]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }

    const prediction = await computeQueuePrediction(entryResult.rows[0]);
    res.json({ status: 'ok', data: prediction });
  } catch (err) {
    console.error('Patient prediction error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

router.get('/access/:accessToken/prediction', getPatientPrediction);

/**
 * GET /api/queue/admin/prediction-metrics
 * Admin & Research interface: Returns model evaluation comparison table,
 * feature importances, and live database prediction metrics (actual vs predicted).
 */
router.get('/admin/prediction-metrics', authorize('ADMIN'), async (req, res) => {
  try {
    const [modelInfo, modelMetrics] = await Promise.all([
      mlClient.getModelInfo(),
      mlClient.getModelMetrics(),
    ]);

    // Query live PostgreSQL predictions table for performance metrics
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) as total_predictions,
        COUNT(*) FILTER (WHERE is_fallback = true) as fallback_count,
        COUNT(*) FILTER (WHERE actual_wait_minutes IS NOT NULL) as evaluated_count,
        ROUND(AVG(ABS(prediction_error))::numeric, 2) as live_mae,
        ROUND(SQRT(AVG(prediction_error * prediction_error))::numeric, 2) as live_rmse,
        ROUND(AVG(predicted_wait_minutes)::numeric, 1) as avg_predicted_wait,
        ROUND(AVG(actual_wait_minutes)::numeric, 1) as avg_actual_wait
      FROM predictions
    `);

    // Recent 10 evaluations for actual vs predicted audit
    const recentRes = await pool.query(`
      SELECT
        p.id, p.token_number, p.patients_ahead,
        p.predicted_wait_minutes, p.lower_bound_minutes, p.upper_bound_minutes,
        p.actual_wait_minutes, p.prediction_error, p.model_version, p.is_fallback,
        p.created_at
      FROM predictions p
      ORDER BY p.created_at DESC
      LIMIT 15
    `);

    res.json({
      status: 'ok',
      data: {
        modelInfo,
        modelMetrics,
        liveDatabaseStats: {
          totalPredictions: parseInt(statsRes.rows[0].total_predictions || 0, 10),
          fallbackCount: parseInt(statsRes.rows[0].fallback_count || 0, 10),
          evaluatedCount: parseInt(statsRes.rows[0].evaluated_count || 0, 10),
          liveMAE: statsRes.rows[0].live_mae !== null ? parseFloat(statsRes.rows[0].live_mae) : null,
          liveRMSE: statsRes.rows[0].live_rmse !== null ? parseFloat(statsRes.rows[0].live_rmse) : null,
          avgPredictedWait: statsRes.rows[0].avg_predicted_wait ? parseFloat(statsRes.rows[0].avg_predicted_wait) : null,
          avgActualWait: statsRes.rows[0].avg_actual_wait ? parseFloat(statsRes.rows[0].avg_actual_wait) : null,
        },
        recentPredictions: recentRes.rows,
      },
    });
  } catch (err) {
    console.error('Prediction metrics error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/queue/:id/prediction
 * Protected endpoint: Returns real-time ML prediction for staff / doctors by queue entry ID.
 */
router.get('/:id/prediction', authorize('DOCTOR', 'ADMIN', 'RECEPTIONIST'), async (req, res) => {
  try {
    const { id } = req.params;
    const entryResult = await pool.query('SELECT * FROM queue_entries WHERE id = $1', [id]);
    if (entryResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }

    const prediction = await computeQueuePrediction(entryResult.rows[0]);
    res.json({ status: 'ok', data: prediction });
  } catch (err) {
    console.error('Queue entry prediction error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_patients,
        COUNT(*) FILTER (WHERE status = 'WAITING') as waiting,
        COUNT(*) FILTER (WHERE status = 'CALLED') as called,
        COUNT(*) FILTER (WHERE status = 'IN_CONSULTATION') as in_consultation,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW') as no_show,
        COUNT(*) FILTER (WHERE status = 'MISSED') as missed,
        COALESCE(SUM(rejoin_count), 0) as total_rejoins,
        COALESCE(SUM(reschedule_count), 0) as total_reschedules,
        COUNT(DISTINCT doctor_id) FILTER (WHERE status IN ('WAITING', 'CALLED', 'IN_CONSULTATION')) as active_virtual_queues
      FROM queue_entries
      WHERE queue_date = $1
    `, [today]);

    const doctorCount = await pool.query(`SELECT COUNT(*) as count FROM doctors WHERE status = 'ACTIVE'`);
    const deptCount = await pool.query(`SELECT COUNT(*) as count FROM departments WHERE status = 'ACTIVE'`);

    res.json({
      status: 'ok',
      data: {
        ...stats.rows[0],
        total_doctors: doctorCount.rows[0].count,
        total_departments: deptCount.rows[0].count,
      },
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ── Queue Actions ──────────────────────────────────

/**
 * Helper: transition queue entry status.
 */
async function transitionStatus(req, res, targetStatus, timestampField = null) {
  try {
    const { id } = req.params;

    const existing = await pool.query('SELECT * FROM queue_entries WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }

    const entry = existing.rows[0];
    const allowed = VALID_TRANSITIONS[entry.status] || [];

    if (!allowed.includes(targetStatus)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot transition from ${entry.status} to ${targetStatus}`,
      });
    }

    let query = `UPDATE queue_entries SET status = $1`;
    const params = [targetStatus];

    if (timestampField) {
      params.push(new Date());
      query += `, ${timestampField} = $${params.length}`;
    }

    params.push(id);
    query += ` WHERE id = $${params.length} RETURNING *`;

    const result = await pool.query(query, params);

    // Phase 3 & 4 Telemetry:
    // 1. When consultation starts: record actual wait minutes & prediction error
    if (targetStatus === 'IN_CONSULTATION') {
      try {
        const startTs = result.rows[0].consultation_started_at;
        const createdTs = result.rows[0].created_at;
        if (startTs && createdTs) {
          const actualWait = Math.max(0.5, Math.round(((new Date(startTs) - new Date(createdTs)) / 60000) * 10) / 10);
          
          // Backfill predictions table
          await pool.query(
            `UPDATE predictions
             SET actual_wait_minutes = $1,
                 prediction_error = ($1 - predicted_wait_minutes)
             WHERE queue_entry_id = $2 AND actual_wait_minutes IS NULL`,
            [actualWait, id]
          );

          // Update queue_entries actual wait and prediction error
          await pool.query(
            `UPDATE queue_entries
             SET actual_wait_minutes = $1,
                 prediction_error_minutes = (
                   SELECT ROUND(ABS(prediction_error)::numeric, 1)
                   FROM predictions
                   WHERE queue_entry_id = $2
                   ORDER BY created_at DESC LIMIT 1
                 )
             WHERE id = $2`,
            [actualWait, id]
          );
        }
      } catch (backfillErr) {
        console.warn('[Queue] Prediction actual wait backfill warning:', backfillErr.message);
      }
    }

    // 2. When consultation completes: record consultation duration
    if (targetStatus === 'COMPLETED') {
      try {
        const completedTs = result.rows[0].consultation_completed_at;
        const startedTs = result.rows[0].consultation_started_at;
        if (completedTs && startedTs) {
          const duration = Math.max(0.5, Math.round(((new Date(completedTs) - new Date(startedTs)) / 60000) * 10) / 10);
          await pool.query(
            `UPDATE queue_entries SET consultation_duration_minutes = $1 WHERE id = $2`,
            [duration, id]
          );
        }
      } catch (durErr) {
        console.warn('[Queue] Consultation duration calculation warning:', durErr.message);
      }
    }

    // Fetch full entry with joins
    const fullResult = await pool.query(
      `SELECT qe.*,
              p.name as patient_name, p.age as patient_age, p.gender as patient_gender,
              u.name as doctor_name,
              dep.name as department_name
       FROM queue_entries qe
       JOIN patients p ON qe.patient_id = p.id
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.id = $1`,
      [id]
    );

    const updatedEntry = fullResult.rows[0];

    // Log queue event in audit trail
    const eventTypeMap = {
      CALLED: QUEUE_EVENT_TYPES.CALLED,
      MISSED: QUEUE_EVENT_TYPES.MISSED,
      IN_CONSULTATION: QUEUE_EVENT_TYPES.CONSULTATION_STARTED,
      COMPLETED: QUEUE_EVENT_TYPES.COMPLETED,
      NO_SHOW: QUEUE_EVENT_TYPES.NO_SHOW,
      CANCELLED: QUEUE_EVENT_TYPES.CANCELLED,
    };
    if (eventTypeMap[targetStatus]) {
      await logQueueEvent(pool, {
        queueEntryId: id,
        eventType: eventTypeMap[targetStatus],
        actorType: req.user?.role || 'STAFF',
        actorId: req.user?.id || null,
        details: { previousStatus: entry.status, newStatus: targetStatus },
      });
    }

    // Phase 4: Trigger real-time Socket.IO broadcasts & ML updates across connected clients
    syncDoctorQueueRealtime(entry.doctor_id, entry.department_id, updatedEntry, targetStatus);

    res.json({
      status: 'ok',
      message: `Patient status changed to ${targetStatus}`,
      data: updatedEntry,
    });
  } catch (err) {
    console.error(`Queue ${targetStatus} error:`, err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

/**
 * GET /api/queue/:id/live
 * Authoritative live state of a queue entry for staff & doctor dashboard.
 */
router.get('/:id/live', authorize('DOCTOR', 'ADMIN', 'RECEPTIONIST'), async (req, res) => {
  try {
    const { id } = req.params;
    const entryResult = await pool.query(
      `SELECT qe.*, p.name as patient_name, u.name as doctor_name, dep.name as department_name
       FROM queue_entries qe
       JOIN patients p ON qe.patient_id = p.id
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.id = $1`,
      [id]
    );
    if (entryResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
    }
    const entry = entryResult.rows[0];
    const prediction = await computeQueuePrediction(entry);
    res.json({
      status: 'ok',
      data: {
        ...entry,
        prediction,
      },
    });
  } catch (err) {
    console.error('Get live queue entry error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/queue/:id/call
 * Call the next patient. Doctor only.
 */
router.post('/:id/call', authorize('DOCTOR', 'ADMIN'), async (req, res) => {
  // Check if doctor already has a patient IN_CONSULTATION
  if (req.user.role === 'DOCTOR') {
    const docResult = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
    if (docResult.rows.length > 0) {
      const activeConsult = await pool.query(
        `SELECT id FROM queue_entries
         WHERE doctor_id = $1 AND queue_date = CURRENT_DATE AND status = 'IN_CONSULTATION'`,
        [docResult.rows[0].id]
      );
      if (activeConsult.rows.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot call next patient — you have a patient currently in consultation',
        });
      }
    }
  }
  transitionStatus(req, res, 'CALLED', 'called_at');
});

/**
 * POST /api/queue/:id/start
 */
router.post('/:id/start', authorize('DOCTOR', 'ADMIN'), (req, res) => {
  transitionStatus(req, res, 'IN_CONSULTATION', 'consultation_started_at');
});

/**
 * POST /api/queue/:id/complete
 */
router.post('/:id/complete', authorize('DOCTOR', 'ADMIN'), (req, res) => {
  transitionStatus(req, res, 'COMPLETED', 'consultation_completed_at');
});

/**
 * POST /api/queue/:id/missed
 * Doctor or Admin explicitly marks patient as MISSED (e.g. grace period elapsed).
 */
router.post('/:id/missed', authorize('DOCTOR', 'ADMIN'), (req, res) => {
  transitionStatus(req, res, 'MISSED', 'missed_at');
});

/**
 * POST /api/queue/:id/no-show
 */
router.post('/:id/no-show', authorize('DOCTOR', 'ADMIN', 'RECEPTIONIST'), (req, res) => {
  transitionStatus(req, res, 'NO_SHOW');
});

/**
 * POST /api/queue/:id/cancel
 */
router.post('/:id/cancel', authorize('ADMIN', 'RECEPTIONIST'), (req, res) => {
  transitionStatus(req, res, 'CANCELLED');
});

/**
 * POST /api/queue/transfer
 * Admin transfers waiting patients from one doctor to another.
 * Validates department compatibility, active state, and queue capacity.
 */
router.post('/transfer', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { source_doctor_id, target_doctor_id, entry_ids } = req.body;

    if (!source_doctor_id || !target_doctor_id) {
      return res.status(400).json({ status: 'error', message: 'Source and target doctors are required' });
    }

    const srcId = parseInt(source_doctor_id, 10);
    const tgtId = parseInt(target_doctor_id, 10);

    if (srcId === tgtId) {
      return res.status(400).json({ status: 'error', message: 'Source and target doctor must be different' });
    }

    // Verify both doctors
    const docsRes = await client.query(
      `SELECT d.*, u.name as doctor_name, dep.name as department_name
       FROM doctors d
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON d.department_id = dep.id
       WHERE d.id IN ($1, $2)`,
      [srcId, tgtId]
    );

    const sourceDoc = docsRes.rows.find(d => d.id === srcId);
    const targetDoc = docsRes.rows.find(d => d.id === tgtId);

    if (!sourceDoc || !targetDoc) {
      return res.status(404).json({ status: 'error', message: 'Source or target doctor not found' });
    }

    // Must be same department
    if (sourceDoc.department_id !== targetDoc.department_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Queue transfers are only permitted between doctors within the same department',
      });
    }

    // Target doctor availability & capacity check
    const targetAvail = await evaluateDoctorAvailability(targetDoc);
    if (!targetAvail.isAvailable) {
      return res.status(400).json({
        status: 'error',
        message: `Target doctor Dr. ${targetDoc.doctor_name} is unavailable: ${targetAvail.reason}`,
      });
    }

    // Find waiting patients to transfer
    let query = `
      SELECT qe.*, p.name as patient_name
      FROM queue_entries qe
      JOIN patients p ON qe.patient_id = p.id
      WHERE qe.doctor_id = $1 AND qe.queue_date = CURRENT_DATE
        AND qe.status IN ('WAITING', 'CALLED', 'MISSED')
    `;
    const params = [srcId];
    if (Array.isArray(entry_ids) && entry_ids.length > 0) {
      params.push(entry_ids);
      query += ` AND qe.id = ANY($2)`;
    }
    query += ' ORDER BY qe.created_at ASC';

    const patientsRes = await client.query(query, params);
    if (patientsRes.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No active waiting patients found to transfer' });
    }

    // Check target doctor capacity
    const defaultCapacity = await getSetting('default_queue_capacity');
    const targetCapacity = targetDoc.daily_capacity || defaultCapacity;
    const countRes = await client.query(
      'SELECT COUNT(*) as count FROM queue_entries WHERE doctor_id = $1 AND queue_date = CURRENT_DATE',
      [tgtId]
    );
    const currentTargetCount = parseInt(countRes.rows[0].count, 10);
    if (currentTargetCount + patientsRes.rows.length > targetCapacity) {
      return res.status(400).json({
        status: 'error',
        message: `Transfer would exceed Dr. ${targetDoc.doctor_name}'s capacity (${currentTargetCount}/${targetCapacity} slots filled, transferring ${patientsRes.rows.length})`,
      });
    }

    await client.query('BEGIN');

    const transferredEntries = [];
    for (const p of patientsRes.rows) {
      const updRes = await client.query(
        `UPDATE queue_entries
         SET doctor_id = $1,
             transferred_from_doctor_id = $2,
             transferred_at = NOW(),
             status = 'WAITING',
             called_at = NULL,
             missed_at = NULL,
             approaching_notified_at = NULL,
             turn_notified_at = NULL
         WHERE id = $3
         RETURNING *`,
        [tgtId, srcId, p.id]
      );
      transferredEntries.push({ ...p, ...updRes.rows[0], doctor_name: targetDoc.doctor_name });

      await logQueueEvent(client, {
        queueEntryId: p.id,
        eventType: QUEUE_EVENT_TYPES.QUEUE_TRANSFERRED,
        actorType: 'ADMIN',
        actorId: req.user.id,
        details: {
          fromDoctorId: srcId,
          toDoctorId: tgtId,
          fromDoctorName: sourceDoc.doctor_name,
          toDoctorName: targetDoc.doctor_name,
        },
      });
    }

    await client.query('COMMIT');

    // Notify transferred patients via individual sockets and broadcast updates
    for (const tp of transferredEntries) {
      if (tp.queue_access_token) {
        emitToPatient(tp.queue_access_token, SOCKET_EVENTS.QUEUE_TRANSFERRED, {
          token: tp.token_number,
          doctor: targetDoc.doctor_name,
          room: targetDoc.room_number || 'Room 101',
          message: `Your assigned doctor is unavailable. Your queue has been transferred to Dr. ${targetDoc.doctor_name}.`,
        });
      }
    }

    syncDoctorQueueRealtime(srcId, sourceDoc.department_id, null, 'QUEUE_TRANSFERRED');
    syncDoctorQueueRealtime(tgtId, targetDoc.department_id, null, 'QUEUE_TRANSFERRED');

    res.json({
      status: 'ok',
      message: `Successfully transferred ${transferredEntries.length} patient(s) to Dr. ${targetDoc.doctor_name}`,
      data: {
        transferredCount: transferredEntries.length,
        sourceDoctor: sourceDoc.doctor_name,
        targetDoctor: targetDoc.doctor_name,
        targetRoom: targetDoc.room_number || 'Room 101',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Queue transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/queue/doctor/:id/pause
 * Doctor or Admin pauses doctor queue.
 */
router.post('/doctor/:id/pause', authorize('DOCTOR', 'ADMIN'), async (req, res) => {
  try {
    const doctorId = parseInt(req.params.id, 10);
    const { reason } = req.body;

    // Doctor can only pause own queue
    if (req.user.role === 'DOCTOR') {
      const docRes = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
      if (docRes.rows.length === 0 || docRes.rows[0].id !== doctorId) {
        return res.status(403).json({ status: 'error', message: 'You can only pause your own queue' });
      }
    }

    const doctor = await pauseDoctorQueue(doctorId, reason || 'Doctor temporarily stepped out', req.user);

    await logQueueEvent(pool, {
      queueEntryId: doctorId, // doctor context
      eventType: QUEUE_EVENT_TYPES.QUEUE_PAUSED,
      actorType: req.user.role,
      actorId: req.user.id,
      details: { doctorId, reason: doctor.pause_reason },
    });

    syncDoctorQueueRealtime(doctorId, doctor.department_id, null, 'QUEUE_PAUSED');

    res.json({
      status: 'ok',
      message: `Queue paused for Dr. ${doctor.name || doctorId}`,
      data: doctor,
    });
  } catch (err) {
    console.error('Pause doctor queue error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
});

/**
 * POST /api/queue/doctor/:id/resume
 * Doctor or Admin resumes paused doctor queue.
 */
router.post('/doctor/:id/resume', authorize('DOCTOR', 'ADMIN'), async (req, res) => {
  try {
    const doctorId = parseInt(req.params.id, 10);

    // Doctor can only resume own queue
    if (req.user.role === 'DOCTOR') {
      const docRes = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
      if (docRes.rows.length === 0 || docRes.rows[0].id !== doctorId) {
        return res.status(403).json({ status: 'error', message: 'You can only resume your own queue' });
      }
    }

    const doctor = await resumeDoctorQueue(doctorId, req.user);

    await logQueueEvent(pool, {
      queueEntryId: doctorId,
      eventType: QUEUE_EVENT_TYPES.QUEUE_RESUMED,
      actorType: req.user.role,
      actorId: req.user.id,
      details: { doctorId },
    });

    syncDoctorQueueRealtime(doctorId, doctor.department_id, null, 'QUEUE_RESUMED');

    res.json({
      status: 'ok',
      message: `Queue resumed for Dr. ${doctor.name || doctorId}`,
      data: doctor,
    });
  } catch (err) {
    console.error('Resume doctor queue error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
});

/**
 * GET /api/queue/settings
 * Admin retrieves system settings (grace period, limits, capacity).
 */
router.get('/settings', authorize('ADMIN'), async (req, res) => {
  try {
    const settings = await getAllSettings();
    res.json({ status: 'ok', data: settings });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/queue/settings
 * Admin updates system settings with validation.
 */
router.put('/settings', authorize('ADMIN'), async (req, res) => {
  try {
    const updated = await updateSettings(req.body, req.user.id);
    res.json({ status: 'ok', message: 'System settings updated successfully', data: updated });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/queue/events
 * Admin & Receptionist view recent queue events / audit log.
 */
router.get('/events', authorize('ADMIN', 'RECEPTIONIST'), async (req, res) => {
  try {
    const { queue_entry_id, limit, offset } = req.query;
    const events = await getQueueEvents({
      queueEntryId: queue_entry_id ? parseInt(queue_entry_id, 10) : null,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ status: 'ok', data: events });
  } catch (err) {
    console.error('Get queue events error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Mount public patient actions directly onto router for completeness
router.post('/access/:accessToken/cancel', patientCancelQueue);
router.post('/access/:accessToken/rejoin', patientRejoinQueue);
router.get('/access/:accessToken/reschedule-options', getPatientRescheduleOptions);
router.post('/access/:accessToken/reschedule', patientRescheduleQueue);

export default router;

