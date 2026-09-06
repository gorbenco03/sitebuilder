'use strict';
/**
 * bot/registry-json.js — Central data registry, JSON-file backend.
 *
 * This is bot/registry.js's original implementation, moved here verbatim
 * (storage-wise) so it can keep serving as the emergency-exit backend behind
 * REGISTRY_BACKEND=json. Atomic JSON storage under DATA_DIR, in
 * .registry.json. Every mutation writes synchronously and atomically
 * (tmp + rename). Cost of every mutation is linear in the size of the WHOLE
 * file — that is exactly the problem the SQLite backend (registry-sqlite.js)
 * exists to fix. This file is kept only as a safety net.
 *
 * Carries the same four deliberate behavior fixes as the SQLite backend (see
 * bot/registry-shared.js) so REGISTRY_BACKEND=json is a real fallback, not a
 * regression to the old latent bugs.
 *
 * Zero npm dependencies. Node 18+ CommonJS.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const {
    buildSlug,
    addMonthsIso,
    assertValidStripeEventId,
    isKnownSiteField,
    slugTakenError,
} = require('./registry-shared');

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname);
const REGISTRY_FILE = path.join(DATA_DIR, '.registry.json');

/** Read the full registry object from disk, or return a blank one. */
function _load() {
    try {
        return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    } catch {
        return { users: {}, tokens: {}, sites: {}, versions: {}, orders: {}, sessions: {} };
    }
}

