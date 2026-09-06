'use strict';
/**
 * bot/registry-schema.js — relational schema for the SQLite-backed registry.
 *
 * Six tables, one per collection the old .registry.json kept as a dict, plus
 * a stripe_events table for webhook idempotency (previously db.stripeEvents)
 * and a tiny registry_meta table used only for the one-time JSON migration
 * marker (bot/registry-migrate.js).
 *
 * sites.slug carries a UNIQUE constraint — deliberate fix (1 of 4), see
 * bot/registry-shared.js and bot/registry-sqlite.js#createSite.
 *
 * sites keeps a small `extra` JSON column for the handful of fields that
 * only ever appear after an updateSite call (never set by createSite:
 * ownerChatId, businessName, canceledAt, paidUntil, stripe*, ...). This is
 * NOT a return to "store anything" — bot/registry-shared.js#KNOWN_SITE_FIELDS
 * still filters what can land there (deliberate fix 4 of 4). It exists
 * because a JSON blob is the only way to keep faith with the original
 * Object.assign semantics: a field explicitly patched to `null` must still
 * be a PRESENT key on the returned record (`'canceledAt' in site === true`,
 * value null), which is indistinguishable from "never set" if it were a
 * plain nullable column. All fields that are always set at creation time
 * (id, userId, templateId, ...) are real, indexed columns instead.
 *
 * versions.config and tokens.payload are opaque JSON blobs by nature (they
 * always were — the whole point of the rewrite is that publishing a new
 * version no longer rewrites every other row, not that the payload shrinks).
 *
 * `seq` INTEGER PRIMARY KEY AUTOINCREMENT columns on versions/orders/
 * stripe_events give a strictly-increasing, never-reused tie-breaker for
 * "insertion order", matching what a stable Array.prototype.sort over
 * Object.values() gave the JSON backend for free.
 */

const SCHEMA_VERSION = 2;

const SCHEMA_SQL_V1 = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    tg_id TEXT,
    username TEXT,
    first_name TEXT,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id) WHERE tg_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    exp INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tokens_exp ON tokens(exp);

CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    template_id TEXT,
    template_version INTEGER,
    slug TEXT NOT NULL UNIQUE,
    project_name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'web',
    status TEXT NOT NULL DEFAULT 'draft',
    paid INTEGER NOT NULL DEFAULT 0,
    url TEXT,
    created_at TEXT NOT NULL,
    extra TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);

CREATE TABLE IF NOT EXISTS versions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id TEXT NOT NULL UNIQUE,
    site_id TEXT NOT NULL,
    published_at TEXT NOT NULL,
    config TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_site_id_seq ON versions(site_id, seq);

CREATE TABLE IF NOT EXISTS orders (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    site_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'eur',
    stripe_session_id TEXT,
    kind TEXT NOT NULL DEFAULT 'publish',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_site_kind_status ON orders(site_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id ON orders(stripe_session_id);

CREATE TABLE IF NOT EXISTS stripe_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_seen_at ON stripe_events(seen_at, seq);

CREATE TABLE IF NOT EXISTS registry_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
`;

/**
 * Wave 8 (AUDIT-07 re-audit): session revocation, so logout can make an
 * already-issued cookie stop working instead of only clearing it client-side.
 *
 * Design chosen: a server-side session table (an "allow list", not a deny
 * list). signSession() now mints a random `sid` and INSERTs a row here;
 * verifySession() additionally requires that row to exist, be unexpired, and
 * be unrevoked. Logout UPDATEs revoked_at for one sid; "log out everywhere"
 * UPDATEs revoked_at for every row belonging to a user_id in one statement.
 *
 * Why this over the alternatives named in the brief:
 *   - A per-user token-generation counter is cheaper (one integer column,
 *     O(1) storage) but conflates the two features this product needs to
 *     keep distinct: "sign out this browser" vs. "sign out everywhere" — a
 *     counter bump is inherently global, so an ordinary Deconectare click
 *     would silently end every other device's session too.
 *   - A deny list of only-revoked tokens is smaller in the common case (most
 *     sessions expire naturally and are never revoked) but still needs a
 *     sweep to bound growth, and "log out everywhere" over a deny list means
 *     denying tokens the server was never shown — undoable only by also
 *     keeping a per-user list of issued sids, i.e. this same table.
 *   - This table costs one row per issued session (bounded: idx_sessions_exp
 *     lets expired rows be swept opportunistically — see
 *     registry-sqlite.js#createSession/registry-json.js's session helpers)
 *     and gives both features from one mechanism with one indexed lookup
 *     per request.
 *
 * What it does NOT protect against: a cookie replayed within its own
 * still-valid, not-yet-revoked window (there is nothing to detect "two
 * different machines are presenting the same sid concurrently" without
 * device fingerprints this product doesn't collect); and it cannot revoke a
 * session signed before this migration shipped, because such a cookie has no
 * `sid` claim to look up — auth.js treats a `sid`-less cookie as invalid
 * (forces one re-login per active session, once, at deploy time) rather than
 * silently trusting an unrevocable token forever.
 */
const SCHEMA_SQL_V2 = `
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    exp INTEGER NOT NULL,
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp);
`;

// SCHEMA_SQL is the union applied to a brand-new database. Kept as a
// separate name (matching the bot/calendar-native/db.js migration pattern)
// so a v3 can be added later without changing the shape of migrate().
const SCHEMA_SQL = SCHEMA_SQL_V1 + '\n' + SCHEMA_SQL_V2;

module.exports = {
    SCHEMA_VERSION,
    SCHEMA_SQL,
    SCHEMA_SQL_V1,
    SCHEMA_SQL_V2,
};
