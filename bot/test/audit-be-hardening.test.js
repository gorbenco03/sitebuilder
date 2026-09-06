'use strict';
/**
 * bot/test/audit-be-hardening.test.js — oracle for the 2026-09-06 audit's
 * be-hardening findings (04-QA-Evidence/Audit-2026-09-06-2225ca7/backend-api-security/,
 * .../performance/):
 *
 *   BE-01   POST /api/auth/email had zero rate-limiting (flood → 50x200, 0x429).
 *   BE-02   No response ever set a security header beyond X-Content-Type-Options
 *           on the two export routes (no CSP/X-Frame-Options/Referrer-Policy/
 *           Permissions-Policy anywhere).
 *   BE-04   No reserved-slug blocklist — admin/api/app/www etc. were `available`,
 *           and in production (Cloudflare) a slug becomes a literal subdomain.
 *   PERF-03 The server never compressed any response (no gzip/brotli anywhere).
 *
 * This file must FAIL on the pre-fix bot/server.js + bot/ratelimit.js and PASS
 * after the fix (verified manually by diffing against the pre-fix files — see
 * the audit's fix report for the before/after evidence).
 *
 * Isolated server, no real deploy/payment/registry stubbing needed: registry.js/
 * auth.js/email.js all behave safely under DATA_DIR + HIDOOK_TEST_PAY=1 without
 * external network calls (email.js falls back to devLink when RESEND_API_KEY is
 * unset; registry.js is a plain DATA_DIR-backed JSON store).
 *
 * Run:  node bot/test/audit-be-hardening.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-be-hardening-'));
process.env.DATA_DIR             = tmpDir;
process.env.HIDOOK_TEST_PAY      = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV             = 'test';
process.env.SERVER_SECRET        = 'test-secret-' + crypto.randomBytes(8).toString('hex');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.RESEND_API_KEY;

const { startServer } = require('../server.js');
const { onStripeEvent } = require('../web.js');

let failed = false;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

async function main() {
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    // ── BE-01: POST /api/auth/email must throttle ──────────────────────────
    await check('BE-01: same email hammered 6x → 6th is 429 with Retry-After + RO message', async () => {
        const email = 'flood-target@example.com';
        let last;
        for (let i = 0; i < 6; i++) {
            last = await fetch(`${base}/api/auth/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            if (i < 5) assert.strictEqual(last.status, 200, `request ${i + 1} should succeed (got ${last.status})`);
        }
        assert.strictEqual(last.status, 429, `6th request for the same email should be 429 (got ${last.status})`);
        assert.ok(last.headers.get('retry-after'), 'a 429 must carry Retry-After so the client knows when to retry');
        const body = await last.json();
        assert.ok(typeof body.error === 'string' && /ă|â|î|ț|ș|prea multe/i.test(body.error),
            `429 error message must be a human Romanian explanation, got: ${JSON.stringify(body)}`);
    });

    await check('BE-01: 50 distinct-email requests (audit repro) → at least one 429, not 50x200', async () => {
        const codes = [];
        for (let i = 0; i < 50; i++) {
            const r = await fetch(`${base}/api/auth/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: `flood-${i}@example.com` }),
            });
            codes.push(r.status);
        }
        const count429 = codes.filter((c) => c === 429).length;
        assert.ok(count429 > 0, `expected at least one 429 among 50 requests, got codes: ${codes.join(',')}`);
    });

    // ── BE-02: security headers on every response ──────────────────────────
    await check('BE-02: GET /app/ carries CSP + X-Frame-Options: DENY + baseline headers', async () => {
        const r = await fetch(`${base}/app/`);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
        assert.strictEqual(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.ok(r.headers.get('permissions-policy'), 'Permissions-Policy must be set');
        const csp = r.headers.get('content-security-policy');
        assert.ok(csp, 'Content-Security-Policy must be set on /app/');
        assert.ok(/frame-ancestors\s+'none'/.test(csp), `/app/ CSP must deny framing, got: ${csp}`);
        assert.strictEqual(r.headers.get('x-frame-options'), 'DENY', '/app/ must set X-Frame-Options: DENY (clickjacking)');
    });

    await check('BE-02: GET /live/<unknown>/ (customer-site namespace) still carries baseline headers', async () => {
        const r = await fetch(`${base}/live/does-not-exist-xyz/`);
        assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
        assert.ok(r.headers.get('content-security-policy'), 'Content-Security-Policy must be set on /live/*');
        assert.ok(r.headers.get('x-frame-options'), 'X-Frame-Options must be set on /live/*');
    });

    await check('BE-02: plain HTTP test server must NOT claim Strict-Transport-Security', async () => {
        const r = await fetch(`${base}/health`);
        assert.strictEqual(r.headers.get('strict-transport-security'), null,
            'HSTS must only be sent when the request actually arrived over HTTPS');
    });

    // ── BE-04: reserved slugs ────────────────────────────────────────────────
    await check('BE-04: reserved platform words are never available as a slug', async () => {
        for (const slug of ['admin', 'api', 'app', 'www']) {
            const r = await fetch(`${base}/api/slug-check?slug=${slug}`);
            const body = await r.json();
            assert.strictEqual(body.available, false, `slug "${slug}" must not be available, got: ${JSON.stringify(body)}`);
            assert.ok(/rezervat/i.test(body.error || ''), `slug "${slug}" rejection must explain it's reserved, got: ${JSON.stringify(body)}`);
        }
    });

    await check('BE-04: a normal business slug stays available', async () => {
        const r = await fetch(`${base}/api/slug-check?slug=cofetaria-buna-din-cartier`);
        const body = await r.json();
        assert.strictEqual(body.available, true, `expected a normal slug to stay available, got: ${JSON.stringify(body)}`);
    });

    // ── PERF-03: compression ────────────────────────────────────────────────
    await check('PERF-03: GET /app/app.js compresses with gzip when the client supports it', async () => {
        const compressed = await fetch(`${base}/app/app.js`); // fetch sends Accept-Encoding: gzip by default
        assert.strictEqual(compressed.status, 200);
        assert.strictEqual(compressed.headers.get('content-encoding'), 'gzip', 'expected Content-Encoding: gzip');
        const compressedLen = Number(compressed.headers.get('content-length'));
        const decodedBody = await compressed.text();

        const uncompressed = await fetch(`${base}/app/app.js`, { headers: { 'Accept-Encoding': 'identity' } });
        assert.strictEqual(uncompressed.headers.get('content-encoding'), null, 'identity request must not be compressed');
        const uncompressedLen = Number(uncompressed.headers.get('content-length'));
        const plainBody = await uncompressed.text();

        assert.strictEqual(decodedBody, plainBody, 'decoded gzip body must match the plain body byte-for-byte');
        assert.ok(compressedLen < uncompressedLen * 0.8,
            `expected meaningful compression, got ${compressedLen} vs ${uncompressedLen} bytes`);
    });

    await check('PERF-03: JSON API responses compress too (/api/templates)', async () => {
        const r = await fetch(`${base}/api/templates`);
        assert.strictEqual(r.headers.get('content-encoding'), 'gzip', 'expected /api/templates to compress with gzip');
        const body = await r.json();
        assert.ok(Array.isArray(body.templates) && body.templates.length > 0, 'templates payload must still decode correctly');
    });

    server.close();
    console.log(failed ? '\nSome checks FAILED.' : '\nAll checks PASSED.');
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
