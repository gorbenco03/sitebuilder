'use strict';
/**
 * bot/test/wave7-domains-routes.test.js
 *
 * The self-serve custom-domain state machine lives in bot/domains.js and is
 * covered by its own oracles. This one covers the wiring the agent that built
 * it could not touch: that the routes exist, that they are auth- and
 * ownership-gated, and that the two polling routes are rate limited.
 *
 * The rate limit is not decoration. /domain/verify and /domain/status make
 * real outbound DNS and Cloudflare calls, and DNS propagation takes hours, so
 * an owner watching a "not visible yet" message will hold the button down.
 * Without a limit each of those clicks is an outbound request.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-domains-routes.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-routes-'));
process.env.SERVER_SECRET = 'domain-routes-' + crypto.randomBytes(8).toString('hex');
process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
delete process.env.CLOUDFLARE_API_TOKEN;

const { startServer } = require('../server.js');

function jsonRequest(base, method, route, body) {
    return fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

test('custom domain routes are mounted and refuse an unauthenticated caller', async () => {
    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        const siteId = 'site-does-not-exist';
        for (const [method, route] of [
            ['GET', `/api/sites/${siteId}/domain`],
            ['POST', `/api/sites/${siteId}/domain`],
            ['DELETE', `/api/sites/${siteId}/domain`],
            ['POST', `/api/sites/${siteId}/domain/verify`],
            ['POST', `/api/sites/${siteId}/domain/status`],
        ]) {
            const r = await jsonRequest(base, method, route, method === 'POST' ? { domain: 'x.ro' } : undefined);
            // 401 proves the route is mounted AND gated. A 404 here would mean
            // the route does not exist at all, which is the regression this
            // guards: the handlers shipped in one wave, the wiring in another.
            assert.strictEqual(r.status, 401, `${method} ${route} should be auth-gated, got ${r.status}`);
            assert.ok(r.body && r.body.error, 'an auth failure must carry an error message');
        }
    } finally {
        await new Promise((r) => server.close(r));
    }
});

test('the polling routes are rate limited per site, with a Romanian message', async () => {
    const ratelimit = require('../ratelimit.js');
    const key = '127.0.0.1|rl-test-site';
    let allowedCount = 0;
    for (let i = 0; i < 20; i++) {
        if (ratelimit.allowAndConsume('domain_poll', key, { max: 12, windowMs: 60 * 1000 }).ok) allowedCount++;
    }
    assert.strictEqual(allowedCount, 12, 'the domain_poll bucket must cap at its configured max');

    // The handler's refusal copy has to be Romanian and has to tell the owner
    // that slow propagation is normal, not an error they caused.
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const at = src.indexOf("'domain_poll'");
    assert.notStrictEqual(at, -1, 'the domain polling routes must consume a rate-limit bucket');
    const around = src.slice(at, at + 800);
    assert.match(around, /RATE_LIMITED/, 'refusal must carry the RATE_LIMITED code');
    assert.match(around, /[ăâîșț]/i, 'refusal message must be Romanian');
    assert.match(around, /DNS/, 'refusal should explain that DNS propagation is slow by nature');
});

test('bot/domains.js exposes exactly what the routes call', () => {
    const domains = require('../domains.js');
    for (const fn of [
        'getDomainForSite',
        'startDomainConnection',
        'checkDomainConnection',
        'activateDomainConnection',
        'checkTlsStatus',
        'disconnectDomainConnection',
    ]) {
        assert.strictEqual(typeof domains[fn], 'function', `domains.${fn} must be exported for the route to work`);
    }
});
