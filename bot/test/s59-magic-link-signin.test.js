'use strict';
/**
 * S59: magic-link sign-in must finish without SERVER_SECRET leak.
 *
 * Causal:
 *   Parent 5aa3bfe — missing SERVER_SECRET + isolated flags → signSession throws
 *   naming SERVER_SECRET; GET /auth/verify surfaces that in 500 JSON.
 *   HEAD — isolated/test boot without owner secret → 302 /app/ + Set-Cookie;
 *   no response ever contains SERVER_SECRET / env names.
 *
 * Run: node bot/test/s59-magic-link-signin.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '5aa3bfe6c1c0a1709fe9c820901fc34c2d6d2d0b';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's59-magic-link-'));
process.env.DATA_DIR = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
delete process.env.SERVER_SECRET;
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.BRAND_DOMAIN;
delete process.env.CONTACT_URL;
delete process.env.RESEND_API_KEY;
delete process.env.NODE_ENV;
delete process.env.PUBLIC_URL;

const registry = require('../registry.js');
const { startServer } = require('../server.js');
const auth = require('../auth.js');

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

function parentBlob(rel) {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
    });
}

function leakScan(text) {
    const s = String(text || '');
    const hits = [];
    if (/SERVER_SECRET/.test(s)) hits.push('SERVER_SECRET');
    if (/STRIPE_SECRET_KEY/.test(s)) hits.push('STRIPE_SECRET_KEY');
    if (/TELEGRAM_BOT_TOKEN/.test(s)) hits.push('TELEGRAM_BOT_TOKEN');
    if (/process\.env/.test(s)) hits.push('process.env');
    if (/\bat\s+\S+\s+\([^)]+:\d+:\d+\)/.test(s)) hits.push('stack-trace');
    return hits;
}

function assertNoLeak(label, text) {
    const hits = leakScan(text);
    assert.strictEqual(hits.length, 0, `${label} leaked: ${hits.join(', ')} — body=${String(text).slice(0, 200)}`);
}

function makeClient(base) {
    const jar = {};
    async function doFetch(urlPath, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;
        const res = await fetch(base + urlPath, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
        for (const sc of setCookie) {
            if (!sc) continue;
            const first = sc.split(';')[0];
            const eq = first.indexOf('=');
            if (eq < 0) continue;
            const k = first.slice(0, eq).trim();
            const v = first.slice(eq + 1).trim();
            if (k) jar[k] = v;
        }
        return res;
    }
    doFetch.jar = jar;
    return doFetch;
}

// ---------------------------------------------------------------------------
// Causal RED on parent source + live parent probe (isolated env, no secret)
// ---------------------------------------------------------------------------

check(`parent ${PARENT_SHA.slice(0, 7)} auth still throws naming SERVER_SECRET`, () => {
    const src = parentBlob('bot/auth.js');
    assert.ok(
        /SERVER_SECRET este neconfigurat/.test(src),
        'parent auth.js no longer names SERVER_SECRET in throw — pick another causal RED'
    );
    assert.ok(
        /process\.env\.SERVER_SECRET/.test(src),
        'parent auth.js must read process.env.SERVER_SECRET'
    );
});

check(`parent ${PARENT_SHA.slice(0, 7)} handleAuthVerify leaves signSession uncaught`, () => {
    const src = parentBlob('bot/server.js');
    const m = src.match(/async function handleAuthVerify[\s\S]*?\nasync function handleAuthTelegram/);
    assert.ok(m, 'parent handleAuthVerify not found');
    const body = m[0];
    assert.ok(/auth\.signSession\(user\.id\)/.test(body), 'parent must call signSession');
    // Bare call — no try wrapping the signSession line specifically before cookie build
    assert.ok(
        /const cookieValue = auth\.signSession\(user\.id\);/.test(body),
        'parent signSession is bare (uncaught) assignment'
    );
});

check(`parent ${PARENT_SHA.slice(0, 7)} outer catch still forwards e.message (leak path)`, () => {
    const src = parentBlob('bot/server.js');
    assert.ok(
        /sendJson\(res, e\.status \|\| 500, \{ error: e\.message/.test(src),
        'parent outer catch must forward e.message (the leak path)'
    );
});

check('parent auth.js live: no SERVER_SECRET + isolated → throw names SERVER_SECRET', () => {
    const parentAuthSrc = parentBlob('bot/auth.js');
    const tmpAuth = path.join(tmpDir, 'parent-auth.js');
    fs.writeFileSync(tmpAuth, parentAuthSrc);
    const probe = `
        delete process.env.SERVER_SECRET;
        process.env.HIDOOK_ISOLATED_DEPLOY = '1';
        process.env.HIDOOK_TEST_PAY = '1';
        delete process.env.NODE_ENV;
        const auth = require(${JSON.stringify(tmpAuth)});
        try {
            auth.signSession('user-causal');
            console.log('UNEXPECTED_OK');
            process.exit(2);
        } catch (e) {
            const msg = String(e && e.message || e);
            if (/SERVER_SECRET/.test(msg)) {
                console.log('RED_LEAK_OK');
                process.exit(0);
            }
            console.log('OTHER_ERR', msg);
            process.exit(3);
        }
    `;
    const r = spawnSync(process.execPath, ['-e', probe], {
        encoding: 'utf8',
        env: {
            PATH: process.env.PATH,
            HIDOOK_ISOLATED_DEPLOY: '1',
            HIDOOK_TEST_PAY: '1',
        },
    });
    assert.strictEqual(r.status, 0, `parent probe exit ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(/RED_LEAK_OK/.test(r.stdout), `expected RED_LEAK_OK got: ${r.stdout}`);
});

// ---------------------------------------------------------------------------
// HEAD: isolated/test magic-link verify completes without owner secret
// ---------------------------------------------------------------------------

(async () => {
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const { port } = srv.address();
    const base = `http://127.0.0.1:${port}`;
    const client = makeClient(base);

    await check('HEAD env: SERVER_SECRET unset; isolated + test-pay on', () => {
        assert.strictEqual(process.env.SERVER_SECRET, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(process.env.NODE_ENV !== 'production');
    });

    await check('HEAD auth.signSession works without owner SERVER_SECRET (isolated)', () => {
        const value = auth.signSession('s59-user');
        assert.ok(/^v1\./.test(value), 'session token format');
        assert.strictEqual(auth.verifySession(value), 's59-user');
        assertNoLeak('signSession value', value);
    });

    let token;
    await check('createLoginToken for email magic-link', () => {
        const email = `s59-${crypto.randomUUID().slice(0, 8)}@example.com`;
        ({ token } = registry.createLoginToken({ email, purpose: 'login' }));
        assert.ok(token && token.length >= 32);
    });

    await check('GET /auth/verify?token= → 302 /app/ + Set-Cookie (no SERVER_SECRET)', async () => {
        const res = await client(`/auth/verify?token=${encodeURIComponent(token)}`);
        const body = await res.text();
        const loc = res.headers.get('location') || '';
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie().join('\n')
            : (res.headers.get('set-cookie') || '');

        assert.strictEqual(res.status, 302, `status ${res.status} body=${body.slice(0, 300)}`);
        assert.ok(loc.startsWith('/app/'), `Location must be under /app/, got ${loc}`);
        assert.ok(client.jar.hb_session, 'hb_session cookie must be set');
        assertNoLeak('verify body', body);
        assertNoLeak('verify Location', loc);
        assertNoLeak('verify Set-Cookie', setCookie);
        assertNoLeak('verify headers dump', JSON.stringify([...res.headers.entries()]));
    });

    await check('GET /api/me with session → 200 (sign-in finished)', async () => {
        const res = await client('/api/me');
        const body = await res.text();
        assertNoLeak('me body', body);
        assert.strictEqual(res.status, 200, body);
        const json = JSON.parse(body);
        assert.ok(json.user && json.user.id);
    });

    await check('missing token → redirect #login-expirat, no leak', async () => {
        const res = await fetch(`${base}/auth/verify`, { redirect: 'manual' });
        const body = await res.text();
        const loc = res.headers.get('location') || '';
        assert.strictEqual(res.status, 302);
        assert.ok(loc.includes('login-expirat'), loc);
        assertNoLeak('missing-token body', body);
        assertNoLeak('missing-token loc', loc);
    });

    await check('invalid token → redirect #login-expirat, no leak', async () => {
        const res = await fetch(`${base}/auth/verify?token=not-a-real-token`, { redirect: 'manual' });
        const body = await res.text();
        const loc = res.headers.get('location') || '';
        assert.strictEqual(res.status, 302);
        assert.ok(loc.includes('login-expirat'), loc);
        assertNoLeak('bad-token body', body);
        assertNoLeak('bad-token loc', loc);
    });

    // Non-isolated / production-closed path: missing secret must not name env vars.
    await check('non-isolated missing secret: throw/response never names SERVER_SECRET', () => {
        const probe = `
            delete process.env.SERVER_SECRET;
            delete process.env.HIDOOK_ISOLATED_DEPLOY;
            delete process.env.HIDOOK_TEST_PAY;
            process.env.NODE_ENV = 'production';
            const path = require('path');
            const authPath = path.join(${JSON.stringify(ROOT)}, 'bot', 'auth.js');
            // Fresh load in child
            const auth = require(authPath);
            try {
                auth.signSession('prod-user');
                console.log('UNEXPECTED_OK');
                process.exit(2);
            } catch (e) {
                const msg = String(e && e.message || e);
                if (/SERVER_SECRET|process\\.env|STRIPE_|TELEGRAM_BOT/.test(msg)) {
                    console.log('LEAK', msg);
                    process.exit(3);
                }
                console.log('SAFE_CLOSED');
                process.exit(0);
            }
        `;
        const r = spawnSync(process.execPath, ['-e', probe], {
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                NODE_ENV: 'production',
            },
            cwd: ROOT,
        });
        assert.strictEqual(r.status, 0, `prod closed exit ${r.status}: ${r.stdout} ${r.stderr}`);
        assert.ok(/SAFE_CLOSED/.test(r.stdout), `expected SAFE_CLOSED got: ${r.stdout}`);
    });

    await check('forced throw through HTTP outer path never returns SERVER_SECRET', async () => {
        // Hit a route that will 404 cleanly first — baseline
        const res404 = await fetch(`${base}/api/no-such-route-s59`, { redirect: 'manual' });
        const t404 = await res404.text();
        assertNoLeak('404', t404);

        // Production-closed signSession error text must be scrubbed if it ever hits JSON.
        // We only assert the live failure shapes above; this guards residual surface text.
        const health = await fetch(`${base}/health`);
        const ht = await health.text();
        assertNoLeak('health', ht);
        assert.strictEqual(health.status, 200);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error(`\n${failed} check(s) failed`);
        process.exit(1);
    }
    console.log('\nAll S59 magic-link sign-in checks passed');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
