import http from 'http';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'e2e_test_secret_key_12345';
const APPROACHING_THRESHOLD = 2;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// In-Memory Database for E2E Testing
const hash = (pw) => bcrypt.hashSync(pw, 10);

const db = {
  users: [
    { id: 1, name: 'Admin User', email: 'admin@hospital.com', password_hash: hash('admin123'), role: 'ADMIN', status: 'ACTIVE' },
    { id: 2, name: 'Receptionist One', email: 'receptionist1@hospital.com', password_hash: hash('recep123'), role: 'RECEPTIONIST', status: 'ACTIVE' },
    { id: 3, name: 'Dr. Ravi Kumar', email: 'dr.ravi@hospital.com', password_hash: hash('doctor123'), role: 'DOCTOR', status: 'ACTIVE' },
    { id: 4, name: 'Dr. Meera Nambiar', email: 'dr.meera@hospital.com', password_hash: hash('doctor123'), role: 'DOCTOR', status: 'ACTIVE' },
  ],
  departments: [
    { id: 1, name: 'General Medicine', code: 'GM', description: 'General medical consultations', status: 'ACTIVE' },
    { id: 2, name: 'Cardiology', code: 'CAR', description: 'Heart and cardiovascular care', status: 'ACTIVE' },
    { id: 3, name: 'Pediatrics', code: 'PED', description: 'Child healthcare', status: 'ACTIVE' },
    { id: 4, name: 'Oncology', code: 'ONC', description: 'Comprehensive cancer care and consultation', status: 'ACTIVE' },
    { id: 5, name: 'Dermatology', code: 'DERM', description: 'Skin, hair, and dermatological reviews', status: 'ACTIVE' },
  ],
  doctors: [
    { id: 1, user_id: 3, department_id: 1, name: 'Dr. Ravi Kumar', specialization: 'General Physician', room_number: 'Room 101', operational_status: 'AVAILABLE', daily_capacity: 30, pause_reason: null, paused_at: null, status: 'ACTIVE' },
    { id: 2, user_id: 4, department_id: 4, name: 'Dr. Meera Nambiar', specialization: 'Medical Oncologist', room_number: 'Room 205', operational_status: 'AVAILABLE', daily_capacity: 30, pause_reason: null, paused_at: null, status: 'ACTIVE' },
    { id: 3, user_id: 1, department_id: 1, name: 'Dr. Priya Sharma', specialization: 'General Physician', room_number: 'Room 102', operational_status: 'AVAILABLE', daily_capacity: 30, pause_reason: null, paused_at: null, status: 'ACTIVE' },
  ],
  patients: [
    { id: 1, name: 'Rahul Verma', age: 28, gender: 'MALE', phone: '9876543210' },
    { id: 2, name: 'Anil Singh', age: 45, gender: 'MALE', phone: '9876543211' },
    { id: 3, name: 'Priya Patel', age: 32, gender: 'FEMALE', phone: '9876543212' },
  ],
  queue_entries: [
    {
      id: 1,
      patient_id: 1,
      doctor_id: 1,
      department_id: 1,
      token_number: 'GM-001',
      queue_access_token: 'demo_access_token_gm001',
      queue_date: new Date().toISOString().split('T')[0],
      status: 'IN_CONSULTATION',
      created_at: new Date(Date.now() - 3600000),
      called_at: new Date(Date.now() - 1800000),
      consultation_started_at: new Date(Date.now() - 1200000),
      consultation_completed_at: null,
      actual_wait_minutes: 40.0,
      consultation_duration_minutes: null,
      prediction_error_minutes: null,
      approaching_notified_at: new Date(),
      turn_notified_at: new Date(),
      missed_at: null,
      rejoin_count: 0,
      reschedule_count: 0,
      transferred_from_doctor_id: null,
      transferred_at: null,
    },
    {
      id: 2,
      patient_id: 2,
      doctor_id: 1,
      department_id: 1,
      token_number: 'GM-002',
      queue_access_token: 'demo_access_token_gm002',
      queue_date: new Date().toISOString().split('T')[0],
      status: 'WAITING',
      created_at: new Date(Date.now() - 2400000),
      called_at: null,
      consultation_started_at: null,
      consultation_completed_at: null,
      actual_wait_minutes: null,
      consultation_duration_minutes: null,
      prediction_error_minutes: null,
      approaching_notified_at: null,
      turn_notified_at: null,
      missed_at: null,
      rejoin_count: 0,
      reschedule_count: 0,
      transferred_from_doctor_id: null,
      transferred_at: null,
    }
  ],
  predictions: [],
  system_settings: {
    missed_token_grace_period_minutes: 5,
    max_rejoin_attempts: 2,
    max_reschedule_attempts: 2,
    daily_queue_capacity: 30,
    hospital_operating_hours: { open: '08:00', close: '18:00' },
  },
  doctor_schedules: [],
  doctor_leaves: [],
  queue_events: []
};

// ── State Machine Transition Constraints ──────────
const VALID_TRANSITIONS = {
  WAITING:          ['CALLED', 'CANCELLED', 'NO_SHOW'],
  CALLED:           ['IN_CONSULTATION', 'NO_SHOW', 'MISSED'],
  IN_CONSULTATION:  ['COMPLETED'],
  MISSED:           ['WAITING', 'CANCELLED', 'NO_SHOW'],
  COMPLETED:        [],
  CANCELLED:        [],
  NO_SHOW:          [],
};

// ── Socket.IO Server Setup ────────────────────────
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (token) {
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      socket.user = null;
    }
  } else {
    socket.user = null;
  }
  next();
});

io.on('connection', (socket) => {
  socket.on('join:patient', ({ accessToken }, ack) => {
    if (!accessToken || accessToken.trim().length < 8) {
      if (typeof ack === 'function') ack({ success: false, error: 'Invalid token' });
      return;
    }
    const token = accessToken.trim();
    const entry = db.queue_entries.find(q => q.queue_access_token === token);
    if (!entry) {
      if (typeof ack === 'function') ack({ success: false, error: 'Queue pass not found' });
      return;
    }
    const room = `patient:${token}`;
    socket.join(room);
    if (typeof ack === 'function') ack({ success: true, room });
  });

  socket.on('join:doctor', ({ doctorId }, ack) => {
    if (!socket.user) return ack && ack({ success: false, error: 'Unauthorized' });
    const docId = Number(doctorId);
    const room = `doctor:${docId}`;
    socket.join(room);
    if (typeof ack === 'function') ack({ success: true, room });
  });

  socket.on('join:department', ({ departmentId }, ack) => {
    if (!socket.user) return ack && ack({ success: false, error: 'Unauthorized' });
    const deptId = Number(departmentId);
    const room = `department:${deptId}`;
    socket.join(room);
    if (typeof ack === 'function') ack({ success: true, room });
  });

  socket.on('join:admin', (data, ack) => {
    if (!socket.user || socket.user.role !== 'ADMIN') {
      return ack && ack({ success: false, error: 'Admin only' });
    }
    socket.join('admin');
    if (typeof ack === 'function') ack({ success: true, room: 'admin' });
  });
});

