'use strict';
/**
 * bot/test/suite12-publish-lifecycle.test.js
 *
 * PLAN-FEEDBACK-2026-09-14, Suite A owner-reported defects (production
 * screenshots), both on the dashboard/publish lifecycle:
 *
 * Defect #1 — after paying and the site going live, "Proiectele mele" still
 * showed the site card as "Activ" AND a banner above it: "Ai un proiect
 * neterminat: <name>. Continui de unde ai rămas?" — even though the project
 * was paid and live, not unfinished. Root cause: maybeShowRecoveryBanner()
 * (builder/app.js) only ever compared the local draft's templateId against
 * whatever template happened to be open in THIS tab; it never looked at
 * whether the draft's site had actually been published. Fix: a draft bound
 * to a paid site (saved.siteId && saved.paid) is never called "proiect
 * neterminat"; it is only offered back — reworded, named by the site — when
 * a NEW snapshot mechanism (notePublishedSnapshot(), publishedConfigSnapshot)
 * proves the local draft genuinely still differs from what was last
 * published. "Renunță" never clears localStorage for that case (a paid
 * site's own draft is never disposable scratch work).
 *
 * Defect #2 — editing a live site and publishing again showed the success
 * modal "Modificările sunt live" with the raw Cloudflare Pages host
 * (https://<slug>.pages.dev) while the dashboard card — and the address that
 * actually worked — was the platform's own brand subdomain
 * (https://<slug>.<BRAND_DOMAIN>). Root cause: bot/webpublish.js's _deploy()
 * asked Cloudflare to reconfirm the brand-subdomain DNS attach on every
 * single publish (ensureSubdomain() — explicitly best-effort, silently
 * returns brandUrl:null on any transient hiccup) and, whenever that
 * reconfirmation didn't come back clean, fell straight through to the raw
 * pages.dev host — even when that project's brand subdomain had already
 * been working since an earlier publish and the CNAME never went away.
 * bot/server.js's handlePublish then broadcast that single call's raw
 * return value (result.url) as "the" URL, instead of deferring to the
 * site's own persisted registry row. Fix: (a) _deploy() now keeps an
 * already-established brand subdomain instead of regressing to pages.dev on
 * a transient reconfirmation failure (existingUrl guard); (b)
 * webpublish.publicUrlForSite() is the ONE source of truth for "this site's
 * public address" (active verified custom domain > registry url), and every
 * server response that carries a site now attaches it as `publicUrl` — read
 * by the client (siteDisplayUrl()) for the success modal, its copy button,
 * "Trimite pe WhatsApp", and the dashboard card link alike, so they can
 * never show different addresses for the same site again.
 *
 * Defect #3 (found while fixing the above, same dashboard/draft lifecycle) —
 * after deleting a site with a correctly typed "Șterge definitiv"
 * confirmation, the dashboard immediately showed a NEW project with the
 * identical name, as an unpaid draft with a different site id — the real
 * data was gone (confirmed via the API and a 404 live URL), so this was not
 * a failed delete, it looked like one. Root cause: confirmDeleteSite()
 * (builder/app.js) deleted the site server-side but never retired the local
 * draft bound to it — hb.draft.v1 (and the in-memory currentSiteId/
 * draft.config mirroring it) kept pointing at the now-gone site, so either
 * loadDashboard()'s "empty account → resume local draft" branch or the next
 * debounced server autosave (runServerAutosave()'s `siteId: currentSiteId ||
 * undefined`, POST /api/draft) silently recreated a brand-new UNPAID site
 * from that orphaned draft. Fix: retireLocalDraftForDeletedSite() clears the
 * matching local draft (and the in-memory bind) the moment the delete call
 * succeeds, so nothing is left to resurrect.
 *
 * Local only — no production URL, no real Stripe, no real Cloudflare
 * network calls (a fake Cloudflare Pages REST API stands in via
 * global.fetch, same style as bot/test/wave7-domains-seo-origin.test.js and
 * bot/test/wave7-domains-cloudflare-attach.test.js).
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-publish-lifecycle.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Suite12-publish-lifecycle');

// ---------------------------------------------------------------------------
// Shared small helpers
// ---------------------------------------------------------------------------

function freshTmpDataDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function loadFreshRegistryModules() {
    for (const rel of ['../domains.js', '../deploy-cloudflare.js', '../webpublish.js', '../registry.js', '../flow.js']) {
        delete require.cache[require.resolve(rel)];
    }
    return {
        registry: require('../registry.js'),
        webpublish: require('../webpublish.js'),
        domains: require('../domains.js'),
        cfDeploy: require('../deploy-cloudflare.js'),
        flow: require('../flow.js'),
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

/** Same minimal fake Cloudflare Pages API as wave7-domains-seo-origin.test.js
 * (custom-domain connect/attach/status surface only). Only intercepts
 * api.cloudflare.com — everything else (this test's own HTTP calls to its
 * local server) passes straight through to the real fetch, since this stub
 * replaces the GLOBAL fetch for the duration of the domain-connect calls. */
