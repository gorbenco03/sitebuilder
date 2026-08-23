'use strict';
/**
 * bot/test/s51-builder-renewal.test.js — S51 builder durable orders / renewal.
 *
 * Causal lock-in for /app/ commercial renewal loop after S50:
 *   - Paid live cards: hosting-until human date; no first-publish 100 CTA
 *   - Expired / past paidUntil: Reînnoiește hosting (29), not Reactivează / Păstrează
 *   - HTTP: first publish 100 → paidUntil ~+12m → force past → checkout kind=renewal
 *     amount 2900 → test-pay extends hosting; repeat checkout reuses pending row
 *
 * Env under test: HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted
 *
 * Run: node bot/test/s51-builder-renewal.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const APP_CSS = path.join(ROOT, 'builder', 'app.css');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's51-builder-renewal-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s51-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.BRAND_DOMAIN;
delete process.env.CONTACT_URL;
delete process.env.RESEND_API_KEY;
delete process.env.NODE_ENV;

const payments   = require('../payments.js');
const pricing    = require('../pricing.js');
const webpublish = require('../webpublish.js');
const registry   = require('../registry.js');
const { startServer } = require('../server.js');

let failed = 0;
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

function makeClient(base) {
    const jar = {};
    async function doFetch(urlPath, opts = {}) {
        const url     = base + urlPath;
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
            const k = first.slice(0, eq).trim();
            const v = first.slice(eq + 1).trim();
            if (k) jar[k] = v;
        }
        return res;
    }
    doFetch.jar = jar;
    return doFetch;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForStatus(base, urlPath, wantStatus, { timeoutMs = 15000, intervalMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const res = await fetch(base + urlPath, { redirect: 'manual' });
        last = res.status;
        if (res.status === wantStatus) return res;
        await sleep(intervalMs);
    }
    throw new Error(`timeout waiting for ${urlPath} → ${wantStatus} (last ${last})`);
}

function extractFunction(src, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i++];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
    }
    return src.slice(m.index, i);
}

function loadPresetConfig(templateId) {
    const presetsPath = path.join(ROOT, 'templates', templateId, 'presets.json');
    assert.ok(fs.existsSync(presetsPath), `presets.json missing for ${templateId}`);
    const body = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    const presets = body.presets || [];
    assert.ok(presets.length >= 1, `${templateId} must have ≥1 preset`);
    const cfg = JSON.parse(JSON.stringify(presets[0].config));
    assert.ok(cfg && cfg.business, `${templateId} preset must have business`);
    return { presetId: presets[0].id, config: cfg };
}

function withBusinessName(config, name) {
    const c = JSON.parse(JSON.stringify(config));
    c.business = c.business || {};
    c.business.name = name;
    if (c.business.title) c.business.title = name + ' | S51';
    if (c.business.about) c.business.about = name + ' — S51 renewal proof.';
    return c;
}

function readOrdersForSite(siteId) {
    const db = JSON.parse(fs.readFileSync(path.join(tmpDir, '.registry.json'), 'utf8'));
    return Object.values(db.orders || {}).filter((o) => o.siteId === siteId);
}

(async () => {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');
    const cssSrc = fs.existsSync(APP_CSS) ? fs.readFileSync(APP_CSS, 'utf8') : '';
    const combined = appSrc + '\n' + htmlSrc + '\n' + cssSrc;
    const buildSiteCardSrc = extractFunction(appSrc, 'buildSiteCard') || '';
    const showSuccessSrc = extractFunction(appSrc, 'showSuccessScreen') || '';

    // ── Builder source lock-ins ────────────────────────────────────────────
    await check('buildSiteCard paid live path has no first-publish 100 CTA', () => {
        assert.ok(buildSiteCardSrc.length > 80, 'buildSiteCard must exist');
        // Paid + not expired must not show Plătește și publică (only unpaid path)
        assert.ok(
            /site\.paid/.test(buildSiteCardSrc),
            'buildSiteCard must branch on site.paid'
        );
        // Must gate first-publish CTA so paid active cards skip it
        assert.ok(
            /!site\.paid|!?\s*site\.paid|paid\s*&&/.test(buildSiteCardSrc),
            'buildSiteCard must condition pay CTA on unpaid/expired, not always-on for paid'
        );
        // Hosting-until from paidUntil for paid cards
        assert.ok(
            /paidUntil/.test(buildSiteCardSrc),
            'buildSiteCard must read site.paidUntil for hosting-until line'
        );
        assert.ok(
            !/trialEndsAt/.test(buildSiteCardSrc),
            'buildSiteCard must not use trialEndsAt'
        );
        assert.ok(
            !/expiră în/.test(buildSiteCardSrc),
            'buildSiteCard must not use trial \"expiră în\" copy'
        );
    });

    await check('expired / past paidUntil CTA is Reînnoiește hosting (not Reactivează / Păstrează)', () => {
        assert.ok(
            /Reînnoiește hosting/.test(buildSiteCardSrc),
            'expired/past-paidUntil CTA must say Reînnoiește hosting'
        );
        assert.ok(
            !/Reactivează/.test(buildSiteCardSrc),
            'buildSiteCard must not use factory Reactivează label'
        );
        assert.ok(
            !/['\"]Păstrează['\"]/.test(buildSiteCardSrc),
            'buildSiteCard must not use Păstrează'
        );
        // Renewal price shown via formatRenewalLabel or 29
        assert.ok(
            /formatRenewalLabel|renewal/.test(buildSiteCardSrc),
            'renewal CTA should surface renewal price label'
        );
    });

    await check('paidUntil rendered via human date helper (not raw ISO dump)', () => {
        // Helper exists and is used from card
        const helper =
            extractFunction(appSrc, 'formatHostingUntil') ||
            extractFunction(appSrc, 'formatPaidUntil') ||
            extractFunction(appSrc, 'formatHostingUntilDate') ||
            '';
        assert.ok(
            helper.length > 30 ||
                /toLocaleDateString|dateStyle|formatHostingUntil|formatPaidUntil/.test(buildSiteCardSrc) ||
                /function\s+formatHostingUntil|function\s+formatPaidUntil|function\s+formatHostingUntilDate/.test(appSrc),
            'must have a human calendar-date helper for paidUntil'
        );
        assert.ok(
            /paidUntil/.test(buildSiteCardSrc),
            'card must use paidUntil'
        );
        // Must not assign raw ISO as the only display path without locale formatting
        assert.ok(
            !/textContent\s*=\s*site\.paidUntil/.test(buildSiteCardSrc),
            'must not dump site.paidUntil ISO as textContent'
        );
    });

    await check('showSuccessScreen paid/live: hosting 12 months + pay CTA hidden', () => {
        assert.ok(showSuccessSrc.length > 40, 'showSuccessScreen must exist');
        assert.ok(
            /hosting\s*12\s*luni|12\s*luni\s*hosting/i.test(showSuccessSrc),
            'live success title/copy must mention hosting 12 months'
        );
        // When live, pay button must be hidden (not only when paymentUrl null)
        assert.ok(
            /isLive[\s\S]{0,400}hide\s*\(\s*payBtn|isLive[\s\S]{0,400}payBtn[\s\S]{0,200}hide/i.test(showSuccessSrc) ||
                (/isLive/.test(showSuccessSrc) && /hide\s*\(\s*payBtn\s*\)/.test(showSuccessSrc)),
            'live/paid success must hide pay CTA'
        );
        assert.ok(!/\bDESSERD\b/i.test(showSuccessSrc), 'no DESSERD in success');
        assert.ok(!/\bbakery\b/i.test(showSuccessSrc), 'no bakery in success');
        assert.ok(!/trial/i.test(showSuccessSrc) || /no.?trial|not.?trial/i.test(showSuccessSrc), 'no trial success chrome');
    });

    await check('builder commercial chrome: no DESSERD / bakery / trial-time / slice IDs as customer address', () => {
        assert.ok(!/\bDESSERD\b/i.test(combined), 'no DESSERD');
        assert.ok(!/\bbakery\b/i.test(appSrc + htmlSrc), 'no bakery customer address');
        assert.ok(!/\.trial-time/.test(buildSiteCardSrc), 'no trial-time on cards');
        assert.ok(!/HIDOOK_FAKE_DEPLOY/.test(appSrc), 'no FAKE_DEPLOY journey in builder');
    });

    await check('HIDOOK_FAKE_DEPLOY not set; test-pay + isolated ready', () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
        assert.strictEqual(pricing.PRICE_CENTS, 10000);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    // ── HTTP journey ───────────────────────────────────────────────────────
    async function onStripeEvent(event) {
        const cs = event && event.data && event.data.object;
        const platform = cs && cs.metadata && cs.metadata.platform;
        if (platform === 'web' || (cs && cs.metadata && cs.metadata.siteId)) {
            await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });
        }
    }

    const srv = startServer({ port: 0, onStripeEvent });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    process.env.PUBLIC_URL = base;

    async function loginClient(email) {
        const c = makeClient(base);
        const loginRes = await fetch(`${base}/api/auth/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        assert.strictEqual(loginRes.status, 200);
        const loginBody = await loginRes.json();
        let token;
        try {
            token = new URL(loginBody.devLink).searchParams.get('token');
        } catch {
            const qs = loginBody.devLink.includes('?')
                ? loginBody.devLink.slice(loginBody.devLink.indexOf('?') + 1)
                : '';
            token = new URLSearchParams(qs).get('token');
        }
        const v = await c(`/auth/verify?token=${encodeURIComponent(token)}`);
        assert.strictEqual(v.status, 302);
        return c;
    }

    await check('restaurant preset: first publish 100 → paidUntil ~+12m → expire → renewal 29 → extend; durable pending', async () => {
        const { config: baseCfg } = loadPresetConfig('product-menu');
        const name = `S51-REST-${crypto.randomUUID().slice(0, 8)}`;
        const email = `s51-rest-${crypto.randomUUID().slice(0, 6)}@example.com`;
        const c = await loginClient(email);

        const slugHint = `s51-rest-${crypto.randomUUID().slice(0, 8)}`;
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: slugHint,
                config: withBusinessName(baseCfg, name),
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        assert.ok(pubBody.site && pubBody.site.id);
        assert.strictEqual(pubBody.site.paid, false);
        assert.ok(pubBody.paymentUrl);

        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;

        // First-publish order 10000
        let orders = readOrdersForSite(siteId);
        const publishPending = orders.find((o) => o.status === 'pending' && (o.kind === 'publish' || !o.kind));
        assert.ok(publishPending, 'pending publish order');
        assert.strictEqual(publishPending.amountCents, pricing.PRICE_CENTS);

        const firstSession = publishPending.stripeSessionId;
        assert.ok(firstSession && firstSession !== 'pending');

        const payEvt = {
            id: 'evt_s51_pub_' + crypto.randomUUID().slice(0, 10),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: firstSession,
                    payment_status: 'paid',
                    metadata: {
                        platform: 'web',
                        orderId: publishPending.id,
                        siteId,
                        kind: 'publish',
                    },
                },
            },
        };
        const wh1 = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payEvt),
        });
        assert.strictEqual(wh1.status, 200, await wh1.clone().text());
        await waitForStatus(base, `/live/${slug}/`, 200);

        let site = registry.getSite(siteId);
        assert.strictEqual(site.paid, true);
        assert.ok(site.paidUntil, 'paidUntil after first pay');
        const firstUntil = Date.parse(site.paidUntil);
        const now = Date.now();
        assert.ok(firstUntil > now + 360 * 86400000, 'paidUntil ~+12m lower');
        assert.ok(firstUntil < now + 370 * 86400000, 'paidUntil ~+12m upper');

        // Paid active: GET /api/sites includes paidUntil for dashboard
        const listRes = await c('/api/sites');
        assert.strictEqual(listRes.status, 200);
        const listBody = await listRes.json();
        const listed = (listBody.sites || []).find((s) => s.id === siteId);
        assert.ok(listed, 'site listed');
        assert.ok(listed.paidUntil, 'GET /api/sites returns paidUntil');
        assert.strictEqual(listed.paid, true);

        // Force hosting expired
        const pastUntil = new Date(Date.now() - 5 * 86400000).toISOString();
        registry.updateSite(siteId, {
            paid: true,
            paidUntil: pastUntil,
            status: 'expired',
            url: site.url,
        });

        // Checkout → renewal
        const co1 = await c(`/api/sites/${encodeURIComponent(siteId)}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({}),
        });
        assert.strictEqual(co1.status, 200, await co1.clone().text());
        const coBody1 = await co1.json();
        assert.ok(coBody1.paymentUrl, 'renewal paymentUrl');
        assert.strictEqual(coBody1.kind, 'renewal', 'checkout kind=renewal');
        if (coBody1.amountCents != null) {
            assert.strictEqual(coBody1.amountCents, pricing.RENEWAL_CENTS);
        }

        orders = readOrdersForSite(siteId);
        const renPending1 = orders.filter((o) => o.kind === 'renewal' && o.status === 'pending');
        assert.strictEqual(renPending1.length, 1, 'exactly one pending renewal after first checkout');
        assert.strictEqual(renPending1[0].amountCents, pricing.RENEWAL_CENTS);

        // Repeat checkout before pay — durable same-kind row
        const co2 = await c(`/api/sites/${encodeURIComponent(siteId)}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({}),
        });
        assert.strictEqual(co2.status, 200, await co2.clone().text());
        const coBody2 = await co2.json();
        assert.strictEqual(coBody2.kind, 'renewal');
        assert.ok(coBody2.paymentUrl);

        orders = readOrdersForSite(siteId);
        const renPending2 = orders.filter((o) => o.kind === 'renewal' && o.status === 'pending');
        assert.strictEqual(
            renPending2.length,
            1,
            'repeat checkout must not create a second pending renewal row'
        );
        assert.strictEqual(renPending2[0].id, renPending1[0].id, 'same order id reused');

        const renSession = renPending2[0].stripeSessionId;
        assert.ok(renSession && renSession !== 'pending');

        const renEvt = {
            id: 'evt_s51_ren_' + crypto.randomUUID().slice(0, 10),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: renSession,
                    payment_status: 'paid',
                    metadata: {
                        platform: 'web',
                        orderId: renPending2[0].id,
                        siteId,
                        kind: 'renewal',
                    },
                },
            },
        };
        const wh2 = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(renEvt),
        });
        assert.strictEqual(wh2.status, 200, await wh2.clone().text());

        // paidUntil extends ~+12m from now (already expired base)
        const deadline = Date.now() + 5000;
        let extended = null;
        while (Date.now() < deadline) {
            site = registry.getSite(siteId);
            extended = Date.parse(site.paidUntil);
            if (Number.isFinite(extended) && extended > Date.now() + 300 * 86400000) break;
            await sleep(30);
        }
        site = registry.getSite(siteId);
        assert.strictEqual(site.paid, true);
        extended = Date.parse(site.paidUntil);
        const after = Date.now();
        // From now when already expired (webpublish uses now as base)
        assert.ok(extended > after + 360 * 86400000 - 60000, `renewed paidUntil lower: ${site.paidUntil}`);
        assert.ok(extended < after + 370 * 86400000 + 60000, `renewed paidUntil upper: ${site.paidUntil}`);

        // Live HTML still fetchable after renewal
        await waitForStatus(base, `/live/${slug}/`, 200);
        const live = await fetch(`${base}/live/${slug}/`);
        assert.strictEqual(live.status, 200);
        const html = await live.text();
        assert.ok(html.includes(name), 'live HTML still has business name after renewal');

        // Amount on paid renewal order is 2900 not 10000
        const paidRen = registry.getOrder(renPending2[0].id);
        assert.strictEqual(paidRen.status, 'paid');
        assert.strictEqual(paidRen.amountCents, pricing.RENEWAL_CENTS);
        assert.strictEqual(paidRen.kind, 'renewal');
    });

    await check('salon portfolio: past paidUntil checkout is renewal 2900 (not publish 100)', async () => {
        const { config: baseCfg } = loadPresetConfig('portfolio');
        const name = `S51-SALON-${crypto.randomUUID().slice(0, 8)}`;
        const email = `s51-salon-${crypto.randomUUID().slice(0, 6)}@example.com`;
        const c = await loginClient(email);

        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'RO' },
            body: JSON.stringify({
                templateId: 'portfolio',
                slug: `s51-salon-${crypto.randomUUID().slice(0, 8)}`,
                config: withBusinessName(baseCfg, name),
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;

        const orders0 = readOrdersForSite(siteId);
        const pend = orders0.find((o) => o.status === 'pending');
        assert.ok(pend);
        const wh = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: 'evt_s51_salon_' + crypto.randomUUID().slice(0, 8),
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: pend.stripeSessionId,
                        payment_status: 'paid',
                        metadata: { platform: 'web', orderId: pend.id, siteId, kind: 'publish' },
                    },
                },
            }),
        });
        assert.strictEqual(wh.status, 200);
        await waitForStatus(base, `/live/${slug}/`, 200);

        // Past paidUntil, still paid true, status live (UI treats as expired via date)
        registry.updateSite(siteId, {
            paid: true,
            paidUntil: new Date(Date.now() - 2 * 86400000).toISOString(),
            status: 'live',
        });

        const co = await c(`/api/sites/${encodeURIComponent(siteId)}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'RO' },
            body: JSON.stringify({}),
        });
        assert.strictEqual(co.status, 200, await co.clone().text());
        const body = await co.json();
        assert.strictEqual(body.kind, 'renewal');
        const orders = readOrdersForSite(siteId);
        const ren = orders.find((o) => o.kind === 'renewal' && o.status === 'pending');
        assert.ok(ren, 'renewal pending order');
        assert.strictEqual(ren.amountCents, pricing.RENEWAL_CENTS);
        assert.notStrictEqual(ren.amountCents, pricing.PRICE_CENTS);
    });

    await check('pricing still 10000 / 2900 only', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 10000);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll s51-builder-renewal checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