// Helper: Predict wait time via ML service or fallback
async function computePredictionE2E(entry, activeEntries) {
  const patientIndex = activeEntries.findIndex(e => e.id === entry.id);
  if (patientIndex === -1) {
    return {
      token: entry.token_number,
      status: entry.status,
      patients_ahead: 0,
      predicted_wait_minutes: 0,
      lower_bound_minutes: 0,
      upper_bound_minutes: 0,
      model_version: 'v1.0',
      message: `Status: ${entry.status}`,
    };
  }

  const patientsAhead = patientIndex;
  const dept = db.departments.find(d => d.id === entry.department_id);
  const deptName = dept ? dept.name : '';
  const docCompleted = db.queue_entries.filter(q => q.doctor_id === entry.doctor_id && q.status === 'COMPLETED').length;
  const isColdStart = docCompleted < 3;

  try {
    const res = await fetch('http://127.0.0.1:8000/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patients_ahead: patientsAhead,
        queue_length: activeEntries.length,
        token_position: patientIndex + 1,
        hour_of_day: new Date().getHours(),
        day_of_week: (new Date().getDay() + 6) % 7,
        is_peak_hour: 1,
        department_id: entry.department_id,
        doctor_id: entry.doctor_id,
        doctor_avg_duration: 12.0,
        completed_today: docCompleted,
        department_name: deptName,
        is_cold_start: isColdStart,
      }),
    });
    if (res.ok) {
      const predData = await res.json();
      return predData;
    }
  } catch (err) {
    // Graceful fallback
  }

  // Graceful historical fallback calculation
  const predictedWait = patientsAhead === 0 ? 2 : Math.round(patientsAhead * 12 + 2);
  return {
    token: entry.token_number,
    status: entry.status,
    patients_ahead: patientsAhead,
    predicted_wait_minutes: predictedWait,
    lower_bound_minutes: Math.max(1, Math.round(predictedWait * 0.8)),
    upper_bound_minutes: Math.round(predictedWait * 1.3),
    model_version: isColdStart ? 'v1.0-bayesian-prior' : 'v1.0-fallback',
    confidence_interval: isColdStart ? 'Clinical specialty prior calibration (±35%)' : 'Estimated wait based on queue flow',
    is_cold_start: isColdStart,
    is_fallback: true,
    message: isColdStart ? 'Wait estimated using clinical specialty prior' : 'Estimated wait based on queue flow',
  };
}

// Helper: Synchronize real-time events across socket rooms
async function syncRealtimeQueueE2E(doctorId, departmentId, triggeredEntry = null, action = null) {
  const today = new Date().toISOString().split('T')[0];
  const activeEntries = db.queue_entries
    .filter(q => q.doctor_id === doctorId && q.queue_date === today && ['IN_CONSULTATION', 'CALLED', 'WAITING'].includes(q.status))
    .sort((a, b) => {
      const rankA = a.status === 'IN_CONSULTATION' ? 1 : a.status === 'CALLED' ? 2 : 3;
      const rankB = b.status === 'IN_CONSULTATION' ? 1 : b.status === 'CALLED' ? 2 : 3;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(a.created_at) - new Date(b.created_at);
    });

  const currentServing = activeEntries.find(e => e.status === 'IN_CONSULTATION') ||
                         activeEntries.find(e => e.status === 'CALLED') || null;
  const currentToken = currentServing ? currentServing.token_number : null;

  // Direct events for triggered entry
  if (triggeredEntry && triggeredEntry.queue_access_token) {
    const patientRoom = `patient:${triggeredEntry.queue_access_token}`;
    if (triggeredEntry.status === 'CALLED') {
      if (!triggeredEntry.turn_notified_at) {
        triggeredEntry.turn_notified_at = new Date();
      }
      io.to(patientRoom).emit('queue.patient_turn', {
        token: triggeredEntry.token_number,
        message: "It's your turn! Please proceed to the consultation room.",
      });
      io.to(patientRoom).emit('queue.token_called', {
        token: triggeredEntry.token_number,
        status: 'CALLED',
        currentToken: triggeredEntry.token_number,
        position: 1,
        patientsAhead: 0,
      });
    } else if (triggeredEntry.status === 'IN_CONSULTATION') {
      io.to(patientRoom).emit('queue.consultation_started', {
        token: triggeredEntry.token_number,
        status: 'IN_CONSULTATION',
        currentToken: triggeredEntry.token_number,
        message: 'Your consultation has started.',
      });
    } else if (triggeredEntry.status === 'COMPLETED') {
      io.to(patientRoom).emit('queue.consultation_completed', {
        token: triggeredEntry.token_number,
        status: 'COMPLETED',
        message: 'Consultation completed.',
      });
    } else if (triggeredEntry.status === 'NO_SHOW') {
      io.to(patientRoom).emit('queue.patient_no_show', {
        token: triggeredEntry.token_number,
        status: 'NO_SHOW',
        message: 'Marked as no-show.',
      });
    } else if (triggeredEntry.status === 'CANCELLED') {
      io.to(patientRoom).emit('queue.patient_cancelled', {
        token: triggeredEntry.token_number,
        status: 'CANCELLED',
        message: 'Cancelled.',
      });
    }
  }

  // Update all waiting entries
  for (let i = 0; i < activeEntries.length; i++) {
    const entry = activeEntries[i];
    if (entry.status !== 'WAITING') continue;

    const position = i + 1;
    const patientsAhead = i;
    const isApproaching = patientsAhead <= APPROACHING_THRESHOLD;

    // Idempotent approaching notification
    if (isApproaching && !entry.approaching_notified_at) {
      entry.approaching_notified_at = new Date();
      io.to(`patient:${entry.queue_access_token}`).emit('queue.patient_approaching', {
        token: entry.token_number,
        patientsAhead,
        position,
        message: `Your turn is approaching! ${patientsAhead} patient(s) ahead.`,
      });
      io.to(`patient:${entry.queue_access_token}`).emit('notification.created', {
        type: 'APPROACHING',
        token: entry.token_number,
        patientsAhead,
        message: `Your turn is approaching! ${patientsAhead} patient(s) ahead.`,
      });
    }

    const prediction = await computePredictionE2E(entry, activeEntries);
    const doctor = db.doctors.find(d => d.id === entry.doctor_id);
    const dept = db.departments.find(d => d.id === entry.department_id);

    io.to(`patient:${entry.queue_access_token}`).emit('queue.wait_time_updated', {
      token: entry.token_number,
      doctor: doctor?.name,
      department: dept?.name,
      status: entry.status,
      currentToken,
      position,
      patientsAhead,
      isApproaching,
      approachingThreshold: APPROACHING_THRESHOLD,
      queueDate: entry.queue_date,
      prediction,
    });
  }

  // Broadcast to doctor, department, admin
  io.to(`doctor:${doctorId}`).emit('queue.updated', { doctorId, action, currentToken, activeCount: activeEntries.length });
  io.to(`department:${departmentId}`).emit('queue.updated', { departmentId, action, currentToken });
  io.to('admin').emit('queue.updated', { doctorId, departmentId, action, currentToken });
}

