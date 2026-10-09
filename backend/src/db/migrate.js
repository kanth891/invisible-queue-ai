import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

// ── Schema ─────────────────────────────────────────
const SCHEMA_SQL = `
-- ── ENUM-like check constraints via domain types ───

-- ── Users Table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('ADMIN', 'RECEPTIONIST', 'DOCTOR')),
  status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Departments Table ──────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL UNIQUE,
  code        VARCHAR(10)  NOT NULL UNIQUE,
  description TEXT,
  status      VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Doctors Table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  specialization  VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Patients Table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  age        INTEGER NOT NULL CHECK (age > 0 AND age <= 150),
  gender     VARCHAR(20)  NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  phone      VARCHAR(20)  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Queue Entries Table ────────────────────────────
CREATE TABLE IF NOT EXISTS queue_entries (
  id                        SERIAL PRIMARY KEY,
  patient_id                INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id                 INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  department_id             INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  token_number              VARCHAR(20)  NOT NULL,
  queue_access_token        VARCHAR(64)  UNIQUE,
  queue_access_created_at   TIMESTAMPTZ  DEFAULT NOW(),
  queue_date                DATE         NOT NULL DEFAULT CURRENT_DATE,
  status                    VARCHAR(20)  NOT NULL DEFAULT 'WAITING'
                            CHECK (status IN ('WAITING','CALLED','IN_CONSULTATION','COMPLETED','CANCELLED','NO_SHOW')),
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  called_at                 TIMESTAMPTZ,
  consultation_started_at   TIMESTAMPTZ,
  consultation_completed_at TIMESTAMPTZ
);

-- ── Phase 2: Virtual Queue Migration Alterations ───
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS queue_access_token VARCHAR(64) UNIQUE;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS queue_access_created_at TIMESTAMPTZ DEFAULT NOW();

-- Phase 4 Real-Time Intelligent Queue Columns & Notification Tracking
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS actual_wait_minutes NUMERIC(5, 1);
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS consultation_duration_minutes NUMERIC(5, 1);
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS prediction_error_minutes NUMERIC(5, 1);
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS approaching_notified_at TIMESTAMPTZ;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS turn_notified_at TIMESTAMPTZ;

-- Backfill any existing queue entries without an access token
UPDATE queue_entries
SET queue_access_token = md5(random()::text || clock_timestamp()::text || id::text)
WHERE queue_access_token IS NULL;

-- Advanced Queue Operations & Doctor Availability Management
ALTER TABLE queue_entries DROP CONSTRAINT IF EXISTS queue_entries_status_check;
ALTER TABLE queue_entries ADD CONSTRAINT queue_entries_status_check
  CHECK (status IN ('WAITING', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'MISSED'));

ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS missed_at TIMESTAMPTZ;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS rejoin_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS reschedule_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS transferred_from_doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

ALTER TABLE doctors ADD COLUMN IF NOT EXISTS room_number VARCHAR(50);
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS operational_status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
  CHECK (operational_status IN ('AVAILABLE', 'PAUSED', 'ON_LEAVE'));
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS pause_reason TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS daily_capacity INTEGER DEFAULT 30;

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description)
VALUES
  ('missed_grace_period_minutes', '5'::jsonb, 'Minutes after being called before a patient token is marked as missed'),
  ('max_rejoins', '2'::jsonb, 'Maximum number of times a missed patient can rejoin the queue'),
  ('max_reschedules', '2'::jsonb, 'Maximum number of same-day queue reschedules permitted'),
  ('default_queue_capacity', '30'::jsonb, 'Maximum active patient tokens allowed per doctor queue per day'),
  ('operating_hours', '{"start": "08:00", "end": "18:00"}'::jsonb, 'Hospital standard daily operating hours')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS doctor_schedules (
  id SERIAL PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL DEFAULT '09:00:00',
  end_time TIME NOT NULL DEFAULT '17:00:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(doctor_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS doctor_leaves (
  id SERIAL PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  leave_date DATE NOT NULL,
  leave_type VARCHAR(20) NOT NULL DEFAULT 'FULL_DAY' CHECK (leave_type IN ('FULL_DAY', 'PARTIAL')),
  start_time TIME,
  end_time TIME,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doctor_leaves_doc_date ON doctor_leaves(doctor_id, leave_date);

CREATE TABLE IF NOT EXISTS queue_events (
  id SERIAL PRIMARY KEY,
  queue_entry_id INTEGER NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_queue_events_entry ON queue_events(queue_entry_id);
CREATE INDEX IF NOT EXISTS idx_queue_events_type ON queue_events(event_type);
CREATE INDEX IF NOT EXISTS idx_queue_events_created_at ON queue_events(created_at);

-- ── Indexes ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_queue_entries_doctor_date    ON queue_entries(doctor_id, queue_date);
CREATE INDEX IF NOT EXISTS idx_queue_entries_department_date ON queue_entries(department_id, queue_date);
CREATE INDEX IF NOT EXISTS idx_queue_entries_status         ON queue_entries(status);
CREATE INDEX IF NOT EXISTS idx_queue_entries_status_date    ON queue_entries(status, queue_date);
CREATE INDEX IF NOT EXISTS idx_queue_entries_token          ON queue_entries(token_number, queue_date);
CREATE INDEX IF NOT EXISTS idx_queue_entries_access_token   ON queue_entries(queue_access_token);
CREATE INDEX IF NOT EXISTS idx_doctors_department           ON doctors(department_id);
CREATE INDEX IF NOT EXISTS idx_users_email                  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role                   ON users(role);

-- ── Updated-at trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
    CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_departments_updated_at') THEN
    CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_doctors_updated_at') THEN
    CREATE TRIGGER update_doctors_updated_at BEFORE UPDATE ON doctors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_patients_updated_at') THEN
    CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
`;

