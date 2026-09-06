'use strict';
/**
 * bot/test/wave10-security-ratelimit-spoof.test.js — Wave 10 security, H1
 * (2026-09-06 re-audit, backend-security/FINDINGS.md).
 *
 * H1: getClientIp() in bot/server.js used to trust X-Forwarded-For
 * unconditionally, with no trusted-proxy allowlist. The re-audit's
 * live-probe.mjs fired 30 requests at POST /api/auth/email, each with a
 * distinct target email AND a distinct spoofed X-Forwarded-For value, and
 * got zero blocked (ipLimitHit: false) — every per-IP rate limit in the
 * app (auth email, bookings, domain polling) was decoration against
 * anyone who sets a header.
 *
 * Fix (see getClientIp's docblock in bot/server.js): by default
 * (TRUST_PROXY unset) the app now ignores every forwarded header and uses
 * only the raw socket peer — closing the bypass outright, since no
 * attacker-controlled header is ever read. TRUST_PROXY=cloudflare opts
 * into trusting CF-Connecting-IP (which Cloudflare's edge sets itself,
 * overwriting whatever the client sent) for deployments that actually sit
 * behind Cloudflare — X-Forwarded-For is still never trusted, even in that
 * mode.
 *
 * This oracle:
 *   1. Reproduces the re-audit's exact attack shape (30 requests, 30
 *      distinct spoofed X-Forwarded-For values, 30 distinct target emails)
 *      against the CURRENT code and asserts the per-IP bucket still
 *      engages (at least one 429) — the spoofing must not buy a fresh
 *      bucket per request.
 *   2. Proves this is a real behavior change, not a tautology, by running
 *      the OLD vulnerable algorithm (reconstructed verbatim from the
 *      pre-fix getClientIp — trust XFF unconditionally) over the same
 *      synthetic request list and showing it WOULD have produced 30
 *      distinct IP keys (i.e. would have been fully bypassed).
 *   3. Confirms TRUST_PROXY=cloudflare mode: distinct CF-Connecting-IP
 *      values get separate per-visitor buckets (legitimate multi-visitor
 *      traffic through a real Cloudflare front still works), while
 *      spoofing X-Forwarded-For alongside a FIXED CF-Connecting-IP still
 *      buys nothing.
 *
 * Run: node --experimental-sqlite bot/test/wave10-security-ratelimit-spoof.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

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

function httpJson(port, method, urlPath, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const reqHeaders = Object.assign({}, headers);
        if (data) {
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(data);
        }
        const req = http.request(
            { hostname: '127.0.0.1', port, method, path: urlPath, headers: reqHeaders },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try { json = JSON.parse(raw); } catch (_) { /* not JSON, fine */ }
                    resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
                });
            }
        );
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

/**
 * Verbatim reconstruction of the PRE-FIX getClientIp (bot/server.js before
 * this wave): trusts the first X-Forwarded-For value unconditionally, no
 * trusted-proxy check at all. Used only to prove the attack shape actually
 * would have worked against the old code — never imported from the app.
 */
function oldVulnerableGetClientIp(headers, socketRemoteAddress) {
    const xff = headers && headers['x-forwarded-for'];
    if (xff) {
        const first = String(Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim();
        if (first) return first;
    }
    return socketRemoteAddress || 'unknown';
}

async function bootServer(extraEnv = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-ratelimit-spoof-'));
    process.env.DATA_DIR               = tmpDir;
    process.env.SERVER_SECRET          = 'wave10-rl-' + crypto.randomBytes(8).toString('hex');
    process.env.HIDOOK_TEST_PAY        = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV               = 'test';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.BRAND_DOMAIN;
    delete process.env.RESEND_API_KEY;
    delete process.env.TRUST_PROXY;
    for (const [k, v] of Object.entries(extraEnv)) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
    }
    // Fresh require so env changes (TRUST_PROXY) are read at module-eval
    // time consistently across sub-tests that boot more than one server.
    delete require.cache[require.resolve('../server.js')];
    const { startServer } = require('../server.js');
    const server = startServer({ port: 0 });
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    return { server, port, close: () => new Promise((r) => server.close(r)) };
}

