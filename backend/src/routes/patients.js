import { Router } from 'express';
import pool from '../db/index.js';
import { authorize } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/patients
 * List patients. Receptionist + Admin.
 */
router.get('/', authorize('ADMIN', 'RECEPTIONIST'), async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM patients';
    const params = [];

    if (search) {
      query += ' WHERE name ILIKE $1 OR phone ILIKE $1';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT 100';
    const result = await pool.query(query, params);

    res.json({ status: 'ok', data: result.rows });
  } catch (err) {
    console.error('Get patients error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/patients/:id
 */
router.get('/:id', authorize('ADMIN', 'RECEPTIONIST', 'DOCTOR'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Patient not found' });
    }
    res.json({ status: 'ok', data: result.rows[0] });
  } catch (err) {
    console.error('Get patient error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/patients
 * Register a new patient. Receptionist + Admin.
 */
router.post('/', authorize('ADMIN', 'RECEPTIONIST'), async (req, res) => {
  try {
    const { name, age, gender, phone } = req.body;

    // Validation
    if (!name || !age || !gender || !phone) {
      return res.status(400).json({ status: 'error', message: 'Name, age, gender, and phone are required' });
    }

    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 1 || ageNum > 150) {
      return res.status(400).json({ status: 'error', message: 'Age must be between 1 and 150' });
    }

    const validGenders = ['MALE', 'FEMALE', 'OTHER'];
    if (!validGenders.includes(gender.toUpperCase())) {
      return res.status(400).json({ status: 'error', message: 'Gender must be MALE, FEMALE, or OTHER' });
    }

    if (phone.trim().length < 10) {
      return res.status(400).json({ status: 'error', message: 'Phone number must be at least 10 digits' });
    }

    const result = await pool.query(
      'INSERT INTO patients (name, age, gender, phone) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), ageNum, gender.toUpperCase(), phone.trim()]
    );

    res.status(201).json({ status: 'ok', message: 'Patient registered', data: result.rows[0] });
  } catch (err) {
    console.error('Create patient error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
