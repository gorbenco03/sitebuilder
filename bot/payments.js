/**
 * payments.js — Stripe Checkout via REST API (no npm stripe package).
 *
 * SaaS flow position:
 *   client describes business → AI builds site → [THIS MODULE: collect card]
 *   → subscription trial starts → deploy site (deploy-vercel.js) → return live URL
 *
 * Required env var (real Stripe path):
 *   STRIPE_SECRET_KEY  — sk_test_… locally; sk_live_… only when owner goes live
 *
 * Optional catalog (owner creates Product/Price in Stripe Dashboard later):
 *   STRIPE_PRICE_ID           — default first-year Price id (price_…)
 *   STRIPE_PRICE_ID_EUR|GBP|USD — currency-specific first-year Price ids
 *   STRIPE_PRICE_ID_RENEWAL   — default renewal Price id (29/year)
 *   STRIPE_PRICE_ID_RENEWAL_EUR|GBP|USD — currency-specific renewal Price ids
 * When no Price id is set, Checkout uses inline price_data (test/local friendly;
 * no Product/Price pre-creation required). Studio must not demand production keys.
 *
 * Commercial model (VISION 2026-08-26): mode=subscription with a 7-day trial.
 * Card is collected at signup ($0 now); first charge is automatic on day 7 at
 * first-period amount (99); subsequent years are renewal amount (29) via a
 * Stripe Subscription Schedule phase — never forever-99, never one-time+trial.
 * Checkout sets allow_promotion_codes so Stripe shows a promo-code field;
 * that does not change mode, trial, first-year 99, or renewal 29.
 * Cancel: builder opens a Customer Portal session (createBillingPortalSession).
 * When Stripe sends customer.subscription.deleted (or updated status=canceled),
 * the app unpublishes the public site. Refunds stay Dashboard / Portal — no
 * custom refund API in this module.
 *
 * Caller tip:
 *   amountCents   = first-period charge in minor units (from pricing.js PRICE_CENTS)
 *   renewalCents  = yearly renewal after first period (pricing.js RENEWAL_CENTS)
 * After checkout.session.completed, call attachFirstThenRenewalSchedule(subscriptionId)
 * so year-2+ invoices use the renewal Price / RENEWAL_CENTS.
 *
 * @module payments
 */

'use strict';

const crypto = require('crypto');
const pricing = require('./pricing.js');

const STRIPE_API = 'https://api.stripe.com/v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a plain JS object as application/x-www-form-urlencoded, supporting
 * one level of array-of-objects notation required by Stripe's line_items[0][...].
 *
 * e.g. { line_items: [{ price_data: { currency: 'eur' } }] }
 *   → "line_items[0][price_data][currency]=eur"
 *
 * Handles: string | number | boolean scalars, arrays of objects, nested objects.
 */
function encodeStripeBody(obj, prefix = '') {
    const parts = [];

    function recurse(value, key) {
        if (value === null || value === undefined) return;
        if (Array.isArray(value)) {
            value.forEach((item, i) => recurse(item, `${key}[${i}]`));
        } else if (typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
                recurse(v, `${key}[${k}]`);
            }
        } else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
    }

    if (prefix) {
        recurse(obj, prefix);
    } else {
        for (const [k, v] of Object.entries(obj)) {
            recurse(v, k);
        }
    }

    return parts.join('&');
}

/**
 * Execute a Stripe API call. Throws an Error with the Stripe error message on
 * non-2xx responses.
 *
 * @param {string} method  HTTP method
 * @param {string} urlPath Path relative to STRIPE_API, e.g. '/checkout/sessions'
 * @param {string|undefined} body  URL-encoded body (for POST)
 * @returns {Promise<object>} Parsed JSON response
 */
