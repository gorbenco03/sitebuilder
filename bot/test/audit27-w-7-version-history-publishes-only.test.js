'use strict';
/**
 * bot/test/audit27-w-7-version-history-publishes-only.test.js
 *
 * W-7 (VERIFICARE-2026-10-04 mediums journey-desktop#5, journey-phone#13,
 * editor-integrity#5, errors-copy#17, layout-responsive#6): Istoric versiuni
 * listed 4-10 near-identical rows after one publish because draft autosaves
 * are stored as versions too. Now only real publishes/restores are listed,
 * the live one carries a "Live" badge, dates are Romanian.
 *
 * Flow: publish, several autosaves, publish again -> exactly 2 rows, newest
 * Live; restore the older one from the modal -> 3 rows, the restored one Live.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w-7-version-history-publishes-only.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PW_CANDIDATES = [
  path.join(ROOT, 'node_modules', 'playwright'),
  '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
];
let chromium;
for (const cand of PW_CANDIDATES) {
  try { ({ chromium } = require(cand)); break; } catch (_) {}
}
if (!chromium) throw new Error('playwright not found; install or link node_modules/playwright');

function cfg(name) {
  return {
    business: { name, title: name + ' | Test', metaDescription: name + ' - descriere de test.', lang: 'ro' },
    hero: { background: "url('images/cn-hero.jpg')", ctaLabel: 'Sună acum' },
    contact: { phone: '+40721234567' },
    footer: { address: 'Strada Test 1, București' },
  };
}

test('W-7: version history lists only publishes/restores, marks Live, Romanian dates', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w7-'));
  process.env.SERVER_SECRET = 'audit27-w7-' + crypto.randomBytes(8).toString('hex');
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN', 'HIDOOK_FAKE_DEPLOY', 'DEPLOY_PROVIDER']) delete process.env[k];

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  process.env.PUBLIC_URL = base;

  // API client (cookie jar) for the setup steps.
  const jar = {};
  const call = async (p, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    const cs = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    if (cs) headers.Cookie = cs;
    const res = await fetch(base + p, { ...opts, headers, redirect: 'manual' });
    for (const sc of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const first = sc.split(';')[0]; const eq = first.indexOf('=');
      if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
    }
    return res;
  };
  const post = (p, body) => call(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const email = 'audit27-w7-' + crypto.randomUUID().slice(0, 8) + '@example.com';
  const login = await (await post('/api/auth/email', { email })).json();
  const token = new URL(login.devLink).searchParams.get('token');
  assert.equal((await call('/auth/verify?token=' + encodeURIComponent(token))).status, 302);

  const browser = await chromium.launch({ headless: true });
  try {
    // Publish #1 (paid + live through test checkout).
    const pub = await post('/api/publish', { templateId: 'product-menu', config: cfg('W7-PRIMA'), images: [] });
    assert.equal(pub.status, 200, await pub.clone().text());
    const pubBody = await pub.json();
    const siteId = pubBody.site.id;
    const sess = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
    assert.ok(sess, 'test-pay session id');
    assert.equal((await post('/api/test-pay/complete', { sessionId: sess[1] })).status, 200);

    // Several autosaves, then publish #2.
    for (let i = 1; i <= 5; i++) {
      const a = await post('/api/draft', { siteId, templateId: 'product-menu', config: cfg('W7-AUTOSAVE-' + i) });
      assert.equal(a.status, 200, await a.clone().text());
    }
    const rep = await post('/api/publish', { siteId, templateId: 'product-menu', config: cfg('W7-A-DOUA'), images: [] });
    assert.equal(rep.status, 200, await rep.clone().text());

    const list1 = (await (await call('/api/sites/' + siteId + '/versions')).json()).versions;
    assert.equal(list1.length, 2, 'API lists exactly the 2 publishes, no autosaves: ' + JSON.stringify(list1.map((v) => v.description)));
    assert.deepEqual(list1.map((v) => v.live), [false, true], 'newest published version is the live one');

    // Real browser: log in through the magic link, open Istoric from the dashboard.
    const login2 = await (await fetch(base + '/api/auth/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    })).json();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(login2.devLink, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/#dashboard$/, { timeout: 15000 });
    await page.locator('#hb-cookie-accept').click({ timeout: 3000 }).catch(() => {});

    const openHistory = async () => {
      await page.locator('button:has-text("Istoric")').first().click();
      await page.locator('#versions-list .version-item').first().waitFor({ state: 'visible' });
    };
    const rows = async () => page.$$eval('#versions-list .version-item', (els) => els.map((el) => ({
      date: (el.querySelector('.version-date') || {}).textContent || '',
      desc: (el.querySelector('.version-item-desc') || {}).textContent || '',
      live: !!el.querySelector('.version-live-badge'),
      badgeText: (el.querySelector('.version-live-badge') || {}).textContent || '',
      restore: (el.querySelector('.btn-rollback') || {}).textContent || '',
    })));
    const shot = async (name) => page.screenshot({ path: path.join(os.tmpdir(), 'audit27-w7-' + name + '.png') });

    await openHistory();
    let r = await rows();
    await shot('after-second-publish-history-open');
    assert.equal(r.length, 2, 'modal shows exactly 2 rows after publish + autosaves + publish: ' + JSON.stringify(r));
    assert.deepEqual(r.map((x) => x.live), [true, false], 'newest row (top) carries the Live badge');
    assert.equal(r[0].badgeText, 'Live');
    assert.match(r[0].desc, /W7-A-DOUA/);
    assert.match(r[1].desc, /W7-PRIMA/);
    const RO_MONTHS = /(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)/;
    for (const row of r) {
      assert.match(row.date, RO_MONTHS, 'Romanian month name in date: ' + row.date);
      assert.match(row.date, /\d{2}:\d{2}/, 'time present: ' + row.date);
      assert.ok(!/\//.test(row.date), 'no en-GB dd/mm/yyyy: ' + row.date);
      assert.equal(row.restore.trim(), 'Restabilește');
    }

    // Restore the older version from the modal.
    await page.locator('#versions-list .version-item').nth(1).locator('.btn-rollback').click();
    await page.locator('#modal-versions').waitFor({ state: 'hidden', timeout: 25000 });
    await openHistory();
    r = await rows();
    await shot('after-restore-history-open');
    assert.equal(r.length, 3, 'restore adds exactly one row: ' + JSON.stringify(r));
    assert.deepEqual(r.map((x) => x.live), [true, false, false], 'the restored version is the Live one');
    assert.match(r[0].desc, /W7-PRIMA/, 'restored row carries the restored content');
    assert.match(r[1].desc, /W7-A-DOUA/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
});
