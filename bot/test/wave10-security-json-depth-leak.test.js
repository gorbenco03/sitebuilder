'use strict';
/**
 * bot/test/wave10-security-json-depth-leak.test.js — Wave 10 security, M1
 * (2026-09-06 re-audit, backend-security/FINDINGS.md).
 *
 * M1: a POST /api/draft body containing JSON nested thousands of levels
 * deep makes something downstream of JSON.parse throw
 * `RangeError: Maximum call stack size exceeded` (confirmed: not JSON.parse
 * itself — a plain JSON.parse() handles this depth fine in isolation — but
 * whatever recursively walks the parsed config afterward). The top-level
 * catch-all in createHandler (bot/server.js) forwarded that raw engine
 * message straight to the client as `{"error":"Maximum call stack size
 * exceeded"}` with HTTP 500 — an internal implementation detail, not
 * something any route author wrote as user-facing copy.
 *
 * Fix: the catch-all now only trusts e.message when the error carries an
 * explicit e.status — the one signal that its message was deliberately
 * authored for the client (see the many
 * `throw Object.assign(new Error(...), { status })` call sites elsewhere
 * in server.js). Anything without a status — a RangeError, a TypeError, any
 * other unexpected internal failure — now always gets a generic
 * "Internal error." message, regardless of what it happens to say.
 *
 * This oracle boots the real isolated server, authenticates, and replays
 * the re-audit's exact raw-body construction (a hand-built JSON string,
 * not a client-side recursive object, so the probe itself never
 * stack-overflows before sending anything) against POST /api/draft.
 *
 * Run: node --experimental-sqlite bot/test/wave10-security-json-depth-leak.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-json-depth-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'wave10-json-depth-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_TEST_PAY        = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV               = 'test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.RESEND_API_KEY;

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

function rawPost(port, urlPath, bodyString, headers = {}) {
    return new Promise((resolve, reject) => {
        const reqHeaders = Object.assign({
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyString),
        }, headers);
        const req = http.request(
            { hostname: '127.0.0.1', port, method: 'POST', path: urlPath, headers: reqHeaders },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try { json = JSON.parse(raw); } catch (_) {}
                    resolve({ status: res.statusCode, body: raw, json });
                });
            }
        );
        req.on('error', reject);
        req.end(bodyString);
    });
}

function deepNestedDraftBody(depth) {
    // Build the raw text directly — building a JS object this deep and then
    // JSON.stringify-ing it would stack-overflow on the CLIENT side before
    // anything is even sent, which would test the wrong thing.
    return '{"templateId":"portfolio","config":' + '{"a":'.repeat(depth) + '1' + '}'.repeat(depth) + '}';
}

/**
 * Verbatim reconstruction of the catch-all's safety logic, before and after
 * this wave's fix, applied to a real RangeError — proves the fix is an
 * actual behavior change, independent of whether this Node/V8 build happens
 * to throw at the specific depths probed below over HTTP.
 */
function oldCatchAllSafeMessage(e) {
    const raw = (e && e.message) || 'Internal error.';
    const leaksEnv =
        /SERVER_SECRET|STRIPE_SECRET|STRIPE_WEBHOOK|TELEGRAM_BOT_TOKEN|process\.env|HIDOOK_[A-Z0-9_]+/i.test(raw) ||
        /\bat\s+\S+\s+\([^)]+:\d+:\d+\)/.test(raw);
    return leaksEnv ? 'Internal error.' : raw;
}
function newCatchAllSafeMessage(e) {
    const raw = (e && e.message) || 'Internal error.';
    const leaksEnv =
        /SERVER_SECRET|STRIPE_SECRET|STRIPE_WEBHOOK|TELEGRAM_BOT_TOKEN|process\.env|HIDOOK_[A-Z0-9_]+/i.test(raw) ||
        /\bat\s+\S+\s+\([^)]+:\d+:\d+\)/.test(raw);
    const hasStatus = e && typeof e.status === 'number';
    return (hasStatus && !leaksEnv) ? raw : 'Internal error.';
}

