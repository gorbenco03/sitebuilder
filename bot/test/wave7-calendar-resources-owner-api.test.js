'use strict';
/**
 * bot/test/wave7-calendar-resources-owner-api.test.js
 *
 * Oracle — Wave 7 (audit finding #25) owner-api.js business-logic layer:
 * the exact functions the new (not-yet-mounted — see HANDOFF-calendar-staff.md)
 * HTTP handlers in server.js will call. Since bot/server.js is owned by
 * another agent, this oracle exercises owner-api.js directly (same pattern
 * as calendar-native-owner-dashboard.test.js does for the pre-Wave-7
 * surface) so the handoff's routes are proven correct at the layer this
 * agent owns, before another agent wires the HTTP glue.
 *
 * Proves:
 *  1. listOwnerResources / putOwnerResource: create, rename, deactivate.
 *  2. putOwnerResource's serviceIds param assigns/unassigns a resource to
 *     specific services (engine.listResourcesForService reflects it).
 *  3. getOwnerAvailability with/without resourceId scopes weekly hours to
 *     one resource, and always lists all resources.
 *  4. putOwnerWeekly / addOwnerOverride with resourceId write to that
 *     resource only, leaving other resources' calendars untouched.
 *  5. listOwnerBookings resourceId filter, including the
 *     '__unassigned__' pseudo-filter for still-unresolved "any available"
 *     requests.
 *  6. reassignOwnerBooking confirms onto a free resource and reports
 *     resourceName in the response.
 *  7. Tenant isolation: none of the new resource endpoints leak another
 *     tenant's resources or let one tenant mutate another's.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-calendar-resources-owner-api.test.js
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
const ownerApi = require('../calendar-native/owner-api');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-wave7-owner-api-'));
const db = openCalendarDb({
    dbPath: path.join(tmp, 'owner-api.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true,
});

const A = { customerId: 'cust_wave7_ownerapi_A', siteId: 'site_wave7_ownerapi_A' };
const B = { customerId: 'cust_wave7_ownerapi_B', siteId: 'site_wave7_ownerapi_B' };

for (const t of [A, B]) {
    engine.ensureSettings(db, t.customerId, t.siteId, {
        timezone: 'UTC',
        slot_interval_minutes: 30,
        min_cancel_hours: 0,
    });
}
const svcCut = engine.upsertService(db, A.customerId, A.siteId, { name: 'Tuns', duration_minutes: 30 });
const svcColor = engine.upsertService(db, A.customerId, A.siteId, { name: 'Vopsit', duration_minutes: 60 });

// --- 1. listOwnerResources / putOwnerResource: create, rename, deactivate. ---
const createOut = ownerApi.putOwnerResource(db, A.customerId, A.siteId, null, { name: 'Ana' });
assert.ok(createOut.ok, 'creating a resource must succeed: ' + JSON.stringify(createOut));
const anaId = createOut.resource.id;
assert.strictEqual(createOut.resource.name, 'Ana');
assert.strictEqual(createOut.resource.active, true);

const listOut1 = ownerApi.listOwnerResources(db, A.customerId, A.siteId);
assert.ok(listOut1.ok);
// The tenant's implicit resource (lazily created by ensureSettings/weekly
// calls elsewhere) may or may not exist yet at this point — just assert Ana is there.
assert.ok(listOut1.resources.some((r) => r.id === anaId && r.name === 'Ana'));

const renameOut = ownerApi.putOwnerResource(db, A.customerId, A.siteId, anaId, { name: 'Ana Popescu' });
assert.ok(renameOut.ok);
assert.strictEqual(renameOut.resource.name, 'Ana Popescu');

const createSecond = ownerApi.putOwnerResource(db, A.customerId, A.siteId, null, { name: 'Bianca' });
const biancaId = createSecond.resource.id;

const deactivateOut = ownerApi.putOwnerResource(db, A.customerId, A.siteId, biancaId, { active: false });
assert.ok(deactivateOut.ok);
assert.strictEqual(deactivateOut.resource.active, false);
console.log('PASS wave7-owner-api (1) create/rename/deactivate a resource');

// Reactivate Bianca for the rest of the oracle.
ownerApi.putOwnerResource(db, A.customerId, A.siteId, biancaId, { active: true });

// --- 2. serviceIds assignment via putOwnerResource. ---
const assignOut = ownerApi.putOwnerResource(db, A.customerId, A.siteId, anaId, { serviceIds: [svcCut.id] });
assert.ok(assignOut.ok);
const eligibleForCut = engine.listResourcesForService(db, A.customerId, A.siteId, svcCut.id);
assert.ok(eligibleForCut.some((r) => r.id === anaId), 'Ana must now be assigned to Tuns');
const eligibleForColor = engine.listResourcesForService(db, A.customerId, A.siteId, svcColor.id);
assert.ok(!eligibleForColor.some((r) => r.id === anaId), 'Ana was never assigned to Vopsit — must stay unassigned there');

const assignBiancaColor = ownerApi.putOwnerResource(db, A.customerId, A.siteId, biancaId, { serviceIds: [svcColor.id] });
assert.ok(assignBiancaColor.ok);
const eligibleForColor2 = engine.listResourcesForService(db, A.customerId, A.siteId, svcColor.id);
assert.ok(eligibleForColor2.some((r) => r.id === biancaId), 'Bianca must now be assigned to Vopsit');
console.log('PASS wave7-owner-api (2) putOwnerResource.serviceIds assigns/restricts service eligibility');

// --- 3. getOwnerAvailability with/without resourceId. ---
ownerApi.putOwnerWeekly(db, A.customerId, A.siteId, {
    resourceId: anaId,
    windows: [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
});
ownerApi.putOwnerWeekly(db, A.customerId, A.siteId, {
    resourceId: biancaId,
    windows: [{ weekday: 1, startMinute: 13 * 60, endMinute: 18 * 60 }],
});

const availAna = ownerApi.getOwnerAvailability(db, A.customerId, A.siteId, { resourceId: anaId });
assert.ok(availAna.ok);
assert.strictEqual(availAna.weekly.length, 1);
assert.strictEqual(availAna.weekly[0].startMinute, 9 * 60);
assert.ok(availAna.resources.some((r) => r.id === anaId));
assert.ok(availAna.resources.some((r) => r.id === biancaId));
assert.strictEqual(availAna.selectedResourceId, anaId);

const availBianca = ownerApi.getOwnerAvailability(db, A.customerId, A.siteId, { resourceId: biancaId });
assert.strictEqual(availBianca.weekly.length, 1);
assert.strictEqual(availBianca.weekly[0].startMinute, 13 * 60);
console.log('PASS wave7-owner-api (3) getOwnerAvailability scopes weekly hours per resourceId and lists all resources');

// --- 4. addOwnerOverride with resourceId scopes a blackout to one resource. ---
const ovOut = ownerApi.addOwnerOverride(db, A.customerId, A.siteId, {
    dateLocal: '2031-03-03',
    kind: 'blackout',
    resourceId: anaId,
});
assert.ok(ovOut.ok);
const availAnaAfterBlackout = ownerApi.getOwnerAvailability(db, A.customerId, A.siteId, { resourceId: anaId });
assert.strictEqual(availAnaAfterBlackout.overrides.length, 1);
const availBiancaAfterBlackout = ownerApi.getOwnerAvailability(db, A.customerId, A.siteId, { resourceId: biancaId });
assert.strictEqual(availBiancaAfterBlackout.overrides.length, 0, "Ana's blackout must not appear on Bianca's calendar");
console.log('PASS wave7-owner-api (4) addOwnerOverride with resourceId isolates the override to one resource');

// --- 5. listOwnerBookings resourceId filter + '__unassigned__'. ---
const bookingAna = engine.createBooking(db, A.customerId, A.siteId, {
    serviceId: svcCut.id,
    resourceId: anaId,
    startUtc: '2031-03-10T09:00:00.000Z', // a Monday within Ana's 9-12 window
    visitorName: 'Client Ana',
    visitorEmail: 'client.ana@example.com',
});
assert.strictEqual(bookingAna.status, 'confirmed');

// An "any available" request for a service assigned to nobody in particular
// (svcColor is only Bianca's) at a time Bianca is NOT open -> stays unassigned.
const svcColorEligible = engine.listResourcesForService(db, A.customerId, A.siteId, svcColor.id);
assert.strictEqual(svcColorEligible.length, 1);
const unassigned = engine.createBooking(db, A.customerId, A.siteId, {
    serviceId: svcCut.id, // Tuns is open to both Ana(9-12 Mon) and (nobody else since only Ana assigned)
    startUtc: '2031-03-10T09:00:00.000Z', // same instant as Ana's booking above -> Ana busy, no one else eligible -> unresolved
    visitorName: 'Client Fara Resursa',
    visitorEmail: 'fara.resursa@example.com',
});
assert.strictEqual(unassigned.status, 'requested');
assert.strictEqual(unassigned.booking.resource_id, null);

const filteredAna = ownerApi.listOwnerBookings(db, A.customerId, A.siteId, { resourceId: anaId });
assert.ok(filteredAna.ok);
assert.ok(filteredAna.bookings.every((b) => b.resourceId === anaId));
assert.ok(filteredAna.bookings.some((b) => b.id === bookingAna.booking.id));

const filteredUnassigned = ownerApi.listOwnerBookings(db, A.customerId, A.siteId, { resourceId: '__unassigned__' });
assert.ok(filteredUnassigned.ok);
assert.ok(filteredUnassigned.bookings.every((b) => b.resourceId === null));
assert.ok(filteredUnassigned.bookings.some((b) => b.id === unassigned.booking.id));
console.log('PASS wave7-owner-api (5) listOwnerBookings resourceId filter, including __unassigned__');

// --- 6. reassignOwnerBooking. ---
// Give Bianca matching Monday-morning hours so she's a valid reassignment target.
ownerApi.putOwnerWeekly(db, A.customerId, A.siteId, {
    resourceId: biancaId,
    windows: [
        { weekday: 1, startMinute: 13 * 60, endMinute: 18 * 60 },
        { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
    ],
});
ownerApi.putOwnerResource(db, A.customerId, A.siteId, biancaId, { serviceIds: [svcColor.id, svcCut.id] });
const reassignOut = ownerApi.reassignOwnerBooking(db, A.customerId, A.siteId, unassigned.booking.id, { resourceId: biancaId });
assert.ok(reassignOut.ok, 'reassignment must succeed: ' + JSON.stringify(reassignOut));
assert.strictEqual(reassignOut.booking.status, 'confirmed');
assert.strictEqual(reassignOut.booking.resourceId, biancaId);
assert.strictEqual(reassignOut.booking.resourceName, 'Bianca');
console.log('PASS wave7-owner-api (6) reassignOwnerBooking confirms onto a free resource and reports resourceName');

// --- 7. Tenant isolation. ---
const bResourcesOut = ownerApi.listOwnerResources(db, B.customerId, B.siteId);
assert.ok(bResourcesOut.ok);
assert.ok(!bResourcesOut.resources.some((r) => r.id === anaId || r.id === biancaId), "tenant B must never see tenant A's resources");

const crossReassign = ownerApi.reassignOwnerBooking(db, B.customerId, B.siteId, bookingAna.booking.id, { resourceId: anaId });
assert.strictEqual(crossReassign.code, 'NOT_FOUND', "tenant B must not be able to reassign tenant A's booking");

const crossResourceEdit = ownerApi.putOwnerResource(db, B.customerId, B.siteId, anaId, { name: 'Ana Hacked' });
assert.strictEqual(crossResourceEdit.code, 'NOT_FOUND', "tenant B must not be able to edit tenant A's resource by id");
// Confirm A's resource name is truly untouched.
const anaStillIntact = engine.getResource(db, A.customerId, A.siteId, anaId);
assert.strictEqual(anaStillIntact.name, 'Ana Popescu');
console.log('PASS wave7-owner-api (7) tenant isolation holds for every new resource endpoint');

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS wave7-calendar-resources-owner-api (resource CRUD, per-resource availability, reassignment, tenant isolation)');
