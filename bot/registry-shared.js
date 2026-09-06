'use strict';
/**
 * bot/registry-shared.js — pure helpers and the site-field allowlist shared
 * verbatim between the JSON backend (bot/registry-json.js) and the SQLite
 * backend (bot/registry-sqlite.js), so the two never drift apart on the
 * handful of behaviors that are NOT about storage mechanics.
 *
 * Also home to the three of the four deliberate behavior fixes that are pure
 * logic, independent of which storage engine is active (addMonthsIso input
 * validation, claimStripeEvent input validation, and the updateSite known-
 * field allowlist). The fourth fix — UNIQUE slug on createSite — is applied
 * in each backend directly (a real UNIQUE index in SQLite; an explicit scan
 * in the JSON backend) because the mechanism differs, but both use the same
 * error message shape defined here.
 */

/**
 * Build a URL-safe slug from a business name plus a short site-id suffix.
 * Unchanged from the original bot/registry.js — not one of the four fixes.
 * @param {string} name
 * @param {string} siteId
 * @returns {string}
 */
function buildSlug(name, siteId) {
    const base = (name || 'site')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'site';
    const suffix = siteId.replace(/-/g, '').slice(0, 6);
    return `${base}-${suffix}`;
}

/**
 * Add calendar months to an ISO date string (or now). Returns ISO string.
 *
 * DELIBERATE FIX (2 of 4): the original silently treated an unparseable
 * `fromIso` as "now", which could silently grant a year of paid access on a
 * billing-relevant call site that could never have supplied it. It now
 * throws explicitly instead. `fromIso` being null/undefined/'' (falsy) is
 * NOT this case — that already meant "use now" and still does.
 *
 * @param {string|null|undefined} fromIso
 * @param {number} [months]
 * @returns {string}
 */
function addMonthsIso(fromIso, months) {
    const base = fromIso ? new Date(fromIso) : new Date();
    if (!Number.isFinite(base.getTime())) {
        // Only reachable when fromIso is truthy but unparseable — a falsy
        // fromIso took the `new Date()` branch above, which is always valid.
        throw new Error(`addMonthsIso: fromIso is not a valid date: ${JSON.stringify(fromIso)}`);
    }
    const out = new Date(base.getTime());
    out.setUTCMonth(out.getUTCMonth() + (months || 0));
    return out.toISOString();
}

/**
 * DELIBERATE FIX (3 of 4): claimStripeEvent used to return `true` (and
 * record nothing) for a falsy or non-string eventId, silently disabling
 * webhook idempotency for malformed events. It now refuses such input
 * explicitly. Both backends call this before touching storage.
 *
 * @param {*} eventId
 */
function assertValidStripeEventId(eventId) {
    if (!eventId || typeof eventId !== 'string') {
        throw new Error('claimStripeEvent: eventId must be a non-empty string');
    }
}

/**
 * Site fields set at creation time (createSite) — always present on a site
 * record regardless of value, including when null (templateId, url, ...).
 */
const SITE_CORE_FIELDS = Object.freeze([
    'userId', 'templateId', 'templateVersion', 'slug', 'projectName',
    'platform', 'status', 'paid', 'url', 'createdAt',
]);

/**
 * Site fields that only ever appear after an updateSite call (never set by
 * createSite). Every real call site across bot/flow.js, bot/webpublish.js,
 * bot/server.js and the evidence scripts was enumerated to build this list.
 */
const SITE_EXTRA_FIELDS = Object.freeze([
    'ownerChatId', 'businessName', 'canceledAt', 'paidUntil',
    'stripeSubscriptionId', 'stripeSubscriptionStatus', 'subscriptionStatus',
    'stripeCustomerId',
]);

/** DELIBERATE FIX (4 of 4) allowlist: the union of the two field sets above.
 *  `id` is deliberately excluded — no real call site ever patches it, and a
 *  primary key is not something a partial update should be able to move. */
const KNOWN_SITE_FIELDS = new Set([...SITE_CORE_FIELDS, ...SITE_EXTRA_FIELDS]);

function isKnownSiteField(key) {
    return KNOWN_SITE_FIELDS.has(key);
}

function slugTakenError(slug) {
    return new Error(`Slug already in use: ${slug}`);
}

module.exports = {
    buildSlug,
    addMonthsIso,
    assertValidStripeEventId,
    SITE_CORE_FIELDS,
    SITE_EXTRA_FIELDS,
    KNOWN_SITE_FIELDS,
    isKnownSiteField,
    slugTakenError,
};
