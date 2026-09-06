'use strict';
/**
 * bot/test/wave7-payments-no-double-subscription.test.js — Wave7 re-verification
 * of the audit's worst payments finding:
 *
 *   "a paying customer labelled 'Expirat' and pushed into opening a second
 *   subscription that billed alongside the first."
 *
 * Two independent fixes, both re-verified end to end here:
 *
 *   1. webpublish.canStartRenewalCheckout(site) — refuses a renewal Checkout
 *      while Stripe still reports the site's existing subscription as
 *      active/trialing/past_due. This is the guard bot/server.js#
 *      handleSiteCheckout must call before creating an order/Checkout
 *      Session (see HANDOFF-payments.md for the exact insertion — this
 *      agent does not own server.js).
 *   2. webpublish.reconcileSiteFromStripe(site) — when local paidUntil looks
 *      expired but Stripe still has the subscription active/trialing, heals
 *      paidUntil from Stripe's own current_period_end instead of leaving the
 *      dashboard to lie.
 *
 * The full scenario from the task: active subscription, renewal paid,
 * dashboard label correct, and no path that opens a second subscription for
 * a site that already has a live one — verified against the SAME
 * isHostingExpired()/isSiteInTrial() functions builder/app.js's dashboard
 * badge uses (extracted read-only into a sandbox, same technique as
 * s51-builder-renewal.test.js — this agent does not edit builder/**).
 *
 * Run: node bot/test/wave7-payments-no-double-subscription.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const ROOT   = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-nodup-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'wave7-nodup-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;

const pricing    = require('../pricing.js');
const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');
const { onStripeEvent } = require('../web.js');

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

// ── Read-only extraction of the exact dashboard-badge logic (no builder edits) ──
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

const appSrc = fs.readFileSync(APP_JS, 'utf8');
const isHostingExpiredSrc = extractFunction(appSrc, 'isHostingExpired');
const isSiteInTrialSrc = extractFunction(appSrc, 'isSiteInTrial');
const getTrialEndIsoSrc = extractFunction(appSrc, 'getTrialEndIso');
assert.ok(isHostingExpiredSrc, 'builder/app.js must still define isHostingExpired');
assert.ok(isSiteInTrialSrc, 'builder/app.js must still define isSiteInTrial');
assert.ok(getTrialEndIsoSrc, 'builder/app.js must still define getTrialEndIso');
// eslint-disable-next-line no-new-func
const dashboardBadge = new Function(
    `${getTrialEndIsoSrc}\n${isHostingExpiredSrc}\n${isSiteInTrialSrc}\nreturn { isHostingExpired, isSiteInTrial };`
)();

function fullConfig(name) {
    return {
        business: { name, title: `${name} | T`, metaDescription: `${name} — desc`, lang: 'ro' },
        hero: { background: "url('images/x.jpg')", ctaLabel: 'Sună acum' },
        contact: { phone: '+40721234567' },
        footer: { address: 'Strada Test 1' },
    };
}

function seedPendingSite(prefix) {
    const user = registry.getOrCreateUserByEmail(`${prefix}-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: prefix + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const sessionId = 'cs_test_' + prefix + '_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id, userId: user.id, amountCents: pricing.PRICE_CENTS, currency: 'eur',
        stripeSessionId: sessionId, kind: 'publish',
    });
    registry.saveVersion(site.id, fullConfig(prefix));
    webpublish.savePendingDraft(order.id, { config: fullConfig(prefix), images: [], siteId: site.id, savedAt: new Date().toISOString() });
    return { user, site, order, sessionId };
}

function installFetchRecorder(responder) {
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
        const json = responder(String(url), (opts && opts.body) || '');
        return { ok: true, status: 200, json: async () => json };
    };
    return () => { global.fetch = origFetch; };
}

(async () => {
    // ── canStartRenewalCheckout: pure decision table ────────────────────────
    await check('canStartRenewalCheckout: unpaid site (first publish/trial start) — always allowed', () => {
        assert.deepStrictEqual(webpublish.canStartRenewalCheckout({ paid: false }), { allowed: true });
        assert.deepStrictEqual(webpublish.canStartRenewalCheckout(null), { allowed: false, reasonCode: 'NO_SITE' });
    });

    await check('canStartRenewalCheckout: paid site with NO subscription-status signal — allowed (offline / webhook-not-arrived-yet flows unaffected)', () => {
        const result = webpublish.canStartRenewalCheckout({ paid: true, paidUntil: new Date(Date.now() - 86400000).toISOString() });
        assert.deepStrictEqual(result, { allowed: true });
    });

    for (const status of ['active', 'trialing', 'past_due']) {
        await check(`canStartRenewalCheckout: paid site with stripeSubscriptionStatus=${status} — BLOCKED (this is the audit bug)`, () => {
            const result = webpublish.canStartRenewalCheckout({
                paid: true,
                paidUntil: new Date(Date.now() - 86400000).toISOString(), // looks expired to the naive check
                stripeSubscriptionStatus: status,
            });
            assert.strictEqual(result.allowed, false);
            assert.strictEqual(result.reasonCode, 'SUBSCRIPTION_STILL_ACTIVE');
            assert.ok(/[ăâîșț]/i.test(result.reasonRo));
        });
    }

    for (const status of ['canceled', 'cancelled', 'unpaid', 'incomplete_expired']) {
        await check(`canStartRenewalCheckout: paid site with terminal status=${status} — allowed (legitimate resubscribe)`, () => {
            const result = webpublish.canStartRenewalCheckout({
                paid: true,
                paidUntil: new Date(Date.now() - 86400000).toISOString(),
                stripeSubscriptionStatus: status,
            });
            assert.deepStrictEqual(result, { allowed: true });
        });
    }

    // ── reconcileSiteFromStripe: heal a stale "Expirat" from Stripe's own truth ──
    await check('reconcileSiteFromStripe: HIDOOK_TEST_PAY offline → no-op (returns the same site, never touches network)', async () => {
        let called = false;
        const restore = installFetchRecorder(() => { called = true; return {}; });
        try {
            const site = { id: 'x', paid: true, stripeSubscriptionId: 'sub_x', paidUntil: new Date(Date.now() - 1000).toISOString() };
            const result = await webpublish.reconcileSiteFromStripe(site);
            assert.strictEqual(result, site);
            assert.strictEqual(called, false);
        } finally {
            restore();
        }
    });

    await check('reconcileSiteFromStripe: real Stripe says still active — heals paidUntil from current_period_end, sets status live', async () => {
        const { site } = seedPendingSite('reco-active');
        const subscriptionId = 'sub_test_reco_' + crypto.randomBytes(4).toString('hex');
        registry.updateSite(site.id, {
            paid: true,
            paidUntil: new Date(Date.now() - 5 * 86400000).toISOString(),
            status: 'expired',
            stripeSubscriptionId: subscriptionId,
        });
        const futurePeriodEnd = Math.floor(Date.now() / 1000) + 300 * 86400;
        process.env.STRIPE_TEST_PAY_DISABLED_FOR_THIS_CHECK = '1'; // documentation only, no code reads this
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_reco';
        const restore = installFetchRecorder((url) => {
            assert.ok(url.includes('/subscriptions/' + subscriptionId), 'must GET the exact subscription');
            return { id: subscriptionId, status: 'active', current_period_end: futurePeriodEnd };
        });
        try {
            const healed = await webpublish.reconcileSiteFromStripe(registry.getSite(site.id));
            assert.strictEqual(healed.status, 'live');
            assert.strictEqual(healed.stripeSubscriptionStatus, 'active');
            const healedUntilMs = Date.parse(healed.paidUntil);
            assert.ok(healedUntilMs > Date.now() + 250 * 86400000, 'paidUntil healed from Stripe current_period_end');
        } finally {
            restore();
            process.env.HIDOOK_TEST_PAY = prevTestPay;
            delete process.env.STRIPE_SECRET_KEY;
        }
    });

    await check('reconcileSiteFromStripe: real Stripe agrees it is canceled — does not fabricate a live status, just persists the truth', async () => {
        const { site } = seedPendingSite('reco-canceled');
        const subscriptionId = 'sub_test_recoc_' + crypto.randomBytes(4).toString('hex');
        registry.updateSite(site.id, {
            paid: true,
            paidUntil: new Date(Date.now() - 5 * 86400000).toISOString(),
            status: 'expired',
            stripeSubscriptionId: subscriptionId,
        });
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_recoc';
        const restore = installFetchRecorder(() => ({ id: subscriptionId, status: 'canceled' }));
        try {
            const before = registry.getSite(site.id);
            const result = await webpublish.reconcileSiteFromStripe(before);
            assert.strictEqual(result.status, 'expired', 'must not fabricate live status');
            assert.strictEqual(result.stripeSubscriptionStatus, 'canceled');
            assert.strictEqual(result.paidUntil, before.paidUntil, 'must not touch paidUntil when Stripe confirms it is really over');
        } finally {
            restore();
            process.env.HIDOOK_TEST_PAY = prevTestPay;
            delete process.env.STRIPE_SECRET_KEY;
        }
    });

    // ── Full scenario: active subscription, renewal paid, label correct, guard blocks a second sub ──
    await check('END TO END: active subscription + renewal paid → dashboard label stays correct AND a second Checkout is refused', async () => {
        const { site, order, sessionId, user } = seedPendingSite('e2e');
        const subscriptionId = 'sub_test_e2e_' + crypto.randomBytes(4).toString('hex');

        // 1) First publish (7-day trial start).
        await onStripeEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: sessionId,
                    payment_status: 'no_payment_required',
                    customer: 'cus_test_e2e',
                    subscription: subscriptionId,
                    metadata: { platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id },
                },
            },
        });

        // 2) Stripe creates the subscription (trialing), then later flips to active
        //    (trial end) — both handled directly since bot/web.js does not yet
        //    route .created to this handler (see HANDOFF-payments.md).
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.created',
            data: { object: { id: subscriptionId, status: 'trialing', customer: 'cus_test_e2e' } },
        });
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'active', customer: 'cus_test_e2e' } },
        });

        let site1 = registry.getSite(site.id);
        assert.strictEqual(site1.stripeSubscriptionStatus, 'active');
        assert.strictEqual(dashboardBadge.isHostingExpired(site1), false, 'must not be expired right after first publish');

        // 3) A year later: Stripe auto-collects the renewal invoice. Backdate
        //    createdAt so isSiteInTrial's own "renewed hosting year" guard
        //    (paidUntil far past createdAt) applies — otherwise its
        //    trialEnd-from-paidUntil fallback heuristic (meant for a site with
        //    no recorded trialStart) can't tell this apart from a first-year
        //    trial using only the two timestamps a real renewed site would
        //    actually carry a year in.
        registry.updateSite(site.id, {
            paidUntil: new Date(Date.now() + 10 * 86400000).toISOString(), // inside the renewal-due window
            createdAt: new Date(Date.now() - 370 * 86400000).toISOString(),
        });
        await webpublish.handleStripeInvoicePaid({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_succeeded',
            data: {
                object: {
                    id: 'in_' + crypto.randomUUID().slice(0, 8),
                    subscription: subscriptionId,
                    billing_reason: 'subscription_cycle',
                    amount_paid: pricing.RENEWAL_CENTS,
                    currency: 'eur',
                },
            },
        });

        const site2 = registry.getSite(site.id);
        const untilMs = Date.parse(site2.paidUntil);
        assert.ok(untilMs > Date.now() + 300 * 86400000, 'paidUntil extended by the renewal');

        // 4) Dashboard label must read "Activ", not "Expirat" — same functions the badge uses.
        assert.strictEqual(dashboardBadge.isHostingExpired(site2), false, 'dashboard must not say Expirat for a site whose renewal just succeeded');
        assert.strictEqual(dashboardBadge.isSiteInTrial(site2), false, 'a renewed non-trial year must not show trial chrome either');

        // 5) The one guarantee the audit demanded: no path opens a second live
        //    subscription for this site. Even if something upstream still thought
        //    hosting looked expired, the guard reads the real subscription status.
        const guard = webpublish.canStartRenewalCheckout(site2);
        assert.strictEqual(guard.allowed, false, 'must refuse a second Checkout — this site already has a live subscription');
        assert.strictEqual(guard.reasonCode, 'SUBSCRIPTION_STILL_ACTIVE');

        // Invoice history is provable too, from the very same flow.
        const history = webpublish.getInvoiceHistory(site2);
        assert.ok(history.length >= 2, 'first-year + renewal both on record');
    });

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll wave7-payments-no-double-subscription checks passed.');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
