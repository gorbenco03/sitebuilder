'use strict';
/**
 * Oracle — Wave 6 appointment reminders (audit finding #26: "zero reminder
 * code... the single feature that reduces no-shows... the main practical
 * reason people pay for Calendly").
 *
 * Proves the three explicitly-required hazards, plus the delivery mechanics:
 *
 *  1. A cancelled booking sends nothing — cancel it before its reminder
 *     would fire, run the sweep, assert no outbox row and no sent_at stamp.
 *  2. A double run sends once — run the sweep twice back-to-back for the
 *     same due booking; the second run must enqueue/send nothing more.
 *  3. A worker back after a long outage does not spam past appointments —
 *     create a booking, then run the sweep at a "now" far past the
 *     appointment's own start (simulating the worker having been down for
 *     six hours), and assert nothing is sent for it, ever.
 *  4. Reschedule resets the reminder: an already-reminded booking moved to
 *     a new time earns a fresh reminder for the new time.
 *  5. The optional owner reminder is a separate email to the owner's own
 *     address, gated by its own enable flag.
 *  6. Delivery reuses the EXISTING outbox exactly — status transitions
 *     through queued -> sent via the same local-memory transport, audited.
 *
 * Run: node --experimental-sqlite bot/test/wave6-calendar-reminders.test.js
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
const reminders = require('../calendar-native/reminders');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-reminders-'));
const EVIDENCE_DIR = path.join(
    path.resolve(__dirname, '../..'),
    '04-QA-Evidence/Wave6-calendar'
);
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const db = openCalendarDb({
    dbPath: path.join(tmp, 'reminders.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true, // this oracle drives the sweep manually
});
email.setTransport(email.createMemoryTransport());

const C = 'cust_remind_A';
const S = 'site_remind_A';
const ANCHOR = Date.UTC(2031, 5, 2, 8, 0, 0); // Monday 2031-06-02 08:00 UTC

engine.ensureSettings(db, C, S, {
    timezone: 'UTC',
    default_buffer_minutes: 0,
    slot_interval_minutes: 15,
    min_cancel_hours: 0,
    reminder_hours_before: 1, // fires 60 minutes before the appointment
    reminder_visitor_enabled: true,
    reminder_owner_enabled: false, // owner path covered separately below (demo tenant)
});
const svc = engine.upsertService(db, C, S, { name: 'Ședință', duration_minutes: 30 });
engine.setWeeklyAvailability(db, C, S, [
    { weekday: 1, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 2, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 3, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 4, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 5, start_minute: 0, end_minute: 24 * 60 },
]);

function iso(ms) { return new Date(ms).toISOString(); }

const evidence = { steps: [] };
function snapshotOutbox(label, bookingId, tenant) {
    const t = tenant || { customerId: C, siteId: S };
    const rows = email.listOutbox(db, t.customerId, t.siteId, { bookingId });
    evidence.steps.push({
        label,
        outbox: rows.map((r) => ({
            id: r.id, templateKey: r.template_key, recipientEmail: r.recipient_email,
            status: r.status, hasIcs: !!r.has_ics,
        })),
    });
    return rows;
}

(async function main() {
    // === Hazard 1: cancelled booking sends nothing ===
    const bCancel = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: iso(ANCHOR + 90 * 60000), // 90 min out
        visitorName: 'Va Anula',
        visitorEmail: 'va.anula@example.com',
        nowMs: ANCHOR,
    });
    assert.strictEqual(bCancel.status, 'confirmed');
    engine.cancelBookingAsOwner(db, C, S, bCancel.booking.id);

    // Sweep at a "now" past the fire threshold (start - 60min = ANCHOR+30min)
    // but still well before the appointment itself.
    const sweepNow1 = ANCHOR + 40 * 60000;
    const result1 = await reminders.runReminderSweep(db, { nowMs: sweepNow1 });
    const cancelRows = snapshotOutbox('hazard1-cancelled-booking-swept', bCancel.booking.id);
    assert.strictEqual(cancelRows.filter((r) => r.template_key === 'booking_reminder').length, 0,
        'a cancelled booking must never receive a reminder email');
    const cancelledFresh = engine.getBooking(db, C, S, bCancel.booking.id);
    assert.strictEqual(cancelledFresh.visitor_reminder_sent_at, null,
        'sent_at must stay NULL for a booking the sweep correctly skipped');

    // === Hazard 2: a double run sends once ===
    const bDouble = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: iso(ANCHOR + 90 * 60000),
        visitorName: 'Programare Dublă',
        visitorEmail: 'dubla@example.com',
        nowMs: ANCHOR,
    });
    assert.strictEqual(bDouble.status, 'confirmed');

    const sweepNow2 = ANCHOR + 40 * 60000; // same fire window as above
    const runA = await reminders.runReminderSweep(db, { nowMs: sweepNow2 });
    snapshotOutbox('hazard2-first-run', bDouble.booking.id);
    const runB = await reminders.runReminderSweep(db, { nowMs: sweepNow2 + 1000 }); // immediately again
    const rowsAfterDouble = snapshotOutbox('hazard2-second-run', bDouble.booking.id);

    assert.strictEqual(runA.sent >= 1, true, 'first sweep must send the due reminder');
    const reminderRows = rowsAfterDouble.filter((r) => r.template_key === 'booking_reminder');
    assert.strictEqual(reminderRows.length, 1, 'exactly one reminder row must exist after two sweeps');
    assert.strictEqual(reminderRows[0].status, 'sent');
    // The second sweep found nothing new to do for this booking specifically.
    const doubleFresh = engine.getBooking(db, C, S, bDouble.booking.id);
    assert.ok(doubleFresh.visitor_reminder_sent_at, 'sent_at is stamped after the first send');

    // Run it a third time for good measure — still exactly one row.
    await reminders.runReminderSweep(db, { nowMs: sweepNow2 + 2000 });
    const rowsThird = email.listOutbox(db, C, S, { bookingId: bDouble.booking.id })
        .filter((r) => r.template_key === 'booking_reminder');
    assert.strictEqual(rowsThird.length, 1, 'a third run still sends nothing new — outbox idempotency holds too');

    // === Hazard 3: worker back after a long outage must not spam past appointments ===
    const bPast = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: iso(ANCHOR + 20 * 60000), // 20 minutes out at creation time
        visitorName: 'Programare Trecută',
        visitorEmail: 'trecuta@example.com',
        nowMs: ANCHOR,
    });
    assert.strictEqual(bPast.status, 'confirmed');

    // Simulate the worker having been down for six hours: the appointment
    // (ANCHOR + 20min) is now long in the past by the time the sweep resumes.
    const sweepAfterOutage = ANCHOR + 6 * 3600000;
    const resultOutage = await reminders.runReminderSweep(db, { nowMs: sweepAfterOutage });
    const pastRows = snapshotOutbox('hazard3-worker-back-after-outage', bPast.booking.id);
    assert.strictEqual(pastRows.filter((r) => r.template_key === 'booking_reminder').length, 0,
        'a worker resuming after an outage must never send a reminder for an appointment that already happened');
    const pastFresh = engine.getBooking(db, C, S, bPast.booking.id);
    assert.strictEqual(pastFresh.visitor_reminder_sent_at, null,
        'a permanently-skipped past appointment must not be falsely marked as reminded');

    // Running the sweep again later still changes nothing for this booking —
    // it is permanently ineligible now that its start has passed.
    await reminders.runReminderSweep(db, { nowMs: sweepAfterOutage + 3600000 });
    const pastRowsAgain = email.listOutbox(db, C, S, { bookingId: bPast.booking.id });
    assert.strictEqual(pastRowsAgain.filter((r) => r.template_key === 'booking_reminder').length, 0);

    // === Reschedule resets the reminder for the new time ===
    const bResched = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: iso(ANCHOR + 120 * 60000), // distinct slot — 90min is already held by bDouble
        visitorName: 'De Reprogramat',
        visitorEmail: 'reprogramat@example.com',
        nowMs: ANCHOR,
    });
    assert.strictEqual(bResched.status, 'confirmed');
    await reminders.runReminderSweep(db, { nowMs: ANCHOR + 70 * 60000 }); // past (120-60)=60min threshold
    let reschedRow = engine.getBooking(db, C, S, bResched.booking.id);
    assert.ok(reschedRow.visitor_reminder_sent_at, 'reminder sent before the reschedule');

    const newStart = iso(ANCHOR + 5 * 3600000); // push it much further out
    engine.rescheduleBookingAsOwner(db, C, S, bResched.booking.id, {
        startUtc: newStart,
        nowMs: ANCHOR + 41 * 60000,
    });
    reschedRow = engine.getBooking(db, C, S, bResched.booking.id);
    assert.strictEqual(reschedRow.visitor_reminder_sent_at, null,
        'reschedule must reset the reminder ledger so the new time earns its own reminder');

    // Sweep at the new fire threshold (newStart - 1h) sends a fresh reminder.
    const secondFireNow = Date.parse(newStart) - 55 * 60000; // 5 min past the new threshold
    await reminders.runReminderSweep(db, { nowMs: secondFireNow });
    const reschedRemindRows = email.listOutbox(db, C, S, { bookingId: bResched.booking.id })
        .filter((r) => r.template_key === 'booking_reminder');
    // One outbox row for the original slot's reminder (already sent before the
    // reschedule — a real, historical send, kept as-is) plus one fresh row for
    // the NEW time (a rescheduled booking is a fresh appointment for reminder
    // purposes — see the reset of visitor_reminder_sent_at above).
    assert.strictEqual(reschedRemindRows.length, 2, 'original + fresh reminder rows both present');
    assert.ok(reschedRemindRows.every((r) => r.status === 'sent'), 'both reminder rows delivered');
    assert.strictEqual(
        new Set(reschedRemindRows.map((r) => r.idempotency_key)).size, 2,
        'the two reminders are keyed to two different appointment times, not a duplicate of one'
    );

    // === Owner reminder: separate email, own enable flag (demo tenant → resolvable owner email) ===
    const DC = 'demo_customer_elena';
    const DS = 'demo_site_cabinet';
    engine.ensureSettings(db, DC, DS, {
        timezone: 'UTC',
        default_buffer_minutes: 0,
        slot_interval_minutes: 15,
        reminder_hours_before: 1,
        reminder_visitor_enabled: true,
        reminder_owner_enabled: true,
    });
    const dsvc = engine.upsertService(db, DC, DS, { name: 'Consult', duration_minutes: 30 });
    engine.setWeeklyAvailability(db, DC, DS, [
        { weekday: 1, start_minute: 0, end_minute: 24 * 60 },
    ]);
    const dBooking = engine.createBooking(db, DC, DS, {
        serviceId: dsvc.id,
        startUtc: iso(ANCHOR + 90 * 60000),
        visitorName: 'Client Cabinet',
        visitorEmail: 'client.cabinet@example.com',
        nowMs: ANCHOR,
    });
    assert.strictEqual(dBooking.status, 'confirmed');
    await reminders.runReminderSweep(db, { nowMs: ANCHOR + 40 * 60000 });
    const dRows = email.listOutbox(db, DC, DS, { bookingId: dBooking.booking.id });
    const visitorReminder = dRows.find((r) => r.template_key === 'booking_reminder');
    const ownerReminder = dRows.find((r) => r.template_key === 'booking_reminder_owner');
    assert.ok(visitorReminder, 'visitor reminder still fires alongside the owner one');
    assert.strictEqual(visitorReminder.recipient_email, 'client.cabinet@example.com');
    assert.ok(ownerReminder, 'owner reminder must fire when reminder_owner_enabled is true');
    assert.strictEqual(ownerReminder.recipient_email, 'elena@cabinet.ro', 'owner reminder goes to the owner, not the visitor');
    assert.strictEqual(ownerReminder.status, 'sent');
    assert.notStrictEqual(ownerReminder.id, visitorReminder.id, 'visitor and owner reminders are independent outbox rows');

    snapshotOutbox('owner-reminder-demo-tenant', dBooking.booking.id, { customerId: DC, siteId: DS });

    // === Delivery reuses the existing outbox mechanics (audit trail) ===
    const auditRows = email.listAudit(db, C, S, { outboxId: reminderRows[0].id });
    assert.ok(auditRows.some((a) => a.event === 'queued'));
    assert.ok(auditRows.some((a) => a.event === 'sent'));

    fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'reminder-outbox-worker-cycle.json'),
        JSON.stringify(evidence, null, 2)
    );

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS wave6-calendar-reminders (cancel=nothing, double-run=once, outage-catchup=no-spam, reschedule resets, owner-optional)');
})().catch((e) => {
    console.error('FAIL wave6-calendar-reminders', e);
    try { db.close(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    process.exit(1);
});
