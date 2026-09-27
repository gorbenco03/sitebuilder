'use strict';
/**
 * bot/test/audit27-r-26-calendar-settings-dashboard.test.js
 *
 * Audit 2026-09-27, task R-26 (finding calendar-native#1):
 *
 *   "Fusul orar, pasul intervalelor, fereastra de anulare si pauza
 *    implicita ale calendarului nu pot fi setate din nicio interfata a
 *    produsului" — putOwnerSettings already accepted and validated all four
 *    fields; nothing in the owner dashboard ever rendered an input for any
 *    of them, so an owner whose business is not in Europe/Bucharest was
 *    stuck on the wrong timezone forever, and could not open the
 *    cancellation window or change the slot step/default buffer either.
 *
 * Two halves:
 *
 *  1. A real-browser Playwright pass against the local owner-dashboard
 *     preview (the same route the product serves in non-production, no
 *     hand-typed API calls) proving the "Fus orar și reguli de bază" card
 *     exists, is fillable, saves, and rejects an out-of-range value inline
 *     with the same message the server uses.
 *
 *  2. A real, non-demo tenant (own registry site + signed session cookie,
 *     like any paying owner) exercised purely over HTTP against the exact
 *     routes owner-dashboard.js itself calls — PUT settings, GET
 *     availability, then the PUBLIC slots endpoint the booking widget
 *     calls — proving the save is tenant-scoped, server-persisted (a fresh
 *     GET, not just the PUT's own echo), and has a real effect on the slot
 *     times a visitor is offered. (The demo/preview tenant used in part 1
 *     re-seeds its own settings to fixed showcase defaults on every owner
 *     API call by design, so it cannot be used to prove persistence.)
 *
 * It fails against the pre-fix owner-dashboard.js (no such fields exist, so
 * the Playwright locators below never resolve) and passes once the settings
 * card + saveBaseRules() wiring is present.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-26-calendar-settings-dashboard.test.js
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
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r26-'));
process.env.SERVER_SECRET = 'audit27-r26-' + crypto.randomBytes(8).toString('hex');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.CALENDAR_PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;

const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const registry = require(path.join(ROOT, 'bot', 'registry.js'));
const auth = require(path.join(ROOT, 'bot', 'auth.js'));

/** Next Monday (civil date, YYYY-MM-DD) at least `daysAhead` from now — the
 * weekly hours seeded below are every day of the week, so any date works,
 * but a fixed weekday keeps this deterministic regardless of what day the
 * suite happens to run on. */
function nextMondayIso(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const addToMonday = (8 - dow) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + addToMonday);
  return d.toISOString().slice(0, 10);
}

test('the owner dashboard Setări tab exposes timezone/slot-interval/cancel-window/default-buffer, fillable and saveable, with server-matching inline validation', async () => {
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(20000);
  const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r26-shots-'));

  try {
    // Reach the dashboard the way it is actually served locally — no
    // hand-typed API calls, no localStorage seeding. Bare
    // /calendar-native/owner/ mints a real session via the product's own
    // non-production preview-session route and mounts owner-dashboard.js.
    await page.goto(base + '/calendar-native/owner/', { waitUntil: 'networkidle' });
    await page.locator('[data-hod-tab="settings"]').waitFor({ state: 'visible' });
    await page.locator('[data-hod-tab="settings"]').click();
    await page.screenshot({ path: path.join(screenshotDir, '01-after-click-settings-tab.png') });

    // The four previously-unreachable fields must exist and be fillable.
    const tzInput = page.locator('[data-hod-set-timezone]');
    const slotInput = page.locator('[data-hod-set-slot-interval]');
    const cancelInput = page.locator('[data-hod-set-min-cancel]');
    const bufferInput = page.locator('[data-hod-set-default-buffer]');
    await tzInput.waitFor({ state: 'visible' });
    await slotInput.waitFor({ state: 'visible' });
    await cancelInput.waitFor({ state: 'visible' });
    await bufferInput.waitFor({ state: 'visible' });

    // Starts on the product default, proving these are real bound fields
    // (state.settings), not decorative placeholders.
    assert.equal(await tzInput.inputValue(), 'Europe/Bucharest');

    await tzInput.fill('Europe/London');
    await slotInput.fill('60');
    await cancelInput.fill('2');
    await bufferInput.fill('20');
    await page.screenshot({ path: path.join(screenshotDir, '02-before-save-base-rules.png') });
    await page.locator('[data-hod-save-base]').click();

    await page.locator('.hod-msg', { hasText: 'Regulile calendarului au fost salvate.' })
      .waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(screenshotDir, '03-after-save-base-rules-confirmed.png') });

    // The Disponibilitate tab's timezone hint must reflect the just-saved
    // value from the very same response (state.settings), not a stale copy.
    await page.locator('[data-hod-tab="avail"]').click();
    await page.locator('.hod-hint', { hasText: 'Europe/London' }).waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(screenshotDir, '04-availability-tab-shows-new-timezone.png') });

    // An out-of-range value is rejected inline with the same Romanian
    // message putOwnerSettings uses server-side (belt-and-suspenders check,
    // same pattern as saveBookingWindow/saveWeekly elsewhere in this file).
    await page.locator('[data-hod-tab="settings"]').click();
    await page.locator('[data-hod-set-slot-interval]').fill('5000');
    await page.locator('[data-hod-save-base]').click();
    await page.locator('.hod-field-error', { hasText: '1440' }).waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(screenshotDir, '05-out-of-range-slot-interval-rejected.png') });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(screenshotDir, { recursive: true, force: true });
  }
});