async function stripeRequest(method, urlPath, body) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set. Cannot call Stripe API.');

    const res = await fetch(STRIPE_API + urlPath, {
        method,
        headers: {
            Authorization: 'Bearer ' + key,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body || undefined,
    });

    const json = await res.json();
    if (!res.ok) {
        const msg = (json.error && json.error.message) || JSON.stringify(json);
        throw new Error(`Stripe ${method} ${urlPath} → ${res.status}: ${msg}`);
    }
    return json;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * HIDOOK_TEST_PAY=1 — offline checkout + unsigned webhook for local/E2E only.
 * Refused when NODE_ENV=production (isConfigured stays false; createCheckout throws).
 */
function _isTestPay() {
    return process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production';
}

/**
 * Optional Stripe Catalog Price id for the first-year charge (owner-created).
 * Prefer currency-specific env, then generic STRIPE_PRICE_ID.
 * Empty/unset → inline price_data path (no catalog required).
 *
 * @param {string} currency
 * @returns {string|null}
 */
function resolveStripePriceId(currency) {
    const cur = String(currency || 'eur').trim().toLowerCase();
    const byCur = process.env['STRIPE_PRICE_ID_' + cur.toUpperCase()];
    if (byCur && String(byCur).trim()) return String(byCur).trim();
    const generic = process.env.STRIPE_PRICE_ID;
    if (generic && String(generic).trim()) return String(generic).trim();
    return null;
}

/**
 * Optional Stripe Catalog Price id for yearly renewal after the first period (29/year).
 * Prefer STRIPE_PRICE_ID_RENEWAL_<CURRENCY>, then STRIPE_PRICE_ID_RENEWAL.
 * Empty/unset → renewal amount is scheduled from pricing.js (never silent forever-99).
 *
 * @param {string} currency
 * @returns {string|null}
 */
function resolveStripeRenewalPriceId(currency) {
    const cur = String(currency || 'eur').trim().toLowerCase();
    const byCur = process.env['STRIPE_PRICE_ID_RENEWAL_' + cur.toUpperCase()];
    if (byCur && String(byCur).trim()) return String(byCur).trim();
    const generic = process.env.STRIPE_PRICE_ID_RENEWAL;
    if (generic && String(generic).trim()) return String(generic).trim();
    return null;
}

/** Fixed 7-day subscription trial (VISION). Not a free unpaid live window. */
const SUBSCRIPTION_TRIAL_DAYS = 7;

/**
 * Resolve first-period + renewal minor units for a checkout.
 * Defaults renewal to pricing.RENEWAL_CENTS when omitted.
 *
 * @param {{ amountCents: number, renewalCents?: number }} opts
 * @returns {{ firstPeriodCents: number, renewalCents: number, trialDays: number, interval: 'year' }}
 */
function buildBillingContract({ amountCents, renewalCents } = {}) {
    const firstPeriodCents = Math.round(Number(amountCents));
    const renew = renewalCents != null ? Math.round(Number(renewalCents)) : pricing.RENEWAL_CENTS;
    if (!Number.isFinite(firstPeriodCents) || firstPeriodCents < 1) {
        throw new Error('amountCents must be a positive integer.');
    }
    if (!Number.isFinite(renew) || renew < 1) {
        throw new Error('renewalCents must be a positive integer.');
    }
    return {
        firstPeriodCents,
        renewalCents: renew,
        trialDays: SUBSCRIPTION_TRIAL_DAYS,
        interval: 'year',
    };
}

/**
 * Build Checkout Session line_items + billing metadata for 99-then-29 (or pure renewal).
 *
 * First-then-renewal Checkout is a **single recurring** line at first-period cents
 * (9900) with trial_period_days=7. No one-time companion (Stripe would charge it now).
 * Year-2+ step-down to renewal (2900) is a Subscription Schedule phase attached after
 * the subscription exists — not metadata alone.
 *
 * @param {object} opts
 * @param {string} opts.currency
 * @param {string} opts.productName
 * @param {{ firstPeriodCents: number, renewalCents: number }} opts.contract
 * @param {string|null} opts.priceId
 * @param {string|null} opts.renewalPriceId
 * @returns {{ lineItems: object[], billingMeta: Record<string,string> }}
 */
function buildSubscriptionLineItems({ currency, productName, contract, priceId, renewalPriceId }) {
    const first = contract.firstPeriodCents;
    const renew = contract.renewalCents;
    const billingMeta = {
        first_period_cents: String(first),
        renewal_cents: String(renew),
        billing_contract: first === renew ? 'renewal' : 'first_then_renewal',
    };
    if (first !== renew) {
        billingMeta.billing_schedule = 'subscription_schedule';
        if (renewalPriceId) billingMeta.renewal_price_id = renewalPriceId;
    }

    // Catalog: first-year (or pure-renewal) Price only on Checkout; renewal phase later.
    if (priceId) {
        return {
            lineItems: [{ price: priceId, quantity: 1 }],
            billingMeta,
        };
    }

    // Pure renewal (same amount both periods) — single yearly recurring line.
    if (first === renew) {
        return {
            lineItems: [{
                price_data: {
                    currency,
                    unit_amount: renew,
                    recurring: { interval: 'year' },
                    product_data: { name: productName },
                },
                quantity: 1,
            }],
            billingMeta,
        };
    }

    // Inline first-then-renewal: single recurring first-period (9900) yearly.
    // Do NOT add a one-time premium with trial — Stripe charges one-time up front.
    // Renewal (2900) is applied via attachFirstThenRenewalSchedule after subscribe.
    return {
        lineItems: [{
            price_data: {
                currency,
                unit_amount: first,
                recurring: { interval: 'year' },
                product_data: { name: productName },
            },
            quantity: 1,
        }],
        billingMeta,
    };
}

/** One year in seconds (phase length for first paid year after trial). */
const ONE_YEAR_SEC = 365 * 24 * 60 * 60;

/**
 * Ensure a yearly renewal Price id exists (catalog env or create via Stripe API).
 * @param {object} opts
 * @param {string} opts.currency
 * @param {string} opts.productName
 * @param {number} opts.renewalCents
 * @param {string|null} [opts.renewalPriceId]
 * @param {string|null} [opts.productId]  Reuse product from the first-year Price when known.
 * @returns {Promise<string>} price_…
 */
async function ensureRenewalPriceId({
    currency,
    productName,
    renewalCents,
    renewalPriceId,
    productId,
}) {
    if (renewalPriceId && String(renewalPriceId).trim()) {
        return String(renewalPriceId).trim();
    }
    const fromEnv = resolveStripeRenewalPriceId(currency);
    if (fromEnv) return fromEnv;

    const params = {
        currency: String(currency || 'eur').toLowerCase(),
        unit_amount: Math.round(Number(renewalCents)),
        recurring: { interval: 'year' },
    };
    if (productId) {
        params.product = productId;
    } else {
        params.product_data = {
            name: String(productName || 'Hidook Site Builder') + ' — yearly renewal',
        };
    }
    const price = await stripeRequest('POST', '/prices', encodeStripeBody(params));
    if (!price || !price.id) {
        throw new Error('Could not create Stripe renewal Price for schedule phase.');
    }
    return price.id;
}

/**
 * Attach a Subscription Schedule so billing is 99 for trial+first paid year, then 29/year.
 *
 * Stripe flow:
 *   1. POST /v1/subscription_schedules  from_subscription=<sub>
 *   2. POST /v1/subscription_schedules/:id with phases[0]=first price through first paid year,
 *      phases[1]=renewal Price (catalog or created at RENEWAL_CENTS)
 *
 * Metadata alone never changes Stripe invoices — this must run when the subscription exists
 * (typically checkout.session.completed → handleStripePaid).
 *
 * @param {object} opts
 * @param {string} opts.subscriptionId
 * @param {string} [opts.currency='eur']
 * @param {string} [opts.productName]
 * @param {{ firstPeriodCents: number, renewalCents: number, trialDays?: number }} [opts.contract]
 * @param {string|null} [opts.renewalPriceId]
 * @param {string|null} [opts.priceId] unused; first price comes from the live subscription
 * @returns {Promise<object>} schedule object (or offline stub when HIDOOK_TEST_PAY=1)
 */
async function attachFirstThenRenewalSchedule({
    subscriptionId,
    currency = 'eur',
    productName = 'Hidook Site Builder',
    contract,
    renewalPriceId = null,
} = {}) {
    if (!subscriptionId) throw new Error('subscriptionId is required for schedule attach.');

    const c = contract && contract.firstPeriodCents != null
        ? contract
        : buildBillingContract({
            amountCents: (contract && contract.firstPeriodCents) || pricing.PRICE_CENTS,
            renewalCents: (contract && contract.renewalCents) || pricing.RENEWAL_CENTS,
        });

    // Pure renewal subscriptions need no step-down schedule.
    if (c.firstPeriodCents === c.renewalCents) {
        return { id: null, skipped: true, reason: 'renewal_only', contract: c };
    }

    // Offline test adapter — same commercial contract, no network.
    if (process.env.HIDOOK_TEST_PAY === '1') {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('HIDOOK_TEST_PAY=1 is refused in production');
        }
        return {
            id: 'sub_sched_test_' + crypto.randomBytes(8).toString('hex'),
            offline: true,
            object: 'subscription_schedule',
            contract: c,
            phases: [
                { unit_amount: c.firstPeriodCents, interval: 'year' },
                { unit_amount: c.renewalCents, interval: 'year' },
            ],
        };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY is not set. Cannot attach subscription schedule.');
    }

    // 1) Create schedule from the live subscription (copies current phase + trial).
    const created = await stripeRequest(
        'POST',
        '/subscription_schedules',
        encodeStripeBody({ from_subscription: subscriptionId })
    );
    const phase0 = (created.phases && created.phases[0]) || {};
    const item0 = (phase0.items && phase0.items[0]) || {};
    const firstPriceId = typeof item0.price === 'string'
        ? item0.price
        : (item0.price && item0.price.id);
    if (!firstPriceId) {
        throw new Error('subscription schedule phase[0] has no price to keep for first year.');
    }

    const startDate = phase0.start_date;
    const trialEnd = phase0.trial_end || null;
    // First phase covers trial (if any) + first paid year at 99, then switch to 29.
    const baseEnd = trialEnd || phase0.end_date || startDate;
    const phase0End = Number(baseEnd) + ONE_YEAR_SEC;

    // Optional: product id from first price for renewal Price create.
    let productId = null;
    try {
        const firstPrice = await stripeRequest(
            'GET',
            '/prices/' + encodeURIComponent(firstPriceId)
        );
        if (firstPrice && firstPrice.product) {
            productId = typeof firstPrice.product === 'string'
                ? firstPrice.product
                : firstPrice.product.id;
        }
    } catch (_) { /* create renewal with product_data instead */ }

    const renPriceId = await ensureRenewalPriceId({
        currency,
        productName,
        renewalCents: c.renewalCents,
        renewalPriceId: renewalPriceId || resolveStripeRenewalPriceId(currency),
        productId,
    });

    const phase0Update = {
        items: [{ price: firstPriceId, quantity: item0.quantity || 1 }],
        start_date: startDate,
        end_date: phase0End,
        proration_behavior: 'none',
    };
    if (trialEnd) phase0Update.trial_end = trialEnd;

    const phase1Update = {
        items: [{ price: renPriceId, quantity: 1 }],
        proration_behavior: 'none',
    };

    const updated = await stripeRequest(
        'POST',
        '/subscription_schedules/' + encodeURIComponent(created.id),
        encodeStripeBody({
            end_behavior: 'release',
            phases: [phase0Update, phase1Update],
        })
    );
    return updated;
}

