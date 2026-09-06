'use strict';
/**
 * bot/test/wave8-billing-entitlement-agree.test.js — Wave8 audit remediation.
 *
 * Re-audit finding #1 ("double billing through a different door"): a guard
 * already blocks POST /api/sites/:id/checkout from opening a second Checkout
 * Session while Stripe still reports the subscription active/trialing/
 * past_due (webpublish.canStartRenewalCheckout, proven in
 * wave7-payments-no-double-subscription.test.js). But the ordinary
 * edit-and-republish flow — POST /api/publish for an existing siteId —
 * decides entitlement through hasActiveCommercialEntitlement() instead,
 * which treats an expired local paidUntil as a hard stop even when Stripe's
 * own subscription status says the subscription is still current. Forcing a
 * stale paidUntil next to a genuinely active subscription and then
 * republishing reproduces the exact re-audit finding: a brand-new
 * full-price Checkout Session opens, and the already-paid site is silently
 * downgraded to paid:false/draft, while the original subscription keeps
 * billing.
 *
 * Re-audit finding #2 ("the dunning state is computed and never shown"):
 * webpublish.getDunningState() builds correct, actionable Romanian dunning
 * copy, but nothing called it — the dashboard read "Activ" through a real
 * card decline and "Ciornă" once Stripe exhausted every retry and
 * unpublished the site. GET /api/sites / GET /api/sites/:id must attach it,
 * and builder/app.js#buildSiteCard must read it rather than silently
 * falling through to a misleading label.
 *
 * Run: node --experimental-sqlite bot/test/wave8-billing-entitlement-agree.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-billing-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-wave8-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
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
    throw new Error(`timeout waiting for ${urlPath} -> ${wantStatus} (last ${last})`);
}

function loadPresetConfig(templateId) {
    const presetsPath = path.join(ROOT, 'templates', templateId, 'presets.json');
    assert.ok(fs.existsSync(presetsPath), `presets.json missing for ${templateId}`);
    const body = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    const presets = body.presets || [];
    assert.ok(presets.length >= 1, `${templateId} must have >=1 preset`);
    const cfg = JSON.parse(JSON.stringify(presets[0].config));
    assert.ok(cfg && cfg.business, `${templateId} preset must have business`);
    return cfg;
}

function withBusinessName(config, name) {
    const c = JSON.parse(JSON.stringify(config));
    c.business = c.business || {};
    c.business.name = name;
    return c;
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

(async () => {
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

    async function firstPublishAndPay(c, name) {
        const { config: baseCfg } = { config: loadPresetConfig('product-menu') };
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: 'w8-' + crypto.randomUUID().slice(0, 8),
                config: withBusinessName(baseCfg, name),
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;

        const orders = registry.listOrdersBySite(siteId);
        const pend = orders.find((o) => o.status === 'pending');
        assert.ok(pend, 'pending order created on first publish');

        const wh = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: 'evt_w8_' + crypto.randomUUID().slice(0, 8),
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
        return { siteId, slug };
    }

    // ── Finding #1: stale local paidUntil next to a genuinely active
    //    subscription must not double-bill or downgrade the paid site ──────
    await check('re-audit repro: stale paidUntil + Stripe-active subscription + republish must not open a duplicate Checkout Session or downgrade the site', async () => {
        const email = `w8-pub-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(email);
        const name = `W8-PUB-${crypto.randomUUID().slice(0, 8)}`;
        const { siteId } = await firstPublishAndPay(c, name);

        const before = registry.getSite(siteId);
        assert.strictEqual(before.paid, true, 'site paid after first publish');
        assert.ok(before.paidUntil, 'paidUntil set after first publish');

        // Simulate Stripe reporting the subscription as genuinely active — the
        // same webhook path that persists stripeSubscriptionStatus in production.
        const subId = 'sub_w8_' + siteId.slice(0, 8);
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_w8_sub_active_' + crypto.randomUUID().slice(0, 8),
            type: 'customer.subscription.created',
            data: { object: { id: subId, status: 'active', metadata: { siteId } } },
        });
        assert.strictEqual(registry.getSite(siteId).stripeSubscriptionStatus, 'active', 'active status persisted');

        // Now force the LOCAL paidUntil stale (webhook lag / missed invoice
        // event) while Stripe's own subscription status still says active —
        // this exact combination is the re-audit's reproduction.
        registry.updateSite(siteId, { paidUntil: new Date(Date.now() - 5 * 86400000).toISOString() });
        const staged = registry.getSite(siteId);
        assert.ok(Date.parse(staged.paidUntil) < Date.now(), 'paidUntil is stale');
        assert.strictEqual(staged.stripeSubscriptionStatus, 'active', 'subscription still active per Stripe');

        const ordersBefore = registry.listOrdersBySite(siteId);

        // Ordinary edit-and-republish flow.
        const editedCfg = withBusinessName(loadPresetConfig('product-menu'), name + '-EDITED');
        const rep = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, templateId: 'product-menu', config: editedCfg, images: [] }),
        });
        assert.strictEqual(rep.status, 200, await rep.clone().text());
        const repBody = await rep.json();

        // Must NOT open a brand-new Checkout Session (double billing).
        assert.strictEqual(repBody.paymentUrl, null, 'republish while Stripe subscription is active must not return a new Checkout Session URL');

        // Must NOT downgrade the already-paid site.
        assert.strictEqual(repBody.site.paid, true, 'site must remain paid:true, not be silently downgraded');
        assert.notStrictEqual(repBody.site.status, 'draft', 'site must not be downgraded to draft status');

        const after = registry.getSite(siteId);
        assert.strictEqual(after.paid, true, 'persisted site must remain paid:true');
        assert.notStrictEqual(after.status, 'draft', 'persisted site must not be downgraded to draft');

        // Must NOT have created a second pending order (no duplicate subscription attempt).
        const ordersAfter = registry.listOrdersBySite(siteId);
        assert.strictEqual(ordersAfter.length, ordersBefore.length, 'no new order row must be created for a stale-paidUntil-but-Stripe-active republish');

        // The edit itself must have gone live (proves this took the direct
        // republish path, not a silently-dropped no-op).
        await waitForStatus(base, `/live/${after.slug}/`, 200);
        const liveRes = await fetch(`${base}/live/${after.slug}/`);
        const liveHtml = await liveRes.text();
        assert.ok(liveHtml.includes(name + '-EDITED'), 'republished edit reached the live site');
    });

    await check('control: a genuinely unpaid new site still goes through the normal paid Checkout Session flow', async () => {
        const email = `w8-control-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(email);
        const name = `W8-CONTROL-${crypto.randomUUID().slice(0, 8)}`;
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: 'w8ctrl-' + crypto.randomUUID().slice(0, 8),
                config: withBusinessName(loadPresetConfig('product-menu'), name),
                images: [],
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const body = await pub.json();
        assert.ok(body.paymentUrl, 'genuinely unpaid first publish must still open a Checkout Session');
        assert.strictEqual(body.site.paid, false);
        assert.strictEqual(body.site.status, 'draft');
    });

    // ── Finding #2: dunning state must reach the dashboard ─────────────────
    await check('GET /api/sites and GET /api/sites/:id attach getDunningState for a past_due retry', async () => {
        const email = `w8-dun-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(email);
        const name = `W8-DUN-${crypto.randomUUID().slice(0, 8)}`;
        const { siteId } = await firstPublishAndPay(c, name);

        const subId = 'sub_w8dun_' + siteId.slice(0, 8);
        registry.updateSite(siteId, { stripeSubscriptionId: subId });

        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_w8_pastdue_' + crypto.randomUUID().slice(0, 8),
            type: 'customer.subscription.updated',
            data: { object: { id: subId, status: 'past_due', metadata: { siteId } } },
        });
        await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_w8_invfail_' + crypto.randomUUID().slice(0, 8),
            data: {
                object: {
                    subscription: subId,
                    attempt_count: 2,
                    next_payment_attempt: Math.floor(Date.now() / 1000) + 5 * 86400,
                },
            },
        });

        const listRes = await c('/api/sites');
        assert.strictEqual(listRes.status, 200);
        const listBody = await listRes.json();
        const listed = (listBody.sites || []).find((s) => s.id === siteId);
        assert.ok(listed, 'site listed');
        assert.ok(listed.dunning, 'GET /api/sites must attach a dunning object for a past_due site with a recorded failure');
        assert.strictEqual(listed.dunning.severity, 'warning');
        assert.strictEqual(listed.dunning.code, 'PAYMENT_RETRY_IN_PROGRESS');
        assert.ok(/card refuzat/i.test(listed.dunning.messageRo), 'Romanian dunning message present');
        // Site is still live/paid — must not have been touched by the dunning read side.
        assert.strictEqual(listed.paid, true);
        assert.strictEqual(listed.status, 'live');

        const oneRes = await c('/api/sites/' + encodeURIComponent(siteId));
        assert.strictEqual(oneRes.status, 200);
        const oneBody = await oneRes.json();
        assert.ok(oneBody.site.dunning, 'GET /api/sites/:id must attach dunning too');
        assert.strictEqual(oneBody.site.dunning.severity, 'warning');
    });

    await check('GET /api/sites reports the terminal dunning state after Stripe exhausts retries and unpublishes', async () => {
        const email = `w8-term-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(email);
        const name = `W8-TERM-${crypto.randomUUID().slice(0, 8)}`;
        const { siteId } = await firstPublishAndPay(c, name);

        const subId = 'sub_w8term_' + siteId.slice(0, 8);
        registry.updateSite(siteId, { stripeSubscriptionId: subId });

        // Stripe gives up: subscription flips to the terminal 'unpaid' state,
        // which webpublish.handleStripeSubscriptionEvent unpublishes on.
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_w8_unpaid_' + crypto.randomUUID().slice(0, 8),
            type: 'customer.subscription.updated',
            data: { object: { id: subId, status: 'unpaid', metadata: { siteId } } },
        });

        const site = registry.getSite(siteId);
        assert.strictEqual(site.status, 'unpublished', 'site unpublished by the terminal dunning state');
        assert.strictEqual(site.paid, true, 'payment history is kept (paid stays true)');

        const listRes = await c('/api/sites');
        const listBody = await listRes.json();
        const listed = (listBody.sites || []).find((s) => s.id === siteId);
        assert.ok(listed, 'site listed');
        assert.ok(listed.dunning, 'terminal state must surface a dunning object');
        assert.strictEqual(listed.dunning.severity, 'critical');
        assert.strictEqual(listed.dunning.code, 'SITE_DOWN_PAYMENT_FAILED');
    });

    // ── Dashboard read side: buildSiteCard must consume `dunning`, never
    //    silently fall through an unpublished-but-still-paid site to the
    //    generic draft badge ("Ciornă") or a still-live-but-retrying charge
    //    to a plain "Activ" ─────────────────────────────────────────────────
    await check('buildSiteCard reads site.dunning and distinguishes unpublished/retrying from a healthy paid site', () => {
        const appSrc = fs.readFileSync(APP_JS, 'utf8');
        const buildSiteCardSrc = extractFunction(appSrc, 'buildSiteCard') || '';
        assert.ok(buildSiteCardSrc.length > 80, 'buildSiteCard must exist');
        assert.ok(/site\.dunning/.test(buildSiteCardSrc), 'buildSiteCard must read site.dunning');
        assert.ok(
            /status\s*===\s*'unpublished'/.test(buildSiteCardSrc),
            'buildSiteCard must explicitly branch on the unpublished status rather than falling through to the generic draft badge'
        );
        assert.ok(
            /severity\s*===\s*'critical'/.test(buildSiteCardSrc),
            'buildSiteCard must check dunning.severity for the terminal (site down) case'
        );
        assert.ok(
            /severity\s*===\s*'warning'/.test(buildSiteCardSrc),
            'buildSiteCard must check dunning.severity for the retrying (past_due) case'
        );
        assert.ok(
            /messageRo/.test(buildSiteCardSrc),
            'buildSiteCard must render the actionable Romanian dunning message somewhere on the card'
        );
    });

    await check('control: HIDOOK_FAKE_DEPLOY not set; test-pay + isolated ready', () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
        assert.ok(pricing.PRICE_CENTS > 0);
    });

    srv.close();
    if (failed > 0) {
        console.error(`\n${failed} test(s) failed.`);
        process.exit(1);
    } else {
        console.log('\nAll wave8-billing-entitlement-agree tests passed.');
    }
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
