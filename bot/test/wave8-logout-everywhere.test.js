'use strict';
/**
 * Wave 8 (AUDIT-07 re-audit): "log out everywhere".
 *
 * Rationale (see the task brief): this product's account-recovery flow is an
 * emailed magic link. Someone who suspects their email was read needs a way
 * to end every session at once, not just the one browser in front of them —
 * an attacker who lifted a session cookie from a compromised inbox keeps
 * access until natural (30-day) expiry unless there is a way to revoke
 * every outstanding session for that user in one action.
 *
 * This oracle simulates two devices logged in as the same user (two signed
 * sessions), calls POST /api/auth/logout-everywhere from one of them, and
 * proves BOTH old cookies are refused afterwards — while a fresh sign-in for
 * the same user still works.
 *
 * Run: node --experimental-sqlite bot/test/wave8-logout-everywhere.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-logout-all-'));
process.env.DATA_DIR              = tmpDir;
process.env.SERVER_SECRET         = 'wave8-logout-all-secret-' + crypto.randomBytes(8).toString('hex');
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

(async () => {
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const { port } = srv.address();
    const base = `http://127.0.0.1:${port}`;

    const user   = registry.getOrCreateUserByEmail('wave8-logout-all@test.com');
    const other  = registry.getOrCreateUserByEmail('wave8-logout-all-bystander@test.com');

    const phoneCookie  = auth.signSession(user.id);   // "device A"
    const laptopCookie = auth.signSession(user.id);   // "device B"
    const bystanderCookie = auth.signSession(other.id); // unrelated user, must be untouched

    await check('both device sessions authenticate before logout-everywhere', async () => {
        const [a, b] = await Promise.all([
            fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${phoneCookie}` } }),
            fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${laptopCookie}` } }),
        ]);
        assert.strictEqual(a.status, 200);
        assert.strictEqual(b.status, 200);
    });

    await check('unauthenticated logout-everywhere is rejected (401)', async () => {
        const res = await fetch(`${base}/api/auth/logout-everywhere`, { method: 'POST' });
        assert.strictEqual(res.status, 401);
    });

    let revokedCount;
    await check('POST /api/auth/logout-everywhere from device A succeeds', async () => {
        const res = await fetch(`${base}/api/auth/logout-everywhere`, {
            method: 'POST',
            headers: { Cookie: `hb_session=${phoneCookie}` },
        });
        const body = JSON.parse(await res.text());
        assert.strictEqual(res.status, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(typeof body.revoked === 'number' && body.revoked >= 2, `expected ≥2 sessions revoked, got ${body.revoked}`);
        revokedCount = body.revoked;
    });

    await check('device A (the caller) is now rejected too', async () => {
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${phoneCookie}` } });
        assert.strictEqual(res.status, 401);
    });

    await check('device B (never called logout) is ALSO rejected', async () => {
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${laptopCookie}` } });
        assert.strictEqual(res.status, 401, 'logout-everywhere must end every session for the user, not just the caller');
    });

    await check('an unrelated user\'s session is untouched', async () => {
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${bystanderCookie}` } });
        assert.strictEqual(res.status, 200, 'logout-everywhere must be scoped to one user_id, not global');
    });

    await check('a brand-new sign-in for the affected user works again after logout-everywhere', async () => {
        const fresh = auth.signSession(user.id);
        const res = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${fresh}` } });
        assert.strictEqual(res.status, 200, await res.text());
    });

    await check('calling logout-everywhere again only revokes sessions issued since the last call', async () => {
        // Revoke whatever is currently live for this user first, so the count
        // below is deterministic regardless of sessions earlier checks left live.
        const sweep = auth.signSession(user.id);
        await fetch(`${base}/api/auth/logout-everywhere`, { method: 'POST', headers: { Cookie: `hb_session=${sweep}` } });

        const fresh = auth.signSession(user.id);
        const res = await fetch(`${base}/api/auth/logout-everywhere`, {
            method: 'POST',
            headers: { Cookie: `hb_session=${fresh}` },
        });
        const body = JSON.parse(await res.text());
        assert.strictEqual(res.status, 200);
        // Only the just-issued session is live at this point — 1, not the earlier multi-device count.
        assert.strictEqual(body.revoked, 1);
        assert.notStrictEqual(body.revoked, revokedCount);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    if (failed) {
        console.error(`\nwave8-logout-everywhere.test.js: ${failed} FAILED`);
        process.exit(1);
    }
    console.log('\nwave8-logout-everywhere.test.js: toate testele au trecut');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
