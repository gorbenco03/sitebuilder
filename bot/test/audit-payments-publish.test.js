'use strict';
/**
 * bot/test/audit-payments-publish.test.js — oracle for the 2026-09-06 audit
 * findings PC-02, PC-03, F3 (04-QA-Evidence/Audit-2026-09-06-2225ca7/).
 *
 * PC-02 (bot/pricing.js): currency bucketing depended exclusively on the
 *   CF-IPCountry header, which Railway (the documented production target)
 *   never sends. Without a Cloudflare proxy in front of the origin every real
 *   visitor fell back straight to USD. Fix: a coarse Accept-Language guess
 *   (any environment) before the USD default, plus a one-time production
 *   warning log when CF-IPCountry is absent.
 *
 * PC-03 (bot/webpublish.js): customer.subscription.updated with status
 *   'unpaid' or 'incomplete_expired' never unpublished the live site — only
 *   'deleted'/'canceled' did. 'unpaid' is Stripe's terminal dunning state and
 *   can persist forever without ever firing .deleted. Fix: treat unpaid and
 *   incomplete_expired as unpublish triggers too (active/trialing/past_due
 *   still do not unpublish — no new grace-window state invented).
 *
 * F3 (bot/webpublish.js): og:image / twitter:image on the LIVE published
 *   page were relative paths ("images/hero.jpg"), so WhatsApp/Facebook/X
 *   link-preview crawlers never load them. Fix: webpublish.js rewrites the
 *   built index.html to an absolute URL using the real public origin of the
 *   deploy, before/after the actual deploy call.
 *
 * Run: node bot/test/audit-payments-publish.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-pp-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'audit-pp-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0'; // patched after listen
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.BRAND_DOMAIN;

const pricing    = require('../pricing.js');
const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');
const { onStripeEvent } = require('../web.js');
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

function publishedDir(slug) {
    return path.join(tmpDir, 'published', String(slug).toLowerCase());
}

function seedLiveSiteConfig(slugPrefix) {
    const user = registry.getOrCreateUserByEmail(`app-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: (slugPrefix || 'app') + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const sessionId = 'cs_test_app_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    // hero.background carries a real template image so build.js's
    // deriveSocialImage() actually picks up a social preview photo (F3).
    const config = {
        businessName: 'Audit Payments Cafe',
        hero: { background: "url('images/cn-hero.jpg')", ctaLabel: 'Go' },
        sections: { hero: { title: 'Audit live copy' } },
    };
    registry.saveVersion(site.id, config);
    webpublish.savePendingDraft(order.id, {
        config,
        images: [],
        siteId: site.id,
        savedAt: new Date().toISOString(),
    });
    const subscriptionId = 'sub_test_app_' + crypto.randomBytes(5).toString('hex');
    const customerId = 'cus_test_app_' + crypto.randomBytes(5).toString('hex');
    return { user, site, sessionId, order, subscriptionId, customerId };
}

async function publishViaTrialWebhook({ sessionId, site, order, user, subscriptionId, customerId }) {
    await onStripeEvent({
        id: 'evt_app_paid_' + crypto.randomUUID().slice(0, 10),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'no_payment_required',
                customer: customerId,
                subscription: subscriptionId,
                metadata: {
                    platform: 'web',
                    orderId: order.id,
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                    billing_contract: 'first_then_renewal',
                    first_period_cents: String(pricing.PRICE_CENTS),
                    renewal_cents: String(pricing.RENEWAL_CENTS),
                },
            },
        },
    });
}

async function sendSubscriptionUpdated({ subscriptionId, customerId, siteId, status }) {
    await onStripeEvent({
        id: 'evt_app_' + status + '_' + crypto.randomUUID().slice(0, 8),
        type: 'customer.subscription.updated',
        data: {
            object: {
                id: subscriptionId,
                customer: customerId,
                status,
                metadata: { siteId },
            },
        },
    });
}

(async () => {
    // ── PC-02: currency bucketing without CF-IPCountry ──────────────────────
    await check('PC-02: CF-IPCountry still wins when present', () => {
        const p = pricing.getPricingFromRequest({ headers: { 'cf-ipcountry': 'DE' } });
        assert.strictEqual(p.currency, 'eur');
        assert.strictEqual(p.countryCode, 'DE');
    });

    await check('PC-02: no CF header, no explicit country, Accept-Language fr-FR -> EUR (production-shaped env)', () => {
        const savedIso = process.env.HIDOOK_ISOLATED_DEPLOY;
        const savedPay = process.env.HIDOOK_TEST_PAY;
        const savedEnv = process.env.NODE_ENV;
        delete process.env.HIDOOK_ISOLATED_DEPLOY;
        delete process.env.HIDOOK_TEST_PAY;
        process.env.NODE_ENV = 'production';
        try {
            const p = pricing.getPricingFromRequest({ headers: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' } });
            assert.strictEqual(p.currency, 'eur', 'French Accept-Language must bucket EUR without a CF header');
            assert.strictEqual(p.countryCode, 'FR');
        } finally {
            process.env.HIDOOK_ISOLATED_DEPLOY = savedIso;
            process.env.HIDOOK_TEST_PAY = savedPay;
            process.env.NODE_ENV = savedEnv;
        }
    });

    await check('PC-02: no CF header, Accept-Language en-GB -> GBP (production-shaped env)', () => {
        const savedIso = process.env.HIDOOK_ISOLATED_DEPLOY;
        const savedPay = process.env.HIDOOK_TEST_PAY;
        const savedEnv = process.env.NODE_ENV;
        delete process.env.HIDOOK_ISOLATED_DEPLOY;
        delete process.env.HIDOOK_TEST_PAY;
        process.env.NODE_ENV = 'production';
        try {
            const p = pricing.getPricingFromRequest({ headers: { 'accept-language': 'en-GB,en;q=0.9' } });
            assert.strictEqual(p.currency, 'gbp');
            assert.strictEqual(p.countryCode, 'GB');
        } finally {
            process.env.HIDOOK_ISOLATED_DEPLOY = savedIso;
            process.env.HIDOOK_TEST_PAY = savedPay;
            process.env.NODE_ENV = savedEnv;
        }
    });

    await check('PC-02: bare "en" Accept-Language is ambiguous — must NOT guess EUR/GBP, stays USD', () => {
        const savedIso = process.env.HIDOOK_ISOLATED_DEPLOY;
        const savedPay = process.env.HIDOOK_TEST_PAY;
        delete process.env.HIDOOK_ISOLATED_DEPLOY;
        delete process.env.HIDOOK_TEST_PAY;
        try {
            const p = pricing.getPricingFromRequest({ headers: { 'accept-language': 'en' } });
            assert.strictEqual(p.currency, 'usd');
        } finally {
            process.env.HIDOOK_ISOLATED_DEPLOY = savedIso;
            process.env.HIDOOK_TEST_PAY = savedPay;
        }
    });

    await check('PC-02: no CF header, no Accept-Language at all -> still USD (no crash, matches documented default)', () => {
        const savedIso = process.env.HIDOOK_ISOLATED_DEPLOY;
        const savedPay = process.env.HIDOOK_TEST_PAY;
        delete process.env.HIDOOK_ISOLATED_DEPLOY;
        delete process.env.HIDOOK_TEST_PAY;
        try {
            const p = pricing.getPricingFromRequest({ headers: {} });
            assert.strictEqual(p.currency, 'usd');
            assert.ok(p.countryCode === 'US' || p.countryCode == null);
        } finally {
            process.env.HIDOOK_ISOLATED_DEPLOY = savedIso;
            process.env.HIDOOK_TEST_PAY = savedPay;
        }
    });

    await check('PC-02: production without CF header logs a warning exactly once per process', () => {
        const savedIso = process.env.HIDOOK_ISOLATED_DEPLOY;
        const savedPay = process.env.HIDOOK_TEST_PAY;
        const savedEnv = process.env.NODE_ENV;
        delete process.env.HIDOOK_ISOLATED_DEPLOY;
        delete process.env.HIDOOK_TEST_PAY;
        process.env.NODE_ENV = 'production';
        const chunks = [];
        const origWrite = process.stdout.write;
        process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return origWrite.call(process.stdout, chunk, ...args); };
        try {
            pricing.getPricingFromRequest({ headers: {} }); // pure US fallback, no accept-language signal
            pricing.getPricingFromRequest({ headers: {} }); // second call must not log again
        } finally {
            process.stdout.write = origWrite;
            process.env.HIDOOK_ISOLATED_DEPLOY = savedIso;
            process.env.HIDOOK_TEST_PAY = savedPay;
            process.env.NODE_ENV = savedEnv;
        }
        const hits = chunks.filter((l) => l.includes('pricing.country_source.cf_header_missing'));
        assert.ok(hits.length <= 1, 'must warn at most once per process, got ' + hits.length);
    });

    // ── Server: full publish via isolated deploy, then PC-03 + F3 over HTTP ─
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    process.env.PUBLIC_URL = base;

    try {
        // ── F3: absolute og:image / twitter:image on the live published page ──
        await check('F3: og:image and twitter:image are absolute URLs on the live page, and the image resolves 200', async () => {
            const seeded = seedLiveSiteConfig('f3');
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            assert.ok(site.status === 'live' || site.status === 'active', 'must be live: ' + site.status);

            const liveRes = await fetch(`${base}/live/${site.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveRes.status, 200, 'live page must 200');
            const html = await liveRes.text();

            const ogMatch = /<meta property="og:image" content="([^"]*)">/i.exec(html);
            const twMatch = /<meta name="twitter:image" content="([^"]*)">/i.exec(html);
            assert.ok(ogMatch, 'og:image meta must be present');
            assert.ok(twMatch, 'twitter:image meta must be present');
            assert.ok(/^https?:\/\//i.test(ogMatch[1]), 'og:image must be an absolute URL, got ' + ogMatch[1]);
            assert.ok(/^https?:\/\//i.test(twMatch[1]), 'twitter:image must be an absolute URL, got ' + twMatch[1]);
            assert.strictEqual(ogMatch[1], twMatch[1], 'og:image and twitter:image must match');
            assert.ok(ogMatch[1].startsWith(`${base}/live/${site.slug}/`), 'must be rooted at this site\'s own live origin, got ' + ogMatch[1]);

            const imgRes = await fetch(ogMatch[1]);
            assert.strictEqual(imgRes.status, 200, 'the og:image URL must actually resolve 200, got ' + imgRes.status);
        });

        // ── PC-03: past_due keeps the site up; unpaid must unpublish it ────────
        await check('PC-03: past_due does not unpublish (no new grace-window behavior)', async () => {
            const seeded = seedLiveSiteConfig('pc03pd');
            await publishViaTrialWebhook(seeded);
            const before = registry.getSite(seeded.site.id);
            assert.ok(fs.existsSync(publishedDir(before.slug)), 'isolated published dir must exist');

            await sendSubscriptionUpdated({
                subscriptionId: seeded.subscriptionId,
                customerId: seeded.customerId,
                siteId: seeded.site.id,
                status: 'past_due',
            });

            const liveRes = await fetch(`${base}/live/${before.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveRes.status, 200, 'past_due must NOT unpublish — live must stay 200');
            const after = registry.getSite(seeded.site.id);
            assert.ok(after.status === 'live' || after.status === 'active', 'registry must stay live on past_due');
            assert.strictEqual(after.stripeSubscriptionStatus, 'past_due');
        });

        await check('PC-03: unpaid DOES unpublish (Stripe terminal dunning state, no .deleted needed)', async () => {
            const seeded = seedLiveSiteConfig('pc03up');
            await publishViaTrialWebhook(seeded);
            const before = registry.getSite(seeded.site.id);
            assert.strictEqual(before.status === 'live' || before.status === 'active', true);
            const dest = publishedDir(before.slug);
            assert.ok(fs.existsSync(dest), 'isolated published dir must exist before dunning');

            // Mirror Stripe's real dunning path: past_due first, then unpaid.
            await sendSubscriptionUpdated({
                subscriptionId: seeded.subscriptionId,
                customerId: seeded.customerId,
                siteId: seeded.site.id,
                status: 'past_due',
            });
            await sendSubscriptionUpdated({
                subscriptionId: seeded.subscriptionId,
                customerId: seeded.customerId,
                siteId: seeded.site.id,
                status: 'unpaid',
            });

            const liveRes = await fetch(`${base}/live/${before.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveRes.status, 404, 'live path must 404 after unpaid unpublish, got ' + liveRes.status);
            assert.ok(!fs.existsSync(dest), 'isolated published files must be removed');

            const after = registry.getSite(seeded.site.id);
            assert.ok(after.status !== 'live' && after.status !== 'active', 'registry must not be live after unpaid');
            assert.strictEqual(after.stripeSubscriptionStatus, 'unpaid', 'real status must be preserved (not forced to canceled)');
        });

        await check('PC-03: incomplete_expired DOES unpublish', async () => {
            const seeded = seedLiveSiteConfig('pc03ie');
            await publishViaTrialWebhook(seeded);
            const before = registry.getSite(seeded.site.id);
            assert.ok(before.status === 'live' || before.status === 'active');

            await sendSubscriptionUpdated({
                subscriptionId: seeded.subscriptionId,
                customerId: seeded.customerId,
                siteId: seeded.site.id,
                status: 'incomplete_expired',
            });

            const liveRes = await fetch(`${base}/live/${before.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveRes.status, 404, 'live path must 404 after incomplete_expired unpublish');
            const after = registry.getSite(seeded.site.id);
            assert.ok(after.status !== 'live' && after.status !== 'active');
            assert.strictEqual(after.stripeSubscriptionStatus, 'incomplete_expired');
        });

        await check('PC-03: active/trialing statuses still do not unpublish (happy path unchanged)', async () => {
            const seeded = seedLiveSiteConfig('pc03ok');
            await publishViaTrialWebhook(seeded);
            const before = registry.getSite(seeded.site.id);
            assert.ok(before.status === 'live' || before.status === 'active');

            for (const status of ['trialing', 'active']) {
                await sendSubscriptionUpdated({
                    subscriptionId: seeded.subscriptionId,
                    customerId: seeded.customerId,
                    siteId: seeded.site.id,
                    status,
                });
                const liveRes = await fetch(`${base}/live/${before.slug}/`, { redirect: 'manual' });
                assert.strictEqual(liveRes.status, 200, `${status} must not unpublish`);
            }
            const after = registry.getSite(seeded.site.id);
            assert.ok(after.status === 'live' || after.status === 'active');
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
    }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    console.log(failed ? `\n${failed} FAILED` : '\nAll passed.');
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
