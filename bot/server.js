'use strict';
/**
 * bot/server.js — zero-dependency HTTP server (pay-before-publish).
 *
 * Routes:
 *   GET  /                   → 302 /app/
 *   GET  /health             → { ok, service, uptimeSec }
 *   POST /webhooks/stripe    → Stripe webhook (ACK then process async)
 *
 *   GET  /app/*              → static files from <repo>/builder/
 *   GET  /live/<slug>/*      → isolated local publish ($DATA_DIR/published/<slug>/)
 *
 *   GET  /api/config         → {amount, amountCents, currency, renewal, renewalCents, brandDomain|null, contactUrl|null} (public)
 *   GET  /api/slug-check?slug= → {available:bool, slug} (public)
 *   GET  /api/templates      → list templates with schema + presets
 *   POST /api/auth/email     → send magic link
 *   GET  /auth/verify        → consume login token, set session cookie
 *   POST /api/auth/telegram  → verify Telegram initData, set session cookie
 *   GET  /api/me             → current user or 401
 *   GET  /api/sites          → user's sites (includes status/paid)
 *   GET  /api/sites/:id      → single site + latest config
 *   GET  /api/sites/:id/versions    → version list
 *   POST /api/sites/:id/rollback    → republish a past version (paid only)
 *   POST /api/sites/:id/checkout    → {paymentUrl} for dashboard / reactivation
 *   POST /api/sites/:id/social-feed/grant          → Instafidget Year-1 grant; stores instagram.embedUrl
 *   POST /api/sites/:id/social-feed/editor-session → Instafidget editor SSO URL
 *   POST /api/publish        → pay-before-publish: unpaid saves draft (+ checkout URL); paid deploys
 *
 * Zero dependencies (Node 18+ built-ins only). CommonJS.
 * Pricing amounts come only from ./pricing.js.
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const payments = require('./payments.js');
const pricing  = require('./pricing.js');
const { log }  = require('./logger.js');

// These are loaded lazily so we never crash at require-time in tests without stubs.
function getRegistry() { return require('./registry.js'); }
function getAuth()     { return require('./auth.js'); }
function getEmail()    { return require('./email.js'); }
function getPartner()  { return require('./instafidget-partner.js'); }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES   = 1024 * 1024;         // 1 MB default
const PUBLISH_BODY_MAX = 16 * 1024 * 1024;    // 16 MB for /api/publish
const BUILDER_DIR      = path.join(__dirname, '..', 'builder');
const TEMPLATES_DIR    = path.join(__dirname, '..', 'templates');

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.txt':  'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

function readRawBody(req, limit = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        req.on('data', (c) => {
            if (tooLarge) return;
            size += c.length;
            if (size > limit) {
                tooLarge = true;
                reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 'BODY_TOO_LARGE' }));
                req.resume();
                return;
            }
            chunks.push(c);
        });
        req.on('end',   () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
        req.on('error', (e) => { if (!tooLarge) reject(e); });
    });
}

async function parseJson(req, limit = MAX_BODY_BYTES) {
    let raw;
    try {
        raw = await readRawBody(req, limit);
    } catch (e) {
        if (e.code === 'BODY_TOO_LARGE') throw Object.assign(new Error('Corpul cererii este prea mare.'), { status: 413 });
        throw e;
    }
    try {
        return JSON.parse(raw.toString('utf8'));
    } catch {
        throw Object.assign(new Error('JSON invalid.'), { status: 400 });
    }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function sendRedirect(res, location, status = 302) {
    res.writeHead(status, { Location: location });
    res.end();
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function requireAuth(req, res) {
    let userId;
    try {
        userId = getAuth().getSessionUserId(req);
    } catch (_) {
        userId = null;
    }
    if (!userId) {
        sendJson(res, 401, { error: 'Autentificare necesară.' });
        return null;
    }
    return userId;
}

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

function slugify(s) {
    return (s || 'site')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'site';
}

function normalizeSlug(raw) {
    return slugify(raw || '');
}

function isSlugAvailable(slug) {
    const reg = getRegistry();
    const all = reg.listAllSites ? reg.listAllSites() : [];
    return !all.some(s => s.slug === slug || s.projectName === slug);
}

// ---------------------------------------------------------------------------
// Template cache
// ---------------------------------------------------------------------------

let _templateCache = null;

function loadTemplates() {
    if (_templateCache) return _templateCache;
    try {
        const regPath = path.join(TEMPLATES_DIR, 'registry.json');
        const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
        const entries = Array.isArray(reg && reg.templates) ? reg.templates : [];
        _templateCache = entries.map((t) => {
            let schema = null;
            let presets = [];
            try { schema  = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, t.id, 'schema.json'), 'utf8')); } catch (_) {}
            try { presets = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, t.id, 'presets.json'), 'utf8')).presets || []; } catch (_) {}
            return { id: t.id, name: t.name, vertical: t.vertical, description: t.description, version: t.version, schema, presets };
        });
        return _templateCache;
    } catch (e) {
        log('server.templates.load_error', { err: e.message }, 'error');
        return [];
    }
}

// ---------------------------------------------------------------------------
// Static file serving — /app/*
// ---------------------------------------------------------------------------

function serveStatic(req, res, urlPath) {
    let relative = urlPath.replace(/^\/app\/?/, '') || 'index.html';
    const normalised = path.normalize(relative);
    if (normalised.startsWith('..') || path.isAbsolute(normalised)) {
        sendJson(res, 403, { error: 'Acces interzis.' });
        return;
    }

    const filePath = path.join(BUILDER_DIR, normalised);
    const realBuilder = path.resolve(BUILDER_DIR);
    const realFile    = path.resolve(filePath);
    if (!realFile.startsWith(realBuilder + path.sep) && realFile !== realBuilder) {
        sendJson(res, 403, { error: 'Acces interzis.' });
        return;
    }

    let stat;
    try { stat = fs.statSync(filePath); } catch { /* not found below */ }

    let targetPath = filePath;
    if (stat && stat.isDirectory()) {
        targetPath = path.join(filePath, 'index.html');
        try { stat = fs.statSync(targetPath); } catch { stat = null; }
    }

    if (!stat || !stat.isFile()) {
        const indexPath = path.join(BUILDER_DIR, 'index.html');
        try {
            const content = fs.readFileSync(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': content.length });
            res.end(content);
        } catch {
            sendJson(res, 404, { error: 'Fișier negăsit.' });
        }
        return;
    }

    const ext  = path.extname(targetPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(targetPath);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
    res.end(content);
}

// ---------------------------------------------------------------------------
// Isolated live sites — GET /live/<slug>/* from $DATA_DIR/published/<slug>/
// Only written by HIDOOK_ISOLATED_DEPLOY after paid publish (unpaid → 404).
// ---------------------------------------------------------------------------

function serveLive(req, res, urlPath) {
    // urlPath like /live/<slug> or /live/<slug>/ or /live/<slug>/foo.css
    const raw = urlPath.replace(/^\/live\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    if (parts.length === 0) {
        return sendJson(res, 404, { error: 'not found' });
    }

    const slug = parts[0];
    // Slug must be a single safe path segment (no traversal)
    if (!/^[a-z0-9-]{3,40}$/i.test(slug) || slug.includes('..')) {
        return sendJson(res, 403, { error: 'Acces interzis.' });
    }

    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
    const publishedRoot = path.resolve(path.join(dataDir, 'published'));
    const siteRoot = path.resolve(path.join(publishedRoot, slug.toLowerCase()));

    if (!siteRoot.startsWith(publishedRoot + path.sep) && siteRoot !== publishedRoot) {
        return sendJson(res, 403, { error: 'Acces interzis.' });
    }

    let rel = parts.slice(1).join('/') || 'index.html';
    // Decode once; reject encoded traversal
    try {
        rel = decodeURIComponent(rel);
    } catch {
        return sendJson(res, 400, { error: 'bad path' });
    }
    const normalised = path.normalize(rel);
    if (normalised.startsWith('..') || path.isAbsolute(normalised) || normalised.includes('..' + path.sep)) {
        return sendJson(res, 403, { error: 'Acces interzis.' });
    }

    let filePath = path.join(siteRoot, normalised);
    let realFile;
    try {
        realFile = path.resolve(filePath);
    } catch {
        return sendJson(res, 403, { error: 'Acces interzis.' });
    }
    if (!realFile.startsWith(siteRoot + path.sep) && realFile !== siteRoot) {
        return sendJson(res, 403, { error: 'Acces interzis.' });
    }

    let stat;
    try { stat = fs.statSync(realFile); } catch {
        return sendJson(res, 404, { error: 'not found' });
    }

    if (stat.isDirectory()) {
        realFile = path.join(realFile, 'index.html');
        try { stat = fs.statSync(realFile); } catch {
            return sendJson(res, 404, { error: 'not found' });
        }
    }

    if (!stat.isFile()) {
        return sendJson(res, 404, { error: 'not found' });
    }

    const ext  = path.extname(realFile).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(realFile);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
    res.end(content);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleGetConfig(req, res, query) {
    const p = pricing.getPricingFromRequest(req, { query });
    sendJson(res, 200, {
        amount:       p.amount,
        amountCents:  p.amountCents,
        currency:     p.currency,
        renewal:      p.renewal,
        renewalCents: p.renewalCents,
        // Compat alias for older UI that read priceEur as the displayed major units.
        priceEur:     p.amount,
        brandDomain:  process.env.BRAND_DOMAIN || null,
        contactUrl:   process.env.CONTACT_URL  || null,
    });
}

async function handleSlugCheck(req, res, query) {
    const raw  = (query.get('slug') || '').trim();
    const slug = normalizeSlug(raw);
    if (!SLUG_RE.test(slug)) {
        return sendJson(res, 200, { available: false, slug, error: 'Slug invalid (3-40 caractere, a-z 0-9 -).' });
    }
    const available = isSlugAvailable(slug);
    sendJson(res, 200, { available, slug });
}

async function handleGetTemplates(req, res) {
    const templates = loadTemplates();
    sendJson(res, 200, { templates });
}

async function handleAuthEmail(req, res) {
    const body = await parseJson(req);
    const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJson(res, 400, { error: 'Adresa de email nu este validă.' });
    }

    const reg = getRegistry();
    let token;
    try {
        ({ token } = await reg.createLoginToken({ email, purpose: 'login' }));
    } catch (e) {
        log('server.auth.email.token_error', { err: e.message }, 'error');
        return sendJson(res, 503, { error: 'Serviciu temporar indisponibil.' });
    }

    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    const verifyUrl = `${publicUrl}/auth/verify?token=${token}`;

    let sent = false;
    let devLink;
    try {
        const result = await getEmail().sendMagicLink(email, verifyUrl);
        sent    = result.sent !== false;
        devLink = result.devLink;
    } catch (e) {
        log('server.auth.email.send_error', { err: e.message }, 'error');
    }

    const resp = { ok: true, sent };
    if (devLink) resp.devLink = devLink;
    sendJson(res, 200, resp);
}

async function handleAuthVerify(req, res, query) {
    const token = query.get('token') || '';
    if (!token) return sendRedirect(res, '/app/#login-expirat');

    const reg = getRegistry();
    let payload;
    try { payload = await reg.consumeLoginToken(token); } catch { payload = null; }
    if (!payload) return sendRedirect(res, '/app/#login-expirat');

    let user;
    try {
        // Telegram intake tokens bind an existing userId (+ optional siteId).
        // Email magic-links keep creating/looking up by email.
        if (payload.userId) {
            user = await reg.getUser(payload.userId);
        } else if (payload.email) {
            user = await reg.getOrCreateUserByEmail(payload.email);
        } else {
            user = null;
        }
    } catch {
        user = null;
    }
    if (!user) return sendRedirect(res, '/app/#login-expirat');

    let auth;
    try { auth = getAuth(); } catch { return sendRedirect(res, '/app/#login-expirat'); }

    const cookieValue = auth.signSession(user.id);
    const cookie      = auth.buildSessionCookie(cookieValue);
    // Draft from Telegram lands on dashboard (same registry site; pay/publish in /app/).
    res.writeHead(302, { 'Set-Cookie': cookie, 'Location': '/app/#dashboard' });
    res.end();
}

async function handleAuthTelegram(req, res) {
    const body = await parseJson(req);
    const initData = body && body.initData;
    if (!initData) return sendJson(res, 400, { error: 'initData lipsă.' });

    let auth;
    try { auth = getAuth(); } catch (e) { return sendJson(res, 503, { error: 'Serviciu indisponibil.' }); }

    const tgData = auth.verifyTelegramInitData(initData);
    if (!tgData) return sendJson(res, 401, { error: 'Date Telegram invalide sau expirate.' });

    const reg = getRegistry();
    const user = await reg.getOrCreateUserByTelegram(tgData.tgId, { username: tgData.username, firstName: tgData.firstName });

    const cookieValue = auth.signSession(user.id);
    const cookie      = auth.buildSessionCookie(cookieValue);

    res.writeHead(200, { 'Set-Cookie': cookie, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, user }));
}

async function handleGetMe(req, res) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const user = await getRegistry().getUser(userId);
    if (!user) return sendJson(res, 401, { error: 'Utilizator negăsit.' });
    sendJson(res, 200, { user });
}

