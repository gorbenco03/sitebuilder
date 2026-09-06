'use strict';
/**
 * Subscription renewal invoice regression: Stripe emits invoice.payment_succeeded
 * for automatic renewals, not another checkout.session.completed event.
 *
 * Run: node bot/test/stripe-invoice-renewal.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-invoice-renewal-'));
process.env.DATA_DIR = tmpDir;
process.env.HIDOOK_FAKE_DEPLOY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.STRIPE_SECRET_KEY;

const registry = require('../registry.js');
const webpublish = require('../webpublish.js');
const { onStripeEvent } = require('../web.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (error) {
        failed++;
        console.error('FAIL', name, '-', error.message);
        if (process.env.VERBOSE) console.error(error.stack);
    }
}

function expiredSubscribedSite() {
    const user = registry.getOrCreateUserByEmail(`invoice-${crypto.randomUUID()}@example.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'invoice-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const subscriptionId = 'sub_invoice_' + crypto.randomUUID().slice(0, 12);
    const paidUntil = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    registry.updateSite(site.id, {
        paid: true,
        paidUntil,
        status: 'expired',
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: 'active',
    });
    registry.saveVersion(site.id, { business: { name: 'Invoice renewal' } });
    return { site: registry.getSite(site.id), subscriptionId, paidUntil };
}

function liveFirstYearSubscribedSite() {
    const user = registry.getOrCreateUserByEmail(`invoice-first-year-${crypto.randomUUID()}@example.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'invoice-first-year-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const subscriptionId = 'sub_invoice_first_year_' + crypto.randomUUID().slice(0, 12);
    const paidUntil = registry.addMonthsIso(new Date().toISOString(), 12);
    registry.updateSite(site.id, {
        paid: true,
        paidUntil,
        status: 'live',
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: 'active',
    });
    return { site: registry.getSite(site.id), subscriptionId, paidUntil };
}

function invoiceEvent({ eventId, invoiceId, subscriptionId, billingReason, type = 'invoice.payment_succeeded' }) {
    return {
        id: eventId,
        type,
        data: {
            object: {
                id: invoiceId || ('in_' + crypto.randomUUID().slice(0, 12)),
                subscription: subscriptionId,
                billing_reason: billingReason,
            },
        },
    };
}

(async () => {
    await check('subscription_cycle invoice keeps a live first-year entitlement unchanged', async () => {
        const { site, subscriptionId, paidUntil } = liveFirstYearSubscribedSite();
        await onStripeEvent(invoiceEvent({
            eventId: 'evt_invoice_first_year_cycle_' + crypto.randomUUID().slice(0, 12),
            subscriptionId,
            billingReason: 'subscription_cycle',
        }));
        const after = registry.getSite(site.id);
        assert.strictEqual(after.paidUntil, paidUntil, 'day-7 first-year collection must not add another year');
        assert.strictEqual(after.status, 'live', 'first-year collection must not alter a live site');
    });

    await check('subscription_cycle invoice extends an expired entitlement and republishes it once', async () => {
        const { site, subscriptionId, paidUntil } = expiredSubscribedSite();
        const event = invoiceEvent({
            eventId: 'evt_invoice_cycle_' + crypto.randomUUID().slice(0, 12),
            subscriptionId,
            billingReason: 'subscription_cycle',
        });

        // Causal precondition: until the renewal invoice is processed, the expired
        // site has no new entitlement or live URL.
        const before = registry.getSite(site.id);
        assert.strictEqual(before.paidUntil, paidUntil, 'renewal invoice has not extended paidUntil before dispatch');
        assert.strictEqual(before.status, 'expired', 'site remains expired before dispatch');

        await onStripeEvent(event);
        const after = registry.getSite(site.id);
        const expected = Date.parse(registry.addMonthsIso(new Date().toISOString(), 12));
        assert.ok(Date.parse(after.paidUntil) >= expected - 10_000, 'subscription cycle must extend paidUntil by 12 months from now');
        assert.strictEqual(after.status, 'live', 'expired site must be republished after a paid renewal');
        assert.ok(after.url, 'reactivated site has a live URL');

        await onStripeEvent(event);
        const duplicate = registry.getSite(site.id);
        assert.strictEqual(duplicate.paidUntil, after.paidUntil, 'same Stripe event must not extend a second time');

        await onStripeEvent({
            ...event,
            id: 'evt_invoice_paid_' + crypto.randomUUID().slice(0, 12),
            type: 'invoice.paid',
        });
        const siblingEvent = registry.getSite(site.id);
        assert.strictEqual(siblingEvent.paidUntil, after.paidUntil, 'two Stripe event types for one invoice must not extend twice');
    });

    await check('subscription_create invoice is a no-op so checkout cannot double-extend', async () => {
        const { site, subscriptionId, paidUntil } = expiredSubscribedSite();
        await onStripeEvent(invoiceEvent({
            eventId: 'evt_invoice_create_' + crypto.randomUUID().slice(0, 12),
            subscriptionId,
            billingReason: 'subscription_create',
            type: 'invoice.paid',
        }));
        const after = registry.getSite(site.id);
        assert.strictEqual(after.paidUntil, paidUntil, 'first subscription invoice must not add another year');
        assert.strictEqual(after.status, 'expired', 'first subscription invoice must not republish separately from checkout');
    });

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