/**
 * Returns true when Stripe payments can be used: real STRIPE_SECRET_KEY, or
 * non-production HIDOOK_TEST_PAY=1 (no network).
 *
 * @returns {boolean}
 */
function isConfigured() {
    if (_isTestPay()) return true;
    return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Create a Stripe Checkout Session for a subscription with a 7-day card-on-file trial.
 * On trial start Stripe reports payment_status=no_payment_required ($0 now); after day 7
 * the first period charges PRICE_CENTS (99). Year-2+ charges RENEWAL_CENTS (29) only after
 * attachFirstThenRenewalSchedule runs on the subscription (webhook / paid handler).
 *
 * Line item source (Checkout — single recurring first period only):
 *   1. STRIPE_PRICE_ID_<CURRENCY> or STRIPE_PRICE_ID when set (first-year Dashboard Price)
 *   2. else inline price_data: recurring unit_amount = first-period cents (9900), interval year
 * Never pairs a one-time line item with trial_period_days (Stripe would charge it immediately).
 * Optional STRIPE_PRICE_ID_RENEWAL_* is used when attaching the schedule phase (not as a
 * second Checkout line item).
 *
 * @param {object} opts
 * @param {number}  opts.amountCents   First-period charge in cents (publish) or renewal amount.
 * @param {number} [opts.renewalCents] Yearly renewal after first period (default pricing.RENEWAL_CENTS).
 * @param {string} [opts.currency]     ISO currency code, default 'eur'.
 * @param {string}  opts.productName   Shown on the Stripe checkout page (inline price_data path).
 * @param {string}  opts.successUrl    Redirect after successful checkout (card on file).
 * @param {string}  opts.cancelUrl     Redirect if the user cancels.
 * @param {object} [opts.metadata]     Key/value pairs attached to the session (e.g. chatId, slug).
 * @param {string} [opts.clientReferenceId]  Order reference echoed back on the session
 *                                     (and in the webhook event) for reconciliation.
 * @returns {Promise<{id: string, url: string, contract: object}>}
 */
async function createCheckout({
    amountCents,
    renewalCents,
    currency = 'eur',
    productName,
    successUrl,
    cancelUrl,
    metadata = {},
    clientReferenceId,
}) {
    if (!productName) throw new Error('productName is required.');
    if (!successUrl || !cancelUrl) throw new Error('successUrl and cancelUrl are required.');

    const contract = buildBillingContract({ amountCents, renewalCents });
    const priceId = resolveStripePriceId(currency);
    const renewalPriceId = resolveStripeRenewalPriceId(currency);
    const { lineItems, billingMeta } = buildSubscriptionLineItems({
        currency,
        productName,
        contract,
        priceId,
        renewalPriceId,
    });
    const sessionMeta = Object.assign({}, metadata || {}, billingMeta);
    const subscriptionMeta = Object.assign({}, billingMeta);

    // Offline test adapter — no network, no STRIPE_SECRET_KEY (non-production only).
    // Still records the same 99-then-29 contract (no charge).
    if (process.env.HIDOOK_TEST_PAY === '1') {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('HIDOOK_TEST_PAY=1 is refused in production');
        }
        const id = 'cs_test_' + crypto.randomBytes(12).toString('hex');
        return {
            id,
            url: `${String(successUrl).replace(/#.*$/, '')}#test-checkout=${id}`,
            contract,
        };
    }

    // First-period publish uses a 7-day trial; pure renewal checkouts charge immediately.
    const trialDays = contract.firstPeriodCents === contract.renewalCents
        ? 0
        : SUBSCRIPTION_TRIAL_DAYS;

    const params = {
        mode: 'subscription',
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: sessionMeta,
        // Stripe Checkout promo-code field. Do not pair with `discounts`
        // (Stripe rejects both on the same session). Billing model stays
        // subscription + 7-day trial + 99 then 29 via schedule.
        allow_promotion_codes: true,
    };
    if (trialDays > 0) {
        params.subscription_data = {
            trial_period_days: trialDays,
            metadata: subscriptionMeta,
        };
    } else if (Object.keys(subscriptionMeta).length) {
        params.subscription_data = { metadata: subscriptionMeta };
    }
    if (clientReferenceId) params.client_reference_id = String(clientReferenceId).slice(0, 200);

    const body = encodeStripeBody(params);
    const session = await stripeRequest('POST', '/checkout/sessions', body);
    return { id: session.id, url: session.url, contract };
}

