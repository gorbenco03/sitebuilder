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
 *      (ignores CF unknowns XX / T1). Requires Cloudflare (orange-cloud DNS) in
 *      front of the origin — NOT provided by Railway/Vercel by themselves.
 *   2. Explicit country or region on the request (opts.country, opts.region,
 *      or query.country / query.region) — nothing in the current builder UI
 *      sends this; it exists for future/manual callers.
 *   3. PC-02 fallback (any environment, including production without a CF
 *      proxy in front of Railway): coarse Accept-Language guess — an
 *      EU-language region subtag (e.g. "en-GB", "de-AT") or bare EU language
 *      primary tag (e.g. "ro", "fr") maps to that country; ambiguous tags
 *      (e.g. bare "en") resolve to nothing so they fall through to USD rather
 *      than guessing wrong. See countryFromAcceptLanguage().
 *   4. Isolated local boot only (HIDOOK_ISOLATED_DEPLOY=1 + HIDOOK_TEST_PAY=1,
 *      non-production) and steps 1-3 all found nothing: default RO → EUR
 *      (Romanian stranger QA without CF country header must not see $99).
 *   5. Default US → USD bucket (production / non-isolated, nothing matched).
 *
 * PC-02: without Cloudflare in front of the origin, step 1 never fires in
 * production (Railway does not add CF-IPCountry). Step 3 keeps most real EU/UK
 * visitors correctly bucketed from their browser's Accept-Language even then.
 * A one-time startup-shaped warning is logged (see _warnMissingCfCountrySourceOnce)
 * the first time production resolves a request without a CF-IPCountry header,
 * so operators can see the gap and add the Cloudflare proxy (recommendation a).
 *
 * Callers must not hardcode BUILD_FEE / RETAINER defaults of 49.
 */

const { log } = require('./logger.js');

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
 * PC-02 fallback map: EU-language primary tag → one representative EU member
 * state using that language, for coarse EUR/GBP/USD currency bucketing only
 * (not a general locale→country resolver). Deliberately excludes 'en' — English
 * is spoken far beyond the EU/UK, so a bare "en" tag must NOT guess GBP/EUR.
 */
const EU_LANGUAGE_TO_COUNTRY = {
    ro: 'RO', bg: 'BG', hr: 'HR', cs: 'CZ', da: 'DK', nl: 'NL', et: 'EE',
    fi: 'FI', fr: 'FR', de: 'DE', el: 'GR', ga: 'IE', it: 'IT', lv: 'LV',
    lt: 'LT', mt: 'MT', pl: 'PL', pt: 'PT', sk: 'SK', sl: 'SI', es: 'ES',
    sv: 'SE', hu: 'HU',
};

/**
 * Map Accept-Language to a country code (PC-02 fallback — no CF-IPCountry, no
 * explicit country). Pure guess from what the visitor's own browser sends, no
 * external geolocation service or IP database.
 *
 * Precedence within the first (highest-preference) language tag:
 *   1. Region subtag matching GB or an EU_COUNTRIES member (e.g. "en-GB" → GB,
 *      "de-AT" → AT, "fr-CA" → null — CA is not EU/GB, correctly falls through).
 *   2. Primary language tag in EU_LANGUAGE_TO_COUNTRY (e.g. bare "ro" → RO).
 *   3. Otherwise null (notably bare "en" — ambiguous, must not guess).
 *
 * @param {Record<string, string|string[]|undefined>} headers
 * @returns {string|null}
 */
function countryFromAcceptLanguage(headers) {
    const raw = _header(headers, 'accept-language');
    if (raw == null || raw === '') return null;
    const parts = String(raw).split(',');
    for (const part of parts) {
        const tag = part.split(';')[0].trim();
        if (!tag) continue;
        const [langRaw, regionRaw] = tag.split('-');
        const lang = String(langRaw || '').toLowerCase();
        if (regionRaw) {
            const region = normalizeCountryCode(regionRaw);
            if (region && (region === 'GB' || EU_COUNTRIES.has(region))) return region;
        }
        if (EU_LANGUAGE_TO_COUNTRY[lang]) return EU_LANGUAGE_TO_COUNTRY[lang];
        // First non-empty tag wins — do not average across the whole list.
        return null;
    }
    return null;
}

/** Emit the PC-02 missing-CF-header production warning at most once per process. */
let _warnedMissingCfCountrySource = false;
function _warnMissingCfCountrySourceOnce() {
    if (_warnedMissingCfCountrySource) return;
    if (process.env.NODE_ENV !== 'production') return;
    _warnedMissingCfCountrySource = true;
    log('pricing.country_source.cf_header_missing', {
        message: 'CF-IPCountry header absent on a production request — currency '
            + 'bucketing fell back to Accept-Language / USD default. Put Cloudflare '
            + '(orange-cloud DNS) in front of the origin so EU/UK visitors are billed '
            + 'in EUR/GBP, not USD (VISION §2).',
    }, 'warn');
}

/**
 * Resolve the customer country code used for currency bucketing.
 *
 * Precedence (see the file-level docblock above for the full PC-02 rationale):
 *   1. CF-IPCountry header (case-insensitive header name)
 *   2. Explicit country / region (opts or query)
 *   3. Accept-Language coarse guess (any environment)
 *   4. Isolated local boot only: RO default
 *   5. 'US' (USD default)
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

    // PC-02: no CF-IPCountry and no explicit country — Railway (the documented
    // production target) never adds CF-IPCountry on its own, so this branch is
    // the normal path for every real production visitor, not just an edge case.
    // Try a coarse Accept-Language guess before giving up to USD.
    const fromLang = countryFromAcceptLanguage(headers);
    if (fromLang) return fromLang;

    if (isIsolatedDevBoot()) {
        // Romanian-stranger QA default: no CF header + no accept-language match
        // still must not show $99 to a RO tester.
        return 'RO';
    }

    _warnMissingCfCountrySourceOnce();
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
    EU_LANGUAGE_TO_COUNTRY,
};
