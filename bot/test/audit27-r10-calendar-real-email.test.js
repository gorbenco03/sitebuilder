'use strict';
/**
 * bot/test/audit27-r10-calendar-real-email.test.js
 *
 * Oracle for PLAN-AUDIT-2026-09-27.md task R-10 (finding calendar-native#2):
 * real, env-selectable email transport for the native calendar, reusing the
 * Resend integration bot/email.js already has for magic links — plus a
 * manage-link fallback on the widget's success screen for when delivery is
 * not armed.
 *
 * Fails on the pre-R-10 code because:
 *  - bot/calendar-native/email/outbox.js#getTransport() called
 *    createTransport('local-memory') with a name pinned, so
 *    CALENDAR_EMAIL_TRANSPORT was never even read in production.
 *  - provider.js's 'resend' branch had no real adapter at all — any name
 *    fell back to an unarmed memory transport unconditionally.
 *  - the widget's success screen showed only prose about an email that
 *    might never arrive, with no way for the visitor to reach their own
 *    booking if it doesn't.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r10-calendar-real-email.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
    const candidates = ['playwright', path.join(ROOT, 'node_modules/playwright')];
    for (const cand of candidates) {
        try { return require(cand); } catch (_) { /* try next */ }
    }
    throw new Error('playwright not found — install devDependency (npm install in the repo root)');
}

function withEnv(overrides, fn) {
    const prev = {};
    for (const k of Object.keys(overrides)) prev[k] = process.env[k];
    try {
        for (const k of Object.keys(overrides)) {
            if (overrides[k] === undefined) delete process.env[k];
            else process.env[k] = overrides[k];
        }
        return fn();
    } finally {
        for (const k of Object.keys(prev)) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
        }
    }
}

// ---------------------------------------------------------------------------
// Part 1 — transport wiring (no network, no browser): CALENDAR_EMAIL_TRANSPORT
// actually reaches a real send, through the exact singleton outbox.js uses.
// ---------------------------------------------------------------------------

test('CALENDAR_EMAIL_TRANSPORT=resend + RESEND_API_KEY delivers for real through outbox.getTransport(), reusing bot/email.js', async (t) => {
    const prevFetch = global.fetch;
    let posted = null;
    global.fetch = async (url, opts) => {
        posted = { url: String(url), opts };
        return { ok: true, status: 200, text: async () => '' };
    };

    await withEnv(
        {
            CALENDAR_EMAIL_TRANSPORT: 'resend',
            RESEND_API_KEY: 'test-key-not-real',
            // Deliberately not 'test': proves the real path is reachable
            // outside the test-safety gate. global.fetch is mocked above, so
            // no socket ever opens regardless — never send real email in tests.
            NODE_ENV: 'development',
        },
        async () => {
            const email = require('../calendar-native/email');
            const { openCalendarDb } = require('../calendar-native/db');
            const engine = require('../calendar-native/engine');
            const { zonedWallTimeToUtcMs, toIsoUtc } = require('../calendar-native/time');

            // Deliberately no resetTransport()/setTransport() here: this test
            // exists to prove outbox.js's own lazy default (getTransport())
            // picks up CALENDAR_EMAIL_TRANSPORT — forcing the transport
            // ourselves would test something else. Requires this to be the
            // first getTransport() call in this process (true — nothing
            // above requires calendar-native/email before this test runs).
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r10-transport-'));
            const db = openCalendarDb({
                dbPath: path.join(tmp, 'r10.sqlite'),
                skipRetentionSweep: true,
                skipReminderSweep: true,
            });
            t.after(() => {
                db.close();
                fs.rmSync(tmp, { recursive: true, force: true });
                email.resetTransport();
            });

            const C = 'cust_r10_transport';
            const S = 'site_r10_transport';
            engine.ensureSettings(db, C, S, { timezone: 'Europe/Bucharest', slot_interval_minutes: 30 });
            const svc = engine.upsertService(db, C, S, { name: 'Consult R10', duration_minutes: 30 });
            engine.setWeeklyAvailability(db, C, S, [
                { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
            ]);

            const nowMs = Date.UTC(2026, 0, 1);
            const startUtc = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 10, 0, 'Europe/Bucharest')); // a Monday

            const created = engine.createBooking(db, C, S, {
                serviceId: svc.id,
                startUtc,
                visitorName: 'Test R10',
                visitorEmail: 'vizitator-r10@example.com',
                nowMs,
            });

            await email.processOutbox(db, { nowMs: nowMs + 100, limit: 10 });

            const rows = email.listOutbox(db, C, S, { bookingId: created.booking.id });
            assert.equal(rows.length, 1);
            assert.equal(
                rows[0].status,
                'sent',
                'a real-armed Resend transport reached through getTransport() must actually deliver'
            );
            assert.equal(
                rows[0].provider_name,
                'resend',
                'delivery must be attributed to the real transport, not local-memory(-unarmed-resend)'
            );

            assert.ok(posted, 'the real transport must actually call fetch — nothing may go out silently unlogged');
            assert.equal(
                posted.url,
                'https://api.resend.com/emails',
                'must reuse the same Resend endpoint bot/email.js already uses for the magic link'
            );
            const body = JSON.parse(posted.opts.body);
            assert.equal(body.to, 'vizitator-r10@example.com');
            assert.match(posted.opts.headers.Authorization, /^Bearer test-key-not-real$/);
        }
    );

    global.fetch = prevFetch;
});

