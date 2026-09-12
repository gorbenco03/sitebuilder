'use strict';
/**
 * bot/test/suite4-toast-and-api-me.test.js
 *
 * Suite 4 QA (m20 + m19) — two small, unrelated builder defects sharing one
 * theme: real feedback getting lost in noise.
 *
 * m20 — toast queue: `#toast` was a single global slot (`builder/app.js`'s
 * showToast()) — a second call replaced whatever was showing INSTANTLY,
 * even a message the user had not had a chance to read (e.g. a failed save
 * immediately followed by another toast). Fixed with a short queue (capped
 * at 2 pending, dropping the oldest) instead of an instant overwrite.
 * Tested here by calling showToast()/advanceToastQueue() directly through
 * page.evaluate() — they are the exact functions real call sites use, and
 * driving them directly makes the assertions about ORDER and the CAP
 * deterministic instead of racing real setTimeout delays.
 *
 * m19 — `GET /api/me` used to return 401 for a visitor with no session
 * cookie at all (the ordinary "am I logged in?" check on every builder
 * load), and Chromium logs "Failed to load resource: the server responded
 * with a status of 401" to the console for ANY fetch() that returns a
 * non-2xx status — regardless of the caller's own try/catch — burying real
 * errors in noise on every single anonymous page load. Fixed in
 * bot/server.js#handleGetMe: no cookie at all -> 200 {user:null}; an
 * actually invalid/revoked cookie still gets a real 401 (see
 * bot/test/api.test.js and wave8-logout-invalidate.test.js for that half
 * of the contract).
 *
 * Run: node --experimental-sqlite --test bot/test/suite4-toast-and-api-me.test.js
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
  '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
];
let chromium;
for (const cand of PW_CANDIDATES) {
  try { ({ chromium } = require(cand)); break; } catch (_) {}
}
if (!chromium) throw new Error('playwright not found; install or link node_modules/playwright');

async function withApp(run) {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite4-toast-me-'));
  process.env.SERVER_SECRET = 'suite4-toast-me-' + crypto.randomBytes(8).toString('hex');
  delete process.env.PUBLIC_URL;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await run(page, base);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

test('m20: a second toast does not instantly erase an unread one', async () => {
  await withApp(async (page, base) => {
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});

    // A long duration on the first message proves this is the QUEUEING
    // decision at work, not just "the first message's own timer hadn't
    // fired yet" — if showToast() still overwrote instantly (the bug),
    // the very next line would flip #toast to "Second" immediately.
    await page.evaluate(() => { hideToast(); showToast('First message', null, 5000); });
    await page.waitForTimeout(80);
    await page.evaluate(() => { showToast('Second message'); });
    await page.waitForTimeout(80);
    assert.strictEqual(await page.locator('#toast').textContent(), 'First message',
      'a second showToast() call must not overwrite the first before it has had time to be read');

    // advanceToastQueue() is the exact function the first message's own
    // setTimeout calls when its duration elapses — invoked directly here
    // instead of waiting out a real 5000ms timer.
    await page.evaluate(() => advanceToastQueue());
    assert.strictEqual(await page.locator('#toast').textContent(), 'Second message',
      'the queued message must be shown once the current one is done');
  });
});

test('m20: the toast queue caps at 2 pending, dropping the oldest', async () => {
  await withApp(async (page, base) => {
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});

    await page.evaluate(() => {
      hideToast();
      showToast('A', null, 5000);
      showToast('B'); // queued: [B]
      showToast('C'); // queued: [B, C]
      showToast('D'); // queued would be [B, C, D] (3) -> capped to [C, D]
    });
    assert.strictEqual(await page.locator('#toast').textContent(), 'A');

    await page.evaluate(() => advanceToastQueue());
    assert.strictEqual(await page.locator('#toast').textContent(), 'C',
      'B should have been dropped once the 2-pending cap was exceeded, not shown before C');

    await page.evaluate(() => advanceToastQueue());
    assert.strictEqual(await page.locator('#toast').textContent(), 'D');

    await page.evaluate(() => advanceToastQueue());
    const finalDisplay = await page.locator('#toast').evaluate((el) => el.style.display);
    assert.strictEqual(finalDisplay, 'none', 'toast should hide once the queue is empty');
  });
});

test('m19: an anonymous builder load logs no console error for GET /api/me', async () => {
  await withApp(async (page, base) => {
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    // Force the same check the app makes on load, directly, to be sure at
    // least one /api/me call actually happened in this run.
    const result = await page.evaluate(async () => {
      const r = await fetch('/api/me', { credentials: 'include' });
      return { status: r.status, body: await r.json() };
    });
    await page.waitForTimeout(200);

    assert.strictEqual(result.status, 200, 'an anonymous GET /api/me must return 200, not 401');
    assert.strictEqual(result.body.user, null, 'an anonymous GET /api/me must report {user:null}');

    const resourceErrors = consoleErrors.filter((t) => /Failed to load resource/i.test(t) || /401/.test(t));
    assert.deepStrictEqual(resourceErrors, [], 'no console error should be logged for an anonymous /api/me check:\n' + resourceErrors.join('\n'));
  });
});

test('m19 contract check: an invalid session cookie still gets a real 401 (unchanged)', async () => {
  await withApp(async (page, base) => {
    const res = await fetch(base + '/api/me', { headers: { Cookie: 'hb_session=v1.garbage.garbage' } });
    assert.strictEqual(res.status, 401, 'a present-but-invalid session cookie must still be rejected with 401');
  });
});
