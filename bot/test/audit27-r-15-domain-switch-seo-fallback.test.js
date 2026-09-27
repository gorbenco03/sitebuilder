'use strict';
/**
 * bot/test/audit27-r-15-domain-switch-seo-fallback.test.js — R-15 oracle.
 *
 * Finding gap-custom-domain-selfserve-depth#1 (04-QA-Evidence/Audit-2026-09-27-b45a3e4/
 * findings-all.json): switching the connected custom domain while the old one
 * is active left canonical/og:url/robots.txt/sitemap.xml pointed at the old,
 * just-detached domain until the new domain verified (possibly indefinitely).
 *
 * RED BEFORE this branch: startDomainConnection() detached the old domain
 * from Cloudflare but never called webpublish.applyCustomDomainOrigin(), so
 * the published site's SEO origin stayed on a domain Cloudflare no longer
 * served at all. GREEN AFTER: switching immediately falls back to the Hidook
 * subdomain, and activating the new domain later moves the origin onto it.
 *
 * Same isolated-deploy + stubbed-Cloudflare pattern as
 * wave7-domains-seo-origin.test.js. No live network, no tracked file left
 * modified besides bot/domains.js.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-15-domain-switch-seo-fallback.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function freshTmpDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r15-domain-switch-'));
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
    return {
        fetchImpl,
        markActive(domain) { attached.get(domain).status = 'active'; },
        isAttached(domain) { return attached.has(domain); },
    };
}

function fullConfig(name) {
    return {
        business: { name, title: `${name} | Test`, metaDescription: `${name} — descriere de test.`, lang: 'ro' },
        hero: { background: "url('images/cn-hero.jpg')", ctaLabel: 'Sună acum' },
        contact: { phone: '+40721234567' },
        footer: { address: 'Strada Test 1, București' },
    };
}

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('switching an active custom domain to a new one falls back to the Hidook subdomain immediately, then follows the new domain once it verifies', async () => {
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
        const user = registry.getOrCreateUserByEmail(`audit27-r15-${crypto.randomUUID()}@ex.com`);
        const slug = 'audit27-r15-' + crypto.randomUUID().slice(0, 8);
        const site = registry.createSite({ userId: user.id, templateId: 'product-menu', templateVersion: 1, slug, platform: 'web' });
        const config = fullConfig('Audit27 R15 Test');

        const publishResult = await webpublish.publishSite({ site, config, images: [] });
        const subdomainOrigin = `${process.env.PUBLIC_URL}/live/${slug}`;
        assert.equal(publishResult.url, subdomainOrigin + '/');

        const publishedIndex = path.join(tmpDir, 'published', slug, 'index.html');
        const publishedRobots = path.join(tmpDir, 'published', slug, 'robots.txt');
        const publishedSitemap = path.join(tmpDir, 'published', slug, 'sitemap.xml');

        const fake = fakeCloudflare({ pagesHost: `${site.projectName}.pages.dev` });
        global.fetch = fake.fetchImpl;

        const publishedSite = registry.getSite(site.id);

        // --- Connect + activate domain A ---
        await domains.startDomainConnection({ siteId: site.id, projectName: site.projectName, domain: 'domain-a.com', currentOrigin: publishedSite.url });
        let rec = domains.getDomainForSite(site.id);
        rec.status = 'dns_verified';
        fs.writeFileSync(path.join(tmpDir, 'custom-domains.json'), JSON.stringify({ [site.id]: rec }, null, 2));
        await domains.activateDomainConnection({ siteId: site.id }); // -> provisioning
        fake.markActive('www.domain-a.com');
        const activeA = await domains.checkTlsStatus({ siteId: site.id });
        assert.equal(activeA.status, 'active');

        let html = fs.readFileSync(publishedIndex, 'utf8');
        assert.match(html, /<link rel="canonical" href="https:\/\/www\.domain-a\.com\/">/, 'sanity: domain A must be canonical once active');

        // --- Switch to domain B while A is still active ---
        await domains.startDomainConnection({ siteId: site.id, projectName: site.projectName, domain: 'domain-b.com', currentOrigin: publishedSite.url });

        // Domain A is now genuinely gone from Cloudflare...
        assert.equal(fake.isAttached('www.domain-a.com'), false, 'sanity: domain A must be detached from Cloudflare on switch');

        // ...so the site must NOT still claim domain A as canonical/og:url/
        // sitemap authority — this is the bug: it used to stay stuck on A
        // until B verified (possibly forever).
        html = fs.readFileSync(publishedIndex, 'utf8');
        assert.doesNotMatch(html, /domain-a\.com/, 'canonical/og:url must not still point at the just-detached domain A');
        assert.match(html, new RegExp(`<link rel="canonical" href="${escapeRe(subdomainOrigin)}/">`), 'must fall back to the Hidook subdomain during the switch window');
        assert.match(html, new RegExp(`<meta property="og:url" content="${escapeRe(subdomainOrigin)}/">`), 'og:url must fall back to the Hidook subdomain during the switch window');
        const robots = fs.readFileSync(publishedRobots, 'utf8');
        assert.doesNotMatch(robots, /domain-a\.com/, 'robots.txt must not still list the just-detached domain A');
        const sitemap = fs.readFileSync(publishedSitemap, 'utf8');
        assert.doesNotMatch(sitemap, /domain-a\.com/, 'sitemap.xml must not still list the just-detached domain A');
        assert.match(sitemap, new RegExp(`<loc>${escapeRe(subdomainOrigin)}/</loc>`));

        // The site must stay reachable at its Hidook subdomain throughout.
        assert.ok(fs.existsSync(publishedIndex), 'site must remain reachable on its Hidook subdomain during the switch window');

        // --- Once domain B verifies and activates, the origin must follow it ---
        rec = domains.getDomainForSite(site.id);
        rec.status = 'dns_verified';
        fs.writeFileSync(path.join(tmpDir, 'custom-domains.json'), JSON.stringify({ [site.id]: rec }, null, 2));
        await domains.activateDomainConnection({ siteId: site.id });
        fake.markActive('www.domain-b.com');
        const activeB = await domains.checkTlsStatus({ siteId: site.id });
        assert.equal(activeB.status, 'active');

        html = fs.readFileSync(publishedIndex, 'utf8');
        assert.match(html, /<link rel="canonical" href="https:\/\/www\.domain-b\.com\/">/, 'canonical must follow domain B once it activates');
        assert.doesNotMatch(html, /domain-a\.com/, 'no trace of domain A must remain once B is active');
    } finally {
        global.fetch = origFetch;
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
