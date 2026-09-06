'use strict';
/**
 * bot/test/wave7-payments-vat.test.js — Wave7 audit medium #10 (VAT).
 *
 * Audit: "automatic_tax is absent from Checkout and unmentioned in the
 * runbook. This product sells to Romanian and EU small businesses; charging
 * without handling VAT correctly is a compliance problem."
 *
 * Fix shape (bot/payments.js):
 *   - STRIPE_AUTOMATIC_TAX=1 (opt-in, default OFF) turns on Stripe Tax on
 *     Checkout: automatic_tax, billing_address_collection: 'required',
 *     tax_id_collection (B2B VAT id → reverse charge).
 *   - Opt-in, not automatic, because automatic_tax on an account that has
 *     not configured Stripe Tax registrations FAILS Checkout Session
 *     creation outright — enabling it unconditionally would be strictly
 *     worse than today's VAT gap (100% checkout outage vs. a compliance
 *     gap). See payments.js#_automaticTaxEnabled and OWNER-STRIPE-TRIAL.md.
 *   - tax_behavior:'exclusive' on every inline price_data (Checkout line AND
 *     the renewal-phase Price created by ensureRenewalPriceId) regardless of
 *     the flag, so a later flag-flip computes VAT on top of 99/29 rather
 *     than leaving Stripe to guess.
 *
 * Run: node bot/test/wave7-payments-vat.test.js
 */

const assert = require('assert');

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

/** Parse application/x-www-form-urlencoded Stripe body into a flat map. */
function parseStripeForm(body) {
    const map = {};
    for (const part of String(body || '').split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
        const v = decodeURIComponent(i < 0 ? '' : part.slice(i + 1));
        map[k] = v;
    }
    return map;
}

function installFetchRecorder(responder) {
    const posts = [];
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
        const u = String(url);
        const body = (opts && opts.body) || '';
        if (opts && String(opts.method || 'GET').toUpperCase() === 'POST') {
            posts.push({ url: u, body: String(body) });
        }
        const json = responder(u, String(body), posts);
        return { ok: true, status: 200, json: async () => json };
    };
    return { posts, restore() { global.fetch = origFetch; } };
}

function freshEnv() {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    delete process.env.STRIPE_PRICE_ID_EUR;
    delete process.env.STRIPE_PRICE_ID_RENEWAL;
    delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
    delete process.env.STRIPE_AUTOMATIC_TAX;
    process.env.HIDOOK_TEST_PAY = '0';
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
}

