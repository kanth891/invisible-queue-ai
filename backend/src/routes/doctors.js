import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/doctors
 * List all doctors with user and department info.
 */
router.get('/', async (req, res) => {
  try {
    const { department_id, status } = req.query;
    let query = `
      SELECT d.id, d.user_id, d.department_id, d.specialization, d.status, d.created_at,
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
      `SELECT d.id, d.user_id, d.department_id, d.specialization, d.status, d.created_at,
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

    res.json({ status: 'ok', data: result.rows[0] });
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
    const doctorResult = await client.query(
      'INSERT INTO doctors (user_id, department_id, specialization) VALUES ($1, $2, $3) RETURNING *',
      [userResult.rows[0].id, department_id, specialization?.trim() || null]
    );

    await client.query('COMMIT');

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
 * Update doctor. Admin only.
 */
router.put('/:id', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { name, department_id, specialization, status } = req.body;

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
        status = COALESCE($3, status)
       WHERE id = $4 RETURNING *`,
      [department_id || null, specialization?.trim() || null, status?.toUpperCase() || null, id]
    );

    await client.query('COMMIT');

    res.json({ status: 'ok', message: 'Doctor updated', data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update doctor error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