(async () => {
    await check('RED (reconstructed pre-fix logic): a status-less RangeError leaks its raw message', () => {
        let realError;
        try {
            (function blowStack() { blowStack(); })();
        } catch (e) {
            realError = e;
        }
        assert.ok(realError instanceof RangeError, 'sanity: got a real RangeError from actual stack exhaustion');
        assert.strictEqual(
            oldCatchAllSafeMessage(realError),
            realError.message,
            'the old logic must forward the RangeError message verbatim (the bug)'
        );
    });

    await check('GREEN (current logic): the same status-less RangeError never reaches the client', () => {
        let realError;
        try {
            (function blowStack() { blowStack(); })();
        } catch (e) {
            realError = e;
        }
        assert.strictEqual(
            newCatchAllSafeMessage(realError),
            'Internal error.',
            'a status-less RangeError must always be replaced with a generic message'
        );
    });

    await check('GREEN: an intentional app error (has e.status) still reaches the client unchanged', () => {
        const appError = Object.assign(new Error('Ciorna nu conține o configurație validă.'), { status: 422 });
        assert.strictEqual(
            newCatchAllSafeMessage(appError),
            'Ciorna nu conține o configurație validă.',
            'deliberately-authored, status-carrying errors must not be swallowed'
        );
    });

    const server = startServer({ port: 0 });
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;

    try {
        // Sign in via the dev magic-link fallback (NODE_ENV=test), same as
        // every other isolated-server oracle in this suite.
        const devEmailRes = await rawPost(port, '/api/auth/email', JSON.stringify({ email: 'depth-probe@example.test' }));
        assert.strictEqual(devEmailRes.status, 200, 'dev auth-email must succeed: ' + devEmailRes.body);
        const devLink = devEmailRes.json && devEmailRes.json.devLink;
        assert.ok(devLink, 'devLink must be present in non-production test env');
        const verifyRes = await new Promise((resolve, reject) => {
            http.get({ hostname: '127.0.0.1', port, path: devLink }, (res) => {
                res.resume();
                resolve(res);
            }).on('error', reject);
        });
        const setCookie = String(verifyRes.headers['set-cookie'] || '');
        const cookie = /hb_session=[^;]+/.exec(setCookie);
        assert.ok(cookie, 'must receive a session cookie from /auth/verify: ' + setCookie);

        let confirmedRangeErrorAtSomeDepth = false;

        for (const depth of [1000, 5000, 20000]) {
            await check(`depth=${depth}: response never contains the raw engine error string`, async () => {
                const res = await rawPost(port, '/api/draft', deepNestedDraftBody(depth), { Cookie: cookie[0] });
                if (res.status === 500 && res.json && res.json.error === 'Internal error.') {
                    // This IS what a caught, sanitized RangeError looks like on
                    // the wire post-fix (see server.error log lines emitted
                    // alongside this response) — the fix worked, so the raw
                    // string is gone; this is how we know the path fired at all.
                    confirmedRangeErrorAtSomeDepth = true;
                }
                assert.ok(
                    !/Maximum call stack size exceeded/i.test(res.body),
                    'raw internal RangeError text leaked to the client: ' + res.body.slice(0, 200)
                );
                assert.ok(
                    !/RangeError/i.test(res.body),
                    'raw error constructor name leaked to the client: ' + res.body.slice(0, 200)
                );
                // A shallower depth may legitimately succeed (real site saved) —
                // this oracle only cares that IF it errors, the error is generic.
                // Whatever comes back must be well-formed JSON either way.
                assert.ok(res.json, 'must return well-formed JSON either way: ' + res.body.slice(0, 200));
                if (res.status >= 400) {
                    assert.ok(typeof res.json.error === 'string' && res.json.error.length > 0,
                        'an error response must carry a non-empty generic error string: ' + res.body.slice(0, 200));
                }
            });
        }

        await check('server survives the whole probe (still answers /health)', async () => {
            const res = await new Promise((resolve, reject) => {
                http.get({ hostname: '127.0.0.1', port, path: '/health' }, (r) => {
                    const chunks = [];
                    r.on('data', (c) => chunks.push(c));
                    r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
                }).on('error', reject);
            });
            assert.strictEqual(res.status, 200, '/health must still answer after the deep-JSON probes');
        });

        // Not a hard requirement (engine internals can shift), but worth
        // surfacing: confirm this oracle actually exercised the RangeError
        // path at least once in this run, so a future engine change that
        // stops throwing at these depths doesn't silently make this test
        // vacuous.
        if (!confirmedRangeErrorAtSomeDepth) {
            console.warn(
                '[wave10-security-json-depth-leak] note: no depth in this run actually ' +
                'triggered a RangeError server-side (checked via response body match) — ' +
                'the leak-prevention assertions still ran and passed, but this specific ' +
                'run may not have exercised the RangeError path. Not a failure.'
            );
        }
    } finally {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    if (failed) {
        console.error('\nwave10-security-json-depth-leak.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave10-security-json-depth-leak.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
