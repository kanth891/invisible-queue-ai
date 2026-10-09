import { Router } from 'express';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/departments
 * List all departments. Available to all authenticated users.
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM departments';
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status.toUpperCase());
    }

    query += ' ORDER BY name ASC';
    const result = await pool.query(query, params);

    res.json({ status: 'ok', data: result.rows });
  } catch (err) {
    console.error('Get departments error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/departments/:id
 * Get single department.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM departments WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Department not found' });
    }

    res.json({ status: 'ok', data: result.rows[0] });
  } catch (err) {
    console.error('Get department error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/departments
 * Create a new department. Admin only.
 */
router.post('/', authorize('ADMIN'), async (req, res) => {
  try {
    const { name, code, description } = req.body;

    if (!name || !code) {
      return res.status(400).json({ status: 'error', message: 'Name and code are required' });
    }

    if (typeof name !== 'string' || typeof code !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Name and code must be strings' });
    }

    if (code.length > 10) {
      return res.status(400).json({ status: 'error', message: 'Code must be 10 characters or less' });
    }

    const result = await pool.query(
      'INSERT INTO departments (name, code, description) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), code.toUpperCase().trim(), description?.trim() || null]
    );

    res.status(201).json({ status: 'ok', message: 'Department created', data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ status: 'error', message: 'Department name or code already exists' });
    }
    console.error('Create department error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/departments/:id
 * Update department. Admin only.
 */
router.put('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, status } = req.body;

    const existing = await pool.query('SELECT * FROM departments WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Department not found' });
    }

    const result = await pool.query(
      `UPDATE departments SET
        name = COALESCE($1, name),
        code = COALESCE($2, code),
        description = COALESCE($3, description),
        status = COALESCE($4, status)
       WHERE id = $5 RETURNING *`,
      [
        name?.trim() || null,
        code?.toUpperCase().trim() || null,
        description?.trim() || null,
        status?.toUpperCase() || null,
        id,
      ]
    );

    res.json({ status: 'ok', message: 'Department updated', data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ status: 'error', message: 'Department name or code already exists' });
    }
    console.error('Update department error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