/**
 * Create a Stripe Customer Portal session so the customer can cancel (and manage
 * billing). Used by the builder Cancel control.
 *
 * HIDOOK_TEST_PAY=1 (non-production): offline session — no network, no charge.
 * Real path: POST /v1/billing_portal/sessions with customer + return_url.
 *
 * @param {object} opts
 * @param {string} opts.customerId  Stripe customer id (cus_…).
 * @param {string} opts.returnUrl   Where Stripe sends the customer after the portal.
 * @returns {Promise<{id: string, url: string, offline?: boolean}>}
 */
async function createBillingPortalSession({ customerId, returnUrl } = {}) {
    if (!customerId) throw new Error('customerId is required for billing portal.');
    if (!returnUrl) throw new Error('returnUrl is required for billing portal.');

    if (process.env.HIDOOK_TEST_PAY === '1') {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('HIDOOK_TEST_PAY=1 is refused in production');
        }
        const id = 'bps_test_' + crypto.randomBytes(12).toString('hex');
        const base = String(returnUrl).replace(/#.*$/, '');
        return {
            id,
            url: `${base}#test-billing-portal=${id}`,
            offline: true,
            customerId: String(customerId),
        };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY is not set. Cannot create billing portal session.');
    }

    const body = encodeStripeBody({
        customer: String(customerId),
        return_url: String(returnUrl),
    });
    const session = await stripeRequest('POST', '/billing_portal/sessions', body);
    return { id: session.id, url: session.url };
}

