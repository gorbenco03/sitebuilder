'use strict';
/**
 * bot/test/booking-block.test.js
 *
 * The "Programări online" block of the block editor (2026-10-28): the owner
 * sets services and weekly hours in the block, publishing makes the native
 * calendar match them, the published page mounts the live booking widget, a
 * downloaded copy lists services and a phone instead, and the owner reaches
 * the bookings from Site-urile mele.
 *
 * Browser part, as a customer and a visitor would do it: the block's panel in
 * the editor, the "Programări" link on the dashboard card, a real booking made
 * on the published page, and the calendar dashboard showing the editor as the
 * place to change hours.
 *
 * Run: node --experimental-sqlite --test bot/test/booking-block.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-booking-block-'));
process.env.SERVER_SECRET = 'booking-' + crypto.randomBytes(8).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'HIDOOK_FAKE_DEPLOY']) delete process.env[k];

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
const { SB, signInPage, postJson, publishLive, publishSite, openDashboardCard } = require('./lib/dash-seed.js');

let server;
let base;
let browser;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  process.env.PUBLIC_URL = base;
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function newPage(viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors };
}

const everyDay = () => Array.from({ length: 7 }, () => ({ on: true, from: '06:00', to: '23:30' }));

/** A salon site whose booking block offers the given services every day of the week. */
function salonWithBooking(name, services, week) {
  const cfg = SB.defaultSite('salon');
  SB.applyIdentity(cfg, { name, phone: '0722 123 456' });
  const block = SB.bookingBlocks(cfg)[0];
  block.data.services = services;
  block.data.week = week || everyDay();
  return cfg;
}

function bookingPage(cfg) {
  const page = cfg.pages.find((p) => p.blocks.some((b) => b.type === 'booking'));
  return SB.pageFile(cfg, page);
}

test('the block renders a preview in the editor, the live widget when published, services and a phone offline', () => {
  const cfg = SB.normalizeSite(salonWithBooking('Salon Test', [{ name: 'Tuns', min: '45' }, { name: '', min: '30' }],
    [{ on: true, from: '09:00', to: '17:00' }, { on: true, from: '18:00', to: '10:00' }]));
  const page = cfg.pages.find((p) => p.blocks.some((b) => b.type === 'booking'));
  const block = SB.bookingBlocks(cfg)[0];

  assert.deepEqual(SB.bookingServices(block.data), [{ name: 'Tuns', min: 45 }], 'unnamed services are dropped');
  const week = SB.bookingWeek(block.data);
  assert.equal(week.length, 7);
  assert.equal(week[0].on, true);
  assert.equal(week[1].on, false, 'a day whose end is before its start takes no bookings');
  assert.equal(week[6].on, false, 'missing days are closed');

  const editor = SB.renderPage(cfg, page.id, '/');
  assert.match(editor, /Alege serviciul/);
  assert.doesNotMatch(editor, /data-hidook-cal-native/, 'the editor never boots the live widget');

  const live = SB.renderPage(cfg, page.id, { published: true, booking: { customerId: 'u_1', siteId: 's_1', apiBase: 'https://cal.test', brand: 'Salon Test' } });
  assert.match(live, /<div data-hidook-cal-native data-customer-id="u_1" data-site-id="s_1" data-api-base="https:\/\/cal\.test"/);
  assert.match(live, /src="https:\/\/cal\.test\/calendar-native\/widget\/public-booking-widget\.js"/);
  assert.match(live, /href="tel:0722123456"/);

  const offline = SB.renderPage(cfg, page.id, { published: true });
  assert.doesNotMatch(offline, /data-hidook-cal-native|calendar-native/, 'a downloaded copy never calls the booking server');
  assert.match(offline, /Pentru programare sună la <a href="tel:0722123456">/);
  assert.match(offline, /Tuns/);
});

test('starter booking hours are flagged before publishing; changed ones are not', () => {
  const fresh = SB.defaultSite('salon');
  assert.ok(SB.demoLeftovers(fresh).some((x) => x.key === 'booking'));
  const changed = SB.defaultSite('salon');
  SB.bookingBlocks(changed)[0].data.week[6] = { on: true, from: '10:00', to: '14:00' };
  assert.ok(!SB.demoLeftovers(changed).some((x) => x.key === 'booking'));
});

