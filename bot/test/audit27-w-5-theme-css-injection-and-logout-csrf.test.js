'use strict';
/**
 * W-5 oracle (VERIFICARE-2026-10-04, SEC-R1 / SEC-R2).
 *
 * SEC-R2: theme.* colours were interpolated raw into a <style> custom property
 *   and into inline <script> string literals on all five templates. A value
 *   such as `red;}body{display:none}` broke out of the declaration. Only a
 *   #rgb / #rrggbb hex may render; anything else becomes the template default.
 *   Checked at: render time (server + in-browser preview engine), save-draft,
 *   publish, and the /live page of a site whose stored config is already bad.
 *
 * SEC-R1: POST /api/auth/logout skipped the Origin/Referer check every other
 *   state-changing route has, so a cross-site form could force a logout.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w-5-theme-css-injection-and-logout-csrf.test.js
 */
const test   = require('node:test');
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');
const http   = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w5-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'audit27-w5-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.NODE_ENV;

const registry  = require('../registry.js');
const auth      = require('../auth.js');
const pricing   = require('../pricing.js');
const webpublish = require('../webpublish.js');
const { onStripeEvent } = require('../web.js');
const { startServer } = require('../server.js');
const { renderHtml }  = require('../../build.js');

const TEMPLATES = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];
const PAYLOADS = [
    'red;}body{display:none}',
    '#c0392b\n;alert(1);//',
    '#fff;}</style><script>alert(1)</script>',
    'url(javascript:alert(1))',
    '`${alert(1)}`',
    'rgb(1,2,3)',
    '#12',
    '#12345g',
];