/**
 * Retrieve the status of an existing Checkout Session.
 * Poll this periodically (see pollUntilPaid) — no webhook / public URL needed.
 *
 * @param {string} sessionId  Stripe Checkout Session ID (cs_...).
 * @returns {Promise<{status: string, paymentStatus: string}>}
 *   status        — 'open' | 'complete' | 'expired'
 *   paymentStatus — 'unpaid' | 'paid' | 'no_payment_required'
 */
async function getCheckoutStatus(sessionId) {
    if (!sessionId) throw new Error('sessionId is required.');
    const session = await stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
    return { status: session.status, paymentStatus: session.payment_status };
}

/**
 * Poll a Checkout Session until payment is confirmed or timeout is reached.
 *
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=4000]   How often to poll (ms).
 * @param {number} [opts.timeoutMs=900000]  Give up after this many ms (default 15 min).
 * @returns {Promise<boolean>}  true = paid, false = timed out.
 */
async function pollUntilPaid(sessionId, { intervalMs = 4000, timeoutMs = 900000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { paymentStatus } = await getCheckoutStatus(sessionId);
        // paid = charged; no_payment_required = subscription trial card-on-file success
        if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required') return true;
        // Stop early if session expired/completed without payment
        const { status } = await getCheckoutStatus(sessionId);
        if (status === 'expired') return false;
        // Wait for the next interval, but don't overshoot the deadline
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise(r => setTimeout(r, Math.min(intervalMs, remaining)));
    }
    return false;
}

