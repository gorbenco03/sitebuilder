'use strict';
/**
 * bot/test/wave7-domains-cloudflare-attach.test.js — Wave 7 (audit #47)
 * oracle for the Cloudflare-facing half of the flow: attach -> poll TLS
 * status (provisioning -> active) -> detach, entirely against a fake
 * Cloudflare Pages API (global.fetch stub — same style
 * bot/test/audit-publish-seo.test.js already uses for this module's sibling
 * DI-05 checks). No real credentials, no live API calls.
 *
 * RED BEFORE this branch: activateDomainConnection/checkTlsStatus/
 * disconnectDomainConnection, and deploy-cloudflare.js's getDomainStatus/
 * detachDomain, did not exist. GREEN AFTER: the state machine below, and the
 * "never claim active before Cloudflare says so" rule.
 *
 * What the stub CANNOT express (documented rather than pretended away): a
 * real Cloudflare "Custom Hostname" apex domain without Cloudflare-managed
 * DNS gets no fixed A/AAAA IP from the API — routing is edge/SNI-based. This
 * fake, like the real API for domains attached via CNAME, only ever needs a
 * `status` field, so that limitation does not block this flow (see
 * HANDOFF-domains.md).
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-domains-cloudflare-attach.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshTmpDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-domains-cf-'));
}

function loadModules() {
    delete require.cache[require.resolve('../domains.js')];
    delete require.cache[require.resolve('../deploy-cloudflare.js')];
    delete require.cache[require.resolve('../webpublish.js')];
    return {
        domains: require('../domains.js'),
        cfDeploy: require('../deploy-cloudflare.js'),
    };
}

function jsonResponse(obj, status = 200) {
    return { ok: status < 400, status, json: async () => obj };
}

async function withEnv(vars, fn) {
    const saved = {};
    for (const k of Object.keys(vars)) saved[k] = process.env[k];
    Object.assign(process.env, vars);
    try {
        return await fn();
    } finally {
        for (const k of Object.keys(vars)) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
    }
}

/**
 * A tiny fake Cloudflare Pages API: tracks one project + its attached custom
 * domains in memory, and answers exactly the requests deploy-cloudflare.js's
 * cfRequest() makes. Good enough to prove the state machine without ever
 * touching the network.
 */
function fakeCloudflare({ pagesHost }) {
    const attached = new Map(); // domain -> { status }
    async function fetchImpl(url, opts) {
        const u = String(url);
        const method = (opts && opts.method) || 'GET';
        if (/\/pages\/projects\/[^/]+$/.test(u) && !u.includes('/domains') && method === 'GET') {
            return jsonResponse({ success: true, result: { subdomain: pagesHost } });
        }
        const domainMatch = u.match(/\/pages\/projects\/[^/]+\/domains\/([^/?]+)/);
        if (domainMatch) {
            const domain = decodeURIComponent(domainMatch[1]);
            if (method === 'GET') {
                if (!attached.has(domain)) return jsonResponse({ success: false, errors: [{ message: 'not found' }] }, 404);
                return jsonResponse({ success: true, result: { name: domain, status: attached.get(domain).status } });
            }
            if (method === 'DELETE') {
                attached.delete(domain);
                return jsonResponse({ success: true, result: {} });
            }
        }
        if (/\/pages\/projects\/[^/]+\/domains$/.test(u) && method === 'POST') {
            const body = JSON.parse(opts.body);
            if (attached.has(body.name)) {
                return jsonResponse({ success: false, errors: [{ message: 'You have already added this custom domain.' }] }, 400);
            }
            attached.set(body.name, { status: 'pending' });
            return jsonResponse({ success: true, result: { name: body.name, status: 'pending' } });
        }
        throw new Error('fakeCloudflare: unhandled request ' + method + ' ' + u);
    }
    return {
        fetchImpl,
        markActive(domain) { attached.get(domain).status = 'active'; },
        isAttached(domain) { return attached.has(domain); },
    };
}

