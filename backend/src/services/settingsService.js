import pool from '../db/index.js';

let settingsCache = {};
let lastFetchTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

export const DEFAULT_SETTINGS = {
  missed_grace_period_minutes: 5,
  max_rejoins: 2,
  max_reschedules: 2,
  default_queue_capacity: 30,
  operating_hours: { start: '08:00', end: '18:00' },
};

/**
 * Fetch all system settings from PostgreSQL, falling back to defaults.
 */
export async function getAllSettings(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && Object.keys(settingsCache).length > 0 && now - lastFetchTime < CACHE_TTL_MS) {
    return { ...DEFAULT_SETTINGS, ...settingsCache };
  }

  try {
    if (!pool || !pool.query) return DEFAULT_SETTINGS;
    const result = await pool.query('SELECT key, value FROM system_settings');
    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    }
    settingsCache = settings;
    lastFetchTime = now;
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (err) {
    console.warn('[SettingsService] Failed to load settings from DB, using defaults:', err.message);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Get a single setting value.
 */
export async function getSetting(key) {
  const all = await getAllSettings();
  return all[key] !== undefined ? all[key] : DEFAULT_SETTINGS[key];
}

/**
 * Update system settings with validation.
 */
export async function updateSettings(updates, actorId = null) {
  const validated = {};

  if (updates.missed_grace_period_minutes !== undefined) {
    const val = Number(updates.missed_grace_period_minutes);
    if (!Number.isInteger(val) || val < 1 || val > 60) {
      throw new Error('missed_grace_period_minutes must be an integer between 1 and 60');
    }
    validated.missed_grace_period_minutes = val;
  }

  if (updates.max_rejoins !== undefined) {
    const val = Number(updates.max_rejoins);
    if (!Number.isInteger(val) || val < 0 || val > 10) {
      throw new Error('max_rejoins must be an integer between 0 and 10');
    }
    validated.max_rejoins = val;
  }

  if (updates.max_reschedules !== undefined) {
    const val = Number(updates.max_reschedules);
    if (!Number.isInteger(val) || val < 0 || val > 10) {
      throw new Error('max_reschedules must be an integer between 0 and 10');
    }
    validated.max_reschedules = val;
  }

  if (updates.default_queue_capacity !== undefined) {
    const val = Number(updates.default_queue_capacity);
    if (!Number.isInteger(val) || val < 1 || val > 200) {
      throw new Error('default_queue_capacity must be an integer between 1 and 200');
    }
    validated.default_queue_capacity = val;
  }

  if (updates.operating_hours !== undefined) {
    const { start, end } = updates.operating_hours || {};
    if (!start || !end || typeof start !== 'string' || typeof end !== 'string') {
      throw new Error('operating_hours must contain valid start and end strings in HH:MM format');
    }
    validated.operating_hours = { start, end };
  }

  if (Object.keys(validated).length === 0) {
    throw new Error('No valid settings provided for update');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(validated)) {
      await client.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }
    await client.query('COMMIT');

    // Invalidate cache
    lastFetchTime = 0;
    return await getAllSettings(true);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
