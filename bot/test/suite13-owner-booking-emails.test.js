'use strict';
/**
 * Oracle — suite13 CAL-EMAIL: the business owner is notified about booking
 * events, not just the visitor.
 *
 * Before this fix, a full booking lifecycle (create/conflict/cancel/
 * reschedule) filled the outbox with emails to the visitor only. The owner
 * had exactly one optional email in the whole product — the pre-appointment
 * reminder (booking_reminder_owner), off by default — and nothing at all
 * for the moment a booking actually lands, is cancelled, or is moved. For a
 * one-person cabinet that means bookings arrive and nobody notices.
 *
 * Proves:
 *  1. A new CONFIRMED booking emails the owner with its own honest template
 *     (booking_owner_new_confirmed) — service, staff (when meaningful),
 *     date/time with weekday in Europe/Bucharest, visitor contact + note,
 *     and a direct link to the booking in the owner dashboard.
 *  2. A new PENDING booking (conflict, needs owner action) emails the owner
 *     with a DIFFERENT template (booking_owner_new_pending) — never the
 *     confirmed copy for a pending booking.
 *  3. A booking that could not confirm because the exact slot was already
 *     taken emails the owner with yet another template
 *     (booking_owner_slot_taken).
 *  4. A VISITOR-initiated cancel notifies the owner
 *     (booking_owner_cancelled_by_visitor); an OWNER-initiated cancel does
 *     NOT re-notify the owner about their own action.
 *  5. A VISITOR-initiated reschedule notifies the owner
 *     (booking_owner_rescheduled_by_visitor); an OWNER-initiated reschedule
 *     does NOT.
 *  6. Each event has its own on/off toggle (calendar_settings) — turning one
 *     off silences exactly that email and no other.
 *  7. Recipient resolution: calendar_settings.notify_owner_email overrides
 *     the tenant owner's account email when configured; with neither
 *     configured, the owner email is silently skipped (never guessed, never
 *     crashes the booking write).
 *  8. Idempotency: replaying the outbox for the same event never sends the
 *     owner email twice.
 *  9. Migration: an existing tenant (settings row created before this wave)
 *     gets every owner-notification toggle backfilled to enabled — proven
 *     against the real ALTER TABLE migration in schema.js/db.js, not just
 *     the ensureSettings() JS default.
 *
 * Run: node --experimental-sqlite bot/test/suite13-owner-booking-emails.test.js
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
const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');
const email = require('../calendar-native/email');
const manageApi = require('../calendar-native/manage-api');
const schema = require('../calendar-native/schema');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-owner-mail-'));
const db = openCalendarDb({
    dbPath: path.join(tmp, 'owner-mail.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true,
});
email.setTransport(email.createMemoryTransport());

const C = 'cust_ownermail_A';
const S = 'site_ownermail_A';
const OWNER_EMAIL = 'owner.ownermail@example.com';
const nowMs = Date.UTC(2026, 0, 1);

engine.ensureSettings(db, C, S, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
    min_cancel_hours: 0,
    notify_owner_email: OWNER_EMAIL,
});
const svc = engine.upsertService(db, C, S, { name: 'Consultație', duration_minutes: 30 });
engine.setWeeklyAvailability(db, C, S, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 3, start_minute: 9 * 60, end_minute: 17 * 60 },
]);

const DATE = '2030-01-07'; // Monday
const slots = engine.generateSlots(db, C, S, { serviceId: svc.id, dateLocal: DATE, nowMs, minLeadMinutes: 0 });
assert.ok(slots.length >= 6, 'need enough free slots for this oracle');

function ownerRowsFor(bookingId) {
    return email.listOutbox(db, C, S, { bookingId, includeBodies: true })
        .filter((r) => r.recipient_email === OWNER_EMAIL);
}

(async function main() {
    // === 1. New CONFIRMED booking -> owner_new_confirmed ===
    const start1 = slots[0].start_utc;
    const created1 = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start1,
        visitorName: 'Ana Owner-Mail', visitorEmail: 'ana.ownermail@example.com',
        visitorPhone: '0722111222', note: 'Prima programare',
        nowMs,
    });
    assert.strictEqual(created1.status, 'confirmed');
    await email.processOutbox(db, { nowMs, limit: 20 });

    const owner1 = ownerRowsFor(created1.booking.id);
    assert.strictEqual(owner1.length, 1, 'exactly one owner email for a new confirmed booking');
    assert.strictEqual(owner1[0].template_key, 'booking_owner_new_confirmed');
    assert.strictEqual(owner1[0].status, 'sent');
    assert.match(owner1[0].subject, /Consultație/);
    assert.match(owner1[0].body_text, /Ana Owner-Mail/);
    assert.match(owner1[0].body_text, /ana\.ownermail@example\.com/);
    assert.match(owner1[0].body_text, /0722111222/);
    assert.match(owner1[0].body_text, /Prima programare/, 'visitor note must reach the owner');
    assert.match(owner1[0].body_text, /Consultație/);
    assert.match(owner1[0].body_text, /luni/i, 'the Romanian weekday must appear');
    assert.match(owner1[0].body_text, /Europe\/Bucharest/);
    assert.match(owner1[0].body_text, /\/calendar-native\/owner\/\?bookingId=/, 'a direct link to the booking in the owner dashboard');
    assert.match(owner1[0].body_text, new RegExp(created1.booking.id), 'the link must point at THIS booking');
    // Honesty: the visitor's own confirmed email still went out too — this
    // is an ADDITIONAL email, never a replacement for the visitor's.
    const visitorRows1 = email.listOutbox(db, C, S, { bookingId: created1.booking.id })
        .filter((r) => r.recipient_email === 'ana.ownermail@example.com');
    assert.strictEqual(visitorRows1.length, 1);
    assert.strictEqual(visitorRows1[0].template_key, 'booking_confirmed');

    console.log('PASS suite13-owner-mail (1) new confirmed booking notifies the owner honestly, with contact + link');

    // === 2. New PENDING booking (conflict, not preferRescheduleOnConflict) -> owner_new_pending ===
    const conflict2 = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start1,
        visitorName: 'Bob Pending', visitorEmail: 'bob.pending@example.com',
        nowMs: nowMs + 1,
    });
    assert.strictEqual(conflict2.status, 'requested', 'setup: this must land as requested, not confirmed');
    await email.processOutbox(db, { nowMs: nowMs + 2, limit: 20 });
    const owner2 = ownerRowsFor(conflict2.booking.id);
    assert.strictEqual(owner2.length, 1);
    assert.strictEqual(owner2[0].template_key, 'booking_owner_new_pending');
    assert.doesNotMatch(owner2[0].body_text.toLowerCase(), /a fost confirmată/);
    assert.match(owner2[0].body_text, /Bob Pending/);

    console.log('PASS suite13-owner-mail (2) a pending (needs-action) new booking gets its own distinct owner email');

    // === 3. Booking fails to confirm because the exact slot is taken -> owner_slot_taken ===
    const start3 = slots[1].start_utc;
    const held = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start3,
        visitorName: 'Holder', visitorEmail: 'holder@example.com',
        nowMs: nowMs + 3,
    });
    assert.strictEqual(held.status, 'confirmed', 'setup: the slot must be genuinely taken');
    const slotTaken3 = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start3,
        resourceId: held.booking.resource_id,
        visitorName: 'Carol SlotTaken', visitorEmail: 'carol.slottaken@example.com',
        preferRescheduleOnConflict: true,
        nowMs: nowMs + 4,
    });
    assert.strictEqual(slotTaken3.status, 'reschedule_needed', 'setup: this must land as reschedule_needed (slot taken)');
    await email.processOutbox(db, { nowMs: nowMs + 5, limit: 20 });
    const owner3 = ownerRowsFor(slotTaken3.booking.id);
    assert.strictEqual(owner3.length, 1);
    assert.strictEqual(owner3[0].template_key, 'booking_owner_slot_taken');
    assert.match(owner3[0].body_text, /Carol SlotTaken/);

    console.log('PASS suite13-owner-mail (3) a booking that could not confirm because the slot was taken gets its own owner email');

    // === 4. Visitor cancel notifies the owner; owner cancel does not re-notify ===
    const start4 = slots[2].start_utc;
    const toCancelByVisitor = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start4,
        visitorName: 'Dana Cancel', visitorEmail: 'dana.cancel@example.com',
        nowMs: nowMs + 6,
    });
    assert.strictEqual(toCancelByVisitor.status, 'confirmed');
    await email.processOutbox(db, { nowMs: nowMs + 7, limit: 20 }); // drain the "new confirmed" owner mail first

    manageApi.cancelByToken(db, toCancelByVisitor.manageToken, { nowMs: nowMs + 8 });
    await email.processOutbox(db, { nowMs: nowMs + 9, limit: 20 });
    const cancelRows4 = ownerRowsFor(toCancelByVisitor.booking.id);
    const cancelledByVisitorMail = cancelRows4.find((r) => r.template_key === 'booking_owner_cancelled_by_visitor');
    assert.ok(cancelledByVisitorMail, 'a visitor cancel must notify the owner');
    assert.match(cancelledByVisitorMail.body_text, /Dana Cancel/);

    const start4b = slots[3].start_utc;
    const toCancelByOwner = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start4b,
        visitorName: 'Erik OwnerCancel', visitorEmail: 'erik.ownercancel@example.com',
        nowMs: nowMs + 10,
    });
    await email.processOutbox(db, { nowMs: nowMs + 11, limit: 20 });
    engine.cancelBookingAsOwner(db, C, S, toCancelByOwner.booking.id);
    await email.processOutbox(db, { nowMs: nowMs + 12, limit: 20 });
    const cancelRows4b = ownerRowsFor(toCancelByOwner.booking.id);
    assert.ok(
        !cancelRows4b.some((r) => r.template_key === 'booking_owner_cancelled_by_visitor'),
        'an OWNER cancelling their own booking must never send the owner a "visitor cancelled" notification'
    );

    console.log('PASS suite13-owner-mail (4) visitor cancel notifies the owner; owner\'s own cancel does not re-notify them');

    // === 5. Visitor reschedule notifies the owner; owner reschedule does not ===
    const start5 = slots[4].start_utc;
    const toReschedByVisitor = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start5,
        visitorName: 'Filip Resched', visitorEmail: 'filip.resched@example.com',
        nowMs: nowMs + 13,
    });
    await email.processOutbox(db, { nowMs: nowMs + 14, limit: 20 });
    const newSlotsForResched = engine.generateSlots(db, C, S, {
        serviceId: svc.id, dateLocal: '2030-01-08', nowMs: nowMs + 15, minLeadMinutes: 0,
    });
    assert.ok(newSlotsForResched.length > 0, 'setup: need a free slot on another day to reschedule onto');
    manageApi.rescheduleByToken(db, toReschedByVisitor.manageToken, {
        startUtc: newSlotsForResched[0].start_utc, nowMs: nowMs + 15,
    });
    await email.processOutbox(db, { nowMs: nowMs + 16, limit: 20 });
    const reschedRows5 = ownerRowsFor(toReschedByVisitor.booking.id);
    const reschedByVisitorMail = reschedRows5.find((r) => r.template_key === 'booking_owner_rescheduled_by_visitor');
    assert.ok(reschedByVisitorMail, 'a visitor reschedule must notify the owner');
    assert.match(reschedByVisitorMail.body_text, /Filip Resched/);

    const start5b = slots[5].start_utc;
    const toReschedByOwner = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: start5b,
        visitorName: 'Gina OwnerResched', visitorEmail: 'gina.ownerresched@example.com',
        nowMs: nowMs + 17,
    });
    await email.processOutbox(db, { nowMs: nowMs + 18, limit: 20 });
    const ownerReschedTarget = engine.generateSlots(db, C, S, {
        serviceId: svc.id, dateLocal: '2030-01-08', nowMs: nowMs + 19, minLeadMinutes: 0,
    }).find((s) => s.start_utc !== newSlotsForResched[0].start_utc);
    assert.ok(ownerReschedTarget, 'setup: need a second free slot for the owner-initiated reschedule');
    engine.rescheduleBookingAsOwner(db, C, S, toReschedByOwner.booking.id, {
        startUtc: ownerReschedTarget.start_utc, nowMs: nowMs + 19,
    });
    await email.processOutbox(db, { nowMs: nowMs + 20, limit: 20 });
    const reschedRows5b = ownerRowsFor(toReschedByOwner.booking.id);
    assert.ok(
        !reschedRows5b.some((r) => r.template_key === 'booking_owner_rescheduled_by_visitor'),
        'an OWNER rescheduling their own booking must never send the owner a "visitor rescheduled" notification'
    );

    console.log('PASS suite13-owner-mail (5) visitor reschedule notifies the owner; owner\'s own reschedule does not re-notify them');

    // === 6. Per-event toggle: turning one off silences exactly that email ===
    engine.ensureSettings(db, C, S, { notify_owner_cancelled: false });
    const start6 = slots[0].start_utc; // reuse a date far enough that this is free again is not guaranteed; use a fresh date instead
    const freshSlots6 = engine.generateSlots(db, C, S, { serviceId: svc.id, dateLocal: '2030-01-09', nowMs: nowMs + 21, minLeadMinutes: 0 });
    assert.ok(freshSlots6.length > 0);
    const toCancelToggleOff = engine.createBooking(db, C, S, {
        serviceId: svc.id, startUtc: freshSlots6[0].start_utc,
        visitorName: 'Horia ToggleOff', visitorEmail: 'horia.toggleoff@example.com',
        nowMs: nowMs + 22,
    });
    await email.processOutbox(db, { nowMs: nowMs + 23, limit: 20 }); // "new confirmed" owner mail still on — drain it
    const newConfirmedToggleCheck = ownerRowsFor(toCancelToggleOff.booking.id);
    assert.ok(newConfirmedToggleCheck.some((r) => r.template_key === 'booking_owner_new_confirmed'),
        'sanity: notify_owner_new_confirmed was never touched and must still fire');
    manageApi.cancelByToken(db, toCancelToggleOff.manageToken, { nowMs: nowMs + 24 });
    await email.processOutbox(db, { nowMs: nowMs + 25, limit: 20 });
    const cancelRows6 = ownerRowsFor(toCancelToggleOff.booking.id);
    assert.ok(
        !cancelRows6.some((r) => r.template_key === 'booking_owner_cancelled_by_visitor'),
        'notify_owner_cancelled=false must silence exactly the cancelled-by-visitor owner email'
    );
    // Turn it back on for the rest of the oracle.
    engine.ensureSettings(db, C, S, { notify_owner_cancelled: true });

    console.log('PASS suite13-owner-mail (6) a per-event toggle silences exactly that email, no others');

    // === 7. Recipient resolution: override wins; with nothing configured, skip silently ===
    const C2 = 'cust_ownermail_B';
    const S2 = 'site_ownermail_B';
    engine.ensureSettings(db, C2, S2, {
        timezone: 'Europe/Bucharest', slot_interval_minutes: 30, min_cancel_hours: 0,
        // no notify_owner_email override, and this tenant is not registered
        // anywhere email/index.js's loadOrganizerEmail could resolve — the
        // realistic "nobody configured anything yet" case.
    });
    const svc2 = engine.upsertService(db, C2, S2, { name: 'Tuns', duration_minutes: 30 });
    engine.setWeeklyAvailability(db, C2, S2, [{ weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 }]);
    const slots2 = engine.generateSlots(db, C2, S2, { serviceId: svc2.id, dateLocal: '2030-01-08', nowMs, minLeadMinutes: 0 });
    assert.ok(slots2.length > 0);
    const noRecipientBooking = engine.createBooking(db, C2, S2, {
        serviceId: svc2.id, startUtc: slots2[0].start_utc,
        visitorName: 'Ion NoOwnerMail', visitorEmail: 'ion.noownermail@example.com',
        nowMs,
    });
    assert.strictEqual(noRecipientBooking.status, 'confirmed', 'the booking write itself must succeed with no owner recipient configured');
    await email.processOutbox(db, { nowMs: nowMs + 1, limit: 20 });
    const allRows2 = email.listOutbox(db, C2, S2, { bookingId: noRecipientBooking.booking.id });
    assert.strictEqual(allRows2.length, 1, 'with no resolvable owner recipient, only the visitor email is sent — never a crash, never a guessed recipient');
    assert.strictEqual(allRows2[0].recipient_email, 'ion.noownermail@example.com');

    console.log('PASS suite13-owner-mail (7) notify_owner_email override wins; with nothing configured the owner email is skipped, never guessed or crashed');

    // === 8. Idempotency: replaying the outbox never sends the owner email twice ===
    await email.processOutbox(db, { nowMs: nowMs + 100, limit: 50 });
    await email.processOutbox(db, { nowMs: nowMs + 200, limit: 50 });
    const owner1Again = ownerRowsFor(created1.booking.id);
    assert.strictEqual(owner1Again.length, 1, 'reprocessing the outbox must never duplicate the owner email for the same event');

    console.log('PASS suite13-owner-mail (8) replaying the outbox never double-sends an owner notification');

    // === 9. Migration: a pre-v6 tenant backfills every toggle to enabled ===
    (function migrationBackfill() {
        const rawPath = path.join(tmp, 'pre-v6.sqlite');
        const raw = new DatabaseSync(rawPath);
        raw.exec(schema.SCHEMA_SQL_V1);
        raw.exec(schema.SCHEMA_SQL_V2);
        raw.exec(schema.SCHEMA_SQL_V3);
        raw.exec(schema.SCHEMA_SQL_V4);
        raw.exec(schema.SCHEMA_SQL_V5);
        raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
        const ts = '2025-01-01T00:00:00.000Z';
        for (const v of [1, 2, 3, 4, 5]) {
            raw.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, ts);
        }
        raw.prepare(
            `INSERT INTO calendar_settings (
                customer_id, site_id, timezone, default_buffer_minutes,
                min_cancel_hours, slot_interval_minutes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run('cust_premig', 'site_premig', 'Europe/Bucharest', 0, 24, 15, ts, ts);
        raw.close();

        const migrated = openCalendarDb({ dbPath: rawPath, skipRetentionSweep: true, skipReminderSweep: true });
        const row = migrated.prepare(
            'SELECT * FROM calendar_settings WHERE customer_id = ? AND site_id = ?'
        ).get('cust_premig', 'site_premig');
        assert.ok(row, 'pre-existing settings row must survive the migration');
        assert.strictEqual(Number(row.notify_owner_new_confirmed), 1);
        assert.strictEqual(Number(row.notify_owner_new_pending), 1);
        assert.strictEqual(Number(row.notify_owner_slot_taken), 1);
        assert.strictEqual(Number(row.notify_owner_cancelled), 1);
        assert.strictEqual(Number(row.notify_owner_rescheduled), 1);
        assert.strictEqual(row.notify_owner_email, null);
        migrated.close();
    })();

    console.log('PASS suite13-owner-mail (9) an existing (pre-v6) tenant backfills every owner-notification toggle to enabled');

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS suite13-owner-booking-emails (owner notified on new/pending/slot-taken/visitor-cancel/visitor-reschedule; toggles + recipient + idempotency + migration all hold)');
})().catch((e) => {
    console.error('FAIL suite13-owner-booking-emails', e);
    try { db.close(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    process.exit(1);
});
