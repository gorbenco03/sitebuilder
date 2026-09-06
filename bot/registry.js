'use strict';
/**
 * bot/registry.js — Central data registry for the web platform.
 *
 * This file is now a thin backend switcher. The 21 functions it re-exports,
 * their signatures, return shapes and error messages are unchanged from
 * before this rewrite — every consumer (bot/server.js, bot/webpublish.js,
 * bot/flow.js, bot/calendar-native/email/index.js, ...) keeps working
 * without modification.
 *
 * REGISTRY_BACKEND selects the storage engine:
 *   - "sqlite" (default) — bot/registry-sqlite.js. Separate indexed tables
 *     instead of one dict-of-dicts JSON file rewritten whole on every
 *     mutation. On first use it runs a one-time, idempotent, non-destructive
 *     migration of any existing .registry.json (bot/registry-migrate.js).
 *   - "json" — bot/registry-json.js, the original file-based implementation.
 *     This is the emergency exit: flipping back to the JSON backend is an
 *     environment variable, never a code change or a redeploy of different
 *     code.
 *
 * Both backends carry the same four deliberate behavior fixes over the
 * original registry.js (see bot/registry-shared.js for the shared ones):
 *   1. createSite: an explicit slug that collides with an existing site is
 *      now rejected with a clear error, instead of silently allowing two
 *      sites at the same public address.
 *   2. addMonthsIso: an unparseable fromIso is now rejected explicitly,
 *      instead of silently granting a year of paid access from "now".
 *   3. claimStripeEvent: a falsy/non-string eventId is now rejected
 *      explicitly, instead of silently disabling webhook idempotency.
 *   4. updateSite: the patch is now filtered to the known site schema,
 *      instead of a raw Object.assign that persisted any foreign key.
 */

function _resolveBackendName() {
    const raw = String(process.env.REGISTRY_BACKEND || 'sqlite').trim().toLowerCase();
    return raw === 'json' ? 'json' : 'sqlite';
}

const BACKEND = _resolveBackendName();

module.exports = BACKEND === 'json'
    ? require('./registry-json')
    : require('./registry-sqlite');