function fakeCloudflareDomainConnect({ pagesHost, passthrough }) {
    const attached = new Map();
    async function fetchImpl(url, opts) {
        const u = String(url);
        if (!u.startsWith('https://api.cloudflare.com/')) return passthrough(url, opts);
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
        throw new Error('fakeCloudflareDomainConnect: unhandled request ' + method + ' ' + u);
    }
    return { fetchImpl, markActive(domain) { attached.get(domain).status = 'active'; } };
}

/**
 * Fake Cloudflare Pages API for the OTHER surface — ensureSubdomain()'s
 * <slug>.<BRAND_DOMAIN> attach (deploy-cloudflare.js): project subdomain
 * lookup, zone lookup, and DNS record creation. `failNextProjectLookup()`
 * makes the NEXT project-subdomain GET (the one ensureSubdomain needs to
 * even attempt a CNAME) fail like a transient Cloudflare API hiccup would —
 * exactly the case ensureSubdomain's own doc comment says is best-effort
 * and must not be treated as "the subdomain stopped working".
 */
function fakeCloudflareBrandSubdomain({ pagesHost, zoneName, passthrough }) {
    let failNext = false;
    async function fetchImpl(url, opts) {
        const u = String(url);
        if (!u.startsWith('https://api.cloudflare.com/')) return (passthrough || fetch)(url, opts);
        const method = (opts && opts.method) || 'GET';
        if (/\/pages\/projects\/[^/]+$/.test(u) && !u.includes('/domains') && method === 'GET') {
            if (failNext) {
                failNext = false;
                return jsonResponse({ success: false, errors: [{ message: 'temporary Cloudflare API hiccup' }] }, 500);
            }
            return jsonResponse({ success: true, result: { subdomain: pagesHost } });
        }
        if (/\/pages\/projects\/[^/]+\/domains$/.test(u) && method === 'POST') {
            return jsonResponse({ success: true, result: { status: 'pending' } });
        }
        if (/\/zones\?name=/.test(u) && method === 'GET') {
            return jsonResponse({ success: true, result: [{ id: 'zone1', name: zoneName }] });
        }
        if (/\/zones\/[^/]+\/dns_records$/.test(u) && method === 'POST') {
            return jsonResponse({ success: true, result: {} });
        }
        throw new Error('fakeCloudflareBrandSubdomain: unhandled request ' + method + ' ' + u);
    }
    return { fetchImpl, failNextProjectLookup() { failNext = true; } };
}

