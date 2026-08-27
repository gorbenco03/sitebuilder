'use strict';
/**
 * bot/test/wave8-stripe-99-then-29.test.js — Wave 8 commercial billing contract.
 *
 * VISION: after the 7-day card trial, first charge is 99 (PRICE_CENTS=9900);
 * subsequent yearly periods are 29 (RENEWAL_CENTS=2900). Checkout must NOT
 * start a forever-9900 yearly subscription.
 *
 * Run: node bot/test/wave8-stripe-99-then-29.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const path   = require('path');

// Isolated env before loading payments (no network, no live keys).
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_PRICE_ID;
delete process.env.STRIPE_PRICE_ID_EUR;
delete process.env.STRIPE_PRICE_ID_GBP;
delete process.env.STRIPE_PRICE_ID_USD;
delete process.env.STRIPE_PRICE_ID_RENEWAL;
delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
delete process.env.STRIPE_PRICE_ID_RENEWAL_GBP;
delete process.env.STRIPE_PRICE_ID_RENEWAL_USD;
process.env.HIDOOK_TEST_PAY = '1';

const payments = require('../payments.js');
const pricing  = require('../pricing.js');

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

/**
 * Extract yearly unit_amount values and price ids from a Checkout Session form body.
 * @param {Record<string,string>} form
 */
function lineItemAudit(form) {
    const unitAmounts = [];
    const recurringAmounts = [];
    const oneTimeAmounts = [];
    const priceIds = [];
    const keys = Object.keys(form);
    const indices = new Set();
    for (const k of keys) {
        const m = /^line_items\[(\d+)\]/.exec(k);
        if (m) indices.add(Number(m[1]));
    }
    for (const i of [...indices].sort((a, b) => a - b)) {
        const price = form[`line_items[${i}][price]`];
        if (price) priceIds.push(price);
        const amt = form[`line_items[${i}][price_data][unit_amount]`];
        const interval = form[`line_items[${i}][price_data][recurring][interval]`];
        if (amt != null) {
            unitAmounts.push(Number(amt));
            if (interval) recurringAmounts.push(Number(amt));
            else oneTimeAmounts.push(Number(amt));
        }
    }
    return { unitAmounts, recurringAmounts, oneTimeAmounts, priceIds, indices: [...indices] };
}

/**
 * True when the captured Checkout body would bill 9900 every year forever
 * with no renewal step-down to RENEWAL_CENTS.
 */
function isForeverFirstPriceYearly(form, firstCents, renewalCents) {
    const audit = lineItemAudit(form);
    // Single recurring line at first-period amount and nothing that schedules renewal.
    const onlyRecurringFirst =
        audit.recurringAmounts.length === 1 &&
        audit.recurringAmounts[0] === firstCents &&
        audit.oneTimeAmounts.length === 0 &&
        audit.priceIds.length === 0;
    const renewalInMeta =
        form['metadata[renewal_cents]'] === String(renewalCents) ||
        form['subscription_data[metadata][renewal_cents]'] === String(renewalCents) ||
        form['metadata[hidook_renewal_cents]'] === String(renewalCents) ||
        form['subscription_data[metadata][hidook_renewal_cents]'] === String(renewalCents);
    const renewalPricePresent = Boolean(
        form['line_items[1][price]'] ||
        form['line_items[0][price]'] && form['metadata[renewal_price_id]'] ||
        form['subscription_data[metadata][renewal_price_id]']
    );
    const recurringIncludesRenewal = audit.recurringAmounts.includes(renewalCents);
    if (onlyRecurringFirst && !renewalInMeta && !renewalPricePresent && !recurringIncludesRenewal) {
        return true;
    }
    // Catalog single price at first-year id with no renewal price id → forever first price.
    if (
        audit.priceIds.length === 1 &&
        audit.recurringAmounts.length === 0 &&
        !form['metadata[renewal_price_id]'] &&
        !form['subscription_data[metadata][renewal_price_id]'] &&
        !form['metadata[renewal_cents]'] &&
        !form['subscription_data[metadata][renewal_cents]']
    ) {
        return true;
    }
    return false;
}

/**
 * Assert subscription checkout encodes 99-then-29 (first charge PRICE_CENTS,
 * later years RENEWAL_CENTS), not forever-PRICE_CENTS.
 */