test('NODE_ENV=test always refuses the real transport, even with CALENDAR_EMAIL_TRANSPORT=resend and a key set', () => {
    withEnv(
        { CALENDAR_EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'test-key-not-real', NODE_ENV: 'test' },
        () => {
            const provider = require('../calendar-native/email/provider');
            const t = provider.createTransport();
            assert.notEqual(t.name, 'resend', 'a test process must never be able to arm real delivery from its env');
            assert.equal(t.requiresSecrets, false);
        }
    );
});

test('CALENDAR_EMAIL_TRANSPORT=resend without RESEND_API_KEY logs clearly in production and still falls back safely', () => {
    const origErr = process.stderr.write;
    const lines = [];
    process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
    try {
        withEnv(
            { CALENDAR_EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: undefined, NODE_ENV: 'production' },
            () => {
                const provider = require('../calendar-native/email/provider');
                const t = provider.createTransport();
                assert.equal(t.requiresSecrets, false, 'must fall back safely, never throw/crash boot');
                assert.notEqual(t.name, 'resend');
            }
        );
    } finally {
        process.stderr.write = origErr;
    }
    assert.ok(
        lines.some((l) => l.includes('calendar.email.transport.unconfigured')),
        'an unconfigured production transport must be logged clearly, not fail silently (calendar-native#2)'
    );
});

// ---------------------------------------------------------------------------
// Part 2 — browser oracle: the widget's success screen carries a manage-link
// fallback, independent of whether email delivery is armed.
// ---------------------------------------------------------------------------

test('booking success screen shows a manage-link fallback (CAL-N-02)', async (t) => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r10-widget-'));
    delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
    const { createHandler } = require(path.join(ROOT, 'bot/server.js'));
    const http = require('node:http');
    const server = http.createServer(createHandler({}));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    t.after(async () => {
        await browser.close();
        await new Promise((r) => server.close(r));
    });

    const page = await browser.newPage();
    await page.goto(base + '/calendar-native/widget/', { waitUntil: 'networkidle' });

    const enabledDay = page.locator('.hnb__cal-day:not([aria-disabled="true"])').first();
    await enabledDay.waitFor({ state: 'visible', timeout: 10000 });
    await enabledDay.click();
    await page.locator('.hnb__slot').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.hnb__slot').first().click();

    await page.locator('.hnb__form input[name="name"]').fill('Vizitator Manage Link');
    await page.locator('.hnb__form input[name="email"]').fill('vizitator-managelink-' + Date.now() + '@example.com');
    await page.locator('[data-hnb-submit]').click();
    await page.locator('[data-hnb-success]').waitFor({ state: 'visible', timeout: 15000 });

    const manageLink = page.locator('[data-hnb-success] a[href*="/calendar-native/manage/?token="]');
    await manageLink.waitFor({ state: 'visible', timeout: 5000 });
    const href = await manageLink.getAttribute('href');
    assert.match(
        href,
        /^\/calendar-native\/manage\/\?token=[^&]{16,}$/,
        "the fallback link must carry the visitor's own manage token, reachable without email ever arriving"
    );

    await page.close();
});
