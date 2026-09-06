'use strict';
/**
 * bot/calendar-native/db.js — SQLite handle for native Hidook calendar.
 *
 * System of record is relational SQLite (Node built-in `node:sqlite`, flag
 * `--experimental-sqlite`). Not JSON files. Path defaults under DATA_DIR.
 *
 * VISION.md §8 — tenant key = customer_id + site_id.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    SCHEMA_SQL,
    SCHEMA_SQL_V1,
    SCHEMA_SQL_V2,
    SCHEMA_SQL_V3,
    SCHEMA_SQL_V4,
    SCHEMA_SQL_V5,
    SCHEMA_VERSION,
} = require('./schema');

function loadSqlite() {
    try {
        return require('node:sqlite');
    } catch (e) {
        const err = new Error(
            'Native calendar requires Node.js with node:sqlite (run with --experimental-sqlite on Node 22.5+).'
        );
        err.cause = e;
        throw err;
    }
}

/**
 * @param {{ dbPath?: string, dataDir?: string }} [opts]
 * @returns {import('node:sqlite').DatabaseSync}
 */
function openCalendarDb(opts = {}) {
    const { DatabaseSync } = loadSqlite();
    let dbPath = opts.dbPath;
    if (!dbPath) {
        const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..');
        fs.mkdirSync(dataDir, { recursive: true });
        dbPath = path.join(dataDir, 'calendar-native.sqlite');
    }
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA journal_mode = WAL;');
    // Wave 7 (audit #25): resource-scoped booking now gets exercised by
    // genuinely concurrent OS-level connections (multiple worker threads /
    // processes sharing one sqlite file — e.g. bot/test/wave7-calendar-
    // resources-concurrency.test.js), not just one process's single-threaded
    // JS. Without a busy timeout, a second connection's BEGIN IMMEDIATE would
    // fail immediately with SQLITE_BUSY instead of waiting for the first
    // writer's commit — a driver-level footgun, not a change to the
    // BEGIN IMMEDIATE + partial UNIQUE index locking design itself (untouched
    // per the architecture-preservation rule). 5s is generous for a single
    // short transaction and harmless for the existing single-process default.
    db.exec('PRAGMA busy_timeout = 5000;');
    migrate(db);

    // VISION §8 PII retention: idempotent, self-contained, never blocks
    // startup — one synchronous no-op-safe sweep now (usually anonymizes
    // nothing since normal bookings are recent), then an unref'd periodic
    // re-sweep. Any failure here must never take the server down.
    if (opts.skipRetentionSweep !== true) {
        try {
            const retention = require('./retention');
            retention.runRetentionSweep(db);
            retention.startRetentionScheduler(db);
        } catch (_) {
            /* PII retention is best-effort housekeeping, not a startup gate */
        }
    }

    // Wave 6 — appointment reminders (audit finding #26): same lifecycle as
    // PII retention above. The initial sweep runs synchronously against the
    // real clock, which is harmless at process start (no confirmed booking
    // is ever due for a reminder in the same instant its own tenant row is
    // first created), then an unref'd periodic re-sweep keeps firing while
    // the process is up. Never a startup gate — never take the server down.
    if (opts.skipReminderSweep !== true) {
        try {
            const reminders = require('./reminders');
            reminders.runReminderSweep(db).catch(() => { /* see policy above */ });
            reminders.startReminderScheduler(db);
        } catch (_) {
            /* reminder scheduling is best-effort housekeeping, not a startup gate */
        }
    }

    return db;
}

