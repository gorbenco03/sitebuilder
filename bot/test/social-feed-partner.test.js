'use strict';
/**
 * bot/test/social-feed-partner.test.js — S44 web Add Instagram partner slot.
 *
 * Site Builder talks to Instafidget server-to-server only.
 * Secret never appears in responses. acceptedTerms must be true before fetch.
 *
 * Run: node bot/test/social-feed-partner.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-feed-'));
process.env.DATA_DIR      = tmpDir;
process.env.SERVER_SECRET = 'test-secret-social-' + crypto.randomBytes(4).toString('hex');
process.env.PUBLIC_URL    = 'http://127.0.0.1:0';
delete process.env.SITEBUILDER_PARTNER_SECRET;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.HIDOOK_FAKE_DEPLOY;

const ROOT = path.resolve(__dirname, '../..');
const partnerSrc = fs.readFileSync(path.join(ROOT, 'bot', 'instafidget-partner.js'), 'utf8');
const serverSrc  = fs.readFileSync(path.join(ROOT, 'bot', 'server.js'), 'utf8');
const appSrc     = fs.readFileSync(path.join(ROOT, 'builder', 'app.js'), 'utf8');
const htmlSrc    = fs.readFileSync(path.join(ROOT, 'builder', 'index.html'), 'utf8');

const auth     = require('../auth.js');
const registry = require('../registry.js');
const { startServer } = require('../server.js');

let failed = 0;
let fetchCalls = [];
const realFetch = global.fetch;

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

function mockPartner(handler) {
    global.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes('/billing/partner/')) {
            fetchCalls.push({ url: u, headers: (opts && opts.headers) || {}, body: opts && opts.body });
            return handler(u, opts);
        }
        return realFetch(url, opts);
    };
}

function restoreFetch() {
    global.fetch = realFetch;
}

function secretIn(obj) {
    return /SITEBUILDER_PARTNER_SECRET|x-sitebuilder-partner-secret/i.test(JSON.stringify(obj));
}

(async () => {
    await check('partner module exists and does not hardcode a secret', () => {
        assert.ok(partnerSrc.includes('SITEBUILDER_PARTNER_SECRET'));
        assert.ok(!/sk_live|whsec_|rk_live/.test(partnerSrc));
        assert.ok(!partnerSrc.includes('from builder'));
    });

    await check('builder never mentions partner secret', () => {
        assert.ok(!/SITEBUILDER_PARTNER_SECRET|x-sitebuilder-partner-secret/i.test(appSrc + htmlSrc));
        assert.ok(/Adaugă Instagram/.test(htmlSrc + appSrc));
        assert.ok(/instafidget.hidook.agency\/terms/.test(htmlSrc + appSrc));
        assert.ok(/acceptedTerms/.test(appSrc));
    });

    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;

    const emailUser = registry.getOrCreateUserByEmail('owner@example.com');
    const tgUser = registry.getOrCreateUserByTelegram('999001');
    const site = registry.createSite({
        userId: emailUser.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'ig-slot-test',
        platform: 'web',
    });
    registry.saveVersion(site.id, {
        business: { name: 'Test IG' },
        instagram: { handle: 'test', url: 'https://instagram.com/test', gallery: ['https://example.com/a.jpg'] },
    });
    const otherSite = registry.createSite({
        userId: tgUser.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'ig-other',
        platform: 'web',
    });
    const cookie = 'hb_session=' + auth.signSession(emailUser.id);
    const tgCookie = 'hb_session=' + auth.signSession(tgUser.id);

    await check('unauthenticated grant → 401', async () => {
        const res = await fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.strictEqual(res.status, 401);
        const body = await res.json();
        assert.ok(!secretIn(body));
    });

    await check('grant without acceptedTerms does not call fetch', async () => {
        fetchCalls = [];
        mockPartner(async () => ({ status: 200, json: async () => ({}) }));
        process.env.SITEBUILDER_PARTNER_SECRET = 'unit-test-secret-not-real';
        const res = await fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ acceptedTerms: false }),
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(fetchCalls.length, 0, 'must not call Instafidget');
        const body = await res.json();
        assert.ok(!secretIn(body));
        delete process.env.SITEBUILDER_PARTNER_SECRET;
        restoreFetch();
    });

    await check('missing secret → 503 and no fetch', async () => {
        fetchCalls = [];
        mockPartner(async () => ({ status: 200, json: async () => ({}) }));
        delete process.env.SITEBUILDER_PARTNER_SECRET;
        const res = await fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.strictEqual(res.status, 503);
        assert.strictEqual(fetchCalls.length, 0);
        const body = await res.json();
        assert.ok(!secretIn(body));
        restoreFetch();
    });

    await check('telegram-only user without email → 400, no fetch', async () => {
        fetchCalls = [];
        mockPartner(async () => ({ status: 200, json: async () => ({}) }));
        process.env.SITEBUILDER_PARTNER_SECRET = 'unit-test-secret-not-real';
        const res = await fetch(`${base}/api/sites/${otherSite.id}/social-feed/grant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: tgCookie },
            body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(fetchCalls.length, 0);
        delete process.env.SITEBUILDER_PARTNER_SECRET;
        restoreFetch();
    });

    await check('grant mock 200 persists instagram.embedUrl and keeps gallery', async () => {
        fetchCalls = [];
        process.env.SITEBUILDER_PARTNER_SECRET = 'unit-test-secret-not-real';
        const embed = 'https://instafidget.hidook.agency/embed/instagram?widgetKey=abc-123';
        mockPartner(async () => ({
            status: 200,
            json: async () => ({
                embedUrl: embed,
                entitlement: 'site_bundle',
                showWatermark: false,
                siteBundleExpiresAt: '2027-08-23T00:00:00.000Z',
                stripeSubscriptionId: 'should-not-leak-needed',
            }),
        }));
        const res = await fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.embedUrl, embed);
        assert.strictEqual(body.entitlement, 'site_bundle');
        assert.strictEqual(body.showWatermark, false);
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'stripeSubscriptionId'));
        assert.ok(!secretIn(body));
        assert.strictEqual(fetchCalls.length, 1);
        assert.ok(String(fetchCalls[0].url).endsWith('/billing/partner/site-bundle-grant'));
        assert.strictEqual(fetchCalls[0].headers['x-sitebuilder-partner-secret'], 'unit-test-secret-not-real');
        const payload = JSON.parse(fetchCalls[0].body);
        assert.strictEqual(payload.email, 'owner@example.com');
        assert.strictEqual(payload.acceptedTerms, true);

        const versions = registry.listVersions(site.id);
        const latest = versions[versions.length - 1];
        const cfg = registry.getVersionConfig(site.id, latest.versionId);
        assert.strictEqual(cfg.instagram.embedUrl, embed);
        assert.deepStrictEqual(cfg.instagram.gallery, ['https://example.com/a.jpg']);

        delete process.env.SITEBUILDER_PARTNER_SECRET;
        restoreFetch();
    });

    await check('editor-session returns only editorUrl', async () => {
        fetchCalls = [];
        process.env.SITEBUILDER_PARTNER_SECRET = 'unit-test-secret-not-real';
        mockPartner(async () => ({
            status: 200,
            json: async () => ({
                editorUrl: 'https://instafidget.hidook.agency/auth/verify?token=one-shot',
                extra: 'nope',
            }),
        }));
        const res = await fetch(`${base}/api/sites/${site.id}/social-feed/editor-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({}),
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(Object.keys(body).join(','), 'editorUrl');
        assert.ok(body.editorUrl.startsWith('https://instafidget.hidook.agency/auth/verify'));
        assert.ok(!secretIn(body));
        assert.ok(String(fetchCalls[0].url).endsWith('/billing/partner/editor-session'));
        delete process.env.SITEBUILDER_PARTNER_SECRET;
        restoreFetch();
    });

    srv.close();

    if (failed) {
        console.error('\nsocial-feed-partner.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nsocial-feed-partner.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
