import { Router } from 'express';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';

const router = Router();

// ── Valid state transitions ────────────────────────
const VALID_TRANSITIONS = {
  WAITING:          ['CALLED', 'CANCELLED', 'NO_SHOW'],
  CALLED:           ['IN_CONSULTATION', 'NO_SHOW'],
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

    const result = await client.query(
      `INSERT INTO queue_entries (patient_id, doctor_id, department_id, token_number, queue_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'WAITING') RETURNING *`,
      [patient_id, doctor_id, department_id, tokenNumber]
    );

    await client.query('COMMIT');

    res.status(201).json({
      status: 'ok',
      message: 'Token generated successfully',
      data: {
        ...result.rows[0],
        patient_name: patientCheck.rows[0].name,
        doctor_name: doctorCheck.rows[0].doctor_name,
        department_name: doctorCheck.rows[0].department_name,
      },
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

    res.json({ status: 'ok', data: result.rows });
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
        COUNT(*) FILTER (WHERE status = 'NO_SHOW') as no_show
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

    res.json({
      status: 'ok',
      message: `Patient status changed to ${targetStatus}`,
      data: fullResult.rows[0],
    });
  } catch (err) {
    console.error(`Queue ${targetStatus} error:`, err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

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

export default router;