test('the downloaded ZIP tree lists services and the phone instead of the live calendar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-zip-'));
  try {
    const cfg = salonWithBooking('Salon Zip', [{ name: 'Manichiură', min: '60' }]);
    siteExport.buildBlocksSiteTree(dir, cfg, {});
    const html = fs.readFileSync(path.join(dir, bookingPage(cfg)), 'utf8');
    assert.doesNotMatch(html, /data-hidook-cal-native|calendar-native/);
    assert.match(html, /Manichiură/);
    assert.match(html, /tel:0722123456/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publishing makes the calendar match the block; republishing follows the block', async () => {
  const { context, page } = await newPage();
  try {
    await signInPage(page, base, `booking-sync-${crypto.randomUUID().slice(0, 8)}@example.com`);
    const cfg = salonWithBooking('Salon Sync', [{ name: 'Tuns', min: '60' }, { name: 'Vopsit', min: '90' }],
      [{ on: true, from: '09:00', to: '17:00' }, ...Array.from({ length: 6 }, () => ({ on: false, from: '09:00', to: '17:00' }))]);
    const pub = await publishLive(page, base, { config: cfg, slug: 'salon-sync-' + crypto.randomUUID().slice(0, 6) });
    const me = (await (await page.request.get(base + '/api/me')).json()).user;
    const tenant = `customerId=${encodeURIComponent(me.id)}&siteId=${encodeURIComponent(pub.siteId)}`;

    const html = await (await page.request.get(`${base}/live/${pub.slug}/${bookingPage(cfg)}`)).text();
    assert.ok(html.includes(`data-customer-id="${me.id}"`) && html.includes(`data-site-id="${pub.siteId}"`), 'widget carries this tenant');
    assert.ok(html.includes(`data-api-base="${base}"`), 'widget calls the booking server');

    const names = async () => (await (await page.request.get(`${base}/api/calendar-native/services?${tenant}`)).json()).services.map((s) => s.name);
    assert.deepEqual(await names(), ['Tuns', 'Vopsit']);
    const avail = await (await page.request.get(`${base}/api/calendar-native/owner/availability?${tenant}`)).json();
    assert.deepEqual(avail.weekly.map((w) => [w.weekday, w.startMinute, w.endMinute]), [[1, 540, 1020]]);

    // The owner drops a service and opens Saturday, then publishes again.
    SB.bookingBlocks(cfg)[0].data.services = [{ name: 'Tuns', min: '60' }];
    SB.bookingBlocks(cfg)[0].data.week[5] = { on: true, from: '10:00', to: '14:00' };
    const again = await postJson(page, base, '/api/publish', { templateId: 'blocks', config: cfg, images: [], siteId: pub.siteId, slug: pub.slug });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(await names(), ['Tuns'], 'a service removed from the block is no longer offered');
    const avail2 = await (await page.request.get(`${base}/api/calendar-native/owner/availability?${tenant}`)).json();
    assert.deepEqual(avail2.weekly.map((w) => [w.weekday, w.startMinute, w.endMinute]), [[1, 540, 1020], [6, 600, 840]]);
  } finally {
    await context.close();
  }
});

test('a site without a booking block publishes no calendar', async () => {
  const { context, page } = await newPage();
  try {
    await signInPage(page, base, `booking-none-${crypto.randomUUID().slice(0, 8)}@example.com`);
    const pub = await publishLive(page, base, { pack: 'restaurant', name: 'Bistro Fără', slug: 'bistro-fara-' + crypto.randomUUID().slice(0, 6) });
    const me = (await (await page.request.get(base + '/api/me')).json()).user;
    const r = await page.request.get(`${base}/api/calendar-native/services?customerId=${me.id}&siteId=${pub.siteId}`);
    assert.equal(r.status(), 404, 'no calendar for this site');
  } finally {
    await context.close();
  }
});

