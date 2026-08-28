'use strict';
/**
 * Flow 4.2 browser evidence — commercial E2E (fake checkout → live → cancel → RO lock).
 * Local only (HIDOOK_TEST_PAY + HIDOOK_ISOLATED_DEPLOY). No live Stripe.
 * Writes under 04-QA-Evidence/Flow4/CommercialE2E/
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { chromium } = require('/Users/Work/.hermes/hermes-agent/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '04-QA-Evidence', 'Flow4', 'CommercialE2E');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow4-ev-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'flow4-ev-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.NODE_ENV = 'test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const registry = require('../bot/registry.js');
const auth = require('../bot/auth.js');
const { startServer } = require('../bot/server.js');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const server = startServer({ port: 0 });
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;
  process.env.PUBLIC_URL = BASE;

  const preset = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8')
  );
  const cfg = JSON.parse(JSON.stringify(preset.presets[0]));
  cfg.business = cfg.business || {};
  const distinctive = 'Flow4 Commercial ' + crypto.randomBytes(2).toString('hex');
  cfg.business.name = distinctive;
  cfg.business.title = distinctive;

  const user = registry.getOrCreateUserByEmail('flow4-ev@example.com');
  const sessionCookie = 'hb_session=' + auth.signSession(user.id);

  const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(brave) ? brave : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([
    {
      name: 'hb_session',
      value: sessionCookie.replace(/^hb_session=/, ''),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
    },
  ]);
  await context.addInitScript(() => {
    try {
      localStorage.removeItem('hb-cookie-consent');
    } catch (e) {}
  });
  const page = await context.newPage();

  // 1) Builder landing — RO commercial chrome
  await page.goto(BASE + '/app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const accept = page.locator('#hb-cookie-accept');
  if (await accept.count()) {
    await accept.click().catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.screenshot({
    path: path.join(OUT, '01-builder-landing-commercial.png'),
    fullPage: true,
  });
  const landingText = await page.evaluate(() => document.body.innerText || '');
  fs.writeFileSync(path.join(OUT, '01-builder-landing-text.txt'), landingText.slice(0, 8000));

  // 2) POST /api/publish → offline test checkout
  const pubRes = await fetch(BASE + '/api/publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      'CF-IPCountry': 'RO',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      templateId: 'product-menu',
      slug: 'f4ev-' + crypto.randomUUID().slice(0, 8),
      config: cfg,
      images: [],
    }),
  });
  const pubBody = await pubRes.json();
  if (pubRes.status !== 200 || !pubBody.paymentUrl || !pubBody.site) {
    throw new Error('publish failed: ' + pubRes.status + ' ' + JSON.stringify(pubBody));
  }
  const siteId = pubBody.site.id;
  const slug = pubBody.site.slug;
  const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
  if (!m) throw new Error('no test-checkout in ' + pubBody.paymentUrl);
  const sessionId = m[1];

  // Unpaid lock screenshot
  await page.goto(BASE + '/live/' + slug + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-unpaid-live-locked.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, '02-unpaid-live.html'), await page.content());

  // 3) Fake checkout complete → live
  const doneRes = await fetch(BASE + '/api/test-pay/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Accept: 'application/json',
    },
    body: JSON.stringify({ sessionId }),
  });
  const doneBody = await doneRes.json().catch(() => ({}));
  if (doneRes.status !== 200 && doneRes.status !== 201) {
    throw new Error('test-pay complete failed: ' + doneRes.status + ' ' + JSON.stringify(doneBody));
  }

  const liveUrl = BASE + '/live/' + slug + '/';
  await page.goto(liveUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '03-after-checkout-live.png'), fullPage: true });
  const liveText = await page.evaluate(() => document.body.innerText || '');
  fs.writeFileSync(path.join(OUT, '03-live-text.txt'), liveText.slice(0, 8000));
  fs.writeFileSync(path.join(OUT, '03-live.html'), await page.content());

  // 4) Cancel via billing-portal (offline unpublish)
  let site = registry.getSite(siteId);
  if (!site.stripeSubscriptionId) {
    registry.updateSite(siteId, {
      stripeSubscriptionId: 'sub_test_f4ev_' + crypto.randomBytes(4).toString('hex'),
      stripeCustomerId: site.stripeCustomerId || 'cus_test_f4ev_' + siteId.slice(0, 8),
    });
  }
  const portalRes = await fetch(BASE + '/api/sites/' + encodeURIComponent(siteId) + '/billing-portal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Accept: 'application/json',
    },
    body: '{}',
  });
  const portalBody = await portalRes.json().catch(() => ({}));
  if (portalRes.status !== 200) {
    throw new Error('billing-portal failed: ' + portalRes.status + ' ' + JSON.stringify(portalBody));
  }

  site = registry.getSite(siteId);
  await page.goto(liveUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, '04-after-cancel-locked-ro.png'),
    fullPage: true,
  });
  const lockedHtml = await page.content();
  const lockedText = await page.evaluate(() => document.body.innerText || '');
  fs.writeFileSync(path.join(OUT, '04-after-cancel.html'), lockedHtml);
  fs.writeFileSync(path.join(OUT, '04-after-cancel-text.txt'), lockedText.slice(0, 4000));

  // 5) Optional: open builder again to show RO pay CTA on dashboard (auth cookie)
  await page.goto(BASE + '/app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT, '05-builder-after-cancel.png'),
    fullPage: true,
  });

  const notes = [
    '# Flow 4 Commercial E2E — browser evidence',
    '',
    `- Captured: ${new Date().toISOString()}`,
    `- Builder base: ${BASE}`,
    `- Site id: ${siteId}`,
    `- Slug: ${slug}`,
    `- Distinctive business name: ${distinctive}`,
    `- Publish paymentUrl: ${pubBody.paymentUrl}`,
    `- test-checkout session: ${sessionId}`,
    `- test-pay complete: status=${doneRes.status} ok=${!!doneBody.ok}`,
    `- Live URL: ${liveUrl}`,
    `- Portal: status=${portalRes.status} url=${portalBody.portalUrl || portalBody.url || ''}`,
    `- After cancel site.status: ${site && site.status}`,
    `- After cancel site.paid: ${site && site.paid}`,
    `- Live page contains distinctive name before cancel: ${liveText.includes(distinctive)}`,
    `- Locked page RO "nu mai este public": ${/nu mai este public/i.test(lockedText + lockedHtml)}`,
    `- Locked page "anulat": ${/anulat/i.test(lockedText + lockedHtml)}`,
    `- Locked page lang=ro: ${/lang=["']ro["']/i.test(lockedHtml)}`,
    `- Landing "7 zile": ${/7\s*zile/i.test(landingText)}`,
    `- Landing 99: ${/\b99\b/.test(landingText)}`,
    `- Landing 29: ${/\b29\b/.test(landingText)}`,
    '',
    '## Screenshots',
    '- 01-builder-landing-commercial.png — RO trial/card/99/29 chrome',
    '- 02-unpaid-live-locked.png — unpaid /live Romanian lock',
    '- 03-after-checkout-live.png — fake checkout → live immediately',
    '- 04-after-cancel-locked-ro.png — cancel → Romanian unpublished state',
    '- 05-builder-after-cancel.png — builder after cancel',
    '',
    '## Gates',
    '- HIDOOK_TEST_PAY=1, HIDOOK_ISOLATED_DEPLOY=1, no STRIPE_SECRET_KEY',
    '- node bot/test/flow4-commercial-e2e.test.js',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), notes);

  await browser.close();
  await new Promise((r) => server.close(() => r()));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
  console.log('Flow4 CommercialE2E evidence written to', OUT);
  console.log(notes);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
