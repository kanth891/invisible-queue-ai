import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import pool from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export const SOCKET_EVENTS = {
  QUEUE_UPDATED: 'queue.updated',
  TOKEN_CALLED: 'queue.token_called',
  CONSULTATION_STARTED: 'queue.consultation_started',
  CONSULTATION_COMPLETED: 'queue.consultation_completed',
  PATIENT_NO_SHOW: 'queue.patient_no_show',
  PATIENT_CANCELLED: 'queue.patient_cancelled',
  WAIT_TIME_UPDATED: 'queue.wait_time_updated',
  PATIENT_APPROACHING: 'queue.patient_approaching',
  PATIENT_TURN: 'queue.patient_turn',
  NOTIFICATION_CREATED: 'notification.created',
};

let io = null;

/**
 * Initialize Socket.IO with HTTP server and CORS policy.
 */
export function initSocket(httpServer, allowedOrigins = ['http://localhost:5173']) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          allowedOrigins.includes(origin) ||
          allowedOrigins.includes('*') ||
          origin.endsWith('.onrender.com') ||
          origin.endsWith('.vercel.app') ||
          origin.includes('localhost') ||
          origin.includes('127.0.0.1')
        ) {
          return callback(null, true);
        }
        return callback(new Error(`Socket CORS blocked origin: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Authentication middleware (non-blocking for patients, validates staff JWT)
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded;
      } catch (err) {
        // Invalid token; proceed as unauthenticated client (can still track patient pass if valid access token provided)
        socket.user = null;
      }
    } else {
      socket.user = null;
    }
    next();
  });

  io.on('connection', (socket) => {
    // ── 1. Patient Room Subscription (Protected by queue access token) ──
    socket.on('join:patient', async ({ accessToken }, ack) => {
      try {
        if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 8) {
          if (typeof ack === 'function') ack({ success: false, error: 'Invalid access token format' });
          return;
        }

        const cleanToken = accessToken.trim();

        // Validate that access token exists in DB (or memory)
        let tokenValid = false;
        if (pool && pool.query) {
          try {
            const check = await pool.query(
              'SELECT id FROM queue_entries WHERE queue_access_token = $1',
              [cleanToken]
            );
            tokenValid = check.rows.length > 0;
          } catch (dbErr) {
            console.warn('[Socket] DB check error for token:', dbErr.message);
            // In case DB is temporarily unreachable or testing in-memory fallback
            tokenValid = cleanToken.length >= 8;
          }
        } else {
          tokenValid = cleanToken.length >= 8;
        }

        if (!tokenValid) {
          if (typeof ack === 'function') ack({ success: false, error: 'Queue pass not found or expired' });
          return;
        }

        const room = `patient:${cleanToken}`;
        socket.join(room);
        if (typeof ack === 'function') ack({ success: true, room });
      } catch (err) {
        console.error('[Socket] join:patient error:', err);
        if (typeof ack === 'function') ack({ success: false, error: 'Failed to join patient room' });
      }
    });

    socket.on('leave:patient', ({ accessToken }) => {
      if (accessToken) socket.leave(`patient:${accessToken.trim()}`);
    });

    // ── 2. Doctor Room Subscription (Role-protected) ──
    socket.on('join:doctor', ({ doctorId }, ack) => {
      try {
        if (!socket.user) {
          if (typeof ack === 'function') ack({ success: false, error: 'Authentication required' });
          return;
        }

        const docId = Number(doctorId);
        const isAuthorized =
          socket.user.role === 'ADMIN' ||
          (socket.user.role === 'DOCTOR' && socket.user.doctorInfo?.doctor_id === docId);

        if (!isAuthorized) {
          if (typeof ack === 'function') ack({ success: false, error: 'Access denied to doctor room' });
          return;
        }

        const room = `doctor:${docId}`;
        socket.join(room);
        if (typeof ack === 'function') ack({ success: true, room });
      } catch (err) {
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    // ── 3. Department Room Subscription (Role-protected) ──
    socket.on('join:department', ({ departmentId }, ack) => {
      try {
        if (!socket.user) {
          if (typeof ack === 'function') ack({ success: false, error: 'Authentication required' });
          return;
        }

        const deptId = Number(departmentId);
        const isAuthorized =
          socket.user.role === 'ADMIN' ||
          socket.user.role === 'RECEPTIONIST' ||
          (socket.user.role === 'DOCTOR' && socket.user.doctorInfo?.department_id === deptId);

        if (!isAuthorized) {
          if (typeof ack === 'function') ack({ success: false, error: 'Access denied to department room' });
          return;
        }

        const room = `department:${deptId}`;
        socket.join(room);
        if (typeof ack === 'function') ack({ success: true, room });
      } catch (err) {
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    // ── 4. Admin Room Subscription (Admin-only) ──
    socket.on('join:admin', (data, ack) => {
      try {
        if (!socket.user || socket.user.role !== 'ADMIN') {
          if (typeof ack === 'function') ack({ success: false, error: 'Admin authorization required' });
          return;
        }

        socket.join('admin');
        if (typeof ack === 'function') ack({ success: true, room: 'admin' });
      } catch (err) {
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      // Cleaned up automatically by socket.io
    });
  });

  return io;
}

export function getIO() {
  return io;
}

/**
 * Emit event to a specific patient's secure room.
 */
export function emitToPatient(accessToken, event, data) {
  if (!io || !accessToken) return;
  io.to(`patient:${accessToken}`).emit(event, data);
}

/**
 * Emit event to a doctor's active queue room.
 */
export function emitToDoctor(doctorId, event, data) {
  if (!io || !doctorId) return;
  io.to(`doctor:${doctorId}`).emit(event, data);
}

/**
 * Emit event to a department room.
 */
export function emitToDepartment(departmentId, event, data) {
  if (!io || !departmentId) return;
  io.to(`department:${departmentId}`).emit(event, data);
}

/**
 * Emit event to admin room.
 */
export function emitToAdmin(event, data) {
  if (!io) return;
  io.to('admin').emit(event, data);
}

/**
 * Broadcast event across relevant rooms (Doctor, Department, Admin, and Patient).
 */
export function broadcastQueueUpdate({ departmentId, doctorId, patientAccessToken, event, data }) {
  if (!io) return;
  if (patientAccessToken) emitToPatient(patientAccessToken, event, data);
  if (doctorId) emitToDoctor(doctorId, event, data);
  if (departmentId) emitToDepartment(departmentId, event, data);
  emitToAdmin(event, data);
}
