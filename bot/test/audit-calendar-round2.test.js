'use strict';
/**
 * Oracle — audit 2026-09-06 round 2 fixes (CAL-002, CAL-003).
 *
 * CAL-002 (VISION.md §8 "Anulare / reprogramare"): visitor with a valid
 * manage token can reschedule, not just cancel — old slot frees only when
 * the new one was actually secured, invalid/expired tokens are refused, a
 * reschedule onto an already-taken slot is rejected without corrupting the
 * existing booking, and the owner-configured notice window (default >= 24h
 * before the *current* slot) is enforced exactly like cancel.
 *
 * CAL-003 (VISION.md §8 "Date personale — minimizare și retenție"): a
 * periodic, idempotent sweep anonymizes bookings older than 24 months
 * (visitor_name / visitor_email / visitor_phone / note scrubbed, everything
 * else needed for history integrity kept), leaves recent bookings untouched,
 * running twice changes nothing further, and the owner can trigger early
 * erasure ("dreptul la ștergere") ahead of the 24-month default.
 *
 * Run: node --experimental-sqlite bot/test/audit-calendar-round2.test.js
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

const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');
const manageApi = require('../calendar-native/manage-api');
const retention = require('../calendar-native/retention');
const { zonedWallTimeToUtcMs, toIsoUtc } = require('../calendar-native/time');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-audit-r2-'));
const db = openCalendarDb({ dbPath: path.join(tmp, 't.sqlite') });

const C = 'cust_r2';
const S = 'site_r2';
const TZ = 'Europe/Bucharest';

engine.ensureSettings(db, C, S, {
    timezone: TZ,
    default_buffer_minutes: 10,
    slot_interval_minutes: 15,
    min_cancel_hours: 24,
});

const svc = engine.upsertService(db, C, S, {
    name: 'Consultație',
    duration_minutes: 45,
    buffer_minutes: 10,
});

// Mon–Fri 09:00–17:00
engine.setWeeklyAvailability(db, C, S, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 3, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 4, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 5, start_minute: 9 * 60, end_minute: 17 * 60 },
]);

// Fixed future Tuesday/Wednesday to avoid "now" flakiness.
const DATE = '2030-01-08'; // Tuesday
const DATE_W = '2030-01-09'; // Wednesday
assert.strictEqual(require('../calendar-native/time').isoWeekdayForDateLocal(DATE), 2);

// ---------------------------------------------------------------------------
// CAL-002: visitor reschedule via manage token
// ---------------------------------------------------------------------------

const OLD_START_MS = zonedWallTimeToUtcMs(2030, 1, 8, 10, 0, TZ); // 10:00 Tue
const OTHER_START_MS = zonedWallTimeToUtcMs(2030, 1, 8, 13, 0, TZ); // 13:00 Tue — will be occupied
const NEW_START_MS = zonedWallTimeToUtcMs(2030, 1, 8, 15, 0, TZ); // 15:00 Tue — target, free

const CREATE_NOW_MS = OLD_START_MS - 90 * 24 * 3600 * 1000; // far enough in the past to create both bookings
const RESCHED_NOW_MS = OLD_START_MS - 48 * 3600 * 1000; // 48h before old start — inside the 24h window

const first = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc: toIsoUtc(OLD_START_MS),
    visitorName: 'Ana Vizitator',
    visitorEmail: 'ana.r2@example.com',
    nowMs: CREATE_NOW_MS,
});
assert.strictEqual(first.status, 'confirmed', 'setup: first booking must confirm on a free slot');
const TOKEN_A = first.manageToken;

const occupant = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc: toIsoUtc(OTHER_START_MS),
    visitorName: 'Mihai Ocupant',
    visitorEmail: 'mihai.r2@example.com',
    nowMs: CREATE_NOW_MS,
});
assert.strictEqual(occupant.status, 'confirmed', 'setup: occupant booking must confirm on a free slot');

// 1) Free-slot listing via token reuses the public generator and excludes the occupied slot.
const slotsOut = manageApi.getSlotsForToken(db, TOKEN_A, {
    fromDateLocal: DATE,
    toDateLocal: DATE,
    nowMs: RESCHED_NOW_MS,
});
assert.ok(slotsOut.ok, 'getSlotsForToken must succeed for a valid token');
const startsListed = slotsOut.slots.map((s) => s.startUtc);
assert.ok(startsListed.includes(toIsoUtc(NEW_START_MS)), 'target slot must be listed as free');
assert.ok(!startsListed.includes(toIsoUtc(OTHER_START_MS)), 'occupied slot must not be listed as free');

// 2) Valid reschedule: moves booking, frees old slot, occupies new slot.
const reschedOk = manageApi.rescheduleByToken(db, TOKEN_A, {
    startUtc: toIsoUtc(NEW_START_MS),
    nowMs: RESCHED_NOW_MS,
});
assert.ok(reschedOk.ok, 'valid reschedule must succeed: ' + JSON.stringify(reschedOk));
assert.strictEqual(reschedOk.booking.status, 'confirmed', 'moved to a free slot must confirm, never a false confirmation');
assert.strictEqual(reschedOk.booking.startUtc, toIsoUtc(NEW_START_MS), 'booking must move to the requested slot');

const oldSlotStillActive = engine.listActiveBookings(db, C, S, {
    serviceId: svc.id,
    fromUtc: toIsoUtc(OLD_START_MS - 60000),
    toUtc: toIsoUtc(OLD_START_MS + 60000),
});
assert.strictEqual(oldSlotStillActive.length, 0, 'old slot must be freed immediately after a successful reschedule');

const newSlotActive = engine.listActiveBookings(db, C, S, {
    serviceId: svc.id,
    fromUtc: toIsoUtc(NEW_START_MS - 60000),
    toUtc: toIsoUtc(NEW_START_MS + 60000),
});
assert.strictEqual(newSlotActive.length, 1, 'new slot must show exactly one active booking');
assert.strictEqual(newSlotActive[0].id, first.booking.id, 'the moved booking must be the same row (history kept)');

// 3) Invalid / unknown token is refused, never silently accepted.
const badToken = manageApi.rescheduleByToken(db, 'not-a-real-token-but-16charsplus', {
    startUtc: toIsoUtc(OTHER_START_MS + 3600000),
    nowMs: RESCHED_NOW_MS,
});
assert.ok(!badToken.ok, 'unknown token must be refused');
assert.strictEqual(badToken.code, 'TOKEN');

// "Expired" token: once a booking is cancelled, its manage token can no longer reschedule.
const secondBookingForCancel = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc: toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 9, 9, 0, TZ)),
    visitorName: 'Elena Test',
    visitorEmail: 'elena.r2@example.com',
    nowMs: CREATE_NOW_MS,
});
const cancelNowMs = zonedWallTimeToUtcMs(2030, 1, 9, 9, 0, TZ) - 48 * 3600 * 1000;
manageApi.cancelByToken(db, secondBookingForCancel.manageToken, { nowMs: cancelNowMs });
const expiredResched = manageApi.rescheduleByToken(db, secondBookingForCancel.manageToken, {
    startUtc: toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 9, 11, 0, TZ)),
    nowMs: cancelNowMs,
});
assert.ok(!expiredResched.ok, 'a cancelled booking token must be refused for reschedule (functionally expired)');
assert.strictEqual(expiredResched.code, 'STATE');

// 4) Reschedule onto an occupied slot is refused WITHOUT corrupting the existing booking.
const beforeAttempt = engine.getBooking(db, C, S, first.booking.id);
const conflictAttempt = manageApi.rescheduleByToken(db, TOKEN_A, {
    startUtc: toIsoUtc(OTHER_START_MS), // taken by `occupant`
    nowMs: RESCHED_NOW_MS,
});
assert.ok(!conflictAttempt.ok, 'reschedule onto an occupied slot must be refused');
assert.strictEqual(conflictAttempt.code, 'SLOT_TAKEN');
assert.match(conflictAttempt.error, /confirmare falsă/, 'refusal copy must follow the module honesty standard');
const afterAttempt = engine.getBooking(db, C, S, first.booking.id);
assert.deepStrictEqual(afterAttempt, beforeAttempt, 'existing booking must be byte-for-byte unchanged after a refused reschedule');

// 5) Notice window (VISION default >= 24h before the CURRENT slot start) is enforced.
const thirdBooking = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc: toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 10, 10, 0, TZ)), // Thursday 10:00
    visitorName: 'Radu Test',
    visitorEmail: 'radu.r2@example.com',
    nowMs: CREATE_NOW_MS,
});
const tooLateNowMs = zonedWallTimeToUtcMs(2030, 1, 10, 10, 0, TZ) - 2 * 3600 * 1000; // only 2h notice
const windowAttempt = manageApi.rescheduleByToken(db, thirdBooking.manageToken, {
    startUtc: toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 10, 14, 0, TZ)),
    nowMs: tooLateNowMs,
});
assert.ok(!windowAttempt.ok, 'reschedule inside the notice window must be refused');
assert.strictEqual(windowAttempt.code, 'WINDOW');
const thirdUnchanged = engine.getBooking(db, C, S, thirdBooking.booking.id);
assert.strictEqual(thirdUnchanged.start_utc, thirdBooking.booking.start_utc, 'booking must stay put when the window is violated');

console.log('PASS audit-calendar-round2 CAL-002 (visitor reschedule via manage token)');

// ---------------------------------------------------------------------------
// CAL-003: 24-month PII retention sweep + owner early erasure
// ---------------------------------------------------------------------------

function insertRawBooking(db, row) {
    const ts = new Date().toISOString();
    db.prepare(
        `INSERT INTO calendar_bookings (
            id, customer_id, site_id, service_id, start_utc, end_utc, status,
            visitor_name, visitor_email, visitor_phone, note,
            manage_token_hash, created_at, updated_at, cancelled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
        row.id, row.customerId, row.siteId, row.serviceId, row.startUtc, row.endUtc, row.status,
        row.visitorName, row.visitorEmail, row.visitorPhone || null, row.note || null,
        'rawhash_' + row.id, ts, ts
    );
}

function fetchRaw(db, id) {
    return db.prepare(`SELECT * FROM calendar_bookings WHERE id = ?`).get(id);
}

const RETENTION_NOW_MS = Date.UTC(2026, 8, 6); // "today" per this audit
const OLD_BOOKING_ID = 'bk_r2_old_pii';
const RECENT_BOOKING_ID = 'bk_r2_recent_pii';

// > 24 months before RETENTION_NOW_MS (well past the cutoff)
insertRawBooking(db, {
    id: OLD_BOOKING_ID,
    customerId: C,
    siteId: S,
    serviceId: svc.id,
    startUtc: new Date(Date.UTC(2023, 5, 1, 10, 0)).toISOString(),
    endUtc: new Date(Date.UTC(2023, 5, 1, 10, 45)).toISOString(),
    status: 'cancelled',
    visitorName: 'Client Vechi',
    visitorEmail: 'vechi@example.com',
    visitorPhone: '0722999888',
    note: 'notă veche cu detalii personale',
});

// well inside the 24-month window — must not be touched
insertRawBooking(db, {
    id: RECENT_BOOKING_ID,
    customerId: C,
    siteId: S,
    serviceId: svc.id,
    startUtc: new Date(Date.UTC(2025, 5, 1, 10, 0)).toISOString(),
    endUtc: new Date(Date.UTC(2025, 5, 1, 10, 45)).toISOString(),
    status: 'confirmed',
    visitorName: 'Client Recent',
    visitorEmail: 'recent@example.com',
    visitorPhone: '0722111222',
    note: 'notă recentă',
});

const sweep1 = retention.runRetentionSweep(db, { nowMs: RETENTION_NOW_MS });
assert.strictEqual(sweep1.anonymizedCount, 1, 'sweep must anonymize exactly the >24-month booking');

const oldAfter1 = fetchRaw(db, OLD_BOOKING_ID);
assert.strictEqual(oldAfter1.visitor_name, 'Vizitator anonimizat', 'old booking name must be scrubbed');
assert.notStrictEqual(oldAfter1.visitor_email, 'vechi@example.com', 'old booking email must be scrubbed');
assert.strictEqual(oldAfter1.visitor_phone, null, 'old booking phone must be nulled');
assert.strictEqual(oldAfter1.note, null, 'old booking note must be nulled');
assert.ok(oldAfter1.anonymized_at, 'anonymized_at must be stamped');
// History integrity kept:
assert.strictEqual(oldAfter1.status, 'cancelled', 'status history must survive anonymization');
assert.strictEqual(oldAfter1.start_utc, new Date(Date.UTC(2023, 5, 1, 10, 0)).toISOString(), 'start_utc must survive for aggregate stats');
assert.strictEqual(oldAfter1.id, OLD_BOOKING_ID);

const recentAfter1 = fetchRaw(db, RECENT_BOOKING_ID);
assert.strictEqual(recentAfter1.visitor_name, 'Client Recent', 'recent booking must not be touched');
assert.strictEqual(recentAfter1.visitor_email, 'recent@example.com', 'recent booking email must not be touched');
assert.strictEqual(recentAfter1.anonymized_at, null, 'recent booking must not be marked anonymized');

// Idempotent: running again changes nothing further.
const sweep2 = retention.runRetentionSweep(db, { nowMs: RETENTION_NOW_MS });
assert.strictEqual(sweep2.anonymizedCount, 0, 'second sweep must be a no-op for already-anonymized rows');
const oldAfter2 = fetchRaw(db, OLD_BOOKING_ID);
assert.deepStrictEqual(oldAfter2, oldAfter1, 'second sweep must not change the already-anonymized row at all');
const recentAfter2 = fetchRaw(db, RECENT_BOOKING_ID);
assert.deepStrictEqual(recentAfter2, recentAfter1, 'second sweep must not touch the recent row either');

// Owner-triggered early erasure ("dreptul la ștergere") ahead of the 24-month default.
const erased = retention.eraseBookingPii(db, C, S, RECENT_BOOKING_ID);
assert.ok(erased, 'owner erase must find the booking for its own tenant');
assert.strictEqual(erased.visitor_name, 'Vizitator anonimizat', 'owner erase must scrub name immediately, even though recent');
assert.ok(erased.anonymized_at, 'owner erase must stamp anonymized_at');
assert.strictEqual(erased.start_utc, recentAfter1.start_utc, 'owner erase must keep timestamps for history integrity');

// Owner erase is tenant-scoped: another tenant cannot erase this booking.
const crossTenantErase = retention.eraseBookingPii(db, 'cust_other', S, OLD_BOOKING_ID);
assert.strictEqual(crossTenantErase, null, 'erase must be scoped to the owning tenant only');

console.log('PASS audit-calendar-round2 CAL-003 (24-month PII retention sweep, idempotent, owner early erasure)');

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS audit-calendar-round2 (visitor reschedule via token + PII retention job)');