// ── Auth Middleware ──────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'No authorization token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

// ── Auth Routes ──────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email && u.status === 'ACTIVE');
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
  }

  let doctorInfo = null;
  if (user.role === 'DOCTOR') {
    const doc = db.doctors.find(d => d.user_id === user.id);
    if (doc) {
      const dept = db.departments.find(d => d.id === doc.department_id);
      doctorInfo = { doctor_id: doc.id, department_id: doc.department_id, department_name: dept?.name };
    }
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name, doctorInfo }, JWT_SECRET, { expiresIn: '8h' });
  res.json({
    status: 'ok',
    message: 'Login successful',
    data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, doctorInfo } }
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ status: 'ok', data: { user: req.user } });
});

// ── Public Virtual Queue Route (Phase 2 & 3 & 4) ──
app.get('/api/queue/access/:accessToken', async (req, res) => {
  const { accessToken } = req.params;
  if (!accessToken || accessToken.trim().length < 8) {
    return res.status(400).json({ status: 'error', message: 'Invalid queue access token format' });
  }

  const entry = db.queue_entries.find(q => q.queue_access_token === accessToken.trim());
  if (!entry) {
    return res.status(404).json({ status: 'error', message: 'Queue entry not found or invalid access token' });
  }

  const doctor = db.doctors.find(d => d.id === entry.doctor_id);
  const dept = db.departments.find(d => d.id === entry.department_id);

  // Backend-authoritative missed-token check on access
  const graceMinutes = db.system_settings?.missed_token_grace_period_minutes || 5;
  if (entry.status === 'CALLED' && entry.called_at) {
    const elapsedMinutes = (Date.now() - new Date(entry.called_at).getTime()) / 60000;
    if (elapsedMinutes >= graceMinutes) {
      entry.status = 'MISSED';
      entry.missed_at = new Date();
      db.queue_events.push({
        id: db.queue_events.length + 1,
        queue_entry_id: entry.id,
        token_number: entry.token_number,
        event_type: 'PATIENT_MISSED',
        actor_type: 'SYSTEM',
        details: { token: entry.token_number, graceMinutes },
        notes: `Grace period expired (${graceMinutes}m)`,
        created_at: new Date()
      });
      syncRealtimeQueueE2E(entry.doctor_id, entry.department_id, entry, 'MISSED');
    }
  }

  const activeEntries = db.queue_entries
    .filter(q => q.doctor_id === entry.doctor_id && q.queue_date === entry.queue_date && ['IN_CONSULTATION', 'CALLED', 'WAITING'].includes(q.status))
    .sort((a, b) => {
      const rankA = a.status === 'IN_CONSULTATION' ? 1 : a.status === 'CALLED' ? 2 : 3;
      const rankB = b.status === 'IN_CONSULTATION' ? 1 : b.status === 'CALLED' ? 2 : 3;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(a.created_at) - new Date(b.created_at);
    });

  const currentServing = activeEntries.find(e => e.status === 'IN_CONSULTATION') ||
                         activeEntries.find(e => e.status === 'CALLED') || null;
  const currentToken = currentServing ? currentServing.token_number : null;

  const patientIndex = activeEntries.findIndex(e => e.id === entry.id);
  const position = patientIndex !== -1 ? patientIndex + 1 : null;
  const patientsAhead = patientIndex !== -1 ? patientIndex : 0;
  const isApproaching = entry.status === 'WAITING' && patientsAhead <= APPROACHING_THRESHOLD;

  const prediction = await computePredictionE2E(entry, activeEntries);

  const maxRejoins = db.system_settings?.max_rejoin_attempts || 2;
  const maxReschedules = db.system_settings?.max_reschedule_attempts || 2;
  const graceDeadline = entry.called_at
    ? new Date(new Date(entry.called_at).getTime() + graceMinutes * 60000).toISOString()
    : null;
  const transferredFromDoc = entry.transferred_from_doctor_id
    ? db.doctors.find(d => d.id === entry.transferred_from_doctor_id)?.name
    : null;

  res.json({
    status: 'ok',
    data: {
      token: entry.token_number,
      doctor: doctor?.name || 'Assigned Doctor',
      doctorId: entry.doctor_id,
      department: dept?.name || 'Department',
      departmentId: entry.department_id,
      status: entry.status,
      currentToken,
      position,
      patientsAhead,
      isApproaching,
      approachingThreshold: APPROACHING_THRESHOLD,
      queueDate: entry.queue_date,
      prediction,
      calledAt: entry.called_at,
      missedAt: entry.missed_at,
      gracePeriodMinutes: graceMinutes,
      graceDeadline,
      rejoinCount: entry.rejoin_count || 0,
      maxRejoins,
      rescheduleCount: entry.reschedule_count || 0,
      maxReschedules,
      doctorOperationalStatus: doctor?.operational_status || 'AVAILABLE',
      doctorPauseReason: doctor?.pause_reason || null,
      doctorPausedAt: doctor?.paused_at || null,
      roomNumber: doctor?.room_number || 'Room 101',
      transferredAt: entry.transferred_at || null,
      transferredFromDoctorName: transferredFromDoc,
    }
  });
});

