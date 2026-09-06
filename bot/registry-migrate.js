'use strict';
/**
 * bot/registry-migrate.js — idempotent, non-destructive JSON → SQLite
 * migration for the registry.
 *
 * Contract (see DESIGN-stocare.md, etapa 3):
 *   - Idempotent: a `registry_meta` marker row is written only after a
 *     successful, verified migration; every call before that (including a
 *     process restart mid-way) re-attempts from scratch. Every insert also
 *     uses INSERT OR IGNORE, so a partial retry never produces duplicates.
 *   - Non-destructive: .registry.json is only ever read, never written to
 *     or deleted, by this module.
 *   - Verified: after copying, row counts per collection AND a deep-equality
 *     check on a spread sample of records (first, last, evenly-spaced
 *     middle ones) must both hold. If verification fails, the whole copy is
 *     rolled back (nothing partial is left behind) and this throws — the
 *     caller (bot/registry-sqlite.js, at module load) lets that propagate,
 *     which is a loud startup failure pointing at REGISTRY_BACKEND=json as
 *     the way to keep running while it's investigated. "Don't switch,
 *     report" from the design doc is implemented as "don't commit, throw".
 *
 * Can also be run standalone for an independent check:
 *   node --experimental-sqlite bot/registry-migrate.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MIGRATION_MARKER_KEY = 'migrated_from_json_at';

const SITE_CORE_KEYS = new Set([
    'id', 'userId', 'templateId', 'templateVersion', 'slug', 'projectName',
    'platform', 'status', 'paid', 'url', 'createdAt',
]);

function _readJsonRegistry(dataDir) {
    const file = path.join(dataDir, '.registry.json');
    if (!fs.existsSync(file)) return null;
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        throw new Error(`registry-migrate: could not read .registry.json: ${e.message}`);
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`registry-migrate: .registry.json exists but is not valid JSON: ${e.message}`);
    }
}

function _isAlreadyMigrated(db) {
    const row = db.prepare('SELECT value FROM registry_meta WHERE key = ?').get(MIGRATION_MARKER_KEY);
    return !!row;
}

function _countVersions(versions) {
    let n = 0;
    for (const arr of Object.values(versions || {})) n += Array.isArray(arr) ? arr.length : 0;
    return n;
}

// ---------------------------------------------------------------------------
// Copy (INSERT OR IGNORE — idempotent at the row level too)
// ---------------------------------------------------------------------------

function _copyUsers(db, users) {
    const stmt = db.prepare(
        'INSERT OR IGNORE INTO users (id, email, tg_id, username, first_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const u of Object.values(users || {})) {
        stmt.run(
            u.id,
            u.email != null ? u.email : null,
            u.tgId != null ? u.tgId : null,
            u.username != null ? u.username : null,
            u.firstName != null ? u.firstName : null,
            u.createdAt
        );
    }
}

function _copyTokens(db, tokens) {
    const stmt = db.prepare('INSERT OR IGNORE INTO tokens (hash, payload, exp, used) VALUES (?, ?, ?, ?)');
    for (const [hash, entry] of Object.entries(tokens || {})) {
        stmt.run(hash, JSON.stringify(entry.payload || {}), entry.exp, entry.used ? 1 : 0);
    }
}

/**
 * Split a legacy JSON site record into (core columns) + (extra JSON blob).
 * Every field beyond the fixed core set is preserved verbatim in `extra` —
 * including any stray key a production .registry.json might already carry
 * from the old Object.assign bug. Migration must not lose real data; the
 * new updateSite() field allowlist only governs FUTURE writes.
 */
function _copySites(db, sites) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO sites (id, user_id, template_id, template_version, slug, project_name, platform, status, paid, url, created_at, extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of Object.values(sites || {})) {
        const extra = {};
        for (const [k, v] of Object.entries(s)) {
            if (!SITE_CORE_KEYS.has(k)) extra[k] = v;
        }
        stmt.run(
            s.id,
            s.userId,
            s.templateId != null ? s.templateId : null,
            s.templateVersion != null ? s.templateVersion : null,
            s.slug,
            s.projectName != null ? s.projectName : s.slug,
            s.platform || 'web',
            s.status || 'draft',
            s.paid ? 1 : 0,
            s.url != null ? s.url : null,
            s.createdAt,
            JSON.stringify(extra)
        );
    }
}

function _copyVersions(db, versions) {
    const stmt = db.prepare('INSERT OR IGNORE INTO versions (version_id, site_id, published_at, config) VALUES (?, ?, ?, ?)');
    for (const [siteId, list] of Object.entries(versions || {})) {
        for (const v of (Array.isArray(list) ? list : [])) {
            stmt.run(v.versionId, siteId, v.publishedAt, JSON.stringify(v.config));
        }
    }
}