(async () => {
    await check('automatic_tax OFF by default (no env flag) — Checkout body has none of the tax fields', async () => {
        freshEnv();
        delete require.cache[require.resolve('../payments.js')];
        const payments = require('../payments.js');
        const rec = installFetchRecorder((url) => {
            if (/\/checkout\/sessions/.test(url)) {
                return { id: 'cs_test_vat_off', url: 'https://checkout.stripe.com/c/pay/cs_test_vat_off' };
            }
            return {};
        });
        process.env.STRIPE_SECRET_KEY = 'sk_test_vat_off';
        try {
            await payments.createCheckout({
                amountCents: 9900,
                currency: 'eur',
                productName: 'Hidook Site Builder',
                successUrl: 'https://example.com/s',
                cancelUrl: 'https://example.com/c',
            });
        } finally {
            rec.restore();
        }
        const checkoutPost = rec.posts.find((p) => /\/checkout\/sessions/.test(p.url));
        assert.ok(checkoutPost, 'must POST to /checkout/sessions');
        const form = parseStripeForm(checkoutPost.body);
        assert.strictEqual(form['automatic_tax[enabled]'], undefined, 'automatic_tax must be absent by default');
        assert.strictEqual(form['billing_address_collection'], undefined, 'billing_address_collection must be absent by default');
        assert.strictEqual(form['tax_id_collection[enabled]'], undefined, 'tax_id_collection must be absent by default');
    });

    await check('STRIPE_AUTOMATIC_TAX=1 turns on automatic_tax + billing address + VAT id collection', async () => {
        freshEnv();
        process.env.STRIPE_AUTOMATIC_TAX = '1';
        delete require.cache[require.resolve('../payments.js')];
        const payments = require('../payments.js');
        const rec = installFetchRecorder((url) => {
            if (/\/checkout\/sessions/.test(url)) {
                return { id: 'cs_test_vat_on', url: 'https://checkout.stripe.com/c/pay/cs_test_vat_on' };
            }
            return {};
        });
        process.env.STRIPE_SECRET_KEY = 'sk_test_vat_on';
        try {
            await payments.createCheckout({
                amountCents: 9900,
                currency: 'eur',
                productName: 'Hidook Site Builder',
                successUrl: 'https://example.com/s',
                cancelUrl: 'https://example.com/c',
            });
        } finally {
            rec.restore();
        }
        const checkoutPost = rec.posts.find((p) => /\/checkout\/sessions/.test(p.url));
        const form = parseStripeForm(checkoutPost.body);
        assert.strictEqual(form['automatic_tax[enabled]'], 'true', 'automatic_tax must be enabled');
        assert.strictEqual(form['billing_address_collection'], 'required', 'billing address must be required for a VAT-compliant invoice + tax calc');
        assert.strictEqual(form['tax_id_collection[enabled]'], 'true', 'tax_id_collection must be enabled for B2B VAT id / reverse charge');
    });

    await check('inline price_data always carries tax_behavior:exclusive (Checkout line + renewal Price), flag-independent', async () => {
        freshEnv();
        delete require.cache[require.resolve('../payments.js')];
        const payments = require('../payments.js');
        const rec = installFetchRecorder((url) => {
            if (/\/checkout\/sessions/.test(url)) {
                return { id: 'cs_test_taxbehavior', url: 'https://checkout.stripe.com/c/pay/x', subscription: 'sub_test_taxbehavior' };
            }
            // POST /subscription_schedules (from_subscription=...) — creation call, no id in path.
            if (/\/subscription_schedules$/.test(url)) {
                return {
                    id: 'sub_sched_taxbehavior',
                    phases: [{ start_date: 1000, trial_end: 1000 + 7 * 86400, items: [{ price: 'price_first_taxbehavior', quantity: 1 }] }],
                };
            }
            if (/\/prices\/price_first_taxbehavior/.test(url)) {
                return { id: 'price_first_taxbehavior', product: 'prod_taxbehavior' };
            }
            if (/\/prices$/.test(url)) {
                return { id: 'price_renewal_taxbehavior' };
            }
            // POST /subscription_schedules/:id (phase update) — id in path.
            if (/\/subscription_schedules\/sub_sched_taxbehavior$/.test(url)) {
                return { id: 'sub_sched_taxbehavior', object: 'subscription_schedule' };
            }
            return {};
        });
        process.env.STRIPE_SECRET_KEY = 'sk_test_taxbehavior';
        try {
            await payments.createCheckout({
                amountCents: 9900,
                renewalCents: 2900,
                currency: 'eur',
                productName: 'Hidook Site Builder',
                successUrl: 'https://example.com/s',
                cancelUrl: 'https://example.com/c',
            });
            const checkoutPost = rec.posts.find((p) => /\/checkout\/sessions/.test(p.url));
            const form = parseStripeForm(checkoutPost.body);
            assert.strictEqual(form['line_items[0][price_data][tax_behavior]'], 'exclusive', 'Checkout line price_data must set tax_behavior');

            await payments.attachFirstThenRenewalSchedule({
                subscriptionId: 'sub_test_taxbehavior',
                currency: 'eur',
                contract: { firstPeriodCents: 9900, renewalCents: 2900, trialDays: 7 },
            });
            const pricePost = rec.posts.find((p) => /\/prices$/.test(p.url));
            assert.ok(pricePost, 'must create a renewal Price via /prices');
            const priceForm = parseStripeForm(pricePost.body);
            assert.strictEqual(priceForm['tax_behavior'], 'exclusive', 'renewal-phase Price must also set tax_behavior');
        } finally {
            rec.restore();
        }
    });

    await check('HIDOOK_TEST_PAY offline checkout never calls Stripe — automatic_tax flag is inert there', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        process.env.HIDOOK_TEST_PAY = '1';
        process.env.STRIPE_AUTOMATIC_TAX = '1';
        delete require.cache[require.resolve('../payments.js')];
        const payments = require('../payments.js');
        const before = global.fetch;
        let called = false;
        global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
        try {
            const out = await payments.createCheckout({
                amountCents: 9900,
                currency: 'eur',
                productName: 'Hidook Site Builder',
                successUrl: 'https://example.com/s',
                cancelUrl: 'https://example.com/c',
            });
            assert.ok(out.id.startsWith('cs_test_'));
            assert.strictEqual(called, false, 'offline test-pay must never hit the network');
        } finally {
            global.fetch = before;
        }
    });

    await check('RO_ERRORS.ALREADY_ACTIVE_SUBSCRIPTION exists, Romanian, with diacritics', () => {
        delete require.cache[require.resolve('../payments.js')];
        const payments = require('../payments.js');
        const msg = payments.RO_ERRORS.ALREADY_ACTIVE_SUBSCRIPTION;
        assert.ok(msg && msg.length > 10, 'must exist');
        assert.ok(/[ăâîșț]/i.test(msg), 'must carry Romanian diacritics');
        assert.ok(/abonament/i.test(msg), 'must mention the existing subscription');
    });

    await check('SUBSCRIPTION_ENTITLED_STATUSES is exactly active/trialing/past_due', () => {
        delete require.cache[require.resolve('../payments.js')];
        const payments = require('../payments.js');
        const set = payments.SUBSCRIPTION_ENTITLED_STATUSES;
        assert.ok(set instanceof Set);
        assert.deepStrictEqual([...set].sort(), ['active', 'past_due', 'trialing']);
        assert.ok(!set.has('canceled'));
        assert.ok(!set.has('unpaid'));
        assert.ok(!set.has('incomplete_expired'));
    });

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll wave7-payments-vat checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
