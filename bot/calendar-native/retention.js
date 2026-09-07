'use strict';
/**
 * bot/calendar-native/retention.js — PII retention / GDPR erasure (VISION §8
 * "Date personale — minimizare și retenție").
 *
 * VISION locks two obligations:
 *  1. default retention: bookings kept, then deleted or anonymized ~24 months
 *     after the subscription/site lifecycle ends. This module has no hook
 *     into Stripe/site-deletion events (explicitly out of scope — VISION §8
 *     "Ce NU face acest track": "Stripe/DNS/secrete de producție"), so the
 *     conservative, always-available proxy is the booking's own start_utc:
 *     any booking whose appointment happened more than RETENTION_MONTHS ago
 *     is anonymized regardless of status. This never under-retains relative
 *     to the subscription-based rule (an active subscription's bookings are,
 *     in the overwhelming case, far younger than 24 months) and gives a real,
 *     running implementation instead of a doc-only promise.
 *  2. owner-triggered early deletion ("dreptul la ștergere") — see
 *     eraseBookingPii(), used by owner-api.js.
 *
 * Anonymization keeps the row (history/stat integrity — cancelled_at,
 * start_utc, end_utc, status, service_id, created_at all survive) and scrubs
 * visitor_name / visitor_email / visitor_phone / note. Marking anonymized_at
 * makes every operation here idempotent: a second sweep over the same rows
 * is a no-op (WHERE anonymized_at IS NULL).
 */

const RETENTION_MONTHS = 24;
const DEFAULT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

const ANON_NAME = 'Vizitator anonimizat';
const ANON_EMAIL = 'anonimizat@hidook.invalid';

function nowIso() {
    return new Date().toISOString();
}

/**
 * ISO cutoff: bookings starting before this instant are eligible for anonymization.
 */
function retentionCutoffIso(nowMs, retentionMonths) {
    const d = new Date(nowMs);
    d.setUTCMonth(d.getUTCMonth() - retentionMonths);
    return d.toISOString();
}

/**
 * Idempotent sweep: anonymize every not-yet-anonymized booking whose
 * start_utc is older than the retention cutoff, across all tenants (this is
 * a maintenance job, not a tenant-scoped read/write — VISION §8 access
 * control is about visitor-facing/owner-facing surfaces, not internal
 * housekeeping jobs, and no PII leaves this process).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ nowMs?: number, retentionMonths?: number }} [opts]
 * @returns {{ cutoffIso: string, anonymizedCount: number }}
 */