function assertNinetyNineThenTwentyNine(form, contract) {
    assert.strictEqual(form.mode, 'subscription', 'mode must be subscription');
    assert.strictEqual(
        form['subscription_data[trial_period_days]'],
        '7',
        'trial_period_days must stay 7'
    );
    assert.ok(
        !isForeverFirstPriceYearly(form, pricing.PRICE_CENTS, pricing.RENEWAL_CENTS),
        'must not start a forever-' + pricing.PRICE_CENTS + ' yearly subscription'
    );

    const first = contract && contract.firstPeriodCents != null
        ? contract.firstPeriodCents
        : pricing.PRICE_CENTS;
    const renew = contract && contract.renewalCents != null
        ? contract.renewalCents
        : pricing.RENEWAL_CENTS;

    assert.strictEqual(first, pricing.PRICE_CENTS, 'first period must be PRICE_CENTS (9900)');
    assert.strictEqual(renew, pricing.RENEWAL_CENTS, 'renewal must be RENEWAL_CENTS (2900)');

    const audit = lineItemAudit(form);

    // Renewal must appear as recurring unit_amount and/or renewal catalog price / metadata.
    const renewalCentsInForm =
        form['metadata[renewal_cents]'] === String(renew) ||
        form['subscription_data[metadata][renewal_cents]'] === String(renew) ||
        form['metadata[hidook_renewal_cents]'] === String(renew) ||
        form['subscription_data[metadata][hidook_renewal_cents]'] === String(renew);
    const renewalAmountRecurring = audit.recurringAmounts.includes(renew);
    const renewalPrice =
        form['line_items[1][price]'] ||
        form['metadata[renewal_price_id]'] ||
        form['subscription_data[metadata][renewal_price_id]'];

    assert.ok(
        renewalAmountRecurring || renewalCentsInForm || renewalPrice,
        'renewal ' + renew + ' must be present as recurring amount, metadata, or renewal price id'
    );

    // First-period 9900 must be present (unit_amount, metadata, or first-year catalog price).
    const firstInMeta =
        form['metadata[first_period_cents]'] === String(first) ||
        form['subscription_data[metadata][first_period_cents]'] === String(first) ||
        form['metadata[hidook_first_period_cents]'] === String(first) ||
        form['subscription_data[metadata][hidook_first_period_cents]'] === String(first);
    const firstAmountPresent =
        audit.unitAmounts.includes(first) ||
        audit.oneTimeAmounts.includes(first) ||
        // first-year premium = first - renew on a one-time line next to recurring renew
        audit.oneTimeAmounts.includes(first - renew) ||
        firstInMeta ||
        audit.priceIds.length >= 1;

    assert.ok(
        firstAmountPresent,
        'first-period ' + first + ' must appear in line_items or metadata'
    );

    // Recurring yearly amount must not be solely forever-first without renewal step-down.
    if (audit.recurringAmounts.length === 1 && audit.recurringAmounts[0] === first) {
        assert.ok(
            renewalCentsInForm || renewalPrice || audit.oneTimeAmounts.length > 0,
            'single recurring at first-period amount requires an explicit renewal step-down'
        );
    }

    // If recurring is only the first-period amount with no renewal signal → fail.
    assert.ok(
        !(audit.recurringAmounts.length === 1 &&
            audit.recurringAmounts[0] === first &&
            !renewalCentsInForm &&
            !renewalPrice),
        'refusing forever-' + first + ' yearly with no renewal contract'
    );
}

