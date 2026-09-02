'use strict';
/**
 * bot/server.js — zero-dependency HTTP server (pay-before-publish).
 *
 * Routes:
 *   GET  /                   → 302 /app/
 *   GET  /health             → { ok, service, uptimeSec }
 *   GET  /admin              → operator site list (HIDOOK_ADMIN_TOKEN; else 404)
 *   POST /webhooks/stripe    → Stripe webhook (ACK then process async)
 *
 *   GET  /app/*              → static files from <repo>/builder/
 *   GET  /live/<slug>/*      → isolated local publish ($DATA_DIR/published/<slug>/)
 *
 *   GET  /api/config         → {amount, amountCents, currency, renewal, renewalCents, trialDays, brandDomain|null, contactUrl|null, calendar} (public)
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
 *   POST /api/sites/:id/billing-portal → {portalUrl} Stripe Customer Portal (cancel)
 *   POST /api/sites/:id/social-feed/grant          → Instafidget Year-1 grant; stores instagram.embedUrl
 *   POST /api/sites/:id/social-feed/editor-session → Instafidget editor SSO URL
 *   POST /api/sites/:id/social-feed/disconnect     → clear instagram.embedUrl (explicit disconnect)
 *   POST /api/publish        → pay-before-publish: unpaid saves draft (+ checkout URL); paid deploys
 *   POST /api/draft          → save the signed-in browser draft without publishing
 *   GET  /api/export-html   → download current draft as complete static HTML (session; not a live publish)
 *   GET  /api/export-zip    → download current draft as self-hostable static ZIP (session; not a live publish)
 *   POST /api/test-pay/complete → HIDOOK_TEST_PAY only: finish #test-checkout=cs_test_* (same as unsigned webhook)
 *   POST /api/appointments      → public appointment *request* for a live slug (local isolated store; not a confirmed booking)
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
const calendarBoundary = require('./calendar-boundary.js');
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

/**
 * Origin for redirects/portal return when PUBLIC_URL is unset.
 * Prefer PUBLIC_URL; else build from the request Host (preserve port) so
 * isolated loopback (http://127.0.0.1:PORT/app/) does not drop the port.
 */
function requestPublicOrigin(req) {
    const envUrl = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
    if (envUrl) return envUrl;
    if (!req || !req.headers) return '';
    const rawHost =
        req.headers['x-forwarded-host'] ||
        req.headers.host ||
        '';
    const host = String(Array.isArray(rawHost) ? rawHost[0] : rawHost)
        .split(',')[0]
        .trim();
    if (!host) return '';
    const rawProto = req.headers['x-forwarded-proto'] || '';
    let proto = String(Array.isArray(rawProto) ? rawProto[0] : rawProto)
        .split(',')[0]
        .trim()
        .toLowerCase();
    if (proto !== 'http' && proto !== 'https') {
        // Local / isolated servers are plain HTTP; do not invent https.
        proto = 'http';
    }
    return proto + '://' + host;
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.txt':  'text/plain; charset=utf-8',
};

// In-memory static file cache: path → { buf, mtimeMs, size, etag, lastModified }
const staticFileCache = new Map();

function getCachedStatic(filePath, stat) {
    const prev = staticFileCache.get(filePath);
    if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) {
        return prev;
    }
    const buf = fs.readFileSync(filePath);
    // Strong ETag from size + mtime (stable across process restarts for unchanged files).
    const etag = '"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
    const entry = {
        buf,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        etag,
        lastModified: stat.mtime.toUTCString(),
    };
    staticFileCache.set(filePath, entry);
    return entry;
}

function cacheControlForPath(targetPath) {
    const ext = path.extname(targetPath).toLowerCase();
    // Generated assets + images: cacheable, revalidate so 304 works on reload.
    if (
        targetPath.includes(path.sep + 'generated' + path.sep) ||
        ['.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.woff', '.woff2'].includes(ext)
    ) {
        return 'public, max-age=0, must-revalidate';
    }
    // HTML: always revalidate.
    return 'no-cache';
}