async function handleGetSites(req, res) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const sites = await getRegistry().listSites(userId);
    sendJson(res, 200, { sites });
}

async function handleGetSite(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const site = await getRegistry().getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site-ul nu a fost găsit.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Acces interzis.' });
    const versions = await getRegistry().listVersions(siteId);
    let config = null;
    if (versions.length > 0) {
        config = await getRegistry().getVersionConfig(siteId, versions[0].versionId);
    }
    sendJson(res, 200, { site, config });
}

async function handleGetVersions(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const site = await getRegistry().getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site-ul nu a fost găsit.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Acces interzis.' });
    const versions = await getRegistry().listVersions(siteId);
    sendJson(res, 200, { versions });
}

async function handleRollback(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const body = await parseJson(req);
    const { versionId } = body || {};
    if (!versionId) return sendJson(res, 400, { error: 'versionId lipsă.' });

    const reg  = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site-ul nu a fost găsit.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Acces interzis.' });
    if (!site.paid) return sendJson(res, 402, { error: 'Site-ul nu a fost plătit.' });

    const config = await reg.getVersionConfig(siteId, versionId);
    if (!config) return sendJson(res, 404, { error: 'Versiunea nu a fost găsită.' });

    const webpublish = require('./webpublish.js');
    try {
        const result = await webpublish.publishSite({ site, config, images: [] });
        sendJson(res, 200, { ok: true, url: result.url });
    } catch (e) {
        log('server.rollback.error', { siteId, err: e.message }, 'error');
        sendJson(res, 500, { error: 'Republicarea a eșuat: ' + e.message });
    }
}

