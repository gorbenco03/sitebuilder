'use strict';
/**
 * bot/test/suite5-requested-booking-can-be-confirmed.test.js
 *
 * Oracle — PLAN-QA-2026-09-12 Suite 5 / S5-1, defect B6 (business blocker):
 *
 *   On a solo-specialist cabinet (the normal case for the "professionals"
 *   template — one owner, no extra staff), a booking that lands "requested"
 *   with NO resource assigned can never be confirmed by the owner, even
 *   after the slot that blocked it becomes free.
 *
 * Root cause (04-QA-Evidence/QA-Explorare-2026-09-12/reports/07-calendar-native.md,
 * D1):
 *   - Two visitors race for the exact same slot (the widget always books
 *     "any available" — bot/calendar-native/widget/public-booking-widget.js,
 *     state.resourceId defaults to null). The engine is honest about this:
 *     exactly one confirms, the other is stored "requested" with
 *     resource_id = NULL (bot/calendar-native/engine.js createBooking, the
 *     "every eligible resource is busy" branch around line 924-932).
 *   - The owner cancels the confirmed twin, freeing the slot. The orphaned
 *     "requested" row is still sitting there, still resourceless.
 *   - bot/calendar-native/owner/owner-dashboard.js only ever renders
 *     "Confirmă" `if (b.status === 'requested' && b.resourceId)` (was line
 *     ~457) and only ever renders "Reatribuie" `if (state.resources.length
 *     > 1)` (was line ~446). A solo cabinet has exactly one resource, so
 *     NEITHER button exists for this row. "Reprogramează" onto the now-free
 *     slot doesn't help either — it goes through the exact same "any
 *     available" resolution and lands "requested" again with resource_id
 *     still NULL (engine.js applyReschedule's own resource-selection).
 *   - bot/calendar-native/engine.js confirmBookingAsOwner (was line 1398)
 *     unconditionally threw RESOURCE_REQUIRED when !row.resource_id, with a
 *     comment pointing at reassignBookingAsOwner as "the" fix — a path the
 *     UI never exposes for a one-resource tenant.
 *   The client who lost the race never gets a confirmed appointment, and the
 *   owner has no tool in the dashboard to give them one.
 *
 * This oracle reproduces the race for real (two genuinely concurrent HTTP
 * POSTs to the public booking API — the same reproduction the QA report
 * verified with parallel curl calls), cancels the winner AS THE OWNER
 * THROUGH THE REAL DASHBOARD UI (Playwright against the actual
 * owner-dashboard.js/owner-dashboard.css, not a direct API call), and then
 * requires the dashboard to offer — and honor — a way to confirm the
 * loser. It also checks the honesty requirement from the plan: the
 * "Confirmă" control must not be offered while the slot is still genuinely
 * busy (that would promise something a click would only downgrade to
 * "reprogramare necesară"), and it must reappear once freed.
 *
 * Finally it re-reads calendar-native.sqlite directly (not just the DOM) to
 * prove resource_id and status actually changed at rest.
 *
 * Run: node --experimental-sqlite --test bot/test/suite5-requested-booking-can-be-confirmed.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s5a-'));
process.env.SERVER_SECRET = 's5a-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.CALENDAR_PUBLIC_BASE_URL;

let server;
let base;

test.before(async () => {
    require(path.join(ROOT, 'scripts', 'build-builder.js'));
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    // Production sets PUBLIC_URL only after the server is actually listening
    // — see bot/test/delete-site-oracle.mjs. Mirrored here on purpose.
    base = 'http://127.0.0.1:' + server.address().port;
    process.env.PUBLIC_URL = base;
});

test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

test('a resourceless "requested" booking can be confirmed from the owner dashboard UI once its slot frees up (solo-specialist tenant)', async () => {
    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
    const auth = require(path.join(ROOT, 'bot', 'auth.js'));
    const { openCalendarDb } = require(path.join(ROOT, 'bot', 'calendar-native', 'db.js'));
    const publicApi = require(path.join(ROOT, 'bot', 'calendar-native', 'public-api.js'));
    const engine = require(path.join(ROOT, 'bot', 'calendar-native', 'engine.js'));

    // -------------------------------------------------------------------
    // Setup: a real professionals site, native booking on, published for
    // real (HIDOOK_TEST_PAY) — the cutover seeds services + weekly hours
    // from the preset, exactly like a paying owner going live today.
    // -------------------------------------------------------------------
    const ownerEmail = 's5a-owner-' + Date.now().toString(36) + '@example.com';
    const user = registry.getOrCreateUserByEmail(ownerEmail);
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;
    cfg.appointment = Object.assign({}, cfg.appointment, { nativeBooking: 'da' });

    const slug = 's5a-' + Date.now().toString(36);
    const site = registry.createSite({
        userId: user.id, templateId: 'professionals', templateVersion: 1, slug, platform: 'web',
    });
    registry.updateSite(site.id, { paid: true, status: 'live' });

    const siteDir = path.join(process.env.DATA_DIR, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    await webpublish.publishSite({
        site: registry.getSite(site.id),
        config: cfg,
        images: [],
        buildStaticSiteTree: siteExport.buildStaticSiteTree,
    });

    const customerId = user.id;
    const siteId = site.id;

    // -------------------------------------------------------------------
    // Fixture sanity: this MUST be the solo-specialist case — the normal
    // "professionals" tenant that never touched Personal/resurse.
    // -------------------------------------------------------------------
    let db = openCalendarDb({});
    // Same lazy call the engine itself makes on first real use — forces the
    // one implicit resource into existence, same as a live tenant's first
    // booking would, without adding a second one.
    engine.getOrCreateDefaultResourceId(db, customerId, siteId);
    const resources = engine.listResources(db, customerId, siteId, { activeOnly: true });
    assert.strictEqual(resources.length, 1, 'fixture sanity: exactly one active resource (solo cabinet)');

    const services = engine.listServices(db, customerId, siteId);
    assert.ok(services.length > 0, 'fixture sanity: cutover must have seeded at least one service');
    const serviceId = services[0].id;

    function ymd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    let startUtc = null;
    for (let i = 0; i < 21 && !startUtc; i++) {
        const day = new Date(Date.now() + i * 86400000);
        const out = publicApi.listPublicSlots(db, customerId, siteId, {
            serviceId, fromDateLocal: ymd(day), toDateLocal: ymd(day),
        });
        if (out.ok && out.slots && out.slots.length) startUtc = out.slots[0].startUtc;
    }
    assert.ok(startUtc, 'fixture sanity: no bookable slot found in the next 21 days — cutover must seed weekly availability');
    db.close();

    // -------------------------------------------------------------------
    // STEP 1 — reproduce B6 for real: two visitors race the exact same
    // slot via two genuinely concurrent HTTP POSTs (the widget's own
    // "any available" request — no resourceId — same as the QA report's
    // parallel-curl reproduction).
    // -------------------------------------------------------------------
    function postBooking(name, email) {
        return fetch(base + '/api/calendar-native/bookings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                customerId, siteId, serviceId, startUtc,
                visitorName: name, visitorEmail: email,
            }),
        }).then((r) => r.json().then((data) => ({ httpStatus: r.status, data })));
    }

    const [resA, resB] = await Promise.all([
        postBooking('Concurrent A', 's5a-a-' + Date.now() + '@example.com'),
        postBooking('Concurrent B', 's5a-b-' + Date.now() + '@example.com'),
    ]);
    assert.strictEqual(resA.httpStatus, 200, 'concurrent request A must be accepted: ' + JSON.stringify(resA.data));
    assert.strictEqual(resB.httpStatus, 200, 'concurrent request B must be accepted: ' + JSON.stringify(resB.data));

    const outcomes = [resA.data, resB.data].sort((a, b) => (a.status < b.status ? -1 : 1));
    assert.deepStrictEqual(
        outcomes.map((o) => o.status), ['confirmed', 'requested'],
        'exactly one of the two truly-concurrent requests must confirm and the other must be honestly ' +
        '"requested" — never both confirmed (double-booking) and never both refused'
    );
    const confirmedOut = resA.data.status === 'confirmed' ? resA.data : resB.data;
    const requestedOut = resA.data.status === 'requested' ? resA.data : resB.data;
    assert.strictEqual(
        requestedOut.resourceId, null,
        'the losing request must be stored unassigned (resource_id = NULL), never pinned to the busy resource'
    );

    // -------------------------------------------------------------------
    // STEP 2 — owner drives the REAL dashboard UI: sign in (session cookie,
    // same mechanism every other owner-flow oracle in this suite uses —
    // see bot/test/flow4-isolated-live-url.test.js), open
    // /calendar-native/owner/, and check the row BEFORE doing anything.
    // -------------------------------------------------------------------
    const cookieValue = auth.signSession(customerId);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{ name: 'hb_session', value: cookieValue, url: base }]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Suite5-B6-requested-confirm');
    fs.mkdirSync(EVIDENCE, { recursive: true });

    try {
        await page.goto(
            base + '/calendar-native/owner/?customerId=' + encodeURIComponent(customerId) +
            '&siteId=' + encodeURIComponent(siteId),
            { waitUntil: 'networkidle' }
        );
        await page.locator('.hod-shell').waitFor({ state: 'visible' });
        assert.strictEqual(
            await page.locator('.hod-auth').count(), 0,
            'the owner\'s real session must be accepted, not blocked behind "Autentificare necesară"'
        );

        const requestedRow = page.locator('.hod-booking[data-booking-id="' + requestedOut.id + '"]');
        const confirmedRow = page.locator('.hod-booking[data-booking-id="' + confirmedOut.id + '"]');
        await requestedRow.waitFor({ state: 'visible' });
        await confirmedRow.waitFor({ state: 'visible' });

        await page.screenshot({ path: path.join(EVIDENCE, '01-both-bookings-before-cancel.png'), fullPage: true });

        // Honesty check (still busy): the resourceless "requested" row must
        // not dangle a "Confirmă" that would only downgrade to
        // "reprogramare necesară" the instant it's clicked — the slot is
        // still occupied by its confirmed twin.
        assert.strictEqual(
            await requestedRow.locator('[data-hod-act="confirm"]').count(), 0,
            'the dashboard must not offer "Confirmă" while the slot is still genuinely busy — that would ' +
            'promise a confirmation the click cannot deliver'
        );

        // -------------------------------------------------------------------
        // STEP 3 — owner cancels the confirmed twin, through the UI, freeing
        // the slot.
        // -------------------------------------------------------------------
        page.once('dialog', (d) => d.accept());
        await confirmedRow.locator('[data-hod-act="cancel"]').click();
        await confirmedRow.locator('.hod-badge--cancelled').waitFor({ state: 'visible', timeout: 10000 });
        await page.screenshot({ path: path.join(EVIDENCE, '02-confirmed-twin-cancelled.png'), fullPage: true });

        // -------------------------------------------------------------------
        // STEP 4 — THE FIX under test: with the slot now free, the dashboard
        // must offer "Confirmă" on the still-resourceless "requested" row,
        // and clicking it must actually confirm it — through the real
        // owner-dashboard.js code path, not a direct API call.
        // -------------------------------------------------------------------
        const confirmBtn = requestedRow.locator('[data-hod-act="confirm"]');
        await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
        await confirmBtn.click();
        await requestedRow.locator('.hod-badge--ok').waitFor({ state: 'visible', timeout: 10000 });
        await page.screenshot({ path: path.join(EVIDENCE, '03-requested-now-confirmed.png'), fullPage: true });
    } finally {
        await browser.close();
    }

    // -------------------------------------------------------------------
    // STEP 5 — verify directly in calendar-native.sqlite, not just the DOM.
    // -------------------------------------------------------------------
    const verifyDb = openCalendarDb({});
    const finalRow = verifyDb.prepare(
        `SELECT status, resource_id FROM calendar_bookings WHERE id = ?`
    ).get(requestedOut.id);
    verifyDb.close();

    assert.ok(finalRow, 'DB: the previously-orphaned booking row must still exist');
    assert.strictEqual(finalRow.status, 'confirmed', 'DB: the previously-orphaned request must end up confirmed');
    assert.ok(finalRow.resource_id, 'DB: it must actually hold a resource_id — a confirmed booking claiming nothing is a lie');
    assert.strictEqual(finalRow.resource_id, resources[0].id, 'DB: it must be allocated to the tenant\'s one real resource');

    console.log('PASS suite5-requested-booking-can-be-confirmed');
});
