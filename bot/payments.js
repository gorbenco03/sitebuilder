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
 *   STRIPE_PRICE_ID           — default recurring Price id (price_…)
 *   STRIPE_PRICE_ID_EUR|GBP|USD — currency-specific Price ids (preferred when set)
 * When no Price id is set, Checkout uses inline price_data (test/local friendly;
 * no Product/Price pre-creation required). Studio must not demand production keys.
 *
 * Commercial model (VISION 2026-08-26): mode=subscription with a 7-day trial.
 * Card is collected at signup; first charge is automatic on day 7.
 * Cancel/refund: Stripe Customer Portal / Dashboard (not custom teardown in this module).
 *
 * Caller tip:
 *   amountCents = first-period / renewal amount in minor units (from pricing.js)
 *
 * @module payments
 */

'use strict';

const crypto = require('crypto');

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
 * Optional Stripe Catalog Price id (owner-created). Prefer currency-specific env,
 * then generic STRIPE_PRICE_ID. Empty/unset → inline price_data path (no catalog required).
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

/** Fixed 7-day subscription trial (VISION). Not a free unpaid live window. */
const SUBSCRIPTION_TRIAL_DAYS = 7;

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
 * On trial start Stripe reports payment_status=no_payment_required; after day 7 the
 * subscription charges automatically (payment_status=paid on later invoices).
 *
 * Line item source:
 *   1. STRIPE_PRICE_ID_<CURRENCY> or STRIPE_PRICE_ID when set (Dashboard Product/Price)
 *   2. else inline price_data from amountCents (test/local; no catalog required)
 *
 * @param {object} opts
 * @param {number}  opts.amountCents  Recurring charge in cents (first period / renewal).
 * @param {string} [opts.currency]    ISO currency code, default 'eur'.
 * @param {string}  opts.productName  Shown on the Stripe checkout page (inline price_data path).
 * @param {string}  opts.successUrl   Redirect after successful checkout (card on file).
 * @param {string}  opts.cancelUrl    Redirect if the user cancels.
 * @param {object} [opts.metadata]    Key/value pairs attached to the session (e.g. chatId, slug).
 * @param {string} [opts.clientReferenceId]  Order reference echoed back on the session
 *                                    (and in the webhook event) for reconciliation.
 * @returns {Promise<{id: string, url: string}>}  id = Stripe session ID, url = hosted checkout URL.
 */
async function createCheckout({
    amountCents,
    currency = 'eur',
    productName,
    successUrl,
    cancelUrl,
    metadata = {},
    clientReferenceId,
}) {
    if (!amountCents || amountCents < 1) throw new Error('amountCents must be a positive integer.');
    if (!productName) throw new Error('productName is required.');
    if (!successUrl || !cancelUrl) throw new Error('successUrl and cancelUrl are required.');

    // Offline test adapter — no network, no STRIPE_SECRET_KEY (non-production only).
    if (process.env.HIDOOK_TEST_PAY === '1') {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('HIDOOK_TEST_PAY=1 is refused in production');
        }
        const id = 'cs_test_' + crypto.randomBytes(12).toString('hex');
        return {
            id,
            url: `${String(successUrl).replace(/#.*$/, '')}#test-checkout=${id}`,
        };
    }

    const priceId = resolveStripePriceId(currency);
    const lineItem = priceId
        ? { price: priceId, quantity: 1 }
        : {
              price_data: {
                  currency,
                  unit_amount: amountCents,
                  recurring: { interval: 'year' },
                  product_data: { name: productName },
              },
              quantity: 1,
          };

    const params = {
        mode: 'subscription',
        line_items: [lineItem],
        subscription_data: {
            trial_period_days: SUBSCRIPTION_TRIAL_DAYS,
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
    };
    if (clientReferenceId) params.client_reference_id = String(clientReferenceId).slice(0, 200);

    const body = encodeStripeBody(params);
    const session = await stripeRequest('POST', '/checkout/sessions', body);
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
    getCheckoutStatus,
    pollUntilPaid,
    refund,
    verifyWebhookSignature,
    constructWebhookEvent,
    resolveStripePriceId,
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
        console.log('    createCheckout({ amountCents: 10000, productName: "Hidook site", successUrl: "...", cancelUrl: "..." })');
        console.log('    → throws: "STRIPE_SECRET_KEY is not set. Cannot call Stripe API."');
    } else {
        console.log('  STRIPE_SECRET_KEY is present — Stripe API calls are enabled.');
    }
}
