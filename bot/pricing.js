'use strict';
/**
 * bot/pricing.js — single commercial pricing source for Hidook Site Builder.
 *
 * Amounts (minor units / cents):
 *   - First public publish: 9900 (99 major units)
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
 *   3. Isolated local boot (HIDOOK_ISOLATED_DEPLOY=1 + HIDOOK_TEST_PAY=1,
 *      non-production): Accept-Language ro/ro-* → RO; else default RO → EUR
 *      (Romanian stranger QA without CF country header must not see $99)
 *   4. Default US → USD bucket (production / non-isolated)
 *
 * Callers must not hardcode BUILD_FEE / RETAINER defaults of 49.
 */

/** First-publish price in cents (99.00). */
const PRICE_CENTS = 9900;

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
 * True for local/isolated QA boots (not production). Used only as a soft
 * default when CF-IPCountry is absent so RO strangers see EUR, not USD.
 */
function isIsolatedDevBoot() {
    return (
        process.env.HIDOOK_ISOLATED_DEPLOY === '1' &&
        process.env.HIDOOK_TEST_PAY === '1' &&
        process.env.NODE_ENV !== 'production'
    );
}

/**
 * Map Accept-Language to a country code when the primary tag is Romanian.
 * @param {Record<string, string|string[]|undefined>} headers
 * @returns {string|null}
 */
function countryFromAcceptLanguage(headers) {
    const raw = _header(headers, 'accept-language');
    if (raw == null || raw === '') return null;
    const parts = String(raw).split(',');
    for (const part of parts) {
        const tag = part.split(';')[0].trim().toLowerCase();
        if (!tag) continue;
        if (tag === 'ro' || tag.startsWith('ro-')) return 'RO';
        // First non-empty tag wins; only RO is special-cased for isolated EUR.
        break;
    }
    return null;
}

/**
 * Resolve the customer country code used for currency bucketing.
 *
 * Precedence:
 *   1. CF-IPCountry header (case-insensitive header name)
 *   2. Explicit country / region (opts or query)
 *   3. Isolated local boot: Accept-Language ro → RO; else RO default
 *   4. 'US' (USD default)
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

    if (isIsolatedDevBoot()) {
        const fromLang = countryFromAcceptLanguage(headers);
        if (fromLang) return fromLang;
        return 'RO';
    }

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
 * Human-facing money label for the builder UI (e.g. "99€", "£99", "$99").
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
    isIsolatedDevBoot,
    countryFromAcceptLanguage,
};
