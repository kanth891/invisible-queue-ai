import pool from '../db/index.js';
import { getSetting } from './settingsService.js';
import { logQueueEvent, QUEUE_EVENT_TYPES } from './queueAuditService.js';
import { broadcastQueueUpdate, emitToDoctor, emitToDepartment, SOCKET_EVENTS } from '../socket/index.js';

/**
 * Format date to YYYY-MM-DD
 */
export function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Resolve availability for a single doctor on a given date and time.
 * Evaluates priority:
 * 1. Date-specific leave override (FULL_DAY or PARTIAL)
 * 2. Weekly recurring schedule
 * 3. Default hospital schedule
 */
export async function evaluateDoctorAvailability(doctor, targetDate = null, currentTimeStr = null) {
  const dateStr = targetDate || getTodayDateString();
  const dateObj = new Date(`${dateStr}T12:00:00Z`);
  const dayOfWeek = dateObj.getUTCDay(); // 0 = Sunday, 1 = Monday, ...

  // Time format: "HH:MM"
  let timeStr = currentTimeStr;
  if (!timeStr) {
    const now = new Date();
    timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // Check 0: Doctor account active/inactive
  if (doctor.status === 'INACTIVE') {
    return {
      status: 'INACTIVE',
      isAvailable: false,
      reason: 'Doctor account is inactive in the hospital system',
      schedule: null,
      leave: null,
    };
  }

  // Priority 1: Date-specific leave override
  try {
    const leaveRes = await pool.query(
      `SELECT * FROM doctor_leaves
       WHERE doctor_id = $1 AND leave_date = $2
       ORDER BY id DESC LIMIT 1`,
      [doctor.id, dateStr]
    );

    if (leaveRes.rows.length > 0) {
      const leave = leaveRes.rows[0];
      if (leave.leave_type === 'FULL_DAY') {
        return {
          status: 'ON_LEAVE',
          isAvailable: false,
          reason: leave.reason || 'Full day leave approved',
          schedule: null,
          leave: {
            id: leave.id,
            type: 'FULL_DAY',
            reason: leave.reason,
          },
        };
      } else if (leave.leave_type === 'PARTIAL') {
        const start = leave.start_time ? leave.start_time.substring(0, 5) : '00:00';
        const end = leave.end_time ? leave.end_time.substring(0, 5) : '23:59';
        const isCurrentlyDuringLeave = timeStr >= start && timeStr <= end;

        if (isCurrentlyDuringLeave) {
          return {
            status: 'ON_LEAVE',
            isAvailable: false,
            reason: leave.reason || `Partial leave (${start} - ${end})`,
            schedule: null,
            leave: {
              id: leave.id,
              type: 'PARTIAL',
              start_time: start,
              end_time: end,
              reason: leave.reason,
            },
          };
        }
      }
    }
  } catch (err) {
    console.warn('[DoctorAvailability] Error querying doctor_leaves:', err.message);
  }

  // Priority 1.5: Temporary pause
  if (doctor.operational_status === 'PAUSED') {
    return {
      status: 'PAUSED',
      isAvailable: false,
      reason: doctor.pause_reason || 'Queue temporarily paused',
      schedule: null,
      leave: null,
      paused_at: doctor.paused_at,
    };
  }

  // Priority 2: Weekly recurring schedule
  try {
    const schedRes = await pool.query(
      `SELECT * FROM doctor_schedules
       WHERE doctor_id = $1 AND day_of_week = $2`,
      [doctor.id, dayOfWeek]
    );

    if (schedRes.rows.length > 0) {
      const sched = schedRes.rows[0];
      if (!sched.is_active) {
        return {
          status: 'ON_LEAVE',
          isAvailable: false,
          reason: 'Scheduled day off',
          schedule: sched,
          leave: null,
        };
      }

      const start = sched.start_time ? sched.start_time.substring(0, 5) : '09:00';
      const end = sched.end_time ? sched.end_time.substring(0, 5) : '17:00';

      return {
        status: 'AVAILABLE',
        isAvailable: true,
        reason: 'On active clinical duty',
        schedule: {
          start_time: start,
          end_time: end,
        },
        leave: null,
      };
    }
  } catch (err) {
    console.warn('[DoctorAvailability] Error querying doctor_schedules:', err.message);
  }

  // Priority 3: Default hospital operating hours
  const defaultHours = await getSetting('operating_hours');
  return {
    status: 'AVAILABLE',
    isAvailable: true,
    reason: 'Standard clinical hours',
    schedule: defaultHours || { start: '08:00', end: '18:00' },
    leave: null,
  };
}

/**
 * Get comprehensive operational availability for all doctors today.
 */
export async function getAllDoctorsTodayAvailability() {
  const today = getTodayDateString();
  const defaultCapacity = await getSetting('default_queue_capacity');

  const docRes = await pool.query(`
    SELECT d.id, d.user_id, d.department_id, d.specialization, d.status,
           d.room_number, d.operational_status, d.pause_reason, d.paused_at, d.daily_capacity,
           u.name as doctor_name, u.email as doctor_email,
           dep.name as department_name, dep.code as department_code
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    JOIN departments dep ON d.department_id = dep.id
    ORDER BY dep.name ASC, u.name ASC
  `);

  // Fetch today's patient queue counts by doctor
  const countsRes = await pool.query(`
    SELECT doctor_id,
           COUNT(*) as total_today,
           COUNT(*) FILTER (WHERE status = 'WAITING') as waiting_count,
           COUNT(*) FILTER (WHERE status = 'CALLED') as called_count,
           COUNT(*) FILTER (WHERE status = 'IN_CONSULTATION') as consulting_count,
           COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_count,
           COUNT(*) FILTER (WHERE status = 'MISSED') as missed_count
    FROM queue_entries
    WHERE queue_date = $1
    GROUP BY doctor_id
  `, [today]);

  const countMap = {};
  for (const c of countsRes.rows) {
    countMap[c.doctor_id] = {
      total: parseInt(c.total_today || 0, 10),
      waiting: parseInt(c.waiting_count || 0, 10),
      called: parseInt(c.called_count || 0, 10),
      consulting: parseInt(c.consulting_count || 0, 10),
      completed: parseInt(c.completed_count || 0, 10),
      missed: parseInt(c.missed_count || 0, 10),
    };
  }

  const results = [];
  for (const doc of docRes.rows) {
    const evalResult = await evaluateDoctorAvailability(doc, today);
    const counts = countMap[doc.id] || { total: 0, waiting: 0, called: 0, consulting: 0, completed: 0, missed: 0 };
    const capacity = doc.daily_capacity || defaultCapacity || 30;
    const isAtCapacity = counts.total >= capacity;

    results.push({
      id: doc.id,
      userId: doc.user_id,
      name: doc.doctor_name,
      email: doc.doctor_email,
      departmentId: doc.department_id,
      departmentName: doc.department_name,
      departmentCode: doc.department_code,
      specialization: doc.specialization,
      roomNumber: doc.room_number || 'Room 101',
      accountStatus: doc.status,
      operationalStatus: evalResult.status,
      isAvailable: evalResult.isAvailable && !isAtCapacity,
      isAtCapacity,
      capacity,
      patientsTotalToday: counts.total,
      patientsWaiting: counts.waiting,
      patientsCalled: counts.called,
      patientsConsulting: counts.consulting,
      patientsCompleted: counts.completed,
      patientsMissed: counts.missed,
      pauseReason: doc.pause_reason,
      pausedAt: doc.paused_at,
      availabilityReason: evalResult.reason,
      schedule: evalResult.schedule,
      leave: evalResult.leave,
    });
  }

  return results;
}

/**
 * Pause a doctor's queue.
 */
export async function pauseDoctorQueue(doctorId, reason = 'Temporary pause', actor = { type: 'DOCTOR', id: null }) {
  const result = await pool.query(
    `UPDATE doctors
     SET operational_status = 'PAUSED',
         pause_reason = $1,
         paused_at = NOW()
     WHERE id = $2 RETURNING *`,
    [reason, doctorId]
  );

  if (result.rows.length === 0) throw new Error('Doctor not found');

  // Broadcast real-time pause event
  broadcastQueueUpdate({
    doctorId,
    departmentId: result.rows[0].department_id,
    event: SOCKET_EVENTS.QUEUE_PAUSED || 'queue.paused',
    data: {
      doctorId,
      reason,
      pausedAt: new Date().toISOString(),
    },
  });

  return result.rows[0];
}

/**
 * Resume a doctor's queue.
 */
export async function resumeDoctorQueue(doctorId, actor = { type: 'DOCTOR', id: null }) {
  const result = await pool.query(
    `UPDATE doctors
     SET operational_status = 'AVAILABLE',
         pause_reason = NULL,
         paused_at = NULL
     WHERE id = $1 RETURNING *`,
    [doctorId]
  );

  if (result.rows.length === 0) throw new Error('Doctor not found');

  // Broadcast real-time resume event
  broadcastQueueUpdate({
    doctorId,
    departmentId: result.rows[0].department_id,
    event: SOCKET_EVENTS.QUEUE_RESUMED || 'queue.resumed',
    data: {
      doctorId,
      resumedAt: new Date().toISOString(),
    },
  });

  return result.rows[0];
}
