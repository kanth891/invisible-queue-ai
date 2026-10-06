import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/users
 * List all users. Admin only.
 */
router.get('/', authorize('ADMIN'), async (req, res) => {
  try {
    const { role, status } = req.query;
    let query = 'SELECT id, name, email, role, status, created_at, updated_at FROM users';
    const conditions = [];
    const params = [];

    if (role) {
      params.push(role.toUpperCase());
      conditions.push(`role = $${params.length}`);
    }
    if (status) {
      params.push(status.toUpperCase());
      conditions.push(`status = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);

    res.json({ status: 'ok', data: result.rows });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/users
 * Create a user (receptionist). Admin only.
 * For doctors, use POST /api/doctors instead (creates user + doctor record).
 */
router.post('/', authorize('ADMIN'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ status: 'error', message: 'Name, email, password, and role are required' });
    }

    const allowedRoles = ['RECEPTIONIST', 'ADMIN'];
    if (!allowedRoles.includes(role.toUpperCase())) {
      return res.status(400).json({
        status: 'error',
        message: 'Use POST /api/doctors to create doctor accounts',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, status, created_at',
      [name.trim(), email.toLowerCase().trim(), passwordHash, role.toUpperCase()]
    );

    res.status(201).json({ status: 'ok', message: 'User created', data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ status: 'error', message: 'Email already exists' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/users/:id
 * Update user status. Admin only.
 */
router.put('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const existing = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        status = COALESCE($2, status)
       WHERE id = $3
       RETURNING id, name, email, role, status, created_at, updated_at`,
      [name?.trim() || null, status?.toUpperCase() || null, id]
    );

    res.json({ status: 'ok', message: 'User updated', data: result.rows[0] });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
