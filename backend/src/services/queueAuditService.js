import pool from '../db/index.js';

export const QUEUE_EVENT_TYPES = {
  QUEUE_CREATED: 'QUEUE_CREATED',
  CALLED: 'CALLED',
  MISSED: 'MISSED',
  REJOINED: 'REJOINED',
  RESCHEDULED: 'RESCHEDULED',
  CANCELLED: 'CANCELLED',
  CONSULTATION_STARTED: 'CONSULTATION_STARTED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  QUEUE_TRANSFERRED: 'QUEUE_TRANSFERRED',
  QUEUE_PAUSED: 'QUEUE_PAUSED',
  QUEUE_RESUMED: 'QUEUE_RESUMED',
  DOCTOR_UNAVAILABLE: 'DOCTOR_UNAVAILABLE',
};

/**
 * Log a structured queue event into the database audit log.
 */
export async function logQueueEvent(clientOrPool, {
  queueEntryId,
  eventType,
  actorType = 'SYSTEM',
  actorId = null,
  details = {},
}) {
  try {
    const db = clientOrPool || pool;
    if (!db || !db.query) return;

    await db.query(
      `INSERT INTO queue_events (queue_entry_id, event_type, actor_type, actor_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
      [
        queueEntryId,
        eventType,
        actorType,
        actorId,
        JSON.stringify(details || {}),
      ]
    );
  } catch (err) {
    console.warn('[QueueAuditService] Failed to log queue event:', err.message);
  }
}

/**
 * Retrieve recent queue events for an entry or the entire hospital system.
 */
export async function getQueueEvents({ queueEntryId = null, limit = 50, offset = 0 } = {}) {
  try {
    if (!pool || !pool.query) return [];

    let query = `
      SELECT qe_ev.*,
             qe.token_number, qe.status as current_status,
             p.name as patient_name,
             u.name as doctor_name,
             d.specialization,
             dep.name as department_name
      FROM queue_events qe_ev
      JOIN queue_entries qe ON qe_ev.queue_entry_id = qe.id
      JOIN patients p ON qe.patient_id = p.id
      JOIN doctors d ON qe.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN departments dep ON qe.department_id = dep.id
    `;
    const params = [];

    if (queueEntryId) {
      params.push(queueEntryId);
      query += ` WHERE qe_ev.queue_entry_id = $${params.length}`;
    }

    query += ` ORDER BY qe_ev.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    console.error('[QueueAuditService] Failed to get queue events:', err);
    return [];
  }
}
