'use strict';
/**
 * Oracle — Wave 6 booking-window policy (audit finding #26): owner-configurable
 * minimum notice + maximum advance horizon, enforced server-side.
 *
 * Proves:
 *  1. Defaults (0 minutes / no cap) are fully permissive — a tenant that never
 *     configures the policy behaves exactly as before this wave.
 *  2. min_notice_minutes rejects a too-soon booking (createBooking) even
 *     though the requested start is technically still in the future.
 *  3. min_notice_minutes hides the same too-soon slot from the public slot
 *     listing (not merely hidden client-side — the server never offers it).
 *  4. max_advance_days rejects a too-far booking and truncates the slot
 *     listing at the horizon.
 *  5. A crafted request with a forged/valid-looking start_utc that violates
 *     the policy is still rejected at booking time — the check is not only
 *     in slot generation.
 *  6. Reschedule (owner path) is gated by the same policy for the new slot.
 *
 * Run: node --experimental-sqlite bot/test/wave6-calendar-booking-window.test.js
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
const publicApi = require('../calendar-native/public-api');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-window-'));
const db = openCalendarDb({
    dbPath: path.join(tmp, 'window.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true,
});

const C = 'cust_window_A';
const S = 'site_window_A';

// A Monday, open 00:00-23:59 so any hour-of-day math below stays simple.
engine.ensureSettings(db, C, S, {
    timezone: 'UTC',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
    min_cancel_hours: 0,
});
const svc = engine.upsertService(db, C, S, {
    name: 'Ședință',
    duration_minutes: 30,
});
engine.setWeeklyAvailability(db, C, S, [
    { weekday: 1, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 2, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 3, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 4, start_minute: 0, end_minute: 24 * 60 },
    { weekday: 5, start_minute: 0, end_minute: 24 * 60 },
]);

const nowMs = Date.UTC(2031, 5, 2, 8, 0, 0); // Monday 2031-06-02 08:00 UTC

// --- 1. Defaults are permissive: a booking 10 minutes out succeeds ---
{
    const soonStart = new Date(nowMs + 10 * 60000).toISOString();
    const r = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: soonStart,
        visitorName: 'Fără politică',
        visitorEmail: 'fara.politica@example.com',
        nowMs,
    });
    assert.strictEqual(r.status, 'confirmed', 'default policy must not block a near-term booking');
}

// --- Now turn the policy on: >= 2h notice, <= 30 days advance ---
engine.ensureSettings(db, C, S, {
    min_notice_minutes: 120,
    max_advance_days: 30,
});

// --- 2. Too-soon booking is rejected at booking time ---
{
    const tooSoon = new Date(nowMs + 30 * 60000).toISOString(); // only 30 min out
    let err = null;
    try {
        engine.createBooking(db, C, S, {
            serviceId: svc.id,
            startUtc: tooSoon,
            visitorName: 'Prea Devreme',
            visitorEmail: 'prea.devreme@example.com',
            nowMs,
        });
    } catch (e) {
        err = e;
    }
    assert.ok(err, 'must reject a booking inside the minimum-notice window');
    assert.strictEqual(err.code, 'MIN_NOTICE');
}

// --- 3. The same too-soon slot never appears in the public listing ---
{
    const dateLocal = '2031-06-02';
    const out = publicApi.listPublicSlots(db, C, S, {
        serviceId: svc.id,
        fromDateLocal: dateLocal,
        toDateLocal: dateLocal,
        nowMs,
        minLeadMinutes: 0, // caller asks for none — settings must still enforce 120
    });
    assert.ok(out.ok, 'slot listing must succeed');
    const tooSoonIso = new Date(nowMs + 30 * 60000).toISOString();
    assert.ok(
        !out.slots.some((s) => s.startUtc === tooSoonIso),
        'a slot inside the minimum-notice window must never be listed, not just rejected at booking time'
    );
    // A slot comfortably past the 2h notice threshold must still be listed.
    const okIso = new Date(nowMs + 180 * 60000).toISOString();
    assert.ok(
        out.slots.some((s) => s.startUtc === okIso),
        'a slot past the minimum-notice window must still be offered'
    );
}

// --- 4. Too-far booking is rejected, and the listing is truncated at the horizon ---
{
    const tooFar = new Date(nowMs + 45 * 86400000).toISOString(); // 45 days out (cap is 30)
    let err = null;
    try {
        engine.createBooking(db, C, S, {
            serviceId: svc.id,
            startUtc: tooFar,
            visitorName: 'Prea Departe',
            visitorEmail: 'prea.departe@example.com',
            nowMs,
        });
    } catch (e) {
        err = e;
    }
    assert.ok(err, 'must reject a booking beyond the maximum-advance horizon');
    assert.strictEqual(err.code, 'MAX_ADVANCE');

    const farFromLocal = '2031-07-10'; // 38 days out — past the 30-day cap (nowMs + 30d = 2031-07-02)
    const farOut = publicApi.listPublicSlots(db, C, S, {
        serviceId: svc.id,
        fromDateLocal: farFromLocal,
        toDateLocal: farFromLocal,
        nowMs,
    });
    assert.ok(farOut.ok);
    assert.strictEqual(farOut.slots.length, 0, 'a date beyond max_advance_days must list no slots');
}

// --- 5. Crafted request: a booking-time bypass attempt via public-api ---
{
    const tooSoon = new Date(nowMs + 5 * 60000).toISOString();
    const out = publicApi.createPublicBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: tooSoon,
        visitorName: 'Atac',
        visitorEmail: 'atac@example.com',
    }, { nowMs });
    assert.ok(out.error, 'a forged too-soon start_utc must be rejected at the HTTP-facing API too');
    assert.strictEqual(out.code, 'MIN_NOTICE');
    assert.strictEqual(out.status, 400);
}

// --- 6. Owner reschedule onto a policy-violating slot is rejected too ---
{
    const okStart = new Date(nowMs + 180 * 60000).toISOString();
    const created = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: okStart,
        visitorName: 'De Reprogramat',
        visitorEmail: 'de.reprogramat@example.com',
        nowMs,
    });
    assert.strictEqual(created.status, 'confirmed');

    const tooSoonTarget = new Date(nowMs + 15 * 60000).toISOString();
    let err = null;
    try {
        engine.rescheduleBookingAsOwner(db, C, S, created.booking.id, {
            startUtc: tooSoonTarget,
            nowMs,
        });
    } catch (e) {
        err = e;
    }
    assert.ok(err, 'owner reschedule onto a too-soon slot must be rejected');
    assert.strictEqual(err.code, 'MIN_NOTICE');

    // Original booking must be completely untouched by the failed reschedule attempt.
    const stillThere = engine.getBooking(db, C, S, created.booking.id);
    assert.strictEqual(stillThere.start_utc, okStart);
    assert.strictEqual(stillThere.status, 'confirmed');
}

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS wave6-calendar-booking-window (min-notice + max-advance enforced in listing and at booking time)');
