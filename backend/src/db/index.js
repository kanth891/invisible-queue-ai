import pg from 'pg';
const { Pool } = pg;

/**
 * PostgreSQL connection pool.
 * Uses DATABASE_URL from environment variables (Supabase connection string).
 *
 * The pool is created once and reused across the application.
 * Connection parameters are configured via environment variables only.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Log pool errors (don't crash the server)
pool.on('error', (err) => {
  console.error('[ERROR] Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Test the database connection.
 * @returns {Promise<boolean>} true if connection is successful
 */
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() AS current_time');
    client.release();
    console.log('[OK] Database connected at:', result.rows[0].current_time);
    return true;
  } catch (err) {
    console.error('[ERROR] Database connection failed:', err.message);
    return false;
  }
}

export default pool;
