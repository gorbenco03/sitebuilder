'use strict';
/**
 * bot/registry.js — Central data registry for the web platform.
 *
 * Stocare JSON atomică pe DATA_DIR, fișier .registry.json.
 * Scriere atomică (tmp+rename) sincronă la fiecare mutație.
 *
 * Zero dependențe npm. Node 18+ CommonJS.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

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
        return { users: {}, tokens: {}, sites: {}, versions: {}, orders: {} };
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

/**
 * Get or create a user identified by email.
 * @param {string} email
 * @returns {{ id: string, email: string, createdAt: string }}
 */
function getOrCreateUserByEmail(email) {
    if (!email || typeof email !== 'string') throw new Error('email este obligatoriu');
    const db = _load();
    db.users = db.users || {};
    // Look for existing user with that email
    for (const u of Object.values(db.users)) {
        if (u.email === email) return { ...u };
    }
    const user = { id: crypto.randomUUID(), email, createdAt: new Date().toISOString() };
    db.users[user.id] = user;
    _save(db);
    return { ...user };
}

/**
 * Get or create a user identified by Telegram id.
 * @param {number|string} tgId
 * @param {{ username?: string, firstName?: string }} [meta]
 * @returns {{ id: string, tgId: string, username?: string, firstName?: string, createdAt: string }}
 */