// Helper: Patient cancel handler
const handlePatientCancel = (req, res) => {
  const tokenStr = req.params.accessToken || req.body?.accessToken || req.query?.accessToken;
  if (!tokenStr || tokenStr.trim().length < 8) {
    return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
  }
  const entry = db.queue_entries.find(q => q.queue_access_token === tokenStr.trim());
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status)) {
    return res.status(400).json({ status: 'error', message: `Cannot cancel queue entry with status ${entry.status}` });
  }
  if (entry.status === 'IN_CONSULTATION') {
    return res.status(400).json({ status: 'error', message: 'Cannot cancel consultation already in progress' });
  }

  entry.status = 'CANCELLED';
  db.queue_events.push({
    id: db.queue_events.length + 1,
    queue_entry_id: entry.id,
    token_number: entry.token_number,
    event_type: 'CANCELLED',
    actor_type: 'PATIENT',
    details: { reason: req.body?.reason || 'Patient cancelled' },
    created_at: new Date()
  });
  syncRealtimeQueueE2E(entry.doctor_id, entry.department_id, entry, 'CANCELLED');
  res.json({ status: 'ok', message: 'Queue entry cancelled successfully', data: { token: entry.token_number, status: 'CANCELLED' } });
};

app.post('/api/queue/patient/cancel', handlePatientCancel);
app.post('/api/queue/access/:accessToken/cancel', handlePatientCancel);

// Helper: Patient rejoin handler
const handlePatientRejoin = async (req, res) => {
  const tokenStr = req.params.accessToken || req.body?.accessToken || req.query?.accessToken;
  if (!tokenStr || tokenStr.trim().length < 8) {
    return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
  }
  const entry = db.queue_entries.find(q => q.queue_access_token === tokenStr.trim());
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });

  // If called and past grace period, auto-reconcile
  const graceMinutes = db.system_settings?.missed_token_grace_period_minutes || 5;
  if (entry.status === 'CALLED' && entry.called_at) {
    const elapsedMinutes = (Date.now() - new Date(entry.called_at).getTime()) / 60000;
    if (elapsedMinutes >= graceMinutes) {
      entry.status = 'MISSED';
      entry.missed_at = new Date();
    }
  }

  if (entry.status !== 'MISSED') {
    return res.status(400).json({ status: 'error', message: `Only missed tokens can rejoin the queue. Current status: ${entry.status}` });
  }

  const maxRejoins = db.system_settings?.max_rejoin_attempts || 2;
  if ((entry.rejoin_count || 0) >= maxRejoins) {
    return res.status(400).json({ status: 'error', message: `You have reached the maximum number of queue changes for this visit (${maxRejoins}). Please see reception.` });
  }

  entry.status = 'WAITING';
  entry.created_at = new Date(); // Places patient at end of queue
  entry.called_at = null;
  entry.missed_at = null;
  entry.rejoin_count = (entry.rejoin_count || 0) + 1;
  entry.approaching_notified_at = null;
  entry.turn_notified_at = null;

  db.queue_events.push({
    id: db.queue_events.length + 1,
    queue_entry_id: entry.id,
    token_number: entry.token_number,
    event_type: 'PATIENT_REJOINED',
    actor_type: 'PATIENT',
    details: { token: entry.token_number, rejoinCount: entry.rejoin_count },
    created_at: new Date()
  });

  syncRealtimeQueueE2E(entry.doctor_id, entry.department_id, entry, 'REJOINED');
  const prediction = await computePredictionE2E(entry, db.queue_entries.filter(q => q.doctor_id === entry.doctor_id && ['WAITING', 'CALLED', 'IN_CONSULTATION'].includes(q.status)));

  res.json({
    status: 'ok',
    message: 'You have rejoined the queue at the end',
    data: {
      token: entry.token_number,
      status: 'WAITING',
      rejoinCount: entry.rejoin_count,
      prediction,
    }
  });
};

app.post('/api/queue/patient/rejoin', handlePatientRejoin);
app.post('/api/queue/access/:accessToken/rejoin', handlePatientRejoin);

// Helper: Patient reschedule options handler
const handleRescheduleOptions = (req, res) => {
  const tokenStr = req.params.accessToken || req.body?.accessToken || req.query?.accessToken;
  if (!tokenStr || tokenStr.trim().length < 8) {
    return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
  }
  const entry = db.queue_entries.find(q => q.queue_access_token === tokenStr.trim());
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  if (!['WAITING', 'MISSED'].includes(entry.status)) {
    return res.status(400).json({ status: 'error', message: `Cannot reschedule from status ${entry.status}` });
  }

  const maxReschedules = db.system_settings?.max_reschedule_attempts || 2;
  if ((entry.reschedule_count || 0) >= maxReschedules) {
    return res.status(400).json({ status: 'error', message: `You have reached the maximum number of reschedules for this visit (${maxReschedules}).` });
  }

  const dept = db.departments.find(d => d.id === entry.department_id);
  const eligibleDoctors = db.doctors.filter(d =>
    d.department_id === entry.department_id &&
    d.id !== entry.doctor_id &&
    d.status === 'ACTIVE' &&
    d.operational_status === 'AVAILABLE' &&
    !db.doctor_leaves.some(l => l.doctor_id === d.id && l.leave_date === new Date().toISOString().split('T')[0])
  );

  const options = eligibleDoctors.map(d => {
    const waitingCount = db.queue_entries.filter(q => q.doctor_id === d.id && q.status === 'WAITING').length;
    return {
      doctorId: d.id,
      name: d.name,
      specialization: d.specialization,
      roomNumber: d.room_number || 'Room 101',
      patientsWaiting: waitingCount,
      estimatedWaitMinutes: Math.max(5, (waitingCount * 12) + 2)
    };
  });

  res.json({
    status: 'ok',
    data: {
      currentDoctorId: entry.doctor_id,
      departmentName: dept?.name || 'Department',
      rescheduleCount: entry.reschedule_count || 0,
      maxReschedules,
      options,
    }
  });
};

app.get('/api/queue/patient/reschedule-options', handleRescheduleOptions);
app.get('/api/queue/access/:accessToken/reschedule-options', handleRescheduleOptions);