test('activateDomainConnection refuses to attach before DNS is verified', async () => {
    await withEnv({
        DATA_DIR: freshTmpDataDir(),
        CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a',
    }, async () => {
        const origFetch = global.fetch;
        try {
            const fake = fakeCloudflare({ pagesHost: 'guard-site-xyz.pages.dev' });
            global.fetch = fake.fetchImpl;
            const { domains } = loadModules();
            await domains.startDomainConnection({ siteId: 'guard-id', projectName: 'guard-site', domain: 'guardshop.com' });

            await assert.rejects(
                () => domains.activateDomainConnection({ siteId: 'guard-id' }),
                (e) => { assert.equal(e.code, 'NOT_VERIFIED'); return true; }
            );
            assert.equal(fake.isAttached('www.guardshop.com'), false, 'must not attach to Cloudflare before DNS is verified');
        } finally {
            global.fetch = origFetch;
        }
    });
});

test('full lifecycle: dns_verified -> provisioning -> active flips SEO origin; then disconnect restores the subdomain', async () => {
    await withEnv({
        DATA_DIR: freshTmpDataDir(),
        CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a',
        HIDOOK_FAKE_DEPLOY: '1',
    }, async () => {
        const origFetch = global.fetch;
        try {
            const fake = fakeCloudflare({ pagesHost: 'life-site-xyz.pages.dev' });
            global.fetch = fake.fetchImpl;
            const { domains } = loadModules();

            // Force the record straight to dns_verified — DNS polling itself
            // is covered by wave7-domains-dns-verify.test.js; this test is
            // about the Cloudflare attach/status/detach state machine.
            await domains.startDomainConnection({ siteId: 'life-id', projectName: 'life-site', domain: 'lifeshop.com' });
            const store = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'custom-domains.json'), 'utf8'));
            store['life-id'].status = 'dns_verified';
            fs.writeFileSync(path.join(process.env.DATA_DIR, 'custom-domains.json'), JSON.stringify(store, null, 2));

            // --- attach: Cloudflare reports pending -> our status is 'provisioning', never 'active' yet ---
            const afterActivate = await domains.activateDomainConnection({ siteId: 'life-id' });
            assert.equal(afterActivate.status, 'provisioning', 'must not claim active before Cloudflare confirms it');
            assert.equal(fake.isAttached('www.lifeshop.com'), true);

            // --- poll again while still pending: stays 'provisioning', not alarming ---
            const stillPending = await domains.checkTlsStatus({ siteId: 'life-id' });
            assert.equal(stillPending.status, 'provisioning');
            assert.match(stillPending.message, /[ăâîșț]/i);

            // --- Cloudflare finally reports active ---
            fake.markActive('www.lifeshop.com');
            const nowActive = await domains.checkTlsStatus({ siteId: 'life-id' });
            assert.equal(nowActive.status, 'active');
            assert.equal(domains.getActiveDomainForSite('life-id'), 'www.lifeshop.com');

            // --- disconnect: Cloudflare domain removed, local status flips,
            //     and getActiveDomainForSite must stop reporting it (so the
            //     next publish reverts to predicting the Hidook subdomain) ---
            const disconnected = await domains.disconnectDomainConnection({ siteId: 'life-id' });
            assert.equal(disconnected.status, 'disconnected');
            assert.equal(fake.isAttached('www.lifeshop.com'), false, 'must actually detach on Cloudflare');
            assert.equal(domains.getActiveDomainForSite('life-id'), null, 'a disconnected domain must not still be reported active');
        } finally {
            global.fetch = origFetch;
        }
    });
});

test('detachDomain (deploy-cloudflare.js) is idempotent: a domain already gone (404) is success, not an error', async () => {
    await withEnv({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }, async () => {
        const origFetch = global.fetch;
        try {
            global.fetch = async () => jsonResponse({ success: false, errors: [{ message: 'not found' }] }, 404);
            const { cfDeploy } = loadModules();
            const result = await cfDeploy.detachDomain('some-project', 'gone-already.com');
            assert.deepEqual(result, { ok: true });
        } finally {
            global.fetch = origFetch;
        }
    });
});

test('getDomainStatus (deploy-cloudflare.js) returns null (not a throw) for a domain that was never attached', async () => {
    await withEnv({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }, async () => {
        const origFetch = global.fetch;
        try {
            global.fetch = async () => jsonResponse({ success: false, errors: [{ message: 'not found' }] }, 404);
            const { cfDeploy } = loadModules();
            const result = await cfDeploy.getDomainStatus('some-project', 'never-attached.com');
            assert.equal(result, null);
        } finally {
            global.fetch = origFetch;
        }
    });
});