async function handleSiteCheckout(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const reg  = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site-ul nu a fost găsit.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Acces interzis.' });

    if (!payments.isConfigured()) {
        return sendJson(res, 503, { error: 'Plata nu este configurată.' });
    }

    const p         = pricing.getPricingFromRequest(req);
    const currency  = p.currency;
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

    // Paid site → yearly renewal (29); unpaid → first publish (100)
    const isRenewal  = !!site.paid;
    const amountCents = isRenewal ? p.renewalCents : p.amountCents;
    const kind        = isRenewal ? 'renewal' : 'publish';
    const productName = isRenewal ? 'Reînnoire hosting Hidook Site Builder (12 luni)' : 'Activare site Hidook Site Builder';

    // Reuse pending same-site same-kind order (no second unpaid 100/29 row)
    let order = typeof reg.findPendingOrder === 'function'
        ? await reg.findPendingOrder(site.id, kind)
        : null;
    if (!order) {
        order = await reg.createOrder({
            siteId: site.id,
            userId,
            amountCents,
            currency,
            stripeSessionId: 'pending',
            kind,
        });
    }

    let checkout;
    try {
        checkout = await payments.createCheckout({
            amountCents,
            currency,
            productName,
            successUrl:  publicUrl + '/app/#platit',
            cancelUrl:   publicUrl + '/app/#anulat',
            metadata: { platform: 'web', orderId: order.id, userId, siteId: site.id, kind },
            clientReferenceId: (isRenewal ? 'renew-' : 'web-') + site.id,
        });
    } catch (e) {
        log('server.checkout.error', { siteId, err: e.message, kind }, 'error');
        return sendJson(res, 503, { error: 'Nu am putut iniția plata: ' + e.message });
    }

    // Attach real Stripe session id to the same pending order (no second row)
    await reg.attachStripeSession(order.id, checkout.id);

    sendJson(res, 200, {
        paymentUrl: checkout.url,
        kind,
        amountCents,
        paidUntil: site.paidUntil || null,
    });
}

