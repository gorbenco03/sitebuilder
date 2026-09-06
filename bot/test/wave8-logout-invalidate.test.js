'use strict';
/**
 * Wave 8 (AUDIT-07 re-audit): logout must invalidate the session server-side.
 *
 * Causal: the independent re-audit found POST /api/auth/logout did not exist
 * in bot/server.js at all, and replaying a pre-logout hb_session cookie
 * against /api/me still returned 200 — a stateless 30-day HMAC cookie has
 * nothing to revoke against unless the server keeps a record of it.
 *
 * This oracle: sign in, capture the raw session cookie, call logout, then
 * replay the CAPTURED (old) cookie value against every protected surface
 * that shares bot/auth.js#getSessionUserId — /api/me AND the calendar-native
 * owner dashboard API (item 5 of the brief: "does the calendar owner
 * dashboard's session behave the same way?").
 *
 * Run: node --experimental-sqlite bot/test/wave8-logout-invalidate.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-logout-'));
process.env.DATA_DIR              = tmpDir;
process.env.SERVER_SECRET         = 'wave8-logout-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY       = '1';
process.env.PUBLIC_URL            = 'http://127.0.0.1:0';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.NODE_ENV;

const registry = require('../registry.js');
const auth     = require('../auth.js');
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

function getSetCookies(res) {
    const sc = res.headers.getSetCookie
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    return sc.join('\n');
}

(async () => {
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const { port } = srv.address();
    const base = `http://127.0.0.1:${port}`;

    const user = registry.getOrCreateUserByEmail('wave8-logout@test.com');
    const sessionValue = auth.signSession(user.id);

    await check('captured cookie authenticates before logout', async () => {
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${sessionValue}` } });
        assert.strictEqual(res.status, 200, await res.text());
    });

    let logoutSetCookie;
    await check('POST /api/auth/logout returns 200 and clears the cookie', async () => {
        const res = await fetch(`${base}/api/auth/logout`, {
            method: 'POST',
            headers: { Cookie: `hb_session=${sessionValue}` },
        });
        const body = JSON.parse(await res.text());
        assert.strictEqual(res.status, 200);
        assert.strictEqual(body.ok, true);
        logoutSetCookie = getSetCookies(res);
        assert.ok(/hb_session=/.test(logoutSetCookie), 'Set-Cookie must mention hb_session');
        assert.ok(/Max-Age=0/i.test(logoutSetCookie), `logout must expire the cookie, got: ${logoutSetCookie}`);
    });

    // The whole point: replay the OLD (pre-logout) cookie value.
    await check('replay OLD cookie after logout → GET /api/me 401', async () => {
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${sessionValue}` } });
        const text = await res.text();
        assert.strictEqual(res.status, 401, `old cookie must be rejected after logout; got ${res.status} body=${text.slice(0, 200)}`);
    });

    await check('auth.verifySession rejects the revoked cookie directly', () => {
        assert.strictEqual(auth.verifySession(sessionValue), null);
    });

    await check('adjacent surface: calendar-native owner dashboard rejects the same revoked cookie', async () => {
        // Same bot/auth.js#getSessionUserId gate as /api/me (requireAuth in
        // bot/server.js) — proves the fix is not /api/me-specific.
        const res = await fetch(`${base}/api/calendar-native/owner/bookings`, {
            headers: { Cookie: `hb_session=${sessionValue}` },
        });
        assert.strictEqual(res.status, 401, `owner dashboard must reject a revoked session; got ${res.status}`);
    });

    await check('a brand-new session for the same user still authenticates (logout is scoped)', async () => {
        const fresh = auth.signSession(user.id);
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${fresh}` } });
        assert.strictEqual(res.status, 200, await res.text());
    });

    await check('logout with no cookie at all still returns 200 (idempotent, not an error)', async () => {
        const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
        assert.strictEqual(res.status, 200);
    });

    await check('logout with garbage cookie value still returns 200 and clears it', async () => {
        const res = await fetch(`${base}/api/auth/logout`, {
            method: 'POST',
            headers: { Cookie: 'hb_session=not-a-real-token' },
        });
        assert.strictEqual(res.status, 200);
        assert.ok(/Max-Age=0/i.test(getSetCookies(res)));
    });

    await check('replaying a garbage/tampered cookie was already rejected before logout too (sanity)', async () => {
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: 'hb_session=v1.garbage.garbage' } });
        assert.strictEqual(res.status, 401);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    if (failed) {
        console.error(`\nwave8-logout-invalidate.test.js: ${failed} FAILED`);
        process.exit(1);
    }
    console.log('\nwave8-logout-invalidate.test.js: toate testele au trecut');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
