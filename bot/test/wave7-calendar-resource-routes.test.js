'use strict';
/**
 * bot/test/wave7-calendar-resource-routes.test.js
 *
 * The staff/resources model and its concurrency guarantees are covered by
 * their own oracles. This covers the wiring the agent that built them could
 * not touch, and the asymmetry that matters in it:
 *
 *   - the PUBLIC resource list must answer an anonymous visitor, because the
 *     booking widget asks "who can I book with?" before anyone signs in;
 *   - every OWNER route must refuse one, because it manages a business's team
 *     and its customers' appointments.
 *
 * Getting that backwards in either direction is a real defect: a gated public
 * route breaks booking for every visitor, and an ungated owner route exposes
 * one tenant's staff and lets anyone reassign their bookings.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-calendar-resource-routes.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'res-routes-'));
process.env.SERVER_SECRET = 'res-routes-' + crypto.randomBytes(8).toString('hex');
process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';

const { startServer } = require('../server.js');

async function withServer(fn) {
    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    try {
        return await fn('http://127.0.0.1:' + server.address().port);
    } finally {
        await new Promise((r) => server.close(r));
    }
}

test('the public resource list answers an anonymous visitor', async () => {
    await withServer(async (base) => {
        const DEMO = require('../calendar-native/public-api.js').DEMO;
        const q = `?customerId=${encodeURIComponent(DEMO.customerId)}&siteId=${encodeURIComponent(DEMO.siteId)}`;
        const r = await fetch(base + '/api/calendar-native/resources' + q);
        assert.notStrictEqual(r.status, 404, 'the public resources route must be mounted');
        assert.notStrictEqual(r.status, 401, 'a visitor must not have to sign in to see who they can book with');
        const body = await r.json().catch(() => ({}));
        assert.strictEqual(r.status, 200, 'expected 200, got ' + r.status + ' ' + JSON.stringify(body).slice(0, 160));
        assert.ok(Array.isArray(body.resources), 'response must carry a resources array');
    });
});

test('the public route answers a CORS preflight, like its sibling endpoints', async () => {
    // Exported static sites call the bot origin cross-origin via data-api-base.
    // services/slots/bookings are already in the preflight list; a resources
    // route left out of it fails only from an exported site, never locally.
    await withServer(async (base) => {
        const r = await fetch(base + '/api/calendar-native/resources', {
            method: 'OPTIONS',
            headers: { Origin: 'https://example.invalid', 'Access-Control-Request-Method': 'GET' },
        });
        assert.ok(r.status === 200 || r.status === 204, 'preflight should succeed, got ' + r.status);
        assert.ok(r.headers.get('access-control-allow-origin'), 'preflight must carry CORS headers');
    });
});

test('every owner resource route refuses an unauthenticated caller', async () => {
    await withServer(async (base) => {
        const calls = [
            ['GET', '/api/calendar-native/owner/resources'],
            ['POST', '/api/calendar-native/owner/resources'],
            ['PUT', '/api/calendar-native/owner/resources/some-id'],
            ['POST', '/api/calendar-native/owner/bookings/some-id/reassign'],
        ];
        for (const [method, route] of calls) {
            const r = await fetch(base + route, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: method === 'GET' ? undefined : JSON.stringify({ name: 'x' }),
            });
            assert.notStrictEqual(r.status, 404, `${method} ${route} must be mounted`);
            assert.ok(r.status === 401 || r.status === 403,
                `${method} ${route} must be auth-gated; got ${r.status}`);
        }
    });
});

test('the owner API exposes exactly what the routes call', () => {
    const ownerApi = require('../calendar-native/owner-api.js');
    for (const fn of ['listOwnerResources', 'putOwnerResource', 'reassignOwnerBooking']) {
        assert.strictEqual(typeof ownerApi[fn], 'function', `owner-api.${fn} must exist for its route to work`);
    }
    const publicApi = require('../calendar-native/public-api.js');
    assert.strictEqual(typeof publicApi.listPublicResources, 'function',
        'public-api.listPublicResources must exist for the widget route to work');
});
