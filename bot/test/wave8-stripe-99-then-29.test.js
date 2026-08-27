'use strict';
/**
 * bot/test/wave8-stripe-99-then-29.test.js — Wave 8-R2 commercial billing contract.
 *
 * VISION: $0 now (7-day card trial) → first charge PRICE_CENTS (9900) on day 7 →
 * later years RENEWAL_CENTS (2900) via a real Stripe Subscription Schedule phase.
 *
 * Rejected hybrids (must stay RED):
 *   - recurring 2900 + one-time 7000 + trial_period_days=7 (Stripe bills 70 now)
 *   - catalog first-year Price only with renewal in metadata (Stripe bills 99 forever)
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

/** True when any one-time (non-recurring) Checkout line item is present. */
function hasOneTimeLineItem(form) {
    return lineItemAudit(form).oneTimeAmounts.length > 0;
}

/**
 * Collect keys that look like subscription schedule phase fields on a form body.
 * @param {Record<string,string>} form
 */
function schedulePhaseAudit(form) {
    const phaseKeys = Object.keys(form).filter((k) =>
        /^phases\[\d+\]/.test(k) ||
        /^subscription_schedule/.test(k) ||
        /schedule.*phase/i.test(k)
    );
    const phaseAmounts = [];
    const phasePrices = [];
    for (const k of Object.keys(form)) {
        const mAmt = /^phases\[(\d+)\](?:\[items\]\[(\d+)\])?\[(?:price_data\]\[)?unit_amount\]?/.exec(k) ||
            /^phases\[(\d+)\]\[items\]\[(\d+)\]\[price_data\]\[unit_amount\]/.exec(k);
        if (mAmt && form[k] != null) phaseAmounts.push(Number(form[k]));
        const mPrice = /^phases\[(\d+)\]\[items\]\[(\d+)\]\[price\]$/.exec(k);
        if (mPrice) phasePrices.push(form[k]);
        const mPd = /^phases\[(\d+)\]\[items\]\[(\d+)\]\[price_data\]\[unit_amount\]$/.exec(k);
        if (mPd) phaseAmounts.push(Number(form[k]));
    }
    // Also accept nested encode: phases[1][items][0][price_data][unit_amount]
    for (const k of Object.keys(form)) {
        if (/^phases\[\d+\]\[items\]\[\d+\]\[price_data\]\[unit_amount\]$/.test(k)) {
            const n = Number(form[k]);
            if (!phaseAmounts.includes(n)) phaseAmounts.push(n);
        }
        if (/^phases\[\d+\]\[items\]\[\d+\]\[price\]$/.test(k)) {
            if (!phasePrices.includes(form[k])) phasePrices.push(form[k]);
        }
    }
    return { phaseKeys, phaseAmounts, phasePrices };
}

/**
 * Metadata-only renewal is NOT a Stripe billing schedule.
 * @param {Record<string,string>} form
 */
function renewalOnlyInMetadata(form) {
    const metaRenewal =
        form['metadata[renewal_cents]'] === String(pricing.RENEWAL_CENTS) ||
        form['subscription_data[metadata][renewal_cents]'] === String(pricing.RENEWAL_CENTS) ||
        form['metadata[renewal_price_id]'] ||
        form['subscription_data[metadata][renewal_price_id]'];
    const audit = lineItemAudit(form);
    const schedule = schedulePhaseAudit(form);
    const recurringHasRenewal = audit.recurringAmounts.includes(pricing.RENEWAL_CENTS);
    const scheduleHasRenewal =
        schedule.phaseAmounts.includes(pricing.RENEWAL_CENTS) ||
        schedule.phasePrices.some((p) => /renewal|29/i.test(p));
    return Boolean(metaRenewal) && !recurringHasRenewal && !scheduleHasRenewal && audit.oneTimeAmounts.length === 0;
}

/**
 * Assert Checkout Session body: trial 7, single first-period recurring 9900, no one-time companion.
 */
