'use strict';
/**
 * RO copy sweep browser evidence — isolated /app only.
 * Writes under 04-QA-Evidence/Flow4/RoCopySweep/
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { chromium } = require('/Users/Work/.hermes/hermes-agent/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '04-QA-Evidence', 'Flow4', 'RoCopySweep');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro-copy-ev-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'ro-copy-ev-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.NODE_ENV = 'test';

const registry = require('../bot/registry.js');
const auth = require('../bot/auth.js');
const { startServer } = require('../bot/server.js');
const { renderHtml } = require('../build.js');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const server = startServer({ port: 0 });
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;
  process.env.PUBLIC_URL = BASE;

  const user = registry.getOrCreateUserByEmail('ro-copy-sweep@example.com');
  const cookie = 'hb_session=' + auth.signSession(user.id);

  // Seed a paid live site so dashboard shows Active + History
  const site = registry.createSite({
    userId: user.id,
    templateId: 'product-menu',
    templateVersion: 1,
    slug: 'ro-copy-demo',
    platform: 'web',
  });
  const presets = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8')
  );
  const cfg = JSON.parse(JSON.stringify(presets.presets[0].config));
  registry.saveVersion(site.id, cfg);
  registry.updateSite(site.id, {
    paid: true,
    status: 'live',
    paidUntil: new Date(Date.now() + 365 * 864e5).toISOString(),
    url: BASE + '/live/' + site.slug + '/',
  });

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ro-RO',
  });
  await context.addCookies([
    {
      name: 'hb_session',
      value: cookie.replace(/^hb_session=/, ''),
      url: BASE,
    },
  ]);

  const page = await context.newPage();

  // 1) Builder nav + cookie banner (clear consent)
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('hb-cookie-consent');
    } catch (_) {}
  });
  await page.goto(BASE + '/app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT, '01-builder-nav-cookie.png'),
    fullPage: false,
  });

  // Cookie banner close-up
  const banner = page.locator('#hb-cookie-banner');
  if (await banner.count()) {
    await banner.evaluate((el) => {
      el.hidden = false;
    });
    await banner.screenshot({ path: path.join(OUT, '02-cookie-banner.png') });
  }

  // 2) Dashboard card
  await page.goto(BASE + '/app/#dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(OUT, '03-dashboard.png'),
    fullPage: false,
  });

  // 3) Editor toolbar + IG modal
  await page.goto(BASE + '/app/#templates', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // Start product-menu if button exists
  const startBtn = page.locator('[data-id="product-menu"], .btn-start-tpl').first();
  if (await startBtn.count()) {
    await startBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    // force hash edit with draft via evaluate
    await page.evaluate(() => {
      try {
        localStorage.setItem(
          'hb-draft',
          JSON.stringify({ templateId: 'product-menu', config: {} })
        );
      } catch (_) {}
      location.hash = '#edit';
    });
    await page.waitForTimeout(1500);
  }
  await page.screenshot({
    path: path.join(OUT, '04-editor-toolbar.png'),
    fullPage: false,
  });

  // Open IG modal (close Details drawer overlay if open)
  await page.evaluate(() => {
    const o = document.getElementById('drawer-overlay');
    if (o) {
      o.style.display = 'none';
      o.setAttribute('aria-hidden', 'true');
    }
    const d = document.getElementById('details-drawer');
    if (d) d.style.display = 'none';
  });
  const igBtn = page.locator('#btn-add-instagram');
  if (await igBtn.count()) {
    await igBtn.click({ force: true });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT, '05-instagram-modal.png'),
      fullPage: false,
    });
    await page.locator('#btn-close-instagram').click({ force: true }).catch(() => {});
  }

  // 4) Trial success modal — force show via DOM
  await page.evaluate(() => {
    const m = document.getElementById('modal-success');
    if (m) m.style.display = 'flex';
  });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, '06-trial-success-modal.png'),
    fullPage: false,
  });
  await page.evaluate(() => {
    const m = document.getElementById('modal-success');
    if (m) m.style.display = 'none';
  });

  // 5) Restaurant demo hero — render preset0 to static HTML
  const tpl = fs.readFileSync(
    path.join(ROOT, 'templates/product-menu/template.html'),
    'utf8'
  );
  let html = renderHtml(tpl, cfg);
  // inline styles path relative won't load; still see text
  const heroPath = path.join(OUT, '07-restaurant-demo-hero.html');
  fs.writeFileSync(heroPath, html, 'utf8');
  const heroPage = await context.newPage();
  await heroPage.setContent(html, { waitUntil: 'domcontentloaded' });
  await heroPage.waitForTimeout(400);
  await heroPage.screenshot({
    path: path.join(OUT, '07-restaurant-demo-hero.png'),
    fullPage: false,
  });
  await heroPage.close();

  // Text extract for handoff
  const navText = await page.evaluate(() => {
    const nav = document.querySelector('#header-nav');
    return nav ? nav.innerText : '';
  });
  fs.writeFileSync(
    path.join(OUT, 'NOTES.txt'),
    [
      'RO copy sweep evidence',
      'BASE=' + BASE,
      'DATA_DIR=' + tmpDir,
      'HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 no HIDOOK_FAKE_DEPLOY',
      'nav sample after visit: (see screenshots)',
      'preset0 CTA: ' + (cfg.hero && cfg.hero.ctaLabel),
      'preset0 servicesTitle: ' + cfg.servicesTitle,
      'preset0 tagline: ' + (cfg.business && cfg.business.tagline),
      'Files: 01-builder-nav-cookie 02-cookie-banner 03-dashboard 04-editor-toolbar 05-instagram-modal 06-trial-success-modal 07-restaurant-demo-hero',
    ].join('\n') + '\n',
    'utf8'
  );

  await browser.close();
  await new Promise((r) => server.close(() => r()));
  console.log('evidence written to', OUT);
  console.log(fs.readdirSync(OUT).join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
