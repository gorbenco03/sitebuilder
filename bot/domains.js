/**
 * domains.js — two independent domain features share this file:
 *
 *   1. Vercel Domains Registrar API: check availability, buy a NEW domain
 *      for a client (isConfigured/checkDomain/buyDomain/suggestDomains,
 *      unchanged below).
 *
 *   2. Wave 7 (audit finding #47, high/rebuild) — self-serve "bring your own
 *      domain": an owner who already owns e.g. 'myshop.com' elsewhere
 *      connects it to their Hidook site with NO human/concierge step. This
 *      is the fix for the manual-concierge dead end that used to live in
 *      bot/webpublish.js's "your own domain? contact us" message — see the
 *      "Wave 7 — self-serve custom domain connect" section below. It rides
 *      on Cloudflare Pages (bot/deploy-cloudflare.js), since that is the
 *      deploy provider this codebase actually uses.
 *
 * SaaS flow position (feature 1):
 *   client describes business → AI builds site → collect payment (payments.js)
 *   → [THIS MODULE: buy domain] → deploy site (deploy-vercel.js) → return live URL
 *
 * Required env var (feature 1):
 *   VERCEL_TOKEN    — Vercel personal access token or team token.
 *
 * Optional env var (feature 1):
 *   VERCEL_TEAM_ID  — Vercel team ID. When present, all requests include ?teamId=...
 *                     Required if the token belongs to a team scope.
 *
 * NOTE: API version numbers (v4) are best-effort current as of mid-2025.
 * If Vercel bumps a version, update the VERCEL_API constant below.
 *
 * @module domains
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const dns    = require('dns').promises;
const net    = require('net');
const crypto = require('crypto');
const { domainToASCII } = require('url');
const cfDeploy = require('./deploy-cloudflare.js');

// webpublish.js requires ./domains.js to resolve a site's active custom
// domain (predictedPublicOrigin), so requiring it back at module load would
// deadlock require()'s circular-dependency resolution. Same lazy pattern
// bot/webpublish.js already uses for bot/flow.js.
function getWebpublish() { return require('./webpublish.js'); }

const PROJECT_ROOT = path.join(__dirname, '..');

// Centralize base URL/version so bumping is a one-line change.
// Vercel deprecated the old /v4/domains/{status,price,buy} endpoints (sunset Nov 2025)
// in favour of the Domains Registrar API under /v1/registrar/domains/{domain}/...
const VERCEL_API = 'https://api.vercel.com';
const REGISTRAR_BASE = '/v1/registrar/domains'; // availability, price, buy live under here

// TLDs to probe in suggestDomains — ordered by general e-commerce relevance.
const SUGGEST_TLDS = ['.com', '.shop', '.store', '.bakery', '.ro'];

/**
 * DI-05: this module's own vercelRequest (domain availability/price/buy) had
 * no timeout either, same defect as deploy-vercel.js's copy. Kept as its own
 * constant/env var since the two modules are intentionally independent
 * copies, not a shared dependency.
 */
const VERCEL_API_TIMEOUT_MS = Number(process.env.VERCEL_API_TIMEOUT_MS) || 15000;

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
    let res;
    try {
        res = await fetch(url, {
            method,
            headers: {
                Authorization: 'Bearer ' + token,
                ...(bodyObj ? { 'Content-Type': 'application/json' } : {}),
            },
            body: bodyObj ? JSON.stringify(bodyObj) : undefined,
            signal: AbortSignal.timeout(VERCEL_API_TIMEOUT_MS),
        });
    } catch (e) {
        if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
            throw new Error(`Vercel ${method} ${urlPath} timed out after ${VERCEL_API_TIMEOUT_MS}ms`);
        }
        throw e;
    }

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
 * @param {string} base  Base name without TLD, e.g. 'myshop' or 'example-shop'
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
// Wave 7 — self-serve custom domain connect (audit finding #47)
// ---------------------------------------------------------------------------
//
// Replaces bot/webpublish.js's old "want your own domain? contact us"
// concierge message with a flow the owner can complete entirely themselves:
//   1. startDomainConnection  — validate the domain, show exact DNS records.
//   2. checkDomainConnection  — poll DNS, report honestly (not yet visible /
//                                visible-but-wrong / verified).
//   3. activateDomainConnection + checkTlsStatus — attach to Cloudflare Pages
//                                and poll certificate/verification status.
//   4. disconnectDomainConnection — detach; site keeps serving on its Hidook
//                                subdomain, never goes dark.
//
// State persists in its own small JSON store (see _storePath below) rather
// than in bot/registry.js: registry's updateSite() patch is deliberately
// filtered to a fixed field allowlist (bot/registry-shared.js#KNOWN_SITE_
// FIELDS) as one of that rewrite's four defect fixes, and this module does
// not own that file. A domain connection is 1:1 with a site (siteId is the
// store key), which this shape expresses directly without touching that
// schema. bot/webpublish.js still owns the *site*'s url/status via registry;
// this module only tracks the domain-connection state machine and asks
// webpublish.js to flip the SEO origin when it changes (see
// applyCustomDomainOrigin in bot/webpublish.js).

