import { Router } from 'express';
import crypto from 'crypto';
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
 * GET /api/queue/access/:accessToken
 * Public endpoint: Returns real-time queue position for a patient using their secure unguessable access token.
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
              u.name as doctor_name, dep.name as department_name
       FROM queue_entries qe
       JOIN doctors d ON qe.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       JOIN departments dep ON qe.department_id = dep.id
       WHERE qe.queue_access_token = $1`,
      [accessToken.trim()]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Queue entry not found or invalid access token',
      });
    }

    const entry = entryResult.rows[0];

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
      // 1-indexed position in active queue
      position = patientIndex + 1;
      patientsAhead = patientIndex;
    } else {
      // Patient is not in active queue (COMPLETED, CANCELLED, or NO_SHOW)
      position = null;
      patientsAhead = 0;
    }

    // Configurable approaching threshold (default 2)
    const approachingThreshold = parseInt(process.env.APPROACHING_THRESHOLD || '2', 10);
    const isApproaching = entry.status === 'WAITING' && patientsAhead <= approachingThreshold;

    res.json({
      status: 'ok',
      data: {
        token: entry.token_number,
        doctor: entry.doctor_name,
        department: entry.department_name,
        status: entry.status,
        currentToken,
        position,
        patientsAhead,
        isApproaching,
        approachingThreshold,
        queueDate: entry.queue_date,
      },
    });
  } catch (err) {
    console.error('Patient queue access error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
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

    await client.query('COMMIT');

    res.status(201).json({
      status: 'ok',
      message: 'Token generated successfully',
      data: {
        ...result.rows[0],
        patient_name: patientCheck.rows[0].name,
        doctor_name: doctorCheck.rows[0].doctor_name,
        department_name: doctorCheck.rows[0].department_name,
        queue_access_token: queueAccessToken,
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
// Public route on queue router as well
router.get('/access/:accessToken', getPatientQueueAccess);

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
