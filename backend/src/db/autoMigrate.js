import pool from './index.js';
import bcrypt from 'bcryptjs';

export async function autoMigrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Ensure all tables exist
    await client.query(`
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

      CREATE TABLE IF NOT EXISTS departments (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL UNIQUE,
        code        VARCHAR(10)  NOT NULL UNIQUE,
        description TEXT,
        status      VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS doctors (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
        specialization  VARCHAR(255),
        status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS patients (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        age        INTEGER NOT NULL CHECK (age > 0 AND age <= 150),
        gender     VARCHAR(20)  NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
        phone      VARCHAR(20)  NOT NULL,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

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

      -- Phase 2 alterations
      ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS queue_access_token VARCHAR(64) UNIQUE;
      ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS queue_access_created_at TIMESTAMPTZ DEFAULT NOW();
      CREATE INDEX IF NOT EXISTS idx_queue_entries_access_token ON queue_entries(queue_access_token);
      
      UPDATE queue_entries 
      SET queue_access_token = md5(random()::text || clock_timestamp()::text || id::text) 
      WHERE queue_access_token IS NULL;
    `);

    // Check if seed users exist
    const userCount = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCount.rows[0].count) === 0) {
      console.log('🌱 Seeding initial hospital data into database...');
      const hash = (pw) => bcrypt.hashSync(pw, 10);
      
      const usersRes = await client.query(`
        INSERT INTO users (name, email, password_hash, role) VALUES
          ('Admin User',       'admin@hospital.com',       $1, 'ADMIN'),
          ('Receptionist One', 'receptionist1@hospital.com', $2, 'RECEPTIONIST'),
          ('Dr. Ravi Kumar',   'dr.ravi@hospital.com',     $3, 'DOCTOR')
        RETURNING id, role, email
      `, [hash('admin123'), hash('recep123'), hash('doctor123')]);

      const deptRes = await client.query(`
        INSERT INTO departments (name, code, description) VALUES
          ('General Medicine', 'GM',  'General medical consultations'),
          ('Cardiology',       'CAR', 'Heart and cardiovascular care'),
          ('Pediatrics',       'PED', 'Children healthcare')
        RETURNING id, code
      `);

      const drRavi = usersRes.rows.find(u => u.email === 'dr.ravi@hospital.com');
      const gmDept = deptRes.rows.find(d => d.code === 'GM');

      await client.query(`
        INSERT INTO doctors (user_id, department_id, specialization)
        VALUES ($1, $2, 'General Physician')
      `, [drRavi.id, gmDept.id]);

      console.log('✅ Initial hospital data seeded successfully');
    }

    await client.query('COMMIT');
    console.log('✅ Database schema verified & ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('AutoMigrate error:', err.message);
  } finally {
    client.release();
  }
}