function latestSiteConfig(reg, siteId) {
    const versions = reg.listVersions(siteId) || [];
    if (!versions.length) return {};
    const latest = versions[versions.length - 1];
    return reg.getVersionConfig(siteId, latest.versionId) || {};
}

function persistEmbedUrl(reg, siteId, embedUrl) {
    if (typeof embedUrl !== 'string' || !embedUrl) return latestSiteConfig(reg, siteId);
    const config = latestSiteConfig(reg, siteId);
    if (!config.instagram || typeof config.instagram !== 'object') config.instagram = {};
    config.instagram.embedUrl = embedUrl;
    reg.saveVersion(siteId, config);
    return config;
}

function publicGrantPayload(json) {
    return {
        embedUrl: typeof json.embedUrl === 'string' ? json.embedUrl : null,
        entitlement: typeof json.entitlement === 'string' ? json.entitlement : null,
        showWatermark: typeof json.showWatermark === 'boolean' ? json.showWatermark : null,
        siteBundleExpiresAt: typeof json.siteBundleExpiresAt === 'string' ? json.siteBundleExpiresAt : null,
    };
}

async function requireOwnedSiteWithEmail(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return null;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) {
        sendJson(res, 404, { error: 'Site-ul nu a fost găsit.' });
        return null;
    }
    if (site.userId !== userId) {
        sendJson(res, 403, { error: 'Acces interzis.' });
        return null;
    }
    const user = await reg.getUser(userId);
    const email = user && typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(res, 400, { error: 'Intră cu email ca să conectezi Instagram. Nu folosim un alt cont.' });
        return null;
    }
    const partner = getPartner();
    if (!partner.isConfigured()) {
        sendJson(res, 503, { error: 'Conectarea Instagram nu e configurată pe server.' });
        return null;
    }
    return { reg, site, email };
}