function getOrCreateUserByTelegram(tgId, { username, firstName } = {}) {
    if (tgId == null) throw new Error('tgId este obligatoriu');
    const tgStr = String(tgId);
    const db = _load();
    db.users = db.users || {};
    // Look for existing user with that tgId
    for (const u of Object.values(db.users)) {
        if (u.tgId === tgStr) {
            // Update mutable fields if provided
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

/**
 * Get a user by internal id.
 * @param {string} userId
 * @returns {object|null}
 */
function getUser(userId) {
    const db = _load();
    const u = (db.users || {})[userId];
    return u ? { ...u } : null;
}

// ---------------------------------------------------------------------------
// Login tokens (magic links)
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Create a single-use login token.
 * Stored as sha256(token) with expiry and payload.
 *
 * @param {{ email?: string, userId?: string, purpose: string, siteId?: string }} payload
 * @returns {{ token: string }}
 */
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

/**
 * Consume a login token. Single-use, atomic.
 * Returns the payload or null if expired/used/unknown.
 *
 * @param {string} token
 * @returns {object|null}
 */
function consumeLoginToken(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const db   = _load();
    db.tokens  = db.tokens || {};
    const entry = db.tokens[hash];
    if (!entry)        return null;
    if (entry.used)    return null;
    if (Date.now() > entry.exp) return null;

    // Mark as used atomically
    entry.used = true;
    db.tokens[hash] = entry;
    _save(db);
    return { ...entry.payload };
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

/**
 * Build a URL-safe slug from a business name plus a short site-id suffix.
 * @param {string} name
 * @param {string} siteId
 * @returns {string}
 */
function _buildSlug(name, siteId) {
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
 * Create a new site record.
 *
 * @param {{ userId: string, templateId: string, templateVersion: number|null, slug?: string,
 *           platform?: string, trialEndsAt?: string }} opts
 * @returns {object} site
 */
function createSite({ userId, templateId, templateVersion, slug, platform, trialEndsAt }) {
    const db = _load();
    db.sites = db.sites || {};
    const id          = crypto.randomUUID();
    const projectName = slug || _buildSlug(templateId || 'site', id);
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
        trialEndsAt: trialEndsAt || null,
        reminded:    false,
        createdAt: new Date().toISOString(),
    };
    db.sites[id] = site;
    _save(db);
    return { ...site };
}

/**
 * List all sites across all users (for sweeper use).
 * @returns {object[]}
 */
function listAllSites() {
    const db = _load();
    return Object.values(db.sites || {}).map(s => ({ ...s }));
}

/**
 * @param {string} siteId
 * @returns {object|null}
 */
function getSite(siteId) {
    const db = _load();
    const s = (db.sites || {})[siteId];
    return s ? { ...s } : null;
}

/**
 * @param {string} userId
 * @returns {object[]}
 */
function listSites(userId) {
    const db = _load();
    return Object.values(db.sites || {})
        .filter(s => s.userId === userId)
        .map(s => ({ ...s }));
}

/**
 * @param {string} siteId
 * @param {object} patch
 * @returns {object} updated site
 */
function updateSite(siteId, patch) {
    const db = _load();
    db.sites = db.sites || {};
    const site = db.sites[siteId];
    if (!site) throw new Error(`Site negăsit: ${siteId}`);
    Object.assign(site, patch);
    db.sites[siteId] = site;
    _save(db);
    return { ...site };
}

// ---------------------------------------------------------------------------
// Site versions (max 10 kept)
// ---------------------------------------------------------------------------

const MAX_VERSIONS = 10;

/**
 * Save a new version of a site config.
 *
 * @param {string} siteId
 * @param {object} config
 * @returns {{ versionId: string, publishedAt: string }}
 */
function saveVersion(siteId, config) {
    const db = _load();
    db.versions = db.versions || {};
    db.versions[siteId] = db.versions[siteId] || [];

    const versionId   = crypto.randomUUID();
    const publishedAt = new Date().toISOString();
    db.versions[siteId].push({ versionId, publishedAt, config: JSON.parse(JSON.stringify(config)) });

    // Keep only the last MAX_VERSIONS
    if (db.versions[siteId].length > MAX_VERSIONS) {
        db.versions[siteId] = db.versions[siteId].slice(-MAX_VERSIONS);
    }

    _save(db);
    return { versionId, publishedAt };
}

/**
 * @param {string} siteId
 * @returns {{ versionId: string, publishedAt: string }[]}
 */
function listVersions(siteId) {
    const db = _load();
    return ((db.versions || {})[siteId] || [])
        .map(({ versionId, publishedAt }) => ({ versionId, publishedAt }));
}

/**
 * @param {string} siteId
 * @param {string} versionId
 * @returns {object|null}
 */
function getVersionConfig(siteId, versionId) {
    const db = _load();
    const list = ((db.versions || {})[siteId] || []);
    const entry = list.find(v => v.versionId === versionId);
    return entry ? JSON.parse(JSON.stringify(entry.config)) : null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * Create a new pending order.
 *
 * @param {{ siteId: string, userId: string, amountCents: number, currency: string, stripeSessionId: string }} opts
 * @returns {object} order
 */
function createOrder({ siteId, userId, amountCents, currency, stripeSessionId }) {
    const db = _load();
    db.orders = db.orders || {};
    const id = crypto.randomUUID();
    const order = {
        id,
        siteId,
        userId,
        amountCents,
        currency: currency || 'eur',
        stripeSessionId,
        status:    'pending',
        createdAt: new Date().toISOString(),
    };
    db.orders[id] = order;
    _save(db);
    return { ...order };
}

/**
 * Mark the order associated with a Stripe session as paid.
 * Idempotent — already-paid orders are returned as-is (no double-mark).
 *
 * @param {string} stripeSessionId
 * @returns {object|null} updated order or null if not found
 */
function markOrderPaid(stripeSessionId) {
    const db = _load();
    db.orders = db.orders || {};
    const order = Object.values(db.orders).find(o => o.stripeSessionId === stripeSessionId);
    if (!order) return null;
    if (order.status === 'paid') return { ...order }; // already paid — idempotent
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    db.orders[order.id] = order;
    _save(db);
    return { ...order };
}

/**
 * @param {string} stripeSessionId
 * @returns {object|null}
 */
function getOrderBySession(stripeSessionId) {
    const db = _load();
    const order = Object.values(db.orders || {}).find(o => o.stripeSessionId === stripeSessionId);
    return order ? { ...order } : null;
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
    markOrderPaid,
    getOrderBySession,
};
