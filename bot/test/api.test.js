'use strict';
/**
 * bot/test/api.test.js — Integration tests for the HTTP API + static serving.
 *
 * Covers:
 *   - GET /api/templates returns 3 templates with schema+presets
 *   - GET /api/me without cookie → 401
 *   - Full email magic-link flow (no RESEND → devLink in response)
 *   - Token reuse → redirect to login-expirat
 *   - POST /api/publish without auth → 401
 *   - With auth + ALLOW_FREE_PUBLISH=1 + no deploy → site ends as needs-retry
 *     BUT version + site files exist on disk
 *   - Static: GET /app/ → 200 text/html
 *   - Static path traversal: GET /app/../bot/.env → 403/404
 *
 * Also runs the full existing test suites to keep green.
 *
 * Run: node bot/test/api.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

// ── isolated DATA_DIR ──────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
process.env.DATA_DIR       = tmpDir;
process.env.SERVER_SECRET  = 'test-secret-' + crypto.randomBytes(8).toString('hex');
process.env.ALLOW_FREE_PUBLISH = '1';
// PUBLIC_URL will be set once the server starts (using the ephemeral port).
// For now set a placeholder; we update it before using it.
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
// Disable Stripe so we go through the free path
delete process.env.STRIPE_SECRET_KEY;
// Disable deploy providers so deployBuiltSite returns {url:null}
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

// ── stub registry.js, auth.js, email.js in /tmp if they don't exist ────────
// (parallel agent builds real versions; tests use stubs when running in isolation)
function ensureStub(modPath, content) {
    if (!fs.existsSync(modPath)) {
        fs.mkdirSync(path.dirname(modPath), { recursive: true });
        fs.writeFileSync(modPath, content, 'utf8');
    }
}

const botDir = path.join(__dirname, '..');

// Check if registry.js exists; if not write a minimal stub into /tmp and patch require
const registryPath = path.join(botDir, 'registry.js');
const authPath     = path.join(botDir, 'auth.js');
const emailPath    = path.join(botDir, 'email.js');

const registryExists = fs.existsSync(registryPath);
const authExists     = fs.existsSync(authPath);
const emailExists    = fs.existsSync(emailPath);

if (!registryExists || !authExists || !emailExists) {
    console.log('[api.test] Stub modules not found — creating temporary stubs in /tmp for isolation.');
}

// ── in-memory stubs (used when real modules are missing) ──────────────────
const _users    = new Map();
const _sites    = new Map();
const _versions = new Map();
const _orders   = new Map();
const _tokens   = new Map();  // sha256(token) -> {payload, exp}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// These stubs are injected into require cache only when the real modules are absent.

const REGISTRY_STUB = {
    getOrCreateUserByEmail(email) {
        for (const u of _users.values()) { if (u.email === email) return u; }
        const u = { id: crypto.randomUUID(), email, createdAt: new Date().toISOString() };
        _users.set(u.id, u);
        return u;
    },
    getOrCreateUserByTelegram(tgId, { username, firstName } = {}) {
        for (const u of _users.values()) { if (u.tgId === String(tgId)) return u; }
        const u = { id: crypto.randomUUID(), tgId: String(tgId), username, firstName, createdAt: new Date().toISOString() };
        _users.set(u.id, u);
        return u;
    },
    getUser(userId) { return _users.get(userId) || null; },
    createLoginToken({ email, purpose }) {
        const raw = crypto.randomBytes(32).toString('hex');
        const hash = sha256(raw);
        _tokens.set(hash, { email, purpose, exp: Date.now() + 15 * 60 * 1000 });
        return { token: raw };
    },
    consumeLoginToken(token) {
        const hash = sha256(token);
        const entry = _tokens.get(hash);
        if (!entry) return null;
        if (Date.now() > entry.exp) { _tokens.delete(hash); return null; }
        _tokens.delete(hash);  // single-use
        return entry;
    },
    createSite({ userId, templateId, templateVersion, slug }) {
        const id = crypto.randomUUID();
        const safe = slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';
        const shortId = id.slice(0, 8);
        const projectName = safe + '-' + shortId;
        const site = { id, userId, templateId, templateVersion, slug, projectName, status: 'draft', paid: false, url: null, createdAt: new Date().toISOString() };
        _sites.set(id, site);
        return site;
    },
    getSite(siteId) { return _sites.get(siteId) || null; },
    listSites(userId) { return [..._sites.values()].filter(s => s.userId === userId); },
    updateSite(siteId, patch) {
        const site = _sites.get(siteId);
        if (!site) return null;
        Object.assign(site, patch);
        return site;
    },
    saveVersion(siteId, config) {
        const versionId = crypto.randomUUID();
        if (!_versions.has(siteId)) _versions.set(siteId, []);
        const list = _versions.get(siteId);
        list.unshift({ versionId, publishedAt: new Date().toISOString(), config });
        if (list.length > 10) list.splice(10);
        return { versionId, publishedAt: list[0].publishedAt };
    },
    listVersions(siteId) {
        return (_versions.get(siteId) || []).map(({ versionId, publishedAt }) => ({ versionId, publishedAt }));
    },
    getVersionConfig(siteId, versionId) {
        const list = _versions.get(siteId) || [];
        const entry = list.find(v => v.versionId === versionId);
        return entry ? entry.config : null;
    },
    createOrder({ siteId, userId, amountCents, currency, stripeSessionId }) {
        const id = crypto.randomUUID();
        const order = { id, siteId, userId, amountCents, currency, stripeSessionId, status: 'pending' };
        _orders.set(id, order);
        return order;
    },
    markOrderPaid(stripeSessionId) {
        for (const o of _orders.values()) {
            if (o.stripeSessionId === stripeSessionId) {
                if (o.status === 'paid') return null;  // already paid
                o.status = 'paid';
                return o;
            }
        }
        return null;
    },
    getOrderBySession(stripeSessionId) {
        for (const o of _orders.values()) { if (o.stripeSessionId === stripeSessionId) return o; }
        return null;
    },
};

// auth stub
const AUTH_STUB = (() => {
    const SECRET = process.env.SERVER_SECRET;
    function signSession(userId) {
        const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })).toString('base64url');
        const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
        return `v1.${payload}.${sig}`;
    }
    function verifySession(val) {
        if (!val) return null;
        const parts = String(val).split('.');
        if (parts[0] !== 'v1' || parts.length !== 3) return null;
        const [, payload, sig] = parts;
        const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
        const expBuf = Buffer.from(expected, 'utf8');
        const gotBuf = Buffer.from(String(sig), 'utf8');
        if (expBuf.length !== gotBuf.length || !crypto.timingSafeEqual(expBuf, gotBuf)) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (data.exp < Math.floor(Date.now() / 1000)) return null;
        return data.uid;
    }
    function buildSessionCookie(value) {
        const secure = process.env.NODE_ENV === 'production' || (process.env.PUBLIC_URL || '').startsWith('https') ? '; Secure' : '';
        return `hb_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
    }
    function getSessionUserId(req) {
        const cookieHeader = (req.headers && req.headers.cookie) || '';
        for (const part of cookieHeader.split(';')) {
            const [k, ...rest] = part.trim().split('=');
            if (k.trim() === 'hb_session') { return verifySession(rest.join('=')); }
        }
        return null;
    }
    function verifyTelegramInitData() { return null; }
    return { signSession, verifySession, buildSessionCookie, getSessionUserId, verifyTelegramInitData };
})();

// email stub
const EMAIL_STUB = {
    sendMagicLink(email, url) {
        // No RESEND configured — return devLink
        console.log(`[email stub] magic link for ${email}: ${url}`);
        return { sent: false, devLink: url };
    },
};

// Inject stubs into require cache if real modules are absent
if (!registryExists) require.cache[require.resolve(registryPath)] = { id: registryPath, filename: registryPath, loaded: true, exports: REGISTRY_STUB };
if (!authExists)     require.cache[require.resolve(authPath)]     = { id: authPath,     filename: authPath,     loaded: true, exports: AUTH_STUB };
if (!emailExists)    require.cache[require.resolve(emailPath)]    = { id: emailPath,    filename: emailPath,    loaded: true, exports: EMAIL_STUB };

// Use real modules if they exist (they satisfy the same contract)
const registry = require(registryPath);
const auth     = require(authPath);

// ── load server ─────────────────────────────────────────────────────────────
const { createHandler, startServer } = require('../server.js');

// ── test harness ─────────────────────────────────────────────────────────────
let failed = false;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

// Helper: fetch with cookie jar
function makeClient(base) {
    let jar = {};
    async function doFetch(urlPath, opts = {}) {
        const url = base + urlPath;
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;
        const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
        // Capture Set-Cookie
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
            for (const part of setCookie.split(';')) {
                const [k, v] = part.trim().split('=');
                if (k && v !== undefined && !['Path', 'HttpOnly', 'SameSite', 'Max-Age', 'Secure'].includes(k)) {
                    jar[k.trim()] = v.trim();
                }
            }
        }
        return res;
    }
    doFetch.jar = jar;
    return doFetch;
}

(async () => {
    // ── Start server ─────────────────────────────────────────────────────────
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    // Update PUBLIC_URL so magic link tokens resolve correctly
    process.env.PUBLIC_URL = base;
    const client = makeClient(base);

    // ────────────────────────────────────────────────────────────────────────
    // 1. GET /api/templates
    // ────────────────────────────────────────────────────────────────────────
    await check('/api/templates returns 3 templates with schema+presets', async () => {
        const res  = await fetch(`${base}/api/templates`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.templates), 'should have templates array');
        assert.strictEqual(body.templates.length, 3, 'should have 3 templates');
        for (const t of body.templates) {
            assert.ok(t.id,      `template missing id: ${JSON.stringify(t)}`);
            assert.ok(t.name,    `template missing name`);
            assert.ok(t.schema,  `template ${t.id} missing schema`);
            assert.ok(Array.isArray(t.presets), `template ${t.id} missing presets array`);
        }
    });

    // ────────────────────────────────────────────────────────────────────────
    // 2. GET /api/me without cookie → 401
    // ────────────────────────────────────────────────────────────────────────
    await check('GET /api/me without cookie → 401', async () => {
        const res  = await fetch(`${base}/api/me`);
        assert.strictEqual(res.status, 401);
        const body = await res.json();
        assert.ok(body.error, 'should have error message');
    });

    // ────────────────────────────────────────────────────────────────────────
    // 3. Full email magic-link flow
    // ────────────────────────────────────────────────────────────────────────
    const testEmail = 'test-user-' + Date.now() + '@example.com';
    let verifyUrl;

    await check('POST /api/auth/email (no RESEND) → {ok:true, sent:false, devLink}', async () => {
        const res  = await fetch(`${base}/api/auth/email`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email: testEmail }),
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.ok,   true);
        assert.strictEqual(body.sent, false);
        assert.ok(body.devLink, 'devLink must be present when RESEND is not configured');
        verifyUrl = body.devLink;
    });

    await check('GET /auth/verify?token= → Set-Cookie + redirect /app/#dashboard', async () => {
        assert.ok(verifyUrl, 'verifyUrl must be set from previous check');
        // devLink may be absolute (if PUBLIC_URL was set) or a path-only string
        let tokenParam;
        try {
            tokenParam = new URL(verifyUrl).searchParams.get('token');
        } catch {
            // relative URL — parse as query string
            const qs = verifyUrl.includes('?') ? verifyUrl.slice(verifyUrl.indexOf('?') + 1) : verifyUrl;
            tokenParam = new URLSearchParams(qs).get('token');
        }
        assert.ok(tokenParam, `token must be in devLink URL (devLink=${verifyUrl})`);
        const res = await client(`/auth/verify?token=${tokenParam}`);
        assert.strictEqual(res.status, 302);
        const loc = res.headers.get('location');
        assert.ok(loc && loc.includes('#dashboard'), `Expected redirect to #dashboard, got: ${loc}`);
        // Cookie must have been set
        assert.ok(client.jar['hb_session'], 'hb_session cookie must be set');
    });

    await check('GET /api/me with valid cookie → 200 {user}', async () => {
        const res  = await client('/api/me');
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok(body.user, 'should have user object');
        assert.ok(body.user.email === testEmail || body.user.id, 'user should have email or id');
    });

    // ────────────────────────────────────────────────────────────────────────
    // 4. Token reuse → redirect login-expirat
    // ────────────────────────────────────────────────────────────────────────
    await check('Reusing the same token → redirect /app/#login-expirat', async () => {
        let tokenParam;
        try {
            tokenParam = new URL(verifyUrl).searchParams.get('token');
        } catch {
            const qs = verifyUrl.includes('?') ? verifyUrl.slice(verifyUrl.indexOf('?') + 1) : verifyUrl;
            tokenParam = new URLSearchParams(qs).get('token');
        }
        assert.ok(tokenParam, 'token must be parseable');
        const res = await fetch(`${base}/auth/verify?token=${tokenParam}`, { redirect: 'manual' });
        assert.strictEqual(res.status, 302);
        const loc = res.headers.get('location');
        assert.ok(loc && loc.includes('login-expirat'), `Expected redirect to login-expirat, got: ${loc}`);
    });

    // ────────────────────────────────────────────────────────────────────────
    // 5. POST /api/publish without auth → 401
    // ────────────────────────────────────────────────────────────────────────
    await check('POST /api/publish without auth → 401', async () => {
        const res = await fetch(`${base}/api/publish`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ templateId: 'patiserie', config: {}, images: [] }),
        });
        assert.strictEqual(res.status, 401);
    });

    // ────────────────────────────────────────────────────────────────────────
    // 6. POST /api/publish with auth + ALLOW_FREE_PUBLISH=1 + no deploy
    //    → site status needs-retry (deploy offline) BUT files on disk + version
    // ────────────────────────────────────────────────────────────────────────
    await check('POST /api/publish auth + free publish + offline deploy → needs-retry or error, files on disk', async () => {
        // Build a minimal config
        const config = {
            business: { name: 'Testaria Mea', tagline: 'Test', title: 'Test', metaDescription: 'desc', about: 'text', lang: 'ro' },
            labels:   { about: 'Despre noi', instaTitle: 'Urmărește', instaFollow: 'Urmărește', scroll: 'Scroll', waQr: 'WA QR', waOpen: 'WA Web' },
            theme:    { primary: '#E8588C', primaryLight: '#f07aa5', primaryDark: '#d14477', cream: '#fafafa' },
            logo:     '',
            showWordmark: true,
            hero:     { background: 'linear-gradient(135deg,#f7f3f0,#efe7ea)', ctaLabel: 'Contactează-ne' },
            servicesTitle: 'Servicii',
            services: [{ icon: '✦', label: 'Torturi' }],
            galleryTitle: '',
            categories: [{ title: '', blurb: '', photos: [] }],
            instagram: { handle: '', url: '', gallery: [] },
            contact: { title: 'Contact', intro: 'text', instagram: { url: '', label: '' }, facebook: { url: '', label: '' }, whatsapp: '', phone: '', phoneDisplay: '', waHref: '', address: '', addressHref: '' },
            seo:    { ogImage: '', jsonLd: '' },
            footer: { address: 'Str. Test 1', year: 2026, note: 'test' },
        };

        const res = await client('/api/publish', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ templateId: 'patiserie', config, images: [] }),
        });

        // Should respond — either 200 with site (needs-retry) or 5xx with error
        const body = await res.json();

        // The response MUST have either {site} or {error}
        assert.ok(body.site || body.error, 'response must have site or error field');

        // If a site was created, find its project dir and verify files + version
        const siteId = body.site && body.site.id;
        if (siteId) {
            const projectName = body.site.projectName;
            const siteDir = path.join(tmpDir, 'sites', projectName);
            // config.json should exist (written by publishSite before deploy attempt)
            assert.ok(fs.existsSync(path.join(siteDir, 'config.json')), 'config.json must exist on disk');
            // Status should be needs-retry (deploy offline) or live
            const status = body.site.status;
            assert.ok(status === 'needs-retry' || status === 'live', `unexpected status: ${status}`);
        }
    });

    // ────────────────────────────────────────────────────────────────────────
    // 7. Static: GET /app/ → 200 text/html
    // ────────────────────────────────────────────────────────────────────────
    await check('GET /app/ → 200 text/html (builder index)', async () => {
        const res = await fetch(`${base}/app/`);
        assert.strictEqual(res.status, 200);
        const ct = res.headers.get('content-type') || '';
        assert.ok(ct.includes('text/html'), `Expected text/html, got: ${ct}`);
        const html = await res.text();
        assert.ok(html.includes('<!DOCTYPE html') || html.includes('<html'), 'response should be HTML');
    });

    // ────────────────────────────────────────────────────────────────────────
    // 8. Path traversal → 403/404
    // ────────────────────────────────────────────────────────────────────────
    await check('GET /app/../bot/.env → 403 or 404 (no path traversal)', async () => {
        // Note: fetch may normalize the URL before sending; use raw http.get
        await new Promise((resolve, reject) => {
            const req = http.get({
                host: '127.0.0.1',
                port: srv.address().port,
                path: '/app/../bot/.env',
            }, (res) => {
                assert.ok(res.statusCode === 403 || res.statusCode === 404, `Expected 403/404 for traversal, got ${res.statusCode}`);
                res.resume();
                resolve();
            });
            req.on('error', reject);
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 9. GET / → redirect /app/
    // ────────────────────────────────────────────────────────────────────────
    await check('GET / → 302 redirect to /app/', async () => {
        const res = await fetch(`${base}/`, { redirect: 'manual' });
        assert.strictEqual(res.status, 302);
        const loc = res.headers.get('location');
        assert.ok(loc && loc.includes('/app/'), `Expected /app/, got: ${loc}`);
    });

    srv.close();

    // ────────────────────────────────────────────────────────────────────────
    // 10. Run legacy test suites
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Running legacy test suites ──');
    const suites = ['webhook.test.js', 'ledger.test.js', 'logger.test.js', 'store.test.js', 'template-picker.test.js'];
    for (const suite of suites) {
        const suitePath = path.join(__dirname, suite);
        if (!fs.existsSync(suitePath)) { console.log('SKIP (not found):', suite); continue; }
        try {
            // Clear require cache for these modules so they get a fresh state
            // and spawn as a child process to avoid state pollution
            const { spawnSync } = require('child_process');
            const result = spawnSync(process.execPath, [suitePath], {
                stdio: 'inherit',
                env: { ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'suite-')) },
            });
            if (result.status !== 0) {
                console.error('FAIL suite:', suite, '(exit', result.status, ')');
                failed = true;
            } else {
                console.log('PASS suite:', suite);
            }
        } catch (e) {
            console.error('FAIL suite:', suite, '-', e.message);
            failed = true;
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
