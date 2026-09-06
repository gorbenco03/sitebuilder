'use strict';
/**
 * bot/registry-sqlite.js — Central data registry, SQLite backend.
 *
 * Implements the same 21 functions as bot/registry-json.js, signature for
 * signature, return-shape for return-shape, against separate indexed SQLite
 * tables instead of one dict-of-dicts JSON file. Every mutation now costs
 * roughly the size of the row it touches, not the size of the whole
 * database — and saveVersion() no longer rewrites every user/site/order on
 * every publish.
 *
 * On first open (see openRegistryDb in bot/registry-db.js), an idempotent,
 * non-destructive migration is run against any existing .registry.json — see
 * bot/registry-migrate.js. The JSON file is never modified or deleted by
 * this module.
 */

const crypto = require('crypto');
const { openRegistryDb, isUniqueViolation } = require('./registry-db');
const { migrateFromJson } = require('./registry-migrate');
const {
    buildSlug,
    addMonthsIso,
    assertValidStripeEventId,
    SITE_EXTRA_FIELDS,
    slugTakenError,
} = require('./registry-shared');

const db = openRegistryDb();

// One-time, idempotent, non-destructive migration of any existing
// .registry.json into this database. See bot/registry-migrate.js for the
// verify-before-commit contract: if verification fails, nothing is written
// and this throws, loudly, at startup — set REGISTRY_BACKEND=json to keep
// running on the JSON backend while that is investigated.
migrateFromJson(db);

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

function userRowToObj(row) {
    const u = { id: row.id, createdAt: row.created_at };
    if (row.email != null)      u.email     = row.email;
    if (row.tg_id != null)      u.tgId      = row.tg_id;
    if (row.username != null)   u.username  = row.username;
    if (row.first_name != null) u.firstName = row.first_name;
    return u;
}

function getOrCreateUserByEmail(email) {
    if (!email || typeof email !== 'string') throw new Error('email is required');
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existing) return userRowToObj(existing);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, createdAt);
    return { id, email, createdAt };
}