function assertCheckoutFirstPeriodOnly(form) {
    assert.strictEqual(form.mode, 'subscription', 'mode must be subscription');
    assert.strictEqual(
        form['subscription_data[trial_period_days]'],
        '7',
        'trial_period_days must stay 7'
    );
    assert.ok(
        !hasOneTimeLineItem(form),
        'Checkout must not send a one-time line item together with trial_period_days=7 ' +
            '(Stripe charges one-time up front; wanted $0 now then 99 on day 7)'
    );
    const audit = lineItemAudit(form);
    if (audit.priceIds.length === 0) {
        // Inline price_data path: single recurring at PRICE_CENTS (9900), not RENEWAL_CENTS.
        assert.ok(
            audit.recurringAmounts.includes(pricing.PRICE_CENTS),
            'recurring Checkout amount for first paid period must be PRICE_CENTS (9900), got ' +
                JSON.stringify(audit.recurringAmounts)
        );
        assert.ok(
            !audit.recurringAmounts.includes(pricing.RENEWAL_CENTS) ||
                audit.recurringAmounts.includes(pricing.PRICE_CENTS),
            'first paid period must not be sole recurring RENEWAL_CENTS (2900)'
        );
        assert.strictEqual(
            audit.recurringAmounts.filter((a) => a === pricing.PRICE_CENTS).length >= 1,
            true
        );
        // Reject the hybrid: recurring 2900 as the subscription price.
        assert.ok(
            !(audit.recurringAmounts.length === 1 && audit.recurringAmounts[0] === pricing.RENEWAL_CENTS),
            'must not use recurring RENEWAL_CENTS (2900) as the Checkout subscription price ' +
                'when first period is 9900 (that bills 29 after trial, not 99)'
        );
        assert.ok(
            audit.recurringAmounts.length === 1 && audit.recurringAmounts[0] === pricing.PRICE_CENTS,
            'inline Checkout must be a single recurring line at PRICE_CENTS (9900)'
        );
    } else {
        // Catalog: first-year Price only on Checkout line_items (renewal via schedule later).
        assert.ok(audit.priceIds.length >= 1, 'catalog path needs a Price id');
        assert.strictEqual(audit.oneTimeAmounts.length, 0, 'catalog path: no one-time lines');
    }
}

/**
 * Assert captured Stripe HTTP traffic includes a real subscription schedule that
 * steps down to RENEWAL_CENTS (not metadata alone).
 * @param {{ url: string, body: string }[]} posts
 */
function assertScheduleRenewalPhase(posts) {
    const schedulePosts = posts.filter((p) => /\/subscription_schedules/.test(p.url));
    assert.ok(
        schedulePosts.length >= 1,
        'must POST subscription_schedules (or update a schedule) so year-2+ bills RENEWAL_CENTS — ' +
            'session/subscription metadata alone is not Stripe billing'
    );

    let sawRenewal = false;
    let sawFromSub = false;
    let sawPhase1 = false;

    for (const p of schedulePosts) {
        const form = parseStripeForm(p.body);
        if (form.from_subscription) sawFromSub = true;
        const phases = schedulePhaseAudit(form);
        if (phases.phaseKeys.some((k) => /^phases\[1\]/.test(k)) || form['phases[1][items][0][price]'] ||
            form['phases[1][items][0][price_data][unit_amount]']) {
            sawPhase1 = true;
        }
        if (
            phases.phaseAmounts.includes(pricing.RENEWAL_CENTS) ||
            form['phases[1][items][0][price_data][unit_amount]'] === String(pricing.RENEWAL_CENTS) ||
            (form['phases[1][items][0][price]'] && form['phases[1][items][0][price]'].length > 0) ||
            Object.keys(form).some((k) =>
                /^phases\[1\]/.test(k) && /unit_amount/.test(k) && form[k] === String(pricing.RENEWAL_CENTS)
            )
        ) {
            sawRenewal = true;
        }
        // Catalog renewal price id on phase 1 counts.
        if (form['phases[1][items][0][price]']) sawRenewal = true;
    }

    // Also accept a single create with two phases (no from_subscription).
    if (!sawRenewal) {
        for (const p of posts) {
            const form = parseStripeForm(p.body);
            if (form['phases[1][items][0][price_data][unit_amount]'] === String(pricing.RENEWAL_CENTS)) {
                sawRenewal = true;
            }
            if (form['phases[1][items][0][price]']) sawRenewal = true;
            if (Object.keys(form).some((k) => /^phases\[1\]/.test(k))) sawPhase1 = true;
        }
    }

    assert.ok(
        sawPhase1 || sawFromSub,
        'schedule must include a later phase (phases[1]) or from_subscription + update'
    );
    assert.ok(
        sawRenewal,
        'schedule phase must bill RENEWAL_CENTS (2900) or attach renewal Price id — not metadata only'
    );
}

/**
 * Mock fetch that records every Stripe POST (url + body).
 * @param {(url: string, body: string) => object} responder
 */
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
        return {
            ok: true,
            status: 200,
            json: async () => json,
        };
    };
    return {
        posts,
        restore() { global.fetch = origFetch; },
    };
}

