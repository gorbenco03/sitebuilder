'use strict';
/**
 * bot/calendar-native/reminders.js — appointment reminder sweep (VISION §8,
 * audit finding #26: "the single feature that reduces no-shows... the main
 * practical reason people pay for Calendly").
 *
 * Design: this module ONLY decides *when* a reminder becomes due. Delivery
 * itself goes through the EXISTING email outbox (email/outbox.js) — same
 * provider boundary, same exponential backoff, same dead-letter, same audit
 * trail as every other lifecycle email. No second delivery path.
 *
 * Unlike lifecycle email (enqueued synchronously inside engine.js right
 * after a booking mutation commits), reminders are NOT enqueued at booking
 * time — they are found by periodically scanning calendar_bookings for rows
 * that have crossed their fire threshold. This is deliberate: it keeps every
 * pre-existing booking/email oracle byte-for-byte unaffected (nothing new
 * is written to calendar_email_outbox until a sweep actually runs), and it
 * gives the three required hazards a single, simple enforcement point:
 *
 *  1. Cancelled booking sends nothing — the sweep's SELECT only considers
 *     status='confirmed' rows, and fireOneReminder() re-checks status
 *     again inside its own transaction immediately before enqueueing,
 *     closing the gap between "found by the sweep" and "written to the
 *     outbox" (a cancel landing in between is caught).
 *  2. A double run sends once — visitor_reminder_sent_at /
 *     owner_reminder_sent_at are stamped in the SAME BEGIN IMMEDIATE
 *     transaction as the eligibility re-check, so a second sweep (run
 *     back-to-back, or "concurrently") finds the column already set and
 *     skips. The outbox's own UNIQUE(idempotency_key) is a second,
 *     independent backstop against ever double-enqueueing.
 *  3. A worker back after a long outage does not spam past appointments —
 *     the fire condition requires the appointment's start_utc to still be
 *     in the future relative to "now"; once start_utc has passed, the row
 *     permanently stops matching and nothing is ever sent for it.
 *
 * A reschedule resets both *_reminder_sent_at columns to NULL (see
 * engine.js applyReschedule) so the moved appointment earns a fresh
 * reminder for its new time.
 */

function nowIso(ms) {
    return new Date(ms != null ? ms : Date.now()).toISOString();
}

/**
 * Confirmed, still-upcoming bookings whose tenant has at least one reminder
 * kind still outstanding. A bounded, cross-tenant scan — internal
 * housekeeping, not a tenant-facing read (same posture as retention.js).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} nowIsoStr
 */
function candidateRows(db, nowIsoStr) {
    return db.prepare(
        `SELECT b.*,
                s.reminder_hours_before AS reminder_hours_before,
                s.reminder_visitor_enabled AS reminder_visitor_enabled,
                s.reminder_owner_enabled AS reminder_owner_enabled
         FROM calendar_bookings b
         JOIN calendar_settings s
           ON s.customer_id = b.customer_id AND s.site_id = b.site_id
         WHERE b.status = 'confirmed'
           AND b.start_utc > ?
           AND (
                 (b.visitor_reminder_sent_at IS NULL AND s.reminder_visitor_enabled = 1)
              OR (b.owner_reminder_sent_at IS NULL AND s.reminder_owner_enabled = 1)
               )`
    ).all(nowIsoStr);
}

/**
 * Enqueue exactly one reminder (visitor or owner kind) for one booking, iff
 * still eligible at write time. Runs inside its own transaction so two
 * concurrent/duplicate sweeps can never both enqueue for the same booking+kind.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} bookingId
 * @param {'visitor'|'owner'} kind
 * @param {{ nowMs?: number }} [opts]
 * @returns {'sent'|'skipped'}
 */