/**
 * POST /api/sites/:id/social-feed/grant
 * Server-to-server Instafidget Year-1 grant. Stores embedUrl on the draft if returned.
 */
async function handleSocialFeedGrant(req, res, siteId) {
    let body;
    try { body = await parseJson(req); } catch (e) {
        return sendJson(res, e.status || 400, { error: e.message || 'Body invalid.' });
    }
    if (!body || body.acceptedTerms !== true) {
        return sendJson(res, 400, { error: 'Bifează Termenii și Confidențialitatea Instafidget.' });
    }
    const ctx = await requireOwnedSiteWithEmail(req, res, siteId);
    if (!ctx) return;

    let partnerRes;
    try {
        partnerRes = await getPartner().grantYear1(ctx.email);
    } catch (e) {
        if (e && e.code === 'SECRET_MISSING') {
            return sendJson(res, 503, { error: 'Conectarea Instagram nu e configurată pe server.' });
        }
        log('server.social_feed.grant.error', { siteId, err: e.message }, 'error');
        return sendJson(res, 502, { error: 'Nu am putut vorbi cu Instafidget. Încearcă din nou.' });
    }

    if (partnerRes.status === 401) {
        return sendJson(res, 502, { error: 'Instafidget a refuzat conexiunea. Verifică configurația serverului.' });
    }
    if (partnerRes.status === 400) {
        return sendJson(res, 400, { error: 'Instafidget a refuzat cererea. Verifică acordul Terms + Privacy.' });
    }
    if (partnerRes.status < 200 || partnerRes.status >= 300) {
        return sendJson(res, 502, { error: 'Instafidget nu a putut crea bonusul Instagram.' });
    }

    persistEmbedUrl(ctx.reg, siteId, partnerRes.json.embedUrl);
    sendJson(res, 200, publicGrantPayload(partnerRes.json));
}

/**
 * POST /api/sites/:id/social-feed/editor-session
 * Returns Instafidget editorUrl. Does not change billing.
 */
async function handleSocialFeedEditor(req, res, siteId) {
    try { await parseJson(req); } catch (_) { /* empty body ok */ }
    const ctx = await requireOwnedSiteWithEmail(req, res, siteId);
    if (!ctx) return;

    let partnerRes;
    try {
        partnerRes = await getPartner().editorSession(ctx.email);
    } catch (e) {
        if (e && e.code === 'SECRET_MISSING') {
            return sendJson(res, 503, { error: 'Conectarea Instagram nu e configurată pe server.' });
        }
        log('server.social_feed.editor.error', { siteId, err: e.message }, 'error');
        return sendJson(res, 502, { error: 'Nu am putut deschide editorul Instagram. Încearcă din nou.' });
    }

    if (partnerRes.status === 401) {
        return sendJson(res, 502, { error: 'Instafidget a refuzat conexiunea. Verifică configurația serverului.' });
    }
    if (partnerRes.status === 404) {
        return sendJson(res, 404, { error: 'Conectează Instagram întâi (acord + Adaugă Instagram).' });
    }
    if (partnerRes.status === 400) {
        return sendJson(res, 400, { error: 'Nu am putut deschide editorul Instagram.' });
    }
    if (partnerRes.status < 200 || partnerRes.status >= 300) {
        return sendJson(res, 502, { error: 'Instafidget nu a putut deschide editorul.' });
    }

    const editorUrl = partnerRes.json && typeof partnerRes.json.editorUrl === 'string'
        ? partnerRes.json.editorUrl
        : null;
    if (!editorUrl) {
        return sendJson(res, 502, { error: 'Instafidget nu a trimis linkul de editor.' });
    }
    sendJson(res, 200, { editorUrl });
}

