'use strict';
/**
 * A Checkout promotion redeemed onto the subscription must survive the
 * first-then-renewal schedule rewrite. Otherwise Stripe accepts the code in
 * Checkout but the later schedule update removes its discount before invoice.
 */

const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '0';
process.env.STRIPE_SECRET_KEY = 'sk_test_promo_schedule_regression';

const payments = require('../payments.js');

function form(body) {
    return Object.fromEntries(new URLSearchParams(String(body || '')).entries());
}

(async () => {
    const originalFetch = global.fetch;
    const posts = [];
    global.fetch = async (url, options = {}) => {
        const body = String(options.body || '');
        posts.push({ url: String(url), body });
        if (String(url).endsWith('/subscription_schedules')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'sub_sched_promo',
                    phases: [{
                        start_date: 1000,
                        trial_end: 2000,
                        items: [{ price: 'price_first', quantity: 1 }],
                        discounts: [{ id: 'di_promo_from_checkout' }],
                    }],
                }),
            };
        }
        if (String(url).endsWith('/prices/price_first')) {
            return { ok: true, status: 200, json: async () => ({ id: 'price_first', product: 'prod_1' }) };
        }
        if (String(url).endsWith('/subscription_schedules/sub_sched_promo')) {
            return { ok: true, status: 200, json: async () => ({ id: 'sub_sched_promo' }) };
        }
        throw new Error('Unexpected Stripe request: ' + url);
    };

    try {
        await payments.attachFirstThenRenewalSchedule({
            subscriptionId: 'sub_promo',
            currency: 'eur',
            productName: 'Hidook Site Builder',
            renewalPriceId: 'price_renewal',
            contract: { firstPeriodCents: 9900, renewalCents: 2900, trialDays: 7 },
        });
        const update = posts.find((entry) => entry.url.endsWith('/subscription_schedules/sub_sched_promo'));
        assert.ok(update, 'must update the created subscription schedule');
        assert.strictEqual(
            form(update.body)['phases[0][discounts][0][discount]'],
            'di_promo_from_checkout',
            'the current phase must retain the Checkout-applied Stripe discount'
        );
        console.log('PASS Checkout-applied promotion survives schedule phase rewrite');
    } finally {
        global.fetch = originalFetch;
        delete process.env.STRIPE_SECRET_KEY;
    }
})().catch((error) => {
    console.error('FAIL Checkout-applied promotion survives schedule phase rewrite -', error.message);
    process.exitCode = 1;
});