// ── Seed Data ──────────────────────────────────────
async function seed(client) {
  // Check if seed data already exists
  const existing = await client.query('SELECT COUNT(*) FROM users');
  if (parseInt(existing.rows[0].count) > 0) {
    console.log('⏭️  Seed data already exists, skipping seed.');
    return;
  }

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  // ── Users ──────────────────────────────────────
  const usersResult = await client.query(`
    INSERT INTO users (name, email, password_hash, role) VALUES
      ('Admin User',       'admin@hospital.com',       $1, 'ADMIN'),
      ('Receptionist One', 'receptionist1@hospital.com', $2, 'RECEPTIONIST'),
      ('Receptionist Two', 'receptionist2@hospital.com', $3, 'RECEPTIONIST'),
      ('Dr. Ravi Kumar',   'dr.ravi@hospital.com',     $4, 'DOCTOR'),
      ('Dr. Priya Sharma', 'dr.priya@hospital.com',    $5, 'DOCTOR'),
      ('Dr. Anil Mehta',   'dr.anil@hospital.com',     $6, 'DOCTOR'),
      ('Dr. Sunita Reddy', 'dr.sunita@hospital.com',   $7, 'DOCTOR')
    RETURNING id, role, email
  `, [
    hash('admin123'),
    hash('recep123'),
    hash('recep123'),
    hash('doctor123'),
    hash('doctor123'),
    hash('doctor123'),
    hash('doctor123'),
  ]);

  console.log('[OK] Users seeded');

  // ── Departments ────────────────────────────────
  const deptResult = await client.query(`
    INSERT INTO departments (name, code, description) VALUES
      ('General Medicine', 'GM',  'General medical consultations and check-ups'),
      ('Cardiology',       'CAR', 'Heart and cardiovascular system treatments'),
      ('Pediatrics',       'PED', 'Medical care for infants, children, and adolescents'),
      ('Orthopedics',      'ORT', 'Musculoskeletal system: bones, joints, muscles')
    RETURNING id, name, code
  `);

  console.log('[OK] Departments seeded');

  // Map user IDs by email
  const userMap = {};
  usersResult.rows.forEach(u => { userMap[u.email] = u.id; });
  // Map department IDs by code
  const deptMap = {};
  deptResult.rows.forEach(d => { deptMap[d.code] = d.id; });

  // ── Doctors ────────────────────────────────────
  const doctorResult = await client.query(`
    INSERT INTO doctors (user_id, department_id, specialization) VALUES
      ($1, $5, 'General Physician'),
      ($2, $6, 'Cardiologist'),
      ($3, $7, 'Pediatrician'),
      ($4, $8, 'Orthopedic Surgeon')
    RETURNING id
  `, [
    userMap['dr.ravi@hospital.com'],
    userMap['dr.priya@hospital.com'],
    userMap['dr.anil@hospital.com'],
    userMap['dr.sunita@hospital.com'],
    deptMap['GM'],
    deptMap['CAR'],
    deptMap['PED'],
    deptMap['ORT'],
  ]);

  console.log('[OK] Doctors seeded');

  // ── Patients ───────────────────────────────────
  const patientResult = await client.query(`
    INSERT INTO patients (name, age, gender, phone) VALUES
      ('Rahul Verma',    28, 'MALE',   '9876543210'),
      ('Anil Singh',     45, 'MALE',   '9876543211'),
      ('Priya Patel',    32, 'FEMALE', '9876543212'),
      ('Sunita Devi',    55, 'FEMALE', '9876543213'),
      ('Vikram Rao',     38, 'MALE',   '9876543214'),
      ('Meena Kumari',   29, 'FEMALE', '9876543215'),
      ('Rajesh Gupta',   60, 'MALE',   '9876543216'),
      ('Kavita Sharma',  25, 'FEMALE', '9876543217'),
      ('Deepak Joshi',   42, 'MALE',   '9876543218'),
      ('Anita Mishra',   35, 'FEMALE', '9876543219')
    RETURNING id
  `);

  console.log('[OK] Patients seeded');

  // ── Queue Entries (demo data for today) ────────
  const doctorIds = doctorResult.rows.map(d => d.id);
  const patientIds = patientResult.rows.map(p => p.id);

  const now = new Date();
  const baseTime = new Date(now);
  baseTime.setHours(9, 0, 0, 0);

  const t = (mins) => new Date(baseTime.getTime() + mins * 60000);

  // Insert queue entries one by one for clarity
  const queueData = [
    { pid: patientIds[0], did: doctorIds[0], depId: deptMap['GM'],  token: 'GM-001',  status: 'COMPLETED',       createdAt: t(0),  calledAt: t(2),  startedAt: t(3),  completedAt: t(18) },
    { pid: patientIds[1], did: doctorIds[0], depId: deptMap['GM'],  token: 'GM-002',  status: 'COMPLETED',       createdAt: t(5),  calledAt: t(20), startedAt: t(21), completedAt: t(35) },
    { pid: patientIds[2], did: doctorIds[0], depId: deptMap['GM'],  token: 'GM-003',  status: 'IN_CONSULTATION', createdAt: t(10), calledAt: t(36), startedAt: t(37), completedAt: null },
    { pid: patientIds[3], did: doctorIds[0], depId: deptMap['GM'],  token: 'GM-004',  status: 'WAITING',         createdAt: t(15), calledAt: null,  startedAt: null,  completedAt: null },
    { pid: patientIds[5], did: doctorIds[1], depId: deptMap['CAR'], token: 'CAR-001', status: 'COMPLETED',       createdAt: t(0),  calledAt: t(3),  startedAt: t(4),  completedAt: t(20) },
    { pid: patientIds[6], did: doctorIds[1], depId: deptMap['CAR'], token: 'CAR-002', status: 'WAITING',         createdAt: t(10), calledAt: null,  startedAt: null,  completedAt: null },
    { pid: patientIds[7], did: doctorIds[2], depId: deptMap['PED'], token: 'PED-001', status: 'WAITING',         createdAt: t(5),  calledAt: null,  startedAt: null,  completedAt: null },
    { pid: patientIds[4], did: doctorIds[2], depId: deptMap['PED'], token: 'PED-002', status: 'CALLED',          createdAt: t(12), calledAt: t(40), startedAt: null,  completedAt: null },
    { pid: patientIds[8], did: doctorIds[3], depId: deptMap['ORT'], token: 'ORT-001', status: 'COMPLETED',       createdAt: t(0),  calledAt: t(2),  startedAt: t(3),  completedAt: t(15) },
    { pid: patientIds[9], did: doctorIds[3], depId: deptMap['ORT'], token: 'ORT-002', status: 'WAITING',         createdAt: t(8),  calledAt: null,  startedAt: null,  completedAt: null },
  ];

  for (const q of queueData) {
    const accessToken = 'demo_' + q.token.toLowerCase().replace('-', '_') + '_' + Math.random().toString(36).substring(2, 10);
    await client.query(`
      INSERT INTO queue_entries (patient_id, doctor_id, department_id, token_number, queue_access_token, status, created_at, called_at, consultation_started_at, consultation_completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [q.pid, q.did, q.depId, q.token, accessToken, q.status, q.createdAt, q.calledAt, q.startedAt, q.completedAt]);
  }

  console.log('[OK] Queue entries seeded');
}

// ── Run Migration ──────────────────────────────────
async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[START] Running Phase 1 database migration...\n');

    await client.query('BEGIN');
    await client.query(SCHEMA_SQL);
    console.log('[OK] Schema created successfully\n');

    await seed(client);
    await client.query('COMMIT');

    console.log('\n[OK] Migration complete!');
    console.log('\n[CREDENTIALS] Demo Credentials:');
    console.log('   Admin:        admin@hospital.com        / admin123');
    console.log('   Receptionist: receptionist1@hospital.com / recep123');
    console.log('   Doctor:       dr.ravi@hospital.com      / doctor123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ERROR] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
