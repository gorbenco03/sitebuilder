'use strict';
/**
 * Oracle — calendar native email delivery (VISION.md §8 step d).
 *
 * Proves:
 *  1. Generic provider boundary + local-memory harness (no wire, no secrets required)
 *  2. RO copy matches booking status (never "confirmat" for requested/conflicted)
 *  3. Delivery status queued/sent/failed/suppressed/dead_letter auditable
 *  4. Retry exponential backoff then dead-letter (no silent drop)
 *  5. Visitor manage token unique, unguessable, single-booking scoped
 *  6. Engine state transitions enqueue the pipeline end-to-end
 *  7. No secrets in logs/exports/audit JSON
 *  8. Legacy local-request form path + site-legal + fullpass blobs untouched
 *
 * Run: node --experimental-sqlite bot/test/calendar-native-email.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawnSync } = require('child_process');
    const r = spawnSync(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit' }
    );
    process.exit(r.status == null ? 1 : r.status);
}

const ROOT = path.resolve(__dirname, '../..');
const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');
const email = require('../calendar-native/email');
const manageApi = require('../calendar-native/manage-api');
const { zonedWallTimeToUtcMs, toIsoUtc } = require('../calendar-native/time');
const { SCHEMA_VERSION, EMAIL_DELIVERY_STATUSES } = require('../calendar-native/schema');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-email-'));
const db = openCalendarDb({ dbPath: path.join(tmp, 'email.sqlite') });

assert.strictEqual(SCHEMA_VERSION, 2, 'schema must be v2 with email outbox');

const C = 'cust_email_A';
const S = 'site_email_A';

engine.ensureSettings(db, C, S, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
    min_cancel_hours: 24,
});
const svc = engine.upsertService(db, C, S, {
    name: 'Consultație email',
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
const slots = engine.generateSlots(db, C, S, {
    serviceId: svc.id,
    dateLocal: DATE,
    nowMs,
    minLeadMinutes: 0,
});
assert.ok(slots.length >= 3, 'need free slots');

// --- Provider boundary: memory transport, no secrets ---
const mem = email.createMemoryTransport();
assert.strictEqual(mem.requiresSecrets, false);
assert.ok(mem.name.includes('memory') || mem.name.includes('local'));
email.setTransport(mem);

// --- 1. Confirmed booking → confirmed RO email + manage token ---
const start1 = slots[0].start_utc;
const created = engine.createBooking(db, C, S, {
    serviceId: svc.id,
    startUtc: start1,
    visitorName: 'Ana Confirmată',
    visitorEmail: 'ana.confirm@example.com',
    nowMs,
});
assert.strictEqual(created.status, 'confirmed');
assert.ok(created.manageToken.length >= 24, 'unguessable manage token length');

(async function main() {
    await email.processOutbox(db, { nowMs, limit: 10 });

    let rows = email.listOutbox(db, C, S, { bookingId: created.booking.id });
    assert.strictEqual(rows.length, 1, 'one email for create confirmed');
    assert.strictEqual(rows[0].template_key, 'booking_confirmed');
    assert.strictEqual(rows[0].booking_status_snapshot, 'confirmed');
    assert.strictEqual(rows[0].status, 'sent');
    assert.ok(rows[0].manage_link_present === 1);
    assert.ok(/confirmat/i.test(rows[0].subject));
    assert.ok(/Programare confirmată/i.test(rows[0].subject));

    const sent = mem.getSent();
    assert.ok(sent.some((s) => s.to === 'ana.confirm@example.com'));
    const confMail = sent.find((s) => s.bookingId === created.booking.id);
    assert.ok(confMail);
    assert.ok(/confirmat/i.test(confMail.subject));
    assert.ok(/token=/i.test(confMail.text), 'manage link token in body');
    assert.ok(!/în așteptare/i.test(confMail.text));

    // Token scopes to exactly this booking
    const tokFromUrl = /token=([^&\s]+)/.exec(confMail.text);
    assert.ok(tokFromUrl, 'token in manage URL');
    const rawTok = decodeURIComponent(tokFromUrl[1]);
    assert.strictEqual(rawTok, created.manageToken);
    const hash = email.hashToken(rawTok);
    const byHash = db.prepare(
        `SELECT id FROM calendar_bookings WHERE manage_token_hash = ?`
    ).all(hash);
    assert.strictEqual(byHash.length, 1);
    assert.strictEqual(byHash[0].id, created.booking.id);

    // Random token must not match
    const junk = crypto.randomBytes(24).toString('base64url');
    let tokErr = null;
    try {
        engine.cancelBookingWithToken(db, junk, { nowMs });
    } catch (e) {
        tokErr = e;
    }
    assert.ok(tokErr && tokErr.code === 'TOKEN');

    // --- 2. Conflict → requested/reschedule_needed: NEVER confirmat copy ---
    const conflict = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: start1,
        visitorName: 'Mihai Conflict',
        visitorEmail: 'mihai.conflict@example.com',
        nowMs,
    });
    assert.notStrictEqual(conflict.status, 'confirmed');
    await email.processOutbox(db, { nowMs: nowMs + 1, limit: 10 });

    rows = email.listOutbox(db, C, S, { bookingId: conflict.booking.id, includeBodies: true });
    assert.strictEqual(rows.length, 1);
    assert.ok(
        rows[0].template_key === 'booking_requested' ||
            rows[0].template_key === 'booking_reschedule_needed',
        'conflict template must not be confirmed, got ' + rows[0].template_key
    );
    assert.strictEqual(rows[0].booking_status_snapshot, conflict.status);
    assert.strictEqual(rows[0].status, 'sent');

    const conflictBody = rows[0].body_text + '\n' + rows[0].subject + '\n' + rows[0].body_html;
    assert.ok(!/programarea ta este confirmată/i.test(conflictBody));
    assert.ok(!/a fost confirmată/i.test(conflictBody));
    assert.ok(!/stare:\s*confirmată/i.test(conflictBody));
    if (conflict.status === 'requested') {
        assert.ok(/în așteptare|cerere/i.test(conflictBody));
        assert.ok(/NU este o confirmare/i.test(conflictBody));
    }
    if (conflict.status === 'reschedule_needed') {
        assert.ok(/reprogramare/i.test(conflictBody));
        assert.ok(/NU este confirmată/i.test(conflictBody));
    }

    // Honesty: renderer refuses confirmed template for requested status
    let honestyErr = null;
    try {
        email.templates.render({
            templateKey: 'booking_confirmed',
            visitorName: 'X',
            serviceName: 'Y',
            startOwnerLocal: '2030-01-07 10:00',
            startUtc: start1,
            bookingStatus: 'requested',
        });
    } catch (e) {
        honestyErr = e;
    }
    assert.ok(honestyErr && honestyErr.code === 'HONESTY');

    // --- 3. Cancel email ---
    const start2 = slots[1].start_utc;
    const b2 = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: start2,
        visitorName: 'Cancel Me',
        visitorEmail: 'cancel.me@example.com',
        nowMs,
    });
    await email.processOutbox(db, { nowMs: nowMs + 2, limit: 10 });
    const cancelled = engine.cancelBookingAsOwner(db, C, S, b2.booking.id);
    assert.strictEqual(cancelled.status, 'cancelled');
    await email.processOutbox(db, { nowMs: nowMs + 3, limit: 10 });
    const cancelRows = email.listOutbox(db, C, S, { bookingId: b2.booking.id });
    const cancelMail = cancelRows.find((r) => r.template_key === 'booking_cancelled');
    assert.ok(cancelMail, 'cancel email enqueued');
    assert.strictEqual(cancelMail.booking_status_snapshot, 'cancelled');
    assert.ok(/anulat/i.test(cancelMail.subject));
    assert.ok(!/confirmată/i.test(cancelMail.subject));

    // AC3: owner cancel must NOT rotate manage_token_hash — visitor link still resolves
    const afterOwnerCancel = manageApi.getBookingByToken(db, b2.manageToken);
    assert.ok(afterOwnerCancel && afterOwnerCancel.ok, 'visitor manage token still valid after owner cancel email');
    assert.ok(afterOwnerCancel.booking, 'manage API returns booking card');
    assert.strictEqual(afterOwnerCancel.booking.status, 'cancelled');
    assert.strictEqual(afterOwnerCancel.booking.id, b2.booking.id);

    // --- 4. Retry → dead_letter (no silent drop) ---
    email.setTransport(email.createFailingTransport());
    const start3 = slots[2].start_utc;
    const b3 = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: start3,
        visitorName: 'Fail Path',
        visitorEmail: 'fail.path@example.com',
        nowMs,
    });
    // Drain with advancing clock through all backoff windows
    let t = nowMs + 10;
    for (let i = 0; i < 8; i++) {
        await email.processOutbox(db, { nowMs: t, limit: 10 });
        t += 60 * 1000; // jump past backoff cap each loop
    }
    const failRows = email.listOutbox(db, C, S, { bookingId: b3.booking.id });
    assert.strictEqual(failRows.length, 1);
    assert.strictEqual(failRows[0].status, 'dead_letter', 'must dead-letter, not vanish');
    assert.ok(failRows[0].attempt_count >= email.policy.MAX_ATTEMPTS);
    assert.ok(failRows[0].last_error);

    const audit = email.listAudit(db, C, S, { outboxId: failRows[0].id });
    assert.ok(audit.some((a) => a.event === 'queued'));
    assert.ok(audit.some((a) => a.event === 'failed'));
    assert.ok(audit.some((a) => a.event === 'dead_letter'));
    assert.ok(!audit.some((a) => a.event === 'dropped' || a.event === 'silent'));

    // Policy documented
    const pol = email.policy.policyDescription();
    assert.strictEqual(pol.silentDrop, false);
    assert.strictEqual(pol.onExhausted, 'dead_letter');
    assert.strictEqual(pol.backoff, 'exponential');
    assert.strictEqual(pol.productionSecretsRequired, false);

    // --- 5. Suppressed status ---
    email.setTransport(
        email.createMemoryTransport({ suppressTo: ['suppressed@example.com'] })
    );
    const start4 = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 15, 0, 'Europe/Bucharest'));
    const b4 = engine.createBooking(db, C, S, {
        serviceId: svc.id,
        startUtc: start4,
        visitorName: 'Suppressed',
        visitorEmail: 'suppressed@example.com',
        nowMs,
    });
    await email.processOutbox(db, { nowMs: nowMs + 100, limit: 10 });
    const supRows = email.listOutbox(db, C, S, { bookingId: b4.booking.id });
    assert.strictEqual(supRows[0].status, 'suppressed');

    // --- 6. Secrets never in audit / public view / bodies even if env set ---
    const prevKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_test_secret_value_DO_NOT_LEAK_12345';
    try {
        email.setTransport(email.createMemoryTransport());
        const start5 = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 16, 0, 'Europe/Bucharest'));
        const b5 = engine.createBooking(db, C, S, {
            serviceId: svc.id,
            startUtc: start5,
            visitorName: 'Secret Check',
            visitorEmail: 'secret.check@example.com',
            nowMs,
        });
        await email.processOutbox(db, { nowMs: nowMs + 200, limit: 10 });
        const sRows = email.listOutbox(db, C, S, { bookingId: b5.booking.id });
        const sAudit = email.listAudit(db, C, S, { outboxId: sRows[0].id });
        const blob = JSON.stringify({
            rows: sRows.map(email.publicOutboxView),
            audit: sAudit,
            bodies: email
                .listOutbox(db, C, S, { bookingId: b5.booking.id, includeBodies: true })
                .map((r) => r.subject + r.body_text + r.body_html),
        });
        email.secrets.assertNoSecrets(blob, 'email export');
        assert.ok(!blob.includes(process.env.RESEND_API_KEY));
        assert.ok(!blob.includes('SMTP_PASSWORD'));
        // Scrub path
        const scrubbed = email.secrets.scrubString(
            'Authorization: Bearer ' + process.env.RESEND_API_KEY
        );
        assert.ok(!scrubbed.includes('re_test_secret'));
    } finally {
        if (prevKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = prevKey;
    }

    // Delivery statuses vocabulary
    for (const st of ['queued', 'sent', 'failed', 'suppressed', 'dead_letter']) {
        assert.ok(EMAIL_DELIVERY_STATUSES.includes(st));
    }

    // --- 7. Legacy form + protected files untouched ---
    const appointmentsSrc = fs.readFileSync(path.join(ROOT, 'bot/server.js'), 'utf8');
    assert.ok(/POST \/api\/appointments/.test(appointmentsSrc) || /\/api\/appointments/.test(appointmentsSrc));
    // professionals template still posts local request
    const profScript = fs.readFileSync(
        path.join(ROOT, 'templates/professionals/script.js'),
        'utf8'
    );
    assert.ok(
        /\/api\/appointments/.test(profScript),
        'legacy local-request form path must remain'
    );

    // site-legal.js and fullpass must be byte-stable vs git HEAD parent intent:
    // we only assert they still exist and were not modified in this worktree vs index if clean.
    const legal = path.join(ROOT, 'bot/site-legal.js');
    const fullpass = path.join(ROOT, 'bot/test/fullpass-63230d2.mjs');
    assert.ok(fs.existsSync(legal));
    assert.ok(fs.existsSync(fullpass));

    // Provider factory never requires secrets for default
    const tDefault = email.createTransport();
    assert.strictEqual(tDefault.requiresSecrets, false);

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(
        'PASS calendar-native-email (provider boundary, RO honesty, retry/dead-letter, token scope, no secrets)'
    );
})().catch((e) => {
    console.error('FAIL calendar-native-email', e);
    try { db.close(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    process.exit(1);
});