/**
 * POST /api/publish — pay before first public production publish.
 *
 * - Max 1 unpaid site per user (409 if another unpaid exists and it's a NEW site).
 * - Unpaid: persist draft (non-public), never deploy / never set status live.
 *   Returns checkout URL when payments are configured.
 * - Paid (re-edit): deploys directly.
 * - Returns {site: {id,url,slug,paid,status,...}, paymentUrl|null}
 */
async function handlePublish(req, res) {
    const userId = requireAuth(req, res);
    if (!userId) return;

    let body;
    try { body = await parseJson(req, PUBLISH_BODY_MAX); }
    catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

    const { siteId, templateId, config, images, slug: slugHint } = body || {};

    // Validate templateId
    const templates = loadTemplates();
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) return sendJson(res, 422, { error: 'Șablon necunoscut: ' + templateId });

    // Validate images
    const MAX_IMAGES   = 12;
    const MAX_DATA_URL = 2.5 * 1024 * 1024;
    const ALLOWED_MIME = /^image\/(jpeg|png|webp)$/;
    const imgList = Array.isArray(images) ? images : [];
    if (imgList.length > MAX_IMAGES) {
        return sendJson(res, 422, { error: `Maxim ${MAX_IMAGES} imagini permise.` });
    }
    for (const img of imgList) {
        if (!img || !img.dataUrl) continue;
        if (img.dataUrl.length > MAX_DATA_URL * 1.4) {
            return sendJson(res, 422, { error: `Imaginea "${img.name}" depășește 2.5 MB.` });
        }
        const mimeMatch = /^data:([^;]+);/.exec(img.dataUrl);
        if (!mimeMatch || !ALLOWED_MIME.test(mimeMatch[1])) {
            return sendJson(res, 422, { error: `Tipul imaginii "${img.name}" nu este acceptat (jpeg/png/webp).` });
        }
    }

    const reg = getRegistry();
    const price = pricing.getPricingFromRequest(req);

    // Get or create site
    let site;
    if (siteId) {
        site = await reg.getSite(siteId);
        if (!site) return sendJson(res, 404, { error: 'Site-ul nu a fost găsit.' });
        if (site.userId !== userId) return sendJson(res, 403, { error: 'Acces interzis.' });
    } else {
        // Max 1 unpaid site per user (prevents abuse)
        const existing = await reg.listSites(userId);
        const unpaid   = existing.filter(s => !s.paid && s.status !== 'deleted');
        if (unpaid.length > 0) {
            return sendJson(res, 409, {
                error: 'Ai deja un site neplătit. Plătește-l sau șterge-l înainte de a crea altul.',
                siteId: unpaid[0].id,
            });
        }

        // Determine slug
        let slug;
        if (slugHint) {
            slug = normalizeSlug(slugHint);
            if (!SLUG_RE.test(slug)) {
                return sendJson(res, 422, { error: 'Slug invalid (3-40 caractere, a-z 0-9 -).' });
            }
            if (!isSlugAvailable(slug)) {
                return sendJson(res, 409, { error: 'Slug-ul este deja folosit.' });
            }
        } else {
            const bizName = (config && config.business && config.business.name) || 'site';
            slug = slugify(bizName);
        }

        site = await reg.createSite({
            userId,
            templateId,
            templateVersion: tpl.version,
            slug,
            platform: 'web',
        });
    }

    const webpublish = require('./webpublish.js');

    // If already paid — publish directly (re-edit)
    if (site.paid) {
        try {
            const result = await webpublish.publishSite({ site, config, images: imgList });
            const updated = await reg.getSite(site.id);
            return sendJson(res, 200, { site: { ...updated, url: result.url }, paymentUrl: null });
        } catch (e) {
            if (e.code === 'MODERATION') return sendJson(res, 422, { error: 'Imaginile au fost blocate de moderare.' });
            log('server.publish.paid.error', { siteId: site.id, err: e.message }, 'error');
            const updated = await reg.getSite(site.id);
            return sendJson(res, 500, { error: 'Publicarea a eșuat: ' + e.message, site: updated });
        }
    }

    // Unpaid path: persist draft only — never deploy, never set live
    try {
        if (config && typeof config === 'object') {
            await reg.saveVersion(site.id, config);
        }
        await reg.updateSite(site.id, { status: 'draft', paid: false });

        let paymentUrl = null;
        if (payments.isConfigured()) {
            try {
                const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
                const order = await reg.createOrder({
                    siteId: site.id,
                    userId,
                    amountCents: price.amountCents,
                    currency: price.currency,
                    stripeSessionId: 'pending',
                    kind: 'publish',
                });
                const checkout = await payments.createCheckout({
                    amountCents: price.amountCents,
                    currency: price.currency,
                    productName: 'Activare site Hidook Site Builder',
                    successUrl:  publicUrl + '/app/#platit',
                    cancelUrl:   publicUrl + '/app/#anulat',
                    metadata: { platform: 'web', orderId: order.id, userId, siteId: site.id, kind: 'publish' },
                    clientReferenceId: 'web-' + site.id,
                });
                await reg.attachStripeSession(order.id, checkout.id);
                // Pending draft keyed by the single durable order id
                webpublish.savePendingDraft(order.id, {
                    config,
                    images: imgList,
                    siteId: site.id,
                    savedAt: new Date().toISOString(),
                });
                paymentUrl = checkout.url;
            } catch (e) {
                log('server.publish.checkout_error', { siteId: site.id, err: e.message }, 'warn');
            }
        }

        const updated = await reg.getSite(site.id);
        return sendJson(res, 200, {
            site: {
                ...updated,
                status: 'draft',
                paid: false,
                // No public live URL until payment + deploy
                url: updated.url && updated.status === 'live' ? updated.url : null,
            },
            paymentUrl,
        });
    } catch (e) {
        log('server.publish.draft.error', { siteId: site.id, err: e.message }, 'error');
        const updated = await reg.getSite(site.id);
        return sendJson(res, 500, { error: 'Salvarea ciornei a eșuat: ' + e.message, site: updated });
    }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

