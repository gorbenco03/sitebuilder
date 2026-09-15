'use strict';
/**
 * Oracle — suite13 CAL-07: slot generation across DST transitions
 * (Europe/Bucharest 2026-03-29 spring-forward, 2026-10-25 fall-back).
 *
 * Before this fix, engine.js's generateSlotsForResource converted every
 * local wall-clock candidate to UTC with time.js's simple fixed-point
 * zonedWallTimeToUtcMs, which silently:
 *   - on the spring-forward day, mapped the nonexistent 03:00-03:59 hour
 *     onto the SAME UTC instants as 02:00-02:59 (a real collision — two
 *     differently-labelled slots pointing at the same real moment), and
 *   - on the fall-back day, always resolved the ambiguous 03:00-03:59 hour
 *     to only its post-transition (EET) offset, so the first (EEST)
 *     occurrence was never offered at all — a silently lost bookable hour.
 *
 * Proves:
 *  0. Direct oracle on time.js's own DST resolver — the spring gap
 *     genuinely does not exist under the OLD zonedWallTimeToUtcMs-only
 *     approach (it silently maps the nonexistent local 03:00 onto the same
 *     UTC instant as 02:00 — collision, not detection); resolveZonedWallTime
 *     must report zero real instants for it, and two for the fall-back hour.
 *     NOTE: at the engine.generateSlots() level (section 1 below), the
 *     spring-forward collision happens to be invisible from the outside for
 *     a single-resource tenant — engine.js merges slots into a Map keyed by
 *     start_utc, so the colliding "local 03:00" duplicate silently collapses
 *     onto the already-present "local 02:00" entry and the returned slot
 *     COUNT for that day comes out right (46) by coincidence, not by
 *     correctness. This section 0 is what actually catches the bug: it
 *     fails red against the pre-fix time.js because
 *     resolveZonedWallTime does not exist there at all.
 *  1. Spring-forward: the nonexistent local hour is never offered — every
 *     other half-hour slot that day is unaffected, count matches exactly.
 *  2. Fall-back: the ambiguous local hour is offered as TWO distinct,
 *     correctly time-tagged instants (never one lost, never one silently
 *     duplicated as the same start_utc). THIS one fails red end-to-end
 *     through engine.generateSlots() against the pre-fix code (48 vs the
 *     expected 50) — the fall-back hour's lost occurrence is NOT masked by
 *     the Map-merge the way the spring gap collision is.
 *  3. Both fall-back instants are independently bookable and confirm to
 *     different start_utc values exactly one hour apart — never the same
 *     UTC instant twice (no double-booking).
 *  4. The visitor confirmation for an ambiguous booking shows the UTC
 *     offset, so "03:00" is unambiguous even though it happened twice.
 *
 * Run: node --experimental-sqlite bot/test/suite13-dst-slots.test.js
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
const timeModule = require('../calendar-native/time');
const { getZonedParts } = timeModule;

// === 0. Direct oracle on time.js's DST resolver (see doc comment above) ===
(function directTimeModuleOracle() {
    assert.strictEqual(
        typeof timeModule.resolveZonedWallTime, 'function',
        'time.js must export resolveZonedWallTime (CAL-07 fix) — this is the assertion that actually fails red pre-fix'
    );
    const gap = timeModule.resolveZonedWallTime(2026, 3, 29, 3, 0, 'Europe/Bucharest');
    assert.strictEqual(gap.length, 0, 'the nonexistent spring-forward local time must resolve to zero real instants');

    const overlap = timeModule.resolveZonedWallTime(2026, 10, 25, 3, 0, 'Europe/Bucharest');
    assert.strictEqual(overlap.length, 2, 'the ambiguous fall-back local time must resolve to exactly two real instants');
    assert.strictEqual(overlap[1].utcMs - overlap[0].utcMs, 3600000, 'the two instants must be exactly one hour apart');
    assert.strictEqual(overlap[0].offsetMinutes, 180, 'the earlier instant must carry the EEST (+03:00) offset');
    assert.strictEqual(overlap[1].offsetMinutes, 120, 'the later instant must carry the EET (+02:00) offset');

    const normal = timeModule.resolveZonedWallTime(2026, 6, 15, 9, 0, 'Europe/Bucharest');
    assert.strictEqual(normal.length, 1, 'an ordinary day must resolve to exactly one instant');

    console.log('PASS suite13-dst (0) time.js resolveZonedWallTime: gap -> 0 instants, fall-back -> 2 correctly-offset instants, normal day -> 1');
})();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-dst-'));
const db = openCalendarDb({
    dbPath: path.join(tmp, 'dst.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true,
});
email.setTransport(email.createMemoryTransport());

const TZ = 'Europe/Bucharest';
const C = 'cust_dst_A';
const S = 'site_dst_A';
const nowMs = Date.UTC(2026, 0, 1);

engine.ensureSettings(db, C, S, {
    timezone: TZ,
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
    min_cancel_hours: 0,
});
const svc = engine.upsertService(db, C, S, { name: 'Ședință', duration_minutes: 30 });
// Both 2026-03-29 and 2026-10-25 are Sundays (ISO weekday 7) — open the
// whole day so the transition hour sits well inside the window, not at an
// edge where a boundary bug could hide the defect.
engine.setWeeklyAvailability(db, C, S, [
    { weekday: 7, start_minute: 0, end_minute: 24 * 60 },
]);

function localPartsOf(startUtc) {
    return getZonedParts(new Date(Date.parse(startUtc)), TZ);
}

// === 1. Spring-forward: 2026-03-29, the 03:00-03:59 hour never happens ===
(function springForward() {
    const DATE = '2026-03-29';
    const slots = engine.generateSlots(db, C, S, {
        serviceId: svc.id, dateLocal: DATE, nowMs, minLeadMinutes: 0,
    });

    // 48 half-hour marks in a day, minus the two (03:00, 03:30) that fall
    // inside the skipped hour — no more, no fewer.
    assert.strictEqual(slots.length, 46,
        'spring-forward day must offer exactly 46 half-hour slots (48 - the 2 nonexistent ones), got ' + slots.length);

    for (const s of slots) {
        const p = localPartsOf(s.start_utc);
        assert.strictEqual(p.year, 2026);
        assert.strictEqual(p.month, 3);
        assert.strictEqual(p.day, 29);
        assert.notStrictEqual(p.hour, 3,
            'no slot may resolve to the nonexistent local hour 03:00-03:59, got ' + s.start_utc + ' -> ' + p.hour + ':' + p.minute);
        assert.ok(!s.ambiguousLocal, 'a normal (non-transition) day slot must not be flagged ambiguous');
    }

    // The hour immediately before and after the gap must both still be there,
    // unaffected — 02:30 and 04:00 are the closest neighbours of the gap.
    assert.ok(slots.some((s) => s.start_utc === '2026-03-29T00:30:00.000Z'), 'local 02:30 EET must still be offered');
    assert.ok(slots.some((s) => s.start_utc === '2026-03-29T01:00:00.000Z'), 'local 04:00 EEST must still be offered');

    // No slot silently collides with 02:00/02:30's UTC instant, which is
    // exactly the bug this guards: the nonexistent 03:00/03:30 must not
    // reappear as a second, confusingly-labelled slot at the same instant.
    const startUtcs = slots.map((s) => s.start_utc);
    assert.strictEqual(new Set(startUtcs).size, startUtcs.length, 'every slot start_utc must be unique');

    console.log('PASS suite13-dst (1) spring-forward gap: nonexistent 03:00-03:59 never offered, nothing else lost');
})();

// === 2. Fall-back: 2026-10-25, the 03:00-03:59 hour happens twice ===
let fallBackSlots;
(function fallBack() {
    const DATE = '2026-10-25';
    fallBackSlots = engine.generateSlots(db, C, S, {
        serviceId: svc.id, dateLocal: DATE, nowMs, minLeadMinutes: 0,
    });

    // 48 normal half-hour marks, plus 2 extra instants for the doubled
    // 03:00 and 03:30 marks (2 marks x 2 instants each = 4, vs. 2 if singular
    // → +2 net) = 50 total.
    assert.strictEqual(fallBackSlots.length, 50,
        'fall-back day must offer 50 slots (48 + 2 extra for the doubled hour), got ' + fallBackSlots.length);

    const ambiguous = fallBackSlots.filter((s) => s.ambiguousLocal);
    assert.strictEqual(ambiguous.length, 4, 'exactly 4 slots (2 marks x 2 instants) must be flagged ambiguous');

    // Group the ambiguous ones by local wall-clock reading.
    const byLocal = new Map();
    for (const s of ambiguous) {
        const p = localPartsOf(s.start_utc);
        const key = p.hour + ':' + p.minute;
        assert.strictEqual(p.hour, 3, 'every ambiguous slot must fall in local hour 03, got ' + key);
        if (!byLocal.has(key)) byLocal.set(key, []);
        byLocal.get(key).push(s);
    }
    assert.strictEqual(byLocal.size, 2, 'exactly two distinct local wall-clock readings (03:00 and 03:30) are ambiguous');

    for (const [localKey, pair] of byLocal) {
        assert.strictEqual(pair.length, 2, 'local ' + localKey + ' must offer exactly 2 distinct instants, not 1 (lost) or 3+ (duplicated)');
        const [a, b] = pair.slice().sort((x, y) => (x.start_utc < y.start_utc ? -1 : 1));
        assert.notStrictEqual(a.start_utc, b.start_utc, 'the two instants must never share the same start_utc (no double-booking)');
        const gapMs = Date.parse(b.start_utc) - Date.parse(a.start_utc);
        assert.strictEqual(gapMs, 3600000, 'the two instants for local ' + localKey + ' must be exactly one hour apart');
        // Earlier instant is EEST (+03:00, pre-transition); later is EET (+02:00).
        assert.strictEqual(a.utcOffsetMinutes, 180, 'earlier ambiguous instant must carry the EEST (+03:00) offset');
        assert.strictEqual(b.utcOffsetMinutes, 120, 'later ambiguous instant must carry the EET (+02:00) offset');
    }

    // No accidental UTC collision anywhere in the day's full slot list.
    const startUtcs = fallBackSlots.map((s) => s.start_utc);
    assert.strictEqual(new Set(startUtcs).size, startUtcs.length, 'every slot start_utc must be unique across the whole day');

    console.log('PASS suite13-dst (2) fall-back overlap: doubled 03:00-03:59 hour offers two distinct real instants, never lost or duplicated');
})();

// === 3. Both fall-back instants are independently bookable, never collide ===
(async function bookBothAmbiguousInstants() {
    const ambiguousPair = fallBackSlots
        .filter((s) => s.ambiguousLocal)
        .filter((s) => localPartsOf(s.start_utc).minute === 0)
        .sort((a, b) => (a.start_utc < b.start_utc ? -1 : 1));
    assert.strictEqual(ambiguousPair.length, 2, 'setup: exactly one ambiguous pair at local 03:00');

    const first = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: ambiguousPair[0].start_utc,
        visitorName: 'Prima Instanță',
        visitorEmail: 'prima@example.com',
        nowMs,
    });
    assert.strictEqual(first.status, 'confirmed', 'the earlier (EEST) 03:00 instant must confirm cleanly');

    const second = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: ambiguousPair[1].start_utc,
        visitorName: 'A Doua Instanță',
        visitorEmail: 'adoua@example.com',
        nowMs: nowMs + 1,
    });
    assert.strictEqual(second.status, 'confirmed',
        'the later (EET) 03:00 instant is a DIFFERENT real moment and must ALSO confirm — never treated as already taken');
    assert.notStrictEqual(first.booking.start_utc, second.booking.start_utc);

    await email.processOutbox(db, { nowMs: nowMs + 2, limit: 20 });

    // === 4. Confirmation copy shows the UTC offset when ambiguity is possible ===
    const rows1 = email.listOutbox(db, C, S, { bookingId: first.booking.id, includeBodies: true });
    const rows2 = email.listOutbox(db, C, S, { bookingId: second.booking.id, includeBodies: true });
    const confirm1 = rows1.find((r) => r.template_key === 'booking_confirmed');
    const confirm2 = rows2.find((r) => r.template_key === 'booking_confirmed');
    assert.ok(confirm1 && confirm2, 'both ambiguous bookings must produce a confirmed email');
    assert.match(confirm1.body_text, /UTC\+03:00/, 'the earlier ambiguous instant must show its UTC+03:00 offset in the confirmation');
    assert.match(confirm2.body_text, /UTC\+02:00/, 'the later ambiguous instant must show its UTC+02:00 offset in the confirmation');
    // The two bodies must be visibly different — not the exact same text
    // mailed twice, which would be indistinguishable to the visitor.
    assert.notStrictEqual(confirm1.body_text, confirm2.body_text);

    console.log('PASS suite13-dst (3+4) both fall-back instants book independently and show a disambiguating UTC offset');

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS suite13-dst-slots (CAL-07: spring gap skipped, fall-back doubled hour offered twice and disambiguated)');
})().catch((e) => {
    console.error('FAIL suite13-dst-slots', e);
    try { db.close(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    process.exit(1);
});