// Helper: Patient reschedule handler
const handlePatientReschedule = async (req, res) => {
  const tokenStr = req.params.accessToken || req.body?.accessToken || req.query?.accessToken;
  const targetDoctorId = parseInt(req.body?.target_doctor_id || req.body?.newDoctorId, 10);

  if (!tokenStr || tokenStr.trim().length < 8) {
    return res.status(400).json({ status: 'error', message: 'Invalid access token format' });
  }
  if (!targetDoctorId) {
    return res.status(400).json({ status: 'error', message: 'Target doctor is required' });
  }

  const entry = db.queue_entries.find(q => q.queue_access_token === tokenStr.trim());
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  if (!['WAITING', 'MISSED'].includes(entry.status)) {
    return res.status(400).json({ status: 'error', message: `Cannot reschedule from status ${entry.status}` });
  }

  const maxReschedules = db.system_settings?.max_reschedule_attempts || 2;
  if ((entry.reschedule_count || 0) >= maxReschedules) {
    return res.status(400).json({ status: 'error', message: `Maximum reschedules exceeded (${maxReschedules}).` });
  }

  const targetDoc = db.doctors.find(d => d.id === targetDoctorId);
  if (!targetDoc || targetDoc.department_id !== entry.department_id || targetDoc.status !== 'ACTIVE') {
    return res.status(400).json({ status: 'error', message: 'Selected doctor is not available in this department.' });
  }

  const prevDocId = entry.doctor_id;
  entry.doctor_id = targetDoctorId;
  entry.status = 'WAITING';
  entry.created_at = new Date();
  entry.called_at = null;
  entry.missed_at = null;
  entry.reschedule_count = (entry.reschedule_count || 0) + 1;
  entry.approaching_notified_at = null;
  entry.turn_notified_at = null;

  db.queue_events.push({
    id: db.queue_events.length + 1,
    queue_entry_id: entry.id,
    token_number: entry.token_number,
    event_type: 'PATIENT_RESCHEDULED',
    actor_type: 'PATIENT',
    details: { token: entry.token_number, fromDoctorId: prevDocId, toDoctorId: targetDoctorId, rescheduleCount: entry.reschedule_count },
    created_at: new Date()
  });

  syncRealtimeQueueE2E(prevDocId, entry.department_id, entry, 'RESCHEDULED');
  syncRealtimeQueueE2E(targetDoctorId, entry.department_id, entry, 'RESCHEDULED');

  res.json({
    status: 'ok',
    message: `Rescheduled to Dr. ${targetDoc.name}`,
    data: {
      token: entry.token_number,
      newDoctor: targetDoc.name,
      roomNumber: targetDoc.room_number,
      status: 'WAITING',
      rescheduleCount: entry.reschedule_count,
    }
  });
};

app.post('/api/queue/patient/reschedule', handlePatientReschedule);
app.post('/api/queue/access/:accessToken/reschedule', handlePatientReschedule);

app.get('/api/queue/access/:accessToken/prediction', async (req, res) => {
  const { accessToken } = req.params;
  const entry = db.queue_entries.find(q => q.queue_access_token === accessToken.trim());
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  const activeEntries = db.queue_entries.filter(q => q.doctor_id === entry.doctor_id && q.queue_date === entry.queue_date && ['IN_CONSULTATION', 'CALLED', 'WAITING'].includes(q.status));
  const prediction = await computePredictionE2E(entry, activeEntries);
  res.json({ status: 'ok', data: prediction });
});

// ── Departments & Doctors ─────────────────────────
app.get('/api/departments', (req, res) => res.json({ status: 'ok', data: db.departments }));

app.get('/api/doctors/availability/today', authMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const list = db.doctors.map(d => {
    const isLeave = db.doctor_leaves.some(l => l.doctor_id === d.id && l.leave_date === today);
    const waitingCount = db.queue_entries.filter(q => q.doctor_id === d.id && q.status === 'WAITING').length;
    const capacity = d.daily_capacity || db.system_settings.daily_queue_capacity || 30;
    let computed_availability = 'AVAILABLE';
    if (d.status === 'INACTIVE') computed_availability = 'INACTIVE';
    else if (isLeave) computed_availability = 'ON_LEAVE';
    else if (d.operational_status === 'PAUSED') computed_availability = 'PAUSED';

    const dept = db.departments.find(dp => dp.id === d.department_id);
    return {
      id: d.id,
      name: d.name,
      department_id: d.department_id,
      departmentId: d.department_id,
      department_name: dept?.name || '',
      departmentName: dept?.name || '',
      specialization: d.specialization,
      room_number: d.room_number || 'Room 101',
      roomNumber: d.room_number || 'Room 101',
      operational_status: d.operational_status || 'AVAILABLE',
      operationalStatus: d.operational_status || 'AVAILABLE',
      computed_availability,
      computedAvailability: computed_availability,
      isAvailable: computed_availability === 'AVAILABLE',
      accountStatus: d.status,
      waiting_count: waitingCount,
      waitingCount,
      daily_capacity: capacity,
      dailyCapacity: capacity,
      isAtCapacity: waitingCount >= capacity,
      capacityReached: waitingCount >= capacity,
      on_leave_today: isLeave,
      is_working_today: !isLeave,
      pause_reason: d.pause_reason,
      paused_at: d.paused_at,
    };
  });
  res.json({ status: 'ok', data: list });
});

app.get('/api/doctors', (req, res) => res.json({ status: 'ok', data: db.doctors }));

app.post('/api/doctors', authMiddleware, (req, res) => {
  const { name, email, department_id, specialization, room_number, daily_capacity } = req.body;
  const newDoc = {
    id: db.doctors.length + 1,
    user_id: db.users.length + 1,
    department_id: parseInt(department_id, 10),
    name,
    specialization: specialization || 'General Physician',
    room_number: room_number || 'Room 101',
    operational_status: 'AVAILABLE',
    daily_capacity: parseInt(daily_capacity, 10) || 30,
    pause_reason: null,
    paused_at: null,
    status: 'ACTIVE'
  };
  db.doctors.push(newDoc);
  res.status(201).json({ status: 'ok', data: newDoc });
});

app.put('/api/doctors/:id', authMiddleware, (req, res) => {
  const doc = db.doctors.find(d => d.id === parseInt(req.params.id, 10));
  if (!doc) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
  const { name, department_id, specialization, room_number, daily_capacity } = req.body;
  if (name) doc.name = name;
  if (department_id) doc.department_id = parseInt(department_id, 10);
  if (specialization) doc.specialization = specialization;
  if (room_number) doc.room_number = room_number;
  if (daily_capacity) doc.daily_capacity = parseInt(daily_capacity, 10);
  res.json({ status: 'ok', data: doc });
});