(async () => {
    await check('pricing constants: first 9900, renewal 2900', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
        assert.notStrictEqual(pricing.PRICE_CENTS, pricing.RENEWAL_CENTS);
    });

    // ── Inline: single recurring 9900 + trial 7; NO one-time; schedule → 29 ──
    await check('inline: $0 trial, first paid 9900 recurring, no one-time, schedule phase 2900', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave8_r2_inline';
        delete process.env.STRIPE_PRICE_ID;
        delete process.env.STRIPE_PRICE_ID_EUR;
        delete process.env.STRIPE_PRICE_ID_RENEWAL;
        delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;

        const rec = installFetchRecorder((url) => {
            if (/\/checkout\/sessions/.test(url)) {
                return {
                    id: 'cs_test_wave8_inline',
                    url: 'https://checkout.stripe.com/c/pay/cs_test_wave8_inline',
                    subscription: 'sub_test_wave8_inline',
                };
            }
            if (/\/subscription_schedules\/sub_sched_/.test(url)) {
                return {
                    id: 'sub_sched_test_wave8',
                    object: 'subscription_schedule',
                    phases: [
                        { items: [{ price: 'price_first_99' }], start_date: 1700000000 },
                        { items: [{ price: 'price_renewal_29' }] },
                    ],
                };
            }
            if (/\/subscription_schedules/.test(url)) {
                return {
                    id: 'sub_sched_test_wave8',
                    object: 'subscription_schedule',
                    phases: [{
                        items: [{ price: 'price_first_99', quantity: 1 }],
                        start_date: 1700000000,
                        end_date: 1700000000 + 7 * 86400,
                        trial_end: 1700000000 + 7 * 86400,
                    }],
                    subscription: 'sub_test_wave8_inline',
                };
            }
            if (/\/prices/.test(url)) {
                return { id: 'price_renewal_29_inline', unit_amount: pricing.RENEWAL_CENTS };
            }
            if (/\/subscriptions\//.test(url)) {
                return {
                    id: 'sub_test_wave8_inline',
                    status: 'trialing',
                    trial_end: 1700000000 + 7 * 86400,
                    items: { data: [{ price: { id: 'price_first_99', unit_amount: pricing.PRICE_CENTS } }] },
                };
            }
            return { id: 'obj_test', ok: true };
        });

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

            const checkoutPosts = rec.posts.filter((p) => /\/checkout\/sessions/.test(p.url));
            assert.strictEqual(checkoutPosts.length, 1, 'exactly one Checkout Session create');
            const form = parseStripeForm(checkoutPosts[0].body);
            assertCheckoutFirstPeriodOnly(form);
            assert.ok(
                !renewalOnlyInMetadata(form) || typeof payments.attachFirstThenRenewalSchedule === 'function',
                'renewal must not live only in metadata without a schedule attach API'
            );

            // Schedule must run when the subscription exists (follow-up), not metadata alone.
            assert.strictEqual(
                typeof payments.attachFirstThenRenewalSchedule,
                'function',
                'payments must export attachFirstThenRenewalSchedule for post-checkout schedule'
            );
            await payments.attachFirstThenRenewalSchedule({
                subscriptionId: 'sub_test_wave8_inline',
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                contract: co.contract || {
                    firstPeriodCents: pricing.PRICE_CENTS,
                    renewalCents: pricing.RENEWAL_CENTS,
                    trialDays: 7,
                    interval: 'year',
                },
            });
            assertScheduleRenewalPhase(rec.posts);

            // Explicit reject of the old hybrid on the checkout body.
            const audit = lineItemAudit(form);
            assert.ok(
                !(audit.recurringAmounts.includes(pricing.RENEWAL_CENTS) &&
                    audit.oneTimeAmounts.includes(pricing.PRICE_CENTS - pricing.RENEWAL_CENTS)),
                'rejected hybrid: recurring 2900 + one-time 7000'
            );
        } finally {
            rec.restore();
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
        }
    });

    // ── Catalog first-only: fail closed OR real schedule phase at 2900 ─────
    await check('catalog STRIPE_PRICE_ID without renewal: fail closed or schedule phase 2900', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave8_r2_catalog';
        process.env.STRIPE_PRICE_ID_EUR = 'price_test_first_99_eur';
        delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
        delete process.env.STRIPE_PRICE_ID_RENEWAL;

        const rec = installFetchRecorder((url) => {
            if (/\/checkout\/sessions/.test(url)) {
                return {
                    id: 'cs_test_wave8_catalog',
                    url: 'https://checkout.stripe.com/c/pay/cs_test_wave8_catalog',
                    subscription: 'sub_test_catalog',
                };
            }
            if (/\/subscription_schedules\/sub_sched_/.test(url)) {
                return {
                    id: 'sub_sched_catalog',
                    phases: [
                        { items: [{ price: 'price_test_first_99_eur' }], start_date: 1700000000 },
                        { items: [{ price: 'price_ren_created' }] },
                    ],
                };
            }
            if (/\/subscription_schedules/.test(url)) {
                return {
                    id: 'sub_sched_catalog',
                    phases: [{
                        items: [{ price: 'price_test_first_99_eur', quantity: 1 }],
                        start_date: 1700000000,
                        trial_end: 1700000000 + 7 * 86400,
                    }],
                    subscription: 'sub_test_catalog',
                };
            }
            if (/\/prices/.test(url)) {
                return { id: 'price_ren_created', unit_amount: pricing.RENEWAL_CENTS };
            }
            return { id: 'obj_test' };
        });

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
                    /renewal|RENEWAL|29|forever|9900|schedule/i.test(threw.message),
                    'fail-closed error must mention renewal/schedule: ' + threw.message
                );
                const checkoutPosts = rec.posts.filter((p) => /\/checkout\/sessions/.test(p.url));
                assert.strictEqual(checkoutPosts.length, 0, 'fail-closed must not POST checkout');
            } else {
                const checkoutPosts = rec.posts.filter((p) => /\/checkout\/sessions/.test(p.url));
                assert.ok(checkoutPosts.length >= 1, 'success path POSTs checkout');
                const form = parseStripeForm(checkoutPosts[0].body);
                assertCheckoutFirstPeriodOnly(form);
                assert.strictEqual(form['line_items[0][price]'], 'price_test_first_99_eur');
                // Metadata alone is insufficient — must attach a real schedule phase.
                assert.strictEqual(typeof payments.attachFirstThenRenewalSchedule, 'function');
                await payments.attachFirstThenRenewalSchedule({
                    subscriptionId: 'sub_test_catalog',
                    currency: 'eur',
                    productName: 'Hidook Site Builder site activation',
                    contract: co.contract || {
                        firstPeriodCents: pricing.PRICE_CENTS,
                        renewalCents: pricing.RENEWAL_CENTS,
                    },
                    // no renewalPriceId — must create from pricing.js or fail
                });
                assertScheduleRenewalPhase(rec.posts);
                // Prove we did not treat metadata as the schedule.
                const onlyMeta =
                    form['metadata[renewal_cents]'] === String(pricing.RENEWAL_CENTS) &&
                    rec.posts.every((p) => !/\/subscription_schedules/.test(p.url));
                assert.ok(!onlyMeta, 'catalog-only must not silently bill 99 forever via metadata');
            }
        } finally {
            rec.restore();
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
            delete process.env.STRIPE_PRICE_ID_EUR;
            delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
            delete process.env.STRIPE_PRICE_ID_RENEWAL;
        }
    });

    // ── Catalog first + renewal Price: schedule phase uses renewal Price ───
    await check('catalog first + STRIPE_PRICE_ID_RENEWAL_*: schedule phase uses renewal Price', async () => {
        const prevTestPay = process.env.HIDOOK_TEST_PAY;
        const prevKey = process.env.STRIPE_SECRET_KEY;
        process.env.HIDOOK_TEST_PAY = '0';
        process.env.STRIPE_SECRET_KEY = 'sk_test_wave8_r2_both';
        process.env.STRIPE_PRICE_ID_EUR = 'price_test_first_99_eur';
        process.env.STRIPE_PRICE_ID_RENEWAL_EUR = 'price_test_renewal_29_eur';

        const rec = installFetchRecorder((url) => {
            if (/\/checkout\/sessions/.test(url)) {
                return {
                    id: 'cs_test_wave8_both',
                    url: 'https://checkout.stripe.com/c/pay/cs_test_wave8_both',
                    subscription: 'sub_test_both',
                };
            }
            if (/\/subscription_schedules\/sub_sched_/.test(url)) {
                return {
                    id: 'sub_sched_both',
                    phases: [
                        { items: [{ price: 'price_test_first_99_eur' }], start_date: 1700000000 },
                        { items: [{ price: 'price_test_renewal_29_eur' }] },
                    ],
                };
            }
            if (/\/subscription_schedules/.test(url)) {
                return {
                    id: 'sub_sched_both',
                    phases: [{
                        items: [{ price: 'price_test_first_99_eur', quantity: 1 }],
                        start_date: 1700000000,
                        trial_end: 1700000000 + 7 * 86400,
                    }],
                    subscription: 'sub_test_both',
                };
            }
            return { id: 'obj_test' };
        });

        try {
            const co = await payments.createCheckout({
                amountCents: pricing.PRICE_CENTS,
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                successUrl: 'http://127.0.0.1/ok',
                cancelUrl: 'http://127.0.0.1/cancel',
            });
            const checkoutPosts = rec.posts.filter((p) => /\/checkout\/sessions/.test(p.url));
            const form = parseStripeForm(checkoutPosts[0].body);
            assert.strictEqual(form.mode, 'subscription');
            assert.strictEqual(form['subscription_data[trial_period_days]'], '7');
            assert.strictEqual(form['line_items[0][price]'], 'price_test_first_99_eur');
            assert.ok(!hasOneTimeLineItem(form), 'no one-time with trial');
            // Renewal must NOT be only metadata — schedule attach required.
            await payments.attachFirstThenRenewalSchedule({
                subscriptionId: 'sub_test_both',
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                contract: co.contract,
                renewalPriceId: 'price_test_renewal_29_eur',
            });
            assertScheduleRenewalPhase(rec.posts);
            const schedBodies = rec.posts
                .filter((p) => /\/subscription_schedules/.test(p.url))
                .map((p) => p.body)
                .join('&');
            assert.ok(
                schedBodies.includes('price_test_renewal_29_eur') ||
                    schedBodies.includes(String(pricing.RENEWAL_CENTS)),
                'schedule must reference renewal catalog Price or 2900 unit_amount'
            );
        } finally {
            rec.restore();
            if (prevTestPay === undefined) delete process.env.HIDOOK_TEST_PAY;
            else process.env.HIDOOK_TEST_PAY = prevTestPay;
            if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = prevKey;
            delete process.env.STRIPE_PRICE_ID_EUR;
            delete process.env.STRIPE_PRICE_ID_RENEWAL_EUR;
        }
    });

    // ── HIDOOK_TEST_PAY offline records same 99-then-29 / 7-day contract ───
    await check('HIDOOK_TEST_PAY offline createCheckout records 99-then-29 / 7-day trial contract', async () => {
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
        // Offline schedule attach is a no-network record of the same contract.
        if (typeof payments.attachFirstThenRenewalSchedule === 'function') {
            const sched = await payments.attachFirstThenRenewalSchedule({
                subscriptionId: 'sub_test_offline',
                currency: 'eur',
                productName: 'Hidook Site Builder site activation',
                contract: co.contract,
            });
            assert.ok(sched && (sched.offline || sched.id), 'offline schedule returns a record');
            if (sched.contract) {
                assert.strictEqual(sched.contract.renewalCents, pricing.RENEWAL_CENTS);
                assert.strictEqual(sched.contract.firstPeriodCents, pricing.PRICE_CENTS);
            }
        }
    });

    // ── OWNER how-to: two catalog Prices + subscription schedule ───────────
    await check('OWNER-STRIPE-TRIAL.md lists two Prices and subscription schedule', () => {
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
        assert.ok(
            /subscription schedule|subscription_schedules|schedule phase/i.test(doc),
            'owner doc must document Subscription Schedule (99 then 29), not metadata-only'
        );
        assert.ok(!/\bDESSERD\b/i.test(doc), 'no DESSERD');
        assert.ok(!/\bKanban\b/i.test(doc), 'no Kanban jargon');
        assert.ok(!/sk_live_[A-Za-z0-9]+/.test(doc), 'no live secret material');
        assert.ok(!/sk_test_[A-Za-z0-9]{8,}/.test(doc), 'no real test secret material');
    });

    // ── resolveStripeRenewalPriceId helper ────────────────────────────────
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

    // ── buildSubscriptionLineItems: no one-time+trial hybrid ──────────────
    await check('buildSubscriptionLineItems first-then-renewal: single recurring 9900, no one-time', () => {
        assert.strictEqual(typeof payments.buildSubscriptionLineItems, 'function');
        const contract = payments.buildBillingContract({
            amountCents: pricing.PRICE_CENTS,
            renewalCents: pricing.RENEWAL_CENTS,
        });
        const { lineItems } = payments.buildSubscriptionLineItems({
            currency: 'eur',
            productName: 'Hidook Site Builder site activation',
            contract,
            priceId: null,
            renewalPriceId: null,
        });
        assert.strictEqual(lineItems.length, 1, 'exactly one line item');
        const li = lineItems[0];
        assert.ok(li.price_data, 'inline price_data');
        assert.strictEqual(li.price_data.unit_amount, pricing.PRICE_CENTS);
        assert.strictEqual(li.price_data.recurring && li.price_data.recurring.interval, 'year');
        assert.ok(
            !lineItems.some((x) => x.price_data && !x.price_data.recurring),
            'no one-time companion line'
        );
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
