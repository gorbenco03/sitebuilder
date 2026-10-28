'use strict';
/**
 * bot/test/wave8-calendar-reachable-e2e.test.js
 *
 * Wave 8 reachability oracle — the deliverable this wave was actually about.
 * The native booking calendar (engine, owner API, public API, tenant
 * isolation) was already proven end-to-end by earlier waves through the API
 * and through a demo page that hardcodes data-customer-id="demo_customer_
 * elena". Nobody had walked the path of an actual paying customer:
 *
 *   1. sign in for real (magic link — no demo session anywhere)
 *   2. create a professionals site
 *   3. turn native booking ON from the builder (the new drawer panel)
 *   4. publish it (real HIDOOK_TEST_PAY flow, real slug)
 *   5. as an anonymous visitor, book a real appointment on the LIVE site
 *   6. as the SAME signed-in owner, open THEIR OWN bookings dashboard from
 *      where an owner would look (the "Proiectele mele" site card) and see
 *      that exact booking
 *
 * Before this wave: step 3 had no UI at all (appointment.nativeBooking was
 * never written by anything in builder/), and step 6 had no real entry point
 * — /calendar-native/owner/ always minted the DEMO tenant session, which
 * would have silently signed this browser in as demo_customer_elena instead
 * of the real owner. This test fails against the pre-Wave-8 code for exactly
 * those two reasons (see 04-QA-Evidence/Wave8-calendar-reachable/red-before.log,
 * captured by re-running this same file against `git stash`-free reverted
 * copies of the two files this wave touches).
 *
 * Form editor removed 2026-10-28: steps 2-4 (drawer switch, publish modal) are replaced by
 * an API-seeded professionals site with appointment.nativeBooking 'da'; steps 5-6 (the
 * visitor books on the live site, the owner's dashboard shows it) are unchanged.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-calendar-reachable-e2e.test.js
 * Evidence: 04-QA-Evidence/Wave8-calendar-reachable/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave8-calendar-reachable');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
const { signInPage, publishAndPayInUi } = require('./lib/dash-seed.js');

test('a real customer can turn on native booking, publish, a visitor can book, and the owner sees it in their own dashboard', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-reachable-'));
  process.env.SERVER_SECRET = 'wave8-reachable-oracle-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'CALENDAR_PUBLIC_BASE_URL']) {
    delete process.env[k];
  }

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);

  let livePage = null;
  let dashboardPage = null;
  try {
    // =====================================================================
    // 1-3. Form editor removed 2026-10-28 (it held the booking switch, and the
    //    block editor has no booking block yet): the professionals site is
    //    seeded through the API with appointment.nativeBooking 'da' — exactly
    //    what the switch used to write — and paid the way a customer does,
    //    by following the checkout return URL.
    // =====================================================================
    const runSlug = 'wave8-reach-' + crypto.randomBytes(4).toString('hex');
    const ownerEmail = 'wave8-reachable-owner@example.com';
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets;
    const config = JSON.parse(JSON.stringify(presets[0].config));
    config.appointment.nativeBooking = 'da';

    await signInPage(page, base, ownerEmail);
    const pub = await publishAndPayInUi(page, base, { templateId: 'professionals', config, slug: runSlug });
    await page
      .locator('#modal-success-title')
      .filter({ hasText: 'Site-ul tău e live' })
      .waitFor({ state: 'visible', timeout: 20000 });

    // Real identifiers from the owner's own authenticated session — never
    // hand-picked, never a demo constant.
    const me = await page.evaluate(() => fetch('/api/me', { credentials: 'include' }).then(r => r.json()));
    const ownerUserId = me && me.user && me.user.id;
    assert.ok(ownerUserId, 'signed-in owner must have a real userId from /api/me');
    assert.notEqual(ownerUserId, 'demo_customer_elena', 'sanity: real owner id must not be the demo constant');

    const mySites = await page.evaluate(() => fetch('/api/sites', { credentials: 'include' }).then(r => r.json()));
    const site = (mySites.sites || []).find(s => s.slug === runSlug);
    assert.ok(site, 'the just-published site must show up in /api/sites');
    assert.equal(site.id, pub.siteId);
    assert.equal(site.userId, ownerUserId, 'sanity: site.userId must equal the owner session id');

    const opened = page.context().waitForEvent('page');
    await page.locator('#success-url-link').click();
    livePage = await opened;
    await livePage.waitForLoadState('networkidle');
    await livePage.screenshot({ path: path.join(EVIDENCE, '03-live-site-published.png'), fullPage: true });

    // =====================================================================
    // 4. Live-site proof: the native widget mounted (not the legacy local
    //    request form), wired with the REAL cutover-injected tenant ids —
    //    this is bot/calendar-native/cutover.js running at publish time,
    //    server-side code this wave does not touch and does not need to.
    // =====================================================================
    const hnbRoot = livePage.locator('#hnb-root[data-hidook-cal-native]');
    await hnbRoot.waitFor({ state: 'attached' });
    const liveCustomerId = await hnbRoot.getAttribute('data-customer-id');
    const liveSiteId = await hnbRoot.getAttribute('data-site-id');
    assert.equal(liveCustomerId, ownerUserId, 'cutover must inject the REAL owner userId as nativeCustomerId, not a placeholder');
    assert.equal(liveSiteId, site.id, 'cutover must inject the REAL site id as nativeSiteId');
    assert.equal(
      await livePage.locator('.pr-booking-link').count(),
      0,
      'once native booking is on, the legacy local booking link must not also render'
    );

    // =====================================================================
    // 5. Book as an anonymous visitor. A brand-new browser context — zero
    //    cookies, zero relation to the owner's session — proves the public
    //    booking path needs no owner auth at all.
    // =====================================================================
    const visitorCtx = await browser.newContext();
    const visitorPage = await visitorCtx.newPage();
    await visitorPage.goto(livePage.url(), { waitUntil: 'networkidle' });

    const visitorName = 'Vizitator Wave8 ' + crypto.randomBytes(3).toString('hex');
    const visitorEmail = 'vizitator-wave8-' + crypto.randomBytes(3).toString('hex') + '@example.com';

    await visitorPage.locator('.hnb__svc').first().waitFor({ state: 'visible', timeout: 20000 });
    await visitorPage.locator('.hnb__svc').first().click();

    // Slots may be empty for "today" (min-lead / closing hours) — the widget
    // shows a month-grid calendar (2026-09-14 redesign, see
    // bot/test/suite12-booking-month-calendar.test.js); walk the enabled
    // days of the current month in order, then page to the next month, until
    // one has a slot.
    let slotBtn = null;
    for (let month = 0; month < 3 && !slotBtn; month++) {
      const enabledDays = visitorPage.locator('.hnb__cal-day:not([aria-disabled="true"])');
      const n = await enabledDays.count();
      for (let i = 0; i < n; i++) {
        await enabledDays.nth(i).click();
        await visitorPage.waitForTimeout(300);
        const candidate = visitorPage.locator('.hnb__slot').first();
        if (await candidate.count()) { slotBtn = candidate; break; }
      }
      if (!slotBtn) {
        const nextMonthBtn = visitorPage.locator('.hnb__cal-next');
        if (await nextMonthBtn.isDisabled()) break;
        await nextMonthBtn.click();
        await visitorPage.waitForTimeout(400);
      }
    }
    assert.ok(slotBtn, 'no bookable slot found across 3 months of the month-grid calendar — cutover must have seeded weekly availability');
    await slotBtn.click();

    await visitorPage.locator('.hnb__form input[name="name"]').fill(visitorName);
    await visitorPage.locator('.hnb__form input[name="email"]').fill(visitorEmail);
    await visitorPage.screenshot({ path: path.join(EVIDENCE, '04-visitor-booking-form.png'), fullPage: true });
    await visitorPage.locator('[data-hnb-submit]').click();

    await visitorPage.locator('[data-hnb-success]').waitFor({ state: 'visible', timeout: 15000 });
    await visitorPage.screenshot({ path: path.join(EVIDENCE, '05-visitor-booking-confirmed.png'), fullPage: true });
    await visitorCtx.close();

    // =====================================================================
    // 6. Owner reaches their OWN dashboard from where an owner would look —
    //    the "Proiectele mele" (dashboard) site card — in the SAME
    //    already-authenticated context from step 3. No preview-session call
    //    is ever made here: this proves the demo tenant is never involved.
    // =====================================================================
    // The "Site-ul tău e live" success modal is still open and would
    // intercept clicks on anything behind it — a real owner clicks
    // "Vezi Site-urile mele".
    await page.locator('#btn-success-view-sites').click();
    await page.locator('#modal-success').waitFor({ state: 'hidden' });
    await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
    const card = page.locator('.site-card', { hasText: runSlug });
    await card.waitFor({ state: 'visible' });

    const bookingsLink = card.locator('a', { hasText: 'Programări' });
    await bookingsLink.waitFor({ state: 'visible', timeout: 15000 });
    const href = await bookingsLink.getAttribute('href');
    assert.match(href, /\/calendar-native\/owner\/\?/, 'the dashboard link must point at the real owner dashboard route');
    assert.match(href, new RegExp('customerId=' + ownerUserId), 'the link must carry the REAL owner userId as customerId');
    assert.match(href, new RegExp('siteId=' + site.id), 'the link must carry the REAL site id');
    assert.doesNotMatch(href, /demo_customer_elena/, 'the real dashboard link must never reference the demo tenant');

    const dashOpened = page.context().waitForEvent('page');
    await bookingsLink.click();
    dashboardPage = await dashOpened;
    await dashboardPage.waitForLoadState('networkidle');

    // No "Autentificare necesară" — the real hb_session cookie from step 3
    // carries over because this is the SAME context, and the host page's
    // real-mode branch never called /api/calendar-native/owner/preview-session.
    await dashboardPage.locator('.hod-shell').waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      await dashboardPage.locator('.hod-auth').count(),
      0,
      'the owner must NOT see "Autentificare necesară" — their real session must already be valid here'
    );
    const rootEl = dashboardPage.locator('#hod-root');
    assert.equal(await rootEl.getAttribute('data-customer-id'), ownerUserId, 'the mounted dashboard must be scoped to the REAL owner, not the demo tenant');
    assert.equal(await rootEl.getAttribute('data-site-id'), site.id);

    const bookingRow = dashboardPage.locator('.hod-booking', { hasText: visitorName });
    await bookingRow.waitFor({ state: 'visible', timeout: 15000 });
    await dashboardPage.screenshot({ path: path.join(EVIDENCE, '06-owner-dashboard-shows-booking.png'), fullPage: true });

    console.log('PASS wave8-calendar-reachable-e2e: seeded native-booking site → visitor books → owner sees it in their own (non-demo) dashboard');
  } finally {
    if (dashboardPage) await dashboardPage.close().catch(() => {});
    if (livePage) await livePage.close().catch(() => {});
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
