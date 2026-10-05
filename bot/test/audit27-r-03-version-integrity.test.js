'use strict';
/**
 * bot/test/audit27-r-03-version-integrity.test.js
 *
 * Audit 2026-09-27, task R-03 (Site version integrity). Three independent
 * bugs, all rooted in the same registry surface (bot/server.js,
 * bot/registry-sqlite.js, bot/registry-json.js), verified-confirmed in
 * 04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json:
 *
 * 1. instafidget-social#1 / calendar-native#3 — handleGetSite() read
 *    versions[0], but listVersions() is chronological push order (oldest
 *    first) in BOTH registry backends, so re-editing a site that had been
 *    republished even once silently reloaded the FIRST-ever-published
 *    config, discarding every change made since (including a connected
 *    Instagram feed). Fixed: versions[versions.length - 1] (same pattern
 *    latestSiteConfig() already used).
 *
 * 2. editor-text-images#2 — POST /api/publish's `if (siteId)` branch (the
 *    ordinary case once autosave has already created the site, which it
 *    always has by the time the owner reaches the address picker) never
 *    read `body.slug` at all, so an address explicitly chosen and validated
 *    in the publish modal was silently dropped in favor of the
 *    autosave-derived slug. Fixed: same slug validation as a brand-new
 *    site, only acting when the owner asked for a different address.
 *
 * 3. data-integrity#2 — draft autosaves (POST /api/draft) inserted into the
 *    same `versions` FIFO (MAX_VERSIONS=10 rows per site) as a real
 *    Publică, with no column telling them apart, so a handful of ordinary
 *    edits after a real publish could evict that publish's own version row.
 *    Fixed: versions.published distinguishes a real publish
 *    (bot/webpublish.js#publishSite passes {published:true}) from an
 *    autosave (default), and the FIFO cap evicts unpublished rows first.
 *
 * Pure HTTP-level against a real isolated server (own DATA_DIR, own
 * SERVER_SECRET, HIDOOK_TEST_PAY offline checkout) — no browser needed, all
 * three symptoms are visible at the API layer. Same startServer/magic-link
 * pattern as bot/test/suite12-publish-lifecycle.test.js.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-03-version-integrity.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function freshTmpDataDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fullConfig(name) {
    return {
        business: { name, title: `${name} | Test`, metaDescription: `${name} — descriere de test.`, lang: 'ro' },
        hero: { background: "url('images/cn-hero.jpg')", ctaLabel: 'Sună acum' },
        contact: { phone: '+40721234567' },
        footer: { address: 'Strada Test 1, București' },
    };
}

/** Boots an isolated server on a random port and returns {server, base, stop}. */
async function bootIsolatedServer() {
    const tmpDir = freshTmpDataDir('audit27-r03-');
    const envOverrides = {
        DATA_DIR: tmpDir,
        HIDOOK_TEST_PAY: '1',
        HIDOOK_ISOLATED_DEPLOY: '1',
        NODE_ENV: 'test',
        SERVER_SECRET: 'audit27-r03-' + crypto.randomBytes(8).toString('hex'),
    };
    const saved = {};
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of ['HIDOOK_FAKE_DEPLOY', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN', 'PUBLIC_URL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
        saved[k] = process.env[k];
    }
    Object.assign(process.env, envOverrides);
    delete process.env.HIDOOK_FAKE_DEPLOY;
    delete process.env.BRAND_DOMAIN;
    delete process.env.DEPLOY_PROVIDER;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.VERCEL_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;

    for (const rel of ['../domains.js', '../deploy-cloudflare.js', '../webpublish.js', '../registry.js', '../server.js']) {
        delete require.cache[require.resolve(rel)];
    }
    const { startServer } = require('../server.js');

    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;
    process.env.PUBLIC_URL = base;

    function restoreEnv() {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
    }

    return {
        base,
        stop: () => new Promise((resolve) => server.close(() => { restoreEnv(); resolve(); })),
    };
}

function makeClient(base) {
    const jar = {};
    return async function doFetch(urlPath, opts = {}) {
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
    };
}

async function loginClient(base, email) {
    const c = makeClient(base);
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

// ---------------------------------------------------------------------------
// 1. instafidget-social#1 / calendar-native#3 — GET /api/sites/:id must
//    return the LATEST version, not the oldest, after multiple republishes.
// ---------------------------------------------------------------------------
test('R-03: GET /api/sites/:id returns the latest version after repeated republishes, not the first-ever-published one', async () => {
    const { base, stop } = await bootIsolatedServer();
    try {
        const email = 'audit27-r03-a-' + crypto.randomUUID().slice(0, 8) + '@example.com';
        const c = await loginClient(base, email);

        // First publish (unpaid -> checkout) with marker V1.
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId: 'product-menu', config: fullConfig('V1-MARKER'), images: [] }),
        });
        assert.equal(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        const siteId = pubBody.site.id;
        const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
        assert.ok(m, 'test-pay session id in paymentUrl');

        const complete = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: m[1] }),
        });
        assert.equal(complete.status, 200, await complete.clone().text());
        assert.equal((await complete.json()).site.paid, true);

        // Republish (direct, already entitled) with marker V2.
        const rep2 = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, templateId: 'product-menu', config: fullConfig('V2-MARKER'), images: [] }),
        });
        assert.equal(rep2.status, 200, await rep2.clone().text());

        // Republish again with marker V3 — this is the config a re-edit
        // MUST come back with.
        const rep3 = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, templateId: 'product-menu', config: fullConfig('V3-MARKER'), images: [] }),
        });
        assert.equal(rep3.status, 200, await rep3.clone().text());

        // Re-edit: open the site in the editor (GET /api/sites/:id) — must
        // load V3, the latest, not V1, the first-ever-published version.
        const got = await c('/api/sites/' + siteId);
        assert.equal(got.status, 200, await got.clone().text());
        const gotBody = await got.json();
        assert.equal(
            gotBody.config.business.name,
            'V3-MARKER',
            'GET /api/sites/:id must return the LATEST version for re-edit, not versions[0] (the oldest)'
        );
    } finally {
        await stop();
    }
});