(async () => {
    await check(
        'RED (reconstructed pre-fix algorithm): 30 spoofed X-Forwarded-For values would have produced 30 distinct IP keys',
        () => {
            const seen = new Set();
            for (let i = 0; i < 30; i++) {
                const fakeIp = `10.0.0.${i}`;
                const ip = oldVulnerableGetClientIp({ 'x-forwarded-for': fakeIp }, '127.0.0.1');
                seen.add(ip);
            }
            assert.strictEqual(seen.size, 30, 'the old algorithm must key every spoofed value separately (the bug)');
        }
    );

    {
        const { port, close } = await bootServer();
        try {
            await check(
                'GREEN (current code, TRUST_PROXY unset): 30 requests with 30 distinct target emails + 30 distinct spoofed X-Forwarded-For values still hit the per-IP limit',
                async () => {
                    const statuses = [];
                    for (let i = 0; i < 30; i++) {
                        const res = await httpJson(port, 'POST', '/api/auth/email', {
                            headers: { 'X-Forwarded-For': `10.0.0.${i}` },
                            body: { email: `spoof-${i}@example.test` },
                        });
                        statuses.push(res.status);
                    }
                    const count429 = statuses.filter((s) => s === 429).length;
                    assert.ok(
                        count429 > 0,
                        'spoofing X-Forwarded-For must NOT buy a fresh per-IP bucket per request; got statuses: ' + statuses.join(',')
                    );
                }
            );

            await check(
                'GREEN: the per-EMAIL limit still engages independently of any IP spoofing (regression guard)',
                async () => {
                    const fixedEmail = 'same-victim@example.test';
                    const statuses = [];
                    for (let i = 0; i < 8; i++) {
                        const res = await httpJson(port, 'POST', '/api/auth/email', {
                            headers: { 'X-Forwarded-For': `192.0.2.${i}` }, // different fake IP every time
                            body: { email: fixedEmail },
                        });
                        statuses.push(res.status);
                    }
                    assert.ok(statuses.includes(429), 'per-email limit must still fire even with a fresh spoofed IP each time: ' + statuses.join(','));
                }
            );
        } finally {
            await close();
        }
    }

    {
        const { port, close } = await bootServer({ TRUST_PROXY: 'cloudflare' });
        try {
            await check(
                'TRUST_PROXY=cloudflare: distinct CF-Connecting-IP values get separate per-visitor buckets (legit multi-visitor traffic still works)',
                async () => {
                    // Two different "real visitors" behind the same Cloudflare front,
                    // each also sending a garbage/spoofed X-Forwarded-For that must be
                    // ignored. Each should get its own bucket's worth of requests
                    // before hitting 429, proving they are not lumped into one.
                    let visitorAHadSuccess = false;
                    let visitorBHadSuccess = false;
                    for (let i = 0; i < 3; i++) {
                        const resA = await httpJson(port, 'POST', '/api/auth/email', {
                            headers: {
                                'CF-Connecting-IP': '203.0.113.10',
                                'X-Forwarded-For': `attacker-controlled-noise-${i}`,
                            },
                            body: { email: `cf-visitor-a-${i}@example.test` },
                        });
                        if (resA.status === 200) visitorAHadSuccess = true;

                        const resB = await httpJson(port, 'POST', '/api/auth/email', {
                            headers: {
                                'CF-Connecting-IP': '203.0.113.20',
                                'X-Forwarded-For': `attacker-controlled-noise-${i}`,
                            },
                            body: { email: `cf-visitor-b-${i}@example.test` },
                        });
                        if (resB.status === 200) visitorBHadSuccess = true;
                    }
                    assert.ok(visitorAHadSuccess, 'visitor A (CF-Connecting-IP 203.0.113.10) must be able to send at all');
                    assert.ok(visitorBHadSuccess, 'visitor B (CF-Connecting-IP 203.0.113.20) must be able to send at all — not blocked by A\'s usage');
                }
            );

            await check(
                'TRUST_PROXY=cloudflare: spoofing X-Forwarded-For alone (fixed CF-Connecting-IP) still hits the per-IP limit',
                async () => {
                    const statuses = [];
                    for (let i = 0; i < 30; i++) {
                        const res = await httpJson(port, 'POST', '/api/auth/email', {
                            headers: {
                                'CF-Connecting-IP': '198.51.100.77', // fixed — the one real visitor IP Cloudflare reports
                                'X-Forwarded-For': `10.9.9.${i}`,     // spoofed noise, must be ignored
                            },
                            body: { email: `cf-spoof-${i}@example.test` },
                        });
                        statuses.push(res.status);
                    }
                    assert.ok(
                        statuses.some((s) => s === 429),
                        'a fixed CF-Connecting-IP must still hit its per-IP limit regardless of X-Forwarded-For noise: ' + statuses.join(',')
                    );
                }
            );
        } finally {
            await close();
        }
    }

    if (failed) {
        console.error('\nwave10-security-ratelimit-spoof.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave10-security-ratelimit-spoof.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
