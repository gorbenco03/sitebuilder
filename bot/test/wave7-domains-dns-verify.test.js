'use strict';
/**
 * bot/test/wave7-domains-dns-verify.test.js — Wave 7 (audit #47) oracle for
 * bot/domains.js's DNS-polling honesty: "not yet visible" -> "visible but
 * wrong value" -> "verified", never claiming success early, never hanging.
 *
 * RED BEFORE this branch: checkDomainConnection did not exist at all — there
 * was no self-serve verification path, only the manual concierge message in
 * bot/webpublish.js. GREEN AFTER: the three states below, driven purely by a
 * stubbed dns.promises (no real DNS lookups, no live network calls — the
 * "fake/stubbed provider" this task requires), plus a bounded timeout when
 * DNS never answers at all.
 *
 * Stubbing approach: `require('dns').promises` is the exact object instance
 * bot/domains.js calls through (`dns.resolveTxt(...)`, never destructured),
 * so overwriting its methods here reaches domains.js's calls too — the same
 * "reassign the shared thing" style already used for global.fetch elsewhere
 * in this test suite (see bot/test/audit-publish-seo.test.js).
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-domains-dns-verify.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshTmpDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-domains-dns-'));
}

function loadDomains() {
    delete require.cache[require.resolve('../domains.js')];
    delete require.cache[require.resolve('../deploy-cloudflare.js')];
    delete require.cache[require.resolve('../webpublish.js')];
    return require('../domains.js');
}

function jsonResponse(obj) {
    return { ok: true, status: 200, json: async () => obj };
}

function enotfound(name) {
    const e = new Error(`queryTxt ENOTFOUND ${name}`);
    e.code = 'ENOTFOUND';
    return e;
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

test('checkDomainConnection: not found -> wrong value -> verified, across three separate polls', async () => {
    await withEnv({
        DATA_DIR: freshTmpDataDir(),
        CLOUDFLARE_API_TOKEN: 'test-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account',
    }, async () => {
        const origFetch = global.fetch;
        const dnsPromises = require('dns').promises;
        const origResolveTxt = dnsPromises.resolveTxt;
        const origResolveCname = dnsPromises.resolveCname;
        try {
            global.fetch = async () => jsonResponse({ success: true, result: { subdomain: 'poll-site-xyz.pages.dev' } });
            const domains = loadDomains();

            const started = await domains.startDomainConnection({
                siteId: 'poll-site-id',
                projectName: 'poll-site',
                domain: 'pollmyshop.com', // non-apex-looking two-label domain is still apex by our heuristic; use a subdomain to test CNAME directly
            });
            const target = started.targetHost; // 'www.pollmyshop.com' (apex -> www target)
            const expectedTxtName = `_hidook-challenge.${target}`;

            // --- Poll 1: neither record exists yet ---
            dnsPromises.resolveTxt = async () => { throw enotfound(expectedTxtName); };
            dnsPromises.resolveCname = async () => { throw enotfound(target); };
            const poll1 = await domains.checkDomainConnection({ siteId: 'poll-site-id' });
            assert.equal(poll1.status, 'awaiting_dns');
            assert.equal(poll1.txt.state, 'not_found');
            assert.equal(poll1.cname.state, 'not_found');
            assert.ok(/normal|propagarea/i.test(poll1.message), 'must read as a normal, non-alarming wait: ' + poll1.message);

            // --- Poll 2: CNAME now resolves but to the WRONG host (customer
            // pointed it somewhere else / copy-paste error); TXT still missing ---
            dnsPromises.resolveTxt = async () => { throw enotfound(expectedTxtName); };
            dnsPromises.resolveCname = async () => ['someone-elses-site.pages.dev'];
            const poll2 = await domains.checkDomainConnection({ siteId: 'poll-site-id' });
            assert.equal(poll2.status, 'dns_partial');
            assert.equal(poll2.cname.state, 'mismatch');
            assert.deepEqual(poll2.cname.found, ['someone-elses-site.pages.dev']);

            // --- Poll 3: both records correct ---
            dnsPromises.resolveTxt = async () => [[`hidook-verify=${started.records[0].valoare.split('=')[1]}`]];
            dnsPromises.resolveCname = async () => ['poll-site-xyz.pages.dev'];
            const poll3 = await domains.checkDomainConnection({ siteId: 'poll-site-id' });
            assert.equal(poll3.status, 'dns_verified');
            assert.equal(poll3.txt.state, 'ok');
            assert.equal(poll3.cname.state, 'ok');
        } finally {
            global.fetch = origFetch;
            dnsPromises.resolveTxt = origResolveTxt;
            dnsPromises.resolveCname = origResolveCname;
        }
    });
});

test('checkDomainConnection: a DNS lookup that never answers times out instead of hanging forever', async () => {
    await withEnv({
        DATA_DIR: freshTmpDataDir(),
        CLOUDFLARE_API_TOKEN: 'test-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account',
        DOMAIN_DNS_TIMEOUT_MS: '80',
    }, async () => {
        const origFetch = global.fetch;
        const dnsPromises = require('dns').promises;
        const origResolveTxt = dnsPromises.resolveTxt;
        const origResolveCname = dnsPromises.resolveCname;
        try {
            global.fetch = async () => jsonResponse({ success: true, result: { subdomain: 'hang-site-xyz.pages.dev' } });
            const domains = loadDomains();

            await domains.startDomainConnection({
                siteId: 'hang-site-id',
                projectName: 'hang-site',
                domain: 'www.hangshop.com',
            });

            // Neither resolver ever settles — exactly what a hung/unreachable
            // resolver looks like from the caller's point of view.
            dnsPromises.resolveTxt = () => new Promise(() => {});
            dnsPromises.resolveCname = () => new Promise(() => {});

            const started = Date.now();
            const result = await domains.checkDomainConnection({ siteId: 'hang-site-id' });
            assert.ok(Date.now() - started < 2000, 'must fail fast, not hang');
            assert.equal(result.txt.state, 'error');
            assert.match(result.txt.error, /timed out after 80ms/);
            assert.equal(result.cname.state, 'error');
            // A resolver error is treated the same as "not found yet" for the
            // coarse status — a transient DNS hiccup must not read as failure.
            assert.equal(result.status, 'awaiting_dns');
        } finally {
            global.fetch = origFetch;
            dnsPromises.resolveTxt = origResolveTxt;
            dnsPromises.resolveCname = origResolveCname;
        }
    });
});
