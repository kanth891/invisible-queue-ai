import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import {
  getAllDoctorsTodayAvailability,
  evaluateDoctorAvailability,
  pauseDoctorQueue,
  resumeDoctorQueue,
} from '../services/doctorAvailabilityService.js';
import { broadcastQueueUpdate, SOCKET_EVENTS } from '../socket/index.js';

const router = Router();

/**
 * GET /api/doctors/availability/today
 * Comprehensive doctor availability with date overrides, schedules, queue counts, and capacity.
 */
router.get('/availability/today', async (req, res) => {
  try {
    const list = await getAllDoctorsTodayAvailability();
    res.json({ status: 'ok', data: list });
  } catch (err) {
    console.error('Get doctor availability error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/doctors
 * List all doctors with user, department, room, and capacity info.
 */
router.get('/', async (req, res) => {
  try {
    const { department_id, status } = req.query;
    let query = `
      SELECT d.id, d.user_id, d.department_id, d.specialization, d.status,
             d.room_number, d.operational_status, d.pause_reason, d.paused_at, d.daily_capacity, d.created_at,
             u.name, u.email,
             dep.name as department_name, dep.code as department_code
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      JOIN departments dep ON d.department_id = dep.id
    `;
    const conditions = [];
    const params = [];

    if (department_id) {
      params.push(department_id);
      conditions.push(`d.department_id = $${params.length}`);
    }
    if (status) {
      params.push(status.toUpperCase());
      conditions.push(`d.status = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY u.name ASC';
    const result = await pool.query(query, params);

    res.json({ status: 'ok', data: result.rows });
  } catch (err) {
    console.error('Get doctors error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/doctors/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.user_id, d.department_id, d.specialization, d.status,
              d.room_number, d.operational_status, d.pause_reason, d.paused_at, d.daily_capacity, d.created_at,
              u.name, u.email,
              dep.name as department_name, dep.code as department_code
       FROM doctors d
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON d.department_id = dep.id
       WHERE d.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Doctor not found' });
    }

    const doc = result.rows[0];
    const availability = await evaluateDoctorAvailability(doc);

    res.json({ status: 'ok', data: { ...doc, availability } });
  } catch (err) {
    console.error('Get doctor error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/doctors
 * Create a new doctor (creates user account + doctor record). Admin only.
 */
router.post('/', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, password, department_id, specialization } = req.body;

    if (!name || !email || !password || !department_id) {
      return res.status(400).json({ status: 'error', message: 'Name, email, password, and department are required' });
    }

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Name, email, and password must be strings' });
    }

    if (password.length < 6) {
      return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
    }

    // Check department exists
    const deptCheck = await client.query('SELECT id FROM departments WHERE id = $1 AND status = $2', [department_id, 'ACTIVE']);
    if (deptCheck.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Department not found or inactive' });
    }

    await client.query('BEGIN');

    // Create user account
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name.trim(), email.toLowerCase().trim(), passwordHash, 'DOCTOR']
    );

    // Create doctor record
    const { room_number, daily_capacity } = req.body;
    const doctorResult = await client.query(
      `INSERT INTO doctors (user_id, department_id, specialization, room_number, daily_capacity, status, operational_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        userResult.rows[0].id,
        department_id,
        specialization?.trim() || null,
        room_number ? String(room_number).trim() : null,
        daily_capacity ? parseInt(daily_capacity, 10) : 30,
        'ACTIVE',
        'AVAILABLE',
      ]
    );

    await client.query('COMMIT');

    broadcastQueueUpdate(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, {
      doctorId: doctorResult.rows[0].id,
      action: 'CREATED',
    });

    res.status(201).json({
      status: 'ok',
      message: 'Doctor created',
      data: {
        ...doctorResult.rows[0],
        name: userResult.rows[0].name,
        email: userResult.rows[0].email,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ status: 'error', message: 'Email already exists' });
    }
    console.error('Create doctor error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/doctors/:id
 * Update doctor details, room, and capacity. Admin only.
 */
router.put('/:id', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { name, department_id, specialization, status, room_number, daily_capacity } = req.body;

    const existing = await client.query(
      'SELECT d.*, u.name as user_name FROM doctors d JOIN users u ON d.user_id = u.id WHERE d.id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Doctor not found' });
    }

    await client.query('BEGIN');

    // Update user name if provided
    if (name) {
      await client.query('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), existing.rows[0].user_id]);
    }

    // Update doctor record
    const result = await client.query(
      `UPDATE doctors SET
        department_id = COALESCE($1, department_id),
        specialization = COALESCE($2, specialization),
        status = COALESCE($3, status),
        room_number = COALESCE($4, room_number),
        daily_capacity = COALESCE($5, daily_capacity)
       WHERE id = $6 RETURNING *`,
      [
        department_id || null,
        specialization !== undefined ? (specialization ? specialization.trim() : null) : null,
        status ? status.toUpperCase() : null,
        room_number !== undefined ? (room_number ? String(room_number).trim() : null) : null,
        daily_capacity !== undefined ? parseInt(daily_capacity, 10) : null,
        id,
      ]
    );

    await client.query('COMMIT');

    broadcastQueueUpdate(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, {
      doctorId: id,
      action: 'UPDATED',
      status: result.rows[0].status,
    });

    res.json({ status: 'ok', message: 'Doctor updated', data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update doctor error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/doctors/:id/status
 * Activate or deactivate doctor. Admin only.
 */
router.patch('/:id/status', authorize('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const targetStatus = String(status || '').toUpperCase();

    if (!['ACTIVE', 'INACTIVE'].includes(targetStatus)) {
      return res.status(400).json({ status: 'error', message: 'Status must be ACTIVE or INACTIVE' });
    }

    // Check doctor exists
    const docCheck = await pool.query('SELECT * FROM doctors WHERE id = $1', [id]);
    if (docCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Doctor not found' });
    }

    // Check active queue if deactivating
    let activePatientsCount = 0;
    if (targetStatus === 'INACTIVE') {
      const activeQ = await pool.query(
        "SELECT COUNT(*) as count FROM queue_entries WHERE doctor_id = $1 AND status IN ('WAITING', 'CALLED')",
        [id]
      );
      activePatientsCount = parseInt(activeQ.rows[0].count, 10);
    }

    const updated = await pool.query(
      'UPDATE doctors SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [targetStatus, id]
    );

    broadcastQueueUpdate(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, {
      doctorId: id,
      status: targetStatus,
      activePatientsCount,
    });

    res.json({
      status: 'ok',
      message: `Doctor status updated to ${targetStatus}`,
      data: updated.rows[0],
      activePatientsCount,
    });
  } catch (err) {
    console.error('Update doctor status error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/doctors/:id/schedule
 * Get recurring weekly schedule for doctor.
 */
router.get('/:id/schedule', async (req, res) => {
  try {
    const { id } = req.params;
    const schedules = await pool.query(
      'SELECT * FROM doctor_schedules WHERE doctor_id = $1 ORDER BY day_of_week ASC',
      [id]
    );
    res.json({ status: 'ok', data: schedules.rows });
  } catch (err) {
    console.error('Get doctor schedule error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/doctors/:id/schedule
 * Upsert doctor recurring weekly schedule. Admin only.
 * Body: { schedule: [ { day_of_week: 0..6, is_working: true/false, start_time: "09:00", end_time: "17:00" }, ... ] }
 */
router.put('/:id/schedule', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { schedule } = req.body;

    if (!Array.isArray(schedule)) {
      return res.status(400).json({ status: 'error', message: 'Schedule array is required' });
    }

    await client.query('BEGIN');

    for (const item of schedule) {
      const day = parseInt(item.day_of_week, 10);
      if (isNaN(day) || day < 0 || day > 6) continue;

      const isWorking = item.is_working !== false;
      const startTime = item.start_time || '09:00';
      const endTime = item.end_time || '17:00';

      await client.query(
        `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, is_working, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (doctor_id, day_of_week)
         DO UPDATE SET
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           is_working = EXCLUDED.is_working,
           updated_at = NOW()`,
        [id, day, startTime, endTime, isWorking]
      );
    }

    await client.query('COMMIT');

    broadcastQueueUpdate(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, {
      doctorId: id,
      action: 'SCHEDULE_UPDATED',
    });

    const updated = await pool.query(
      'SELECT * FROM doctor_schedules WHERE doctor_id = $1 ORDER BY day_of_week ASC',
      [id]
    );

    res.json({ status: 'ok', message: 'Schedule updated successfully', data: updated.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update doctor schedule error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/doctors/:id/leaves
 * List leaves for a doctor.
 */
router.get('/:id/leaves', async (req, res) => {
  try {
    const { id } = req.params;
    const leaves = await pool.query(
      'SELECT * FROM doctor_leaves WHERE doctor_id = $1 ORDER BY leave_date DESC',
      [id]
    );
    res.json({ status: 'ok', data: leaves.rows });
  } catch (err) {
    console.error('Get doctor leaves error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/doctors/:id/leave
 * Add full-day or partial-day leave. Admin only.
 */
router.post('/:id/leave', authorize('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { leave_date, is_full_day, start_time, end_time, reason } = req.body;

    if (!leave_date) {
      return res.status(400).json({ status: 'error', message: 'leave_date (YYYY-MM-DD) is required' });
    }

    const fullDay = is_full_day !== false;
    const sTime = fullDay ? null : (start_time || '09:00');
    const eTime = fullDay ? null : (end_time || '17:00');

    const result = await pool.query(
      `INSERT INTO doctor_leaves (doctor_id, leave_date, is_full_day, start_time, end_time, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, leave_date, fullDay, sTime, eTime, reason?.trim() || null, req.user?.id || null]
    );

    // Check if there are active queue entries affected today
    const todayStr = new Date().toISOString().split('T')[0];
    let affectedQueueCount = 0;
    if (leave_date === todayStr) {
      const q = await pool.query(
        "SELECT COUNT(*) as count FROM queue_entries WHERE doctor_id = $1 AND status IN ('WAITING', 'CALLED')",
        [id]
      );
      affectedQueueCount = parseInt(q.rows[0].count, 10);
    }

    broadcastQueueUpdate(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, {
      doctorId: id,
      action: 'LEAVE_ADDED',
      leave: result.rows[0],
      affectedQueueCount,
    });

    res.status(201).json({
      status: 'ok',
      message: 'Doctor leave recorded',
      data: result.rows[0],
      affectedQueueCount,
    });
  } catch (err) {
    console.error('Add doctor leave error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * DELETE /api/doctors/:id/leave/:leaveId
 * Cancel/remove a doctor leave. Admin only.
 */
router.delete('/:id/leave/:leaveId', authorize('ADMIN'), async (req, res) => {
  try {
    const { id, leaveId } = req.params;

    const del = await pool.query(
      'DELETE FROM doctor_leaves WHERE id = $1 AND doctor_id = $2 RETURNING *',
      [leaveId, id]
    );

    if (del.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Leave record not found' });
    }

    broadcastQueueUpdate(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, {
      doctorId: id,
      action: 'LEAVE_REMOVED',
      leaveId,
    });

    res.json({ status: 'ok', message: 'Leave removed successfully' });
  } catch (err) {
    console.error('Delete doctor leave error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/doctors/:id/pause
 * Pause doctor queue with optional reason. Doctor (own) or Admin.
 */
router.post('/:id/pause', authorize('ADMIN', 'DOCTOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (req.user.role === 'DOCTOR') {
      const myDoc = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
      if (myDoc.rows.length === 0 || myDoc.rows[0].id !== id) {
        return res.status(403).json({ status: 'error', message: 'Unauthorized to pause another doctor queue' });
      }
    }

    const doctor = await pauseDoctorQueue(id, reason || 'Break / In-between duties', req.user.id);
    res.json({ status: 'ok', message: 'Queue paused', data: doctor });
  } catch (err) {
    console.error('Pause doctor queue error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
});

/**
 * POST /api/doctors/:id/resume
 * Resume doctor queue. Doctor (own) or Admin.
 */
router.post('/:id/resume', authorize('ADMIN', 'DOCTOR'), async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === 'DOCTOR') {
      const myDoc = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
      if (myDoc.rows.length === 0 || myDoc.rows[0].id !== id) {
        return res.status(403).json({ status: 'error', message: 'Unauthorized to resume another doctor queue' });
      }
    }

    const doctor = await resumeDoctorQueue(id, req.user.id);
    res.json({ status: 'ok', message: 'Queue resumed', data: doctor });
  } catch (err) {
    console.error('Resume doctor queue error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
});

export default router;