function getOrCreateUserByTelegram(tgId, { username, firstName } = {}) {
    if (tgId == null) throw new Error('tgId is required');
    const tgStr = String(tgId);
    const existing = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgStr);
    if (existing) {
        const sets = [];
        const params = [];
        if (username != null && existing.username !== username) { sets.push('username = ?'); params.push(username); }
        if (firstName != null && existing.first_name !== firstName) { sets.push('first_name = ?'); params.push(firstName); }
        if (sets.length) {
            params.push(existing.id);
            db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
            return userRowToObj(db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id));
        }
        return userRowToObj(existing);
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO users (id, tg_id, username, first_name, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, tgStr, username != null ? username : null, firstName != null ? firstName : null, createdAt);
    return userRowToObj(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function getUser(userId) {
    if (userId == null) return null; // node:sqlite cannot bind undefined
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return row ? userRowToObj(row) : null;
}

// ---------------------------------------------------------------------------
// Login tokens (magic links)
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function createLoginToken(payload) {
    const tokenRaw = crypto.randomBytes(32).toString('hex');
    const hash     = crypto.createHash('sha256').update(tokenRaw).digest('hex');
    const exp      = Date.now() + TOKEN_TTL_MS;
    db.prepare('INSERT INTO tokens (hash, payload, exp, used) VALUES (?, ?, ?, 0)')
        .run(hash, JSON.stringify(payload || {}), exp);
    return { token: tokenRaw };
}

function consumeLoginToken(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const entry = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(hash);
    if (!entry)       return null;
    if (entry.used)   return null;
    if (Date.now() > entry.exp) return null;
    db.prepare('UPDATE tokens SET used = 1 WHERE hash = ?').run(hash);
    return JSON.parse(entry.payload);
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

const CORE_COLUMN_BY_FIELD = {
    userId:          'user_id',
    templateId:      'template_id',
    templateVersion: 'template_version',
    slug:            'slug',
    projectName:     'project_name',
    platform:        'platform',
    status:          'status',
    paid:            'paid',
    url:             'url',
    createdAt:       'created_at',
};
const EXTRA_FIELD_SET = new Set(SITE_EXTRA_FIELDS);

function siteRowToObj(row) {
    const extra = row.extra ? JSON.parse(row.extra) : {};
    return {
        id: row.id,
        userId: row.user_id,
        templateId: row.template_id,
        templateVersion: row.template_version,
        slug: row.slug,
        projectName: row.project_name,
        platform: row.platform,
        status: row.status,
        paid: !!row.paid,
        url: row.url,
        createdAt: row.created_at,
        ...extra,
    };
}

/**
 * DELIBERATE FIX (1 of 4): sites.slug carries a real UNIQUE constraint now.
 * An explicit slug that collides throws a clear error instead of silently
 * producing two sites at the same public address. Real callers
 * (bot/server.js's /api/slug-check + isSlugAvailable) already check
 * availability before calling createSite, so their happy path never hits
 * this — it only guards the case nothing upstream caught.
 */
function createSite({ userId, templateId, templateVersion, slug, platform }) {
    const id = crypto.randomUUID();
    const projectName = slug || buildSlug(templateId || 'site', id);
    const createdAt = new Date().toISOString();
    try {
        db.prepare(`
            INSERT INTO sites (id, user_id, template_id, template_version, slug, project_name, platform, status, paid, url, created_at, extra)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, NULL, ?, '{}')
        `).run(
            id, userId,
            templateId || null,
            templateVersion != null ? templateVersion : null,
            projectName, projectName,
            platform || 'web',
            createdAt
        );
    } catch (e) {
        if (isUniqueViolation(e)) throw slugTakenError(projectName);
        throw e;
    }
    return getSite(id);
}

function listAllSites() {
    return db.prepare('SELECT * FROM sites').all().map(siteRowToObj);
}

function getSite(siteId) {
    if (siteId == null) return null; // node:sqlite cannot bind undefined
    const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    return row ? siteRowToObj(row) : null;
}

function listSites(userId) {
    return db.prepare('SELECT * FROM sites WHERE user_id = ?').all(userId).map(siteRowToObj);
}

/**
 * DELIBERATE FIX (4 of 4): patch keys are filtered to the known site schema
 * (bot/registry-shared.js#KNOWN_SITE_FIELDS) instead of a raw Object.assign
 * that persisted any foreign key handed to it. Known "core" fields (set at
 * createSite time) map to real columns; known "extra" fields (only ever
 * appear after a patch) live in the `extra` JSON column so that patching one
 * to `null` still leaves it a PRESENT key on the returned record, exactly
 * like the original Object.assign did.
 */
function updateSite(siteId, patch) {
    const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!row) throw new Error(`Site not found: ${siteId}`);

    const sets = [];
    const params = [];
    let extra = null;
    let extraChanged = false;

    for (const [key, value] of Object.entries(patch || {})) {
        if (Object.prototype.hasOwnProperty.call(CORE_COLUMN_BY_FIELD, key)) {
            const v = key === 'paid' ? (value ? 1 : 0) : value;
            sets.push(`${CORE_COLUMN_BY_FIELD[key]} = ?`);
            params.push(v);
        } else if (EXTRA_FIELD_SET.has(key)) {
            if (extra === null) extra = row.extra ? JSON.parse(row.extra) : {};
            extra[key] = value;
            extraChanged = true;
        }
        // else: unrecognized key — dropped, not persisted (deliberate fix).
    }

    if (extraChanged) {
        sets.push('extra = ?');
        params.push(JSON.stringify(extra));
    }

    if (sets.length) {
        params.push(siteId);
        try {
            db.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        } catch (e) {
            if (isUniqueViolation(e)) throw slugTakenError(patch.slug);
            throw e;
        }
    }
    return getSite(siteId);
}

// ---------------------------------------------------------------------------
// Site versions (max 10 kept)
// ---------------------------------------------------------------------------

const MAX_VERSIONS = 10;

function saveVersion(siteId, config) {
    const versionId   = crypto.randomUUID();
    const publishedAt = new Date().toISOString();
    db.prepare('INSERT INTO versions (version_id, site_id, published_at, config) VALUES (?, ?, ?, ?)')
        .run(versionId, siteId, publishedAt, JSON.stringify(config));

    // Keep only the MAX_VERSIONS most recently inserted rows for this site.
    db.prepare(`
        DELETE FROM versions
        WHERE site_id = ?
          AND seq NOT IN (SELECT seq FROM versions WHERE site_id = ? ORDER BY seq DESC LIMIT ?)
    `).run(siteId, siteId, MAX_VERSIONS);

    return { versionId, publishedAt };
}

function listVersions(siteId) {
    return db.prepare('SELECT version_id, published_at FROM versions WHERE site_id = ? ORDER BY seq ASC')
        .all(siteId)
        .map((r) => ({ versionId: r.version_id, publishedAt: r.published_at }));
}

function getVersionConfig(siteId, versionId) {
    if (siteId == null || versionId == null) return null; // node:sqlite cannot bind undefined
    const row = db.prepare('SELECT config FROM versions WHERE site_id = ? AND version_id = ?').get(siteId, versionId);
    return row ? JSON.parse(row.config) : null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function orderRowToObj(row) {
    const o = {
        id: row.id,
        siteId: row.site_id,
        userId: row.user_id,
        amountCents: row.amount_cents,
        currency: row.currency,
        stripeSessionId: row.stripe_session_id,
        kind: row.kind,
        status: row.status,
        createdAt: row.created_at,
    };
    if (row.paid_at != null) o.paidAt = row.paid_at;
    return o;
}

function createOrder({ siteId, userId, amountCents, currency, stripeSessionId, kind }) {
    const id = crypto.randomUUID();
    const orderKind = kind === 'renewal' ? 'renewal' : 'publish';
    const createdAt = new Date().toISOString();
    db.prepare(`
        INSERT INTO orders (id, site_id, user_id, amount_cents, currency, stripe_session_id, kind, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, siteId, userId, amountCents, currency || 'eur', stripeSessionId, orderKind, createdAt);
    return getOrder(id);
}

function findPendingOrder(siteId, kind) {
    if (!siteId) return null;
    const want = kind === 'renewal' ? 'renewal' : 'publish';
    // ORDER BY created_at DESC, seq ASC LIMIT 1 reproduces the JSON backend's
    // stable-sort-descending-by-createdAt tie-break: on equal createdAt, the
    // earlier-inserted row wins (see bot/registry-shared.js discussion).
    const row = db.prepare(`
        SELECT * FROM orders WHERE site_id = ? AND kind = ? AND status = 'pending'
        ORDER BY created_at DESC, seq ASC LIMIT 1
    `).get(siteId, want);
    return row ? orderRowToObj(row) : null;
}

function attachStripeSession(orderId, stripeSessionId) {
    if (!orderId || !stripeSessionId) return null;
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!row) return null;
    db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(stripeSessionId, orderId);
    return getOrder(orderId);
}

function markOrderPaid(stripeSessionId) {
    if (stripeSessionId == null) return null; // node:sqlite cannot bind undefined
    // ORDER BY seq ASC LIMIT 1 reproduces Array.prototype.find's
    // first-match-in-insertion-order semantics.
    const row = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ? ORDER BY seq ASC LIMIT 1').get(stripeSessionId);
    if (!row) return null;
    if (row.status === 'paid') return null;
    const paidAt = new Date().toISOString();
    db.prepare('UPDATE orders SET status = ?, paid_at = ? WHERE id = ?').run('paid', paidAt, row.id);
    return getOrder(row.id);
}

function getOrderBySession(stripeSessionId) {
    if (stripeSessionId == null) return null; // node:sqlite cannot bind undefined
    const row = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ? ORDER BY seq ASC LIMIT 1').get(stripeSessionId);
    return row ? orderRowToObj(row) : null;
}

function getOrder(orderId) {
    if (orderId == null) return null; // node:sqlite cannot bind undefined
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return row ? orderRowToObj(row) : null;
}

// ---------------------------------------------------------------------------
// Stripe event idempotency
// ---------------------------------------------------------------------------

const STRIPE_EVENT_CAP = 500;

/**
 * DELIBERATE FIX (3 of 4): see bot/registry-shared.js#assertValidStripeEventId.
 */
function claimStripeEvent(eventId) {
    assertValidStripeEventId(eventId);
    const seenAt = new Date().toISOString();
    try {
        db.prepare('INSERT INTO stripe_events (event_id, seen_at) VALUES (?, ?)').run(eventId, seenAt);
    } catch (e) {
        if (isUniqueViolation(e)) return false;
        throw e;
    }
    // Bound growth: keep only the STRIPE_EVENT_CAP most recently seen ids.
    // ORDER BY seen_at DESC, seq DESC mirrors the JSON backend's stable sort
    // of Object.keys() ascending-by-seenAt then dropping the front.
    db.prepare(`
        DELETE FROM stripe_events
        WHERE seq NOT IN (SELECT seq FROM stripe_events ORDER BY seen_at DESC, seq DESC LIMIT ?)
    `).run(STRIPE_EVENT_CAP);
    return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    getOrCreateUserByEmail,
    getOrCreateUserByTelegram,
    getUser,
    createLoginToken,
    consumeLoginToken,
    createSite,
    getSite,
    listSites,
    listAllSites,
    updateSite,
    saveVersion,
    listVersions,
    getVersionConfig,
    createOrder,
    findPendingOrder,
    attachStripeSession,
    markOrderPaid,
    getOrderBySession,
    getOrder,
    claimStripeEvent,
    addMonthsIso,
};