function runRetentionSweep(db, { nowMs = Date.now(), retentionMonths = RETENTION_MONTHS } = {}) {
    const cutoffIso = retentionCutoffIso(nowMs, retentionMonths);
    const ts = nowIso();
    let anonymizedCount = 0;
    db.exec('BEGIN IMMEDIATE;');
    try {
        const result = db.prepare(
            `UPDATE calendar_bookings
             SET visitor_name = ?, visitor_email = ?, visitor_phone = NULL, note = NULL,
                 anonymized_at = ?, updated_at = ?
             WHERE anonymized_at IS NULL AND start_utc < ?`
        ).run(ANON_NAME, ANON_EMAIL, ts, ts, cutoffIso);
        anonymizedCount = result && typeof result.changes === 'number' ? result.changes : 0;
        db.exec('COMMIT;');
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
    return { cutoffIso, anonymizedCount };
}

/**
 * Owner-triggered early deletion ("dreptul la ștergere", VISION §8) — scrubs
 * one booking's PII immediately regardless of age. Tenant-scoped like every
 * other owner mutation. Idempotent: re-running on an already-anonymized
 * booking is a no-op (still returns the row).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} customerId
 * @param {string} siteId
 * @param {string} bookingId
 * @returns {object|null} updated row, or null if not found for this tenant
 */
function eraseBookingPii(db, customerId, siteId, bookingId) {
    if (!customerId || !siteId || !bookingId) return null;
    const ts = nowIso();
    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = db.prepare(
            `SELECT * FROM calendar_bookings WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).get(bookingId, customerId, siteId);
        if (!row) {
            db.exec('ROLLBACK;');
            return null;
        }
        if (!row.anonymized_at) {
            db.prepare(
                `UPDATE calendar_bookings
                 SET visitor_name = ?, visitor_email = ?, visitor_phone = NULL, note = NULL,
                     anonymized_at = ?, updated_at = ?
                 WHERE id = ? AND customer_id = ? AND site_id = ?`
            ).run(ANON_NAME, ANON_EMAIL, ts, ts, bookingId, customerId, siteId);
        }
        const updated = db.prepare(
            `SELECT * FROM calendar_bookings WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).get(bookingId, customerId, siteId);
        db.exec('COMMIT;');
        return updated;
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
}

/**
 * Every native-calendar table keyed by (customer_id, site_id) — kept as one
 * list so site deletion (eraseSiteTenantData) and any future full-tenant
 * operation cannot silently miss a table added later without updating this.
 * Order does not matter: none of these tables reference each other via a
 * real SQLite foreign key (see bot/calendar-native/db.js — `PRAGMA
 * foreign_keys = ON` guards column-level CHECKs, not cross-table FKs here).
 */
const TENANT_SCOPED_TABLES = Object.freeze([
    'calendar_settings',
    'calendar_services',
    'calendar_resources',
    'calendar_service_resources',
    'calendar_weekly_availability',
    'calendar_date_overrides',
    'calendar_bookings',
    'calendar_email_outbox',
    'calendar_email_audit',
]);

/**
 * Full, permanent erasure of one tenant's native-calendar data — used when
 * the SITE ITSELF is being deleted (bot/server.js's DELETE /api/sites/:id),
 * not the lighter per-booking eraseBookingPii() above (owner-triggered early
 * deletion of one visitor's PII while the site and its calendar stay live).
 *
 * Unlike runRetentionSweep/eraseBookingPii, this DELETEs rows rather than
 * anonymizing them: once the site is gone there is no dashboard left to show
 * "anonymized" history against, so keeping scrubbed rows around would only
 * be dead weight, not a useful audit trail (the site's own deletion is
 * already recorded in the ledger by the caller).
 *
 * Idempotent: a tenant with no rows in any table (never opted into native
 * booking, or already erased) is a silent no-op — never throws "not found".
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} customerId
 * @param {string} siteId
 * @returns {{ deletedCounts: Record<string, number> }}
 */
function eraseSiteTenantData(db, customerId, siteId) {
    const deletedCounts = {};
    if (!db || !customerId || !siteId) return { deletedCounts };
    db.exec('BEGIN IMMEDIATE;');
    try {
        for (const table of TENANT_SCOPED_TABLES) {
            const result = db
                .prepare(`DELETE FROM ${table} WHERE customer_id = ? AND site_id = ?`)
                .run(customerId, siteId);
            deletedCounts[table] = result && typeof result.changes === 'number' ? result.changes : 0;
        }
        db.exec('COMMIT;');
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
    return { deletedCounts };
}

/**
 * Count active (requested/confirmed) bookings for a tenant whose start_utc
 * is still in the future as of `nowMs` — the read side of the "future
 * calendar bookings" delete-refusal rule (bot/server.js's DELETE
 * /api/sites/:id): a visitor who booked and will turn up for it is real, so
 * a site with any such booking must not be deleted out from under them.
 * Past active bookings (already happened, just never got a status update)
 * do not count — nobody is still waiting on those.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} customerId
 * @param {string} siteId
 * @param {number} [nowMs]
 * @returns {number}
 */
function countFutureActiveBookings(db, customerId, siteId, nowMs = Date.now()) {
    if (!db || !customerId || !siteId) return 0;
    const nowIso = new Date(nowMs).toISOString();
    const row = db.prepare(
        `SELECT COUNT(*) AS c FROM calendar_bookings
         WHERE customer_id = ? AND site_id = ?
           AND status IN ('requested', 'confirmed')
           AND start_utc > ?`
    ).get(customerId, siteId, nowIso);
    return row && typeof row.c === 'number' ? row.c : 0;
}

const _scheduledDbs = new WeakSet();

/**
 * Start (once per db handle) a background, unref'd interval that re-runs the
 * sweep periodically. Never blocks the caller: scheduling is synchronous and
 * cheap; the recurring work happens on later event-loop ticks and is
 * unref'd so it can never keep the process alive or delay shutdown/tests.
 * Safe to call multiple times for the same db — a second call is a no-op.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ intervalMs?: number }} [opts]
 */
function startRetentionScheduler(db, { intervalMs = DEFAULT_SWEEP_INTERVAL_MS } = {}) {
    if (!db || _scheduledDbs.has(db)) return;
    _scheduledDbs.add(db);
    const timer = setInterval(() => {
        try { runRetentionSweep(db); } catch (_) { /* never take the process down */ }
    }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
}

module.exports = {
    RETENTION_MONTHS,
    DEFAULT_SWEEP_INTERVAL_MS,
    retentionCutoffIso,
    runRetentionSweep,
    eraseBookingPii,
    TENANT_SCOPED_TABLES,
    eraseSiteTenantData,
    countFutureActiveBookings,
    startRetentionScheduler,
};