test('in the editor the block panel edits services and the days of the week', async () => {
  const { context, page, errors } = await newPage({ width: 1440, height: 900 });
  try {
    await page.goto(base + '/app/blocks/?pack=salon', { waitUntil: 'domcontentloaded' });
    await page.locator('#hb-cookie-accept').click({ timeout: 3000 }).catch(() => {});
    const skip = page.getByRole('button', { name: 'Sari peste' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByText('Contact', { exact: true }).first().click();
    await page.locator('#block-list li', { hasText: 'Programări online' }).click();
    await page.locator('#insp-body .weekfld__row').first().waitFor();
    assert.equal(await page.locator('#insp-body .weekfld__row').count(), 7);

    const sunday = page.locator('#insp-body .weekfld__row').nth(6).locator('input[type=checkbox]');
    assert.equal(await sunday.isChecked(), false);
    await sunday.check();
    await page.locator('#insp-body .weekfld__row').nth(6).locator('select').nth(1).selectOption('14:00');
    await page.locator('#insp-body select[data-path="services.0.min"]').selectOption('45');

    const stored = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('hb.blocks.draft.v1'));
      return d.site.pages.flatMap((p) => p.blocks).find((b) => b.type === 'booking').data;
    });
    assert.deepEqual(stored.week[6], { on: true, from: '09:00', to: '14:00' });
    assert.equal(String(stored.services[0].min), '45');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('the owner opens Programări from the card; a visitor books on the site; the booking shows up', async () => {
  const { context, page, errors } = await newPage();
  try {
    await signInPage(page, base, `booking-e2e-${crypto.randomUUID().slice(0, 8)}@example.com`);
    const cfg = salonWithBooking('Salon Vizită', [{ name: 'Tuns de test', min: '30' }]);
    const pub = await publishLive(page, base, { config: cfg, slug: 'salon-vizita-' + crypto.randomUUID().slice(0, 6) });

    // Visitor: the live page, first free day, first time, details, confirm.
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const vp = await visitor.newPage();
    vp.setDefaultTimeout(30000);
    await vp.goto(`${base}/live/${pub.slug}/${bookingPage(cfg)}`, { waitUntil: 'domcontentloaded' });
    await vp.locator('.hnb__svc', { hasText: 'Tuns de test' }).waitFor();
    assert.equal(await vp.locator('.b-book .hnb__title').isVisible(), false, 'the block title is the only heading');
    let slot = vp.locator('.hnb__slot:not([disabled])').first();
    if (!(await slot.isVisible().catch(() => false))) {
      const day = vp.locator('.hnb__cal-day:not(.is-unavailable)').first();
      if (await day.count()) await day.click();
      else await vp.getByRole('button', { name: 'Luna următoare' }).click();
      slot = vp.locator('.hnb__slot:not([disabled])').first();
    }
    await slot.click();
    await vp.locator('.hnb input[name="name"]').fill('Ana Vizitator');
    await vp.locator('.hnb input[name="email"]').fill('ana.vizitator@example.com');
    await vp.locator('.hnb__cta').click();
    const done = vp.locator('[data-hnb-success]');
    await done.waitFor();
    assert.match(await done.innerText(), /Tuns de test/);
    assert.ok(await done.isVisible() && (await done.boundingBox()).y < 844, 'the confirmation is on screen');
    const manage = await done.locator('a').getAttribute('href');
    assert.ok(manage.startsWith(base + '/calendar-native/manage/'), 'manage link points at the booking server, got ' + manage);
    await visitor.close();

    // Owner: the card's Programări link, the booking, hours owned by the editor.
    const card = await openDashboardCard(page, base, pub.slug);
    const link = card.getByRole('link', { name: /Deschide programările/ });
    await link.waitFor();
    const href = await link.getAttribute('href');
    assert.match(href, /blocks=1/);
    assert.match(href, /brand=Salon\+Viz/);
    await page.goto(base + href, { waitUntil: 'domcontentloaded' });
    await page.getByText('Ana Vizitator').waitFor();
    assert.equal(await page.locator('[data-hod-tab="services"]').count(), 0, 'services are edited in the editor');
    await page.locator('[data-hod-tab="avail"]').click();
    const editLink = page.getByRole('link', { name: 'Schimbă programul în editor' });
    await editLink.waitFor();
    assert.equal(await editLink.getAttribute('href'), '/app/blocks/?site=' + encodeURIComponent(pub.siteId));
    assert.equal(await page.locator('[data-hod-save-weekly]').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('an unpaid draft with a booking block publishes nothing to the calendar until it is live', async () => {
  const { context, page } = await newPage();
  try {
    await signInPage(page, base, `booking-unpaid-${crypto.randomUUID().slice(0, 8)}@example.com`);
    const pub = await publishSite(page, base, { config: salonWithBooking('Salon Neplătit', [{ name: 'Tuns', min: '30' }]), slug: 'salon-neplatit-' + crypto.randomUUID().slice(0, 6) });
    assert.equal((await page.request.get(`${base}/live/${pub.slug}/`)).status(), 404);
    const me = (await (await page.request.get(base + '/api/me')).json()).user;
    const r = await page.request.get(`${base}/api/calendar-native/services?customerId=${me.id}&siteId=${pub.siteId}`);
    assert.equal(r.status(), 404, 'the calendar is prepared at publish, not at checkout');
  } finally {
    await context.close();
  }
});
