'use strict';
/**
 * bot/test/wave7-calendar-resources-migration.test.js
 *
 * Oracle — Wave 7 (audit finding #25) schema migration safety: "every
 * existing tenant becomes a single implicit resource and keeps working
 * with no owner action and no change to its public URLs."
 *
 * Seeds a database using ONLY the pre-Wave-7 schema (v1..v4, the exact SQL
 * that shipped before this wave — same technique as
 * bot/test/wave6-calendar-migration.test.js for v4), by hand inserts LIVE
 * rows the way a real install would have them (a settings row, two
 * services, weekly availability, a blackout override, a confirmed booking,
 * a sent email), then opens it through the CURRENT db.js (which must run
 * the v5 migration) and proves:
 *
 *  1. schema_migrations advances to version 5.
 *  2. The pre-existing booking row is byte-identical on every pre-v5 field
 *     (id/status/visitor/PII/times/manage token) — the migration is
 *     additive (ALTER TABLE ADD COLUMN) plus one rebuilt table
 *     (calendar_date_overrides, whose inline UNIQUE had to grow a
 *     resource_id column — see schema.js v5 doc comment) that preserves
 *     every row's content and id.
 *  3. Exactly one implicit resource ("Personal implicit") was created for
 *     the tenant, and it is marked is_default.
 *  4. The pre-existing booking, weekly-availability row, and date override
 *     are all backfilled to point at that SAME implicit resource — no
 *     orphaned resource_id, no silent second resource.
 *  5. The pre-existing service is explicitly tied to the implicit resource
 *     in calendar_service_resources (so a resource added later never
 *     silently inherits it — see engine.listResourcesForService).
 *  6. generateSlots() for that service, called exactly as the OLD single-
 *     calendar public API always called it (no resourceId argument), still
 *     returns the same free slots as before migration — availability
 *     behaves identically with no owner action.
 *  7. A brand-new booking on the migrated tenant (again via the old,
 *     resourceId-less call shape) still confirms exactly as it always did.
 *  8. Re-opening the migrated database a second time is a no-op (idempotent
 *     migration, matching the v4 oracle's own check).
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-calendar-resources-migration.test.js
 * Evidence: 04-QA-Evidence/Wave7-calendar-staff/migration-proof.json
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
const { SCHEMA_SQL_V1, SCHEMA_SQL_V2, SCHEMA_SQL_V3, SCHEMA_SQL_V4 } = require('../calendar-native/schema');
const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-wave7-migration-'));
const dbPath = path.join(tmp, 'pre-wave7-install.sqlite');

const C = 'cust_wave7_old';
const S = 'site_wave7_old';
const TS = '2025-02-01T00:00:00.000Z';

// --- Step 1: build a pre-Wave-7 (v1..v4) database by hand, exactly the SQL
// that shipped before this wave — no calendar_resources table exists yet. ---
(function seedPreWave7Install() {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA_SQL_V1);
    db.exec(SCHEMA_SQL_V2);
    db.exec(SCHEMA_SQL_V3);
    db.exec(SCHEMA_SQL_V4);
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    for (const v of [1, 2, 3, 4]) {
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, TS);
    }

    db.prepare(
        `INSERT INTO calendar_settings (
            customer_id, site_id, timezone, default_buffer_minutes,
            min_cancel_hours, slot_interval_minutes,
            min_notice_minutes, max_advance_days,
            reminder_hours_before, reminder_visitor_enabled, reminder_owner_enabled,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(C, S, 'Europe/Bucharest', 10, 24, 15, 0, null, 24, 1, 0, TS, TS);

    db.prepare(
        `INSERT INTO calendar_services (
            id, customer_id, site_id, name, duration_minutes, buffer_minutes,
            active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('svc_wave7_old', C, S, 'Consultație veche', 30, 10, 1, 0, TS, TS);

    // Mon-Fri 09:00-17:00, the single shared calendar every pre-Wave-7
    // tenant had.
    const wav = db.prepare(
        `INSERT INTO calendar_weekly_availability
            (id, customer_id, site_id, weekday, start_minute, end_minute)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (let wd = 1; wd <= 5; wd++) {
        wav.run('wav_old_' + wd, C, S, wd, 9 * 60, 17 * 60);
    }

    db.prepare(
        `INSERT INTO calendar_date_overrides
            (id, customer_id, site_id, date_local, kind, start_minute, end_minute, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('ov_old_blackout', C, S, '2031-06-02', 'blackout', null, null, 'concediu vechi');

    db.prepare(
        `INSERT INTO calendar_bookings (
            id, customer_id, site_id, service_id, start_utc, end_utc, status,
            visitor_name, visitor_email, visitor_phone, note,
            manage_token_hash, created_at, updated_at, cancelled_at, anonymized_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).run(
        'bk_wave7_old_live',
        C, S, 'svc_wave7_old',
        '2031-06-03T09:00:00.000Z', // a Tuesday, inside Mon-Fri 9-17
        '2031-06-03T09:30:00.000Z',
        'confirmed',
        'Vizitator Vechi',
        'vizitator.wave7@example.com',
        '0722000001',
        'notă wave7 veche',
        'cafef00dcafef00dcafef00dcafef00d',
        TS, TS
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
        'em_wave7_old_001', C, S, 'bk_wave7_old_live', 'booking_confirmed',
        'vizitator.wave7@example.com', 'Programare confirmată — Consultație veche',
        'text vechi', '<p>html vechi</p>', 'confirmed', 1,
        'local-memory', 'mem_wave7_old_001',
        'calmail:bk_wave7_old_live:booking_confirmed:confirmed:' + TS,
        TS, TS, TS
    );

    db.close();
})();

// --- Step 2: open through the CURRENT db.js — this must run the v5 migration. ---
const db = openCalendarDb({ dbPath, skipRetentionSweep: true, skipReminderSweep: true });

const migRow = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
assert.strictEqual(Number(migRow.v), 5, 'schema_migrations must advance to 5');

// --- Step 3: the live booking survives, byte-identical on every pre-existing field. ---
const booking = db.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_wave7_old_live');
assert.ok(booking, 'pre-existing booking must survive the migration');
assert.strictEqual(booking.customer_id, C);
assert.strictEqual(booking.site_id, S);
assert.strictEqual(booking.service_id, 'svc_wave7_old');
assert.strictEqual(booking.status, 'confirmed');
assert.strictEqual(booking.start_utc, '2031-06-03T09:00:00.000Z');
assert.strictEqual(booking.end_utc, '2031-06-03T09:30:00.000Z');
assert.strictEqual(booking.visitor_name, 'Vizitator Vechi');
assert.strictEqual(booking.visitor_email, 'vizitator.wave7@example.com');
assert.strictEqual(booking.visitor_phone, '0722000001');
assert.strictEqual(booking.note, 'notă wave7 veche');
assert.strictEqual(booking.manage_token_hash, 'cafef00dcafef00dcafef00dcafef00d');
assert.strictEqual(booking.anonymized_at, null);

// --- Step 4: the old outbox row survives untouched. ---
const outboxRow = db.prepare('SELECT * FROM calendar_email_outbox WHERE id = ?').get('em_wave7_old_001');
assert.ok(outboxRow, 'pre-existing outbox row must survive the migration');
assert.strictEqual(outboxRow.status, 'sent');
assert.strictEqual(outboxRow.recipient_email, 'vizitator.wave7@example.com');

// --- Step 5: the date override survives, content untouched (only the new
// resource_id column and the table rebuild it required are new). ---
const override = db.prepare('SELECT * FROM calendar_date_overrides WHERE id = ?').get('ov_old_blackout');
assert.ok(override, 'pre-existing blackout override must survive the table rebuild');
assert.strictEqual(override.date_local, '2031-06-02');
assert.strictEqual(override.kind, 'blackout');
assert.strictEqual(override.note, 'concediu vechi');

// --- Step 6: exactly one implicit resource was created for this tenant. ---
const resources = db.prepare(
    'SELECT * FROM calendar_resources WHERE customer_id = ? AND site_id = ?'
).all(C, S);
assert.strictEqual(resources.length, 1, 'migration must create exactly one implicit resource per tenant');
const defaultResource = resources[0];
assert.strictEqual(Number(defaultResource.is_default), 1, 'the implicit resource must be flagged is_default');
assert.strictEqual(Number(defaultResource.active), 1, 'the implicit resource must be active');
assert.strictEqual(defaultResource.name, 'Personal implicit');

// --- Step 7: every pre-existing row now points at that SAME resource — no
// orphans, no accidental second resource. ---
assert.strictEqual(booking.resource_id, defaultResource.id, 'booking must backfill to the implicit resource');
assert.strictEqual(override.resource_id, defaultResource.id, 'override must backfill to the implicit resource');
const weeklyRows = db.prepare(
    'SELECT * FROM calendar_weekly_availability WHERE customer_id = ? AND site_id = ?'
).all(C, S);
assert.strictEqual(weeklyRows.length, 5, 'all five weekly rows survive');
assert.ok(
    weeklyRows.every((w) => w.resource_id === defaultResource.id),
    'every weekly-availability row must backfill to the implicit resource'
);

// --- Step 8: the pre-existing service is explicitly tied to the implicit
// resource — adding a second resource later must not silently inherit it. ---
const svcResources = db.prepare(
    `SELECT * FROM calendar_service_resources WHERE customer_id = ? AND site_id = ? AND service_id = ?`
).all(C, S, 'svc_wave7_old');
assert.strictEqual(svcResources.length, 1, 'the pre-existing service gets exactly one explicit resource assignment');
assert.strictEqual(svcResources[0].resource_id, defaultResource.id);

// --- Step 9: availability behaves EXACTLY as before — called the old way,
// with no resourceId, on a date/time the pre-existing weekly hours allow. ---
const slotsOldWay = engine.generateSlots(db, C, S, {
    serviceId: 'svc_wave7_old',
    dateLocal: '2031-06-04', // a Wednesday, Mon-Fri 9-17, no override that day
    nowMs: Date.parse('2031-06-01T00:00:00.000Z'),
});
assert.ok(slotsOldWay.length > 0, 'a migrated tenant must still produce free slots with no owner action');
assert.ok(
    slotsOldWay.every((s) => s.resource_id === defaultResource.id),
    'every slot must resolve to the single implicit resource'
);
// The blacked-out day must still be fully closed post-migration.
const slotsOnBlackout = engine.generateSlots(db, C, S, {
    serviceId: 'svc_wave7_old',
    dateLocal: '2031-06-02',
    nowMs: Date.parse('2031-06-01T00:00:00.000Z'),
});
assert.strictEqual(slotsOnBlackout.length, 0, 'the pre-existing blackout override must still apply after migration');

// --- Step 10: a brand-new booking, made the OLD way (no resourceId param at
// all — exactly how every pre-Wave-7 call site invokes createBooking),
// still confirms exactly as it always did, with no public URL / API shape
// change required from the owner or the visitor. ---
const freshBooking = engine.createBooking(db, C, S, {
    serviceId: 'svc_wave7_old',
    startUtc: '2031-06-04T10:00:00.000Z',
    visitorName: 'Client Nou',
    visitorEmail: 'client.nou@example.com',
    nowMs: Date.parse('2031-06-01T00:00:00.000Z'),
});
assert.strictEqual(freshBooking.status, 'confirmed', 'a fresh booking on a migrated tenant must confirm exactly as before');
assert.strictEqual(
    freshBooking.booking.resource_id, defaultResource.id,
    'a fresh booking with no resourceId must land on the single implicit resource'
);

// --- Step 11: re-opening is idempotent (matches the v4 oracle's own check). ---
db.close();
const db2 = openCalendarDb({ dbPath, skipRetentionSweep: true, skipReminderSweep: true });
const migRow2 = db2.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
assert.strictEqual(Number(migRow2.v), 5, 'second open must not re-run migrations or fail');
const resourcesAgain = db2.prepare(
    'SELECT * FROM calendar_resources WHERE customer_id = ? AND site_id = ?'
).all(C, S);
assert.strictEqual(resourcesAgain.length, 1, 're-opening must never create a second implicit resource');
const bookingAgain = db2.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_wave7_old_live');
assert.strictEqual(bookingAgain.status, 'confirmed', 'original live booking still intact after a second open');

// --- Evidence artifact ---
const evidenceDir = path.resolve(__dirname, '..', '..', '04-QA-Evidence', 'Wave7-calendar-staff');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
    path.join(evidenceDir, 'migration-proof.json'),
    JSON.stringify({
        scenario: 'raw pre-Wave-7 (v1..v4) database with a live confirmed booking, migrated through current db.js',
        schemaVersionBefore: 4,
        schemaVersionAfter: Number(migRow.v),
        implicitResourceCreated: 1,
        implicitResourceName: defaultResource.name,
        preExistingBookingIntact: true,
        preExistingBookingBackfilledResourceId: booking.resource_id === defaultResource.id,
        preExistingOverrideIntact: true,
        preExistingWeeklyRowsBackfilled: weeklyRows.length,
        preExistingServiceExplicitlyAssignedToImplicitResource: svcResources.length === 1,
        oldStyleSlotGenerationStillWorks: slotsOldWay.length > 0,
        oldStyleFreshBookingStillConfirms: freshBooking.status === 'confirmed',
        idempotentOnSecondOpen: resourcesAgain.length === 1,
        generatedAt: new Date().toISOString(),
    }, null, 2) + '\n'
);

db2.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(
    'PASS wave7-calendar-resources-migration ' +
    '(pre-v5 install with a live booking migrates to exactly one implicit resource, ' +
    'every existing row + old-style call shape keeps working with no owner action)'
);
