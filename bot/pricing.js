'use strict';
/**
 * bot/pricing.js — single commercial pricing source for Hidook Site Builder.
 *
 * Amounts (minor units / cents):
 *   - First public publish: 10000 (100 major units)
 *   - Yearly renewal:       2900  (29 major units), same currency
 *
 * Currency buckets:
 *   - EU member states → EUR
 *   - GB / UK          → GBP
 *   - everywhere else  → USD
 *
 * Country resolution — resolveCountryCode(opts):
 *   1. Cloudflare CF-IPCountry request header when present and a real ISO code
 *      (ignores CF unknowns XX / T1)
 *   2. Explicit country or region on the request (opts.country, opts.region,
 *      or query.country / query.region)
 *   3. Default US → USD bucket
 *
 * Callers must not hardcode BUILD_FEE / RETAINER defaults of 49.
 */

/** First-publish price in cents (100.00). */
const PRICE_CENTS = 10000;

/** Yearly renewal in cents (29.00), same currency as first publish. */
const RENEWAL_CENTS = 2900;

/** ISO 3166-1 alpha-2 codes for EU member states (EUR bucket). */
const EU_COUNTRIES = new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Normalize a country-like string to ISO alpha-2 upper-case, or null.
 * Accepts "UK" as an alias for "GB".
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeCountryCode(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().toUpperCase();
    if (!s) return null;
    if (s === 'UK') return 'GB';
    // Cloudflare: XX = unknown, T1 = tor exit
    if (s === 'XX' || s === 'T1') return null;
    if (/^[A-Z]{2}$/.test(s)) return s;
    return null;
}

/**
 * Resolve the customer country code used for currency bucketing.
 *
 * Precedence:
 *   1. CF-IPCountry header (case-insensitive header name)
 *   2. Explicit country / region (opts or query)
 *   3. 'US' (USD default)
 *
 * @param {object} [opts]
 * @param {Record<string, string|string[]|undefined>} [opts.headers]
 * @param {string} [opts.country]
 * @param {string} [opts.region]
 * @param {Record<string, string>|URLSearchParams} [opts.query]
 * @returns {string} ISO alpha-2 upper-case
 */
function resolveCountryCode(opts = {}) {
    const headers = opts.headers || {};
    const cfRaw = _header(headers, 'cf-ipcountry');
    const fromCf = normalizeCountryCode(cfRaw);
    if (fromCf) return fromCf;

    let qCountry;
    let qRegion;
    if (opts.query) {
        if (typeof opts.query.get === 'function') {
            qCountry = opts.query.get('country');
            qRegion  = opts.query.get('region');
        } else {
            qCountry = opts.query.country;
            qRegion  = opts.query.region;
        }
    }

    const explicit = normalizeCountryCode(opts.country || opts.region || qCountry || qRegion);
    if (explicit) return explicit;

    return 'US';
}

/**
 * @param {string} countryCode
 * @returns {'eur'|'gbp'|'usd'}
 */
function currencyForCountry(countryCode) {
    const c = normalizeCountryCode(countryCode) || 'US';
    if (c === 'GB') return 'gbp';
    if (EU_COUNTRIES.has(c)) return 'eur';
    return 'usd';
}

/**
 * Resolve full pricing for a request context.
 * @param {object} [opts] — same as resolveCountryCode
 * @returns {{ countryCode: string, currency: 'eur'|'gbp'|'usd', amountCents: number, renewalCents: number, amount: number, renewal: number }}
 */
function getPricing(opts = {}) {
    const countryCode = resolveCountryCode(opts);
    const currency    = currencyForCountry(countryCode);
    return {
        countryCode,
        currency,
        amountCents:  PRICE_CENTS,
        renewalCents: RENEWAL_CENTS,
        amount:       PRICE_CENTS / 100,
        renewal:      RENEWAL_CENTS / 100,
    };
}

/**
 * Convenience: pricing from a Node IncomingMessage-like request.
 * @param {{ headers?: Record<string, string|string[]|undefined> }|null|undefined} req
 * @param {{ country?: string, region?: string, query?: Record<string,string>|URLSearchParams }} [extra]
 */
function getPricingFromRequest(req, extra = {}) {
    return getPricing({
        headers: (req && req.headers) || {},
        country: extra.country,
        region:  extra.region,
        query:   extra.query,
    });
}

/**
 * Human-facing money label for the builder UI (e.g. "100€", "£100", "$100").
 * @param {number} amount
 * @param {string} currency
 * @returns {string}
 */
function formatMoney(amount, currency) {
    const cur = String(currency || 'usd').toLowerCase();
    const n = Number(amount);
    const s = Number.isFinite(n) ? String(n) : '—';
    if (cur === 'gbp') return '£' + s;
    if (cur === 'eur') return s + '€';
    return '$' + s;
}

function _header(headers, name) {
    if (!headers) return undefined;
    const want = name.toLowerCase();
    for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === want) {
            const v = headers[k];
            return Array.isArray(v) ? v[0] : v;
        }
    }
    return undefined;
}

module.exports = {
    PRICE_CENTS,
    RENEWAL_CENTS,
    EU_COUNTRIES,
    normalizeCountryCode,
    resolveCountryCode,
    currencyForCountry,
    getPricing,
    getPricingFromRequest,
    formatMoney,
};