function presetConfig(templateId) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')).presets[0];
    return JSON.parse(JSON.stringify(p.config));
}
function templateHtml(templateId) {
    return fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
}
function withTheme(templateId, payload) {
    const cfg = presetConfig(templateId);
    cfg.theme = { primary: payload, primaryLight: payload, primaryDark: payload, cream: payload, evil: payload };
    return cfg;
}
/** Everything the payload could leave behind if it reached the page raw. */
function assertNoInjection(html, payload, label) {
    if (/[;{}`<]/.test(payload)) {
        assert.ok(!html.includes(payload.trim()), `${label}: raw payload ${JSON.stringify(payload)} reached the page`);
    }
    assert.ok(!html.includes('red;}body'), `${label}: injected rule present`);
    assert.ok(!html.includes('alert(1)'), `${label}: injected script present`);
}
function customProp(html, name) {
    const m = new RegExp('--' + name + '\\s*:\\s*([^;]*);').exec(html);
    return m ? m[1].trim() : null;
}

function rawRequest(base, method, urlPath, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(base + urlPath);
        const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
            let body = '';
            res.on('data', d => { body += d; });
            res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        });
        req.on('error', reject);
        req.end();
    });
}

test('render: every non-hex theme value falls back, on all five templates (server render path)', () => {
    for (const tpl of TEMPLATES) {
        const html0 = renderHtml(templateHtml(tpl), presetConfig(tpl));
        const legit = customProp(html0, 'color-primary');
        assert.ok(/^#[0-9a-f]{3,6}$/i.test(legit), `${tpl}: baseline primary should be hex, got ${legit}`);
        for (const payload of PAYLOADS) {
            const html = renderHtml(templateHtml(tpl), withTheme(tpl, payload));
            assertNoInjection(html, payload, `${tpl} ${JSON.stringify(payload)}`);
            const primary = customProp(html, 'color-primary');
            assert.ok(/^#[0-9a-f]{3,6}$/i.test(primary), `${tpl}: --color-primary must be a hex, got ${primary}`);
            const cream = customProp(html, 'color-cream');
            if (cream !== null) assert.ok(/^#[0-9a-f]{3,6}$/i.test(cream), `${tpl}: --color-cream must be a hex, got ${cream}`);
        }
    }
});

test('render: valid hex (#rgb, #rrggbb, any case) is kept as written', () => {
    for (const tpl of TEMPLATES) {
        const cfg = presetConfig(tpl);
        cfg.theme = Object.assign({}, cfg.theme, { primary: '#AbC', primaryLight: '#1A2B3C', primaryDark: ' #0a0a0a ', cream: '#FFF' });
        const html = renderHtml(templateHtml(tpl), cfg);
        assert.strictEqual(customProp(html, 'color-primary'), '#AbC', tpl);
        assert.strictEqual(customProp(html, 'color-primary-light'), '#1A2B3C', tpl);
        assert.strictEqual(customProp(html, 'color-primary-dark'), '#0a0a0a', tpl);
        assert.strictEqual(customProp(html, 'color-cream'), '#FFF', tpl);
    }
});

test('render: the in-browser preview engine sanitizes theme too', () => {
    const engineSrc = path.join(ROOT, 'builder', 'generated', 'engine.js');
    assert.ok(fs.existsSync(engineSrc), 'run npm run build:app first');
    const sandbox = { window: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(engineSrc, 'utf8'), sandbox);
    const engine = sandbox.window.HidookEngine;
    for (const tpl of TEMPLATES) {
        const html = engine.renderHtml(templateHtml(tpl), withTheme(tpl, PAYLOADS[0]));
        assertNoInjection(html, PAYLOADS[0], `preview ${tpl}`);
        assert.ok(/^#[0-9a-f]{3,6}$/i.test(customProp(html, 'color-primary')), `preview ${tpl}`);
    }
});

test('server: sign-in, save-draft, publish, logout', async (t) => {
    const srv = startServer({ port: 0, onStripeEvent });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    process.env.PUBLIC_URL = base;
    t.after(() => new Promise((r) => srv.close(r)));

    await t.test('save-draft stores the template default instead of a non-hex theme', async () => {
        const user = registry.getOrCreateUserByEmail('w5-draft@test.com');
        const cookie = `hb_session=${auth.signSession(user.id)}`;
        const cfg = withTheme('product-menu', PAYLOADS[0]);
        const res = await fetch(`${base}/api/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ templateId: 'product-menu', config: cfg }),
        });
        assert.strictEqual(res.status, 200, await res.clone().text());
        const { site } = await res.json();
        const versions = registry.listVersions(site.id);
        const stored = registry.getVersionConfig(site.id, versions[versions.length - 1].versionId);
        const def = presetConfig('product-menu').theme;
        assert.strictEqual(stored.theme.primary, def.primary);
        assert.strictEqual(stored.theme.cream, def.cream);
        assert.ok(!('evil' in stored.theme), 'unknown non-hex theme key dropped');
        assert.ok(!JSON.stringify(stored.theme).includes('display:none'));
    });

    await t.test('publish stores the template default instead of a non-hex theme', async () => {
        const user = registry.getOrCreateUserByEmail('w5-publish@test.com');
        const cookie = `hb_session=${auth.signSession(user.id)}`;
        const cfg = withTheme('local-service', PAYLOADS[1]);
        const res = await fetch(`${base}/api/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ templateId: 'local-service', config: cfg, images: [] }),
        });
        assert.ok(res.status < 500, 'publish status ' + res.status + ' ' + (await res.clone().text()).slice(0, 200));
        const sites = registry.listSites(user.id);
        assert.ok(sites.length >= 1, 'a site row exists');
        const versions = registry.listVersions(sites[0].id);
        assert.ok(versions.length >= 1, 'a version was stored');
        const stored = registry.getVersionConfig(sites[0].id, versions[versions.length - 1].versionId);
        assert.strictEqual(stored.theme.primary, presetConfig('local-service').theme.primary);
    });

    await t.test('/live of a site whose stored config already carries a bad theme renders the template default', async () => {
        const user = registry.getOrCreateUserByEmail('w5-live@test.com');
        const site = registry.createSite({
            userId: user.id, templateId: 'product-menu', templateVersion: 1,
            slug: 'w5-live-' + crypto.randomUUID().slice(0, 8), platform: 'web',
        });
        const sessionId = 'cs_test_w5_' + crypto.randomBytes(6).toString('hex');
        const order = registry.createOrder({
            siteId: site.id, userId: user.id, amountCents: pricing.PRICE_CENTS,
            currency: 'eur', stripeSessionId: sessionId, kind: 'publish',
        });
        const config = withTheme('product-menu', PAYLOADS[0]);
        registry.saveVersion(site.id, config);
        webpublish.savePendingDraft(order.id, { config, images: [], siteId: site.id, savedAt: new Date().toISOString() });
        await onStripeEvent({
            id: 'evt_w5_' + crypto.randomUUID().slice(0, 10),
            type: 'checkout.session.completed',
            data: { object: {
                id: sessionId, payment_status: 'no_payment_required',
                customer: 'cus_test_w5', subscription: 'sub_test_w5_' + crypto.randomBytes(4).toString('hex'),
                metadata: {
                    platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id,
                    billing_contract: 'first_then_renewal',
                    first_period_cents: String(pricing.PRICE_CENTS), renewal_cents: String(pricing.RENEWAL_CENTS),
                },
            } },
        });
        const live = registry.getSite(site.id);
        const res = await fetch(`${base}/live/${live.slug}/`, { redirect: 'manual' });
        assert.strictEqual(res.status, 200);
        const html = await res.text();
        assertNoInjection(html, PAYLOADS[0], '/live');
        assert.strictEqual(customProp(html, 'color-primary'), presetConfig('product-menu').theme.primary);
    });

    await t.test('cross-origin POST /api/auth/logout -> 403 and the session survives', async () => {
        const user = registry.getOrCreateUserByEmail('w5-csrf@test.com');
        const sess = auth.signSession(user.id);
        const headers = { Cookie: `hb_session=${sess}`, Origin: 'https://evil.example', 'Content-Length': '0' };
        const r1 = await rawRequest(base, 'POST', '/api/auth/logout', headers);
        assert.strictEqual(r1.status, 403, r1.body);
        const r2 = await rawRequest(base, 'POST', '/api/auth/logout', {
            Cookie: `hb_session=${sess}`, Referer: 'https://evil.example/attack.html', 'Content-Length': '0',
        });
        assert.strictEqual(r2.status, 403, r2.body);
        assert.ok(!/hb_session=;|Max-Age=0/i.test(String(r1.headers['set-cookie'] || '')), 'no cookie-clearing on rejected request');
        const me = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${sess}` } });
        assert.strictEqual(me.status, 200, 'session must still be valid');
        assert.ok((await me.json()).user, 'still signed in');
    });

    await t.test('same-origin POST /api/auth/logout still works (and cookie-less / header-less callers too)', async () => {
        const user = registry.getOrCreateUserByEmail('w5-logout@test.com');
        const sess = auth.signSession(user.id);
        const ok = await rawRequest(base, 'POST', '/api/auth/logout', {
            Cookie: `hb_session=${sess}`, Origin: base, 'Content-Length': '0',
        });
        assert.strictEqual(ok.status, 200, ok.body);
        assert.ok(/Max-Age=0/i.test(String(ok.headers['set-cookie'] || '')));
        const me = await fetch(`${base}/api/me`, { headers: { Cookie: `hb_session=${sess}` } });
        assert.strictEqual(me.status, 401, 'session revoked after same-origin logout');
        const anon = await rawRequest(base, 'POST', '/api/auth/logout', { 'Content-Length': '0' });
        assert.strictEqual(anon.status, 200, 'logout without cookie stays a harmless 200');
    });
});