function createHandler({ onStripeEvent } = {}) {
    return async (req, res) => {
        const rawUrl = req.url || '/';
        const qIdx   = rawUrl.indexOf('?');
        const url    = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
        const query  = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '');

        try {
            // ── Redirect root → /app/ ──────────────────────────────────────
            if (req.method === 'GET' && url === '/') {
                return sendRedirect(res, '/app/');
            }

            // ── Health ─────────────────────────────────────────────────────
            if (req.method === 'GET' && url === '/health') {
                return sendJson(res, 200, { ok: true, service: 'hidook-bot', uptimeSec: Math.round(process.uptime()) });
            }

            // ── Stripe webhook ─────────────────────────────────────────────
            if (req.method === 'POST' && url === '/webhooks/stripe') {
                const testPay = process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production';
                const secret = process.env.STRIPE_WEBHOOK_SECRET;

                // HIDOOK_TEST_PAY: accept JSON checkout.session.completed without Stripe signature
                if (testPay && !secret) {
                    let raw;
                    try { raw = await readRawBody(req); }
                    catch (e) { return sendJson(res, e.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'bad body' }); }
                    let event;
                    try {
                        event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
                    } catch {
                        return sendJson(res, 400, { error: 'invalid json' });
                    }
                    sendJson(res, 200, { received: true });
                    log('webhook.stripe.received', { type: event && event.type, id: event && event.id, mode: 'test-pay' });
                    if (onStripeEvent) {
                        Promise.resolve()
                            .then(() => onStripeEvent(event))
                            .catch((e) => log('webhook.stripe.handler_error', { err: e.message, type: event && event.type }, 'error'));
                    }
                    return;
                }

                if (!secret) return sendJson(res, 503, { error: 'webhook not configured' });
                let raw;
                try { raw = await readRawBody(req); }
                catch (e) { return sendJson(res, e.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'bad body' }); }
                let event;
                try {
                    event = payments.constructWebhookEvent(raw, req.headers['stripe-signature'], secret);
                } catch (_) {
                    log('webhook.stripe.bad_signature', { ip: req.socket && req.socket.remoteAddress }, 'warn');
                    return sendJson(res, 400, { error: 'invalid signature' });
                }
                sendJson(res, 200, { received: true });
                log('webhook.stripe.received', { type: event.type, id: event.id });
                if (onStripeEvent) {
                    Promise.resolve()
                        .then(() => onStripeEvent(event))
                        .catch((e) => log('webhook.stripe.handler_error', { err: e.message, type: event.type }, 'error'));
                }
                return;
            }

            // ── Isolated live sites: /live/<slug>/* ────────────────────────
            if (req.method === 'GET' && (url === '/live' || url === '/live/' || url.startsWith('/live/'))) {
                return serveLive(req, res, url);
            }

            // ── Static: /app and /app/* ────────────────────────────────────
            if (req.method === 'GET' && (url === '/app' || url === '/app/' || url.startsWith('/app/'))) {
                return serveStatic(req, res, url);
            }

            // ── Public API: /api/config ─────────────────────────────────────
            if (req.method === 'GET' && url === '/api/config') {
                return await handleGetConfig(req, res, query);
            }

            // ── Public API: /api/slug-check ─────────────────────────────────
            if (req.method === 'GET' && url === '/api/slug-check') {
                return await handleSlugCheck(req, res, query);
            }

            // ── API routes ──────────────────────────────────────────────────
            if (req.method === 'GET' && url === '/api/templates') {
                return await handleGetTemplates(req, res);
            }

            if (req.method === 'POST' && url === '/api/auth/email') {
                return await handleAuthEmail(req, res);
            }

            if (req.method === 'GET' && url === '/auth/verify') {
                return await handleAuthVerify(req, res, query);
            }

            if (req.method === 'POST' && url === '/api/auth/telegram') {
                return await handleAuthTelegram(req, res);
            }

            if (req.method === 'GET' && url === '/api/me') {
                return await handleGetMe(req, res);
            }

            if (req.method === 'GET' && url === '/api/sites') {
                return await handleGetSites(req, res);
            }

            // /api/sites/:id/versions
            const versionsMatch = url.match(/^\/api\/sites\/([^/]+)\/versions$/);
            if (req.method === 'GET' && versionsMatch) {
                return await handleGetVersions(req, res, versionsMatch[1]);
            }

            // /api/sites/:id/rollback
            const rollbackMatch = url.match(/^\/api\/sites\/([^/]+)\/rollback$/);
            if (req.method === 'POST' && rollbackMatch) {
                return await handleRollback(req, res, rollbackMatch[1]);
            }

            // /api/sites/:id/checkout
            const checkoutMatch = url.match(/^\/api\/sites\/([^/]+)\/checkout$/);
            if (req.method === 'POST' && checkoutMatch) {
                return await handleSiteCheckout(req, res, checkoutMatch[1]);
            }

            const grantMatch = url.match(/^\/api\/sites\/([^/]+)\/social-feed\/grant$/);
            if (req.method === 'POST' && grantMatch) {
                return await handleSocialFeedGrant(req, res, grantMatch[1]);
            }

            const editorMatch = url.match(/^\/api\/sites\/([^/]+)\/social-feed\/editor-session$/);
            if (req.method === 'POST' && editorMatch) {
                return await handleSocialFeedEditor(req, res, editorMatch[1]);
            }

            // /api/sites/:id
            const siteMatch = url.match(/^\/api\/sites\/([^/]+)$/);
            if (req.method === 'GET' && siteMatch) {
                return await handleGetSite(req, res, siteMatch[1]);
            }

            if (req.method === 'POST' && url === '/api/publish') {
                return await handlePublish(req, res);
            }

            return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
            log('server.error', { err: e.message, url }, 'error');
            try { sendJson(res, e.status || 500, { error: e.message || 'Eroare internă.' }); } catch (_) {}
        }
    };
}

// ---------------------------------------------------------------------------
// Server start
// ---------------------------------------------------------------------------

function startServer(opts = {}) {
    const port   = opts.port != null ? opts.port : (Number(process.env.PORT) || 8787);
    const server = http.createServer(createHandler(opts));
    server.on('error', (e) => {
        console.error('[server] error:', e.message);
        log('server.error', { err: e.message }, 'error');
    });
    server.listen(port, () => {
        const addr = server.address();
        log('server.started', { port: addr && addr.port });
        console.log(`🌐 HTTP server on :${addr && addr.port} (health + webhooks + API)`);
    });
    return server;
}

module.exports = { startServer, createHandler, readRawBody };

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

if (require.main === module) {
    (async () => {
        console.log('server.js self-test');
        const srv = startServer({ port: 0 });
        await new Promise((r) => srv.once('listening', r));
        const { port } = srv.address();
        const res  = await fetch(`http://127.0.0.1:${port}/health`);
        const json = await res.json();
        console.log('  GET /health →', res.status, JSON.stringify(json));
        srv.close();
        if (res.status !== 200 || !json.ok) process.exit(1);
        console.log('  OK');
    })().catch((e) => { console.error(e); process.exit(1); });
}