/** @param {import('node:sqlite').DatabaseSync} db */
function migrate(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    let current = row && row.v != null ? Number(row.v) : 0;
    const ts = new Date().toISOString();

    if (current < 1) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL_V1);
            db.prepare(
                'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(1, ts);
            db.exec('COMMIT;');
            current = 1;
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    if (current < 2) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL_V2);
            db.prepare(
                'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(2, ts);
            db.exec('COMMIT;');
            current = 2;
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    if (current < 3) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL_V3);
            db.prepare(
                'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(3, ts);
            db.exec('COMMIT;');
            current = 3;
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    if (current < 4) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL_V4);
            db.prepare(
                'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(4, ts);
            db.exec('COMMIT;');
            current = 4;
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    if (current < 5) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL_V5);
            backfillResourcesV5(db);
            db.prepare(
                'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(5, ts);
            db.exec('COMMIT;');
            current = 5;
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    // Safety: brand-new paths that somehow skipped stepwise still get full schema.
    if (current < SCHEMA_VERSION) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL);
            db.prepare(
                'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(SCHEMA_VERSION, ts);
            db.exec('COMMIT;');
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }
}

/**
 * v5 data backfill (Wave 7, audit #25): give every tenant that has ANY
 * pre-existing row an implicit default resource, then point every
 * pre-v5 weekly-availability / date-override / booking row at it, and tie
 * every pre-existing service explicitly to it (so a resource added later
 * never silently inherits old services — see schema.js v5 doc comment).
 * Runs inside the same BEGIN IMMEDIATE transaction as the v5 DDL, so a
 * failure here rolls back the whole migration step, never a half-applied
 * schema. Idempotent (INSERT OR IGNORE, resource_id IS NULL guards).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function backfillResourcesV5(db) {
    const ts = new Date().toISOString();
    const tenants = db.prepare(`
        SELECT customer_id, site_id FROM calendar_settings
        UNION SELECT customer_id, site_id FROM calendar_services
        UNION SELECT customer_id, site_id FROM calendar_weekly_availability
        UNION SELECT customer_id, site_id FROM calendar_date_overrides
        UNION SELECT customer_id, site_id FROM calendar_bookings
    `).all();

    for (const t of tenants) {
        const customerId = t.customer_id;
        const siteId = t.site_id;

        let candidateId = 'res_default__' + customerId + '__' + siteId;
        if (candidateId.length > 120) {
            candidateId = 'res_default__' + crypto
                .createHash('sha1')
                .update(customerId + '::' + siteId, 'utf8')
                .digest('hex');
        }

        db.prepare(
            `INSERT OR IGNORE INTO calendar_resources
                (id, customer_id, site_id, name, active, sort_order, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, 0, 1, ?, ?)`
        ).run(candidateId, customerId, siteId, 'Personal implicit', ts, ts);

        const defaultRow = db.prepare(
            `SELECT id FROM calendar_resources WHERE customer_id = ? AND site_id = ? AND is_default = 1`
        ).get(customerId, siteId);
        const defaultId = defaultRow ? defaultRow.id : candidateId;

        db.prepare(
            `UPDATE calendar_weekly_availability SET resource_id = ?
             WHERE customer_id = ? AND site_id = ? AND resource_id IS NULL`
        ).run(defaultId, customerId, siteId);

        db.prepare(
            `UPDATE calendar_date_overrides SET resource_id = ?
             WHERE customer_id = ? AND site_id = ? AND resource_id IS NULL`
        ).run(defaultId, customerId, siteId);

        db.prepare(
            `UPDATE calendar_bookings SET resource_id = ?
             WHERE customer_id = ? AND site_id = ? AND resource_id IS NULL`
        ).run(defaultId, customerId, siteId);

        const services = db.prepare(
            `SELECT id FROM calendar_services WHERE customer_id = ? AND site_id = ?`
        ).all(customerId, siteId);
        for (const svc of services) {
            db.prepare(
                `INSERT OR IGNORE INTO calendar_service_resources
                    (customer_id, site_id, service_id, resource_id, created_at)
                 VALUES (?, ?, ?, ?, ?)`
            ).run(customerId, siteId, svc.id, defaultId, ts);
        }
    }
}

module.exports = {
    openCalendarDb,
    loadSqlite,
    SCHEMA_VERSION,
    migrate,
    backfillResourcesV5,
};