(async () => {
    await check('pricing constants: first 9900, renewal 2900', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
        assert.notStrictEqual(pricing.PRICE_CENTS, pricing.RENEWAL_CENTS);
    });

    // ── Inline price_data: not forever-9900 ─────────────────────────────────
    await check('inline createCheckout: after trial first 99 then yearly 29 (not forever 9900)', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave8_inline_not_a_real_key';
        delete process.env.STRIPE_PRICE_ID;
        delete process.env.STRIPE_PRICE_ID_EUR;
        delete process.env.STRIPE_PRICE_ID_RENEWAL;
        delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;

        const origFetch = global.fetch;
        let capturedBody = null;
        global.fetch = async (_url, opts) => {
            capturedBody = opts && opts.body;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'cs_test_wave8_inline',
                    url: 'https://checkout.stripe.com/c/pay/cs_test_wave8_inline',
                }),
            };
        };
        try {
            const co = await payments.createCheckout({
                amountCents: pricing.PRICE_CENTS,
                renewalCents: pricing.RENEWAL_CENTS,
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                successUrl: 'http://127.0.0.1/ok',
                cancelUrl: 'http://127.0.0.1/cancel',
                metadata: { platform: 'web', kind: 'publish' },
            });
            assert.strictEqual(co.id, 'cs_test_wave8_inline');
            const form = parseStripeForm(capturedBody);
            assertNinetyNineThenTwentyNine(form, co.contract || {
                firstPeriodCents: pricing.PRICE_CENTS,
                renewalCents: pricing.RENEWAL_CENTS,
            });
            // Explicit: recurring yearly must include 2900, not only 9900 forever.
            const audit = lineItemAudit(form);
            const foreverOnly =
                audit.recurringAmounts.length === 1 &&
                audit.recurringAmounts[0] === pricing.PRICE_CENTS &&
                audit.oneTimeAmounts.length === 0;
            assert.ok(!foreverOnly, 'line_items must not be a single forever-9900 yearly price_data');
            assert.ok(
                audit.recurringAmounts.includes(pricing.RENEWAL_CENTS) ||
                    form['metadata[renewal_cents]'] === String(pricing.RENEWAL_CENTS) ||
                    form['subscription_data[metadata][renewal_cents]'] === String(pricing.RENEWAL_CENTS),
                'renewal 2900 must be on the Stripe body'
            );
        } finally {
            global.fetch = origFetch;
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
        }
    });

    // ── Catalog first price without renewal must not silently bill 99 forever ─
    await check('catalog STRIPE_PRICE_ID without renewal: fail closed or attach 29 from pricing', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        const prevEur = process.env.STRIPE_PRICE_ID_EUR;
        const prevRen = process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
        const prevRenG = process.env.STRIPE_PRICE_ID_RENEWAL;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave8_catalog_not_real';
        process.env.STRIPE_PRICE_ID_EUR = 'price_test_first_99_eur';
        delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
        delete process.env.STRIPE_PRICE_ID_RENEWAL;

        const origFetch = global.fetch;
        let capturedBody = null;
        let fetchCalled = false;
        global.fetch = async (_url, opts) => {
            fetchCalled = true;
            capturedBody = opts && opts.body;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'cs_test_wave8_catalog',
                    url: 'https://checkout.stripe.com/c/pay/cs_test_wave8_catalog',
                }),
            };
        };
        try {
            let threw = null;
            let co = null;
            try {
                co = await payments.createCheckout({
                    amountCents: pricing.PRICE_CENTS,
                    currency: 'eur',
                    productName: 'Hidook Site Builder site activation',
                    successUrl: 'http://127.0.0.1/ok',
                    cancelUrl: 'http://127.0.0.1/cancel',
                });
            } catch (e) {
                threw = e;
            }
            if (threw) {
                assert.ok(
                    /renewal|RENEWAL|29|forever|9900/i.test(threw.message),
                    'fail-closed error must mention renewal contract: ' + threw.message
                );
                assert.ok(!fetchCalled, 'fail-closed must not call Stripe');
            } else {
                assert.ok(fetchCalled, 'success path must POST checkout session');
                const form = parseStripeForm(capturedBody);
                assert.ok(
                    !isForeverFirstPriceYearly(form, pricing.PRICE_CENTS, pricing.RENEWAL_CENTS),
                    'catalog without renewal env must not bill 99 forever'
                );
                assertNinetyNineThenTwentyNine(form, co && co.contract);
            }
        } finally {
            global.fetch = origFetch;
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
            if (prevEur === undefined) delete process.env.STRIPE_PRICE_ID_EUR;
            else process.env.STRIPE_PRICE_ID_EUR = prevEur;
            if (prevRen === undefined) delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
            else process.env.STRIPE_PRICE_ID_RENEWAL_EUR = prevRen;
            if (prevRenG === undefined) delete process.env.STRIPE_PRICE_ID_RENEWAL;
            else process.env.STRIPE_PRICE_ID_RENEWAL = prevRenG;
        }
    });

    // ── Both catalog prices: first + renewal ────────────────────────────────
    await check('catalog first + STRIPE_PRICE_ID_RENEWAL_* attaches 29/year renewal price', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave8_both_catalog';
        process.env.STRIPE_PRICE_ID_EUR = 'price_test_first_99_eur';
        process.env.STRIPE_PRICE_ID_RENEWAL_EUR = 'price_test_renewal_29_eur';

        const origFetch = global.fetch;
        let capturedBody = null;
        global.fetch = async (_url, opts) => {
            capturedBody = opts && opts.body;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'cs_test_wave8_both',
                    url: 'https://checkout.stripe.com/c/pay/cs_test_wave8_both',
                }),
            };
        };
        try {
            await payments.createCheckout({
                amountCents: pricing.PRICE_CENTS,
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                successUrl: 'http://127.0.0.1/ok',
                cancelUrl: 'http://127.0.0.1/cancel',
            });
            const form = parseStripeForm(capturedBody);
            assert.strictEqual(form.mode, 'subscription');
            assert.strictEqual(form['subscription_data[trial_period_days]'], '7');
            const prices = lineItemAudit(form).priceIds;
            const renewalMeta =
                form['metadata[renewal_price_id]'] ||
                form['subscription_data[metadata][renewal_price_id]'];
            assert.ok(
                prices.includes('price_test_renewal_29_eur') ||
                    renewalMeta === 'price_test_renewal_29_eur' ||
                    prices.includes('price_test_first_99_eur') && renewalMeta === 'price_test_renewal_29_eur',
                'renewal catalog price must be attached (line item or metadata), got prices=' +
                    JSON.stringify(prices) + ' renewalMeta=' + renewalMeta
            );
            assert.ok(
                !isForeverFirstPriceYearly(form, pricing.PRICE_CENTS, pricing.RENEWAL_CENTS),
                'must not be forever-first-price when renewal price env is set'
            );
        } finally {
            global.fetch = origFetch;
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
            delete process.env.STRIPE_PRICE_ID_EUR;
            delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
        }
    });

    // ── HIDOOK_TEST_PAY offline records same 99-then-29 contract ───────────
    await check('HIDOOK_TEST_PAY offline createCheckout records 99-then-29 contract', async () => {
        process.env.HIDOOK_TEST_PAY = '1';
        delete process.env.STRIPE_SECRET_KEY;
        assert.ok(payments.isConfigured());
        const co = await payments.createCheckout({
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            productName: 'Hidook Site Builder site activation',
            successUrl: 'http://127.0.0.1/app/#paid',
            cancelUrl: 'http://127.0.0.1/app/#cancelled',
            metadata: { platform: 'web', kind: 'publish' },
        });
        assert.ok(/^cs_test_[a-f0-9]+$/.test(co.id), 'offline id cs_test_*');
        assert.ok(co.url.includes('#test-checkout=' + co.id), 'hash offline URL');
        assert.ok(co.contract && typeof co.contract === 'object', 'offline path must return contract');
        assert.strictEqual(co.contract.firstPeriodCents, pricing.PRICE_CENTS, 'contract first 9900');
        assert.strictEqual(co.contract.renewalCents, pricing.RENEWAL_CENTS, 'contract renewal 2900');
        assert.strictEqual(co.contract.trialDays, 7, 'contract trial 7 days');
        assert.strictEqual(co.contract.interval, 'year', 'contract yearly');
        assert.notStrictEqual(
            co.contract.firstPeriodCents,
            co.contract.renewalCents,
            'must not record forever-same amount'
        );
    });

    // ── OWNER how-to lists two catalog Prices ─────────────────────────────
    await check('OWNER-STRIPE-TRIAL.md lists first-year 99 and renewal 29 catalog Prices', () => {
        const fs = require('fs');
        const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'OWNER-STRIPE-TRIAL.md'), 'utf8');
        assert.ok(/Hidook Site Builder/i.test(doc), 'owner doc names Hidook Site Builder');
        assert.ok(/7[\s-]*day/i.test(doc), 'owner doc mentions 7-day trial');
        assert.ok(
            /STRIPE_PRICE_ID_RENEWAL/i.test(doc),
            'owner doc must document STRIPE_PRICE_ID_RENEWAL_* env'
        );
        assert.ok(
            /99/.test(doc) && /29/.test(doc),
            'owner doc must state 99 first year and 29 renewal'
        );
        assert.ok(
            /first/i.test(doc) && /renew/i.test(doc),
            'owner doc must distinguish first-year vs renewal Prices'
        );
        assert.ok(!/\bDESSERD\b/i.test(doc), 'no DESSERD');
        assert.ok(!/\bKanban\b/i.test(doc), 'no Kanban jargon');
        assert.ok(!/sk_live_[A-Za-z0-9]+/.test(doc), 'no live secret material');
        assert.ok(!/sk_test_[A-Za-z0-9]{8,}/.test(doc), 'no real test secret material');
    });

    // ── resolveStripeRenewalPriceId helper (when exported) ────────────────
    await check('resolveStripeRenewalPriceId prefers currency then generic', () => {
        assert.strictEqual(typeof payments.resolveStripeRenewalPriceId, 'function',
            'payments must export resolveStripeRenewalPriceId');
        delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
        delete process.env.STRIPE_PRICE_ID_RENEWAL;
        assert.strictEqual(payments.resolveStripeRenewalPriceId('eur'), null);
        process.env.STRIPE_PRICE_ID_RENEWAL = 'price_ren_generic';
        assert.strictEqual(payments.resolveStripeRenewalPriceId('eur'), 'price_ren_generic');
        process.env.STRIPE_PRICE_ID_RENEWAL_EUR = 'price_ren_eur';
        assert.strictEqual(payments.resolveStripeRenewalPriceId('eur'), 'price_ren_eur');
        delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
        delete process.env.STRIPE_PRICE_ID_RENEWAL;
    });

    if (failed) {
        console.error('\nwave8-stripe-99-then-29.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave8-stripe-99-then-29.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