// ---------------------------------------------------------------------------
// Defect #2a — publicUrl is the ONE source of truth across GET /api/sites,
// POST /api/publish and POST /api/test-pay/complete, and an active verified
// custom domain wins over the platform's own address — while `url` itself
// (the platform host domain-connect/exports/calendar legitimately need)
// stays untouched.
// ---------------------------------------------------------------------------
test('defect #2a: publicUrl agrees everywhere and prefers an active custom domain; url is left untouched', async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const tmpDir = freshTmpDataDir('suite12-2a-');
    const saved = {};
    const envOverrides = {
        DATA_DIR: tmpDir,
        HIDOOK_TEST_PAY: '1',
        HIDOOK_ISOLATED_DEPLOY: '1',
        NODE_ENV: 'test',
        SERVER_SECRET: 'suite12-2a-' + crypto.randomBytes(8).toString('hex'),
        CLOUDFLARE_API_TOKEN: 'test-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account',
    };
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of ['HIDOOK_FAKE_DEPLOY', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'PUBLIC_URL', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN']) saved[k] = process.env[k];
    Object.assign(process.env, envOverrides);
    delete process.env.HIDOOK_FAKE_DEPLOY;
    delete process.env.BRAND_DOMAIN;
    delete process.env.DEPLOY_PROVIDER;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.VERCEL_TOKEN;

    for (const rel of ['../domains.js', '../deploy-cloudflare.js', '../webpublish.js', '../registry.js', '../server.js']) {
        delete require.cache[require.resolve(rel)];
    }
    const registry = require('../registry.js');
    const domains = require('../domains.js');
    const { startServer } = require('../server.js');

    const origFetch = global.fetch;
    let server;
    try {
        server = startServer({ port: 0 });
        await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
        const base = 'http://127.0.0.1:' + server.address().port;
        process.env.PUBLIC_URL = base;

        function makeClient() {
            const jar = {};
            async function doFetch(urlPath, opts = {}) {
                const url = base + urlPath;
                const headers = { ...(opts.headers || {}) };
                const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
                if (cookieStr) headers['Cookie'] = cookieStr;
                const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
                const setCookie = res.headers.getSetCookie
                    ? res.headers.getSetCookie()
                    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
                for (const sc of setCookie) {
                    if (!sc) continue;
                    const first = sc.split(';')[0];
                    const eq = first.indexOf('=');
                    if (eq < 0) continue;
                    jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
                }
                return res;
            }
            return doFetch;
        }

        async function loginClient(email) {
            const c = makeClient();
            const loginRes = await fetch(base + '/api/auth/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            assert.equal(loginRes.status, 200);
            const loginBody = await loginRes.json();
            const token = new URL(loginBody.devLink).searchParams.get('token');
            const v = await c('/auth/verify?token=' + encodeURIComponent(token));
            assert.equal(v.status, 302);
            return c;
        }

        const email = 'suite12-2a-' + crypto.randomUUID().slice(0, 8) + '@example.com';
        const c = await loginClient(email);
        const slugHint = 'suite12-2a-' + crypto.randomUUID().slice(0, 8);
        const businessName = 'Suite12 2a Test';

        // ---- Publish (unpaid) -> test-pay complete (paid + live) ----
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId: 'product-menu', slug: slugHint, config: fullConfig(businessName), images: [] }),
        });
        assert.equal(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        const siteId = pubBody.site.id;
        const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
        assert.ok(m, 'test-pay session id in paymentUrl');
        const sessionId = m[1];

        const complete = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
        });
        assert.equal(complete.status, 200, await complete.clone().text());
        const completeBody = await complete.json();
        assert.equal(completeBody.site.paid, true);
        assert.ok(completeBody.site.url, 'live url after test-pay complete');
        // Defect #2 — before ANY custom domain exists, publicUrl must be
        // exactly the same address as url (nothing to prefer yet).
        assert.equal(completeBody.site.publicUrl, completeBody.site.url,
            'POST /api/test-pay/complete: publicUrl must equal url with no custom domain connected');
        const platformUrl = completeBody.site.url;

        // ---- GET /api/sites (dashboard list) and GET /api/sites/:id agree ----
        const list1 = await c('/api/sites');
        const listSite1 = (await list1.json()).sites.find((s) => s.id === siteId);
        assert.equal(listSite1.url, platformUrl);
        assert.equal(listSite1.publicUrl, platformUrl, 'GET /api/sites publicUrl must match the site actually reachable at');

        const one1 = await c('/api/sites/' + siteId);
        const oneSite1 = (await one1.json()).site;
        assert.equal(oneSite1.publicUrl, platformUrl, 'GET /api/sites/:id publicUrl must match too');

        // ---- Republish (edit a live site) — same address, still consistent ----
        const rep = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, templateId: 'product-menu', config: fullConfig(businessName + ' v2'), images: [] }),
        });
        assert.equal(rep.status, 200, await rep.clone().text());
        const repBody = await rep.json();
        assert.equal(repBody.site.paid, true);
        assert.equal(repBody.site.publicUrl, platformUrl,
            'republish success-modal URL (site.publicUrl) must be the SAME address as the dashboard card — defect #2\'s exact symptom');
        assert.equal(repBody.site.url, platformUrl);

        // ---- Connect + verify (DNS polling itself is out of scope here,
        // same shortcut wave7-domains-seo-origin.test.js uses) + activate a
        // custom domain for this site ----
        const fake = fakeCloudflareDomainConnect({ pagesHost: pubBody.site.slug + '.pages.dev', passthrough: origFetch });
        global.fetch = fake.fetchImpl;

        await domains.startDomainConnection({
            siteId, projectName: pubBody.site.slug, domain: 'shop.example', currentOrigin: platformUrl,
        });
        const rec = domains.getDomainForSite(siteId);
        rec.status = 'dns_verified';
        fs.writeFileSync(path.join(tmpDir, 'custom-domains.json'), JSON.stringify({ [siteId]: rec }, null, 2));
        await domains.activateDomainConnection({ siteId }); // -> provisioning
        fake.markActive('www.shop.example');
        const activeStatus = await domains.checkTlsStatus({ siteId });
        assert.equal(activeStatus.status, 'active');

        // ---- Now every surface must prefer the custom domain for DISPLAY,
        // while `url` (the platform host domain-connect/exports/calendar
        // read) stays exactly what it always was. ----
        const list2 = await c('/api/sites');
        const listSite2 = (await list2.json()).sites.find((s) => s.id === siteId);
        assert.equal(listSite2.publicUrl, 'https://www.shop.example', 'an active verified custom domain must win in publicUrl');
        assert.equal(listSite2.url, platformUrl, 'the platform address itself (url) must be untouched by connecting a custom domain');

        const rep2 = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, templateId: 'product-menu', config: fullConfig(businessName + ' v3'), images: [] }),
        });
        assert.equal(rep2.status, 200, await rep2.clone().text());
        const rep2Body = await rep2.json();
        assert.equal(rep2Body.site.publicUrl, 'https://www.shop.example',
            'a republish after connecting a custom domain must keep showing that domain in the success modal, not drift back');
        assert.equal(rep2Body.site.url, platformUrl);

        registry.getSite(siteId); // sanity: still resolvable
        console.log('PASS suite12 defect #2a: publicUrl is one consistent source of truth, url is untouched');
    } finally {
        global.fetch = origFetch;
        if (server) server.close();
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// Defect #2b — the exact production symptom: a transient, best-effort
// failure to reconfirm the brand-subdomain DNS attach on a REPUBLISH must
// never regress an already-working <slug>.<BRAND_DOMAIN> address back to
// the raw <slug>.pages.dev host.
// ---------------------------------------------------------------------------
test('defect #2b: a flaky ensureSubdomain reconfirmation on republish must not regress an established brand subdomain to pages.dev', async () => {
    const tmpDir = freshTmpDataDir('suite12-2b-');
    const saved = {};
    const envOverrides = {
        DATA_DIR: tmpDir,
        BRAND_DOMAIN: 'sites.hidook-test.example',
        DEPLOY_PROVIDER: 'cloudflare',
        CLOUDFLARE_API_TOKEN: 'test-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account',
    };
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of ['HIDOOK_FAKE_DEPLOY', 'HIDOOK_ISOLATED_DEPLOY', 'PUBLIC_URL']) saved[k] = process.env[k];
    Object.assign(process.env, envOverrides);
    delete process.env.HIDOOK_FAKE_DEPLOY;
    delete process.env.HIDOOK_ISOLATED_DEPLOY;

    const { registry, webpublish, flow } = loadFreshRegistryModules();

    const origFetch = global.fetch;
    const origDeployBuiltSite = flow.deployBuiltSite;
    const projectName = 'suite12-2b-' + crypto.randomUUID().slice(0, 8);
    // Stand-in for the real wrangler/Cloudflare Pages deploy (bot/flow.js is
    // frozen — this overrides its already-exported function reference for
    // this test only, exactly like a dependency-injection stub; flow.js's
    // OWN source is never touched). Always returns the raw pages.dev host —
    // ensureSubdomain (the real, unstubbed code) is what is meant to upgrade
    // that to the brand subdomain below.
    flow.deployBuiltSite = async () => ({ url: `https://${projectName}.pages.dev`, projectId: projectName, provider: 'cloudflare' });

    const fake = fakeCloudflareBrandSubdomain({ pagesHost: `${projectName}.pages.dev`, zoneName: 'hidook-test.example', passthrough: origFetch });
    global.fetch = fake.fetchImpl;

    try {
        const user = registry.getOrCreateUserByEmail(`suite12-2b-${crypto.randomUUID()}@ex.com`);
        const site = registry.createSite({ userId: user.id, templateId: 'product-menu', templateVersion: 1, slug: projectName, platform: 'web' });
        const config = fullConfig('Suite12 2b Test');
        const brandUrl = `https://${projectName}.${process.env.BRAND_DOMAIN}`;

        // ---- First publish: ensureSubdomain succeeds cleanly ----
        const first = await webpublish.publishSite({ site, config, images: [] });
        assert.equal(first.url, brandUrl, 'first publish must be on the brand subdomain');
        assert.equal(registry.getSite(site.id).url, brandUrl, 'registry must persist the brand subdomain');

        // ---- Republish while ensureSubdomain's reconfirmation hiccups ----
        fake.failNextProjectLookup();
        const republish = await webpublish.publishSite({ site: registry.getSite(site.id), config, images: [] });

        // This is defect #2's exact regression: pre-fix, this equalled the
        // raw pages.dev host (`https://${projectName}.pages.dev`) — what the
        // success modal showed — while an owner reloading the dashboard
        // later would see whatever ended up in the registry from THIS same
        // call. Post-fix, a transient reconfirmation hiccup on an already-
        // established brand subdomain must never surface pages.dev at all.
        assert.equal(republish.url, brandUrl,
            'a transient ensureSubdomain hiccup must not regress the success-modal URL to pages.dev');
        assert.equal(registry.getSite(site.id).url, brandUrl,
            'the registry (== the dashboard card\'s own source) must also stay on the brand subdomain');

        console.log('PASS suite12 defect #2b: an already-established brand subdomain survives a flaky reconfirmation');
    } finally {
        global.fetch = origFetch;
        flow.deployBuiltSite = origDeployBuiltSite;
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// Defect #1 — the recovery banner. Real browser (Playwright), real server,
// HIDOOK_TEST_PAY + HIDOOK_ISOLATED_DEPLOY stubs (same as
// bot/test/wave9-save-recovery-banner.test.js, which this suite extends
// rather than duplicates — that file still pins the never-published case).
// ---------------------------------------------------------------------------
test('defect #1: the recovery banner never calls a paid/live site "proiect neterminat"', async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

    const saved = {};
    const envOverrides = {
        HIDOOK_TEST_PAY: '1',
        HIDOOK_ISOLATED_DEPLOY: '1',
        NODE_ENV: 'test',
        DATA_DIR: freshTmpDataDir('suite12-1-'),
        SERVER_SECRET: 'suite12-1-' + crypto.randomBytes(8).toString('hex'),
    };
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY']) saved[k] = process.env[k];
    Object.assign(process.env, envOverrides);
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY']) delete process.env[k];

    for (const rel of ['../server.js', '../webpublish.js', '../domains.js', '../registry.js']) {
        delete require.cache[require.resolve(rel)];
    }
    require(path.join(ROOT, 'scripts/build-builder.js'));
    const { startServer } = require('../server.js');

    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

    async function acceptCookiesAndStart(page, templateId) {
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        await page.locator('#hb-cookie-accept').click().catch(() => {});
        await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(1000);
        if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
            await page.locator('#btn-close-drawer').click().catch(() => {});
            await page.waitForTimeout(300);
        }
    }

    async function editBusinessName(page, text) {
        const field = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
        await field.click({ clickCount: 3 });
        await page.keyboard.type(text, { delay: 12 });
        await page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 4000 });
  }

    /** Sign in through the dashboard entry point (same dev-magic-link flow
     * bot/test/suite3-publish-single-flight.test.js already relies on).
     * POST /api/publish requires auth, and the recovery banner's "resume-live"
     * case needs a real paid site, so every scenario below signs in once —
     * the context's session cookie then carries across every later page. */
    async function signIn(page, email) {
        await page.locator('#btn-account-menu').click();
        await page.locator('#account-menu-projects').click();
        await page.waitForURL(/#dashboard$/);
        await page.locator('#btn-dashboard-auth').click();
        await page.locator('#form-auth-email').waitFor({ state: 'visible' });
        await page.locator('#input-email').fill(email);
        await page.locator('#btn-send-magic').click();
        await page.locator('#dev-link').waitFor({ state: 'visible' });
        await page.locator('#dev-link').click();
        // A local draft already exists at this point (edited before signing
        // in) and this is a brand-new user with zero sites yet — loadDashboard()
        // resumes it straight to #edit (see builder/app.js#loadDashboard).
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(600);
        if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
            await page.locator('#btn-close-drawer').click().catch(() => {});
            await page.waitForTimeout(300);
        }
    }

    async function publishAndPayThroughUi(page) {
        await page.locator('#btn-publish').click();
        await page.locator('#modal-publish').waitFor({ state: 'visible' });
        const slug = 'suite12-1-' + crypto.randomUUID().slice(0, 8);
        await page.locator('#input-slug').fill(slug);
        await page.locator('#btn-publish-continue').click();
        await page.locator('#modal-success').waitFor({ state: 'visible' });
        // Unpaid success state: pay CTA navigates same-tab to
        // #test-checkout=... (HIDOOK_TEST_PAY stub) — completeTestCheckout()
        // then flips the site paid+live and reopens the success modal.
        await page.locator('#btn-pay-publish').click();
        // The #test-checkout=... hash is transient — handleRoute() replaces it
        // with #dashboard practically immediately after completeTestCheckout()
        // resolves, so waiting for that intermediate URL can race and miss it.
        // Wait for the final state instead.
        await page.waitForURL(/#dashboard$/, { timeout: 20000 });
        await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 15000 });
        const titleText = (await page.locator('#modal-success-title').innerText()).trim();
        assert.match(titleText, /live/i, 'must be the LIVE success modal, not the draft/pay-CTA one');
        await page.locator('#btn-close-success').click().catch(() => {});
    }

    try {
        // =====================================================================
        // A. Fresh, never-published draft — the banner SHOULD show, and must
        //    still say "proiect neterminat" (unchanged baseline behaviour).
        // =====================================================================
        const pageA1 = await context.newPage();
        pageA1.setDefaultTimeout(30000);
        await acceptCookiesAndStart(pageA1, 'portfolio');
        await editBusinessName(pageA1, 'Suite12 Neterminat');
        await pageA1.close();

        const pageA2 = await context.newPage();
        pageA2.setDefaultTimeout(30000);
        await pageA2.goto(base + '/app/', { waitUntil: 'networkidle' });
        const bannerA = pageA2.locator('#recovery-banner');
        await assert.doesNotReject(bannerA.waitFor({ state: 'visible', timeout: 4000 }),
            'a never-published draft must still be offered back');
        const textA = (await bannerA.locator('.recovery-banner-text').innerText()).trim();
        assert.match(textA, /proiect neterminat/i, 'a genuinely unfinished draft must say "proiect neterminat"');
        await pageA2.screenshot({ path: path.join(EVIDENCE, '01-unfinished-draft-banner.png') });

        // Continue editing this same draft through to a paid/live site for
        // case B below.
        await pageA2.locator('#btn-recovery-resume').click();
        await pageA2.waitForURL(/#edit$/);
        await pageA2.locator('#preview-iframe').waitFor({ state: 'visible' });
        await pageA2.waitForTimeout(800);
        if (await pageA2.locator('#details-drawer').isVisible().catch(() => false)) {
            await pageA2.locator('#btn-close-drawer').click().catch(() => {});
            await pageA2.waitForTimeout(300);
        }
        const email = 'suite12-1-' + crypto.randomUUID().slice(0, 8) + '@example.com';
        await signIn(pageA2, email);
        await publishAndPayThroughUi(pageA2);
        await pageA2.close();

        // =====================================================================
        // B. Same site, now paid + live, nothing edited since publish — the
        //    reported bug. The banner must NOT show at all.
        // =====================================================================
        const pageB = await context.newPage();
        pageB.setDefaultTimeout(30000);
        await pageB.goto(base + '/app/', { waitUntil: 'networkidle' });
        await pageB.waitForTimeout(600);
        assert.equal(await pageB.locator('#recovery-banner').isVisible(), false,
            'defect #1: a paid/live site with nothing edited since publish must never show "proiect neterminat"');
        await pageB.screenshot({ path: path.join(EVIDENCE, '02-paid-live-no-banner.png') });

        // =====================================================================
        // C. Resume editing that SAME live site, make a real change, leave
        //    without republishing — honest to offer it back, dishonest to
        //    call it "neterminat". Must name the site.
        // =====================================================================
        await pageB.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
        await pageB.waitForTimeout(400);
        const editBtn = pageB.locator('.site-card button:has-text("Editează")').first();
        await editBtn.waitFor({ state: 'visible', timeout: 10000 });
        await editBtn.click();
        await pageB.waitForURL(/#edit$/);
        await pageB.locator('#preview-iframe').waitFor({ state: 'visible' });
        await pageB.waitForTimeout(800);
        if (await pageB.locator('#details-drawer').isVisible().catch(() => false)) {
            await pageB.locator('#btn-close-drawer').click().catch(() => {});
            await pageB.waitForTimeout(300);
        }
        await editBusinessName(pageB, 'Suite12 Live Editat Din Nou');
        await pageB.close();

        const pageC = await context.newPage();
        pageC.setDefaultTimeout(30000);
        await pageC.goto(base + '/app/', { waitUntil: 'networkidle' });
        const bannerC = pageC.locator('#recovery-banner');
        await assert.doesNotReject(bannerC.waitFor({ state: 'visible', timeout: 4000 }),
            'defect #1: genuine unpublished edits on a live site must still be offered back');
        const textC = (await bannerC.locator('.recovery-banner-text').innerText()).trim();
        assert.doesNotMatch(textC, /proiect neterminat/i, 'a paid/live site\'s unsaved edits must never be called "proiect neterminat"');
        assert.match(textC, /modificări nesalvate/i, 'must honestly say these are unsaved changes');
        assert.match(textC, /Suite12 Live Editat Din Nou|Suite12 Neterminat/, 'must name the site, not a generic label');
        await pageC.screenshot({ path: path.join(EVIDENCE, '03-live-site-unsaved-edits-banner.png') });

        // =====================================================================
        // D. "Renunță" on the live-site case must dismiss the banner but
        //    NEVER delete anything — the local draft (siteId/paid bind) must
        //    survive so the owner can still reach/republish their site.
        // =====================================================================
        await pageC.locator('#btn-recovery-discard').click();
        assert.equal(await pageC.locator('#recovery-banner').isVisible(), false, 'Renunță must dismiss the banner');
        const draftAfterDiscard = await pageC.evaluate(() => {
            try { return JSON.parse(localStorage.getItem('hb.draft.v1') || 'null'); } catch (_) { return null; }
        });
        assert.ok(draftAfterDiscard, 'Renunță on a paid site\'s unsaved edits must NOT delete the local draft');
        assert.ok(draftAfterDiscard.siteId, 'the paid site\'s bind (siteId) must survive Renunță');
        assert.equal(draftAfterDiscard.paid, true, 'the paid flag must survive Renunță');
        await pageC.screenshot({ path: path.join(EVIDENCE, '04-renunta-live-site-preserves-draft.png') });
        await pageC.close();

        // =====================================================================
        // E. Multiple sites in the account: a second, untouched paid/live
        //    site must not confuse the picture — dashboard still shows both
        //    correctly and no bogus banner appears for the account as a whole
        //    once the (still-legitimate, case C's) offer is cleared this
        //    session.
        // =====================================================================
        const pageE1 = await context.newPage();
        pageE1.setDefaultTimeout(30000);
        await acceptCookiesAndStart(pageE1, 'local-service');
        await editBusinessName(pageE1, 'Suite12 Al Doilea Site');
        await publishAndPayThroughUi(pageE1);
        await pageE1.waitForURL(/#dashboard$/).catch(async () => { await pageE1.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' }); });
        await pageE1.waitForTimeout(600);
        const cards = pageE1.locator('.site-card');
        assert.ok(await cards.count() >= 2, 'dashboard must list both paid/live sites');
        await pageE1.screenshot({ path: path.join(EVIDENCE, '05-multiple-sites-dashboard.png') });
        await pageE1.close();

        console.log('PASS suite12 defect #1: the recovery banner tells a genuinely unfinished draft apart from a paid/live site, in every case');
    } finally {
        await browser.close().catch(() => {});
        server.close();
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
});

// ---------------------------------------------------------------------------
// Defect #3 — deleting a site must not let an orphaned local draft silently
// recreate it. Real browser (Playwright), real server, same stubs as
// defect #1's test above.
// ---------------------------------------------------------------------------
test('defect #3: deleting a site retires its local draft — no ghost unpaid site reappears with the same name', async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

    const saved = {};
    const envOverrides = {
        HIDOOK_TEST_PAY: '1',
        HIDOOK_ISOLATED_DEPLOY: '1',
        NODE_ENV: 'test',
        DATA_DIR: freshTmpDataDir('suite12-3-'),
        SERVER_SECRET: 'suite12-3-' + crypto.randomBytes(8).toString('hex'),
    };
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY']) saved[k] = process.env[k];
    Object.assign(process.env, envOverrides);
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY']) delete process.env[k];

    for (const rel of ['../server.js', '../webpublish.js', '../domains.js', '../registry.js']) {
        delete require.cache[require.resolve(rel)];
    }
    require(path.join(ROOT, 'scripts/build-builder.js'));
    const { startServer } = require('../server.js');

    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

    try {
        const page = await context.newPage();
        page.setDefaultTimeout(30000);

        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        await page.locator('#hb-cookie-accept').click().catch(() => {});
        await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(1000);
        if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
            await page.locator('#btn-close-drawer').click().catch(() => {});
            await page.waitForTimeout(300);
        }
        const nameField = () => page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
        await nameField().click({ clickCount: 3 });
        await page.keyboard.type('Suite12 Delete Ghost', { delay: 12 });
        await page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 4000 });

        // Sign in (dev magic link) — same flow as defect #1's signIn() above.
        await page.locator('#btn-account-menu').click();
        await page.locator('#account-menu-projects').click();
        await page.waitForURL(/#dashboard$/);
        await page.locator('#btn-dashboard-auth').click();
        await page.locator('#form-auth-email').waitFor({ state: 'visible' });
        const email = 'suite12-3-' + crypto.randomUUID().slice(0, 8) + '@example.com';
        await page.locator('#input-email').fill(email);
        await page.locator('#btn-send-magic').click();
        await page.locator('#dev-link').waitFor({ state: 'visible' });
        await page.locator('#dev-link').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(800);
        if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
            await page.locator('#btn-close-drawer').click().catch(() => {});
            await page.waitForTimeout(300);
        }

        // One more edit now that we are signed in — this is what arms
        // scheduleServerAutosave() (settleAfterLocalSave() only schedules it
        // once currentUser is set) and is what creates the server-side
        // UNPAID site via POST /api/draft in the first place.
        await nameField().click({ clickCount: 3 });
        await page.keyboard.type('Suite12 Delete Ghost v2', { delay: 12 });
        await page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);

        const beforeSites = await page.evaluate(async () => (await fetch('/api/sites', { credentials: 'include' })).json());
        assert.equal(beforeSites.sites.length, 1, 'the autosave must have created exactly one unpaid draft site');
        const originalId = beforeSites.sites[0].id;

        await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        const deleteBtn = page.locator('.site-card button:has-text("Șterge")').first();
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();
        await page.locator('#modal-delete-site').waitFor({ state: 'visible' });
        const expectedName = (await page.locator('#delete-site-name').innerText()).trim();
        await page.locator('#input-delete-confirm').fill(expectedName);
        await page.waitForTimeout(150);
        await page.locator('#btn-confirm-delete-site').click();
        await page.locator('#modal-delete-site').waitFor({ state: 'hidden', timeout: 10000 });
        await page.screenshot({ path: path.join(EVIDENCE, '06-delete-confirmed.png') });

        // Give any debounced server autosave (1.2s + margin) a chance to fire
        // — this is exactly the window the bug lived in.
        await page.waitForTimeout(3000);

        // Reload the dashboard fresh, the way the owner would on their next visit.
        await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
        await page.waitForTimeout(800);

        const cardCount = await page.locator('.site-card').count();
        await page.screenshot({ path: path.join(EVIDENCE, '07-after-delete-no-ghost.png') });
        assert.equal(cardCount, 0, 'defect #3: no ghost site must reappear after a confirmed delete');

        const afterSites = await page.evaluate(async () => (await fetch('/api/sites', { credentials: 'include' })).json());
        assert.equal(afterSites.sites.length, 0, 'GET /api/sites must be empty — the delete must not have been silently undone');
        assert.ok(
            !afterSites.sites.some((s) => s.projectName === beforeSites.sites[0].projectName || s.slug === beforeSites.sites[0].slug),
            'no site with the deleted project\'s name/slug must have been recreated'
        );

        // The deleted site's own address must actually be gone, not just
        // absent from the list (confirms this was a real delete, not a
        // filtered view).
        const liveCheck = await fetch(base + '/live/' + beforeSites.sites[0].slug + '/', { redirect: 'manual' });
        assert.equal(liveCheck.status, 404, 'the deleted site\'s own address must 404, confirming this was a genuine delete');
        void originalId;

        console.log('PASS suite12 defect #3: deleting a site retires its local draft — no ghost reappears');
    } finally {
        await browser.close().catch(() => {});
        server.close();
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
});