function sendCachedFile(req, res, targetPath, stat) {
    const ext = path.extname(targetPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const cached = getCachedStatic(targetPath, stat);
    const headers = {
        'Content-Type': mime,
        'Content-Length': cached.buf.length,
        'ETag': cached.etag,
        'Last-Modified': cached.lastModified,
        'Cache-Control': cacheControlForPath(targetPath),
    };

    const inm = req.headers['if-none-match'];
    if (inm) {
        // Allow weak/strong and comma-separated lists.
        const tags = String(inm).split(',').map((s) => s.trim());
        if (tags.includes(cached.etag) || tags.includes('W/' + cached.etag)) {
            res.writeHead(304, {
                'ETag': cached.etag,
                'Last-Modified': cached.lastModified,
                'Cache-Control': headers['Cache-Control'],
            });
            res.end();
            return;
        }
    }
    const ims = req.headers['if-modified-since'];
    if (ims && !inm) {
        const since = Date.parse(ims);
        if (!Number.isNaN(since) && stat.mtimeMs <= since + 999) {
            res.writeHead(304, {
                'ETag': cached.etag,
                'Last-Modified': cached.lastModified,
                'Cache-Control': headers['Cache-Control'],
            });
            res.end();
            return;
        }
    }

    if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
    }
    res.writeHead(200, headers);
    res.end(cached.buf);
}


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
        if (e.code === 'BODY_TOO_LARGE') throw Object.assign(new Error('The request body is too large.'), { status: 413 });
        throw e;
    }
    try {
        return JSON.parse(raw.toString('utf8'));
    } catch {
        throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
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

/** Browser navigation prefers text/html over application/json. */
function wantsHtmlDocument(req) {
    const accept = String((req && req.headers && (req.headers.accept || req.headers.Accept)) || '');
    if (!accept) return false;
    const lower = accept.toLowerCase();
    const hi = lower.indexOf('text/html');
    if (hi === -1) return false;
    const ji = lower.indexOf('application/json');
    return ji === -1 || hi < ji;
}

/**
 * Short product 404 / unpublished lock for normal browser navigations.
 * VISION: product language is Romanian on customer-visible surfaces.
 * Cancel during trial must not silently serve stale live HTML — clear RO state.
 * API clients still get JSON via sendNotFound when Accept is not HTML-first.
 *
 * @param {import('http').ServerResponse} res
 * @param {{ kind?: 'not_found'|'unpublished'|'unpaid' }} [opts]
 */
function sendHtmlNotFound(res, opts = {}) {
    const kind = opts.kind || 'not_found';
    const isUnpublished = kind === 'unpublished' || kind === 'unpaid';
    const title = isUnpublished
        ? 'Site-ul nu mai este public — Hidook Site Builder'
        : 'Pagină negăsită — Hidook Site Builder';
    const heading = isUnpublished
        ? 'Site-ul nu mai este public'
        : 'Pagină negăsită';
    const body = isUnpublished
        ? (kind === 'unpublished'
            ? 'Abonamentul a fost anulat (inclusiv în trialul de 7 zile). Site-ul nu mai este disponibil public — nu se servește conținut live vechi.'
            : 'Acest site nu este public încă. Adaugă un card pentru trialul de 7 zile ca să fie live imediat.')
        : 'Linkul pe care l-ai deschis nu există sau a fost mutat.';
    const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1220;color:#e8eef8}
  main{max-width:28rem;padding:2rem;text-align:center}
  h1{font-size:1.35rem;margin:0 0 .75rem;font-weight:650}
  p{margin:0 0 1rem;line-height:1.5;color:#b7c2d6}
  a{color:#7dd3fc;text-decoration:none;font-weight:600}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<main>
  <h1>${heading}</h1>
  <p>${body}</p>
  <p><a href="/app/">Deschide Hidook Site Builder</a></p>
</main>
</body>
</html>`;
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
    });
    res.end(buf);
}

/**
 * Prefer HTML product page for browser docs; keep JSON for API-style clients.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} [jsonError]
 * @param {{ kind?: 'not_found'|'unpublished'|'unpaid' }} [opts]
 */
function sendNotFound(req, res, jsonError = 'not found', opts = {}) {
    if (wantsHtmlDocument(req)) return sendHtmlNotFound(res, opts);
    return sendJson(res, 404, { error: jsonError });
}

/** Resolve registry site by public slug (isolated /live path). */
function findSiteBySlug(slug) {
    try {
        const reg = getRegistry();
        const want = String(slug || '').toLowerCase();
        if (!want) return null;
        const all = typeof reg.listAllSites === 'function' ? reg.listAllSites() : [];
        return all.find((s) => s && String(s.slug || '').toLowerCase() === want) || null;
    } catch (_) {
        return null;
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Operator admin token from Authorization: Bearer or ?token= (HTML page only).
 * Constant-time when lengths match. Never log the token.
 * @returns {string|null}
 */
function extractAdminToken(req, query) {
    const auth = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
    const m = /^Bearer\s+(\S+)/i.exec(auth);
    if (m) return m[1];
    if (query && typeof query.get === 'function') {
        const q = query.get('token');
        if (q) return String(q);
    }
    return null;
}

function adminTokenOk(provided) {
    const expected = process.env.HIDOOK_ADMIN_TOKEN;
    if (!expected || !provided) return false;
    const a = Buffer.from(String(provided), 'utf8');
    const b = Buffer.from(String(expected), 'utf8');
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(a, b);
    } catch (_) {
        return false;
    }
}

/**
 * Derive plain-English publish status for the ops table.
 * @param {object} site
 * @returns {'Live'|'Unpublished'}
 */
function adminPublishLabel(site) {
    const st = String((site && site.status) || '').toLowerCase();
    if (st === 'live' || st === 'active') return 'Live';
    return 'Unpublished';
}

/**
 * Billing label only when already present on the site/order record.
 * Omit rather than invent.
 * @param {object} site
 * @param {object|null} order
 * @returns {string|null} trial | paid | canceled | null
 */
function adminBillingLabel(site, order) {
    const subSt = String(
        (site && (site.stripeSubscriptionStatus || site.subscriptionStatus)) || ''
    ).toLowerCase();
    if (subSt === 'canceled' || subSt === 'cancelled' || site && site.canceledAt) {
        return 'canceled';
    }
    if (order && order.status === 'canceled') return 'canceled';
    // Trial start stores paid=true with no charge yet (payment_status no_payment_required).
    if (site && (site.status === 'live' || site.status === 'active') && site.paid && site.stripeSubscriptionId) {
        // Prefer explicit trial marker if present; otherwise live+paid+sub without charge → trial/paid
        if (site.billingState === 'trial' || site.subscriptionStatus === 'trialing') return 'trial';
        if (site.billingState === 'paid' || order && (order.chargedAt || order.chargeId || order.status === 'charged')) {
            return 'paid';
        }
        // Live after card trial with no charge marker → trial
        return 'trial';
    }
    if (site && site.paid === true) return 'paid';
    if (order && (order.status === 'paid' || order.paidAt)) return 'paid';
    return null;
}

/**
 * Token-gated operator dashboard: list every registry site (read-only).
 * Missing/wrong token → same 404 as unknown routes (do not advertise).
 */
function handleAdmin(req, res, query) {
    if (!adminTokenOk(extractAdminToken(req, query))) {
        return sendNotFound(req, res, 'not found');
    }
    const reg = getRegistry();
    const sites = (reg.listAllSites ? reg.listAllSites() : []).slice().sort((a, b) => {
        const ta = String(a.createdAt || '');
        const tb = String(b.createdAt || '');
        return tb.localeCompare(ta);
    });

    const rows = sites.map((site) => {
        const slug = escapeHtml(site.slug || site.id || '');
        const pub = adminPublishLabel(site);
        const isLive = pub === 'Live';
        let publicUrl = '';
        if (isLive) {
            if (site.url) publicUrl = String(site.url);
            else if (site.slug) publicUrl = '/live/' + String(site.slug).toLowerCase() + '/';
        }
        let order = null;
        try {
            if (typeof reg.listOrdersBySite === 'function') {
                const ordList = reg.listOrdersBySite(site.id) || [];
                order = ordList[0] || null;
            } else if (typeof reg.getOrdersForSite === 'function') {
                const ordList = reg.getOrdersForSite(site.id) || [];
                order = ordList[0] || null;
            }
        } catch (_) {}
        const billing = adminBillingLabel(site, order);
        const urlCell = publicUrl
            ? `<a href="${escapeHtml(publicUrl)}">${escapeHtml(publicUrl)}</a>`
            : '—';
        const billCell = billing ? escapeHtml(billing) : '—';
        return `<tr>
  <td><code>${slug}</code></td>
  <td><span class="st ${isLive ? 'live' : 'down'}">${escapeHtml(pub)}</span></td>
  <td>${urlCell}</td>
  <td>${billCell}</td>
</tr>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Sites — Hidook Site Builder</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0b1220;color:#e8eef8}
  main{max-width:56rem;margin:0 auto;padding:1.5rem 1.25rem 3rem}
  h1{font-size:1.35rem;margin:0 0 .35rem;font-weight:650}
  p.lead{margin:0 0 1.25rem;color:#b7c2d6;line-height:1.45}
  table{width:100%;border-collapse:collapse;font-size:.92rem}
  th,td{text-align:left;padding:.55rem .6rem;border-bottom:1px solid #1e2a3d;vertical-align:top}
  th{color:#9fb0c9;font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
  code{font-size:.85em}
  a{color:#7dd3fc;text-decoration:none} a:hover{text-decoration:underline}
  .st{font-weight:600}
  .st.live{color:#6ee7b7}
  .st.down{color:#fcd34d}
  .empty{color:#9fb0c9;padding:1rem 0}
</style>
</head>
<body>
<main>
  <h1>Sites</h1>
  <p class="lead">Hidook Site Builder — operator view (read-only).</p>
  ${sites.length === 0
        ? '<p class="empty">No sites in the registry yet.</p>'
        : `<table>
  <thead><tr><th>Slug</th><th>Status</th><th>Public URL</th><th>Billing</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`}
</main>
</body>
</html>`;
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
    });
    res.end(buf);
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
        sendJson(res, 401, { error: 'Sign-in required.' });
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
        sendJson(res, 403, { error: 'Access denied.' });
        return;
    }

    const filePath = path.join(BUILDER_DIR, normalised);
    const realBuilder = path.resolve(BUILDER_DIR);
    const realFile    = path.resolve(filePath);
    if (!realFile.startsWith(realBuilder + path.sep) && realFile !== realBuilder) {
        sendJson(res, 403, { error: 'Access denied.' });
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
            const indexStat = fs.statSync(indexPath);
            sendCachedFile(req, res, indexPath, indexStat);
        } catch {
            sendJson(res, 404, { error: 'File not found.' });
        }
        return;
    }

    sendCachedFile(req, res, targetPath, stat);
}

// ---------------------------------------------------------------------------
// Isolated live sites — GET /live/<slug>/* from $DATA_DIR/published/<slug>/
// Only written by HIDOOK_ISOLATED_DEPLOY after paid publish (unpaid → 404).
// Cancel/unpublish removes files; browser gets clear Romanian locked state.
// ---------------------------------------------------------------------------

/**
 * When isolated files are missing: distinguish cancelled/unpublished vs never-live.
 * Never silently re-serve stale business HTML after cancel.
 */
function sendLiveMissing(req, res, slug) {
    const site = findSiteBySlug(slug);
    let kind = 'not_found';
    if (site) {
        const st = String(site.status || '').toLowerCase();
        if (st === 'unpublished' || st === 'canceled' || st === 'cancelled' || site.canceledAt) {
            kind = 'unpublished';
        } else if (!site.paid || st === 'draft') {
            kind = 'unpaid';
        } else {
            // Was paid but files gone — treat as locked/unpublished product state
            kind = 'unpublished';
        }
    }
    return sendNotFound(req, res, 'not found', { kind });
}

function serveLive(req, res, urlPath) {
    // urlPath like /live/<slug> or /live/<slug>/ or /live/<slug>/foo.css
    const raw = urlPath.replace(/^\/live\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    if (parts.length === 0) {
        // Browser nav → HTML 404; API Accept → JSON
        return sendNotFound(req, res, 'not found');
    }

    const slug = parts[0];
    // Slug must be a single safe path segment (no traversal)
    if (!/^[a-z0-9-]{3,40}$/i.test(slug) || slug.includes('..')) {
        return sendJson(res, 403, { error: 'Access denied.' });
    }

    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
    const publishedRoot = path.resolve(path.join(dataDir, 'published'));
    const siteRoot = path.resolve(path.join(publishedRoot, slug.toLowerCase()));

    if (!siteRoot.startsWith(publishedRoot + path.sep) && siteRoot !== publishedRoot) {
        return sendJson(res, 403, { error: 'Access denied.' });
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
        return sendJson(res, 403, { error: 'Access denied.' });
    }

    let filePath = path.join(siteRoot, normalised);
    let realFile;
    try {
        realFile = path.resolve(filePath);
    } catch {
        return sendJson(res, 403, { error: 'Access denied.' });
    }
    if (!realFile.startsWith(siteRoot + path.sep) && realFile !== siteRoot) {
        return sendJson(res, 403, { error: 'Access denied.' });
    }

    let stat;
    try { stat = fs.statSync(realFile); } catch {
        // Unpaid / cancelled / missing live site: HTML product state (RO), JSON for API
        return sendLiveMissing(req, res, slug);
    }

    if (stat.isDirectory()) {
        realFile = path.join(realFile, 'index.html');
        try { stat = fs.statSync(realFile); } catch {
            return sendLiveMissing(req, res, slug);
        }
    }

    if (!stat.isFile()) {
        return sendLiveMissing(req, res, slug);
    }

    const ext  = path.extname(realFile).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(realFile);
    const headers = { 'Content-Type': mime, 'Content-Length': content.length };
    if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
    }
    res.writeHead(200, headers);
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
        // Card subscription trial length (days) — commercial model, not free live TRIAL_DAYS.
        trialDays:    payments.SUBSCRIPTION_TRIAL_DAYS,
        // Compat alias for older UI that read priceEur as the displayed major units.
        priceEur:     p.amount,
        brandDomain:  process.env.BRAND_DOMAIN || null,
        contactUrl:   process.env.CONTACT_URL  || null,
        // Professional calendar honesty (option C groundwork; no fake cal.diy embed).
        calendar:     calendarBoundary.getPublicCalendarConfig(),
    });
}

async function handleSlugCheck(req, res, query) {
    const raw  = (query.get('slug') || '').trim();
    const slug = normalizeSlug(raw);
    if (!SLUG_RE.test(slug)) {
        return sendJson(res, 200, { available: false, slug, error: 'Invalid slug (3-40 characters, a-z 0-9 -).' });
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
        return sendJson(res, 400, { error: 'Introdu o adresă de email validă.' });
    }

    const reg = getRegistry();
    let token;
    try {
        ({ token } = await reg.createLoginToken({ email, purpose: 'login' }));
    } catch (e) {
        log('server.auth.email.token_error', { err: e.message }, 'error');
        return sendJson(res, 503, { error: 'Service temporarily unavailable.' });
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
    if (!token) return sendRedirect(res, '/app/#login-expired');

    const reg = getRegistry();
    let payload;
    try { payload = await reg.consumeLoginToken(token); } catch { payload = null; }
    if (!payload) return sendRedirect(res, '/app/#login-expired');

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
    if (!user) return sendRedirect(res, '/app/#login-expired');

    let auth;
    try { auth = getAuth(); } catch { return sendRedirect(res, '/app/#login-expired'); }

    let cookieValue;
    try {
        cookieValue = auth.signSession(user.id);
    } catch {
        // Missing secret outside isolated/dev: fail closed, no env names in body.
        return sendRedirect(res, '/app/#login-expired');
    }
    const cookie = auth.buildSessionCookie(cookieValue);
    // Draft from Telegram lands on dashboard (same registry site; pay/publish in /app/).
    res.writeHead(302, { 'Set-Cookie': cookie, 'Location': '/app/#dashboard' });
    res.end();
}

async function handleAuthTelegram(req, res) {
    const body = await parseJson(req);
    const initData = body && body.initData;
    if (!initData) return sendJson(res, 400, { error: 'Missing initData.' });

    let auth;
    try { auth = getAuth(); } catch (e) { return sendJson(res, 503, { error: 'Service unavailable.' }); }

    const tgData = auth.verifyTelegramInitData(initData);
    if (!tgData) return sendJson(res, 401, { error: 'Invalid or expired Telegram data.' });

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
    if (!user) return sendJson(res, 401, { error: 'User not found.' });
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
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
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
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    const versions = await getRegistry().listVersions(siteId);
    sendJson(res, 200, { versions });
}

async function handleRollback(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const body = await parseJson(req);
    const { versionId } = body || {};
    if (!versionId) return sendJson(res, 400, { error: 'Missing versionId.' });

    const reg  = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    if (!site.paid) return sendJson(res, 402, { error: 'Site has not been paid for.' });

    const config = await reg.getVersionConfig(siteId, versionId);
    if (!config) return sendJson(res, 404, { error: 'Version not found.' });

    const webpublish = require('./webpublish.js');
    try {
        const result = await webpublish.publishSite({ site, config, images: [] });
        sendJson(res, 200, { ok: true, url: result.url });
    } catch (e) {
        log('server.rollback.error', { siteId, err: e.message }, 'error');
        sendJson(res, 500, { error: 'Republish failed: ' + e.message });
    }
}

// ---------------------------------------------------------------------------
// Appointments — local request store (no external calendar; status=requested only)
// ---------------------------------------------------------------------------

function appointmentsDataDir() {
    return process.env.DATA_DIR || path.join(__dirname, '..');
}

function appointmentsFileForSlug(slug) {
    const safe = String(slug || '').toLowerCase();
    return path.join(appointmentsDataDir(), 'appointments', `${safe}.json`);
}

function loadAppointmentRequests(slug) {
    try {
        const raw = fs.readFileSync(appointmentsFileForSlug(slug), 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data.requests) ? data.requests : [];
    } catch {
        return [];
    }
}

function saveAppointmentRequests(slug, requests) {
    const dir = path.join(appointmentsDataDir(), 'appointments');
    fs.mkdirSync(dir, { recursive: true });
    const file = appointmentsFileForSlug(slug);
    const tmp = file + '.tmp';
    const payload = JSON.stringify({ slug, updatedAt: new Date().toISOString(), requests }, null, 2);
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, file);
}

function liveSiteExists(slug) {
    const dataDir = appointmentsDataDir();
    const publishedRoot = path.resolve(path.join(dataDir, 'published'));
    const siteRoot = path.resolve(path.join(publishedRoot, String(slug).toLowerCase()));
    if (!siteRoot.startsWith(publishedRoot + path.sep) && siteRoot !== publishedRoot) return false;
    try {
        return fs.statSync(path.join(siteRoot, 'index.html')).isFile();
    } catch {
        return false;
    }
}

/**
 * POST /api/appointments — public visitor appointment *request* for a published live slug.
 * Never returns confirmed booking. Persists under DATA_DIR/appointments/<slug>.json.
 */
async function handleCreateAppointment(req, res) {
    let body;
    try {
        body = await parseJson(req, 64 * 1024);
    } catch (e) {
        return sendJson(res, e.status || 400, { error: e.message || 'Invalid request.' });
    }

    const slug = String((body && body.slug) || '').toLowerCase().trim();
    if (!SLUG_RE.test(slug)) {
        return sendJson(res, 400, { error: 'Invalid site.' });
    }
    if (!liveSiteExists(slug)) {
        return sendJson(res, 404, { error: 'This site is not published.' });
    }

    const visitorName = String((body && body.visitorName) || '').trim().slice(0, 80);
    const visitorEmail = String((body && body.visitorEmail) || '').trim().slice(0, 120);
    const visitorPhone = String((body && body.visitorPhone) || '').trim().slice(0, 40);
    const note = String((body && body.note) || '').trim().slice(0, 400);
    const appointmentTypeId = String((body && body.appointmentTypeId) || '').trim().slice(0, 64);
    const appointmentTypeLabel = String((body && body.appointmentTypeLabel) || '').trim().slice(0, 80);
    const timezone = String((body && body.timezone) || 'Europe/Bucharest').trim().slice(0, 64);
    const requestedStartISO = String((body && body.requestedStartISO) || '').trim();
    const durationMin = Math.min(480, Math.max(15, parseInt((body && body.durationMin) || '45', 10) || 45));
    const mode = String((body && body.mode) || '').trim().slice(0, 40);

    if (!visitorName || !visitorEmail) {
        return sendJson(res, 400, { error: 'Name and email are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitorEmail)) {
        return sendJson(res, 400, { error: 'Invalid email address.' });
    }
    const startMs = Date.parse(requestedStartISO);
    if (!Number.isFinite(startMs)) {
        return sendJson(res, 400, { error: 'Invalid time slot.' });
    }
    // Soft lead: reject far-past starts (allow 5 min clock skew)
    if (startMs < Date.now() - 5 * 60 * 1000) {
        return sendJson(res, 400, { error: 'That time slot is no longer available.' });
    }
    if (!appointmentTypeId) {
        return sendJson(res, 400, { error: 'Missing appointment type.' });
    }

    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date().toISOString();
    const record = {
        id,
        slug,
        appointmentTypeId,
        appointmentTypeLabel: appointmentTypeLabel || appointmentTypeId,
        requestedStartISO: new Date(startMs).toISOString(),
        timezone,
        durationMin,
        mode,
        visitorName,
        visitorEmail,
        visitorPhone: visitorPhone || undefined,
        note: note || undefined,
        status: 'requested',
        createdAt: now,
        updatedAt: now,
    };

    const existing = loadAppointmentRequests(slug);
    // Idempotency: same email + same start within 2 minutes → return existing
    const dup = existing.find((r) =>
        r &&
        r.status === 'requested' &&
        String(r.visitorEmail).toLowerCase() === visitorEmail.toLowerCase() &&
        r.requestedStartISO === record.requestedStartISO &&
        Math.abs(Date.parse(r.createdAt) - Date.parse(now)) < 2 * 60 * 1000
    );
    if (dup) {
        return sendJson(res, 200, {
            ok: true,
            id: dup.id,
            status: 'requested',
            requestedStartISO: dup.requestedStartISO,
            timezone: dup.timezone,
            appointmentTypeLabel: dup.appointmentTypeLabel,
            alreadyRecorded: true,
        });
    }

    existing.push(record);
    // Cap per site for local demo
    const trimmed = existing.slice(-500);
    try {
        saveAppointmentRequests(slug, trimmed);
    } catch (e) {
        log('appointments.save_error', { slug, err: e.message }, 'error');
        return sendJson(res, 500, { error: "We couldn't save your request." });
    }

    log('appointments.requested', { slug, id, type: appointmentTypeId });
    return sendJson(res, 200, {
        ok: true,
        id,
        status: 'requested',
        requestedStartISO: record.requestedStartISO,
        timezone,
        appointmentTypeLabel: record.appointmentTypeLabel,
    });
}

/**
 * GET /api/appointments?slug= — owner-only list of requests for a live slug.
 * Requires auth + site ownership (visitorName/visitorEmail are PII). POST stays public.
 */
async function handleListAppointments(req, res, query) {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const slug = String((query && typeof query.get === 'function' ? query.get('slug') : '') || '').toLowerCase().trim();
    if (!SLUG_RE.test(slug)) {
        return sendJson(res, 400, { error: 'Invalid site.' });
    }
    if (!liveSiteExists(slug)) {
        return sendJson(res, 404, { error: 'This site is not published.' });
    }

    const reg = getRegistry();
    const owned = (await reg.listSites(userId)).some(
        (s) => s && (
            String(s.slug || '').toLowerCase() === slug ||
            String(s.projectName || '').toLowerCase() === slug
        )
    );
    if (!owned) {
        return sendJson(res, 403, { error: 'Access denied.' });
    }

    const requests = loadAppointmentRequests(slug).map((r) => ({
        id: r.id,
        status: r.status,
        requestedStartISO: r.requestedStartISO,
        timezone: r.timezone,
        appointmentTypeId: r.appointmentTypeId,
        appointmentTypeLabel: r.appointmentTypeLabel,
        visitorName: r.visitorName,
        visitorEmail: r.visitorEmail,
        visitorPhone: r.visitorPhone,
        note: r.note,
        mode: r.mode,
        durationMin: r.durationMin,
        createdAt: r.createdAt,
    }));
    return sendJson(res, 200, { ok: true, slug, requests });
}

/**
 * HIDOOK_TEST_PAY only (non-production): complete an offline #test-checkout=cs_test_* return
 * with the same paid transition as the unsigned Stripe test webhook.
 * Auth required; order must belong to the session user.
 */
async function handleTestPayComplete(req, res) {
    const testPay = process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production';
    if (!testPay) {
        return sendJson(res, 403, { error: 'Test payment is not available.' });
    }

    const userId = requireAuth(req, res);
    if (!userId) return;

    let body;
    try {
        body = await parseJson(req);
    } catch {
        return sendJson(res, 400, { error: 'Invalid request.' });
    }
    const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
        return sendJson(res, 400, { error: 'Sesiune de plată invalidă.' });
    }

    const reg = getRegistry();
    const order = typeof reg.getOrderBySession === 'function'
        ? await reg.getOrderBySession(sessionId)
        : null;
    if (!order) {
        return sendJson(res, 404, { error: 'Order not found.' });
    }
    if (order.userId && order.userId !== userId) {
        return sendJson(res, 403, { error: 'Access denied.' });
    }

    const sitePre = order.siteId ? await reg.getSite(order.siteId) : null;
    if (sitePre && sitePre.userId !== userId) {
        return sendJson(res, 403, { error: 'Access denied.' });
    }

    const kind = order.kind || 'publish';
    const event = {
        id: 'evt_testpay_' + crypto.randomBytes(8).toString('hex'),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'paid',
                metadata: {
                    platform: 'web',
                    orderId: order.id,
                    siteId: order.siteId,
                    kind,
                    userId,
                },
            },
        },
    };

    const webpublish = require('./webpublish.js');
    try {
        await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });
    } catch (e) {
        log('server.test_pay.complete.error', { sessionId, err: e.message }, 'error');
        return sendJson(res, 500, { error: 'Payment confirmation failed.' });
    }

    const site = order.siteId ? await reg.getSite(order.siteId) : null;
    if (!site) {
        return sendJson(res, 200, { ok: true, site: null });
    }
    // Fresh paid site may still be deploying; return current registry row
    return sendJson(res, 200, {
        ok: true,
        site: {
            id: site.id,
            slug: site.slug,
            paid: !!site.paid,
            status: site.status,
            url: site.url || null,
            paidUntil: site.paidUntil || null,
        },
    });
}

async function handleSiteCheckout(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const reg  = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });

    if (!payments.isConfigured()) {
        return sendJson(res, 503, { error: 'Payments are not configured.' });
    }

    const p         = pricing.getPricingFromRequest(req);
    const currency  = p.currency;
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

    // Paid site → yearly renewal (29); unpaid → first publish (100)
    const isRenewal  = !!site.paid;
    const amountCents = isRenewal ? p.renewalCents : p.amountCents;
    const kind        = isRenewal ? 'renewal' : 'publish';
    const productName = isRenewal ? 'Hidook Site Builder hosting renewal (12 months)' : 'Hidook Site Builder site activation';

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
            successUrl:  publicUrl + '/app/#paid',
            cancelUrl:   publicUrl + '/app/#cancelled',
            metadata: { platform: 'web', orderId: order.id, userId, siteId: site.id, kind },
            clientReferenceId: (isRenewal ? 'renew-' : 'web-') + site.id,
        });
    } catch (e) {
        log('server.checkout.error', { siteId, err: e.message, kind }, 'error');
        return sendJson(res, 503, { error: "We couldn't start checkout: " + e.message });
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

/**
 * POST /api/sites/:id/billing-portal
 * Opens a Stripe Customer Portal session for the site owner (cancel / manage billing).
 * HIDOOK_TEST_PAY=1: offline portal URL (no network, no charge).
 * Requires the site to have a stripeCustomerId from a prior checkout.
 */
async function handleSiteBillingPortal(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const reg  = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });

    if (!payments.isConfigured()) {
        return sendJson(res, 503, { error: 'Payments are not configured.' });
    }

    let customerId = site.stripeCustomerId || null;
    // Offline test-pay: synthesize a stable customer id so Cancel works without a live Stripe customer.
    if (!customerId && process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production') {
        customerId = 'cus_test_site_' + String(site.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
        try {
            await reg.updateSite(site.id, { stripeCustomerId: customerId });
        } catch (_) {}
    }
    if (!customerId) {
        return sendJson(res, 400, {
            error: 'No billing customer on this site yet. Start a trial first, then cancel from the portal.',
        });
    }

    const publicUrl = requestPublicOrigin(req);
    // Must include listening port on isolated loopback (Host: 127.0.0.1:PORT).
    // Never fall back to host-only http://127.0.0.1/app/ — ERR_CONNECTION_REFUSED.
    const returnUrl = publicUrl
        ? publicUrl + '/app/#sites'
        : 'http://127.0.0.1/app/#sites';

    let session;
    try {
        session = await payments.createBillingPortalSession({
            customerId,
            returnUrl,
        });
    } catch (e) {
        log('server.billing_portal.error', { siteId, err: e.message }, 'error');
        return sendJson(res, 503, { error: "We couldn't open billing: " + e.message });
    }

    // HIDOOK_TEST_PAY offline: finishing cancel without network — apply unpublish now
    // so the same Cancel control completes the contract (portal would cancel → webhook).
    if (
        session && session.offline &&
        process.env.HIDOOK_TEST_PAY === '1' &&
        process.env.NODE_ENV !== 'production'
    ) {
        try {
            const webpublish = require('./webpublish.js');
            const subId = site.stripeSubscriptionId || ('sub_test_portal_' + site.id.slice(0, 8));
            await webpublish.handleStripeSubscriptionEvent({
                id: 'evt_test_portal_cancel_' + crypto.randomBytes(6).toString('hex'),
                type: 'customer.subscription.deleted',
                data: {
                    object: {
                        id: subId,
                        customer: customerId,
                        status: 'canceled',
                        metadata: { siteId: site.id },
                    },
                },
            });
        } catch (e) {
            log('server.billing_portal.test_cancel.error', { siteId, err: e.message }, 'warn');
        }
    }

    return sendJson(res, 200, {
        portalUrl: session.url,
        url: session.url,
        id: session.id,
        offline: !!session.offline,
    });
}

function latestSiteConfig(reg, siteId) {
    const versions = reg.listVersions(siteId) || [];
    if (!versions.length) return {};
    const latest = versions[versions.length - 1];
    return reg.getVersionConfig(siteId, latest.versionId) || {};
}

/**
 * Safe attachment filename from slug or business name (no path chars).
 * Always ends with .html.
 */
function exportHtmlFilename(site, config) {
    const raw =
        (site && site.slug) ||
        (config && config.business && config.business.name) ||
        (config && config.businessName) ||
        'site';
    const base = String(raw)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'site';
    return base + '.html';
}

/**
 * POST /api/draft — persist the browser's current config for export without
 * creating checkout, deploying, or changing a paid site's public state.
 */
async function handleSaveDraft(req, res) {
    const userId = requireAuth(req, res);
    if (!userId) return;

    let body;
    try { body = await parseJson(req, PUBLISH_BODY_MAX); }
    catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

    const { siteId, templateId, config } = body || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return sendJson(res, 422, { error: 'Ciorna nu conține o configurație validă.' });
    }
    const templates = loadTemplates();
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) return sendJson(res, 422, { error: 'Design necunoscut: ' + templateId });

    const reg = getRegistry();
    let site = null;
    if (siteId) {
        site = await reg.getSite(siteId);
        if (!site) return sendJson(res, 404, { error: 'Ciorna nu a fost găsită.' });
        if (site.userId !== userId) return sendJson(res, 403, { error: 'Acces refuzat.' });
        if (site.templateId && site.templateId !== templateId) {
            return sendJson(res, 409, { error: 'Ciorna aparține altui design.' });
        }
    } else {
        const existing = (await reg.listSites(userId)) || [];
        site = existing.slice().reverse().find(s =>
            s && s.status !== 'deleted' && !s.paid && s.templateId === templateId
        ) || null;
        if (!site) {
            let slug = slugify((config.business && config.business.name) || 'site');
            if (!SLUG_RE.test(slug)) slug = 'site-' + crypto.randomBytes(4).toString('hex');
            if (!isSlugAvailable(slug)) {
                slug = (slug.slice(0, 30).replace(/-+$/, '') || 'site') + '-' + crypto.randomBytes(3).toString('hex');
            }
            site = await reg.createSite({
                userId,
                templateId,
                templateVersion: tpl.version,
                slug,
                platform: 'web',
            });
        }
    }

    await reg.saveVersion(site.id, config);
    if (!site.paid) await reg.updateSite(site.id, { status: 'draft', paid: false });
    const updated = await reg.getSite(site.id);
    return sendJson(res, 200, { site: updated });
}

/**
 * Resolve the caller's draft site + latest config (shared by export-html / export-zip).
 * Sends 401/400 itself on failure; returns null when response already written.
 */
async function resolveExportDraft(req, res, query) {
    const userId = requireAuth(req, res);
    if (!userId) return null;

    const reg = getRegistry();
    let site = null;
    const siteIdHint = query && query.get ? query.get('siteId') : null;

    if (siteIdHint) {
        site = await reg.getSite(siteIdHint);
        if (!site || site.userId !== userId) {
            sendJson(res, 400, { error: 'No draft to download.' });
            return null;
        }
    } else {
        const sites = (await reg.listSites(userId)) || [];
        for (let i = sites.length - 1; i >= 0; i--) {
            const s = sites[i];
            if (!s || s.status === 'deleted') continue;
            const versions = reg.listVersions(s.id) || [];
            if (versions.length) {
                site = s;
                break;
            }
        }
        if (!site) {
            sendJson(res, 400, { error: 'No draft to download. Save or publish a draft first.' });
            return null;
        }
    }

    const versions = reg.listVersions(site.id) || [];
    if (!versions.length) {
        sendJson(res, 400, { error: 'No draft to download. Save or publish a draft first.' });
        return null;
    }
    const config = latestSiteConfig(reg, site.id);
    if (!config || typeof config !== 'object' || !Object.keys(config).length) {
        sendJson(res, 400, { error: 'No draft to download.' });
        return null;
    }

    const templateId = site.templateId || 'product-menu';
    const templatePath = path.join(TEMPLATES_DIR, templateId, 'template.html');
    if (!fs.existsSync(templatePath)) {
        sendJson(res, 400, { error: 'No draft to download.' });
        return null;
    }

    return { userId, reg, site, config, templateId };
}

/**
 * GET /api/export-html — download the current draft as a complete static HTML
 * document (build.js renderer). Session required. Not a live publish / deploy.
 *
 * Query: optional siteId (must be owned). Without siteId, uses the user's most
 * recent site that has a saved version.
 *
 * 401 unauthenticated · 400 missing draft · 200 text/html attachment.
 */
async function handleExportHtml(req, res, query) {
    const draft = await resolveExportDraft(req, res, query);
    if (!draft) return;
    const { site, config, templateId } = draft;

    let html;
    try {
        const { exportSiteHtml } = require('./site-export.js');
        html = exportSiteHtml({
            templateId,
            config,
            images: [],
            slug: site.slug || (config.business && config.business.name) || 'site',
        }).html;
    } catch (e) {
        log('server.export_html.render_error', { siteId: site.id, err: e.message }, 'error');
        return sendJson(res, 500, { error: 'Could not build the HTML file.' });
    }

    if (!html || typeof html !== 'string') {
        return sendJson(res, 500, { error: 'Could not build the HTML file.' });
    }

    const filename = exportHtmlFilename(site, config);
    // RFC 5987 filename* + plain filename for broad clients
    const disposition =
        'attachment; filename="' + filename.replace(/"/g, '') + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename);
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': disposition,
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
}

/**
 * GET /api/export-zip — complete static site ZIP (HTML/CSS/JS/images/legal/badge).
 * Session required. Same draft resolution as export-html. Not a live publish.
 * No new commercial lock (VISION Flow 3): any signed-in draft may export.
 */
async function handleExportZip(req, res, query) {
    const draft = await resolveExportDraft(req, res, query);
    if (!draft) return;
    const { site, config, templateId } = draft;

    let result;
    try {
        const { exportSiteZip } = require('./site-export.js');
        result = exportSiteZip({
            templateId,
            config,
            images: [],
            slug: site.slug || (config.business && config.business.name) || 'site',
        });
    } catch (e) {
        log('server.export_zip.error', { siteId: site.id, err: e && e.message }, 'error');
        return sendJson(res, 500, { error: 'Could not build the ZIP export.' });
    }

    if (!result || !result.zip || !Buffer.isBuffer(result.zip)) {
        return sendJson(res, 500, { error: 'Could not build the ZIP export.' });
    }

    const filename = (result.filename || 'site.zip').replace(/"/g, '');
    const disposition =
        'attachment; filename="' + filename + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename);
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': disposition,
        'Content-Length': result.zip.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(result.zip);
}

function persistEmbedUrl(reg, siteId, embedUrl) {
    if (typeof embedUrl !== 'string' || !embedUrl) return latestSiteConfig(reg, siteId);
    const config = latestSiteConfig(reg, siteId);
    if (!config.instagram || typeof config.instagram !== 'object') config.instagram = {};
    config.instagram.embedUrl = embedUrl;
    reg.saveVersion(siteId, config);
    return config;
}

/**
 * Per-site operation generation for social-feed grant/disconnect ordering.
 * Disconnect bumps the counter so an in-flight grant that started earlier
 * cannot re-persist embedUrl after explicit disconnect.
 */
const socialFeedOpGeneration = new Map();

function socialFeedGeneration(siteId) {
    return socialFeedOpGeneration.get(String(siteId)) || 0;
}

function bumpSocialFeedGeneration(siteId) {
    const next = socialFeedGeneration(siteId) + 1;
    socialFeedOpGeneration.set(String(siteId), next);
    return next;
}

/**
 * Persist grant embed only if no disconnect (or newer op) happened since genAtStart.
 * Returns { stale, config }.
 */
function persistEmbedUrlIfCurrent(reg, siteId, embedUrl, genAtStart) {
    const genNow = socialFeedGeneration(siteId);
    if (genNow !== genAtStart) {
        log('server.social_feed.grant.stale_dropped', {
            siteId,
            genAtStart,
            genNow,
        });
        return { stale: true, config: latestSiteConfig(reg, siteId) };
    }
    return { stale: false, config: persistEmbedUrl(reg, siteId, embedUrl) };
}

/** Clear partner embed so disconnect stays authoritative after republish. */
function clearEmbedUrl(reg, siteId) {
    // Authoritative: void any in-flight grant that captured an older generation.
    bumpSocialFeedGeneration(siteId);
    const config = latestSiteConfig(reg, siteId);
    if (!config.instagram || typeof config.instagram !== 'object') {
        config.instagram = {};
    }
    config.instagram.embedUrl = '';
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

/** Isolated + test-pay only: finish Instagram connect without live Instafidget / partner secret. */
function isIsolatedTestSocial() {
    return (
        process.env.HIDOOK_ISOLATED_DEPLOY === '1' &&
        process.env.HIDOOK_TEST_PAY === '1' &&
        process.env.NODE_ENV !== 'production'
    );
}

function isolatedStubEmbedUrl(email) {
    const key = crypto.createHash('sha256')
        .update(String(email || 'isolated') + '|ig-stub')
        .digest('hex')
        .slice(0, 16);
    // Isolated only: never write the live partner host into Detalii-visible embedUrl.
    // Still a non-empty URL so applyEmbedUrl / «Instagram e pe site.» finish cleanly.
    return 'https://isolated.local/social-feed/isolated-' + key;
}

async function requireOwnedSiteWithEmail(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return null;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) {
        sendJson(res, 404, { error: 'Site not found.' });
        return null;
    }
    if (site.userId !== userId) {
        sendJson(res, 403, { error: 'Access denied.' });
        return null;
    }
    const user = await reg.getUser(userId);
    const email = user && typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(res, 400, { error: "Sign in with email to connect Instagram. We don't create a separate account for this." });
        return null;
    }
    const partner = getPartner();
    if (!partner.isConfigured() && !isIsolatedTestSocial()) {
        sendJson(res, 503, { error: 'Instagram connection is not configured on this server.' });
        return null;
    }
    return { reg, site, email, partnerConfigured: partner.isConfigured() };
}

/**
 * POST /api/sites/:id/social-feed/grant
 * Server-to-server Instafidget Year-1 grant. Stores embedUrl on the draft if returned.
 * Isolated/test-pay without partner secret: local stub embed (no live partner call).
 */
async function handleSocialFeedGrant(req, res, siteId) {
    let body;
    try { body = await parseJson(req); } catch (e) {
        return sendJson(res, e.status || 400, { error: e.message || 'Invalid request body.' });
    }
    if (!body || body.acceptedTerms !== true) {
        return sendJson(res, 400, { error: 'Please accept the Instafidget Terms and Privacy Policy.' });
    }
    const ctx = await requireOwnedSiteWithEmail(req, res, siteId);
    if (!ctx) return;

    // Capture before any await so disconnect during partner I/O voids this write.
    const genAtStart = socialFeedGeneration(siteId);

    // Isolated QA path: finish without SITEBUILDER_PARTNER_SECRET / live Instafidget
    if (!ctx.partnerConfigured && isIsolatedTestSocial()) {
        const embedUrl = isolatedStubEmbedUrl(ctx.email);
        const saved = persistEmbedUrlIfCurrent(ctx.reg, siteId, embedUrl, genAtStart);
        if (saved.stale) {
            return sendJson(res, 200, {
                ...publicGrantPayload({ embedUrl: null }),
                disconnected: true,
                stale: true,
            });
        }
        return sendJson(res, 200, publicGrantPayload({
            embedUrl,
            entitlement: 'site_bundle_isolated',
            showWatermark: true,
            siteBundleExpiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
        }));
    }

    let partnerRes;
    try {
        partnerRes = await getPartner().grantYear1(ctx.email);
    } catch (e) {
        if (e && e.code === 'SECRET_MISSING') {
            return sendJson(res, 503, { error: 'Instagram connection is not configured on this server.' });
        }
        log('server.social_feed.grant.error', { siteId, err: e.message }, 'error');
        return sendJson(res, 502, { error: "We couldn't reach Instafidget. Please try again." });
    }

    if (partnerRes.status === 401) {
        return sendJson(res, 502, { error: 'Instafidget refused the connection. Check the server configuration.' });
    }
    if (partnerRes.status === 400) {
        return sendJson(res, 400, { error: 'Instafidget refused the request. Check the Terms and Privacy agreement.' });
    }
    if (partnerRes.status < 200 || partnerRes.status >= 300) {
        return sendJson(res, 502, { error: 'Instafidget could not create the Instagram bonus.' });
    }

    const saved = persistEmbedUrlIfCurrent(
        ctx.reg,
        siteId,
        partnerRes.json && partnerRes.json.embedUrl,
        genAtStart
    );
    if (saved.stale) {
        // Disconnect won the race: do not re-connect from a pre-disconnect grant.
        return sendJson(res, 200, {
            ...publicGrantPayload({
                embedUrl: null,
                entitlement: partnerRes.json && partnerRes.json.entitlement,
                showWatermark: partnerRes.json && partnerRes.json.showWatermark,
                siteBundleExpiresAt: partnerRes.json && partnerRes.json.siteBundleExpiresAt,
            }),
            disconnected: true,
            stale: true,
        });
    }
    sendJson(res, 200, publicGrantPayload(partnerRes.json));
}

/**
 * POST /api/sites/:id/social-feed/editor-session
 * Returns Instafidget editorUrl. Does not change billing.
 * Isolated/test-pay without partner secret: same-origin editor handoff page.
 */
async function handleSocialFeedEditor(req, res, siteId) {
    try { await parseJson(req); } catch (_) { /* empty body ok */ }
    const ctx = await requireOwnedSiteWithEmail(req, res, siteId);
    if (!ctx) return;

    if (!ctx.partnerConfigured && isIsolatedTestSocial()) {
        const editorUrl = requestPublicOrigin(req) + '/app/instafidget-editor.html?siteId=' + encodeURIComponent(siteId);
        return sendJson(res, 200, { editorUrl, isolated: true });
    }

    let partnerRes;
    try {
        partnerRes = await getPartner().editorSession(ctx.email);
    } catch (e) {
        if (e && e.code === 'SECRET_MISSING') {
            return sendJson(res, 503, { error: 'Instagram connection is not configured on this server.' });
        }
        log('server.social_feed.editor.error', { siteId, err: e.message }, 'error');
        return sendJson(res, 502, { error: "We couldn't open the Instagram editor. Please try again." });
    }

    if (partnerRes.status === 401) {
        return sendJson(res, 502, { error: 'Instafidget refused the connection. Check the server configuration.' });
    }
    if (partnerRes.status === 404) {
        return sendJson(res, 404, { error: 'Connect Instagram first (accept the terms, then add Instagram).' });
    }
    if (partnerRes.status === 400) {
        return sendJson(res, 400, { error: "We couldn't open the Instagram editor." });
    }
    if (partnerRes.status < 200 || partnerRes.status >= 300) {
        return sendJson(res, 502, { error: 'Instafidget could not open the editor.' });
    }

    const editorUrl = partnerRes.json && typeof partnerRes.json.editorUrl === 'string'
        ? partnerRes.json.editorUrl
        : null;
    if (!editorUrl) {
        return sendJson(res, 502, { error: 'Instafidget did not return an editor link.' });
    }
    sendJson(res, 200, { editorUrl });
}

/**
 * POST /api/sites/:id/social-feed/disconnect
 * Explicit Disconnect Instagram: clear persisted embedUrl. Does not touch billing.
 */
async function handleSocialFeedDisconnect(req, res, siteId) {
    try { await parseJson(req); } catch (_) { /* empty body ok */ }
    const userId = requireAuth(req, res);
    if (!userId) return;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) {
        return sendJson(res, 404, { error: 'Site not found.' });
    }
    if (site.userId !== userId) {
        return sendJson(res, 403, { error: 'Access denied.' });
    }
    const config = clearEmbedUrl(reg, siteId);
    const embedUrl = config && config.instagram ? String(config.instagram.embedUrl || '') : '';
    sendJson(res, 200, { ok: true, embedUrl: embedUrl || null, disconnected: true });
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
    if (!tpl) return sendJson(res, 422, { error: 'Unknown template: ' + templateId });

    // Validate images
    const MAX_IMAGES   = 12;
    const MAX_DATA_URL = 2.5 * 1024 * 1024;
    const ALLOWED_MIME = /^image\/(jpeg|png|webp)$/;
    const imgList = Array.isArray(images) ? images : [];
    if (imgList.length > MAX_IMAGES) {
        return sendJson(res, 422, { error: `A maximum of ${MAX_IMAGES} images is allowed.` });
    }
    for (const img of imgList) {
        if (!img || !img.dataUrl) continue;
        if (img.dataUrl.length > MAX_DATA_URL * 1.4) {
            return sendJson(res, 422, { error: `Image "${img.name}" exceeds 2.5 MB.` });
        }
        const mimeMatch = /^data:([^;]+);/.exec(img.dataUrl);
        if (!mimeMatch || !ALLOWED_MIME.test(mimeMatch[1])) {
            return sendJson(res, 422, { error: `Image type for "${img.name}" is not supported (jpeg/png/webp).` });
        }
    }

    const reg = getRegistry();
    const price = pricing.getPricingFromRequest(req);

    // Get or create site
    let site;
    if (siteId) {
        site = await reg.getSite(siteId);
        if (!site) return sendJson(res, 404, { error: 'Site not found.' });
        if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    } else {
        // Max 1 unpaid site per user (prevents abuse)
        const existing = await reg.listSites(userId);
        const unpaid = existing.filter((s) => {
            if (s.status === 'deleted') return false;
            const subscriptionStatus = String(s.stripeSubscriptionStatus || s.subscriptionStatus || '').toLowerCase();
            const cancelledDraft =
                s.status === 'unpublished' &&
                (s.canceledAt || subscriptionStatus === 'canceled' || subscriptionStatus === 'cancelled');
            return !s.paid || cancelledDraft;
        });
        if (unpaid.length > 0) {
            return sendJson(res, 409, {
                error: 'Ai deja un site neplătit. Plătește-l sau șterge-l înainte să creezi altul.',
                siteId: unpaid[0].id,
            });
        }

        // Determine slug
        let slug;
        if (slugHint) {
            slug = normalizeSlug(slugHint);
            if (!SLUG_RE.test(slug)) {
                return sendJson(res, 422, { error: 'Invalid slug (3-40 characters, a-z 0-9 -).' });
            }
            if (!isSlugAvailable(slug)) {
                return sendJson(res, 409, { error: 'Această adresă este deja folosită. Încearcă alta.' });
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
            if (e.code === 'MODERATION') return sendJson(res, 422, { error: 'Your images were blocked by moderation.' });
            log('server.publish.paid.error', { siteId: site.id, err: e.message }, 'error');
            const updated = await reg.getSite(site.id);
            return sendJson(res, 500, { error: 'Publish failed: ' + e.message, site: updated });
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
                    productName: 'Hidook Site Builder site activation',
                    successUrl:  publicUrl + '/app/#paid',
                    cancelUrl:   publicUrl + '/app/#cancelled',
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
        return sendJson(res, 500, { error: 'Saving your draft failed: ' + e.message, site: updated });
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
            if ((req.method === 'GET' || req.method === 'HEAD') && url === '/') {
                return sendRedirect(res, '/app/');
            }

            // ── Health ─────────────────────────────────────────────────────
            if ((req.method === 'GET' || req.method === 'HEAD') && url === '/health') {
                if (req.method === 'HEAD') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end();
                }
                return sendJson(res, 200, { ok: true, service: 'hidook-bot', uptimeSec: Math.round(process.uptime()) });
            }

            // ── Operator admin (token-gated; missing/wrong → plain 404) ──
            if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/admin' || url === '/admin/')) {
                if (req.method === 'HEAD') {
                    if (!adminTokenOk(extractAdminToken(req, query))) return sendNotFound(req, res, 'not found');
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                    return res.end();
                }
                return handleAdmin(req, res, query);
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
            if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/live' || url === '/live/' || url.startsWith('/live/'))) {
                return serveLive(req, res, url);
            }

            // ── Builder favicon at the browser-default origin path ──────────
            if ((req.method === 'GET' || req.method === 'HEAD') && url === '/favicon.ico') {
                const target = path.join(BUILDER_DIR, 'favicon.svg');
                return sendCachedFile(req, res, target, fs.statSync(target));
            }

            // ── Static: /app and /app/* ────────────────────────────────────
            // Bare /app (no trailing slash) must redirect so relative assets resolve under /app/.
            if ((req.method === 'GET' || req.method === 'HEAD') && url === '/app') {
                const q = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
                return sendRedirect(res, '/app/' + q);
            }
            if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/app/' || url.startsWith('/app/'))) {
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

            // /api/sites/:id/billing-portal — Cancel → Stripe Customer Portal
            const portalMatch = url.match(/^\/api\/sites\/([^/]+)\/billing-portal$/);
            if (req.method === 'POST' && portalMatch) {
                return await handleSiteBillingPortal(req, res, portalMatch[1]);
            }

            const grantMatch = url.match(/^\/api\/sites\/([^/]+)\/social-feed\/grant$/);
            if (req.method === 'POST' && grantMatch) {
                return await handleSocialFeedGrant(req, res, grantMatch[1]);
            }

            const editorMatch = url.match(/^\/api\/sites\/([^/]+)\/social-feed\/editor-session$/);
            if (req.method === 'POST' && editorMatch) {
                return await handleSocialFeedEditor(req, res, editorMatch[1]);
            }

            const disconnectMatch = url.match(/^\/api\/sites\/([^/]+)\/social-feed\/disconnect$/);
            if (req.method === 'POST' && disconnectMatch) {
                return await handleSocialFeedDisconnect(req, res, disconnectMatch[1]);
            }

            // /api/sites/:id
            const siteMatch = url.match(/^\/api\/sites\/([^/]+)$/);
            if (req.method === 'GET' && siteMatch) {
                return await handleGetSite(req, res, siteMatch[1]);
            }

            if (req.method === 'POST' && url === '/api/publish') {
                return await handlePublish(req, res);
            }

            // Save the current editor draft for export without publish or checkout
            if (req.method === 'POST' && url === '/api/draft') {
                return await handleSaveDraft(req, res);
            }

            // Download current draft as complete static HTML (not a live publish)
            if (req.method === 'GET' && url === '/api/export-html') {
                return await handleExportHtml(req, res, query);
            }

            // Download current draft as self-hostable static ZIP (not a live publish)
            if (req.method === 'GET' && url === '/api/export-zip') {
                return await handleExportZip(req, res, query);
            }

            // Offline test-pay return from /app/#test-checkout=cs_test_* (non-production only)
            if (req.method === 'POST' && url === '/api/test-pay/complete') {
                return await handleTestPayComplete(req, res);
            }

            // Public appointment requests (local isolated store; live slug required)
            if (req.method === 'POST' && url === '/api/appointments') {
                return await handleCreateAppointment(req, res);
            }
            if (req.method === 'GET' && url === '/api/appointments') {
                return await handleListAppointments(req, res, query);
            }

            // Unknown route: browser document → short RO HTML; API → JSON
            if (url.startsWith('/api/') || url.startsWith('/webhooks/')) {
                return sendJson(res, 404, { error: 'not found' });
            }
            return sendNotFound(req, res, 'not found');
        } catch (e) {
            log('server.error', { err: e.message, url }, 'error');
            // Never forward env var names / stack traces to the browser (factory leak).
            const raw = (e && e.message) || 'Internal error.';
            const leaksEnv =
                /SERVER_SECRET|STRIPE_SECRET|STRIPE_WEBHOOK|TELEGRAM_BOT_TOKEN|process\.env|HIDOOK_[A-Z0-9_]+/i.test(raw) ||
                /\bat\s+\S+\s+\([^)]+:\d+:\d+\)/.test(raw);
            const safe = leaksEnv ? 'Internal error.' : raw;
            try { sendJson(res, e.status || 500, { error: safe }); } catch (_) {}
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

module.exports = { startServer, createHandler, readRawBody, requestPublicOrigin };

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
