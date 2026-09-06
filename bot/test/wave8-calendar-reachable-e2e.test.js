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
    // 1. Create a professionals site (fresh browser, no session yet).
    // =====================================================================
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);

    // =====================================================================
    // 2. Open the drawer and turn ON native booking — this control did not
    //    exist at all before this wave; if it regresses, this locator times
    //    out and the test fails here.
    // =====================================================================
    if (!(await page.locator('#details-drawer').isVisible().catch(() => false))) {
      await page.locator('#btn-open-drawer').click();
    }
    await page.locator('#details-drawer').waitFor({ state: 'visible' });

    const toggleOn = page.locator('button[aria-label="Activează calendarul nativ de programări Hidook"]');
    await toggleOn.waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(EVIDENCE, '01-drawer-toggle-off.png') });
    await toggleOn.click();
    await page.waitForTimeout(600);

    const toggleOff = page.locator('button[aria-label="Dezactivează calendarul nativ de programări Hidook"]');
    await toggleOff.waitFor({ state: 'visible' });
    assert.ok(
      await page.locator('.hb-secrow__label', { hasText: 'Activ pe site-ul public' }).isVisible(),
      'toggling on must flip the drawer label to "Activ pe site-ul public"'
    );
    await page.screenshot({ path: path.join(EVIDENCE, '02-drawer-toggle-on.png') });

    // Written straight through draft.config → saveDraft() (localStorage),
    // exactly like every other field — undo/redo, autosave, and the publish
    // payload all cover it for free.
    const draftAfterToggle = await page.evaluate(() => JSON.parse(localStorage.getItem('hb.draft.v1') || 'null'));
    assert.ok(draftAfterToggle && draftAfterToggle.config, 'saveDraft() must have persisted a draft to localStorage');
    assert.ok(
      /^(da|yes|true|1|on|y|enabled)$/i.test(String(draftAfterToggle.config.appointment.nativeBooking || '').trim()),
      'appointment.nativeBooking must be truthy in the persisted draft after clicking Activează'
    );

    await page.locator('#btn-close-drawer').click().catch(() => {});

    // =====================================================================
    // 3. Publish for real: slug, magic-link sign-in, HIDOOK_TEST_PAY.
    // =====================================================================
    const runSlug = 'wave8-reach-' + crypto.randomBytes(4).toString('hex');
    const ownerEmail = 'wave8-reachable-owner@example.com';

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await page.locator('#input-slug').fill(runSlug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });

    await page.locator('#input-email').fill(ownerEmail);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
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
      'once native booking is on, the legacy Cal.com/local booking link must not also render'
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
    // shows a 14-day strip of day buttons; walk forward until one has a slot.
    let slotBtn = null;
    for (let i = 0; i < 14; i++) {
      await visitorPage.waitForTimeout(400);
      const candidate = visitorPage.locator('.hnb__slot').first();
      if (await candidate.count()) { slotBtn = candidate; break; }
      const days = visitorPage.locator('.hnb__day');
      const n = await days.count();
      if (i + 1 < n) await days.nth(i + 1).click();
    }
    assert.ok(slotBtn, 'no bookable slot found across the 14-day window — cutover must have seeded weekly availability');
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
    // intercept clicks on anything behind it — close it first, exactly like
    // a real owner clicking "Înapoi la editor" would.
    await page.locator('#btn-success-close').click().catch(() => {});
    await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {});

    await page.locator('#nav-dashboard').click().catch(async () => {
      await page.evaluate(() => { window.location.hash = '#dashboard'; });
    });
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

    console.log('PASS wave8-calendar-reachable-e2e: toggle → publish → visitor books → owner sees it in their own (non-demo) dashboard');
  } finally {
    if (dashboardPage) await dashboardPage.close().catch(() => {});
    if (livePage) await livePage.close().catch(() => {});
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