// ---------------------------------------------------------------------------
// 2. editor-text-images#2 — an explicit slug chosen in the publish modal
//    must be honored even though autosave already created the site (and
//    its own, different, slug) beforehand.
// ---------------------------------------------------------------------------
test('R-03: an explicit slug chosen at publish time is honored even when autosave already created the site', async () => {
    const { base, stop } = await bootIsolatedServer();
    try {
        const email = 'audit27-r03-b-' + crypto.randomUUID().slice(0, 8) + '@example.com';
        const c = await loginClient(base, email);

        // Autosave (POST /api/draft) creates the site FIRST, with a slug
        // derived from the business name — exactly what happens in the
        // real app before the owner ever opens the address picker.
        const draft = await c('/api/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId: 'product-menu', config: fullConfig('Casa Nord') }),
        });
        assert.equal(draft.status, 200, await draft.clone().text());
        const draftBody = await draft.json();
        const siteId = draftBody.site.id;
        const autosaveSlug = draftBody.site.slug;
        assert.ok(autosaveSlug, 'autosave created a slug for the site');

        // Owner now opens the address picker and explicitly chooses a
        // DIFFERENT slug, then hits Publică — with the SAME siteId autosave
        // already reserved.
        const chosenSlug = 'r03-chosen-' + crypto.randomUUID().slice(0, 8);
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, templateId: 'product-menu', slug: chosenSlug, config: fullConfig('Casa Nord'), images: [] }),
        });
        assert.equal(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        assert.equal(
            pubBody.site.slug,
            chosenSlug,
            'the address explicitly chosen and validated in the publish modal must win, not the autosave-derived slug'
        );
        assert.notEqual(pubBody.site.slug, autosaveSlug);

        // Complete the (test) payment and confirm the LIVE url uses the
        // chosen slug, not the autosave one.
        const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
        assert.ok(m, 'test-pay session id in paymentUrl');
        const complete = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: m[1] }),
        });
        assert.equal(complete.status, 200, await complete.clone().text());
        const completeBody = await complete.json();
        assert.equal(completeBody.site.paid, true);
        assert.match(completeBody.site.url, new RegExp('/live/' + chosenSlug + '/?$'),
            'the live URL must be the address the owner actually picked');
    } finally {
        await stop();
    }
});

// ---------------------------------------------------------------------------
// 3. data-integrity#2 — a burst of ordinary draft autosaves after a real
//    publish must not evict that publish's own version from the FIFO cap.
// ---------------------------------------------------------------------------
test('R-03: draft autosave churn does not evict a real publish from the MAX_VERSIONS FIFO cap', async () => {
    const { base, stop } = await bootIsolatedServer();
    try {
        const email = 'audit27-r03-c-' + crypto.randomUUID().slice(0, 8) + '@example.com';
        const c = await loginClient(base, email);

        // A real publish, paid and live.
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId: 'product-menu', config: fullConfig('REAL-PUBLISH'), images: [] }),
        });
        assert.equal(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        const siteId = pubBody.site.id;
        const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
        assert.ok(m, 'test-pay session id in paymentUrl');
        const complete = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: m[1] }),
        });
        assert.equal(complete.status, 200, await complete.clone().text());
        assert.equal((await complete.json()).site.paid, true);

        // Capture the version the real publish just wrote.
        const versionsAfterPublish = await (await c('/api/sites/' + siteId + '/versions')).json();
        const publishedVersionIds = new Set(versionsAfterPublish.versions.map((v) => v.versionId));
        assert.ok(publishedVersionIds.size >= 1, 'at least one version exists right after the real publish');

        // 15 ordinary draft autosaves — no further real Publică — same
        // single active editing session, well past MAX_VERSIONS (10).
        for (let i = 1; i <= 15; i++) {
            const auto = await c('/api/draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId, templateId: 'product-menu', config: fullConfig('CHURN-' + i) }),
            });
            assert.equal(auto.status, 200, await auto.clone().text());
        }

        // W-7: GET .../versions now lists only real publishes (autosave rows
        // stay stored but are not listed), so the FIFO cap is checked on the
        // registry itself — the server and this file share one module instance.
        const registry = require('../registry.js');
        assert.equal(registry.listVersions(siteId).length, 10, 'FIFO cap still holds at MAX_VERSIONS');

        const versionsAfterChurn = await (await c('/api/sites/' + siteId + '/versions')).json();
        assert.ok(versionsAfterChurn.versions.length >= 1, 'the real publish is still listed');

        const survivingIds = new Set(versionsAfterChurn.versions.map((v) => v.versionId));
        const anyPublishSurvived = [...publishedVersionIds].some((id) => survivingIds.has(id));
        assert.ok(
            anyPublishSurvived,
            'the real publish\'s own version must survive 15 ordinary autosaves, not be evicted by autosave churn'
        );

        // And re-editing the site must still show the real publish's
        // content — not one of the churned drafts overwriting it, and not
        // a stale first version either (ties findings #1 and #3 together).
        const got = await (await c('/api/sites/' + siteId)).json();
        assert.equal(got.config.business.name, 'CHURN-15', 'GET /api/sites/:id still returns the latest saved config');
    } finally {
        await stop();
    }
});
