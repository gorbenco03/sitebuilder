'use strict';
/**
 * bot/test/wave7-calendar-resources-engine.test.js
 *
 * Oracle — Wave 7 (audit finding #25) engine-level behavior beyond the
 * concurrency proof (wave7-calendar-resources-concurrency.test.js) and the
 * migration proof (wave7-calendar-resources-migration.test.js). Proves:
 *
 *  1. Two resources with DIFFERENT weekly hours produce different slot sets
 *     for the same service/date — availability is truly per-resource.
 *  2. A per-resource blackout override closes only that resource, not the
 *     whole tenant.
 *  3. Service eligibility: a service explicitly assigned to a subset of
 *     resources is only bookable/visible on those resources; a service
 *     never touched by setServiceResources is offered by every active
 *     resource (the permissive default).
 *  4. A specific-resource booking request (resourceId given) never lands on
 *     a different resource, and demotes to 'requested' on conflict instead
 *     of silently picking another resource.
 *  5. reassignBookingAsOwner moves a requested/unassigned booking onto a
 *     free resource and confirms it; reassigning onto an already-busy
 *     resource demotes to reschedule_needed instead of double-booking.
 *  6. confirmBookingAsOwner refuses (RESOURCE_REQUIRED) a booking that has
 *     no resource assigned yet, rather than confirming into thin air.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-calendar-resources-engine.test.js
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-wave7-engine-'));
const db = openCalendarDb({
    dbPath: path.join(tmp, 'wave7-engine.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true,
});

const C = 'cust_wave7_engine';
const S = 'site_wave7_engine';
const MONDAY = '2031-03-03'; // matches the concurrency oracle's target Monday

engine.ensureSettings(db, C, S, {
    timezone: 'UTC',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
    min_cancel_hours: 0,
});

const svcCut = engine.upsertService(db, C, S, { name: 'Tuns', duration_minutes: 30 });
const svcColor = engine.upsertService(db, C, S, { name: 'Vopsit', duration_minutes: 60 });

const stylistA = engine.upsertResource(db, C, S, { name: 'Ana', sort_order: 0 });
const stylistB = engine.upsertResource(db, C, S, { name: 'Bianca', sort_order: 1 });

// Ana: 09:00-12:00 only. Bianca: 13:00-18:00 only. Non-overlapping on purpose.
engine.setWeeklyAvailability(db, C, S, [{ weekday: 1, start_minute: 9 * 60, end_minute: 12 * 60 }], { resourceId: stylistA.id });
engine.setWeeklyAvailability(db, C, S, [{ weekday: 1, start_minute: 13 * 60, end_minute: 18 * 60 }], { resourceId: stylistB.id });

// --- 1. Per-resource availability: different hours -> different slot sets. ---
const NOW = Date.parse('2031-01-01T00:00:00.000Z');
const slotsA = engine.generateSlots(db, C, S, { serviceId: svcCut.id, dateLocal: MONDAY, nowMs: NOW, resourceId: stylistA.id });
const slotsB = engine.generateSlots(db, C, S, { serviceId: svcCut.id, dateLocal: MONDAY, nowMs: NOW, resourceId: stylistB.id });
assert.ok(slotsA.length > 0, 'Ana must have morning slots');
assert.ok(slotsB.length > 0, 'Bianca must have afternoon slots');
assert.ok(
    slotsA.every((s) => Date.parse(s.start_utc) < Date.parse(MONDAY + 'T12:00:00.000Z')),
    'every Ana slot must be in her morning window'
);
assert.ok(
    slotsB.every((s) => Date.parse(s.start_utc) >= Date.parse(MONDAY + 'T13:00:00.000Z')),
    'every Bianca slot must be in her afternoon window'
);
const anyBoth = engine.generateSlots(db, C, S, { serviceId: svcCut.id, dateLocal: MONDAY, nowMs: NOW });
assert.strictEqual(
    anyBoth.length, slotsA.length + slotsB.length,
    '"any available" must merge both resources\' non-overlapping windows with no double counting'
);
console.log('PASS wave7-engine (1) per-resource weekly availability differs and merges correctly under "any"');

// --- 2. Per-resource blackout: closes only that resource. ---
engine.addDateOverride(db, C, S, { date_local: MONDAY, kind: 'blackout', resourceId: stylistA.id });
const slotsAAfterBlackout = engine.generateSlots(db, C, S, { serviceId: svcCut.id, dateLocal: MONDAY, nowMs: NOW, resourceId: stylistA.id });
const slotsBAfterBlackout = engine.generateSlots(db, C, S, { serviceId: svcCut.id, dateLocal: MONDAY, nowMs: NOW, resourceId: stylistB.id });
assert.strictEqual(slotsAAfterBlackout.length, 0, "Ana's blackout must close only her calendar");
assert.ok(slotsBAfterBlackout.length > 0, "Bianca must be unaffected by Ana's blackout");
console.log('PASS wave7-engine (2) per-resource blackout is isolated to that resource');

// --- 3. Service eligibility: explicit assignment restricts; untouched service stays permissive. ---
engine.setServiceResources(db, C, S, svcColor.id, [stylistB.id]); // only Bianca does color
const eligibleForColor = engine.listResourcesForService(db, C, S, svcColor.id);
assert.strictEqual(eligibleForColor.length, 1);
assert.strictEqual(eligibleForColor[0].id, stylistB.id);

const eligibleForCut = engine.listResourcesForService(db, C, S, svcCut.id); // never touched by setServiceResources
assert.strictEqual(eligibleForCut.length, 2, 'an untouched service defaults to every active resource');
console.log('PASS wave7-engine (3) explicit service->resource assignment restricts eligibility; untouched service stays open to all');

// A color booking can never land on Ana (not eligible), even via "any available".
const colorBooking = engine.createBooking(db, C, S, {
    serviceId: svcColor.id,
    startUtc: MONDAY + 'T14:00:00.000Z', // inside Bianca's afternoon window
    visitorName: 'Client Color',
    visitorEmail: 'color@example.com',
    nowMs: NOW,
});
assert.strictEqual(colorBooking.status, 'confirmed');
assert.strictEqual(colorBooking.booking.resource_id, stylistB.id, 'color service must resolve to the only eligible resource, Bianca');

// --- 4. Specific-resource request never silently reassigns on conflict. ---
const specificFirst = engine.createBooking(db, C, S, {
    serviceId: svcCut.id,
    resourceId: stylistB.id,
    startUtc: MONDAY + 'T15:00:00.000Z',
    visitorName: 'Primul',
    visitorEmail: 'primul@example.com',
    nowMs: NOW,
});
assert.strictEqual(specificFirst.status, 'confirmed');
assert.strictEqual(specificFirst.booking.resource_id, stylistB.id);

const specificSecond = engine.createBooking(db, C, S, {
    serviceId: svcCut.id,
    resourceId: stylistB.id, // explicitly the SAME busy resource, not "any"
    startUtc: MONDAY + 'T15:00:00.000Z',
    visitorName: 'Al Doilea',
    visitorEmail: 'aldoilea@example.com',
    nowMs: NOW,
});
// The pre-existing confirmed row already occupies (resource, start_utc) in
// the partial UNIQUE index (which covers both confirmed+requested — see
// engine.js createBooking comments), so the second insert collides at the
// DB level and falls back to reschedule_needed — same demotion family as
// 'requested', just the unique-index-race variant instead of the pre-write
// overlap-check variant. Either way it must NEVER be 'confirmed' and must
// NEVER move to a different resource.
assert.strictEqual(
    specificSecond.status, 'reschedule_needed',
    'a specific-resource request must demote (never confirm) on conflict, and never silently move to another resource'
);
assert.strictEqual(specificSecond.booking.resource_id, stylistB.id, 'a specific request keeps the requested resource even while pending');
console.log('PASS wave7-engine (4) specific-resource booking never silently reassigns on conflict');

// --- 5. reassignBookingAsOwner: move an unresolved/requested booking onto a
// free resource (confirms), or onto a busy one (demotes, never overwrites). ---
// Ana is blacked out all day on MONDAY (step 2), so her hours don't even
// cover 15:00 — reassigning there must be an honest hard rejection (the
// owner needs to pick a different resource or a different time), never a
// silent confirm and never a mysterious status downgrade.
let reassignOutsideHoursThrew = null;
try {
    engine.reassignBookingAsOwner(db, C, S, specificSecond.booking.id, stylistA.id);
} catch (e) {
    reassignOutsideHoursThrew = e;
}
assert.ok(reassignOutsideHoursThrew, 'reassigning onto a resource whose hours do not cover the time must be rejected, never confirmed');
assert.strictEqual(reassignOutsideHoursThrew.code, 'SLOT_OUTSIDE_AVAILABILITY');

// Give Ana coverage on a different day (Tuesday) so this instant fits her
// hours too — this is now a genuine "both eligible, only one free" case.
const tuesdayIso = '2031-03-04T09:00:00.000Z';
engine.setWeeklyAvailability(db, C, S, [{ weekday: 2, start_minute: 9 * 60, end_minute: 12 * 60 }], { resourceId: stylistA.id });

// Occupy Ana directly first...
const anaTue = engine.createBooking(db, C, S, {
    serviceId: svcCut.id,
    resourceId: stylistA.id,
    startUtc: tuesdayIso,
    visitorName: 'Ana Ocupată',
    visitorEmail: 'ana.ocupata@example.com',
    nowMs: NOW,
});
assert.strictEqual(anaTue.status, 'confirmed');

// ...then an "any available" request at the exact same instant: Ana fits but
// is busy, Bianca has zero Tuesday hours at all (not even a fitting
// candidate) -> genuinely unresolved, resource_id NULL, status requested.
const unresolvedTue = engine.createBooking(db, C, S, {
    serviceId: svcCut.id,
    startUtc: tuesdayIso,
    visitorName: 'Marți',
    visitorEmail: 'marti@example.com',
    nowMs: NOW,
});
assert.strictEqual(unresolvedTue.status, 'requested');
assert.strictEqual(unresolvedTue.booking.resource_id, null, 'an unresolved "any available" request must carry resource_id = NULL');

// Give Bianca matching Tuesday hours so she becomes a valid reassignment target.
engine.setWeeklyAvailability(db, C, S, [{ weekday: 2, start_minute: 9 * 60, end_minute: 12 * 60 }], { resourceId: stylistB.id });

const reassignedToBianca = engine.reassignBookingAsOwner(db, C, S, unresolvedTue.booking.id, stylistB.id);
assert.strictEqual(reassignedToBianca.status, 'confirmed', 'reassigning to a free, eligible, in-hours resource must confirm');
assert.strictEqual(reassignedToBianca.resource_id, stylistB.id);

// A second unresolved request at the same instant, reassigned onto the now-
// busy Bianca, must demote to reschedule_needed — never double-book her.
const secondTue = engine.createBooking(db, C, S, {
    serviceId: svcCut.id,
    startUtc: tuesdayIso,
    visitorName: 'Marți Doi',
    visitorEmail: 'martidoi@example.com',
    nowMs: NOW,
});
assert.strictEqual(secondTue.status, 'requested');
const reassignConflict = engine.reassignBookingAsOwner(db, C, S, secondTue.booking.id, stylistB.id);
assert.strictEqual(reassignConflict.status, 'reschedule_needed', 'reassigning onto an already-occupied resource must never double-book');
console.log('PASS wave7-engine (5) reassignBookingAsOwner confirms onto a free resource, demotes on conflict, never double-books');

// --- 6. confirmBookingAsOwner refuses to confirm a resource-less booking. ---
// A third "any available" request at the same instant: both Ana and Bianca
// are now occupied, so this one stays genuinely unresolved (resource_id NULL).
const thirdTue = engine.createBooking(db, C, S, {
    serviceId: svcCut.id,
    startUtc: tuesdayIso,
    visitorName: 'Marți Trei',
    visitorEmail: 'martitrei@example.com',
    nowMs: NOW,
});
assert.strictEqual(thirdTue.status, 'requested');
assert.strictEqual(thirdTue.booking.resource_id, null, 'setup: this booking must still have no resource assigned');

let threw = null;
try {
    engine.confirmBookingAsOwner(db, C, S, thirdTue.booking.id);
} catch (e) {
    threw = e;
}
assert.ok(threw, 'confirming a booking with no resource assigned must throw');
assert.strictEqual(threw.code, 'RESOURCE_REQUIRED');
console.log('PASS wave7-engine (6) confirmBookingAsOwner refuses a resource-less booking (RESOURCE_REQUIRED)');

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS wave7-calendar-resources-engine (per-resource availability, eligibility, specific-resource intent, reassignment)');
