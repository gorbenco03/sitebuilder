'use strict';
/**
 * bot/test/wave7-calendar-resources-notifications.test.js
 *
 * Oracle — Wave 7 (audit finding #25) requirement 5: "Reminders, .ics and
 * the manage-link flows must all carry the resource — an email that does
 * not say who the appointment is with is worse than the current
 * single-calendar behaviour." Proves:
 *
 *  1. On a MULTI-resource tenant, the confirmation email (text + html) and
 *     its attached .ics both name the assigned resource.
 *  2. The owner reminder email also names the resource (the single most
 *     useful piece of information a multi-staff owner reminder can carry).
 *  3. The manage-link JSON (manage-api.getBookingByToken) carries
 *     resourceName for the visitor's own booking.
 *  4. On a SINGLE-resource tenant (every pre-Wave-7 tenant, or a Wave-7
 *     tenant that never adds a second resource), NONE of the above ever
 *     mention a resource name — copy stays byte-identical to before this
 *     wave, per email/index.js loadResourceName + engine.hasMultipleResources.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-calendar-resources-notifications.test.js
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
const email = require('../calendar-native/email');
const manageApi = require('../calendar-native/manage-api');

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-wave7-notify-'));
    const db = openCalendarDb({
        dbPath: path.join(tmp, 'notify.sqlite'),
        skipRetentionSweep: true,
        skipReminderSweep: true,
    });
    email.setTransport(email.createMemoryTransport());

    // === Part A: multi-resource tenant — resource name must appear everywhere. ===
    const C1 = 'cust_wave7_notify_multi';
    const S1 = 'site_wave7_notify_multi';
    engine.ensureSettings(db, C1, S1, {
        timezone: 'UTC',
        slot_interval_minutes: 30,
        min_cancel_hours: 0,
        reminder_owner_enabled: 1,
    });
    const svc1 = engine.upsertService(db, C1, S1, { name: 'Consultație', duration_minutes: 30 });
    const stylist = engine.upsertResource(db, C1, S1, { name: 'Diana Ionescu', sort_order: 0 });
    const secondResource = engine.upsertResource(db, C1, S1, { name: 'Sala 2', sort_order: 1 });
    engine.setWeeklyAvailability(db, C1, S1, [{ weekday: 1, start_minute: 0, end_minute: 24 * 60 }], { resourceId: stylist.id });
    engine.setWeeklyAvailability(db, C1, S1, [{ weekday: 1, start_minute: 0, end_minute: 24 * 60 }], { resourceId: secondResource.id });
    engine.setServiceResources(db, C1, S1, svc1.id, [stylist.id, secondResource.id]);

    const NOW = Date.parse('2031-01-01T00:00:00.000Z');
    const startMulti = '2031-03-03T10:00:00.000Z'; // a Monday
    const created1 = engine.createBooking(db, C1, S1, {
        serviceId: svc1.id,
        resourceId: stylist.id,
        startUtc: startMulti,
        visitorName: 'Vizitator Multi',
        visitorEmail: 'multi@example.com',
        nowMs: NOW,
    });
    assert.strictEqual(created1.status, 'confirmed');
    assert.strictEqual(created1.booking.resource_id, stylist.id);

    await email.processOutbox(db, { nowMs: NOW, limit: 10 });
    const rows1 = email.listOutbox(db, C1, S1, { bookingId: created1.booking.id, includeBodies: true });
    assert.ok(rows1.length >= 1, 'confirmation email must be enqueued');
    const confirmRow1 = rows1.find((r) => r.template_key === 'booking_confirmed');
    assert.ok(confirmRow1, 'a booking_confirmed row must exist');
    assert.ok(confirmRow1.body_text.includes('Diana Ionescu'), 'confirmation text must name the resource on a multi-resource tenant');
    assert.ok(confirmRow1.body_html.includes('Diana Ionescu'), 'confirmation html must name the resource on a multi-resource tenant');
    assert.ok(confirmRow1.ics_content, 'confirmation must carry an .ics attachment');
    assert.ok(confirmRow1.ics_content.includes('Diana Ionescu'), '.ics SUMMARY/DESCRIPTION must name the resource');
    console.log('PASS wave7-notifications (A1) multi-resource confirmation email + .ics name the assigned resource');

    // Owner reminder — verified directly against email.templates.render()
    // with the exact params email/index.js's enqueueReminderEmail builds
    // (loadServiceName/loadResourceName/formatOwnerLocal/loadSiteLabel).
    // enqueueReminderEmail's own recipient-resolution path (registry lookup
    // for the owner's account email) is a separate, already-covered concern
    // (see wave6-calendar-reminders.test.js, which uses the demo tenant's
    // special-cased organizer email) — this oracle isolates the one thing
    // Wave 7 changes: does the resource name reach the template.
    const ownerReminderRendered = email.templates.render({
        templateKey: 'booking_reminder_owner',
        visitorName: created1.booking.visitor_name,
        visitorEmail: created1.booking.visitor_email,
        serviceName: svc1.name,
        resourceName: email.loadResourceName(db, engine.getBooking(db, C1, S1, created1.booking.id)),
        startOwnerLocal: email.formatOwnerLocal(created1.booking.start_utc, 'UTC'),
        startUtc: created1.booking.start_utc,
        bookingStatus: 'confirmed',
        manageUrl: null,
        siteLabel: 'Cabinet Test',
    });
    assert.ok(ownerReminderRendered.text.includes('Cu: Diana Ionescu.'), 'owner reminder must name which staff member the appointment is with');
    assert.ok(ownerReminderRendered.html.includes('Diana Ionescu'), 'owner reminder html must name the resource too');
    console.log('PASS wave7-notifications (A2) owner reminder names the resource on a multi-resource tenant');

    // Manage-link JSON must carry resourceName for a multi-resource tenant.
    const manageView1 = manageApi.getBookingByToken(db, created1.manageToken);
    assert.ok(manageView1.ok);
    assert.strictEqual(manageView1.booking.resourceName, 'Diana Ionescu', 'manage-link view must carry resourceName on a multi-resource tenant');
    console.log('PASS wave7-notifications (A3) manage-link JSON carries resourceName on a multi-resource tenant');

    // === Part B: single-resource tenant — no resource name ever leaks. ===
    const C2 = 'cust_wave7_notify_single';
    const S2 = 'site_wave7_notify_single';
    engine.ensureSettings(db, C2, S2, {
        timezone: 'UTC',
        slot_interval_minutes: 30,
        min_cancel_hours: 0,
        reminder_owner_enabled: 1,
    });
    const svc2 = engine.upsertService(db, C2, S2, { name: 'Consultație', duration_minutes: 30 });
    // No explicit resource created — engine lazily creates exactly one
    // implicit resource the first time availability is set, exactly like a
    // pre-Wave-7 tenant.
    engine.setWeeklyAvailability(db, C2, S2, [{ weekday: 1, start_minute: 0, end_minute: 24 * 60 }]);

    const created2 = engine.createBooking(db, C2, S2, {
        serviceId: svc2.id,
        startUtc: startMulti,
        visitorName: 'Vizitator Single',
        visitorEmail: 'single@example.com',
        nowMs: NOW,
    });
    assert.strictEqual(created2.status, 'confirmed');
    assert.ok(created2.booking.resource_id, 'setup: single-resource tenant booking must still resolve to the implicit resource');

    await email.processOutbox(db, { nowMs: NOW, limit: 10 });
    const rows2 = email.listOutbox(db, C2, S2, { bookingId: created2.booking.id, includeBodies: true });
    const confirmRow2 = rows2.find((r) => r.template_key === 'booking_confirmed');
    assert.ok(confirmRow2);
    assert.ok(!/ cu /.test(confirmRow2.body_text.split('\n')[2] || ''), 'single-resource confirmation text must not grow a "cu <nume>" clause');
    assert.ok(!confirmRow2.body_text.includes('Personal implicit'), 'the internal implicit-resource name must never leak into visitor copy');
    assert.ok(!confirmRow2.body_html.includes('Personal implicit'), 'the internal implicit-resource name must never leak into visitor html');
    assert.ok(!confirmRow2.ics_content.includes('Personal implicit'), 'the internal implicit-resource name must never leak into the .ics');
    console.log('PASS wave7-notifications (B1) single-resource tenant never leaks the implicit resource name into visitor copy');

    const bookingRow2 = engine.getBooking(db, C2, S2, created2.booking.id);
    assert.strictEqual(
        email.loadResourceName(db, bookingRow2), null,
        'loadResourceName must return null for a single-resource tenant even though resource_id is set'
    );
    const ownerReminderRendered2 = email.templates.render({
        templateKey: 'booking_reminder_owner',
        visitorName: bookingRow2.visitor_name,
        visitorEmail: bookingRow2.visitor_email,
        serviceName: svc2.name,
        resourceName: email.loadResourceName(db, bookingRow2),
        startOwnerLocal: email.formatOwnerLocal(bookingRow2.start_utc, 'UTC'),
        startUtc: bookingRow2.start_utc,
        bookingStatus: 'confirmed',
        manageUrl: null,
        siteLabel: 'Cabinet Test',
    });
    assert.ok(!ownerReminderRendered2.text.includes('Cu:'), 'single-resource owner reminder must not grow a "Cu:" line');
    console.log('PASS wave7-notifications (B2) single-resource owner reminder has no resource line');

    const manageView2 = manageApi.getBookingByToken(db, created2.manageToken);
    assert.ok(manageView2.ok);
    assert.strictEqual(manageView2.booking.resourceName, null, 'manage-link view must not carry a resourceName on a single-resource tenant');
    console.log('PASS wave7-notifications (B3) manage-link JSON carries no resourceName on a single-resource tenant');

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS wave7-calendar-resources-notifications (reminders/.ics/manage-link carry the resource on multi-resource tenants, stay silent on single-resource ones)');
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
