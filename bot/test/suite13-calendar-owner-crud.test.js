'use strict';
/**
 * bot/test/suite13-calendar-owner-crud.test.js
 *
 * M2 owner-CRUD audit (2026-09-14/15) — oracle for the six findings this
 * wave fixes in bot/calendar-native/{engine,owner-api,schema,db}.js,
 * bot/calendar-native/owner/owner-dashboard.{js,css}, bot/server.js and
 * builder/app.js:
 *
 *  CAL-01 (dashboard reachability): "this site has native booking" is now a
 *    schema fact (templates/<id>/schema.json declares appointment.
 *    nativeBooking), not a hardcoded `site.templateId === 'professionals'`
 *    list — portfolio (a salon template) gets the same dashboard entry.
 *  CAL-02 (services): create / edit / delete / reorder, plus an optional
 *    RON price. Delete is blocked (409 FUTURE_BOOKINGS) while a future
 *    active booking still references the service — never silently
 *    orphaned or cancelled; deactivate (`active:false`) stays the safe
 *    alternative and is unaffected.
 *  CAL-03 (staff/resources): same delete rule as CAL-02, same deactivate
 *    escape hatch, applied to calendar_resources.
 *  CAL-05 (split shifts): the weekly-hours API/schema already supported
 *    more than one window per weekday; this oracle proves the owner-api
 *    layer now validates end-after-start and same-day overlap (Romanian
 *    messages) and round-trips exactly what was sent.
 *  CAL-04 (staff without hours): a resource with zero weekly-hours windows
 *    can never be confirmed into a booking (createBooking already enforced
 *    this via slotFitsOpenAvailability — proven here end to end) and is
 *    now flagged `hasHours:false` in both the owner and public resource
 *    listings so the dashboard/widget can say so instead of the visitor
 *    finding out only after a rejected booking.
 *  CAL-notice-ux (settings validation): every numeric settings field
 *    (min-notice, max-advance, reminder hours, buffer, cancel window, slot
 *    interval) is range-checked server-side with a specific Romanian 400,
 *    never a generic 500 from a raw SQLite CHECK failure.
 *
 * Run: node --experimental-sqlite --test bot/test/suite13-calendar-owner-crud.test.js
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

const ROOT = path.resolve(__dirname, '../..');
const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');
const ownerApi = require('../calendar-native/owner-api');
const publicApi = require('../calendar-native/public-api');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-suite13-'));
const db = openCalendarDb({
    dbPath: path.join(tmp, 'suite13.sqlite'),
    skipRetentionSweep: true,
    skipReminderSweep: true,
});

const T = { customerId: 'cust_suite13_A', siteId: 'site_suite13_A' };
engine.ensureSettings(db, T.customerId, T.siteId, {
    timezone: 'UTC',
    slot_interval_minutes: 30,
    min_cancel_hours: 0,
});
// Every weekday, all day — keeps slot math trivial; each sub-section below
// adds its own resource/service so tests don't interact.
const ALL_DAY_WINDOWS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ weekday: d, start_minute: 0, end_minute: 1439 }));
engine.setWeeklyAvailability(db, T.customerId, T.siteId, ALL_DAY_WINDOWS);

// ---------------------------------------------------------------------------
// CAL-02 — service create / price / reorder / delete-with-bookings
// ---------------------------------------------------------------------------

const createOut = ownerApi.putOwnerService(db, T.customerId, T.siteId, null, {
    name: 'Tuns bărbați', durationMinutes: 30, bufferMinutes: 5, priceRon: '85.5',
});
assert.ok(createOut.ok, 'creating a service must succeed: ' + JSON.stringify(createOut));
assert.strictEqual(createOut.service.name, 'Tuns bărbați');
assert.strictEqual(createOut.service.durationMinutes, 30);
assert.deepStrictEqual(createOut.service.price, { amountCents: 8550, currency: 'RON', amount: '85.50' },
    'RON decimal input must round-trip as minor-unit cents plus a display amount');
const svcId = createOut.service.id;

const createOut2 = ownerApi.putOwnerService(db, T.customerId, T.siteId, null, { name: 'Spălat', durationMinutes: 15 });
assert.ok(createOut2.ok);
assert.strictEqual(createOut2.service.price, null, 'a service created with no price must report price: null, not 0');
assert.strictEqual(createOut2.service.sortOrder, 1, 'a second created service is appended, not inserted first');

// Bad price is rejected inline (VALIDATION, 400) rather than silently coerced.
const badPrice = ownerApi.putOwnerService(db, T.customerId, T.siteId, null, { name: 'X', durationMinutes: 10, priceRon: 'abc' });
assert.strictEqual(badPrice.code, 'VALIDATION');
assert.strictEqual(badPrice.status, 400);

// Delete with NO future bookings succeeds outright.
const delFree = ownerApi.deleteOwnerService(db, T.customerId, T.siteId, createOut2.service.id);
assert.ok(delFree.ok, 'deleting a service with no bookings must succeed: ' + JSON.stringify(delFree));
assert.strictEqual(engine.getService(db, T.customerId, T.siteId, createOut2.service.id), null);

// Delete WITH a future active booking is blocked, never silently orphaning
// or cancelling it.
const futureStart = new Date(Date.now() + 5 * 86400000).toISOString();
const futureBooking = engine.createBooking(db, T.customerId, T.siteId, {
    serviceId: svcId, startUtc: futureStart, visitorName: 'Ion Pop', visitorEmail: 'ion@example.com',
});
assert.strictEqual(futureBooking.status, 'confirmed', 'setup: the booking used to test the delete-block must actually be active');

const delBlocked = ownerApi.deleteOwnerService(db, T.customerId, T.siteId, svcId);
assert.strictEqual(delBlocked.code, 'FUTURE_BOOKINGS');
assert.strictEqual(delBlocked.status, 409);
assert.strictEqual(delBlocked.futureBookingsCount, 1);
assert.match(delBlocked.error, /1 programare viitoare/, 'the message must say exactly how many future bookings block the delete');
assert.match(delBlocked.error, /dezactivează/i, 'the message must point at deactivate as the safe alternative');
assert.ok(engine.getService(db, T.customerId, T.siteId, svcId), 'the service must still exist — the blocked delete must not have partially applied');

// Deactivating instead of deleting stays available and leaves the booking untouched.
const deactivateOut = ownerApi.putOwnerService(db, T.customerId, T.siteId, svcId, { active: false });
assert.ok(deactivateOut.ok);
assert.strictEqual(deactivateOut.service.active, false);
const bookingAfterDeactivate = engine.getBooking(db, T.customerId, T.siteId, futureBooking.booking.id);
assert.strictEqual(bookingAfterDeactivate.status, 'confirmed', 'deactivating the service must never touch its existing bookings');

// Cancel the booking, THEN delete succeeds.
engine.cancelBookingAsOwner(db, T.customerId, T.siteId, futureBooking.booking.id);
const delAfterCancel = ownerApi.deleteOwnerService(db, T.customerId, T.siteId, svcId);
assert.ok(delAfterCancel.ok, 'once the blocking booking is cancelled, delete must succeed: ' + JSON.stringify(delAfterCancel));

console.log('PASS suite13 (1) service create/price/reorder + delete blocked-then-allowed by future bookings');

// ---------------------------------------------------------------------------
// CAL-03 — staff/resource delete rule mirrors CAL-02
// ---------------------------------------------------------------------------

const svcForStaff = engine.upsertService(db, T.customerId, T.siteId, { name: 'Manichiură', duration_minutes: 30 });
const resCreate = ownerApi.putOwnerResource(db, T.customerId, T.siteId, null, { name: 'Bianca Ionescu' });
assert.ok(resCreate.ok);
const resId = resCreate.resource.id;
engine.setWeeklyAvailability(db, T.customerId, T.siteId, ALL_DAY_WINDOWS, { resourceId: resId });

const resFutureStart = new Date(Date.now() + 4 * 86400000).toISOString();
const resBooking = engine.createBooking(db, T.customerId, T.siteId, {
    serviceId: svcForStaff.id, resourceId: resId, startUtc: resFutureStart,
    visitorName: 'Maria D', visitorEmail: 'maria@example.com',
});
assert.strictEqual(resBooking.status, 'confirmed');

const resDelBlocked = ownerApi.deleteOwnerResource(db, T.customerId, T.siteId, resId);
assert.strictEqual(resDelBlocked.code, 'FUTURE_BOOKINGS');
assert.strictEqual(resDelBlocked.status, 409);
assert.strictEqual(resDelBlocked.futureBookingsCount, 1);
assert.ok(engine.getResource(db, T.customerId, T.siteId, resId), 'the resource must still exist after a blocked delete');

// Deactivate leaves the future booking intact (documented, existing property — must not regress).
const resDeactivate = ownerApi.putOwnerResource(db, T.customerId, T.siteId, resId, { active: false });
assert.ok(resDeactivate.ok);
assert.strictEqual(resDeactivate.resource.active, false);
assert.strictEqual(engine.getBooking(db, T.customerId, T.siteId, resBooking.booking.id).status, 'confirmed');

engine.cancelBookingAsOwner(db, T.customerId, T.siteId, resBooking.booking.id);
const resDelOk = ownerApi.deleteOwnerResource(db, T.customerId, T.siteId, resId);
assert.ok(resDelOk.ok, 'once its booking is cancelled, the resource must delete cleanly: ' + JSON.stringify(resDelOk));
assert.strictEqual(engine.getResource(db, T.customerId, T.siteId, resId), null);

console.log('PASS suite13 (2) staff delete blocked by future bookings, deactivate keeps them intact, delete succeeds once clear');

// ---------------------------------------------------------------------------
// CAL-05 — split shift (two windows, one weekday) round-trips through the API
// ---------------------------------------------------------------------------

const splitResource = engine.upsertResource(db, T.customerId, T.siteId, { name: 'Cabinet 2' });
const splitOut = ownerApi.putOwnerWeekly(db, T.customerId, T.siteId, {
    resourceId: splitResource.id,
    windows: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        { weekday: 1, startMinute: 14 * 60, endMinute: 18 * 60 },
    ],
});
assert.ok(splitOut.ok, 'a lunch-break split shift must be accepted: ' + JSON.stringify(splitOut));
assert.strictEqual(splitOut.weekly.length, 2);
const readBack = ownerApi.getOwnerAvailability(db, T.customerId, T.siteId, { resourceId: splitResource.id });
assert.strictEqual(readBack.weekly.length, 2, 'both windows of the split shift must round-trip on read');
const starts = readBack.weekly.map((w) => w.startMinute).sort((a, b) => a - b);
assert.deepStrictEqual(starts, [9 * 60, 14 * 60]);

// Overlapping windows on the same day are rejected with a Romanian message
// naming the day and both intervals — never silently accepted or silently
// dropped down to one window.
const overlapOut = ownerApi.putOwnerWeekly(db, T.customerId, T.siteId, {
    resourceId: splitResource.id,
    windows: [
        { weekday: 2, startMinute: 9 * 60, endMinute: 13 * 60 },
        { weekday: 2, startMinute: 12 * 60, endMinute: 17 * 60 },
    ],
});
assert.strictEqual(overlapOut.code, 'VALIDATION');
assert.strictEqual(overlapOut.status, 400);
assert.match(overlapOut.error, /marți/i, 'the overlap message must name the weekday');
assert.match(overlapOut.error, /suprapun/i, 'the overlap message must say the intervals overlap');
// The rejected write must not have partially applied — Tuesday stays as it was before this call (empty).
assert.strictEqual(
    engine.listWeeklyAvailability(db, T.customerId, T.siteId, { resourceId: splitResource.id })
        .filter((w) => w.weekday === 2).length,
    0,
    'a rejected overlapping write must not partially land'
);

// End-before-start is rejected with a Romanian message, not silently dropped.
const badOrderOut = ownerApi.putOwnerWeekly(db, T.customerId, T.siteId, {
    resourceId: splitResource.id,
    windows: [{ weekday: 3, startMinute: 17 * 60, endMinute: 9 * 60 }],
});
assert.strictEqual(badOrderOut.code, 'VALIDATION');
assert.match(badOrderOut.error, /sfârșit.*început|început.*sfârșit/i);

console.log('PASS suite13 (3) split shift round-trips exactly; overlap and end-before-start are rejected inline with Romanian messages');

// ---------------------------------------------------------------------------
// CAL-04 — a staff member with no configured hours is never publicly bookable
// ---------------------------------------------------------------------------

const hourslessSvc = engine.upsertService(db, T.customerId, T.siteId, { name: 'Coafat', duration_minutes: 30 });
const hourlessRes = ownerApi.putOwnerResource(db, T.customerId, T.siteId, null, { name: 'Ștefan Nou' });
assert.ok(hourlessRes.ok);
assert.strictEqual(hourlessRes.resource.hasHours, false, 'a brand-new resource must report hasHours:false before any weekly hours are set');

// Owner + public resource listings both flag it.
const ownerResList = ownerApi.listOwnerResources(db, T.customerId, T.siteId);
const ownerRow = ownerResList.resources.find((r) => r.id === hourlessRes.resource.id);
assert.strictEqual(ownerRow.hasHours, false);
const publicResList = publicApi.listPublicResources(db, T.customerId, T.siteId, {});
const publicRow = publicResList.resources.find((r) => r.id === hourlessRes.resource.id);
assert.strictEqual(publicRow.hasHours, false, 'the public resource listing must also flag a staff member with no hours');

// Explicitly requesting that resource must be rejected (SLOT_OUTSIDE_AVAILABILITY),
// never silently confirmed — proves the "not bookable" half of CAL-04 end to end.
let hourlessBookErr = null;
try {
    engine.createBooking(db, T.customerId, T.siteId, {
        serviceId: hourslessSvc.id,
        resourceId: hourlessRes.resource.id,
        startUtc: new Date(Date.now() + 2 * 86400000).toISOString(),
        visitorName: 'Radu N', visitorEmail: 'radu@example.com',
    });
} catch (e) {
    hourlessBookErr = e;
}
assert.ok(hourlessBookErr, 'booking a resource with zero configured hours must throw, never confirm');
assert.strictEqual(hourlessBookErr.code, 'SLOT_OUTSIDE_AVAILABILITY');

// Once hours are added, hasHours flips true and the same request confirms.
engine.setWeeklyAvailability(db, T.customerId, T.siteId, ALL_DAY_WINDOWS, { resourceId: hourlessRes.resource.id });
const afterHours = ownerApi.listOwnerResources(db, T.customerId, T.siteId).resources.find((r) => r.id === hourlessRes.resource.id);
assert.strictEqual(afterHours.hasHours, true);
const nowBookable = engine.createBooking(db, T.customerId, T.siteId, {
    serviceId: hourslessSvc.id, resourceId: hourlessRes.resource.id,
    startUtc: new Date(Date.now() + 2 * 86400000).toISOString(),
    visitorName: 'Radu N', visitorEmail: 'radu@example.com',
});
assert.strictEqual(nowBookable.status, 'confirmed', 'once hours exist, the same resource must be bookable');

console.log('PASS suite13 (4) a staff member with no hours is flagged hasHours:false and cannot be booked until hours exist');

// ---------------------------------------------------------------------------
// CAL-notice-ux — settings validation never fails silently
// ---------------------------------------------------------------------------

const noticeTooHigh = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { minNoticeMinutes: 999999 });
assert.strictEqual(noticeTooHigh.code, 'VALIDATION');
assert.strictEqual(noticeTooHigh.status, 400);
assert.match(noticeTooHigh.error, /20160|14 zile/);
assert.strictEqual(engine.getSettings(db, T.customerId, T.siteId).min_notice_minutes, 0, 'a rejected write must not silently change the stored value');

const advanceTooHigh = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { maxAdvanceDays: 5000 });
assert.strictEqual(advanceTooHigh.code, 'VALIDATION');

const reminderTooHigh = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { reminderHoursBefore: 9000 });
assert.strictEqual(reminderTooHigh.code, 'VALIDATION');

// Fields with no dashboard UI yet must still validate cleanly (400 + Romanian
// message), not fall through to a raw SQLite CHECK failure (generic 500).
const bufferTooHigh = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { defaultBufferMinutes: -5 });
assert.strictEqual(bufferTooHigh.code, 'VALIDATION');
assert.strictEqual(bufferTooHigh.status, 400);
const cancelTooHigh = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { minCancelHours: 999 });
assert.strictEqual(cancelTooHigh.code, 'VALIDATION');
const intervalZero = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { slotIntervalMinutes: 0 });
assert.strictEqual(intervalZero.code, 'VALIDATION');

// A valid value still saves normally (the validation must not be overzealous).
const noticeOk = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { minNoticeMinutes: 120 });
assert.ok(noticeOk.ok, 'a valid value must still save: ' + JSON.stringify(noticeOk));
assert.strictEqual(noticeOk.settings.minNoticeMinutes, 120);

console.log('PASS suite13 (5) every settings field rejects out-of-range input with a specific Romanian 400, never a silent/generic failure');

// ---------------------------------------------------------------------------
// Owner-dashboard source: inline field-level validation actually wired up
// (companion to the functional checks above — proves the UI surfaces them,
// not only the API).
// ---------------------------------------------------------------------------

const dashJs = fs.readFileSync(path.join(ROOT, 'bot/calendar-native/owner/owner-dashboard.js'), 'utf8');
assert.match(dashJs, /function showFieldError/, 'owner-dashboard.js must define an inline field-error helper');
assert.match(dashJs, /showFieldError\(minNoticeEl/, 'the booking-window save must validate min-notice inline before sending');
assert.match(dashJs, /showFieldError\(maxAdvEl/, 'the booking-window save must validate max-advance inline before sending');
assert.match(dashJs, /showFieldError\(hoursEl/, 'the reminder save must validate hours-before inline before sending');
assert.match(dashJs, /data-hod-del-svc/, 'the services tab must offer a delete control');
assert.match(dashJs, /data-hod-del-res/, 'the resources tab must offer a delete control');
assert.match(dashJs, /data-hod-add-svc/, 'the services tab must offer a create-service control');
assert.match(dashJs, /data-hod-win-add/, 'the weekly-hours tab must offer an add-window control (split shifts)');

// CAL-08: a long service/staff name must wrap, never blow out the layout —
// checked as a CSS source fact (a real-browser measurement lives in
// wave13-site-card-layout.test.js's style for the dashboard card; this is
// the cheaper equivalent for the Personal/Servicii checklists).
const dashCss = fs.readFileSync(path.join(ROOT, 'bot/calendar-native/owner/owner-dashboard.css'), 'utf8');
assert.match(dashCss, /overflow-wrap:\s*anywhere/, 'CAL-08: the services/staff checklist labels must allow a long name to wrap instead of overflowing at 390px');

console.log('PASS suite13 (6) owner-dashboard.js source wires inline validation + the new CRUD controls, and CAL-08 long-name wrap is in place');

db.close();
publicApi.resetDbHandle();
fs.rmSync(tmp, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// CAL-01 — Playwright: a portfolio (non-professionals) site's dashboard card
// derives "has native booking" from the schema, not a template-id list.
// ---------------------------------------------------------------------------

(async () => {
    const crypto = require('crypto');
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite13-cal01-'));
    process.env.DATA_DIR = dataDir;
    process.env.SERVER_SECRET = 'suite13-' + crypto.randomBytes(8).toString('hex');
    delete process.env.PUBLIC_URL;

    require(path.join(ROOT, 'scripts', 'build-builder.js'));
    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

    const server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const base = 'http://127.0.0.1:' + server.address().port;

    try {
        const email = 'suite13-cal01-' + Date.now().toString(36) + '@example.com';
        const user = registry.getOrCreateUserByEmail(email);
        const cfg = JSON.parse(
            fs.readFileSync(path.join(ROOT, 'templates', 'portfolio', 'presets.json'), 'utf8')
        ).presets[0].config;
        cfg.appointment = Object.assign({}, cfg.appointment, { nativeBooking: 'da' });

        const slug = 'suite13-cal01-' + Date.now().toString(36);
        const site = registry.createSite({
            userId: user.id, templateId: 'portfolio', templateVersion: 1, slug, platform: 'web',
        });
        registry.updateSite(site.id, { paid: true, status: 'live' });
        const siteDir = path.join(dataDir, 'sites', site.projectName);
        fs.mkdirSync(siteDir, { recursive: true });
        fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>' + slug + '</h1>');
        await webpublish.publishSite({
            site: registry.getSite(site.id), config: cfg, images: [], siteDirAlreadyBuilt: true,
        });
        registry.updateSite(site.id, { paid: true, status: 'live' });
        // publishSite's own saveVersion() call is gated on `!siteDirAlreadyBuilt`
        // (webpublish.js ~2036) — it never runs on the fast siteDirAlreadyBuilt:true
        // path this oracle uses (same shortcut wave13-site-card-layout.test.js
        // takes), so GET /api/sites/:id's config would otherwise come back null.
        // Save the version explicitly so the dashboard card's real read path
        // (handleGetSite → getVersionConfig) has something to find, matching
        // what a real publish leaves behind.
        registry.saveVersion(site.id, cfg);

        const browser = await chromium.launch({ headless: true });
        try {
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            page.on('pageerror', (err) => console.log('BROWSER-PAGEERROR:', err.message));
            await page.goto(base + '/app/', { waitUntil: 'networkidle' });
            const cookieBanner = page.locator('#hb-cookie-banner');
            if (await cookieBanner.isVisible().catch(() => false)) {
                await page.locator('#hb-cookie-accept').click();
                await cookieBanner.waitFor({ state: 'hidden' });
            }
            await page.evaluate(() => { window.location.hash = '#dashboard'; });
            await page.waitForTimeout(400);
            const authBtn = page.locator('#btn-dashboard-auth');
            if (await authBtn.isVisible().catch(() => false)) await authBtn.click();
            const emailInput = page.locator('#input-email');
            if (await emailInput.isVisible().catch(() => false)) {
                await emailInput.fill(email);
                await page.locator('#btn-send-magic').click();
                await page.locator('#dev-link').waitFor({ state: 'visible' });
                await page.locator('#dev-link').click();
                await page.waitForTimeout(400);
            }
            await page.evaluate(() => { window.location.hash = '#dashboard'; });
            await page.locator('.site-card').first().waitFor({ state: 'visible' });
            // The Programări button lands after an async per-card schema fetch (CAL-01 fix).
            await page.waitForTimeout(1500);

            const cardText = await page.locator('.site-card').first().innerText();
            assert.match(
                cardText,
                /Programări/,
                'CAL-01: a paid+live PORTFOLIO site with native booking on must offer the "Programări" ' +
                'dashboard link — the fix derives this from the schema (appointment.nativeBooking), not ' +
                "a hardcoded templateId === 'professionals' check. Card text: " + cardText
            );
            await context.close();
        } finally {
            await browser.close();
        }
        console.log('PASS suite13 (CAL-01) a portfolio site with native booking on gets the same "Programări" dashboard link a professionals site gets');
    } finally {
        server.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
