import pool from '../db/index.js';
import { getSetting } from './settingsService.js';
import { logQueueEvent, QUEUE_EVENT_TYPES } from './queueAuditService.js';
import {
  emitToPatient,
  emitToDoctor,
  emitToDepartment,
  emitToAdmin,
  broadcastQueueUpdate,
  SOCKET_EVENTS,
} from '../socket/index.js';

let workerIntervalId = null;

/**
 * Reconcile a single queue entry if its grace period has elapsed.
 * Returns the updated entry if transitioned, or original entry if not.
 */
export async function checkAndReconcileSingleEntry(entry, customGraceMinutes = null) {
  if (!entry || entry.status !== 'CALLED' || !entry.called_at) {
    return entry;
  }

  const graceMinutes = customGraceMinutes !== null
    ? customGraceMinutes
    : await getSetting('missed_grace_period_minutes');

  const calledTime = new Date(entry.called_at).getTime();
  const deadline = calledTime + (graceMinutes * 60 * 1000);
  const now = Date.now();

  if (now >= deadline) {
    try {
      const updateRes = await pool.query(
        `UPDATE queue_entries
         SET status = 'MISSED', missed_at = NOW()
         WHERE id = $1 AND status = 'CALLED'
         RETURNING *`,
        [entry.id]
      );

      if (updateRes.rows.length > 0) {
        const updated = updateRes.rows[0];

        // Audit log
        await logQueueEvent(pool, {
          queueEntryId: updated.id,
          eventType: QUEUE_EVENT_TYPES.MISSED,
          actorType: 'SYSTEM',
          details: {
            token: updated.token_number,
            called_at: updated.called_at,
            missed_at: updated.missed_at,
            grace_period_minutes: graceMinutes,
          },
        });

        // Real-time broadcast
        const eventName = SOCKET_EVENTS.PATIENT_MISSED || 'queue.patient_missed';
        const payload = {
          token: updated.token_number,
          status: 'MISSED',
          message: 'You were not present when your token was called. You may rejoin the queue.',
          missedAt: updated.missed_at,
          rejoinCount: updated.rejoin_count || 0,
        };

        if (updated.queue_access_token) {
          emitToPatient(updated.queue_access_token, eventName, payload);
        }
        if (updated.doctor_id) {
          emitToDoctor(updated.doctor_id, eventName, payload);
        }
        if (updated.department_id) {
          emitToDepartment(updated.department_id, eventName, payload);
        }
        emitToAdmin(eventName, payload);

        return { ...entry, ...updated, status: 'MISSED' };
      }
    } catch (err) {
      console.error('[MissedTokenReconciler] Single entry reconcile error:', err);
    }
  }

  return entry;
}

/**
 * Scan database for all CALLED tokens that have exceeded the grace period.
 * Backend-authoritative: runs even if no client browser is open.
 */
export async function reconcileMissedTokens() {
  try {
    if (!pool || !pool.query) return [];

    const graceMinutes = await getSetting('missed_grace_period_minutes');
    const today = new Date().toISOString().split('T')[0];

    // Find all CALLED entries whose called_at + grace_minutes < NOW()
    const query = `
      SELECT qe.*, u.name as doctor_name, dep.name as department_name
      FROM queue_entries qe
      JOIN doctors d ON qe.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN departments dep ON qe.department_id = dep.id
      WHERE qe.status = 'CALLED'
        AND qe.queue_date = $1
        AND qe.called_at IS NOT NULL
        AND qe.called_at + ($2 || ' minutes')::interval <= NOW()
    `;

    const candidates = await pool.query(query, [today, String(graceMinutes)]);
    if (candidates.rows.length === 0) return [];

    const reconciled = [];

    for (const cand of candidates.rows) {
      const updated = await checkAndReconcileSingleEntry(cand, graceMinutes);
      if (updated.status === 'MISSED') {
        reconciled.push(updated);
      }
    }

    if (reconciled.length > 0) {
      console.log(`[MissedTokenReconciler] Reconciled ${reconciled.length} missed token(s) (Grace period: ${graceMinutes}m)`);
    }

    return reconciled;
  } catch (err) {
    console.error('[MissedTokenReconciler] Error during reconciliation:', err.message);
    return [];
  }
}

/**
 * Start periodic background worker for authoritative missed token detection.
 */
export function startMissedTokenWorker(intervalMs = 10000) {
  if (workerIntervalId) return;

  // Run initial scan
  reconcileMissedTokens();

  workerIntervalId = setInterval(() => {
    reconcileMissedTokens();
  }, intervalMs);

  console.log(`[MissedTokenReconciler] Background worker started (Interval: ${intervalMs}ms)`);
}

/**
 * Stop background worker.
 */
export function stopMissedTokenWorker() {
  if (workerIntervalId) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
    console.log('[MissedTokenReconciler] Background worker stopped');
  }
}
