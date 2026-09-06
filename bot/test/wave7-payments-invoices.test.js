'use strict';
/**
 * bot/test/wave7-payments-invoices.test.js — Wave7 invoice history.
 *
 * Audit: "an owner paying yearly has no way to see or download past
 * invoices." webpublish.getInvoiceHistory(site) is the fix — it reads a new
 * durable ledger event ('invoice') that this branch now appends on every
 * successful charge, first-year and renewal alike, so the feature is fully
 * provable under HIDOOK_TEST_PAY with zero real Stripe credentials (per the
 * task's "no real Stripe credentials" constraint).
 *
 * See HANDOFF-payments.md for the bot/server.js route
 * (GET /api/sites/:id/invoices) and builder/app.js "Facturi" button this
 * agent could not add directly (file ownership).
 *
 * Run: node bot/test/wave7-payments-invoices.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-invoices-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'wave7-invoices-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;

const pricing       = require('../pricing.js');
const registry      = require('../registry.js');
const ledger        = require('../ledger.js');
const webpublish    = require('../webpublish.js');
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
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    const config = fullConfig(prefix);
    registry.saveVersion(site.id, config);
    webpublish.savePendingDraft(order.id, { config, images: [], siteId: site.id, savedAt: new Date().toISOString() });
    return { user, site, order, sessionId };
}

(async () => {
    await check('getInvoiceHistory: unknown/null site → []', () => {
        assert.deepStrictEqual(webpublish.getInvoiceHistory(null), []);
        assert.deepStrictEqual(webpublish.getInvoiceHistory({}), []);
        assert.deepStrictEqual(webpublish.getInvoiceHistory({ id: 'no-such-site' }), []);
    });

    await check('first-year payment (checkout.session.completed, test-pay) records an invoice history entry', async () => {
        const { site, order, sessionId, user } = seedPendingSite('inv-first');
        const subscriptionId = 'sub_test_inv_' + crypto.randomBytes(4).toString('hex');
        await onStripeEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: sessionId,
                    payment_status: 'no_payment_required',
                    customer: 'cus_test_inv',
                    subscription: subscriptionId,
                    metadata: { platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id },
                },
            },
        });

        const history = webpublish.getInvoiceHistory(registry.getSite(site.id));
        assert.strictEqual(history.length, 1, 'exactly one invoice record for the first-year charge');
        assert.strictEqual(history[0].kind, 'publish');
        assert.strictEqual(history[0].amountCents, pricing.PRICE_CENTS);
        assert.strictEqual(history[0].currency, 'eur');
        assert.ok(history[0].ts, 'ledger entries carry a timestamp');
    });

    await check('renewal payment adds a second, newer invoice entry — newest first', async () => {
        const { site, order, sessionId, user } = seedPendingSite('inv-renew');
        const subscriptionId = 'sub_test_invr_' + crypto.randomBytes(4).toString('hex');
        await onStripeEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: sessionId,
                    payment_status: 'no_payment_required',
                    customer: 'cus_test_invr',
                    subscription: subscriptionId,
                    metadata: { platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id },
                },
            },
        });

        // Force expiry, open a renewal checkout order, pay it.
        registry.updateSite(site.id, { paidUntil: new Date(Date.now() - 86400000).toISOString(), status: 'expired' });
        const renewSessionId = 'cs_test_inv_ren_' + crypto.randomBytes(6).toString('hex');
        const renewOrder = registry.createOrder({
            siteId: site.id, userId: user.id, amountCents: pricing.RENEWAL_CENTS, currency: 'eur',
            stripeSessionId: renewSessionId, kind: 'renewal',
        });
        await onStripeEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: renewSessionId,
                    payment_status: 'paid',
                    customer: 'cus_test_invr',
                    subscription: subscriptionId,
                    metadata: { platform: 'web', orderId: renewOrder.id, siteId: site.id, kind: 'renewal', userId: user.id },
                },
            },
        });

        const history = webpublish.getInvoiceHistory(registry.getSite(site.id));
        assert.strictEqual(history.length, 2, 'first-year + renewal both recorded');
        assert.strictEqual(history[0].kind, 'renewal', 'newest (renewal) must come first');
        assert.strictEqual(history[0].amountCents, pricing.RENEWAL_CENTS);
        assert.strictEqual(history[1].kind, 'publish');
    });

    await check('real-Stripe renewal path (invoice.payment_succeeded) records hosted invoice / PDF links', async () => {
        const { site, order, sessionId, user } = seedPendingSite('inv-stripe');
        const subscriptionId = 'sub_test_invs_' + crypto.randomBytes(4).toString('hex');
        await onStripeEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: sessionId,
                    payment_status: 'no_payment_required',
                    customer: 'cus_test_invs',
                    subscription: subscriptionId,
                    metadata: { platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id },
                },
            },
        });

        // handleStripeInvoicePaid ignores a "renewal" invoice that arrives while
        // paidUntil is still far in the future (RENEWAL_DUE_WINDOW_MS = 45 days) —
        // that guard exists to skip the same-cycle subscription_create invoice.
        // Move paidUntil into the due window so this reads as a genuine renewal.
        registry.updateSite(site.id, { paidUntil: new Date(Date.now() + 10 * 86400000).toISOString() });

        const invoiceId = 'in_' + crypto.randomUUID().slice(0, 8);
        await webpublish.handleStripeInvoicePaid({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_succeeded',
            data: {
                object: {
                    id: invoiceId,
                    subscription: subscriptionId,
                    billing_reason: 'subscription_cycle',
                    amount_paid: 2900,
                    currency: 'eur',
                    hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/' + invoiceId,
                    invoice_pdf: 'https://invoice.stripe.com/i/acct_x/' + invoiceId + '/pdf',
                },
            },
        });

        const history = webpublish.getInvoiceHistory(registry.getSite(site.id));
        const renewalEntry = history.find((h) => h.invoiceId === invoiceId);
        assert.ok(renewalEntry, 'renewal invoice entry must exist');
        assert.strictEqual(renewalEntry.kind, 'renewal');
        assert.strictEqual(renewalEntry.amountCents, 2900);
        assert.ok(renewalEntry.hostedInvoiceUrl.includes(invoiceId));
        assert.ok(renewalEntry.invoicePdf.endsWith('/pdf'));
    });

    await check('payments.listCustomerInvoices: offline/no key → [] (never throws, never blocks the dashboard)', async () => {
        const payments = require('../payments.js');
        const result = await payments.listCustomerInvoices('cus_does_not_matter');
        assert.deepStrictEqual(result, []);
        const result2 = await payments.listCustomerInvoices('');
        assert.deepStrictEqual(result2, []);
    });

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll wave7-payments-invoices checks passed.');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
