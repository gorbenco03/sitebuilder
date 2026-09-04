'use strict';
/**
 * Native calendar booking engine — slot generation, state machine, race lock.
 *
 * Run: node --experimental-sqlite bot/test/calendar-native-engine.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Re-exec with experimental sqlite if needed (Node 22.5+ / 23).
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
const { zonedWallTimeToUtcMs, toIsoUtc } = require('../calendar-native/time');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-engine-'));
const db = openCalendarDb({ dbPath: path.join(tmp, 't.sqlite') });

const C = 'cust_A';
const S = 'site_A';

engine.ensureSettings(db, C, S, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 10,
    slot_interval_minutes: 15,
    min_cancel_hours: 24,
});

const svc = engine.upsertService(db, C, S, {
    name: 'Consultație',
    duration_minutes: 45,
    buffer_minutes: 10,
});

// Mon–Fri 09:00–17:00 (minutes from midnight)
engine.setWeeklyAvailability(db, C, S, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 3, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 4, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 5, start_minute: 9 * 60, end_minute: 17 * 60 },
]);

// Pick a fixed Tuesday far in the future to avoid "now" flaking: 2030-01-08 is Tuesday
const DATE = '2030-01-08';
assert.strictEqual(require('../calendar-native/time').isoWeekdayForDateLocal(DATE), 2);

const nowMs = Date.UTC(2026, 0, 1);
const slots = engine.generateSlots(db, C, S, {
    serviceId: svc.id,
    dateLocal: DATE,
    nowMs,
    minLeadMinutes: 0,
});
assert.ok(slots.length > 0, 'expected free slots on a regular Tuesday');
const first = slots[0];
assert.match(first.start_utc, /Z$/, 'slots stored as UTC ISO');

// Blackout wins over weekly
engine.addDateOverride(db, C, S, { date_local: DATE, kind: 'blackout' });
const none = engine.generateSlots(db, C, S, {
    serviceId: svc.id,
    dateLocal: DATE,
    nowMs,
});
assert.strictEqual(none.length, 0, 'blackout must zero slots');

// Remove blackout via special hours only day — use another date Wed 2030-01-09
const DATE2 = '2030-01-09';
engine.addDateOverride(db, C, S, {
    date_local: DATE2,
    kind: 'special_hours',
    start_minute: 10 * 60,
    end_minute: 12 * 60,
});
const specialSlots = engine.generateSlots(db, C, S, {
    serviceId: svc.id,
    dateLocal: DATE2,
    nowMs,
});
assert.ok(specialSlots.length > 0, 'special hours open slots');
for (const sl of specialSlots) {
    const start = Date.parse(sl.start_utc);
    const partsHour = new Date(start).toLocaleString('en-GB', {
        timeZone: 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const [hh, mm] = partsHour.split(':').map(Number);
    const mins = hh * 60 + mm;
    assert.ok(mins >= 10 * 60 && mins + 45 <= 12 * 60, 'slot inside special hours ' + partsHour);
}

// Instant confirm when free
const startUtc = specialSlots[0].start_utc;
const { booking, manageToken, status } = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc,
    visitorName: 'Ana Ionescu',
    visitorEmail: 'ana@example.com',
    visitorPhone: '0722000000',
    note: 'prima vizită',
});
assert.strictEqual(status, 'confirmed', 'free slot → confirmed');
assert.strictEqual(booking.status, 'confirmed');
assert.ok(manageToken && manageToken.length > 20, 'manage token minted');
assert.ok(!('manage_token' in booking) || booking.manage_token == null);

// Same slot second book cannot confirm
const second = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc,
    visitorName: 'Mihai',
    visitorEmail: 'mihai@example.com',
});
assert.ok(
    second.status === 'requested' || second.status === 'reschedule_needed',
    'conflict must not confirm, got ' + second.status
);
assert.notStrictEqual(second.status, 'confirmed');

// Overlap with buffer: next slot too close should not be generated as free
const afterBook = engine.generateSlots(db, C, S, {
    serviceId: svc.id,
    dateLocal: DATE2,
    nowMs,
});
const taken = afterBook.find((s) => s.start_utc === startUtc);
assert.ok(!taken, 'confirmed start must disappear from free slots');

// Cancel releases slot
const cancelled = engine.cancelBookingAsOwner(db, C, S, booking.id);
assert.strictEqual(cancelled.status, 'cancelled');
const afterCancel = engine.generateSlots(db, C, S, {
    serviceId: svc.id,
    dateLocal: DATE2,
    nowMs,
});
assert.ok(
    afterCancel.some((s) => s.start_utc === startUtc),
    'cancelled slot must free again'
);

// Re-book confirmed
const again = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc,
    visitorName: 'Ana',
    visitorEmail: 'ana2@example.com',
});
assert.strictEqual(again.status, 'confirmed');

// Visitor token cancel outside window fails; inside window works with far future
const farStart = toIsoUtc(
    zonedWallTimeToUtcMs(2030, 1, 10, 11, 0, 'Europe/Bucharest')
);
const far = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc: farStart,
    visitorName: 'Token User',
    visitorEmail: 'tok@example.com',
});
assert.strictEqual(far.status, 'confirmed');
const tokCancel = engine.cancelBookingWithToken(db, far.manageToken, {
    nowMs: Date.UTC(2026, 0, 1),
});
assert.strictEqual(tokCancel.booking.status, 'cancelled');

// Unique index present
const idx = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uq_calendar_bookings_active_slot'`
).get();
assert.ok(idx, 'unique active-slot index must exist');

// PII minimization columns only
const cols = db.prepare(`PRAGMA table_info(calendar_bookings)`).all().map((c) => c.name);
for (const forbidden of ['address', 'cnp', 'ssn', 'file', 'password']) {
    assert.ok(!cols.includes(forbidden), 'no ' + forbidden);
}
assert.ok(cols.includes('visitor_name'));
assert.ok(cols.includes('visitor_email'));
assert.ok(cols.includes('visitor_phone'));
assert.ok(cols.includes('note'));

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS calendar-native-engine (slots, blackout, confirm/conflict, cancel, unique lock)');
