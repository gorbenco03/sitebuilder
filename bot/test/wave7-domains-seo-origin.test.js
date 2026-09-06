'use strict';
/**
 * bot/test/wave7-domains-seo-origin.test.js — Wave 7 (audit #47) end-to-end
 * oracle: a real publishSite() build, then connecting + activating a custom
 * domain flips canonical/og:url/robots.txt/sitemap.xml on the LIVE (isolated)
 * copy to the custom domain, and disconnecting restores them to the Hidook
 * subdomain — which was never touched and stays reachable throughout.
 *
 * RED BEFORE this branch: webpublish.applyCustomDomainOrigin did not exist,
 * predictedPublicOrigin() had no notion of a per-site custom domain, and
 * bot/webpublish.js's only "own domain" behaviour was a static concierge
 * contact message (see the old comment this branch replaced, "your own
 * domain? contact us"). A published site's SEO origin could never move off
 * its Hidook subdomain by itself. GREEN AFTER: the four files this task
 * requires (canonical link, og:url, robots.txt, sitemap.xml) all follow the
 * active custom domain, and revert cleanly on disconnect.
 *
 * Uses HIDOOK_ISOLATED_DEPLOY=1 (files land in $DATA_DIR/published/<slug>/,
 * inspected directly here) — the same no-live-host oracle
 * bot/test/audit-publish-seo.test.js already relies on — plus a stubbed
 * Cloudflare Pages API (global.fetch) for the attach/status/detach calls.
 * No real credentials, no live network calls anywhere in this file.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-domains-seo-origin.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function freshTmpDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-domains-seo-'));
}

function jsonResponse(obj, status = 200) {
    return { ok: status < 400, status, json: async () => obj };
}

/** Same minimal fake Cloudflare Pages API as wave7-domains-cloudflare-attach.test.js. */
function fakeCloudflare({ pagesHost }) {
    const attached = new Map();
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
            if (method === 'DELETE') { attached.delete(domain); return jsonResponse({ success: true, result: {} }); }
        }
        if (/\/pages\/projects\/[^/]+\/domains$/.test(u) && method === 'POST') {
            const body = JSON.parse(opts.body);
            attached.set(body.name, { status: 'pending' });
            return jsonResponse({ success: true, result: { name: body.name, status: 'pending' } });
        }
        throw new Error('fakeCloudflare: unhandled request ' + method + ' ' + u);
    }
    return { fetchImpl, markActive(domain) { attached.get(domain).status = 'active'; } };
}

function fullConfig(name) {
    return {
        business: { name, title: `${name} | Test`, metaDescription: `${name} — descriere de test.`, lang: 'ro' },
        hero: { background: "url('images/cn-hero.jpg')", ctaLabel: 'Sună acum' },
        contact: { phone: '+40721234567' },
        footer: { address: 'Strada Test 1, București' },
    };
}