/** Every state a domain connection can be in. */
const DOMAIN_STATES = Object.freeze([
    'awaiting_dns',    // records shown, nothing verified yet — the normal, expected "still waiting" state
    'dns_partial',     // one of TXT/CNAME is right, the other is missing or wrong
    'dns_verified',    // both DNS records check out; about to attach + get TLS
    'provisioning',    // attached to Cloudflare, certificate/validation in progress
    'active',          // TLS ready, Cloudflare reports it active — site actually serves on it
    'error',           // Cloudflare attach/status came back with a hard failure
    'disconnected',    // owner disconnected; site remains live on its Hidook subdomain
]);

const DOMAIN_DNS_TIMEOUT_MS = Number(process.env.DOMAIN_DNS_TIMEOUT_MS) || 8000;

/** Non-2xx-shaped error carrying a Romanian, owner-facing message + a machine code. */
function domainError(code, messageRo) {
    const err = new Error(messageRo);
    err.code = code;
    return err;
}

// -- Validation ---------------------------------------------------------

/**
 * Domains that must never be accepted as "your own domain": the platform's
 * own brand domain (and any subdomain of it — that's what every Hidook site
 * already lives on) plus Cloudflare Pages' own shared domain. Mirrors the
 * care bot/server.js's RESERVED_SLUGS takes for subdomains (BE-04): format
 * validity alone does not stop an owner from "connecting" a domain the
 * platform itself already serves everything on.
 */
function _forbiddenDomainBases() {
    return [process.env.BRAND_DOMAIN, 'hidook.tech', 'hidook.agency', 'pages.dev']
        .filter(Boolean)
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean);
}

function _isHidookOwnedDomain(domain) {
    return _forbiddenDomainBases().some((base) => domain === base || domain.endsWith('.' + base));
}

// RFC-1123-ish hostname: dot-separated labels, each 1-63 chars starting/ending
// alphanumeric, final label (TLD) at least 2 letters. Deliberately simple —
// good enough to reject junk input; DNS verification (below) is the real
// proof a domain is reachable and under the owner's control.
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Validate + normalize a customer-entered domain. Never a live network call —
 * pure format/policy checks, so a form can call this synchronously-fast
 * before ever touching DNS or Cloudflare.
 *
 * isApex is a heuristic (label count === 2): it misjudges multi-part public
 * suffixes like 'example.co.uk' as apex when it is not. Acceptable for this
 * product's audience (mostly .ro/.com); documented rather than silently
 * wrong — see HANDOFF-domains.md.
 *
 * @param {string} raw
 * @returns {{domain: string, isApex: boolean}}
 */
