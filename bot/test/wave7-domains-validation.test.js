'use strict';
/**
 * bot/test/wave7-domains-validation.test.js — Wave 7 (audit #47) oracle for
 * bot/domains.js's self-serve custom-domain input validation.
 *
 * RED BEFORE this branch: normalizeDomain/startDomainConnection did not
 * exist at all (domains.js only had the Vercel domain-purchase API), so
 * every check below would fail with "is not a function". GREEN AFTER: the
 * validation rules an owner-entered domain must pass before Hidook ever
 * shows DNS instructions or touches the network.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-domains-validation.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function freshTmpDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-domains-validation-'));
}

function loadDomains() {
    delete require.cache[require.resolve('../domains.js')];
    delete require.cache[require.resolve('../deploy-cloudflare.js')];
    delete require.cache[require.resolve('../webpublish.js')];
    return require('../domains.js');
}

test('normalizeDomain: accepts a plain domain and detects apex vs subdomain', () => {
    const domains = loadDomains();
    assert.deepEqual(domains.normalizeDomain('myshop.com'), { domain: 'myshop.com', isApex: true });
    assert.deepEqual(domains.normalizeDomain('www.myshop.com'), { domain: 'www.myshop.com', isApex: false });
    // Forgives a pasted full URL and uppercase input.
    assert.deepEqual(domains.normalizeDomain('HTTPS://MySHOP.com/pagina?x=1'), { domain: 'myshop.com', isApex: true });
});

test('normalizeDomain: normalizes an accented IDN domain to punycode', () => {
    const domains = loadDomains();
    const { domain } = domains.normalizeDomain('cafenea-mea.ro');
    assert.equal(domain, 'cafenea-mea.ro');
    const idn = domains.normalizeDomain('café.ro');
    assert.match(idn.domain, /^xn--/, 'accented domain must be normalized to punycode, got: ' + idn.domain);
});

test('normalizeDomain: rejects empty input', () => {
    const domains = loadDomains();
    assert.throws(() => domains.normalizeDomain(''), (e) => {
        assert.equal(e.code, 'MISSING');
        assert.match(e.message, /[ăâîșț]|domeniu/i);
        return true;
    });
});

test('normalizeDomain: rejects an IP address, not just a malformed domain', () => {
    const domains = loadDomains();
    assert.throws(() => domains.normalizeDomain('203.0.113.5'), (e) => {
        assert.equal(e.code, 'IS_IP');
        return true;
    });
    assert.throws(() => domains.normalizeDomain('::1'), (e) => {
        assert.equal(e.code, 'IS_IP');
        return true;
    });
});

test('normalizeDomain: rejects garbage / malformed hostnames', () => {
    const domains = loadDomains();
    for (const bad of ['not a domain', 'localhost', 'no-dot', 'a..b.com', '-leading.com']) {
        assert.throws(() => domains.normalizeDomain(bad), (e) => {
            assert.equal(e.code, 'INVALID_FORMAT', `expected INVALID_FORMAT for "${bad}", got ${e.code}`);
            return true;
        }, `expected "${bad}" to be rejected`);
    }
});

test('normalizeDomain: rejects the platform\'s own brand domain and its subdomains', () => {
    const savedBrand = process.env.BRAND_DOMAIN;
    process.env.BRAND_DOMAIN = 'hidook-sites.example';
    try {
        const domains = loadDomains();
        for (const bad of ['hidook-sites.example', 'myshop.hidook-sites.example', 'hidook.tech', 'app.hidook.agency', 'foo.pages.dev']) {
            assert.throws(() => domains.normalizeDomain(bad), (e) => {
                assert.equal(e.code, 'IS_HIDOOK_DOMAIN', `expected IS_HIDOOK_DOMAIN for "${bad}", got ${e.code}`);
                return true;
            }, `expected "${bad}" to be rejected as a Hidook-owned domain`);
        }
        // A domain that merely CONTAINS the brand string as a substring (not
        // a real subdomain) must still be accepted.
        assert.doesNotThrow(() => domains.normalizeDomain('nothidook-sites.example.com'));
    } finally {
        if (savedBrand === undefined) delete process.env.BRAND_DOMAIN;
        else process.env.BRAND_DOMAIN = savedBrand;
    }
});

test('startDomainConnection: rejects a domain already connected to a different site', async () => {
    const tmpDir = freshTmpDataDir();
    const savedDataDir = process.env.DATA_DIR;
    const savedCfToken = process.env.CLOUDFLARE_API_TOKEN;
    const savedCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    process.env.DATA_DIR = tmpDir;
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    const origFetch = global.fetch;
    try {
        // Stub Cloudflare's project lookup so fetchPagesHost() resolves without
        // a real network call — this is the "provable against a fake/stubbed
        // provider" requirement, not a live API call.
        global.fetch = async (url) => {
            if (String(url).includes('/pages/projects/site-a')) {
                return jsonResponse({ success: true, result: { subdomain: 'site-a.pages.dev' } });
            }
            throw new Error('unexpected fetch: ' + url);
        };
        const domains = loadDomains();

        const first = await domains.startDomainConnection({
            siteId: 'site-a-id',
            projectName: 'site-a',
            domain: 'sharedshop.com',
        });
        assert.equal(first.domain, 'sharedshop.com');
        assert.equal(first.status, 'awaiting_dns');

        await assert.rejects(
            () => domains.startDomainConnection({
                siteId: 'site-b-id',
                projectName: 'site-b',
                domain: 'sharedshop.com',
            }),
            (e) => {
                assert.equal(e.code, 'ALREADY_CLAIMED');
                return true;
            }
        );
    } finally {
        global.fetch = origFetch;
        if (savedDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = savedDataDir;
        if (savedCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = savedCfToken;
        if (savedCfAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = savedCfAccount;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('startDomainConnection: shows a TXT + CNAME record with real values, and an apex-forwarding note only for apex domains', async () => {
    const tmpDir = freshTmpDataDir();
    const savedDataDir = process.env.DATA_DIR;
    const savedCfToken = process.env.CLOUDFLARE_API_TOKEN;
    const savedCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    process.env.DATA_DIR = tmpDir;
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    const origFetch = global.fetch;
    try {
        global.fetch = async () => jsonResponse({ success: true, result: { subdomain: 'apex-site-xyz.pages.dev' } });
        const domains = loadDomains();

        const result = await domains.startDomainConnection({
            siteId: 'apex-site-id',
            projectName: 'apex-site',
            domain: 'afacereamea.ro',
        });

        assert.equal(result.isApex, true);
        assert.equal(result.targetHost, 'www.afacereamea.ro');
        assert.ok(result.note && /www\.afacereamea\.ro/.test(result.note), 'apex note must mention the www target');
        assert.ok(/[ăâîșț]/i.test(result.note), 'apex note must be Romanian');

        const txt = result.records.find((r) => r.tip === 'TXT');
        const cname = result.records.find((r) => r.tip === 'CNAME');
        assert.ok(txt, 'must show a TXT record');
        assert.ok(cname, 'must show a CNAME record');
        assert.equal(cname.nume, 'www.afacereamea.ro');
        assert.equal(cname.valoare, 'apex-site-xyz.pages.dev', 'CNAME must point at the REAL pages.dev host, not a guess');
        assert.match(txt.nume, /^_hidook-challenge\.www\.afacereamea\.ro$/);
        assert.match(txt.valoare, /^hidook-verify=[0-9a-f]{32}$/);
    } finally {
        global.fetch = origFetch;
        if (savedDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = savedDataDir;
        if (savedCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = savedCfToken;
        if (savedCfAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = savedCfAccount;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

function jsonResponse(obj) {
    return {
        ok: true,
        status: 200,
        json: async () => obj,
    };
}