test('the settings save is tenant-scoped and server-persisted (fresh GET, not the PUT echo), and changes the public widget\'s slot spacing', async () => {
  // A REAL (non-demo) tenant: own registry site + signed session, exactly
  // like any paying owner — never the demo/preview tenant, which re-seeds
  // its own calendar_settings row to fixed showcase defaults on every owner
  // API call by design (ensureDemoTenant runs unconditionally before every
  // demo owner-route handler), so it cannot show real persistence.
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    const ownerId = 'audit27_owner_' + crypto.randomBytes(6).toString('hex');
    const site = registry.createSite({
      userId: ownerId,
      templateId: 'professionals',
      slug: 'audit27-r26-' + crypto.randomBytes(6).toString('hex'),
    });
    const siteId = site.id;
    const token = auth.signSession(ownerId);
    const cookie = 'hb_session=' + token;

    async function ownerFetch(routePath, { method = 'GET', body } = {}) {
      return fetch(base + routePath, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
    }

    // 1. Save the four fields via the exact route owner-dashboard.js calls.
    const putRes = await ownerFetch('/api/calendar-native/owner/settings', {
      method: 'PUT',
      body: {
        customerId: ownerId,
        siteId,
        timezone: 'Europe/London',
        slotIntervalMinutes: 60,
        minCancelHours: 2,
        defaultBufferMinutes: 20,
      },
    });
    assert.equal(putRes.status, 200, 'PUT settings must succeed for the tenant\'s own site');
    const putBody = await putRes.json();
    assert.equal(putBody.settings.timezone, 'Europe/London');
    assert.equal(putBody.settings.slotIntervalMinutes, 60);
    assert.equal(putBody.settings.minCancelHours, 2);
    assert.equal(putBody.settings.defaultBufferMinutes, 20);

    // 2. A FRESH read (not the PUT's own echo) must show the same values —
    // proof this is a server-persisted row, not client/response-local state.
    const getRes = await ownerFetch(
      '/api/calendar-native/owner/availability?customerId=' + encodeURIComponent(ownerId)
      + '&siteId=' + encodeURIComponent(siteId)
    );
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.settings.timezone, 'Europe/London', 'timezone must be persisted server-side');
    assert.equal(getBody.settings.slotIntervalMinutes, 60);
    assert.equal(getBody.settings.minCancelHours, 2);
    assert.equal(getBody.settings.defaultBufferMinutes, 20);

    // 3. Tenant isolation: a second real tenant is untouched.
    const otherOwnerId = 'audit27_owner_' + crypto.randomBytes(6).toString('hex');
    const otherSite = registry.createSite({
      userId: otherOwnerId,
      templateId: 'professionals',
      slug: 'audit27-r26-other-' + crypto.randomBytes(6).toString('hex'),
    });
    const otherToken = auth.signSession(otherOwnerId);
    const otherRes = await fetch(base + '/api/calendar-native/owner/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: 'hb_session=' + otherToken },
      body: JSON.stringify({ customerId: otherOwnerId, siteId: otherSite.id, slotIntervalMinutes: 20 }),
    });
    assert.equal(otherRes.status, 200);
    const otherBody = await otherRes.json();
    assert.notEqual(otherBody.settings.timezone, 'Europe/London',
      'a brand-new unrelated tenant must not inherit another tenant\'s saved timezone');
    // And the first tenant's row must still read back unchanged.
    const recheckRes = await ownerFetch(
      '/api/calendar-native/owner/availability?customerId=' + encodeURIComponent(ownerId)
      + '&siteId=' + encodeURIComponent(siteId)
    );
    const recheckBody = await recheckRes.json();
    assert.equal(recheckBody.settings.timezone, 'Europe/London',
      'the other tenant\'s write must not have touched this tenant\'s settings');

    // 4. One tenant cannot read or write another tenant's settings using
    // its own session cookie (hard bind: customerId must equal session uid,
    // and the target site must be owned by that same uid).
    const crossRes = await ownerFetch(
      '/api/calendar-native/owner/availability?customerId=' + encodeURIComponent(ownerId)
      + '&siteId=' + encodeURIComponent(otherSite.id)
    );
    assert.ok(crossRes.status === 403 || crossRes.status === 400,
      'reading another tenant\'s site with your own session must be refused, got ' + crossRes.status);

    // 5. Effect on the public widget: seed a service + weekly hours for the
    // real tenant, then hit the exact PUBLIC slots endpoint the booking
    // widget calls, and confirm consecutive free slots are 60 minutes
    // apart (the value just saved), never the product's 15-minute default.
    const svcRes = await ownerFetch('/api/calendar-native/owner/services', {
      method: 'POST',
      body: { customerId: ownerId, siteId, name: 'Consultație test', durationMinutes: 30, bufferMinutes: 0 },
    });
    assert.equal(svcRes.status, 200);
    const svcBody = await svcRes.json();
    const serviceId = svcBody.service.id;

    const ALL_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1439 }));
    const weeklyRes = await ownerFetch('/api/calendar-native/owner/availability/weekly', {
      method: 'PUT',
      body: { customerId: ownerId, siteId, windows: ALL_DAY },
    });
    assert.equal(weeklyRes.status, 200);

    const dateLocal = nextMondayIso(3);
    const slotsUrl = base + '/api/calendar-native/slots'
      + '?customerId=' + encodeURIComponent(ownerId)
      + '&siteId=' + encodeURIComponent(siteId)
      + '&serviceId=' + encodeURIComponent(serviceId)
      + '&from=' + dateLocal + '&to=' + dateLocal;
    const slotsRes = await fetch(slotsUrl); // public route: no cookie needed
    assert.equal(slotsRes.status, 200, 'public slots endpoint must answer 200');
    const slotsBody = await slotsRes.json();
    assert.ok(Array.isArray(slotsBody.slots) && slotsBody.slots.length >= 2,
      'expected at least two free slots on a full weekday to compare their spacing: got '
      + JSON.stringify(slotsBody).slice(0, 300));
    const starts = slotsBody.slots.map((s) => Date.parse(s.startUtc)).sort((a, b) => a - b);
    const gapsMinutes = new Set();
    for (let i = 1; i < starts.length; i++) {
      gapsMinutes.add(Math.round((starts[i] - starts[i - 1]) / 60000));
    }
    assert.ok(gapsMinutes.has(60),
      'the public widget must offer slots 60 minutes apart (the value saved from the dashboard), '
      + 'got gaps: ' + JSON.stringify([...gapsMinutes]));
    assert.ok(!gapsMinutes.has(15),
      'no slot pair should be 15 minutes apart (the product default) once 60 was saved for this tenant');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('putOwnerSettings rejects an unknown IANA timezone with a Romanian message instead of storing garbage', () => {
  const engine = require(path.join(ROOT, 'bot', 'calendar-native', 'engine.js'));
  const ownerApi = require(path.join(ROOT, 'bot', 'calendar-native', 'owner-api.js'));
  const { openCalendarDb } = require(path.join(ROOT, 'bot', 'calendar-native', 'db.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r26-tzcheck-'));
  const db = openCalendarDb({ dbPath: path.join(dir, 'tz.sqlite') });
  const T = { customerId: 'audit27_tzcheck_customer', siteId: 'audit27_tzcheck_site' };
  engine.ensureSettings(db, T.customerId, T.siteId, { timezone: 'Europe/Bucharest' });

  const bad = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { timezone: 'Not/AZone' });
  assert.equal(bad.code, 'VALIDATION');
  assert.equal(bad.status, 400);
  assert.match(bad.error, /fus orar/i);

  const stillGood = engine.getSettings(db, T.customerId, T.siteId);
  assert.equal(stillGood.timezone, 'Europe/Bucharest', 'a rejected timezone must not overwrite the existing valid one');

  const good = ownerApi.putOwnerSettings(db, T.customerId, T.siteId, { timezone: 'America/Los_Angeles' });
  assert.ok(good.ok);
  assert.equal(good.settings.timezone, 'America/Los_Angeles');

  fs.rmSync(dir, { recursive: true, force: true });
});