function _copyOrders(db, orders) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO orders (id, site_id, user_id, amount_cents, currency, stripe_session_id, kind, status, created_at, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const o of Object.values(orders || {})) {
        stmt.run(
            o.id, o.siteId, o.userId, o.amountCents,
            o.currency || 'eur',
            o.stripeSessionId != null ? o.stripeSessionId : null,
            o.kind || 'publish',
            o.status || 'pending',
            o.createdAt,
            o.paidAt != null ? o.paidAt : null
        );
    }
}

function _copyStripeEvents(db, events) {
    const stmt = db.prepare('INSERT OR IGNORE INTO stripe_events (event_id, seen_at) VALUES (?, ?)');
    for (const [eventId, entry] of Object.entries(events || {})) {
        stmt.run(eventId, entry.seenAt);
    }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/** Pick up to `n` keys spread across the array: first, last, and evenly-spaced others. */
function _sample(keys, n = 5) {
    if (keys.length <= n) return keys.slice();
    const picked = new Set([keys[0], keys[keys.length - 1]]);
    for (let i = 1; picked.size < n && i < n * 4; i++) {
        const idx = Math.floor((i * (keys.length - 1)) / (n - 1));
        picked.add(keys[idx]);
    }
    return Array.from(picked);
}

function _rowCount(db, table) {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function _verifyUsers(db, users, errors) {
    for (const id of _sample(Object.keys(users))) {
        const src = users[id];
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!row) { errors.push(`user ${id} missing after migration`); continue; }
        const got = { id: row.id, createdAt: row.created_at };
        if (row.email != null)      got.email = row.email;
        if (row.tg_id != null)      got.tgId = row.tg_id;
        if (row.username != null)   got.username = row.username;
        if (row.first_name != null) got.firstName = row.first_name;
        try { assert.deepStrictEqual(got, src); }
        catch (e) { errors.push(`user ${id} mismatch: ${e.message}`); }
    }
}

function _verifySites(db, sites, errors) {
    for (const id of _sample(Object.keys(sites))) {
        const src = sites[id];
        const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
        if (!row) { errors.push(`site ${id} missing after migration`); continue; }
        const extra = row.extra ? JSON.parse(row.extra) : {};
        const got = {
            id: row.id, userId: row.user_id, templateId: row.template_id,
            templateVersion: row.template_version, slug: row.slug, projectName: row.project_name,
            platform: row.platform, status: row.status, paid: !!row.paid, url: row.url,
            createdAt: row.created_at, ...extra,
        };
        try { assert.deepStrictEqual(got, src); }
        catch (e) { errors.push(`site ${id} mismatch: ${e.message}`); }
    }
}

function _verifyOrders(db, orders, errors) {
    for (const id of _sample(Object.keys(orders))) {
        const src = orders[id];
        const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
        if (!row) { errors.push(`order ${id} missing after migration`); continue; }
        const got = {
            id: row.id, siteId: row.site_id, userId: row.user_id, amountCents: row.amount_cents,
            currency: row.currency, stripeSessionId: row.stripe_session_id, kind: row.kind,
            status: row.status, createdAt: row.created_at,
        };
        if (row.paid_at != null) got.paidAt = row.paid_at;
        try { assert.deepStrictEqual(got, src); }
        catch (e) { errors.push(`order ${id} mismatch: ${e.message}`); }
    }
}

function _verifyTokens(db, tokens, errors) {
    for (const hash of _sample(Object.keys(tokens))) {
        const src = tokens[hash];
        const row = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(hash);
        if (!row) { errors.push(`token ${hash} missing after migration`); continue; }
        const got = { payload: JSON.parse(row.payload), exp: row.exp, used: !!row.used };
        const want = { payload: src.payload || {}, exp: src.exp, used: !!src.used };
        try { assert.deepStrictEqual(got, want); }
        catch (e) { errors.push(`token ${hash} mismatch: ${e.message}`); }
    }
}

function _verifyVersions(db, versions, errors) {
    const flat = [];
    for (const [siteId, list] of Object.entries(versions)) {
        for (const v of (Array.isArray(list) ? list : [])) flat.push({ siteId, v });
    }
    for (const i of _sample(flat.map((_, idx) => idx))) {
        const { siteId, v } = flat[i];
        const row = db.prepare('SELECT * FROM versions WHERE site_id = ? AND version_id = ?').get(siteId, v.versionId);
        if (!row) { errors.push(`version ${v.versionId} (site ${siteId}) missing after migration`); continue; }
        const got = { versionId: row.version_id, publishedAt: row.published_at, config: JSON.parse(row.config) };
        const want = { versionId: v.versionId, publishedAt: v.publishedAt, config: v.config };
        try { assert.deepStrictEqual(got, want); }
        catch (e) { errors.push(`version ${v.versionId} mismatch: ${e.message}`); }
    }
}

function _verifyStripeEvents(db, events, errors) {
    for (const id of _sample(Object.keys(events))) {
        const src = events[id];
        const row = db.prepare('SELECT * FROM stripe_events WHERE event_id = ?').get(id);
        if (!row) { errors.push(`stripe event ${id} missing after migration`); continue; }
        if (row.seen_at !== src.seenAt) errors.push(`stripe event ${id} mismatch: seenAt ${row.seen_at} !== ${src.seenAt}`);
    }
}

function _verify(db, source, expectedCounts) {
    const errors = [];
    const counts = {
        users: _rowCount(db, 'users'),
        tokens: _rowCount(db, 'tokens'),
        sites: _rowCount(db, 'sites'),
        versions: _rowCount(db, 'versions'),
        orders: _rowCount(db, 'orders'),
        stripeEvents: _rowCount(db, 'stripe_events'),
    };
    for (const key of Object.keys(expectedCounts)) {
        if (counts[key] !== expectedCounts[key]) {
            errors.push(`row count mismatch for ${key}: expected ${expectedCounts[key]}, got ${counts[key]}`);
        }
    }
    _verifyUsers(db, source.users || {}, errors);
    _verifySites(db, source.sites || {}, errors);
    _verifyOrders(db, source.orders || {}, errors);
    _verifyTokens(db, source.tokens || {}, errors);
    _verifyVersions(db, source.versions || {}, errors);
    _verifyStripeEvents(db, source.stripeEvents || {}, errors);
    return { ok: errors.length === 0, errors, counts };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {import('node:sqlite').DatabaseSync} db  an already schema-migrated handle
 * @param {{ dataDir?: string }} [opts]
 * @returns {{ migrated: boolean, reason?: string, verified?: boolean, counts?: object, at?: string }}
 */
function migrateFromJson(db, opts = {}) {
    const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname);

    if (_isAlreadyMigrated(db)) {
        return { migrated: false, reason: 'already-migrated' };
    }

    const source = _readJsonRegistry(dataDir);
    if (!source) {
        return { migrated: false, reason: 'no-source-file' };
    }

    const expectedCounts = {
        users: Object.keys(source.users || {}).length,
        tokens: Object.keys(source.tokens || {}).length,
        sites: Object.keys(source.sites || {}).length,
        versions: _countVersions(source.versions),
        orders: Object.keys(source.orders || {}).length,
        stripeEvents: Object.keys(source.stripeEvents || {}).length,
    };

    db.exec('BEGIN IMMEDIATE;');
    let rolledBack = false;
    try {
        _copyUsers(db, source.users);
        _copyTokens(db, source.tokens);
        _copySites(db, source.sites);
        _copyVersions(db, source.versions);
        _copyOrders(db, source.orders);
        _copyStripeEvents(db, source.stripeEvents);

        const verification = _verify(db, source, expectedCounts);
        if (!verification.ok) {
            db.exec('ROLLBACK;');
            rolledBack = true;
            const err = new Error(
                'registry-migrate: verification failed after copying .registry.json into SQLite — ' +
                'rolled back, NOT marking migration complete. ' +
                `Set REGISTRY_BACKEND=json to keep serving from the JSON file while this is investigated. ` +
                `Errors: ${JSON.stringify(verification.errors)}`
            );
            err.verification = verification;
            throw err;
        }

        const at = new Date().toISOString();
        db.prepare('INSERT OR REPLACE INTO registry_meta (key, value) VALUES (?, ?)').run(MIGRATION_MARKER_KEY, at);
        db.exec('COMMIT;');
        return { migrated: true, verified: true, counts: verification.counts, expectedCounts, at };
    } catch (e) {
        if (!rolledBack) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* nothing to roll back */ }
        }
        throw e;
    }
}

if (require.main === module) {
    const { openRegistryDb } = require('./registry-db');
    const dataDir = process.env.DATA_DIR || path.join(__dirname);
    const db = openRegistryDb({ dataDir });
    try {
        const result = migrateFromJson(db, { dataDir });
        console.log('registry-migrate:', JSON.stringify(result, null, 2));
        process.exitCode = 0;
    } catch (e) {
        console.error('registry-migrate: FAILED —', e.message);
        process.exitCode = 1;
    }
}

module.exports = {
    migrateFromJson,
    MIGRATION_MARKER_KEY,
};
