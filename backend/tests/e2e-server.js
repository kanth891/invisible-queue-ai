import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const app = express();
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
  ],
  departments: [
    { id: 1, name: 'General Medicine', code: 'GM', description: 'General medical consultations', status: 'ACTIVE' },
    { id: 2, name: 'Cardiology', code: 'CAR', description: 'Heart and cardiovascular care', status: 'ACTIVE' },
    { id: 3, name: 'Pediatrics', code: 'PED', description: 'Child healthcare', status: 'ACTIVE' },
  ],
  doctors: [
    { id: 1, user_id: 3, department_id: 1, name: 'Dr. Ravi Kumar', specialization: 'General Physician', status: 'ACTIVE' }
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
      consultation_completed_at: null
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
      consultation_completed_at: null
    }
  ]
};

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

// ── Public Virtual Queue Route (Phase 2) ─────────
app.get('/api/queue/access/:accessToken', (req, res) => {
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

  // Active entries for doctor today
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

  res.json({
    status: 'ok',
    data: {
      token: entry.token_number,
      doctor: doctor?.name || 'Assigned Doctor',
      department: dept?.name || 'Department',
      status: entry.status,
      currentToken,
      position,
      patientsAhead,
      isApproaching,
      approachingThreshold: APPROACHING_THRESHOLD,
      queueDate: entry.queue_date
    }
  });
});

// ── Departments & Doctors ─────────────────────────
app.get('/api/departments', (req, res) => {
  res.json({ status: 'ok', data: db.departments });
});

app.get('/api/doctors', (req, res) => {
  res.json({ status: 'ok', data: db.doctors });
});

// ── Patients ──────────────────────────────────────
app.post('/api/patients', authMiddleware, (req, res) => {
  const { name, age, gender, phone } = req.body;
  const newPatient = { id: db.patients.length + 1, name, age: parseInt(age), gender, phone };
  db.patients.push(newPatient);
  res.status(201).json({ status: 'ok', data: newPatient });
});

// ── Queue Management ──────────────────────────────
app.post('/api/queue/token', authMiddleware, (req, res) => {
  const { patient_id, doctor_id, department_id } = req.body;
  const patient = db.patients.find(p => p.id === parseInt(patient_id));
  const doctor = db.doctors.find(d => d.id === parseInt(doctor_id));
  const dept = db.departments.find(d => d.id === parseInt(department_id));

  const deptEntriesToday = db.queue_entries.filter(q => q.department_id === parseInt(department_id));
  const seq = deptEntriesToday.length + 1;
  const tokenNumber = `${dept.code}-${String(seq).padStart(3, '0')}`;
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
    consultation_completed_at: null
  };
  db.queue_entries.push(newEntry);

  res.status(201).json({
    status: 'ok',
    message: 'Token generated successfully',
    data: {
      ...newEntry,
      patient_name: patient?.name,
      doctor_name: doctor?.name,
      department_name: dept?.name
    }
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
      department_code: dep?.code
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

// ── Queue Actions (Doctor / Receptionist) ─────────
app.post('/api/queue/:id/call', authMiddleware, (req, res) => {
  const entry = db.queue_entries.find(q => q.id === parseInt(req.params.id));
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  entry.status = 'CALLED';
  entry.called_at = new Date();
  res.json({ status: 'ok', message: 'Patient called', data: entry });
});

app.post('/api/queue/:id/start', authMiddleware, (req, res) => {
  const entry = db.queue_entries.find(q => q.id === parseInt(req.params.id));
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  entry.status = 'IN_CONSULTATION';
  entry.consultation_started_at = new Date();
  res.json({ status: 'ok', message: 'Consultation started', data: entry });
});

app.post('/api/queue/:id/complete', authMiddleware, (req, res) => {
  const entry = db.queue_entries.find(q => q.id === parseInt(req.params.id));
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  entry.status = 'COMPLETED';
  entry.consultation_completed_at = new Date();
  res.json({ status: 'ok', message: 'Consultation completed', data: entry });
});

app.post('/api/queue/:id/cancel', authMiddleware, (req, res) => {
  const entry = db.queue_entries.find(q => q.id === parseInt(req.params.id));
  if (!entry) return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
  entry.status = 'CANCELLED';
  res.json({ status: 'ok', message: 'Queue entry cancelled', data: entry });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: 'e2e-test', services: { server: 'running', database: 'in-memory' } });
});

export const server = app.listen(PORT, () => {
  console.log(`🚀 E2E Test Backend running on http://localhost:${PORT}`);
});

export default app;