function normalizeDomain(raw) {
    let s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s) throw domainError('MISSING', 'Introdu domeniul tău (ex: myshop.com).');

    // Forgive a pasted full URL: strip scheme, path, query, fragment.
    s = s.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
    // Strip a trailing :port — but not for bare IPv6 (multiple colons; ':: 1'
    // would otherwise become '' and stop looking like the IP it is). Bracketed
    // IPv6+port ('[::1]:8080') is unwrapped instead of just port-stripped.
    if (s.startsWith('[') && s.includes(']')) {
        s = s.slice(1, s.indexOf(']'));
    } else if ((s.match(/:/g) || []).length === 1) {
        s = s.split(':')[0];
    }
    s = s.replace(/\.$/, ''); // trailing-dot FQDN form

    if (net.isIP(s)) {
        throw domainError(
            'IS_IP',
            'Nu poți conecta o adresă IP — ai nevoie de un nume de domeniu (ex: myshop.com).'
        );
    }

    // Normalize IDN (e.g. accented .ro names) to ASCII/punycode before the
    // hostname regex, the same way a browser or registrar would.
    const ascii = domainToASCII(s) || s;

    if (!HOSTNAME_RE.test(ascii)) {
        throw domainError(
            'INVALID_FORMAT',
            'Acesta nu pare a fi un domeniu valid. Exemplu corect: myshop.com sau afacereamea.ro.'
        );
    }
    if (_isHidookOwnedDomain(ascii)) {
        throw domainError(
            'IS_HIDOOK_DOMAIN',
            'Acesta este un (sub)domeniu Hidook — introdu propriul tău domeniu (ex: myshop.com).'
        );
    }

    const labels = ascii.split('.');
    return { domain: ascii, isApex: labels.length === 2 };
}

// -- Store: one JSON file, keyed by siteId ------------------------------
//
// Read lazily (not cached at module load) so tests can point DATA_DIR at a
// fresh temp directory per run without needing to bust require.cache.

function _storeDir() { return process.env.DATA_DIR || PROJECT_ROOT; }
function _storePath() { return path.join(_storeDir(), 'custom-domains.json'); }

function _loadStore() {
    try {
        return JSON.parse(fs.readFileSync(_storePath(), 'utf8')) || {};
    } catch (_) {
        return {};
    }
}

function _saveStore(store) {
    const p = _storePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
}

function _putRecord(record) {
    const store = _loadStore();
    store[record.siteId] = record;
    _saveStore(store);
    return record;
}

/** Remove a site's domain-connection record from the store entirely (not
 *  just `disconnected` — used only when the site itself is gone). */
function _deleteRecord(siteId) {
    const store = _loadStore();
    if (!Object.prototype.hasOwnProperty.call(store, siteId)) return false;
    delete store[siteId];
    _saveStore(store);
    return true;
}

/** @returns {object|null} the domain-connection record for a site, or null. */
function getDomainForSite(siteId) {
    if (!siteId) return null;
    return _loadStore()[siteId] || null;
}

/** @returns {string|null} the ACTIVE custom domain for a site, or null — the
 *  only lookup bot/webpublish.js's predictedPublicOrigin() needs. */
function getActiveDomainForSite(siteId) {
    const rec = getDomainForSite(siteId);
    return rec && rec.status === 'active' ? rec.targetHost : null;
}

function _findRecordByDomain(domain) {
    const store = _loadStore();
    return Object.values(store).find((r) => r.domain === domain) || null;
}

/**
 * Reject a domain already connected (or mid-verification) on a DIFFERENT
 * site. A disconnected record frees the domain back up. Mirrors the care
 * bot/registry-sqlite.js's unique slug constraint takes for subdomains —
 * two sites must never silently share one public address.
 */
function _assertDomainAvailable(domain, siteId) {
    const existing = _findRecordByDomain(domain);
    if (existing && existing.siteId !== siteId && existing.status !== 'disconnected') {
        throw domainError('ALREADY_CLAIMED', 'Acest domeniu este deja conectat la un alt site Hidook.');
    }
}

// -- DNS verification -----------------------------------------------------
//
// dns.promises has no built-in timeout/AbortSignal support (unlike fetch),
// so every lookup is raced against a plain timer here — same "never hang
// forever" rule the deploy adapters apply to their own outbound calls
// (bot/deploy-cloudflare.js's CF_API_TIMEOUT_MS / AbortSignal.timeout), just
// implemented with what dns.promises actually offers.

