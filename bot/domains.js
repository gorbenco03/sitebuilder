/**
 * domains.js — Vercel Domains API: check availability, buy a domain.
 *
 * SaaS flow position:
 *   client describes business → AI builds site → collect payment (payments.js)
 *   → [THIS MODULE: buy domain] → deploy site (deploy-vercel.js) → return live URL
 *
 * Required env var:
 *   VERCEL_TOKEN    — Vercel personal access token or team token.
 *
 * Optional env var:
 *   VERCEL_TEAM_ID  — Vercel team ID. When present, all requests include ?teamId=...
 *                     Required if the token belongs to a team scope.
 *
 * NOTE: API version numbers (v4) are best-effort current as of mid-2025.
 * If Vercel bumps a version, update the VERCEL_API constant below.
 *
 * @module domains
 */

'use strict';

// Centralize base URL/version so bumping is a one-line change.
// Vercel deprecated the old /v4/domains/{status,price,buy} endpoints (sunset Nov 2025)
// in favour of the Domains Registrar API under /v1/registrar/domains/{domain}/...
const VERCEL_API = 'https://api.vercel.com';
const REGISTRAR_BASE = '/v1/registrar/domains'; // availability, price, buy live under here

// TLDs to probe in suggestDomains — ordered by general e-commerce relevance.
const SUGGEST_TLDS = ['.com', '.shop', '.store', '.bakery', '.ro'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the optional teamId query parameter string (including leading '?').
 * Returns '' when VERCEL_TEAM_ID is not set.
 */
function teamQuery(base = '') {
    const teamId = process.env.VERCEL_TEAM_ID;
    if (!teamId) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}teamId=${encodeURIComponent(teamId)}`;
}

/**
 * Execute a Vercel API call. Throws an Error with the Vercel error message on
 * non-2xx responses.
 *
 * @param {string} method   HTTP method
 * @param {string} urlPath  Full path (e.g. '/v4/domains/status?name=foo.com')
 * @param {object|undefined} bodyObj  If provided, sent as JSON body.
 * @returns {Promise<object>} Parsed JSON response
 */
async function vercelRequest(method, urlPath, bodyObj) {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error('VERCEL_TOKEN is not set. Cannot call Vercel API.');

    const url = VERCEL_API + teamQuery(urlPath);
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: 'Bearer ' + token,
            ...(bodyObj ? { 'Content-Type': 'application/json' } : {}),
        },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        // Registrar API returns { message, code }; older endpoints used { error: { message } }.
        const msg = (json.error && json.error.message) || json.message || JSON.stringify(json);
        throw new Error(`Vercel ${method} ${urlPath} → ${res.status}: ${msg}`);
    }
    return json;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when VERCEL_TOKEN is present in the environment.
 * Use this to guard feature availability before calling other exports.
 *
 * @returns {boolean}
 */
function isConfigured() {
    return Boolean(process.env.VERCEL_TOKEN);
}

/**
 * Check domain availability and pricing (Domains Registrar API).
 *
 * Queries:
 *   GET /v1/registrar/domains/{domain}/availability → { available: boolean }
 *   GET /v1/registrar/domains/{domain}/price        → { years, purchasePrice, renewalPrice, transferPrice }
 *
 * `purchasePrice` may be a number or a string; we coerce to a number when possible.
 *
 * @param {string} name  Full domain name, e.g. 'myshop.com'
 * @returns {Promise<{name: string, available: boolean, priceUsd: number|null, years: number|null}>}
 */
async function checkDomain(name) {
    if (!name) throw new Error('name is required.');

    const encodedName = encodeURIComponent(name);

    // Availability check
    const statusData = await vercelRequest('GET', `${REGISTRAR_BASE}/${encodedName}/availability`);
    const available = Boolean(statusData.available);

    // Price check — may throw for premium/unsupported TLDs; degrade gracefully
    let priceUsd = null;
    let years = null;
    try {
        const priceData = await vercelRequest('GET', `${REGISTRAR_BASE}/${encodedName}/price`);
        const p = Number(priceData.purchasePrice);
        priceUsd = Number.isFinite(p) ? p : null;
        years = priceData.years != null ? Number(priceData.years) : null;
    } catch (_) {
        // Premium / unsupported TLD — leave priceUsd/years as null gracefully
    }

    return { name, available, priceUsd, years };
}

/**
 * Build registrant contact information from REGISTRANT_* env vars.
 * Vercel's Domains Registrar API requires full contact info to purchase a domain.
 * For an MVP, the platform registers domains under its own contact (set via env);
 * ownership can be transferred later. Returns null if required fields are missing.
 *
 * Required env: REGISTRANT_FIRST_NAME, REGISTRANT_LAST_NAME, REGISTRANT_EMAIL,
 *   REGISTRANT_PHONE (E.164, e.g. +40.721234567), REGISTRANT_ADDRESS1,
 *   REGISTRANT_CITY, REGISTRANT_STATE, REGISTRANT_ZIP, REGISTRANT_COUNTRY (ISO-2).
 *
 * @returns {object|null}
 */
function registrantFromEnv() {
    const e = process.env;
    const info = {
        firstName: e.REGISTRANT_FIRST_NAME,
        lastName: e.REGISTRANT_LAST_NAME,
        email: e.REGISTRANT_EMAIL,
        phone: e.REGISTRANT_PHONE,
        address1: e.REGISTRANT_ADDRESS1,
        city: e.REGISTRANT_CITY,
        state: e.REGISTRANT_STATE,
        zip: e.REGISTRANT_ZIP,
        country: e.REGISTRANT_COUNTRY,
    };
    const missing = Object.entries(info).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) return null;
    return info;
}

/**
 * Purchase a domain via the Vercel Domains Registrar API.
 *
 * IMPORTANT: The Vercel account linked to VERCEL_TOKEN must have a valid payment
 * method saved, otherwise this call fails. `expectedPriceUsd` must match the price
 * Vercel quoted via checkDomain() (a mismatch returns `expected_price_mismatch`).
 *
 * Uses:  POST /v1/registrar/domains/{domain}/buy
 *   body { autoRenew, years, expectedPrice, contactInformation }
 *
 * @param {string} name              Domain to buy, e.g. 'myshop.com'
 * @param {number} expectedPriceUsd  Price as returned by checkDomain().
 * @param {object} [contactInformation]  Registrant contact; defaults to REGISTRANT_* env.
 * @param {{years?: number, autoRenew?: boolean}} [opts]
 * @returns {Promise<{name: string, ok: boolean, orderId: string|undefined, raw: object}>}
 */
async function buyDomain(name, expectedPriceUsd, contactInformation, opts = {}) {
    if (!name) throw new Error('name is required.');
    if (expectedPriceUsd == null) throw new Error('expectedPriceUsd is required.');

    const contact = contactInformation || registrantFromEnv();
    if (!contact) {
        throw new Error(
            'Registrant contact info is required to buy a domain. Set REGISTRANT_* env vars ' +
            '(FIRST_NAME, LAST_NAME, EMAIL, PHONE, ADDRESS1, CITY, STATE, ZIP, COUNTRY) or pass contactInformation.'
        );
    }

    const encodedName = encodeURIComponent(name);
    const raw = await vercelRequest('POST', `${REGISTRAR_BASE}/${encodedName}/buy`, {
        autoRenew: opts.autoRenew === true,
        years: opts.years || 1,
        expectedPrice: expectedPriceUsd,
        contactInformation: contact,
    });

    return { name, ok: true, orderId: raw.orderId, raw };
}

/**
 * Suggest available domains by probing a set of TLDs for the given base name.
 * Best-effort: uses Promise.allSettled so individual TLD failures don't abort the list.
 *
 * @param {string} base  Base name without TLD, e.g. 'myshop' or 'desserd'
 * @returns {Promise<Array<{name: string, available: boolean, priceUsd: number|null, period: number|null}>>}
 *   Only the available domains, sorted by priceUsd ascending (nulls last).
 */
async function suggestDomains(base) {
    if (!base) throw new Error('base is required.');
    const slug = base.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    const candidates = SUGGEST_TLDS.map(tld => slug + tld);

    const results = await Promise.allSettled(candidates.map(name => checkDomain(name)));

    const available = results
        .filter(r => r.status === 'fulfilled' && r.value.available)
        .map(r => r.value);

    // Sort by price ascending, nulls at the end
    available.sort((a, b) => {
        if (a.priceUsd == null && b.priceUsd == null) return 0;
        if (a.priceUsd == null) return 1;
        if (b.priceUsd == null) return -1;
        return a.priceUsd - b.priceUsd;
    });

    return available;
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = { isConfigured, checkDomain, buyDomain, suggestDomains };

// ---------------------------------------------------------------------------
// Self-test (run: node bot/domains.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
    console.log('domains.js self-test');
    console.log('  isConfigured():', isConfigured());
    if (!isConfigured()) {
        console.log('  VERCEL_TOKEN not set — all API calls would throw a clear Error. ✓');
        console.log('  Example:');
        console.log('    checkDomain("myshop.com")');
        console.log('    → throws: "VERCEL_TOKEN is not set. Cannot call Vercel API."');
    } else {
        console.log('  VERCEL_TOKEN is present — Vercel domain API calls are enabled.');
        console.log('  VERCEL_TEAM_ID:', process.env.VERCEL_TEAM_ID || '(not set — using personal account)');
    }
}