app.patch('/api/doctors/:id/status', authMiddleware, (req, res) => {
  const doc = db.doctors.find(d => d.id === parseInt(req.params.id, 10));
  if (!doc) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
  doc.status = req.body.status || (doc.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE');
  res.json({ status: 'ok', data: doc });
});

// Pause / Resume routes
const handleDoctorPause = (req, res) => {
  const doc = db.doctors.find(d => d.id === parseInt(req.params.id, 10));
  if (!doc) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
  doc.operational_status = 'PAUSED';
  doc.pause_reason = req.body.reason || 'Duty break';
  doc.paused_at = new Date();
  io.emit('queue.paused', { doctorId: doc.id, reason: doc.pause_reason });
  io.emit('doctor.availability_changed', { doctorId: doc.id, operationalStatus: 'PAUSED' });
  res.json({ status: 'ok', message: `Queue paused for Dr. ${doc.name}`, data: doc });
};
const handleDoctorResume = (req, res) => {
  const doc = db.doctors.find(d => d.id === parseInt(req.params.id, 10));
  if (!doc) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
  doc.operational_status = 'AVAILABLE';
  doc.pause_reason = null;
  doc.paused_at = null;
  io.emit('queue.resumed', { doctorId: doc.id });
  io.emit('doctor.availability_changed', { doctorId: doc.id, operationalStatus: 'AVAILABLE' });
  res.json({ status: 'ok', message: `Queue resumed for Dr. ${doc.name}`, data: doc });
};

app.post('/api/doctors/:id/pause', authMiddleware, handleDoctorPause);
app.post('/api/queue/doctor/:id/pause', authMiddleware, handleDoctorPause);
app.post('/api/doctors/:id/resume', authMiddleware, handleDoctorResume);
app.post('/api/queue/doctor/:id/resume', authMiddleware, handleDoctorResume);

// Doctor schedules
app.get('/api/doctors/:id/schedule', authMiddleware, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const sched = db.doctor_schedules.filter(s => s.doctor_id === docId);
  res.json({ status: 'ok', data: sched });
});
app.put('/api/doctors/:id/schedule', authMiddleware, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const items = req.body.schedule || req.body || [];
  db.doctor_schedules = db.doctor_schedules.filter(s => s.doctor_id !== docId);
  (Array.isArray(items) ? items : []).forEach(item => {
    db.doctor_schedules.push({ ...item, doctor_id: docId, id: db.doctor_schedules.length + 1 });
  });
  res.json({ status: 'ok', message: 'Schedule updated', data: db.doctor_schedules.filter(s => s.doctor_id === docId) });
});

// Doctor leaves
app.get('/api/doctors/:id/leave', authMiddleware, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const leaves = db.doctor_leaves.filter(l => l.doctor_id === docId);
  res.json({ status: 'ok', data: leaves });
});
app.post('/api/doctors/:id/leave', authMiddleware, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const { leave_date, is_full_day, start_time, end_time, reason } = req.body;
  const newLeave = {
    id: db.doctor_leaves.length + 1,
    doctor_id: docId,
    leave_date,
    is_full_day: is_full_day !== false,
    start_time: start_time || null,
    end_time: end_time || null,
    reason: reason || 'Leave',
    created_at: new Date()
  };
  db.doctor_leaves.push(newLeave);
  io.emit('doctor.availability_changed', { doctorId: docId });
  res.status(201).json({ status: 'ok', message: 'Leave recorded', data: newLeave });
});
app.delete('/api/doctors/:id/leave/:leaveId', authMiddleware, (req, res) => {
  const leaveId = parseInt(req.params.leaveId, 10);
  db.doctor_leaves = db.doctor_leaves.filter(l => l.id !== leaveId);
  res.json({ status: 'ok', message: 'Leave removed' });
});

// Queue Transfer
app.post('/api/queue/transfer', authMiddleware, (req, res) => {
  const fromDocId = parseInt(req.body.fromDoctorId || req.body.from_doctor_id, 10);
  const toDocId = parseInt(req.body.toDoctorId || req.body.to_doctor_id, 10);
  const reason = req.body.reason || 'Physician unavailable';

  const fromDoc = db.doctors.find(d => d.id === fromDocId);
  const toDoc = db.doctors.find(d => d.id === toDocId);
  if (!fromDoc || !toDoc) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
  if (fromDoc.department_id !== toDoc.department_id) {
    return res.status(400).json({ status: 'error', message: 'Doctors must be in the same department' });
  }

  const waitingTokens = db.queue_entries.filter(q => q.doctor_id === fromDocId && q.status === 'WAITING');
  waitingTokens.forEach(entry => {
    entry.doctor_id = toDocId;
    entry.transferred_from_doctor_id = fromDocId;
    entry.transferred_at = new Date();
    db.queue_events.push({
      id: db.queue_events.length + 1,
      queue_entry_id: entry.id,
      token_number: entry.token_number,
      event_type: 'QUEUE_TRANSFERRED',
      actor_type: 'STAFF',
      actor_id: req.user?.id,
      details: { fromDoctorId: fromDocId, toDoctorId: toDocId, reason },
      created_at: new Date()
    });
  });

  io.emit('queue.transferred', { fromDoctorId: fromDocId, toDoctorId: toDocId, count: waitingTokens.length, reason });
  syncRealtimeQueueE2E(fromDocId, fromDoc.department_id);
  syncRealtimeQueueE2E(toDocId, toDoc.department_id);

  res.json({
    status: 'ok',
    message: `Transferred ${waitingTokens.length} patients from Dr. ${fromDoc.name} to Dr. ${toDoc.name}`,
    data: { transferredCount: waitingTokens.length, fromDoctor: fromDoc.name, toDoctor: toDoc.name }
  });
});

// Settings & Events
app.get('/api/queue/settings', authMiddleware, (req, res) => {
  res.json({ status: 'ok', data: db.system_settings });
});
app.put('/api/queue/settings', authMiddleware, (req, res) => {
  const newSettings = req.body.settings || req.body;
  db.system_settings = { ...db.system_settings, ...newSettings };
  res.json({ status: 'ok', message: 'Settings updated', data: db.system_settings });
});
app.get('/api/queue/events', authMiddleware, (req, res) => {
  res.json({ status: 'ok', data: db.queue_events.slice().reverse() });
});

app.get('/api/users', authMiddleware, (req, res) => res.json({ status: 'ok', data: db.users }));

// ── Patients ──────────────────────────────────────
app.post('/api/patients', authMiddleware, (req, res) => {
  const { name, age, gender, phone } = req.body;
  const newPatient = { id: db.patients.length + 1, name, age: parseInt(age), gender, phone };
  db.patients.push(newPatient);
  res.status(201).json({ status: 'ok', data: newPatient });
});

