import { Router } from 'express';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/analytics/live-status
 * Real-time hospital departments queue overview for Admin Dashboard.
 */
router.get('/live-status', authorize('ADMIN'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get all active departments
    const deptRes = await pool.query(`
      SELECT id, name, code, status
      FROM departments
      WHERE status = 'ACTIVE'
      ORDER BY name ASC
    `);

    // Get today's queue entries with status
    const entriesRes = await pool.query(`
      SELECT qe.id, qe.department_id, qe.doctor_id, qe.token_number, qe.status, qe.created_at
      FROM queue_entries qe
      WHERE qe.queue_date = $1
      ORDER BY qe.created_at ASC
    `, [today]);

    const entries = entriesRes.rows;

    const liveDepartments = deptRes.rows.map(dept => {
      const deptEntries = entries.filter(e => e.department_id === dept.id);
      const waiting = deptEntries.filter(e => e.status === 'WAITING').length;
      const called = deptEntries.filter(e => e.status === 'CALLED').length;
      const consulting = deptEntries.filter(e => e.status === 'IN_CONSULTATION').length;
      const completed = deptEntries.filter(e => e.status === 'COMPLETED').length;

      // Currently serving token (IN_CONSULTATION takes precedence, then CALLED)
      const serving = deptEntries.find(e => e.status === 'IN_CONSULTATION') ||
                      deptEntries.find(e => e.status === 'CALLED') || null;

      const activeDoctors = new Set(
        deptEntries
          .filter(e => ['WAITING', 'CALLED', 'IN_CONSULTATION'].includes(e.status))
          .map(e => e.doctor_id)
      ).size;

      return {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        status: (waiting + called + consulting > 0) ? 'Active' : 'Idle',
        currentlyServing: serving ? serving.token_number : '—',
        waitingCount: waiting,
        consultingCount: consulting,
        completedCount: completed,
        activeDoctorsCount: activeDoctors,
      };
    });

    res.json({
      status: 'ok',
      data: liveDepartments,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Analytics live-status error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/analytics/overview
 * Real hospital analytics calculated from actual database records (no fake/hardcoded numbers).
 */
router.get('/overview', authorize('ADMIN'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Core volume and status metrics
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) as total_patients_today,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as patients_served_today,
        COUNT(*) FILTER (WHERE status = 'WAITING') as current_waiting_patients,
        COUNT(*) FILTER (WHERE status = 'IN_CONSULTATION') as current_in_consultation,
        COUNT(*) FILTER (WHERE status = 'MISSED') as missed_today,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW') as no_shows_today,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancellations_today,
        COUNT(*) FILTER (WHERE rejoin_count > 0) as rejoined_today,
        COUNT(*) FILTER (WHERE reschedule_count > 0) as rescheduled_today,
        COUNT(*) FILTER (WHERE transferred_from_doctor_id IS NOT NULL) as transferred_today,
        
        -- Actual waiting time: from created_at to consultation_started_at
        ROUND(AVG(
          CASE 
            WHEN actual_wait_minutes IS NOT NULL THEN actual_wait_minutes
            WHEN consultation_started_at IS NOT NULL AND created_at IS NOT NULL 
              THEN EXTRACT(EPOCH FROM (consultation_started_at - created_at)) / 60
            ELSE NULL
          END
        )::numeric, 1) as avg_waiting_time_minutes,

        -- Consultation duration: from started_at to completed_at
        ROUND(AVG(
          CASE
            WHEN consultation_duration_minutes IS NOT NULL THEN consultation_duration_minutes
            WHEN consultation_completed_at IS NOT NULL AND consultation_started_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (consultation_completed_at - consultation_started_at)) / 60
            ELSE NULL
          END
        )::numeric, 1) as avg_consultation_duration_minutes,

        -- Prediction error metrics
        ROUND(AVG(ABS(prediction_error_minutes))::numeric, 1) as avg_prediction_error_minutes
      FROM queue_entries
      WHERE queue_date = $1
    `, [today]);

    const s = statsRes.rows[0];

    // 2. ML Prediction table metrics (MAE, RMSE, evaluated count)
    const predStatsRes = await pool.query(`
      SELECT
        COUNT(*) as total_logged,
        COUNT(*) FILTER (WHERE actual_wait_minutes IS NOT NULL) as evaluated_count,
        ROUND(AVG(ABS(prediction_error))::numeric, 2) as mae,
        ROUND(SQRT(AVG(prediction_error * prediction_error))::numeric, 2) as rmse
      FROM predictions
      WHERE DATE(created_at) = $1
    `, [today]);

    const p = predStatsRes.rows[0];
    const evaluatedCount = parseInt(p.evaluated_count || 0, 10);
    const hasEnoughMLData = evaluatedCount >= 3;

    // 3. Hourly queue arrival volume
    const hourlyRes = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM created_at)::int as hour,
        COUNT(*) as volume
      FROM queue_entries
      WHERE queue_date = $1
      GROUP BY hour
      ORDER BY hour ASC
    `, [today]);

    // 4. Department Performance Breakdown
    const deptPerfRes = await pool.query(`
      SELECT
        dep.id,
        dep.name,
        dep.code,
        COUNT(qe.id) as total_registered,
        COUNT(qe.id) FILTER (WHERE qe.status = 'COMPLETED') as served,
        COUNT(qe.id) FILTER (WHERE qe.status = 'WAITING') as waiting,
        ROUND(AVG(
          CASE
            WHEN qe.actual_wait_minutes IS NOT NULL THEN qe.actual_wait_minutes
            WHEN qe.consultation_started_at IS NOT NULL 
              THEN EXTRACT(EPOCH FROM (qe.consultation_started_at - qe.created_at)) / 60
            ELSE NULL
          END
        )::numeric, 1) as avg_wait_minutes
      FROM departments dep
      LEFT JOIN queue_entries qe ON dep.id = qe.department_id AND qe.queue_date = $1
      WHERE dep.status = 'ACTIVE'
      GROUP BY dep.id, dep.name, dep.code
      ORDER BY total_registered DESC
    `, [today]);

    // 5. Doctor Consultation Duration Breakdown
    const doctorPerfRes = await pool.query(`
      SELECT
        d.id as doctor_id,
        u.name as doctor_name,
        dep.name as department_name,
        COUNT(qe.id) FILTER (WHERE qe.status = 'COMPLETED') as completed_count,
        ROUND(AVG(
          CASE
            WHEN qe.consultation_duration_minutes IS NOT NULL THEN qe.consultation_duration_minutes
            WHEN qe.consultation_completed_at IS NOT NULL AND qe.consultation_started_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (qe.consultation_completed_at - qe.consultation_started_at)) / 60
            ELSE NULL
          END
        )::numeric, 1) as avg_duration_minutes
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      JOIN departments dep ON d.department_id = dep.id
      LEFT JOIN queue_entries qe ON d.id = qe.doctor_id AND qe.queue_date = $1
      WHERE d.status = 'ACTIVE'
      GROUP BY d.id, u.name, dep.name
      ORDER BY completed_count DESC
    `, [today]);

    // 6. Recent Predicted vs Actual Waiting Time (last 10 evaluated entries)
    const predVsActualRes = await pool.query(`
      SELECT
        p.id,
        p.token_number,
        p.patients_ahead,
        p.predicted_wait_minutes,
        p.actual_wait_minutes,
        ROUND(ABS(p.prediction_error)::numeric, 1) as error_minutes,
        p.is_fallback,
        p.created_at
      FROM predictions p
      WHERE p.actual_wait_minutes IS NOT NULL
      ORDER BY p.created_at DESC
      LIMIT 10
    `);

    res.json({
      status: 'ok',
      data: {
        summary: {
          patientsServedToday: parseInt(s.patients_served_today || 0, 10),
          currentWaitingPatients: parseInt(s.current_waiting_patients || 0, 10),
          currentInConsultation: parseInt(s.current_in_consultation || 0, 10),
          missedToday: parseInt(s.missed_today || 0, 10),
          noShowsToday: parseInt(s.no_shows_today || 0, 10),
          cancellationsToday: parseInt(s.cancellations_today || 0, 10),
          rejoinedToday: parseInt(s.rejoined_today || 0, 10),
          rescheduledToday: parseInt(s.rescheduled_today || 0, 10),
          transferredToday: parseInt(s.transferred_today || 0, 10),
          totalPatientsToday: parseInt(s.total_patients_today || 0, 10),
          avgWaitingTimeMinutes: s.avg_waiting_time_minutes ? parseFloat(s.avg_waiting_time_minutes) : null,
          avgConsultationDurationMinutes: s.avg_consultation_duration_minutes ? parseFloat(s.avg_consultation_duration_minutes) : null,
          avgPredictionErrorMinutes: s.avg_prediction_error_minutes ? parseFloat(s.avg_prediction_error_minutes) : null,
        },
        mlAccuracy: {
          hasEnoughData: hasEnoughMLData,
          evaluatedCount,
          mae: p.mae !== null ? parseFloat(p.mae) : null,
          rmse: p.rmse !== null ? parseFloat(p.rmse) : null,
          note: hasEnoughMLData
            ? 'Evaluated against completed consultation telemetry'
            : 'Collecting more consultation telemetry (minimum 3 completed required)',
        },
        hourlyVolume: hourlyRes.rows.map(r => ({
          hour: `${String(r.hour).padStart(2, '0')}:00`,
          volume: parseInt(r.volume, 10),
        })),
        departmentPerformance: deptPerfRes.rows.map(r => ({
          departmentId: r.id,
          name: r.name,
          code: r.code,
          totalRegistered: parseInt(r.total_registered, 10),
          served: parseInt(r.served, 10),
          waiting: parseInt(r.waiting, 10),
          avgWaitMinutes: r.avg_wait_minutes ? parseFloat(r.avg_wait_minutes) : null,
        })),
        doctorPerformance: doctorPerfRes.rows.map(r => ({
          doctorId: r.doctor_id,
          doctorName: r.doctor_name,
          departmentName: r.department_name,
          completedCount: parseInt(r.completed_count, 10),
          avgDurationMinutes: r.avg_duration_minutes ? parseFloat(r.avg_duration_minutes) : null,
        })),
        predictedVsActual: predVsActualRes.rows,
      },
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
