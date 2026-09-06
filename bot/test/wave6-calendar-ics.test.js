'use strict';
/**
 * Oracle — Wave 6 .ics calendar attachment (audit finding #26: confirmed
 * absent; only false-positive "ics" matches like publicService existed).
 *
 * Proves:
 *  1. Confirmed booking → outbox row carries a non-empty .ics attachment
 *  2. The .ics parses back cleanly (RFC 5545 round-trip) with the required
 *     properties: UID, DTSTAMP, DTSTART/DTEND (UTC, "...Z" form), SUMMARY,
 *     DESCRIPTION, LOCATION, ORGANIZER, STATUS, SEQUENCE, METHOD
 *  3. CRLF line endings throughout, and long lines are folded at <= 75
 *     octets with a single-space continuation (RFC 5545 §3.1)
 *  4. Requested / reschedule_needed bookings get NO .ics (nothing confirmed
 *     to add to a calendar — honesty rule extends to the calendar object)
 *  5. Cancel emits METHOD:CANCEL with the SAME UID and a bumped SEQUENCE
 *  6. Reschedule-confirm emits an updated event, same UID, bumped SEQUENCE,
 *     new DTSTART/DTEND
 *  7. SEQUENCE is monotonic across the whole lifecycle (0 → 1 → 2 → ...)
 *
 * Run: node --experimental-sqlite bot/test/wave6-calendar-ics.test.js
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
const ics = require('../calendar-native/ics');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-ics-'));
const EVIDENCE_DIR = path.join(
    path.resolve(__dirname, '../..'),
    '04-QA-Evidence/Wave6-calendar'
);
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const db = openCalendarDb({
    dbPath: path.join(tmp, 'ics.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true,
});
email.setTransport(email.createMemoryTransport());

const C = 'cust_ics_A';
const S = 'site_ics_A';

engine.ensureSettings(db, C, S, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
});
const svc = engine.upsertService(db, C, S, {
    name: 'Consultație cu diacritice ăâîșț',
    duration_minutes: 30,
});
engine.setWeeklyAvailability(db, C, S, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 3, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 4, start_minute: 9 * 60, end_minute: 17 * 60 },
    { weekday: 5, start_minute: 9 * 60, end_minute: 17 * 60 },
]);

const nowMs = Date.UTC(2026, 0, 1);
const DATE = '2030-01-07'; // Monday
const slots = engine.generateSlots(db, C, S, { serviceId: svc.id, dateLocal: DATE, nowMs, minLeadMinutes: 0 });
assert.ok(slots.length >= 2, 'need free slots');

function assertNoBareLf(text) {
    // Every line break must be CRLF — a bare \n or bare \r is a malformed ICS.
    const withoutCrlf = text.replace(/\r\n/g, '');
    assert.ok(!withoutCrlf.includes('\n'), 'no bare LF outside CRLF pairs');
    assert.ok(!withoutCrlf.includes('\r'), 'no bare CR outside CRLF pairs');
}

function assertFoldedProperly(text) {
    const physicalLines = text.split('\r\n');
    // drop the trailing empty element from the final CRLF
    if (physicalLines[physicalLines.length - 1] === '') physicalLines.pop();
    for (const l of physicalLines) {
        const byteLen = Buffer.byteLength(l, 'utf8');
        assert.ok(byteLen <= 75, 'no physical line exceeds 75 octets: ' + JSON.stringify(l) + ' (' + byteLen + ')');
    }
    // continuation lines start with exactly one space
    for (let i = 1; i < physicalLines.length; i++) {
        if (physicalLines[i].startsWith(' ')) {
            assert.ok(!physicalLines[i - 1].endsWith('\r'), 'no stray CR before a folded continuation');
        }
    }
}

(async function main() {
    // --- 1+2+3. Confirmed booking → valid, parseable, properly-folded .ics ---
    const start1 = slots[0].start_utc;
    const created = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: start1,
        visitorName: 'Ana Ionescu',
        visitorEmail: 'ana.ionescu@example.com',
        nowMs,
    });
    assert.strictEqual(created.status, 'confirmed');
    await email.processOutbox(db, { nowMs, limit: 10 });

    let rows = email.listOutbox(db, C, S, { bookingId: created.booking.id, includeBodies: true });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].has_ics ? 1 : rows[0].has_ics, 1, 'confirmed booking must carry an .ics');
    assert.ok(rows[0].ics_content && rows[0].ics_content.length > 0);
    assert.strictEqual(rows[0].ics_filename, 'programare.ics');

    const icsText = rows[0].ics_content;
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'sample-confirmed.ics'), icsText);
    assertNoBareLf(icsText);
    assertFoldedProperly(icsText);

    const props = ics.parseIcs(icsText);
    const byName = {};
    for (const p of props) {
        (byName[p.name] = byName[p.name] || []).push(p);
    }
    const required = ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'ORGANIZER', 'STATUS', 'SEQUENCE', 'METHOD'];
    for (const name of required) {
        assert.ok(byName[name] && byName[name].length >= 1, 'missing required property ' + name);
    }
    assert.strictEqual(byName.METHOD[0].value, 'REQUEST');
    assert.strictEqual(byName.STATUS[0].value, 'CONFIRMED');
    assert.strictEqual(byName.SEQUENCE[0].value, '0', 'first .ics for a booking is SEQUENCE 0');
    assert.match(byName.DTSTART[0].value, /^\d{8}T\d{6}Z$/, 'DTSTART must be UTC form');
    assert.match(byName.DTEND[0].value, /^\d{8}T\d{6}Z$/, 'DTEND must be UTC form');
    assert.match(byName.DTSTAMP[0].value, /^\d{8}T\d{6}Z$/, 'DTSTAMP must be UTC form');
    const uid1 = byName.UID[0].value;
    assert.ok(uid1.includes(created.booking.id), 'UID must be stable/derived from the booking id');
    assert.match(byName.ORGANIZER[0].value, /^mailto:/);
    // Round-trip: DTSTART must match the booking's own start_utc instant.
    const dtStart = byName.DTSTART[0].value;
    const parsedBackMs = Date.UTC(
        Number(dtStart.slice(0, 4)), Number(dtStart.slice(4, 6)) - 1, Number(dtStart.slice(6, 8)),
        Number(dtStart.slice(9, 11)), Number(dtStart.slice(11, 13)), Number(dtStart.slice(13, 15))
    );
    assert.strictEqual(parsedBackMs, Date.parse(created.booking.start_utc), 'DTSTART round-trips to the exact booking start instant');

    fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'parse-back-confirmed.json'),
        JSON.stringify({ properties: props, requiredPresent: required, byteLength: Buffer.byteLength(icsText, 'utf8') }, null, 2)
    );

    // --- 4. Conflict (requested/reschedule_needed) → no .ics ---
    const conflict = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: start1,
        visitorName: 'Conflict',
        visitorEmail: 'conflict@example.com',
        nowMs,
    });
    assert.notStrictEqual(conflict.status, 'confirmed');
    await email.processOutbox(db, { nowMs: nowMs + 1, limit: 10 });
    const conflictRows = email.listOutbox(db, C, S, { bookingId: conflict.booking.id, includeBodies: true });
    assert.strictEqual(conflictRows.length, 1);
    assert.ok(!conflictRows[0].has_ics, 'an unconfirmed booking must never get an .ics attachment');
    assert.strictEqual(conflictRows[0].ics_content, null);

    // --- 6+7. Reschedule-confirmed → updated event, same UID, SEQUENCE bumped to 1 ---
    const start2 = slots[1].start_utc;
    const rescheduled = engine.rescheduleBookingAsOwner(db, C, S, created.booking.id, {
        startUtc: start2,
        nowMs: nowMs + 2,
    });
    assert.strictEqual(rescheduled.status, 'confirmed');
    await email.processOutbox(db, { nowMs: nowMs + 3, limit: 10 });
    const reschedRows = email.listOutbox(db, C, S, { bookingId: created.booking.id, includeBodies: true })
        .filter((r) => r.template_key === 'booking_reschedule_confirmed');
    assert.strictEqual(reschedRows.length, 1);
    assert.ok(reschedRows[0].has_ics);
    const reschedProps = ics.parseIcs(reschedRows[0].ics_content);
    const reschedByName = {};
    for (const p of reschedProps) (reschedByName[p.name] = reschedByName[p.name] || []).push(p);
    assert.strictEqual(reschedByName.UID[0].value, uid1, 'UID stays stable across reschedule');
    assert.strictEqual(reschedByName.METHOD[0].value, 'REQUEST');
    assert.strictEqual(reschedByName.SEQUENCE[0].value, '1', 'SEQUENCE bumps on reschedule');
    assert.notStrictEqual(reschedByName.DTSTART[0].value, dtStart, 'DTSTART reflects the new time');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'sample-reschedule-confirmed.ics'), reschedRows[0].ics_content);

    // --- 5. Cancel → METHOD:CANCEL, same UID, SEQUENCE bumped again ---
    const cancelled = engine.cancelBookingAsOwner(db, C, S, created.booking.id);
    assert.strictEqual(cancelled.status, 'cancelled');
    await email.processOutbox(db, { nowMs: nowMs + 4, limit: 10 });
    const cancelRows = email.listOutbox(db, C, S, { bookingId: created.booking.id, includeBodies: true })
        .filter((r) => r.template_key === 'booking_cancelled');
    assert.strictEqual(cancelRows.length, 1);
    assert.ok(cancelRows[0].has_ics, 'cancellation must carry a CANCEL .ics so the visitor calendar stays in sync');
    const cancelText = cancelRows[0].ics_content;
    assertNoBareLf(cancelText);
    assertFoldedProperly(cancelText);
    const cancelProps = ics.parseIcs(cancelText);
    const cancelByName = {};
    for (const p of cancelProps) (cancelByName[p.name] = cancelByName[p.name] || []).push(p);
    assert.strictEqual(cancelByName.METHOD[0].value, 'CANCEL');
    assert.strictEqual(cancelByName.STATUS[0].value, 'CANCELLED');
    assert.strictEqual(cancelByName.UID[0].value, uid1, 'UID stays stable through cancellation');
    assert.strictEqual(cancelByName.SEQUENCE[0].value, '2', 'SEQUENCE monotonic: confirm=0, reschedule=1, cancel=2');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'sample-cancelled.ics'), cancelText);

    // --- The memory transport actually receives the attachment fields ---
    const sent = email.outbox.getTransport().getSent();
    const cancelSent = sent.find((m) => m.bookingId === created.booking.id && m.templateKey === 'booking_cancelled');
    assert.ok(cancelSent && cancelSent.icsContent, 'transport.send() must receive the .ics content');
    assert.strictEqual(cancelSent.icsFilename, 'programare.ics');

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS wave6-calendar-ics (RFC 5545 build + parse-back, REQUEST/CANCEL lifecycle, monotonic SEQUENCE)');
})().catch((e) => {
    console.error('FAIL wave6-calendar-ics', e);
    try { db.close(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    process.exit(1);
});