function _withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            const e = new Error(`${label} timed out after ${ms}ms`);
            e.code = 'ETIMEOUT';
            reject(e);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** True for DNS errors that just mean "record not there (yet)" — never an
 *  alarming failure, since propagation legitimately takes hours. */
function _isBenignDnsMiss(e) {
    return !!(e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA' || e.code === 'ESERVFAIL'));
}

/**
 * @returns {{state: 'ok'|'mismatch'|'not_found'|'error', expected: string, found?: string[], error?: string}}
 */
async function _checkTxtRecord(name, expectedValue) {
    try {
        const rows = await _withTimeout(dns.resolveTxt(name), DOMAIN_DNS_TIMEOUT_MS, `TXT ${name}`);
        const flat = rows.map((parts) => parts.join(''));
        if (flat.includes(expectedValue)) return { state: 'ok', expected: expectedValue, found: flat };
        if (flat.length) return { state: 'mismatch', expected: expectedValue, found: flat };
        return { state: 'not_found', expected: expectedValue };
    } catch (e) {
        if (_isBenignDnsMiss(e)) return { state: 'not_found', expected: expectedValue };
        return { state: 'error', expected: expectedValue, error: e.message };
    }
}

/**
 * @returns {{state: 'ok'|'mismatch'|'not_found'|'error', expected: string, found?: string[], error?: string}}
 */
async function _checkCnameRecord(name, expectedTarget) {
    try {
        const rows = await _withTimeout(dns.resolveCname(name), DOMAIN_DNS_TIMEOUT_MS, `CNAME ${name}`);
        const norm = (h) => String(h || '').toLowerCase().replace(/\.$/, '');
        if (rows.some((r) => norm(r) === norm(expectedTarget))) {
            return { state: 'ok', expected: expectedTarget, found: rows };
        }
        if (rows.length) return { state: 'mismatch', expected: expectedTarget, found: rows };
        return { state: 'not_found', expected: expectedTarget };
    } catch (e) {
        if (_isBenignDnsMiss(e)) return { state: 'not_found', expected: expectedTarget };
        return { state: 'error', expected: expectedTarget, error: e.message };
    }
}

/** TXT record name that proves control of targetHost, without pointing any
 *  traffic — created and checked before the CNAME cutover matters. */
function _verificationRecordName(targetHost) {
    return `_hidook-challenge.${targetHost}`;
}

/** Friendly, honest, never-alarming Romanian copy for every state — the "DNS
 *  can take hours" reality is spelled out so "still waiting" reads as normal. */
function _messageForStatus(status) {
    switch (status) {
        case 'awaiting_dns':
            return 'Nu am găsit încă înregistrările DNS. E normal — propagarea poate dura de la câteva minute până la câteva ore. Revino mai târziu și apasă din nou "Verifică".';
        case 'dns_partial':
            return 'Am găsit o parte din înregistrări, dar nu toate (sau au altă valoare decât cea indicată). Mai verifică o dată peste câteva minute.';
        case 'dns_verified':
            return 'Înregistrările DNS sunt corecte. Urmează activarea certificatului de securitate (HTTPS) — de obicei durează câteva minute.';
        case 'provisioning':
            return 'Certificatul de securitate (HTTPS) se activează. De obicei durează câteva minute, uneori până la o oră.';
        case 'active':
            return 'Domeniul tău este conectat și activ.';
        case 'error':
            return 'A apărut o problemă la conectarea domeniului. Poți încerca din nou.';
        case 'disconnected':
            return 'Domeniul a fost deconectat. Site-ul tău rămâne disponibil pe subdomeniul Hidook.';
        default:
            return '';
    }
}

/**
 * The exact, copy-pasteable DNS records for a pending connection, in
 * Romanian, with the real values for this domain (never a generic example).
 */
function _dnsInstructionsFor(record) {
    const records = [
        {
            tip: 'TXT',
            nume: _verificationRecordName(record.targetHost),
            valoare: `hidook-verify=${record.verificationToken}`,
            ttl: 'Auto (sau 300)',
            scop: 'Dovedește că deții acest domeniu.',
        },
        {
            tip: 'CNAME',
            nume: record.targetHost,
            valoare: record.pagesHost,
            ttl: 'Auto (sau 300)',
            scop: 'Direcționează domeniul către site-ul tău Hidook.',
        },
    ];
    const note = record.isApex
        ? `Domeniul principal "${record.domain}" nu poate avea o înregistrare CNAME — este o limitare a ` +
          `standardului DNS, nu a Hidook. Adaugă cele două înregistrări de mai sus pentru ` +
          `"${record.targetHost}", apoi la panoul domeniului tău configurează o redirecționare ` +
          `(forwarding) de la "${record.domain}" către "https://${record.targetHost}" — astfel vizitatorii ` +
          `care scriu "${record.domain}" ajung automat pe site.`
        : null;
    return {
        domain: record.domain,
        targetHost: record.targetHost,
        isApex: record.isApex,
        status: record.status,
        records,
        note,
        instructiuni:
            'Adaugă aceste înregistrări în panoul DNS al furnizorului tău de domeniu (locul unde ai ' +
            'cumpărat domeniul), exact cum sunt scrise mai jos, apoi apasă „Verifică". Propagarea DNS ' +
            'poate dura de la câteva minute până la câteva ore — este normal.',
        message: _messageForStatus(record.status),
    };
}

// -- Public flow: connect / verify / activate / disconnect ----------------

/**
 * Step 1 — validate the domain and start (or resume) a connection. Returns
 * the exact DNS records to create. Calling this again for the same
 * siteId+domain (e.g. the owner reopens the page) reuses the same
 * verification token instead of inventing a new one, so records already
 * created at the registrar keep matching.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @param {string} opts.projectName   Cloudflare Pages project name for this site.
 * @param {string} opts.domain        raw customer input.
 * @param {string} [opts.currentOrigin]  the site's current live URL/origin
 *   (e.g. registry site.url) — captured once as the value to restore on
 *   disconnect. Ignored on a resumed connection (already captured).
 * @returns {Promise<object>} DNS instructions (see _dnsInstructionsFor)
 */
async function startDomainConnection({ siteId, projectName, domain, currentOrigin }) {
    if (!siteId) throw new Error('siteId is required.');
    if (!projectName) throw new Error('projectName is required.');

    const { domain: normalized, isApex } = normalizeDomain(domain);
    _assertDomainAvailable(normalized, siteId);

    const pagesHost = await cfDeploy.fetchPagesHost(projectName);
    if (!pagesHost) {
        throw domainError(
            'PAGES_HOST_UNKNOWN',
            'Nu am putut determina adresa Cloudflare a site-ului tău. Republică site-ul o dată și încearcă din nou.'
        );
    }

    const targetHost = isApex ? `www.${normalized}` : normalized;
    const existing = getDomainForSite(siteId);

    // Reconnecting to a different domain while an old one was attached/active:
    // detach the stale hostname from Cloudflare first (best-effort) so it
    // does not linger pointed at nothing useful.
    if (existing && existing.targetHost && existing.targetHost !== targetHost &&
        existing.status !== 'disconnected') {
        try { await cfDeploy.detachDomain(existing.projectName, existing.targetHost); } catch (_) {}
    }

    const reuseToken = existing && existing.domain === normalized && existing.verificationToken;
    const record = {
        siteId,
        projectName,
        domain: normalized,
        isApex,
        targetHost,
        pagesHost,
        verificationToken: reuseToken || crypto.randomBytes(16).toString('hex'),
        status: 'awaiting_dns',
        previousOrigin: (existing && existing.previousOrigin) || currentOrigin || null,
        createdAt: (existing && existing.createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastCheck: null,
        lastError: null,
        attachedAt: null,
        disconnectedAt: null,
    };
    _putRecord(record);
    return _dnsInstructionsFor(record);
}

/**
 * Step 2 — poll DNS and report honestly: not yet visible (awaiting_dns),
 * visible but wrong (dns_partial — mismatch on the per-record detail),
 * or verified (dns_verified). Never claims success before both records
 * actually check out, and never hangs (every DNS call is timed out above).
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @returns {Promise<object>}
 */
async function checkDomainConnection({ siteId }) {
    const record = getDomainForSite(siteId);
    if (!record) throw domainError('NO_DOMAIN', 'Nu există niciun domeniu conectat pentru acest site.');
    if (record.status === 'disconnected') {
        return { status: 'disconnected', message: _messageForStatus('disconnected') };
    }
    // Already active/provisioning: DNS was already proven; re-checking raw
    // records adds nothing and risks a transient resolver hiccup reading as
    // a regression. Use checkTlsStatus to poll those states instead.
    if (record.status === 'active' || record.status === 'provisioning') {
        return { status: record.status, message: _messageForStatus(record.status) };
    }

    const txtName = _verificationRecordName(record.targetHost);
    const expectedTxt = `hidook-verify=${record.verificationToken}`;
    const [txt, cname] = await Promise.all([
        _checkTxtRecord(txtName, expectedTxt),
        _checkCnameRecord(record.targetHost, record.pagesHost),
    ]);

    // "Visible" means the resolver actually returned something for that name
    // (right or wrong) — not_found/error (a resolver hiccup or genuine
    // absence) both read as "nothing there yet", never as partial progress.
    const isVisible = (r) => r.state !== 'not_found' && r.state !== 'error';
    const bothOk = txt.state === 'ok' && cname.state === 'ok';
    const status = bothOk ? 'dns_verified'
        : (isVisible(txt) || isVisible(cname)) ? 'dns_partial'
        : 'awaiting_dns';

    record.status = status;
    record.lastCheck = { txt, cname, checkedAt: new Date().toISOString() };
    record.updatedAt = new Date().toISOString();
    _putRecord(record);

    return { status, txt, cname, message: _messageForStatus(status) };
}

/** Map Cloudflare's Pages custom-domain status enum to this module's own
 *  small state set. See getDomainStatus's doc comment in deploy-cloudflare.js
 *  for why this mapping — not the raw Cloudflare value — is what the rest of
 *  this module and its tests depend on. */
function mapCloudflareStatus(cfStatus) {
    if (!cfStatus) return 'provisioning'; // not found yet right after attach — treat as "still working"
    const s = String(cfStatus.status || '').toLowerCase();
    if (s === 'active') return 'active';
    if (s === 'deactivated' || s === 'blocked' || s === 'error') return 'error';
    return 'provisioning'; // pending / pending_deployment / initializing / verifying / anything else
}

/**
 * Step 3a — once DNS is verified, attach the domain to the Cloudflare Pages
 * project and start TLS provisioning. Requires dns_verified (or a retry from
 * provisioning/active) — refuses to attach a domain whose DNS was never
 * actually confirmed.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @returns {Promise<object>} current status (see checkTlsStatus)
 */
async function activateDomainConnection({ siteId }) {
    const record = getDomainForSite(siteId);
    if (!record) throw domainError('NO_DOMAIN', 'Nu există niciun domeniu conectat pentru acest site.');
    if (!['dns_verified', 'provisioning', 'active'].includes(record.status)) {
        throw domainError(
            'NOT_VERIFIED',
            'Înregistrările DNS nu sunt încă verificate. Verifică mai întâi DNS-ul cu butonul „Verifică".'
        );
    }

    try {
        await cfDeploy.attachDomain(record.projectName, record.targetHost);
    } catch (e) {
        if (!cfDeploy.isAlreadyAttached(e)) {
            record.status = 'error';
            record.lastError = e.message;
            record.updatedAt = new Date().toISOString();
            _putRecord(record);
            throw domainError('ATTACH_FAILED', 'Nu am putut atașa domeniul. Încearcă din nou în câteva minute.');
        }
    }

    if (record.status !== 'active') {
        record.status = 'provisioning';
        record.updatedAt = new Date().toISOString();
        _putRecord(record);
    }

    return checkTlsStatus({ siteId });
}

/**
 * Step 3b — poll Cloudflare for TLS/verification status. The moment it first
 * reports active, this flips the site's SEO origin (canonical/og:url/
 * robots.txt/sitemap.xml) over to the custom domain via
 * webpublish.applyCustomDomainOrigin and redeploys — so "active" here always
 * means the live site really is already serving correctly on the domain,
 * never a claim made ahead of that.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @returns {Promise<object>}
 */
async function checkTlsStatus({ siteId }) {
    const record = getDomainForSite(siteId);
    if (!record) throw domainError('NO_DOMAIN', 'Nu există niciun domeniu conectat pentru acest site.');
    if (record.status === 'disconnected') {
        return { status: 'disconnected', message: _messageForStatus('disconnected') };
    }

    const cfStatus = await cfDeploy.getDomainStatus(record.projectName, record.targetHost);
    const mapped = mapCloudflareStatus(cfStatus);

    if (mapped === 'active' && record.status !== 'active') {
        record.status = 'active';
        record.attachedAt = new Date().toISOString();
        record.lastError = null;
        _putRecord(record);
        try {
            await getWebpublish().applyCustomDomainOrigin({ siteId: record.siteId, domain: record.targetHost });
        } catch (e) {
            record.lastError = 'origin-switch: ' + e.message;
            _putRecord(record);
        }
    } else if (mapped !== record.status) {
        record.status = mapped;
        record.updatedAt = new Date().toISOString();
        _putRecord(record);
    }

    return { status: record.status, message: _messageForStatus(record.status), raw: cfStatus };
}

/**
 * Step 4 — disconnect. Detaches from Cloudflare (best-effort — a failure here
 * still disconnects locally so the owner is never stuck) and always restores
 * the site's canonical/og:url/robots.txt/sitemap.xml to its Hidook subdomain,
 * which was never touched by any of the steps above and so is still reachable.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @returns {Promise<object>}
 */
async function disconnectDomainConnection({ siteId }) {
    const record = getDomainForSite(siteId);
    if (!record) throw domainError('NO_DOMAIN', 'Nu există niciun domeniu conectat pentru acest site.');

    try {
        await cfDeploy.detachDomain(record.projectName, record.targetHost);
    } catch (e) {
        record.lastError = 'detach: ' + e.message;
    }

    record.status = 'disconnected';
    record.disconnectedAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    _putRecord(record);

    try {
        await getWebpublish().applyCustomDomainOrigin({
            siteId: record.siteId,
            domain: null,
            fallbackOrigin: record.previousOrigin,
        });
    } catch (e) {
        record.lastError = (record.lastError ? record.lastError + '; ' : '') + 'origin-restore: ' + e.message;
        _putRecord(record);
    }

    return { status: 'disconnected', message: _messageForStatus('disconnected') };
}

/**
 * Site deletion cleanup: unlike disconnectDomainConnection() (customer-
 * initiated, keeps a `disconnected` record so the domain can be reconnected
 * or claimed elsewhere later), a deleted site has nothing left to reconnect
 * to — best-effort detach from the deploy provider, then remove the record
 * entirely. Never restores a fallback origin (there is no site left to point
 * it at). Idempotent: no record for this site is a silent no-op.
 * @param {string} siteId
 * @returns {Promise<{removed: boolean}>}
 */
async function deleteDomainRecordForSite(siteId) {
    const record = getDomainForSite(siteId);
    if (!record) return { removed: false };
    try {
        await cfDeploy.detachDomain(record.projectName, record.targetHost);
    } catch (_) {
        // Best-effort — the site's own files/registry row are being removed
        // regardless; a stuck DNS/edge record at the provider is not a reason
        // to fail the owner's delete request.
    }
    _deleteRecord(siteId);
    return { removed: true };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
    isConfigured, checkDomain, buyDomain, suggestDomains,
    // Wave 7 — self-serve custom domain connect
    DOMAIN_STATES,
    normalizeDomain,
    startDomainConnection,
    checkDomainConnection,
    activateDomainConnection,
    checkTlsStatus,
    disconnectDomainConnection,
    deleteDomainRecordForSite,
    getDomainForSite,
    getActiveDomainForSite,
    mapCloudflareStatus,
};

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