// ── Queue Management ──────────────────────────────
app.post('/api/queue/token', authMiddleware, async (req, res) => {
  const { patient_id, doctor_id, department_id } = req.body;
  const patient = db.patients.find(p => p.id === parseInt(patient_id));
  const doctor = db.doctors.find(d => d.id === parseInt(doctor_id));
  const dept = db.departments.find(d => d.id === parseInt(department_id));

  const deptEntriesToday = db.queue_entries.filter(q => q.department_id === parseInt(department_id));
  const seq = deptEntriesToday.length + 1;
  const tokenNumber = `${dept?.code || 'GM'}-${String(seq).padStart(3, '0')}`;
  const queueAccessToken = crypto.randomBytes(16).toString('hex');

  const newEntry = {
    id: db.queue_entries.length + 1,
    patient_id: parseInt(patient_id),
    doctor_id: parseInt(doctor_id),
    department_id: parseInt(department_id),
    token_number: tokenNumber,
    queue_access_token: queueAccessToken,
    queue_date: new Date().toISOString().split('T')[0],
    status: 'WAITING',
    created_at: new Date(),
    called_at: null,
    consultation_started_at: null,
    consultation_completed_at: null,
    actual_wait_minutes: null,
    consultation_duration_minutes: null,
    prediction_error_minutes: null,
    approaching_notified_at: null,
    turn_notified_at: null,
  };
  db.queue_entries.push(newEntry);

  const enriched = {
    ...newEntry,
    patient_name: patient?.name,
    doctor_name: doctor?.name,
    department_name: dept?.name,
  };

  syncRealtimeQueueE2E(newEntry.doctor_id, newEntry.department_id, enriched, 'NEW_PATIENT');

  res.status(201).json({
    status: 'ok',
    message: 'Token generated successfully',
    data: enriched,
  });
});

app.get('/api/queue', authMiddleware, (req, res) => {
  const result = db.queue_entries.map(q => {
    const p = db.patients.find(pt => pt.id === q.patient_id);
    const d = db.doctors.find(doc => doc.id === q.doctor_id);
    const dep = db.departments.find(dp => dp.id === q.department_id);
    return {
      ...q,
      patient_name: p?.name,
      patient_age: p?.age,
      patient_gender: p?.gender,
      patient_phone: p?.phone,
      doctor_name: d?.name,
      department_name: dep?.name,
      department_code: dep?.code,
    };
  });
  res.json({ status: 'ok', data: result });
});

app.get('/api/queue/doctor/:doctorId', authMiddleware, (req, res) => {
  const docId = parseInt(req.params.doctorId);
  const result = db.queue_entries
    .filter(q => q.doctor_id === docId)
    .map(q => {
      const p = db.patients.find(pt => pt.id === q.patient_id);
      const d = db.doctors.find(doc => doc.id === q.doctor_id);
      const dep = db.departments.find(dp => dp.id === q.department_id);
      return {
        ...q,
        patient_name: p?.name,
        patient_age: p?.age,
        patient_gender: p?.gender,
        patient_phone: p?.phone,
        doctor_name: d?.name,
        department_name: dep?.name,
        department_code: dep?.code
      };
    });
  res.json({ status: 'ok', data: result });
});

app.get('/api/queue/stats', authMiddleware, (req, res) => {
  const waiting = db.queue_entries.filter(q => q.status === 'WAITING').length;
  const called = db.queue_entries.filter(q => q.status === 'CALLED').length;
  const in_consultation = db.queue_entries.filter(q => q.status === 'IN_CONSULTATION').length;
  const completed = db.queue_entries.filter(q => q.status === 'COMPLETED').length;
  const cancelled = db.queue_entries.filter(q => q.status === 'CANCELLED').length;
  const no_show = db.queue_entries.filter(q => q.status === 'NO_SHOW').length;

  res.json({
    status: 'ok',
    data: {
      total_patients: db.queue_entries.length,
      waiting,
      called,
      in_consultation,
      completed,
      cancelled,
      no_show,
      active_virtual_queues: (waiting + called + in_consultation > 0) ? 1 : 0,
      total_doctors: db.doctors.length,
      total_departments: db.departments.length
    }
  });
});

// Helper for transition with state machine enforcement
function transitionEntry(id, targetStatus) {
  const entry = db.queue_entries.find(q => q.id === parseInt(id));
  if (!entry) throw new Error('Queue entry not found');

  const allowed = VALID_TRANSITIONS[entry.status] || [];
  if (!allowed.includes(targetStatus)) {
    throw new Error(`Cannot transition from ${entry.status} to ${targetStatus}`);
  }

  entry.status = targetStatus;
  const now = new Date();

  if (targetStatus === 'CALLED') {
    entry.called_at = now;
  } else if (targetStatus === 'IN_CONSULTATION') {
    entry.consultation_started_at = now;
    if (entry.created_at) {
      entry.actual_wait_minutes = Math.max(0.5, Math.round(((now - new Date(entry.created_at)) / 60000) * 10) / 10);
      const estWait = 18.0;
      entry.prediction_error_minutes = Math.round(Math.abs(entry.actual_wait_minutes - estWait) * 10) / 10;
      db.predictions.push({
        queue_entry_id: entry.id,
        token_number: entry.token_number,
        actual_wait_minutes: entry.actual_wait_minutes,
        predicted_wait_minutes: estWait,
        prediction_error: entry.prediction_error_minutes,
        created_at: now
      });
    }
  } else if (targetStatus === 'COMPLETED') {
    entry.consultation_completed_at = now;
    if (entry.consultation_started_at) {
      entry.consultation_duration_minutes = Math.max(0.5, Math.round(((now - new Date(entry.consultation_started_at)) / 60000) * 10) / 10);
    }
  } else if (targetStatus === 'MISSED') {
    entry.missed_at = now;
    db.queue_events.push({
      id: db.queue_events.length + 1,
      queue_entry_id: entry.id,
      token_number: entry.token_number,
      event_type: 'PATIENT_MISSED',
      actor_type: 'STAFF',
      notes: 'Staff marked token as missed',
      created_at: now
    });
  }

  const p = db.patients.find(pt => pt.id === entry.patient_id);
  const d = db.doctors.find(doc => doc.id === entry.doctor_id);
  const dep = db.departments.find(dp => dp.id === entry.department_id);

  const enriched = {
    ...entry,
    patient_name: p?.name,
    doctor_name: d?.name,
    department_name: dep?.name,
  };

  syncRealtimeQueueE2E(entry.doctor_id, entry.department_id, enriched, targetStatus);
  return enriched;
}

