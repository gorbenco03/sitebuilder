'use strict';
/**
 * bot/test/wave5-builder-auth-error.test.js
 *
 * Oracle for Wave 5 auth error message (audit medium #6,
 * 04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md: "Eroare de autentificare
 * generică ascunde mesajul specific trimis de server" — a generic auth error
 * hides the specific message the server sent).
 *
 * bot/server.js's handleAuthEmail() sends specific, already-Romanian reasons
 * for a bad request — e.g. 400 "Introdu o adresă de email validă." for a
 * malformed email, or a rate-limit reason from bot/ratelimit.js. apiPost()
 * (builder/app.js) already surfaces that as err.message (from json.error).
 * wireAuthForm()'s catch block used to throw that away and always show the
 * fixed string "Nu am putut trimite linkul. Încearcă din nou." — this oracle
 * submits a malformed email (a deterministic, timing-independent way to
 * trigger a real 400 from the server, unlike the rate-limit path) and asserts
 * the SPECIFIC server message reaches #auth-error, not the generic fallback.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-builder-auth-error.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

const GENERIC_FALLBACK = 'Nu am putut trimite linkul. Încearcă din nou.';
const SPECIFIC_SERVER_MESSAGE = 'Introdu o adresă de email validă.';

test('a malformed-email auth failure shows the specific server message, not the generic fallback', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-autherr-'));
  process.env.SERVER_SECRET = 'wave5-autherr-oracle-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);

  try {
    // Confirm the server really does send that specific reason for this
    // input, independent of the browser UI — otherwise the UI assertion
    // below would be meaningless.
    const apiRes = await page.request.post(base + '/api/auth/email', {
      data: { email: 'not-an-email' },
      failOnStatusCode: false,
    });
    assert.equal(apiRes.status(), 400, 'server must reject a malformed email with 400');
    const apiBody = await apiRes.json();
    assert.equal(apiBody.error, SPECIFIC_SERVER_MESSAGE, 'server error copy must be the exact specific reason this oracle checks for');

    // ---- Now drive the real UI through the same failure ----
    await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
    await page.locator('#btn-dashboard-auth').waitFor({ state: 'visible' });
    await page.locator('#btn-dashboard-auth').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });

    await page.locator('#input-email').fill('not-an-email');
    await page.locator('#btn-send-magic').click();

    const errorDiv = page.locator('#auth-error');
    await errorDiv.waitFor({ state: 'visible' });
    const shown = (await errorDiv.innerText()).trim();

    assert.equal(shown, SPECIFIC_SERVER_MESSAGE, 'the UI must show the server\'s specific reason');
    assert.notEqual(shown, GENERIC_FALLBACK, 'the UI must not mask the specific reason with the generic fallback');

    console.log('PASS wave5-builder-auth-error: specific server message ("' + shown + '") reaches the UI');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