/**
 * Refund a Checkout Session, fully or partially. Resolves the session's payment_intent
 * and issues a refund against it. Used when a paid order can't be fully delivered (e.g.
 * the custom domain purchase fails after charging).
 *
 * @param {string} sessionId   Stripe Checkout Session id (cs_...).
 * @param {number} [amountCents] Partial amount to refund; omit for a full refund.
 * @returns {Promise<object>} The Stripe refund object.
 */
async function refund(sessionId, amountCents) {
    if (!sessionId) throw new Error('sessionId is required for refund.');
    const session = await stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
    const pi = session.payment_intent;
    if (!pi) throw new Error('No payment_intent on session ' + sessionId + ' (was it paid?).');
    const params = { payment_intent: pi };
    if (amountCents && amountCents > 0) params.amount = Math.round(amountCents);
    return stripeRequest('POST', '/refunds', encodeStripeBody(params));
}

// ---------------------------------------------------------------------------
// Webhooks (no SDK — pure node:crypto)
// ---------------------------------------------------------------------------

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` request header)
 * against the RAW request body. Scheme: header is `t=<unix>,v1=<hex>[,v1=...]`;
 * the signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint
 * secret (whsec_...). Constant-time comparison + a timestamp tolerance so a
 * captured event can't be replayed later.
 *
 * Never throws on malformed input — returns false.
 *
 * @param {Buffer|string} rawBody   The EXACT bytes Stripe sent (do not re-serialize).
 * @param {string} sigHeader        Value of the Stripe-Signature header.
 * @param {string} secret           Endpoint secret (whsec_...).
 * @param {object} [opts]
 * @param {number} [opts.toleranceSec=300]  Max allowed |now - t|, seconds.
 * @param {number} [opts.nowMs]     Injectable clock (tests).
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, sigHeader, secret, { toleranceSec = 300, nowMs } = {}) {
    if (!rawBody || !sigHeader || !secret) return false;

    let t = null;
    const v1s = [];
    for (const part of String(sigHeader).split(',')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k === 't') t = v;
        else if (k === 'v1') v1s.push(v);
    }
    if (!t || !/^\d+$/.test(t) || v1s.length === 0) return false;

    const nowSec = (nowMs != null ? nowMs : Date.now()) / 1000;
    if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;

    const payload  = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
    const expBuf   = Buffer.from(expected, 'utf8');
    return v1s.some((sig) => {
        const got = Buffer.from(String(sig), 'utf8');
        return got.length === expBuf.length && crypto.timingSafeEqual(got, expBuf);
    });
}

/**
 * Verify + parse a Stripe webhook request into an event object.
 * Throws on an invalid signature (caller responds 400 so Stripe retries/flags).
 *
 * @param {Buffer|string} rawBody
 * @param {string} sigHeader
 * @param {string} secret
 * @param {object} [opts]  Passed through to verifyWebhookSignature.
 * @returns {object} Parsed Stripe event (e.g. { type: 'checkout.session.completed', data: { object } }).
 */
function constructWebhookEvent(rawBody, sigHeader, secret, opts) {
    if (!verifyWebhookSignature(rawBody, sigHeader, secret, opts)) {
        throw new Error('Invalid Stripe webhook signature.');
    }
    return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
    isConfigured,
    createCheckout,
    createBillingPortalSession,
    getCheckoutStatus,
    pollUntilPaid,
    refund,
    verifyWebhookSignature,
    constructWebhookEvent,
    resolveStripePriceId,
    resolveStripeRenewalPriceId,
    buildBillingContract,
    buildSubscriptionLineItems,
    attachFirstThenRenewalSchedule,
    ensureRenewalPriceId,
    SUBSCRIPTION_TRIAL_DAYS,
};

// ---------------------------------------------------------------------------
// Self-test (run: node bot/payments.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
    console.log('payments.js self-test');
    console.log('  isConfigured():', isConfigured());
    if (!isConfigured()) {
        console.log('  STRIPE_SECRET_KEY not set — all API calls would throw a clear Error. ✓');
        console.log('  Example:');
        console.log('    createCheckout({ amountCents: 9900, productName: "Hidook site", successUrl: "...", cancelUrl: "..." })');
        console.log('    → throws: "STRIPE_SECRET_KEY is not set. Cannot call Stripe API."');
    } else {
        console.log('  STRIPE_SECRET_KEY is present — Stripe API calls are enabled.');
    }
}
