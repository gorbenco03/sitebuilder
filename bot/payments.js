/**
 * payments.js — Stripe one-time payment via REST API (no npm stripe package).
 *
 * SaaS flow position:
 *   client describes business → AI builds site → [THIS MODULE: collect payment]
 *   → buy domain (domains.js) → deploy site (deploy-vercel.js) → return live URL
 *
 * Required env var:
 *   STRIPE_SECRET_KEY  — Stripe secret key (sk_live_... or sk_test_...)
 *
 * Caller tip:
 *   amountCents = buildFeeCents + domainPriceCents
 *   (combine the platform build fee and the domain cost into a single charge)
 *
 * @module payments
 */

'use strict';

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
 * Returns true when STRIPE_SECRET_KEY is present in the environment.
 * Use this to guard feature availability before calling other exports.
 *
 * @returns {boolean}
 */
function isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Create a Stripe Checkout Session for a single one-time payment.
 *
 * @param {object} opts
 * @param {number}  opts.amountCents  Total charge in cents (buildFee + domainPrice).
 * @param {string} [opts.currency]    ISO currency code, default 'eur'.
 * @param {string}  opts.productName  Shown on the Stripe checkout page.
 * @param {string}  opts.successUrl   Redirect after successful payment.
 * @param {string}  opts.cancelUrl    Redirect if the user cancels.
 * @param {object} [opts.metadata]    Key/value pairs attached to the session (e.g. chatId, slug).
 * @returns {Promise<{id: string, url: string}>}  id = Stripe session ID, url = hosted checkout URL.
 */
async function createCheckout({
    amountCents,
    currency = 'eur',
    productName,
    successUrl,
    cancelUrl,
    metadata = {},
}) {
    if (!amountCents || amountCents < 1) throw new Error('amountCents must be a positive integer.');
    if (!productName) throw new Error('productName is required.');
    if (!successUrl || !cancelUrl) throw new Error('successUrl and cancelUrl are required.');

    const params = {
        mode: 'payment',
        line_items: [
            {
                price_data: {
                    currency,
                    unit_amount: amountCents,
                    product_data: { name: productName },
                },
                quantity: 1,
            },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
    };

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
        if (paymentStatus === 'paid') return true;
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
// Module exports
// ---------------------------------------------------------------------------

module.exports = { isConfigured, createCheckout, getCheckoutStatus, pollUntilPaid, refund };

// ---------------------------------------------------------------------------
// Self-test (run: node bot/payments.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
    console.log('payments.js self-test');
    console.log('  isConfigured():', isConfigured());
    if (!isConfigured()) {
        console.log('  STRIPE_SECRET_KEY not set — all API calls would throw a clear Error. ✓');
        console.log('  Example:');
        console.log('    createCheckout({ amountCents: 2999, productName: "DESSERD site", successUrl: "...", cancelUrl: "..." })');
        console.log('    → throws: "STRIPE_SECRET_KEY is not set. Cannot call Stripe API."');
    } else {
        console.log('  STRIPE_SECRET_KEY is present — Stripe API calls are enabled.');
    }
}
