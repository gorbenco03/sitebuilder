'use strict';
/**
 * bot/test/wave10-security-admin-token-query.test.js — Wave 10 security, L1
 * (2026-09-06 re-audit, backend-security/FINDINGS.md).
 *
 * L1: extractAdminToken() accepted HIDOOK_ADMIN_TOKEN as `?token=` in the
 * URL, and that value directly authenticated the response. A token that
 * rides in the URL lands in server/proxy access logs, browser history, and
 * any Referer header on an outbound link — every subsequent load of the
 * bookmarked/typed URL repeats the exposure.
 *
 * Fix: `?token=` is now a one-time bootstrap only
 * (bootstrapAdminCookieFromQuery in bot/server.js). A valid query token
 * gets traded for an HttpOnly `hb_admin_token` cookie via a 302 redirect to
 * the query-free `/admin` — no response after that first hop ever repeats
 * the token in a served URL. Direct content authentication now happens
 * only via `Authorization: Bearer` or that cookie.
 *
 * This oracle:
 *   1. RED-shaped assertion: the OLD behavior (token directly answers 200)
 *      no longer holds — GET /admin?token=<valid> must NOT return the site
 *      list directly.
 *   2. GREEN: that same request instead 302-redirects to the query-free
 *      path and sets the cookie, and following up with the cookie (no
 *      token in any URL from here on) succeeds.
 *   3. The redirect response body itself must not leak the site list
 *      (defense in depth — a redirect should carry no sensitive payload).
 *   4. Wrong/missing query token still 404s exactly as before (no new way
 *      to distinguish "route exists" from "token wrong").
 *   5. Bearer header keeps working unchanged (no regression for the
 *      non-browser / scripted access path).
 *
 * Run: node --experimental-sqlite bot/test/wave10-security-admin-token-query.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

const ADMIN_TOKEN = 'wave10-sec-admin-' + crypto.randomBytes(12).toString('hex');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-admin-token-query-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'wave10-sec-admin-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ADMIN_TOKEN     = ADMIN_TOKEN;
process.env.HIDOOK_TEST_PAY        = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV               = 'test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.RESEND_API_KEY;
delete process.env.TRUST_PROXY;

const { startServer } = require('../server.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

function httpGet(port, urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            { hostname: '127.0.0.1', port, path: urlPath, headers: Object.assign({ Accept: 'text/html' }, headers) },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf8'),
                }));
            }
        );
        req.on('error', reject);
    });
}

(async () => {
    const server = startServer({ port: 0 });
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;

    try {
        await check('RED: GET /admin?token=<valid> must NOT answer 200 with the site list directly any more', async () => {
            const res = await httpGet(port, '/admin?token=' + encodeURIComponent(ADMIN_TOKEN));
            assert.notStrictEqual(res.status, 200, 'a query token must no longer authenticate a response directly');
        });

        await check('GREEN: GET /admin?token=<valid> 302-redirects to the query-free path and sets an HttpOnly cookie', async () => {
            const res = await httpGet(port, '/admin?token=' + encodeURIComponent(ADMIN_TOKEN));
            assert.strictEqual(res.status, 302, 'expected a redirect, got ' + res.status);
            assert.strictEqual(res.headers['location'], '/admin', 'redirect target must be query-free');
            const setCookie = String(res.headers['set-cookie'] || '');
            assert.ok(/hb_admin_token=/.test(setCookie), 'must set the admin cookie: ' + setCookie);
            assert.ok(/HttpOnly/i.test(setCookie), 'cookie must be HttpOnly (not readable from page JS): ' + setCookie);
            assert.ok(/SameSite=Strict/i.test(setCookie), 'cookie must be SameSite=Strict: ' + setCookie);
            assert.ok(!setCookie.includes(ADMIN_TOKEN) === false, 'sanity: the cookie value IS the token (expected — it just isn\'t in a URL any more)');
        });

        await check('GREEN: the redirect response body itself carries no site list (defense in depth)', async () => {
            // Seed a distinctive site so we have something that WOULD leak if the
            // redirect response carried a body with content, not just headers.
            const registry = require('../registry.js');
            const user = registry.getOrCreateUserByEmail(`w10sec-${crypto.randomUUID()}@ex.com`);
            const site = registry.createSite({
                userId: user.id, templateId: 'product-menu', templateVersion: 1,
                slug: 'w10sec-redirect-leak-check', platform: 'web',
            });
            const res = await httpGet(port, '/admin?token=' + encodeURIComponent(ADMIN_TOKEN));
            assert.ok(!res.body.includes(site.slug), 'redirect body must not include any site slug: ' + res.body.slice(0, 300));
            assert.ok(res.body.length < 200, 'redirect body should be small/empty, got ' + res.body.length + ' bytes');
        });

        await check('GREEN: following up with the bootstrapped cookie (no token in the URL) reaches the dashboard', async () => {
            const bootstrap = await httpGet(port, '/admin?token=' + encodeURIComponent(ADMIN_TOKEN));
            const cookiePair = String(bootstrap.headers['set-cookie'] || '').split(';')[0];
            assert.ok(cookiePair.startsWith('hb_admin_token='), 'got a cookie to replay');

            const res = await httpGet(port, '/admin', { Cookie: cookiePair });
            assert.strictEqual(res.status, 200, 'cookie-authenticated /admin (no query string at all) must 200, got ' + res.status);
            assert.ok(/Hidook Site Builder/i.test(res.body), 'dashboard content present');
        });

        await check('unchanged: GET /admin?token=wrong still 404s (no new oracle to probe validity)', async () => {
            const res = await httpGet(port, '/admin?token=definitely-wrong');
            assert.strictEqual(res.status, 404);
            assert.ok(!/set-cookie/i.test(JSON.stringify(res.headers)), 'must not set a cookie for a wrong token');
        });

        await check('unchanged: GET /admin with no token/cookie/header still 404s', async () => {
            const res = await httpGet(port, '/admin');
            assert.strictEqual(res.status, 404);
        });

        await check('unchanged: Authorization: Bearer still authenticates directly (no cookie needed)', async () => {
            const res = await httpGet(port, '/admin', { Authorization: 'Bearer ' + ADMIN_TOKEN });
            assert.strictEqual(res.status, 200, 'Bearer header must keep working, got ' + res.status);
            assert.ok(/Hidook Site Builder/i.test(res.body));
        });

        await check('a bad cookie value alone (no header, no query) still 404s', async () => {
            const res = await httpGet(port, '/admin', { Cookie: 'hb_admin_token=not-the-real-token' });
            assert.strictEqual(res.status, 404);
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    if (failed) {
        console.error('\nwave10-security-admin-token-query.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave10-security-admin-token-query.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
