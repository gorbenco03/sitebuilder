'use strict';
/**
 * bot/test/suite5-hygiene.test.js
 *
 * PLAN-QA-2026-09-12 Suite 5, S5-5 — three small, independent hygiene items
 * from QA-Explorare-2026-09-12/reports/07-calendar-native.md.
 *
 *  - m23: server-side visitor-name length. INVESTIGATED, NOT REPRODUCED AS A
 *    DEFECT (see the test below for why) — kept here as a regression lock,
 *    not a fix.
 *  - m24 (real defect, fixed): rescheduling a booking onto the EXACT same
 *    slot it already occupies — no time change, no resource change, no
 *    status change — re-sent the "Cerere de programare înregistrată"-style
 *    email, because `rescheduleBookingAsOwner` (bot/calendar-native/
 *    engine.js) called `emitBookingEmail` unconditionally, and the email
 *    layer's own idempotency key includes `booking.updated_at` — which a
 *    no-op reschedule still bumps.
 *  - m26 (real defect, fixed): see suite5-hygiene's sibling investigation —
 *    `.pr-nav__brand`'s `text-overflow: ellipsis` silently did nothing
 *    because the element was `display: inline-flex` (a well-known CSS
 *    limitation: text-overflow does not render on flex/inline-flex boxes,
 *    even though `overflow: hidden` and the truncation itself still apply).
 *    A long business name on the text-only wordmark (no logo) was cut off
 *    with no "…" at all on a 390px header.
 *
 * Run: node --experimental-sqlite --test bot/test/suite5-hygiene.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------
// m23 + m24 — direct engine/owner-api access against a scratch sqlite db.
// No HTTP server needed for either.
// ---------------------------------------------------------------------

const dbTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suite5-hygiene-db-'));
process.env.DATA_DIR = process.env.DATA_DIR || dbTmp;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'suite5-hygiene-' + crypto.randomBytes(8).toString('hex');
process.env.NODE_ENV = 'test';

const engine = require(path.join(ROOT, 'bot/calendar-native/engine'));
const ownerApi = require(path.join(ROOT, 'bot/calendar-native/owner-api'));
const publicApi = require(path.join(ROOT, 'bot/calendar-native/public-api'));
const { openCalendarDb } = require(path.join(ROOT, 'bot/calendar-native/db'));
const { zonedWallTimeToUtcMs, toIsoUtc, isoWeekdayForDateLocal } = require(path.join(ROOT, 'bot/calendar-native/time'));

publicApi.resetDbHandle();
const hygieneDb = openCalendarDb({ dbPath: path.join(dbTmp, 'hygiene.sqlite') });

const TENANT = { customerId: 'customer_hygiene', siteId: 'site_hygiene' };

engine.ensureSettings(hygieneDb, TENANT.customerId, TENANT.siteId, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 5,
    slot_interval_minutes: 30,
});
const HYGIENE_SVC = engine.upsertService(hygieneDb, TENANT.customerId, TENANT.siteId, {
    id: 'svc_hygiene',
    name: 'Consultație',
    duration_minutes: 30,
    buffer_minutes: 5,
});
const MON = '2030-02-04'; // a Monday
assert.strictEqual(isoWeekdayForDateLocal(MON), 1);
engine.setWeeklyAvailability(hygieneDb, TENANT.customerId, TENANT.siteId, [
    { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
]);
const NOW_MS = Date.UTC(2030, 1, 1);
const SLOT_A = toIsoUtc(zonedWallTimeToUtcMs(2030, 2, 4, 10, 0, 'Europe/Bucharest'));

test('m23: a 200+ character visitor name cannot end up stored longer than the widget\'s own 80-char limit', () => {
    const longName = 'A'.repeat(220);
    const created = engine.createBooking(hygieneDb, TENANT.customerId, TENANT.siteId, {
        serviceId: HYGIENE_SVC.id,
        startUtc: SLOT_A,
        visitorName: longName,
        visitorEmail: 'm23@example.com',
        nowMs: NOW_MS,
    });

    // INVESTIGATED, NOT REPRODUCED: engine.js:797 already does
    // `String(input.visitorName || '').trim().slice(0, 80)` on every booking
    // creation — the ONLY code path that ever writes visitor_name — so a
    // 220-char input is silently truncated to 80 chars before it ever
    // reaches SQLite. The QA report's wording ("serverul acceptă 200+
    // caractere") is true only in the narrow sense that the HTTP call
    // returns 200 OK rather than a 400 — it does NOT mean the value is
    // stored unbounded. This assertion locks the truncation as a regression
    // guard; it is not a fix, because there was nothing left to fix here.
    assert.equal(created.booking.visitor_name.length, 80,
        'visitor_name must be truncated to the widget\'s own 80-char maxlength, not stored unbounded');
    assert.notEqual(created.booking.visitor_name, longName,
        'a 220-char name must not survive untouched — engine.js\'s slice(0, 80) should have caught it');
});

test('m24: rescheduling a booking onto the slot it already occupies must not re-send the booking email', () => {
    const created = engine.createBooking(hygieneDb, TENANT.customerId, TENANT.siteId, {
        serviceId: HYGIENE_SVC.id,
        startUtc: toIsoUtc(zonedWallTimeToUtcMs(2030, 2, 4, 11, 0, 'Europe/Bucharest')),
        visitorName: 'M24 Visitor',
        visitorEmail: 'm24@example.com',
        nowMs: NOW_MS,
    });
    const bookingId = created.booking.id;
    assert.equal(created.booking.status, 'confirmed', 'sanity: booking must start confirmed');

    const countEmails = () => hygieneDb
        .prepare('SELECT COUNT(*) AS n FROM calendar_email_outbox WHERE booking_id = ?')
        .get(bookingId).n;

    const before = countEmails();
    assert.ok(before >= 1, 'sanity: the initial booking must have queued at least one email');

    // "Reschedule" onto the EXACT same start time it already has — the
    // owner-dashboard equivalent of clicking Save without picking a new slot.
    const result = ownerApi.rescheduleOwnerBooking(
        hygieneDb, TENANT.customerId, TENANT.siteId, bookingId,
        { startUtc: created.booking.start_utc },
        { nowMs: NOW_MS + 60000 }
    );
    assert.ok(result && result.ok, 'reschedule call itself must still succeed: ' + JSON.stringify(result));
    assert.equal(result.booking.status, 'confirmed', 'status must not change on a true no-op reschedule');

    const after = countEmails();
    assert.equal(after, before,
        'DEFECT m24: rescheduling onto the SAME slot (no real change) queued ' + (after - before) +
        ' additional email(s) — rescheduleBookingAsOwner must skip emitBookingEmail when start_utc, ' +
        'resource_id and status are all unchanged');
});

test('m24 regression guard: a REAL reschedule (different slot) still sends the email', () => {
    const created = engine.createBooking(hygieneDb, TENANT.customerId, TENANT.siteId, {
        serviceId: HYGIENE_SVC.id,
        startUtc: toIsoUtc(zonedWallTimeToUtcMs(2030, 2, 4, 12, 0, 'Europe/Bucharest')),
        visitorName: 'M24 Real Reschedule',
        visitorEmail: 'm24-real@example.com',
        nowMs: NOW_MS,
    });
    const bookingId = created.booking.id;
    const countEmails = () => hygieneDb
        .prepare('SELECT COUNT(*) AS n FROM calendar_email_outbox WHERE booking_id = ?')
        .get(bookingId).n;
    const before = countEmails();

    const newSlot = toIsoUtc(zonedWallTimeToUtcMs(2030, 2, 4, 13, 0, 'Europe/Bucharest'));
    const result = ownerApi.rescheduleOwnerBooking(
        hygieneDb, TENANT.customerId, TENANT.siteId, bookingId,
        { startUtc: newSlot },
        { nowMs: NOW_MS + 120000 }
    );
    assert.ok(result && result.ok, 'reschedule call must succeed: ' + JSON.stringify(result));
    assert.equal(result.booking.startUtc, newSlot, 'the slot must actually have moved');

    const after = countEmails();
    assert.equal(after, before + 1,
        'a genuine reschedule (real time change) must still queue exactly one new email — the m24 ' +
        'fix must not have silenced real reschedules along with the no-op case');
});

// ---------------------------------------------------------------------
// m26 — real published page, real Chromium, at the 390px width the QA
// report measured.
// ---------------------------------------------------------------------

const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

let server;
let liveUrl;

test.before(async () => {
    require(path.join(ROOT, 'scripts', 'build-builder.js'));
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    process.env.PUBLIC_URL = base;

    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

    const user = registry.getOrCreateUserByEmail('suite5-m26-' + Date.now().toString(36) + '@example.com');
    // preset 0's business.name is "Cabinet Juridic Ionescu" — the exact name
    // the QA report measured truncating without an ellipsis at 390px.
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;

    const slug = 'suite5-m26-' + Date.now().toString(36);
    const site = registry.createSite({
        userId: user.id, templateId: 'professionals', templateVersion: 1, slug, platform: 'web',
    });
    registry.updateSite(site.id, { paid: true, status: 'live' });
    fs.mkdirSync(path.join(process.env.DATA_DIR, 'sites', site.projectName), { recursive: true });
    await webpublish.publishSite({
        site: registry.getSite(site.id),
        config: cfg,
        images: [],
        buildStaticSiteTree: siteExport.buildStaticSiteTree,
    });
    liveUrl = base + '/live/' + slug + '/';
});

test.after(() => {
    if (server) server.close();
});

test('m26: a long business name truncates WITH a visible ellipsis on a 390px header, not a bare cut-off', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
        await page.goto(liveUrl, { waitUntil: 'load' });

        const info = await page.evaluate(() => {
            const el = document.querySelector('.pr-nav__brand.pr-nav__word') || document.querySelector('.pr-nav__brand');
            if (!el) return { found: false };
            const cs = getComputedStyle(el);
            return {
                found: true,
                text: el.textContent,
                display: cs.display,
                overflow: cs.overflow,
                textOverflow: cs.textOverflow,
                whiteSpace: cs.whiteSpace,
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                overflowing: el.scrollWidth > el.clientWidth,
            };
        });

        assert.ok(info.found, 'no .pr-nav__brand element found in the published header');
        assert.equal(info.text, 'Cabinet Juridic Ionescu', 'sanity: unexpected business name in the fixture');
        assert.ok(info.overflowing,
            'the business name does not even overflow its box at 390px — test fixture no longer ' +
            'reproduces the width this defect needs (name=' + info.scrollWidth + 'px, box=' + info.clientWidth + 'px)');
        assert.equal(info.overflow, 'hidden', 'expected overflow:hidden on the truncated brand element');
        assert.equal(info.textOverflow, 'ellipsis', 'expected text-overflow:ellipsis on the truncated brand element');

        // DEFECT m26's actual mechanism: text-overflow:ellipsis is a
        // documented no-op on a flex/inline-flex box — Chromium clips the
        // text (overflow:hidden still applies) but never paints "…". The
        // CSS properties can all read correctly via getComputedStyle while
        // the ellipsis glyph is still never drawn — verified directly with
        // an isolated side-by-side render (inline-flex vs inline-block) with
        // otherwise-identical CSS during this fix's investigation.
        assert.ok(!/flex/i.test(info.display),
            'DEFECT m26: .pr-nav__brand.pr-nav__word computes to display:"' + info.display + '" — ' +
            'text-overflow:ellipsis never renders on a flex/inline-flex box (Chromium/WebKit), even ' +
            'though overflow:hidden and the truncation itself still apply — this is the exact bug: ' +
            '"Cabinet Juridic Iones" cut off with no "…" at all');

        await browser.close();
    } catch (e) {
        await browser.close();
        throw e;
    }
});