test('publish -> connect custom domain -> activate flips canonical/og:url/robots/sitemap; disconnect restores the (still-live) subdomain', async () => {
    const tmpDir = freshTmpDataDir();
    const saved = {};
    const envOverrides = {
        DATA_DIR: tmpDir,
        HIDOOK_ISOLATED_DEPLOY: '1',
        PUBLIC_URL: 'http://127.0.0.1:4242',
        CLOUDFLARE_API_TOKEN: 'test-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account',
    };
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of ['HIDOOK_FAKE_DEPLOY', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER']) saved[k] = process.env[k];
    Object.assign(process.env, envOverrides);
    delete process.env.HIDOOK_FAKE_DEPLOY;
    delete process.env.BRAND_DOMAIN;
    delete process.env.DEPLOY_PROVIDER;

    delete require.cache[require.resolve('../domains.js')];
    delete require.cache[require.resolve('../deploy-cloudflare.js')];
    delete require.cache[require.resolve('../webpublish.js')];
    delete require.cache[require.resolve('../registry.js')];
    const registry = require('../registry.js');
    const webpublish = require('../webpublish.js');
    const domains = require('../domains.js');

    const origFetch = global.fetch;
    try {
        const user = registry.getOrCreateUserByEmail(`wave7-${crypto.randomUUID()}@ex.com`);
        const slug = 'wave7-seo-' + crypto.randomUUID().slice(0, 8);
        const site = registry.createSite({ userId: user.id, templateId: 'product-menu', templateVersion: 1, slug, platform: 'web' });
        const config = fullConfig('Wave7 SEO Test');

        const publishResult = await webpublish.publishSite({ site, config, images: [] });
        const subdomainOrigin = `${process.env.PUBLIC_URL}/live/${slug}`;
        assert.equal(publishResult.url, subdomainOrigin + '/');

        const publishedIndex = path.join(tmpDir, 'published', slug, 'index.html');
        const publishedRobots = path.join(tmpDir, 'published', slug, 'robots.txt');
        const publishedSitemap = path.join(tmpDir, 'published', slug, 'sitemap.xml');

        // --- Before connecting a domain: SEO already correctly on the subdomain ---
        let html = fs.readFileSync(publishedIndex, 'utf8');
        assert.match(html, new RegExp(`<link rel="canonical" href="${escapeRe(subdomainOrigin)}/">`));
        assert.match(html, new RegExp(`<meta property="og:url" content="${escapeRe(subdomainOrigin)}/">`));
        assert.match(fs.readFileSync(publishedSitemap, 'utf8'), new RegExp(`<loc>${escapeRe(subdomainOrigin)}/</loc>`));

        // --- Connect + verify (skip live DNS — covered elsewhere) + activate ---
        const fake = fakeCloudflare({ pagesHost: `${site.projectName}.pages.dev` });
        global.fetch = fake.fetchImpl;

        // Use the freshly-published site record: publishSite() is the thing
        // that actually sets site.url (registry.createSite() leaves it null),
        // and startDomainConnection captures currentOrigin as the exact
        // fallback to restore on disconnect.
        const publishedSite = registry.getSite(site.id);
        assert.equal(publishedSite.url, subdomainOrigin + '/');
        await domains.startDomainConnection({ siteId: site.id, projectName: site.projectName, domain: 'myshop.com', currentOrigin: publishedSite.url });
        // Force straight to dns_verified (DNS polling itself is
        // wave7-domains-dns-verify.test.js's job) so this test stays focused
        // on what happens to the SEO origin once a domain goes live.
        const rec = domains.getDomainForSite(site.id);
        rec.status = 'dns_verified';
        fs.writeFileSync(path.join(tmpDir, 'custom-domains.json'), JSON.stringify({ [site.id]: rec }, null, 2));

        await domains.activateDomainConnection({ siteId: site.id }); // -> provisioning
        fake.markActive('www.myshop.com');
        const activeStatus = await domains.checkTlsStatus({ siteId: site.id });
        assert.equal(activeStatus.status, 'active');

        // --- SEO origin must now follow the custom domain everywhere ---
        html = fs.readFileSync(publishedIndex, 'utf8');
        assert.match(html, /<link rel="canonical" href="https:\/\/www\.myshop\.com\/">/, 'canonical must follow the custom domain');
        assert.match(html, /<meta property="og:url" content="https:\/\/www\.myshop\.com\/">/, 'og:url must follow the custom domain');
        assert.doesNotMatch(html, new RegExp(escapeRe(subdomainOrigin)), 'no trace of the old subdomain origin must remain in index.html');
        assert.match(fs.readFileSync(publishedRobots, 'utf8'), /Sitemap: https:\/\/www\.myshop\.com\/sitemap\.xml/);
        assert.match(fs.readFileSync(publishedSitemap, 'utf8'), /<loc>https:\/\/www\.myshop\.com\/<\/loc>/);

        // The subdomain was never detached from Cloudflare and the isolated
        // copy is still the SAME published tree — it must still exist and
        // still be servable (config.json's canonical points elsewhere now,
        // but the files themselves are untouched at their subdomain path).
        assert.ok(fs.existsSync(publishedIndex), 'site must still be present at its Hidook subdomain path');

        // --- A future republish (e.g. the owner edits their site) must keep
        // predicting the custom domain, not drift back to the subdomain ---
        const republish = await webpublish.publishSite({ site: registry.getSite(site.id), config, images: [] });
        assert.equal(republish.url, subdomainOrigin + '/', 'the platform-owned subdomain link itself is untouched');
        const htmlAfterRepublish = fs.readFileSync(publishedIndex, 'utf8');
        assert.match(htmlAfterRepublish, /<link rel="canonical" href="https:\/\/www\.myshop\.com\/">/, 'republish must keep predicting the active custom domain');

        // --- Disconnect: Cloudflare detached, SEO reverts, subdomain still serves ---
        const disconnectResult = await domains.disconnectDomainConnection({ siteId: site.id });
        assert.equal(disconnectResult.status, 'disconnected');
        assert.equal(domains.getActiveDomainForSite(site.id), null);

        const htmlAfterDisconnect = fs.readFileSync(publishedIndex, 'utf8');
        assert.match(htmlAfterDisconnect, new RegExp(`<link rel="canonical" href="${escapeRe(subdomainOrigin)}/">`), 'canonical must revert to the subdomain');
        assert.doesNotMatch(htmlAfterDisconnect, /myshop\.com/, 'no trace of the disconnected domain must remain');
        assert.match(fs.readFileSync(publishedSitemap, 'utf8'), new RegExp(`<loc>${escapeRe(subdomainOrigin)}/</loc>`));
        assert.ok(fs.existsSync(publishedIndex), 'site must remain reachable on its Hidook subdomain after disconnect — never dark');
    } finally {
        global.fetch = origFetch;
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
