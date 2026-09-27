'use strict';
/**
 * bot/test/audit27-r-05-cookie-i18n.test.js
 *
 * Oracle for PLAN-AUDIT-2026-09-27.md task R-05
 * (04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json):
 *
 *   a11y#1        On a fresh /app/ visit, Tab must not be trapped inside
 *                 #hb-cookie-banner — root cause was role="dialog" on a
 *                 non-modal banner (empirically confirmed: removing only
 *                 that attribute restores normal document-order Tab). Esc
 *                 and Accept must both hide the banner and move focus off
 *                 the now-hidden node instead of stranding it.
 *   copy-i18n#3   Customer-reachable server error strings ("Site not
 *                 found.", "Access denied.", validation messages) must be
 *                 Romanian, not English.
 *   export#2      GET /api/export-zip with no draft ever saved answers in
 *                 Romanian, not "No draft to download...".
 *   publish-live#3 A malformed /live/<slug>/ answers with the branded
 *                 Romanian 404 page for a browser, not raw English JSON.
 *
 * Each assertion below is false against the pre-fix source (builder/index.html
 * with role="dialog" + no focus management; bot/server.js's English strings
 * and serveLive()'s raw sendJson 403/400s) and true against this task's fix.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-05-cookie-i18n.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

async function boot(tag) {
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = 'test';
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r05-' + tag + '-'));
    process.env.SERVER_SECRET = 'audit27-r05-' + tag + '-secret';
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];
    delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
    const { startServer } = require(path.join(ROOT, 'bot/server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    return { server, base: 'http://127.0.0.1:' + server.address().port };
}

test('a11y#1: first-visit Tab is never trapped in the cookie banner, and Esc/Accept return focus sensibly', async () => {
    const { server, base } = await boot('a11y1');
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(400);

        // Fresh visit, no consent stored: the very first Tab must not land
        // inside the banner, and none of the next several presses may either.
        for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab');
            const info = await page.evaluate(() => {
                const el = document.activeElement;
                const banner = document.getElementById('hb-cookie-banner');
                return { inBanner: !!(el && banner && banner.contains(el)), id: el && el.id };
            });
            assert.ok(
                !info.inBanner,
                `Tab press #${i + 1} landed inside #hb-cookie-banner (on ${info.id || '(no id)'}) — keyboard trap`
            );
        }

        // The banner must not itself claim a modal role (root cause of the trap).
        const role = await page.evaluate(() => document.getElementById('hb-cookie-banner').getAttribute('role'));
        assert.notStrictEqual(role, 'dialog', '#hb-cookie-banner must not be role="dialog" (non-modal, dismissible banner)');

        // Escape: hides the banner, does not persist consent, and does not stick
        // focus on the now-hidden node.
        await page.evaluate(() => document.getElementById('hb-cookie-accept').focus());
        await page.keyboard.press('Escape');
        const afterEsc = await page.evaluate(() => ({
            hidden: document.getElementById('hb-cookie-banner').hidden,
            activeInBanner: document.getElementById('hb-cookie-banner').contains(document.activeElement),
            consent: (() => { try { return localStorage.getItem('hb-cookie-consent'); } catch { return null; } })(),
        }));
        assert.strictEqual(afterEsc.hidden, true, 'Escape must hide the banner');
        assert.strictEqual(afterEsc.activeInBanner, false, 'focus must not remain on a hidden banner after Escape');
        assert.strictEqual(afterEsc.consent, null, 'Escape must not itself record consent');

        // Accept: hides the banner, persists consent, and also moves focus off it.
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(400);
        await page.locator('#hb-cookie-accept').click();
        const afterAccept = await page.evaluate(() => ({
            hidden: document.getElementById('hb-cookie-banner').hidden,
            activeInBanner: document.getElementById('hb-cookie-banner').contains(document.activeElement),
            consent: (() => { try { return localStorage.getItem('hb-cookie-consent'); } catch { return null; } })(),
        }));
        assert.strictEqual(afterAccept.hidden, true, 'Accept must hide the banner');
        assert.strictEqual(afterAccept.activeInBanner, false, 'focus must not remain on a hidden banner after Accept');
        assert.strictEqual(afterAccept.consent, 'accepted', 'Accept must persist consent');
    } finally {
        await browser.close();
        server.close();
    }
});

test('publish-live#3: a malformed /live/<slug>/ shows the Romanian branded 404, not raw English JSON', async () => {
    const { server, base } = await boot('publishlive3');
    try {
        // Too-short slug — fails serveLive's own validation before any registry lookup.
        const asBrowser = await fetch(base + '/live/ab/', {
            headers: { Accept: 'text/html,application/xhtml+xml' },
            redirect: 'manual',
        });
        const html = await asBrowser.text();
        assert.strictEqual(asBrowser.status, 404, 'a malformed slug must be a 404, not a raw 403 JSON error');
        assert.ok(asBrowser.headers.get('content-type').includes('text/html'), 'a browser visitor must get an HTML page, not JSON');
        assert.ok(!/\{"error"/.test(html), 'must not be raw JSON in a browser response');
        assert.ok(/negăsit|Pagină negăsită/i.test(html), 'must show the branded Romanian 404 copy');
        assert.ok(!/Access denied/i.test(html), 'must not leak the old English error text to a browser visitor');

        // API-style client still gets JSON, but in Romanian.
        const asApi = await fetch(base + '/live/ab/', { headers: { Accept: 'application/json' } });
        const body = await asApi.json();
        assert.strictEqual(asApi.status, 404);
        assert.ok(!/[a-z]/i.test(body.error) || /[ăâîșț]/i.test(body.error) || /Acces refuzat/.test(body.error),
            'API JSON error text must be Romanian, got: ' + body.error);
        assert.notStrictEqual(body.error, 'Access denied.', 'must not be the old English string');
    } finally {
        server.close();
    }
});

test('copy-i18n#3 / export#2: customer-reachable server errors are Romanian', async () => {
    const { server, base } = await boot('copyi18n3');
    try {
        // A signed-in user who never saved any draft: GET /api/export-zip.
        const email = 'audit27-r05-' + Math.random().toString(36).slice(2) + '@example.com';
        const loginRes = await fetch(base + '/api/auth/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const loginBody = await loginRes.json();
        const devLink = /^https?:\/\//.test(loginBody.devLink) ? loginBody.devLink : (base + loginBody.devLink);
        const token = new URL(devLink).searchParams.get('token');
        const verifyRes = await fetch(base + '/auth/verify?token=' + encodeURIComponent(token), { redirect: 'manual' });
        const cookie = (verifyRes.headers.get('set-cookie') || '').split(';')[0];
        assert.ok(cookie.startsWith('hb_session='), 'must have signed in');

        const exportRes = await fetch(base + '/api/export-zip', { headers: { Cookie: cookie } });
        const exportBody = await exportRes.json();
        assert.strictEqual(exportRes.status, 400);
        assert.strictEqual(exportBody.error, 'Nicio ciornă de descărcat. Salvează sau publică o ciornă mai întâi.',
            'export#2: the no-draft message must be Romanian, got: ' + exportBody.error);

        // Nonexistent site: GET /api/sites/:id-shaped route → "Site negăsit."
        const rollbackRes = await fetch(base + '/api/sites/does-not-exist-xyz/rollback', {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ versionId: 'v1' }),
        });
        const rollbackBody = await rollbackRes.json();
        assert.strictEqual(rollbackRes.status, 404);
        assert.strictEqual(rollbackBody.error, 'Site negăsit.', 'copy-i18n#3: got: ' + rollbackBody.error);
        assert.notStrictEqual(rollbackBody.error, 'Site not found.', 'must not be the old English string');
    } finally {
        server.close();
    }
});