/** Atomically persist the full registry. */
function _save(db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = REGISTRY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
    fs.renameSync(tmp, REGISTRY_FILE);
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

function getOrCreateUserByEmail(email) {
    if (!email || typeof email !== 'string') throw new Error('email is required');
    const db = _load();
    db.users = db.users || {};
    for (const u of Object.values(db.users)) {
        if (u.email === email) return { ...u };
    }
    const user = { id: crypto.randomUUID(), email, createdAt: new Date().toISOString() };
    db.users[user.id] = user;
    _save(db);
    return { ...user };
}

function getOrCreateUserByTelegram(tgId, { username, firstName } = {}) {
    if (tgId == null) throw new Error('tgId is required');
    const tgStr = String(tgId);
    const db = _load();
    db.users = db.users || {};
    for (const u of Object.values(db.users)) {
        if (u.tgId === tgStr) {
            let changed = false;
            if (username   != null && u.username   !== username)   { u.username   = username;   changed = true; }
            if (firstName  != null && u.firstName  !== firstName)  { u.firstName  = firstName;  changed = true; }
            if (changed) { db.users[u.id] = u; _save(db); }
            return { ...u };
        }
    }
    const user = {
        id: crypto.randomUUID(),
        tgId: tgStr,
        ...(username  != null ? { username }  : {}),
        ...(firstName != null ? { firstName } : {}),
        createdAt: new Date().toISOString(),
    };
    db.users[user.id] = user;
    _save(db);
    return { ...user };
}

function getUser(userId) {
    const db = _load();
    const u = (db.users || {})[userId];
    return u ? { ...u } : null;
}

// ---------------------------------------------------------------------------
// Login tokens (magic links)
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function createLoginToken(payload) {
    const db = _load();
    db.tokens = db.tokens || {};

    const tokenRaw = crypto.randomBytes(32).toString('hex');
    const hash     = crypto.createHash('sha256').update(tokenRaw).digest('hex');
    const exp      = Date.now() + TOKEN_TTL_MS;

    db.tokens[hash] = { payload: { ...payload }, exp, used: false };
    _save(db);
    return { token: tokenRaw };
}

function consumeLoginToken(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const db   = _load();
    db.tokens  = db.tokens || {};
    const entry = db.tokens[hash];
    if (!entry)        return null;
    if (entry.used)    return null;
    if (Date.now() > entry.exp) return null;

    entry.used = true;
    db.tokens[hash] = entry;
    _save(db);
    return { ...entry.payload };
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

/**
 * Create a new site record (unpaid draft; pay before first public publish).
 *
 * DELIBERATE FIX (1 of 4): an explicit slug that collides with an existing
 * site is now rejected with a clear error instead of silently allowed (two
 * sites could previously take the same public address). Real callers
 * (bot/server.js) already check availability before calling this, so their
 * happy path is unaffected.
 */
function createSite({ userId, templateId, templateVersion, slug, platform }) {
    const db = _load();
    db.sites = db.sites || {};
    const id          = crypto.randomUUID();
    const projectName = slug || buildSlug(templateId || 'site', id);

    if (Object.values(db.sites).some((s) => s.slug === projectName)) {
        throw slugTakenError(projectName);
    }

    const site = {
        id,
        userId,
        templateId:      templateId      || null,
        templateVersion: templateVersion != null ? templateVersion : null,
        slug:            projectName,
        projectName,
        platform:        platform || 'web',
        status:    'draft',
        paid:      false,
        url:       null,
        createdAt: new Date().toISOString(),
    };
    db.sites[id] = site;
    _save(db);
    return { ...site };
}

function listAllSites() {
    const db = _load();
    return Object.values(db.sites || {}).map(s => ({ ...s }));
}

function getSite(siteId) {
    const db = _load();
    const s = (db.sites || {})[siteId];
    return s ? { ...s } : null;
}

function listSites(userId) {
    const db = _load();
    return Object.values(db.sites || {})
        .filter(s => s.userId === userId)
        .map(s => ({ ...s }));
}

/**
 * DELIBERATE FIX (4 of 4): patch keys are now filtered to the known site
 * schema (bot/registry-shared.js#KNOWN_SITE_FIELDS) instead of a raw
 * Object.assign that persisted any foreign key handed to it.
 */
function updateSite(siteId, patch) {
    const db = _load();
    db.sites = db.sites || {};
    const site = db.sites[siteId];
    if (!site) throw new Error(`Site not found: ${siteId}`);

    for (const [key, value] of Object.entries(patch || {})) {
        if (!isKnownSiteField(key)) continue;
        if (key === 'slug' && value !== site.slug) {
            const collision = Object.values(db.sites).some((s) => s.id !== siteId && s.slug === value);
            if (collision) throw slugTakenError(value);
        }
        site[key] = value;
    }
    db.sites[siteId] = site;
    _save(db);
    return { ...site };
}

// ---------------------------------------------------------------------------
// Site versions (max 10 kept)
// ---------------------------------------------------------------------------

const MAX_VERSIONS = 10;

function saveVersion(siteId, config) {
    const db = _load();
    db.versions = db.versions || {};
    db.versions[siteId] = db.versions[siteId] || [];

    const versionId   = crypto.randomUUID();
    const publishedAt = new Date().toISOString();
    db.versions[siteId].push({ versionId, publishedAt, config: JSON.parse(JSON.stringify(config)) });

    if (db.versions[siteId].length > MAX_VERSIONS) {
        db.versions[siteId] = db.versions[siteId].slice(-MAX_VERSIONS);
    }

    _save(db);
    return { versionId, publishedAt };
}

function listVersions(siteId) {
    const db = _load();
    return ((db.versions || {})[siteId] || [])
        .map(({ versionId, publishedAt }) => ({ versionId, publishedAt }));
}

function getVersionConfig(siteId, versionId) {
    const db = _load();
    const list = ((db.versions || {})[siteId] || []);
    const entry = list.find(v => v.versionId === versionId);
    return entry ? JSON.parse(JSON.stringify(entry.config)) : null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function createOrder({ siteId, userId, amountCents, currency, stripeSessionId, kind }) {
    const db = _load();
    db.orders = db.orders || {};
    const id = crypto.randomUUID();
    const orderKind = kind === 'renewal' ? 'renewal' : 'publish';
    const order = {
        id,
        siteId,
        userId,
        amountCents,
        currency: currency || 'eur',
        stripeSessionId,
        kind:      orderKind,
        status:    'pending',
        createdAt: new Date().toISOString(),
    };
    db.orders[id] = order;
    _save(db);
    return { ...order };
}

function findPendingOrder(siteId, kind) {
    if (!siteId) return null;
    const db = _load();
    const want = kind === 'renewal' ? 'renewal' : 'publish';
    const rows = Object.values(db.orders || {}).filter((o) => {
        if (!o || o.siteId !== siteId || o.status !== 'pending') return false;
        const k = o.kind === 'renewal' ? 'renewal' : 'publish';
        return k === want;
    });
    if (!rows.length) return null;
    rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { ...rows[0] };
}

function attachStripeSession(orderId, stripeSessionId) {
    if (!orderId || !stripeSessionId) return null;
    const db = _load();
    db.orders = db.orders || {};
    const order = db.orders[orderId];
    if (!order) return null;
    order.stripeSessionId = stripeSessionId;
    db.orders[orderId] = order;
    _save(db);
    return { ...order };
}

function markOrderPaid(stripeSessionId) {
    const db = _load();
    db.orders = db.orders || {};
    const order = Object.values(db.orders).find(o => o.stripeSessionId === stripeSessionId);
    if (!order) return null;
    if (order.status === 'paid') return null;
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    db.orders[order.id] = order;
    _save(db);
    return { ...order };
}

function getOrderBySession(stripeSessionId) {
    const db = _load();
    const order = Object.values(db.orders || {}).find(o => o.stripeSessionId === stripeSessionId);
    return order ? { ...order } : null;
}

function getOrder(orderId) {
    const db = _load();
    const order = (db.orders || {})[orderId];
    return order ? { ...order } : null;
}

/**
 * All orders for a site, oldest-created first. Introspection helper used by
 * tests that used to read .registry.json directly to check for orphan rows
 * or find the pending/paid order for a site; the registry API had no such
 * listing before, so this closes that gap for both backends.
 */
function listOrdersBySite(siteId) {
    if (!siteId) return [];
    const db = _load();
    return Object.values(db.orders || {})
        .filter((o) => o && o.siteId === siteId)
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
        .map((o) => ({ ...o }));
}

/** Every order across every site — mirrors listAllSites(). Introspection
 *  helper for tests that need a global "no orders were created" count. */
function listAllOrders() {
    const db = _load();
    return Object.values(db.orders || {}).map((o) => ({ ...o }));
}

// ---------------------------------------------------------------------------
// Sessions (Wave 8 / AUDIT-07 re-audit: server-side logout revocation)
//
// Mirrors registry-sqlite.js's sessions table/functions exactly (same
// contract on both backends — see bot/registry-schema.js#SCHEMA_SQL_V2 for
// the design rationale) so REGISTRY_BACKEND=json stays a real fallback.
// ---------------------------------------------------------------------------

function createSession(sid, userId, exp) {
    if (!sid || typeof sid !== 'string') throw new Error('sid is required');
    if (userId == null) throw new Error('userId is required');
    const db = _load();
    db.sessions = db.sessions || {};
    db.sessions[sid] = { userId, createdAt: new Date().toISOString(), exp, revokedAt: null };
    // Bound growth: sweep rows past their own natural expiry on every sign-in.
    const now = Math.floor(Date.now() / 1000);
    for (const [k, s] of Object.entries(db.sessions)) {
        if (s.exp < now) delete db.sessions[k];
    }
    _save(db);
}

function isSessionValid(sid) {
    if (!sid || typeof sid !== 'string') return false;
    const db = _load();
    const s = (db.sessions || {})[sid];
    if (!s) return false;
    if (s.revokedAt) return false;
    if (Number(s.exp) < Math.floor(Date.now() / 1000)) return false;
    return true;
}

function revokeSession(sid) {
    if (!sid || typeof sid !== 'string') return false;
    const db = _load();
    db.sessions = db.sessions || {};
    const s = db.sessions[sid];
    if (!s || s.revokedAt) return false;
    s.revokedAt = new Date().toISOString();
    _save(db);
    return true;
}

function revokeAllSessionsForUser(userId) {
    if (userId == null) return 0;
    const db = _load();
    db.sessions = db.sessions || {};
    const revokedAt = new Date().toISOString();
    let count = 0;
    for (const s of Object.values(db.sessions)) {
        if (s.userId === userId && !s.revokedAt) {
            s.revokedAt = revokedAt;
            count++;
        }
    }
    if (count) _save(db);
    return count;
}

/**
 * DELIBERATE FIX (3 of 4): see bot/registry-shared.js#assertValidStripeEventId.
 */
function claimStripeEvent(eventId) {
    assertValidStripeEventId(eventId);
    const db = _load();
    db.stripeEvents = db.stripeEvents || {};
    if (db.stripeEvents[eventId]) return false;
    db.stripeEvents[eventId] = { seenAt: new Date().toISOString() };
    const keys = Object.keys(db.stripeEvents);
    if (keys.length > 500) {
        keys.sort((a, b) => String(db.stripeEvents[a].seenAt).localeCompare(String(db.stripeEvents[b].seenAt)));
        for (const k of keys.slice(0, keys.length - 500)) delete db.stripeEvents[k];
    }
    _save(db);
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
    listOrdersBySite,
    listAllOrders,
    claimStripeEvent,
    addMonthsIso,
    createSession,
    isSessionValid,
    revokeSession,
    revokeAllSessionsForUser,
};
