'use strict';
/**
 * Oracle — Wave 6 schema migration safety (reminders / .ics / booking-window
 * policy, audit finding #26).
 *
 * "An existing installation with live bookings must survive the upgrade" —
 * this seeds a database using ONLY the pre-Wave-6 schema (v1 + v2 + v3, the
 * exact SQL that shipped before this wave), inserts live rows by hand the
 * way an old install would have them, then opens it through the current
 * db.js (which runs the v4 migration) and proves:
 *
 *  1. schema_migrations advances to version 4
 *  2. the pre-existing booking row is intact (id/status/visitor/PII/times
 *     byte-identical) — migration is additive ALTER TABLE ADD COLUMN only
 *  3. the pre-existing email outbox row is intact
 *  4. every new column backfills to its documented default on old rows
 *     (min_notice_minutes=0, max_advance_days=NULL, reminder_hours_before=24,
 *     reminder_visitor_enabled=1, reminder_owner_enabled=0,
 *     visitor/owner_reminder_sent_at=NULL, ics_sequence=0,
 *     ics_content/ics_filename=NULL)
 *
 * Run: node --experimental-sqlite bot/test/wave6-calendar-migration.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawnSync } = require('child_process');
    const r = spawnSync(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit' }
    );
    process.exit(r.status == null ? 1 : r.status);
}

const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_SQL_V1, SCHEMA_SQL_V2, SCHEMA_SQL_V3 } = require('../calendar-native/schema');
const { openCalendarDb } = require('../calendar-native/db');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-migration-'));
const dbPath = path.join(tmp, 'old-install.sqlite');

// --- Step 1: build a pre-Wave-6 database by hand (v1 + v2 + v3 only) ---
(function seedOldInstall() {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA_SQL_V1);
    db.exec(SCHEMA_SQL_V2);
    db.exec(SCHEMA_SQL_V3);
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    const ts = '2025-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, ts);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, ts);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, ts);

    db.prepare(
        `INSERT INTO calendar_settings (
            customer_id, site_id, timezone, default_buffer_minutes,
            min_cancel_hours, slot_interval_minutes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('cust_old_A', 'site_old_A', 'Europe/Bucharest', 10, 24, 15, ts, ts);

    db.prepare(
        `INSERT INTO calendar_services (
            id, customer_id, site_id, name, duration_minutes, buffer_minutes,
            active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('svc_old_A', 'cust_old_A', 'site_old_A', 'Consultație veche', 30, 10, 1, 0, ts, ts);

    db.prepare(
        `INSERT INTO calendar_bookings (
            id, customer_id, site_id, service_id, start_utc, end_utc, status,
            visitor_name, visitor_email, visitor_phone, note,
            manage_token_hash, created_at, updated_at, cancelled_at, anonymized_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).run(
        'bk_old_live_001',
        'cust_old_A',
        'site_old_A',
        'svc_old_A',
        '2030-06-02T09:00:00.000Z',
        '2030-06-02T09:30:00.000Z',
        'confirmed',
        'Vizitator Vechi',
        'vizitator.vechi@example.com',
        '0722000000',
        'notă veche',
        'deadbeefdeadbeefdeadbeefdeadbeef',
        ts,
        ts
    );

    db.prepare(
        `INSERT INTO calendar_email_outbox (
            id, customer_id, site_id, booking_id, template_key,
            recipient_email, subject, body_text, body_html, booking_status_snapshot,
            manage_link_present, status, attempt_count, max_attempts, next_attempt_at,
            last_error, provider_name, provider_message_id, idempotency_key,
            created_at, updated_at, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 1, 5, NULL, NULL, ?, ?, ?, ?, ?, ?)`
    ).run(
        'em_old_001',
        'cust_old_A',
        'site_old_A',
        'bk_old_live_001',
        'booking_confirmed',
        'vizitator.vechi@example.com',
        'Programare confirmată — Consultație veche',
        'text vechi',
        '<p>html vechi</p>',
        'confirmed',
        1,
        'local-memory',
        'mem_old_001',
        'calmail:bk_old_live_001:booking_confirmed:confirmed:' + ts,
        ts,
        ts,
        ts
    );

    db.close();
})();

// --- Step 2: open through the CURRENT db.js — this must run the v4 migration ---
const db = openCalendarDb({ dbPath, skipRetentionSweep: true, skipReminderSweep: true });

const migRow = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
assert.strictEqual(Number(migRow.v), 4, 'schema_migrations must advance to 4');

// --- Step 3: the live booking survives, byte-identical on every pre-existing field ---
const booking = db.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_old_live_001');
assert.ok(booking, 'pre-existing booking must survive the migration');
assert.strictEqual(booking.customer_id, 'cust_old_A');
assert.strictEqual(booking.site_id, 'site_old_A');
assert.strictEqual(booking.service_id, 'svc_old_A');
assert.strictEqual(booking.status, 'confirmed');
assert.strictEqual(booking.start_utc, '2030-06-02T09:00:00.000Z');
assert.strictEqual(booking.end_utc, '2030-06-02T09:30:00.000Z');
assert.strictEqual(booking.visitor_name, 'Vizitator Vechi');
assert.strictEqual(booking.visitor_email, 'vizitator.vechi@example.com');
assert.strictEqual(booking.visitor_phone, '0722000000');
assert.strictEqual(booking.note, 'notă veche');
assert.strictEqual(booking.manage_token_hash, 'deadbeefdeadbeefdeadbeefdeadbeef');
assert.strictEqual(booking.anonymized_at, null);

// --- Step 4: new booking columns backfill to documented defaults ---
assert.strictEqual(booking.visitor_reminder_sent_at, null, 'no reminder ever sent for a pre-v4 row');
assert.strictEqual(booking.owner_reminder_sent_at, null);
assert.strictEqual(Number(booking.ics_sequence), 0, 'ics_sequence starts at 0');

// --- Step 5: the old outbox row survives; new ics columns are NULL ---
const outboxRow = db.prepare('SELECT * FROM calendar_email_outbox WHERE id = ?').get('em_old_001');
assert.ok(outboxRow, 'pre-existing outbox row must survive the migration');
assert.strictEqual(outboxRow.status, 'sent');
assert.strictEqual(outboxRow.recipient_email, 'vizitator.vechi@example.com');
assert.strictEqual(outboxRow.ics_content, null);
assert.strictEqual(outboxRow.ics_filename, null);

// --- Step 6: new settings columns backfill to documented defaults ---
const settings = db.prepare(
    'SELECT * FROM calendar_settings WHERE customer_id = ? AND site_id = ?'
).get('cust_old_A', 'site_old_A');
assert.ok(settings);
assert.strictEqual(settings.timezone, 'Europe/Bucharest', 'pre-existing settings field untouched');
assert.strictEqual(Number(settings.default_buffer_minutes), 10, 'pre-existing settings field untouched');
assert.strictEqual(Number(settings.min_notice_minutes), 0, 'min_notice_minutes defaults permissive');
assert.strictEqual(settings.max_advance_days, null, 'max_advance_days defaults to no cap');
assert.strictEqual(Number(settings.reminder_hours_before), 24, 'reminder default interval is 24h');
assert.strictEqual(Number(settings.reminder_visitor_enabled), 1, 'visitor reminder defaults ON');
assert.strictEqual(Number(settings.reminder_owner_enabled), 0, 'owner reminder defaults OFF (optional)');

// --- Step 7: re-opening again is a no-op (idempotent migration) ---
db.close();
const db2 = openCalendarDb({ dbPath, skipRetentionSweep: true, skipReminderSweep: true });
const migRow2 = db2.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
assert.strictEqual(Number(migRow2.v), 4, 'second open must not re-run migrations or fail');
const booking2 = db2.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_old_live_001');
assert.strictEqual(booking2.status, 'confirmed', 'booking still intact after a second open');

db2.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS wave6-calendar-migration (v1-v3 install with live booking survives v4 upgrade)');
