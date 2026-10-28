'use strict';
/**
 * bot/test/builder-shell.test.js
 *
 * The /app/ shell after the form editor was removed (2026-10-28), in a real
 * browser: the catalog lists every starter design and its chips filter them,
 * "Începe" opens the block editor on that design, the retired #edit route
 * lands on Site-urile mele, an unpaid form-template draft is shown as not
 * editable and cannot be paid for, and signing out clears the local drafts
 * tied to the account.
 *
 * Run: node --experimental-sqlite --test bot/test/builder-shell.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-shell-'));
process.env.SERVER_SECRET = 'shell-' + crypto.randomBytes(8).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { SB, signInPage, acceptCookies, postJson, blocksConfig } = require('./lib/dash-seed.js');

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
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors };
}

test('catalog: one card per starter design, chips filter them, Începe opens the block editor', async () => {
  const { context, page, errors } = await newPage();
  try {
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    const packIds = Object.keys(SB.packs());
    await page.waitForFunction((n) => document.querySelectorAll('#templates-grid .template-card').length === n, packIds.length);
    const ids = await page.$$eval('#templates-grid .template-card', (cards) => cards.map((c) => c.dataset.templateId));
    assert.deepEqual([...ids].sort(), [...packIds].sort(), 'every pack, once');
    assert.equal(ids[0], 'gol', '"De la zero" comes first');

    // Each chip leaves at least one design plus "De la zero", and hides the rest.
    const chips = await page.$$eval('#catalog-chips .catalog-chip', (els) => els.map((e) => e.dataset.filter));
    assert.ok(chips.length >= 5, 'chips present');
    for (const chip of chips.filter((c) => c !== 'all')) {
      await page.click(`#catalog-chips .catalog-chip[data-filter="${chip}"]`);
      const visible = await page.$$eval('#templates-grid .template-card', (cards) =>
        cards.filter((c) => !c.hidden).map((c) => c.dataset.templateId));
      assert.ok(visible.includes('gol'), chip + ': "De la zero" stays');
      assert.ok(visible.length >= 2 && visible.length < ids.length, chip + ' filters: ' + visible.join(','));
      assert.equal(await page.getAttribute(`#catalog-chips .catalog-chip[data-filter="${chip}"]`, 'aria-pressed'), 'true');
    }

    // Hero stage shows real pages, not empty paper.
    assert.equal(await page.locator('#hero-stage-stack iframe').count(), 3, 'hero stage has three designs');

    await page.click('#catalog-chips .catalog-chip[data-filter="all"]');
    await page.click('#templates-grid .template-card[data-template-id="restaurant"] .btn-start-tpl');
    await page.waitForURL(/\/app\/blocks\/\?pack=restaurant$/);
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('the retired #edit route lands on Site-urile mele', async () => {
  const { context, page, errors } = await newPage();
  try {
    await page.goto(base + '/app/#edit', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/#dashboard$/);
    await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('an unpaid form-template draft is marked not editable and offers no payment', async () => {
  const { context, page, errors } = await newPage();
  try {
    await signInPage(page, base, 'shell-legacy-' + crypto.randomUUID().slice(0, 8) + '@example.com');
    const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'product-menu', 'presets.json'), 'utf8'));
    const cfg = (Array.isArray(preset) ? preset[0] : preset.presets[0]).config;
    const r = await postJson(page, base, '/api/draft', { templateId: 'product-menu', config: cfg });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await page.reload();
    const card = page.locator('.site-card').first();
    await card.waitFor();
    assert.match(await card.innerText(), /editorul vechi/);
    assert.equal(await card.locator('.site-card-actions >> text=Editează').count(), 0, 'no Editează');
    assert.equal(await card.locator('.site-card-actions >> text=Adaugă un card').count(), 0, 'no pay button');
    assert.equal(await card.locator('.site-card-actions >> text=Șterge').count(), 1, 'still deletable');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('signing out clears drafts tied to the account, keeps an anonymous block draft', async () => {
  const { context, page, errors } = await newPage();
  try {
    await signInPage(page, base, 'shell-logout-' + crypto.randomUUID().slice(0, 8) + '@example.com');
    const r = await postJson(page, base, '/api/draft', { templateId: 'blocks', config: blocksConfig('salon', 'Salon Shell') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await page.evaluate((siteId) => {
      localStorage.setItem('hb.blocks.draft.v1', JSON.stringify({ siteId, site: {}, at: Date.now() }));
      localStorage.setItem('hb.draft.v1', JSON.stringify({ templateId: 'product-menu' }));
      localStorage.setItem('hb.history.v2', '[]');
    }, r.body.site.id);
    await page.click('#btn-logout');
    await page.waitForURL(/#templates$/);
    const left = await page.evaluate(() => ['hb.blocks.draft.v1', 'hb.draft.v1', 'hb.history.v2'].map((k) => localStorage.getItem(k)));
    assert.deepEqual(left, [null, null, null], 'account drafts cleared');

    // An anonymous block draft (no siteId yet) belongs to nobody — sign-out leaves it.
    await signInPage(page, base, 'shell-logout2-' + crypto.randomUUID().slice(0, 8) + '@example.com');
    await page.evaluate(() => localStorage.setItem('hb.blocks.draft.v1', JSON.stringify({ siteId: null, site: {}, at: 1 })));
    await page.click('#btn-logout');
    await page.waitForURL(/#templates$/);
    assert.ok(await page.evaluate(() => localStorage.getItem('hb.blocks.draft.v1')), 'anonymous draft kept');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await context.close();
  }
});
