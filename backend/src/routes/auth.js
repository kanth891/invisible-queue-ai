import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required' });
    }

    // Find user by email
    const result = await pool.query(
      'SELECT id, name, email, password_hash, role, status FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ status: 'error', message: 'Account is deactivated. Contact administrator.' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    // Generate JWT
    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    // If user is a doctor, fetch doctor info
    let doctorInfo = null;
    if (user.role === 'DOCTOR') {
      const docResult = await pool.query(
        `SELECT d.id as doctor_id, d.department_id, d.specialization, dep.name as department_name
         FROM doctors d JOIN departments dep ON d.department_id = dep.id
         WHERE d.user_id = $1`,
        [user.id]
      );
      if (docResult.rows.length > 0) {
        doctorInfo = docResult.rows[0];
      }
    }

    res.json({
      status: 'ok',
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          ...(doctorInfo && { doctorInfo }),
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication).
 */
router.get('/me', authenticate, async (req, res) => {
  // This route requires auth middleware to be applied before
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, status, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const user = result.rows[0];

    let doctorInfo = null;
    if (user.role === 'DOCTOR') {
      const docResult = await pool.query(
        `SELECT d.id as doctor_id, d.department_id, d.specialization, dep.name as department_name
         FROM doctors d JOIN departments dep ON d.department_id = dep.id
         WHERE d.user_id = $1`,
        [user.id]
      );
      if (docResult.rows.length > 0) {
        doctorInfo = docResult.rows[0];
      }
    }

    res.json({
      status: 'ok',
      data: {
        ...user,
        ...(doctorInfo && { doctorInfo }),
      },
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