function fireOneReminder(db, bookingId, kind, { nowMs = Date.now() } = {}) {
    const ts = nowIso(nowMs);
    const sentCol = kind === 'owner' ? 'owner_reminder_sent_at' : 'visitor_reminder_sent_at';
    let toEnqueue = null;

    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = db.prepare(`SELECT * FROM calendar_bookings WHERE id = ?`).get(bookingId);
        if (!row || row.status !== 'confirmed') {
            db.exec('ROLLBACK;');
            return 'skipped';
        }
        if (Date.parse(row.start_utc) <= nowMs) {
            // Appointment itself has already started/passed — never fire late.
            db.exec('ROLLBACK;');
            return 'skipped';
        }
        if (row[sentCol]) {
            db.exec('ROLLBACK;');
            return 'skipped';
        }
        const settings = db.prepare(
            `SELECT * FROM calendar_settings WHERE customer_id = ? AND site_id = ?`
        ).get(row.customer_id, row.site_id);
        if (!settings) {
            db.exec('ROLLBACK;');
            return 'skipped';
        }
        if (kind === 'owner' && !settings.reminder_owner_enabled) {
            db.exec('ROLLBACK;');
            return 'skipped';
        }
        if (kind === 'visitor' && !settings.reminder_visitor_enabled) {
            db.exec('ROLLBACK;');
            return 'skipped';
        }
        db.prepare(`UPDATE calendar_bookings SET ${sentCol} = ? WHERE id = ?`).run(ts, bookingId);
        toEnqueue = { booking: row, settings };
        db.exec('COMMIT;');
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }

    if (!toEnqueue) return 'skipped';

    // Enqueue AFTER commit, same posture as engine.js's emitBookingEmail: the
    // sent_at stamp is authoritative the instant it commits, so a failure
    // here is a lost reminder (visible via missing outbox row), never a
    // duplicate one.
    try {
        const email = require('./email');
        email.enqueueReminderEmail(db, {
            booking: toEnqueue.booking,
            kind,
            nowMs,
        });
    } catch (_) {
        /* best-effort — never let a rendering/enqueue failure propagate */
    }
    return 'sent';
}

/**
 * One sweep pass: find due candidates, fire whichever kinds are due, then
 * drain the outbox once (same delivery pipeline as every other lifecycle
 * email — local/test transport only, no wire send here).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ nowMs?: number }} [opts]
 * @returns {Promise<{ candidates: number, sent: number, skipped: number }>}
 */
async function runReminderSweep(db, { nowMs = Date.now() } = {}) {
    const nowStr = nowIso(nowMs);
    const rows = candidateRows(db, nowStr);
    let sent = 0;
    let skipped = 0;

    for (const row of rows) {
        const hoursBefore = Number(row.reminder_hours_before) || 0;
        const fireAtMs = Date.parse(row.start_utc) - hoursBefore * 3600000;
        if (fireAtMs > nowMs) continue; // not due yet

        if (!row.visitor_reminder_sent_at && row.reminder_visitor_enabled) {
            const r = fireOneReminder(db, row.id, 'visitor', { nowMs });
            if (r === 'sent') sent += 1; else skipped += 1;
        }
        if (!row.owner_reminder_sent_at && row.reminder_owner_enabled) {
            const r = fireOneReminder(db, row.id, 'owner', { nowMs });
            if (r === 'sent') sent += 1; else skipped += 1;
        }
    }

    if (sent > 0) {
        try {
            const email = require('./email');
            await email.processOutbox(db, { nowMs, limit: Math.max(20, sent * 2) });
        } catch (_) {
            /* delivery retry/dead-letter is the outbox's own job */
        }
    }

    return { candidates: rows.length, sent, skipped };
}

const _scheduledDbs = new WeakSet();
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // reminders are time-sensitive; check often

/**
 * Start (once per db handle) a background, unref'd interval that re-runs the
 * sweep periodically. Never blocks the caller and never keeps the process
 * alive — mirrors retention.js startRetentionScheduler exactly.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ intervalMs?: number }} [opts]
 */
function startReminderScheduler(db, { intervalMs = DEFAULT_SWEEP_INTERVAL_MS } = {}) {
    if (!db || _scheduledDbs.has(db)) return;
    _scheduledDbs.add(db);
    const timer = setInterval(() => {
        runReminderSweep(db).catch(() => { /* never take the process down */ });
    }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
}

module.exports = {
    DEFAULT_SWEEP_INTERVAL_MS,
    candidateRows,
    fireOneReminder,
    runReminderSweep,
    startReminderScheduler,
};
