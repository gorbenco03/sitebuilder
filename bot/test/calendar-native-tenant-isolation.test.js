'use strict';
/**
 * Tenant isolation oracle — Professional A data never queryable as Professional B
 * through calendar-native code paths (VISION.md §8).
 *
 * Run: node --experimental-sqlite bot/test/calendar-native-tenant-isolation.test.js
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
const { zonedWallTimeToUtcMs, toIsoUtc } = require('../calendar-native/time');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-tenant-'));
const db = openCalendarDb({ dbPath: path.join(tmp, 'iso.sqlite') });

const A = { customerId: 'customer_prof_A', siteId: 'site_alpha' };
const B = { customerId: 'customer_prof_B', siteId: 'site_beta' };

// Distinct service primary keys (id is global PK; tenant also on row)
engine.ensureSettings(db, A.customerId, A.siteId, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
});
engine.ensureSettings(db, B.customerId, B.siteId, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
});

const svcA = engine.upsertService(db, A.customerId, A.siteId, {
    id: 'svc_A_only',
    name: 'Consultație A',
    duration_minutes: 30,
});
const svcB = engine.upsertService(db, B.customerId, B.siteId, {
    id: 'svc_B_only',
    name: 'Consultație B',
    duration_minutes: 30,
});

engine.setWeeklyAvailability(db, A.customerId, A.siteId, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
]);
engine.setWeeklyAvailability(db, B.customerId, B.siteId, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
]);

engine.addDateOverride(db, A.customerId, A.siteId, {
    date_local: '2030-06-01',
    kind: 'blackout',
    note: 'secret holiday A',
});

// 2030-01-07 is Monday
const MONDAY = '2030-01-07';
assert.strictEqual(require('../calendar-native/time').isoWeekdayForDateLocal(MONDAY), 1);
const startA = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 10, 0, 'Europe/Bucharest'));
const createdA = engine.createBooking(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    startUtc: startA,
    visitorName: 'Secret Visitor A',
    visitorEmail: 'secret-a@pii.example',
    visitorPhone: '0700000001',
    note: 'PII note only for A',
});
assert.strictEqual(createdA.status, 'confirmed');
const bookingAId = createdA.booking.id;
const piiEmail = createdA.booking.visitor_email;
const piiPhone = createdA.booking.visitor_phone;

// --- Oracle assertions: B cannot see A's data via scoped APIs ---

const bBookings = engine.listBookings(db, B.customerId, B.siteId);
assert.strictEqual(bBookings.length, 0, 'B listBookings must not include A bookings');
assert.ok(
    !bBookings.some((b) => b.visitor_email === piiEmail || b.id === bookingAId),
    'B must not observe A PII via listBookings'
);

const bGet = engine.getBooking(db, B.customerId, B.siteId, bookingAId);
assert.strictEqual(bGet, null, 'getBooking with B tenant + A id must return null');

const bServices = engine.listServices(db, B.customerId, B.siteId);
assert.ok(!bServices.some((s) => s.id === svcA.id), 'B must not list A services');
assert.strictEqual(
    engine.getService(db, B.customerId, B.siteId, svcA.id),
    null,
    'getService cross-tenant must be null'
);

const bWeekly = engine.listWeeklyAvailability(db, B.customerId, B.siteId);
// B has its own weekly — ensure A's blackout note never appears
const bOverrides = engine.listDateOverrides(db, B.customerId, B.siteId);
assert.ok(
    !bOverrides.some((o) => o.note === 'secret holiday A' || o.date_local === '2030-06-01'),
    'B must not see A blackout overrides'
);

const bActive = engine.listActiveBookings(db, B.customerId, B.siteId, {});
assert.ok(!bActive.some((b) => b.id === bookingAId), 'listActiveBookings scoped');

// B generating slots must not be blocked by A's booking on same wall clock
// (different tenant — independent calendars)
engine.setWeeklyAvailability(db, B.customerId, B.siteId, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
]);
const bSlots = engine.generateSlots(db, B.customerId, B.siteId, {
    serviceId: svcB.id,
    dateLocal: MONDAY,
    nowMs: Date.UTC(2026, 0, 1),
});
assert.ok(bSlots.length > 0, 'B must still have slots on Monday');
assert.ok(
    bSlots.some((s) => s.start_utc === startA),
    'A confirmed slot must not consume B capacity'
);

// Owner cancel as B on A's id is no-op null
assert.strictEqual(
    engine.cancelBookingAsOwner(db, B.customerId, B.siteId, bookingAId),
    null,
    'B cannot cancel A booking'
);

// Confirm as B on A's id null
assert.strictEqual(
    engine.confirmBookingAsOwner(db, B.customerId, B.siteId, bookingAId),
    null
);

// Raw unscoped id still exists in DB (oracle proves API scope, not that rows vanish)
const raw = engine.unsafeGetBookingByIdOnly(db, bookingAId);
assert.ok(raw, 'row physically exists');
assert.strictEqual(raw.customer_id, A.customerId);
assert.strictEqual(raw.visitor_email, piiEmail);

// Public engine surface must not export a list-all-tenants helper
const exported = Object.keys(engine);
for (const bad of ['listAllBookings', 'listAllTenants', 'adminDump', 'getBookingUnscoped']) {
    assert.ok(!exported.includes(bad), 'must not export ' + bad);
}
assert.ok(exported.includes('unsafeGetBookingByIdOnly'), 'oracle helper retained for tests only');

// Cross-tenant settings isolation
const setB = engine.getSettings(db, B.customerId, B.siteId);
const setA = engine.getSettings(db, A.customerId, A.siteId);
assert.ok(setA && setB);
assert.notStrictEqual(setA.customer_id, setB.customer_id);

// A can still read own PII
const aOwn = engine.getBooking(db, A.customerId, A.siteId, bookingAId);
assert.strictEqual(aOwn.visitor_email, piiEmail);
assert.strictEqual(aOwn.visitor_phone, piiPhone);
assert.strictEqual(aOwn.note, 'PII note only for A');

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS calendar-native-tenant-isolation oracle (A PII/bookings/availability invisible to B)');