// ── Queue Actions (Doctor / Receptionist) ─────────
app.post('/api/queue/:id/call', authMiddleware, (req, res) => {
  try {
    const updated = transitionEntry(req.params.id, 'CALLED');
    res.json({ status: 'ok', message: 'Patient called', data: updated });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

app.post('/api/queue/:id/missed', authMiddleware, (req, res) => {
  try {
    const updated = transitionEntry(req.params.id, 'MISSED');
    res.json({ status: 'ok', message: 'Token marked as missed', data: updated });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

app.post('/api/queue/:id/start', authMiddleware, (req, res) => {
  try {
    const updated = transitionEntry(req.params.id, 'IN_CONSULTATION');
    res.json({ status: 'ok', message: 'Consultation started', data: updated });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

app.post('/api/queue/:id/complete', authMiddleware, (req, res) => {
  try {
    const updated = transitionEntry(req.params.id, 'COMPLETED');
    res.json({ status: 'ok', message: 'Consultation completed', data: updated });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

app.post('/api/queue/:id/no-show', authMiddleware, (req, res) => {
  try {
    const updated = transitionEntry(req.params.id, 'NO_SHOW');
    res.json({ status: 'ok', message: 'Marked as no-show', data: updated });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

app.post('/api/queue/:id/cancel', authMiddleware, (req, res) => {
  try {
    const updated = transitionEntry(req.params.id, 'CANCELLED');
    res.json({ status: 'ok', message: 'Queue entry cancelled', data: updated });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

// ── Phase 4 Analytics Endpoints ───────────────────
app.get('/api/analytics/live-status', authMiddleware, (req, res) => {
  const liveDepartments = db.departments.map(dept => {
    const deptEntries = db.queue_entries.filter(q => q.department_id === dept.id);
    const waiting = deptEntries.filter(e => e.status === 'WAITING').length;
    const called = deptEntries.filter(e => e.status === 'CALLED').length;
    const consulting = deptEntries.filter(e => e.status === 'IN_CONSULTATION').length;
    const completed = deptEntries.filter(e => e.status === 'COMPLETED').length;

    const serving = deptEntries.find(e => e.status === 'IN_CONSULTATION') ||
                    deptEntries.find(e => e.status === 'CALLED') || null;

    return {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      status: (waiting + called + consulting > 0) ? 'Active' : 'Idle',
      currentlyServing: serving ? serving.token_number : '—',
      waitingCount: waiting,
      consultingCount: consulting,
      completedCount: completed,
      activeDoctorsCount: (waiting + called + consulting > 0) ? 1 : 0,
    };
  });

  res.json({ status: 'ok', data: liveDepartments, timestamp: new Date().toISOString() });
});

app.get('/api/analytics/overview', authMiddleware, (req, res) => {
  const completed = db.queue_entries.filter(q => q.status === 'COMPLETED');
  const waiting = db.queue_entries.filter(q => q.status === 'WAITING');
  const inConsult = db.queue_entries.filter(q => q.status === 'IN_CONSULTATION');
  const noShows = db.queue_entries.filter(q => q.status === 'NO_SHOW');
  const cancelled = db.queue_entries.filter(q => q.status === 'CANCELLED');

  const waitTimes = db.queue_entries.filter(q => q.actual_wait_minutes !== null).map(q => q.actual_wait_minutes);
  const avgWait = waitTimes.length ? (waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : null;

  const durations = db.queue_entries.filter(q => q.consultation_duration_minutes !== null).map(q => q.consultation_duration_minutes);
  const avgDuration = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const errors = db.queue_entries.filter(q => q.prediction_error_minutes !== null).map(q => q.prediction_error_minutes);
  const avgError = errors.length ? (errors.reduce((a, b) => a + b, 0) / errors.length) : null;

  res.json({
    status: 'ok',
    data: {
      summary: {
        patientsServedToday: completed.length,
        currentWaitingPatients: waiting.length,
        currentInConsultation: inConsult.length,
        noShowsToday: noShows.length,
        cancellationsToday: cancelled.length,
        totalPatientsToday: db.queue_entries.length,
        avgWaitingTimeMinutes: avgWait !== null ? Math.round(avgWait * 10) / 10 : null,
        avgConsultationDurationMinutes: avgDuration !== null ? Math.round(avgDuration * 10) / 10 : null,
        avgPredictionErrorMinutes: avgError !== null ? Math.round(avgError * 10) / 10 : null,
      },
      mlAccuracy: {
        hasEnoughData: db.predictions.length >= 3,
        evaluatedCount: db.predictions.length,
        mae: avgError !== null ? Math.round(avgError * 10) / 10 : null,
        rmse: avgError !== null ? Math.round(avgError * 1.2 * 10) / 10 : null,
        note: db.predictions.length >= 3 ? 'Evaluated against completed consultation telemetry' : 'Collecting more consultation telemetry (minimum 3 completed required)',
      },
      hourlyVolume: [
        { hour: '09:00', volume: 2 },
        { hour: '10:00', volume: 1 },
      ],
      departmentPerformance: db.departments.map(d => ({
        departmentId: d.id,
        name: d.name,
        code: d.code,
        totalRegistered: db.queue_entries.filter(q => q.department_id === d.id).length,
        served: db.queue_entries.filter(q => q.department_id === d.id && q.status === 'COMPLETED').length,
        waiting: db.queue_entries.filter(q => q.department_id === d.id && q.status === 'WAITING').length,
        avgWaitMinutes: avgWait,
      })),
      doctorPerformance: db.doctors.map(doc => ({
        doctorId: doc.id,
        doctorName: doc.name,
        departmentName: 'General Medicine',
        completedCount: db.queue_entries.filter(q => q.doctor_id === doc.id && q.status === 'COMPLETED').length,
        avgDurationMinutes: avgDuration,
      })),
      predictedVsActual: db.predictions.slice(-10),
    }
  });
});

app.get('/api/queue/admin/prediction-metrics', authMiddleware, (req, res) => {
  res.json({
    status: 'ok',
    data: {
      modelInfo: { name: 'GradientBoostingRegressor', version: 'v1.0' },
      modelMetrics: { mae: 2.8, r2_score: 0.88 },
      liveDatabaseStats: {
        totalPredictions: db.predictions.length,
        evaluatedCount: db.predictions.length,
        liveMAE: 2.5,
      },
      recentPredictions: db.predictions.slice(-10),
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: 'e2e-test', services: { server: 'running', database: 'in-memory', socket: 'enabled' } });
});

export const runningServer = server.listen(PORT, () => {
  console.log(`[START] E2E Test Backend + Socket.IO running on http://localhost:${PORT}`);
});

export default app;
