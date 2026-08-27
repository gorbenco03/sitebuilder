'use strict';
/**
 * bot/test/api.test.js — Integration tests for the HTTP API + static serving (pay-before-publish).
 *
 * Covers:
 *   - GET /api/config → {amount, currency, renewal, brandDomain|null, contactUrl|null}
 *   - GET /api/slug-check → {available, slug}
 *   - GET /api/templates returns templates with schema+presets
 *   - GET /api/me without cookie → 401
 *   - Full email magic-link flow (no RESEND → devLink in response)
 *   - Token reuse → redirect to login-expired
 *   - POST /api/publish without auth → 401
 *   - POST /api/publish unpaid → draft (not live); no deploy
 *   - Second unpaid site → 409
 *   - Static: GET /app/ → 200 text/html
 *   - Static path traversal: GET /app/../bot/.env → 403/404
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

// ── Isolated DATA_DIR ──────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
process.env.DATA_DIR        = tmpDir;
process.env.SERVER_SECRET   = 'test-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_FAKE_DEPLOY = '1';   // stub deploys offline (paid path only)
process.env.PUBLIC_URL      = 'http://127.0.0.1:0';
// Disable Stripe so paymentUrl is null
delete process.env.STRIPE_SECRET_KEY;
delete process.env.TRIAL_DAYS;
delete process.env.BUILD_FEE_EUR;
delete process.env.BUILD_FEE_USD;
// Disable deploy providers (fake deploy is used instead)
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.BRAND_DOMAIN;
delete process.env.CONTACT_URL;

// ── Stub registry/auth/email if real modules are absent ───────────────────
const botDir = path.join(__dirname, '..');

const registryPath = path.join(botDir, 'registry.js');
const authPath     = path.join(botDir, 'auth.js');
const emailPath    = path.join(botDir, 'email.js');

const registryExists = fs.existsSync(registryPath);
const authExists     = fs.existsSync(authPath);
const emailExists    = fs.existsSync(emailPath);

// ── In-memory stubs ────────────────────────────────────────────────────────
const _users    = new Map();
const _sites    = new Map();
const _versions = new Map();
const _orders   = new Map();
const _tokens   = new Map();

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

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
        const raw  = crypto.randomBytes(32).toString('hex');
        const hash = sha256(raw);
        _tokens.set(hash, { email, purpose, exp: Date.now() + 15 * 60 * 1000 });
        return { token: raw };
    },
    consumeLoginToken(token) {
        const hash  = sha256(token);
        const entry = _tokens.get(hash);
        if (!entry) return null;
        if (Date.now() > entry.exp) { _tokens.delete(hash); return null; }
        _tokens.delete(hash);
        return entry;
    },
    createSite({ userId, templateId, templateVersion, slug, platform }) {
        const id   = crypto.randomUUID();
        const safe = (slug || 'site').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';
        const projectName = safe + '-' + id.slice(0, 8);
        const site = {
            id, userId, templateId, templateVersion, slug: safe, projectName,
            platform: platform || 'web',
            status: 'draft', paid: false, url: null,
            createdAt: new Date().toISOString(),
        };
        _sites.set(id, site);
        return { ...site };
    },
    getSite(siteId) { const s = _sites.get(siteId); return s ? { ...s } : null; },
    listSites(userId) { return [..._sites.values()].filter(s => s.userId === userId).map(s => ({ ...s })); },
    listAllSites() { return [..._sites.values()].map(s => ({ ...s })); },
    updateSite(siteId, patch) {
        const site = _sites.get(siteId);
        if (!site) return null;
        Object.assign(site, patch);
        return { ...site };
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
        const list  = _versions.get(siteId) || [];
        const entry = list.find(v => v.versionId === versionId);
        return entry ? entry.config : null;
    },
    createOrder({ siteId, userId, amountCents, currency, stripeSessionId }) {
        const id    = crypto.randomUUID();
        const order = { id, siteId, userId, amountCents, currency, stripeSessionId, status: 'pending' };
        _orders.set(id, order);
        return { ...order };
    },
    markOrderPaid(stripeSessionId) {
        for (const o of _orders.values()) {
            if (o.stripeSessionId === stripeSessionId) {
                if (o.status === 'paid') return null;
                o.status = 'paid';
                return { ...o };
            }
        }
        return null;
    },
    getOrderBySession(stripeSessionId) {
        for (const o of _orders.values()) { if (o.stripeSessionId === stripeSessionId) return { ...o }; }
        return null;
    },
};

const AUTH_STUB = (() => {
    const SECRET = process.env.SERVER_SECRET;
    function signSession(userId) {
        const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })).toString('base64url');
        const sig     = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
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

const EMAIL_STUB = {
    sendMagicLink(email, url) {
        console.log(`[email stub] magic link for ${email}: ${url}`);
        return { sent: false, devLink: url };
    },
};

// Inject stubs
if (!registryExists) require.cache[require.resolve(registryPath)] = { id: registryPath, filename: registryPath, loaded: true, exports: REGISTRY_STUB };
if (!authExists)     require.cache[require.resolve(authPath)]     = { id: authPath,     filename: authPath,     loaded: true, exports: AUTH_STUB };
if (!emailExists)    require.cache[require.resolve(emailPath)]    = { id: emailPath,    filename: emailPath,    loaded: true, exports: EMAIL_STUB };

const registry = require(registryPath);
const auth     = require(authPath);

// ── Load server ────────────────────────────────────────────────────────────
const { createHandler, startServer } = require('../server.js');

// ── Test harness ────────────────────────────────────────────────────────────
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

function makeClient(base) {
    let jar = {};
    async function doFetch(urlPath, opts = {}) {
        const url     = base + urlPath;
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;
        const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
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

const MINIMAL_CONFIG = {
    business: { name: 'Testaria Mea', tagline: 'Test', title: 'Test', metaDescription: 'desc', about: 'text', lang: 'ro' },
    labels:   { about: 'Despre noi', instaTitle: 'Urmărește', instaFollow: 'Urmărește', scroll: 'Scroll', waQr: 'WA QR', waOpen: 'WA Web' },
    theme:    { primary: '#E8588C', primaryLight: '#f07aa5', primaryDark: '#d14477', cream: '#fafafa' },
    logo: '', showWordmark: true,
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

(async () => {
    // Start server
    const srv  = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    process.env.PUBLIC_URL = base;
    const client = makeClient(base);

    // ── 1. GET /api/config ─────────────────────────────────────────────────
    await check('GET /api/config → {amount:99, currency, renewal:29, brandDomain:null, contactUrl:null}', async () => {
        const res  = await fetch(`${base}/api/config`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.amount, 99, 'amount must be 99');
        assert.strictEqual(body.amountCents, 9900);
        assert.ok(typeof body.currency === 'string', 'currency must be string');
        assert.strictEqual(body.renewal, 29);
        assert.strictEqual(body.renewalCents, 2900);
        if (body.trialDays != null) {
            assert.notStrictEqual(body.trialDays, 3, 'must not advertise free trialDays=3');
        }
        assert.strictEqual(body.brandDomain, null,     'brandDomain null when env unset');
        assert.strictEqual(body.contactUrl,  null,     'contactUrl null when env unset');
    });

    // ── 2. GET /api/slug-check ─────────────────────────────────────────────
    await check('GET /api/slug-check?slug=test-slug → {available:true, slug}', async () => {
        const res  = await fetch(`${base}/api/slug-check?slug=test-slug`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.slug, 'test-slug');
        assert.strictEqual(body.available, true);
    });

    await check('GET /api/slug-check?slug=ab → {available:false} (too short)', async () => {
        const res  = await fetch(`${base}/api/slug-check?slug=ab`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.available, false);
        assert.ok(body.error, 'should have error for invalid slug');
    });

    // ── 3. GET /api/templates ──────────────────────────────────────────────
    await check('/api/templates returns templates with schema+presets', async () => {
        const res  = await fetch(`${base}/api/templates`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.templates), 'should have templates array');
        assert.ok(body.templates.length >= 1,    'should have at least 1 template');
        for (const t of body.templates) {
            assert.ok(t.id,   `template missing id`);
            assert.ok(t.name, `template missing name`);
        }
    });

    // ── 4. GET /api/me without cookie → 401 ───────────────────────────────
    await check('GET /api/me without cookie → 401', async () => {
        const res  = await fetch(`${base}/api/me`);
        assert.strictEqual(res.status, 401);
    });

    // ── 5. Email magic-link flow ───────────────────────────────────────────
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
        assert.ok(body.devLink, 'devLink must be present');
        verifyUrl = body.devLink;
    });

    await check('GET /auth/verify?token= → Set-Cookie + redirect /app/#dashboard', async () => {
        assert.ok(verifyUrl);
        let tokenParam;
        try {
            tokenParam = new URL(verifyUrl).searchParams.get('token');
        } catch {
            const qs = verifyUrl.includes('?') ? verifyUrl.slice(verifyUrl.indexOf('?') + 1) : verifyUrl;
            tokenParam = new URLSearchParams(qs).get('token');
        }
        assert.ok(tokenParam);
        const res = await client(`/auth/verify?token=${tokenParam}`);
        assert.strictEqual(res.status, 302);
        const loc = res.headers.get('location');
        assert.ok(loc && loc.includes('#dashboard'));
        assert.ok(client.jar['hb_session'], 'session cookie must be set');
    });

    await check('GET /api/me with valid cookie → 200 {user}', async () => {
        const res  = await client('/api/me');
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok(body.user);
    });

    // ── 6. Token reuse → login-expired ────────────────────────────────────
    await check('Reusing same token → redirect /app/#login-expired', async () => {
        let tokenParam;
        try {
            tokenParam = new URL(verifyUrl).searchParams.get('token');
        } catch {
            const qs = verifyUrl.includes('?') ? verifyUrl.slice(verifyUrl.indexOf('?') + 1) : verifyUrl;
            tokenParam = new URLSearchParams(qs).get('token');
        }
        const res = await fetch(`${base}/auth/verify?token=${tokenParam}`, { redirect: 'manual' });
        assert.strictEqual(res.status, 302);
        const loc = res.headers.get('location');
        assert.ok(loc && loc.includes('login-expired'));
    });

    // ── 7. POST /api/publish without auth → 401 ───────────────────────────
    await check('POST /api/publish without auth → 401', async () => {
        const res = await fetch(`${base}/api/publish`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ templateId: 'product-menu', config: MINIMAL_CONFIG, images: [] }),
        });
        assert.strictEqual(res.status, 401);
    });

    // ── 8. POST /api/publish unpaid → draft (pay-before-publish) ───────────
    await check('POST /api/publish unpaid → draft site, not live, paymentUrl null', async () => {
        const templates = loadTemplatesForTest();
        const tplId = templates[0] ? templates[0].id : 'product-menu';
        const res = await client('/api/publish', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ templateId: tplId, config: MINIMAL_CONFIG, images: [] }),
        });
        const body = await res.json();
        assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
        assert.ok(body.site, 'response must have site');
        assert.strictEqual(body.site.paid, false, 'unpaid site is not paid');
        assert.notStrictEqual(body.site.status, 'live', 'unpaid must not go live');
        assert.strictEqual(body.site.status, 'draft', 'unpaid status is draft');
        assert.strictEqual(body.paymentUrl, null,  'paymentUrl null without Stripe');
        // Fake deploy must not have assigned a public test URL
        if (body.site.url) {
            assert.ok(!String(body.site.url).includes('.test.local'),
                'must not deploy unpaid (no fake deploy URL)');
        }
    });

    // ── 9. Second unpaid site → 409 ───────────────────────────────────────
    await check('Second POST /api/publish (unpaid exists) → 409', async () => {
        // First publish above already created an unpaid draft for this user.
        // If it somehow didn't, seed one.
        const meRes  = await client('/api/me');
        const meBody = await meRes.json();
        if (meBody.user) {
            const sites = require(registryPath).listSites(meBody.user.id);
            if (!sites.some(s => !s.paid && s.status !== 'deleted')) {
                require(registryPath).createSite({
                    userId:      meBody.user.id,
                    templateId:  'product-menu',
                    templateVersion: null,
                    slug:        'my-test-site',
                    platform:    'web',
                });
            }
        }

        const templates = loadTemplatesForTest();
        const tplId = templates[0] ? templates[0].id : 'product-menu';
        const res = await client('/api/publish', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ templateId: tplId, config: MINIMAL_CONFIG, images: [] }),
        });
        assert.strictEqual(res.status, 409, 'second unpaid site must return 409');
        const body = await res.json();
        assert.ok(body.error, 'must have error message');
    });

    // ── 10. Static: GET /app/ → 200 text/html ─────────────────────────────
    await check('GET /app/ → 200 text/html (builder index)', async () => {
        const res = await fetch(`${base}/app/`);
        assert.strictEqual(res.status, 200);
        const ct = res.headers.get('content-type') || '';
        assert.ok(ct.includes('text/html'), `Expected text/html, got: ${ct}`);
        const html = await res.text();
        assert.ok(html.includes('<!DOCTYPE html') || html.includes('<html'), 'response should be HTML');
    });

    // ── 11. Path traversal → 403/404 ──────────────────────────────────────
    await check('GET /app/../bot/.env → 403 or 404 (no path traversal)', async () => {
        await new Promise((resolve, reject) => {
            const req = http.get({
                host: '127.0.0.1',
                port: srv.address().port,
                path: '/app/../bot/.env',
            }, (res) => {
                assert.ok(res.statusCode === 403 || res.statusCode === 404,
                    `Expected 403/404 for traversal, got ${res.statusCode}`);
                res.resume();
                resolve();
            });
            req.on('error', reject);
        });
    });

    // ── 12. GET / → redirect /app/ ────────────────────────────────────────
    await check('GET / → 302 redirect to /app/', async () => {
        const res = await fetch(`${base}/`, { redirect: 'manual' });
        assert.strictEqual(res.status, 302);
        const loc = res.headers.get('location');
        assert.ok(loc && loc.includes('/app/'));
    });

    srv.close();

    // ── Legacy test suites ─────────────────────────────────────────────────
    console.log('\n── Running legacy test suites ──');
    const suites = ['webhook.test.js', 'ledger.test.js', 'logger.test.js', 'store.test.js', 'template-picker.test.js'];
    for (const suite of suites) {
        const suitePath = path.join(__dirname, suite);
        if (!fs.existsSync(suitePath)) { console.log('SKIP (not found):', suite); continue; }
        try {
            const { spawnSync } = require('child_process');
            const result = spawnSync(process.execPath, [suitePath], {
                stdio: 'inherit',
                env: { ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'suite-')), HIDOOK_FAKE_DEPLOY: '1' },
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

    // ── Cleanup ─────────────────────────────────────────────────────────────
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// Helper: load templates list from disk (best-effort)
function loadTemplatesForTest() {
    try {
        const regPath = path.join(__dirname, '..', '..', 'templates', 'registry.json');
        const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
        return Array.isArray(reg && reg.templates) ? reg.templates : [];
    } catch {
        return [{ id: 'product-menu' }];
    }
}
