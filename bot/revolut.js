'use strict';
/**
 * bot/revolut.js — Revolut Merchant API payment adapter.
 *
 * Drop-in replacement for payments.js (Stripe) — exposes the SAME interface so
 * flow.js can use either: isConfigured(), createCheckout(), getCheckoutStatus(),
 * pollUntilPaid(). Uses the Merchant "Orders" API with a hosted checkout page.
 *
 * Flow: createCheckout() creates an order and returns its hosted `checkout_url`.
 * The client pays on that page. We poll getCheckoutStatus() until the order
 * state is `completed` (no public webhook URL required).
 *
 * Environment variables:
 *   REVOLUT_SECRET_KEY   — Merchant API Secret key (sandbox or production). REQUIRED.
 *   REVOLUT_ENV          — 'sandbox' (default) | 'production'. Picks the base URL.
 *   REVOLUT_API_VERSION  — date-based API version header (default '2024-09-01').
 *
 * Docs: https://developer.revolut.com/docs/merchant/create-order
 * CommonJS, zero npm dependencies, Node 18+ (global fetch).
 */

const SANDBOX_BASE    = 'https://sandbox-merchant.revolut.com/api';
const PRODUCTION_BASE  = 'https://merchant.revolut.com/api';
const DEFAULT_API_VERSION = '2024-09-01';

function baseUrl() {
    return (process.env.REVOLUT_ENV || 'sandbox').toLowerCase() === 'production'
        ? PRODUCTION_BASE
        : SANDBOX_BASE;
}

/** @returns {boolean} true when a Revolut secret key is configured. */
function isConfigured() {
    return Boolean(process.env.REVOLUT_SECRET_KEY);
}

/**
 * Low-level Merchant API request. Throws an informative Error on non-2xx.
 */
async function revolutRequest(method, urlPath, bodyObj) {
    const key = process.env.REVOLUT_SECRET_KEY;
    if (!key) throw new Error('REVOLUT_SECRET_KEY is not set. Cannot call Revolut Merchant API.');

    const res = await fetch(baseUrl() + urlPath, {
        method,
        headers: {
            Authorization: 'Bearer ' + key,
            'Revolut-Api-Version': process.env.REVOLUT_API_VERSION || DEFAULT_API_VERSION,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = json.message || json.error || JSON.stringify(json);
        throw new Error(`Revolut ${method} ${urlPath} → ${res.status}: ${msg}`);
    }
    return json;
}

/**
 * Create a hosted-checkout order.
 *
 * @param {object} opts
 * @param {number} opts.amountCents  Amount in MINOR units (e.g. cents). Revolut uses minor units.
 * @param {string} [opts.currency='usd']  ISO 4217 code (case-insensitive; sent uppercase).
 * @param {string} [opts.productName]  Shown as the order description.
 * @param {string} [opts.successUrl]   Where to redirect the customer after paying.
 * @param {string} [opts.cancelUrl]    (unused by Revolut hosted page; kept for interface parity)
 * @param {object} [opts.metadata]     Stored as merchant_order_data ext ref.
 * @returns {Promise<{id: string, url: string}>}  Order id + hosted checkout_url.
 */
async function createCheckout({ amountCents, currency = 'usd', productName, successUrl, cancelUrl, metadata } = {}) {
    if (!amountCents || amountCents <= 0) throw new Error('amountCents must be a positive integer (minor units).');

    const body = {
        amount: Math.round(amountCents),
        currency: String(currency).toUpperCase(),
        description: productName || 'Order',
    };
    if (successUrl) body.redirect_url = successUrl;
    if (metadata && typeof metadata === 'object') {
        // Attach a human-readable external reference for reconciliation.
        body.merchant_order_data = { ref: Object.entries(metadata).map(([k, v]) => `${k}:${v}`).join(';') };
    }

    const order = await revolutRequest('POST', '/orders', body);
    const url = order.checkout_url || (order.token ? `https://checkout.revolut.com/payment-link/${order.token}` : null);
    if (!url) throw new Error('Revolut order created but no checkout_url/token returned: ' + JSON.stringify(order));

    return { id: order.id, url };
}

/**
 * Retrieve an order's status.
 *
 * Revolut order states: pending, processing, authorised, completed, cancelled, failed.
 * `completed` means the payment captured successfully.
 *
 * @param {string} orderId
 * @returns {Promise<{status: string, paymentStatus: 'paid'|string}>}
 */
async function getCheckoutStatus(orderId) {
    if (!orderId) throw new Error('orderId is required.');
    const order = await revolutRequest('GET', `/orders/${encodeURIComponent(orderId)}`);
    const state = order.state || 'unknown';
    return { status: state, paymentStatus: state === 'completed' ? 'paid' : state };
}

/**
 * Poll until the order is paid (state `completed`) or a timeout elapses.
 * Resolves true when paid, false on timeout. Terminal failure states
 * (cancelled/failed) also resolve false early.
 *
 * @param {string} orderId
 * @param {{intervalMs?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<boolean>}
 */
async function pollUntilPaid(orderId, { intervalMs = 4000, timeoutMs = 900000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        let s;
        try { s = await getCheckoutStatus(orderId); } catch (_) { s = null; }
        if (s) {
            if (s.paymentStatus === 'paid') return true;
            if (s.status === 'cancelled' || s.status === 'failed') return false;
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

/**
 * Refund a Merchant order, fully or partially. Fetches the order to learn its currency,
 * then POSTs a refund. Used when a paid order can't be fully delivered (e.g. the custom
 * domain purchase fails after charging).
 *
 * @param {string} orderId
 * @param {number} [amountMinor] Partial amount in minor units; omit for a full refund.
 * @returns {Promise<object>}
 */
async function refund(orderId, amountMinor) {
    if (!orderId) throw new Error('orderId is required for refund.');
    const order = await revolutRequest('GET', `/orders/${encodeURIComponent(orderId)}`);
    const body = { currency: order.currency || 'USD' };
    if (amountMinor && amountMinor > 0) body.amount = Math.round(amountMinor);
    else if (order.amount) body.amount = order.amount;   // full refund
    return revolutRequest('POST', `/orders/${encodeURIComponent(orderId)}/refund`, body);
}

module.exports = { isConfigured, createCheckout, getCheckoutStatus, pollUntilPaid, refund };

// Offline self-test: node bot/revolut.js
if (require.main === module) {
    console.log('revolut.js self-test');
    console.log('  isConfigured():', isConfigured());
    console.log('  base URL:', baseUrl());
    if (!isConfigured()) console.log('  REVOLUT_SECRET_KEY not set — calls would throw a clear Error. ✓');
}
