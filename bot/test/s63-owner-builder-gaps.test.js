'use strict';
/**
 * bot/test/s63-owner-builder-gaps.test.js — S63 owner-reported builder gaps (server halves).
 *
 * Form editor removed 2026-10-28: the editor-side locks (openInstagramModal auth path,
 * buildImgMap, edit-overlay hero/menu matchers, onListAdd) and the causal-RED checks on the
 * old parent commit covered only deleted surfaces and were dropped. What stays:
 *   - hero background + gallery image + an added menu section/item survive unpaid draft ->
 *     test-pay -> /live (old template, wire payload built by a local fixture)
 *   - an authenticated unpaid draft can be created and the social-feed grant answers (not 401)
 *
 * Env: HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted
 * Run: node bot/test/s63-owner-builder-gaps.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's63-owner-gaps-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s63-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.BRAND_DOMAIN;
delete process.env.CONTACT_URL;
delete process.env.RESEND_API_KEY;
delete process.env.NODE_ENV;

const payments   = require('../payments.js');
const pricing    = require('../pricing.js');
const webpublish = require('../webpublish.js');
const registry   = require('../registry.js');
const { startServer } = require('../server.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

function makeClient(base) {
    const jar = {};
    async function doFetch(urlPath, opts = {}) {
        const url     = base + urlPath;
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;
        const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
        for (const sc of setCookie) {
            if (!sc) continue;
            const first = sc.split(';')[0];
            const eq = first.indexOf('=');
            if (eq < 0) continue;
            const k = first.slice(0, eq).trim();
            const v = first.slice(eq + 1).trim();
            if (k) jar[k] = v;
        }
        return res;
    }
    doFetch.jar = jar;
    return doFetch;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForStatus(base, urlPath, wantStatus, { timeoutMs = 20000, intervalMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const res = await fetch(base + urlPath, { redirect: 'manual' });
        last = res.status;
        if (res.status === wantStatus) return res;
        await sleep(intervalMs);
    }
    throw new Error(`timeout waiting for ${urlPath} → ${wantStatus} (last ${last})`);
}

const PNG_A = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);
const PNG_B = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);
function dataUrlPng(buf) {
    return 'data:image/png;base64,' + buf.toString('base64');
}

function loadPresetConfig(templateId) {
    const presetsPath = path.join(ROOT, 'templates', templateId, 'presets.json');
    assert.ok(fs.existsSync(presetsPath), `presets.json missing for ${templateId}`);
    const body = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    const presets = body.presets || [];
    assert.ok(presets.length >= 1, `${templateId} must have ≥1 preset`);
    const cfg = JSON.parse(JSON.stringify(presets[0].config));
    assert.ok(cfg && cfg.business, `${templateId} preset must have business`);
    return { presetId: presets[0].id, config: cfg };
}

/**
 * Wire-format fixture: {cleanConfig, images:[{name,dataUrl}]} as a client posts to /api/publish
 * (data URLs pulled out of the config and rewritten to images/…).
 */
function extractImages(config) {
  const images = [];
  const clean = JSON.parse(JSON.stringify(config));
  const DATA_URL_RE = /data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+/gi;

  function extOf(dataUrl) {
    const m = /^data:image\/(jpeg|jpg|png|webp)/i.exec(dataUrl || '');
    if (!m) return 'jpg';
    const t = m[1].toLowerCase();
    return t === 'jpeg' ? 'jpg' : t;
  }

  function isCssish(key, val) {
    return /background|style|gradient/i.test(key || '') ||
      /url\s*\(/i.test(val || '') ||
      /linear-gradient/i.test(val || '');
  }

  function allocate(key, dataUrl) {
    const ext = extOf(dataUrl);
    const k = String(key || '');
    if (k === 'logo' || /logo/i.test(k)) {
      return { name: 'logo', file: 'logo.' + ext };
    }
    if (/background/i.test(k) || /^hero$/i.test(k)) {
      const n = images.filter((x) => String(x.name).startsWith('hero')).length + 1;
      const name = n === 1 ? 'hero' : 'hero-' + n;
      return { name, file: name + '.' + ext };
    }
    const n = images.filter((x) => String(x.name).startsWith('gallery')).length + 1;
    const name = 'gallery-' + n;
    return { name, file: name + '.' + ext };
  }

  function takeDataUrl(raw) {
    return String(raw || '').replace(/\s+/g, '');
  }

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string') {
        walk(v);
        continue;
      }

      // Pure data-URL field (logo, photo src, etc.)
      if (v.startsWith('data:image/')) {
        const dataUrl = takeDataUrl(v);
        const { name, file } = allocate(k, dataUrl);
        images.push({ name, dataUrl });
        const local = 'images/' + file;
        obj[k] = isCssish(k, v) ? "url('" + local + "')" : local;
        continue;
      }

      // CSS / mixed strings with url(data:image...) (hero.background)
      if (v.includes('data:image/')) {
        let next = v;
        const found = v.match(DATA_URL_RE) || [];
        for (const raw of found) {
          const dataUrl = takeDataUrl(raw);
          const { name, file } = allocate(k, dataUrl);
          images.push({ name, dataUrl });
          const local = 'images/' + file;
          next = next.split(raw).join(local);
        }
        obj[k] = next;
        continue;
      }

      walk(v);
    }
  }
  walk(clean);
  return { cleanConfig: clean, images };
}

function runExtractImages(config) {
  return extractImages(JSON.parse(JSON.stringify(config)));
}

/** Config fixture: add a menu section / dish the way the old form editor shaped them. */
function simulateMenuListAdd(config, listPath) {
    const c = JSON.parse(JSON.stringify(config));
    function getPath(obj, p) {
        return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);
    }
    function setPath(obj, p, val) {
        const parts = p.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
            cur = cur[k];
        }
        cur[parts[parts.length - 1]] = val;
    }
    const arr = Array.isArray(getPath(c, listPath)) ? getPath(c, listPath).slice() : [];
    let newItem;
    if (/^menu\.(en|ro)$/.test(listPath)) {
        if (!c.menu || typeof c.menu !== 'object') c.menu = { title: 'Menu', en: [], ro: [] };
        newItem = { category: 'New section', items: ['New item'] };
    } else if (/^menu\.(en|ro)\.\d+\.items$/.test(listPath)) {
        newItem = 'New item';
    } else {
        newItem = '';
    }
    arr.push(newItem);
    setPath(c, listPath, arr);
    const mLang = /^menu\.(en|ro)$/.exec(listPath);
    if (mLang && c.menu) {
        const other = mLang[1] === 'en' ? 'ro' : 'en';
        const otherPath = 'menu.' + other;
        const otherArr = Array.isArray(getPath(c, otherPath)) ? getPath(c, otherPath).slice() : [];
        if (otherArr.length === arr.length - 1) {
            otherArr.push(JSON.parse(JSON.stringify(newItem)));
            setPath(c, otherPath, otherArr);
        }
    }
    return c;
}

async function loginClient(base, email) {
    const c = makeClient(base);
    const loginRes = await fetch(`${base}/api/auth/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginBody = await loginRes.json();
    let token;
    try {
        token = new URL(loginBody.devLink).searchParams.get('token');
    } catch {
        const qs = loginBody.devLink.includes('?')
            ? loginBody.devLink.slice(loginBody.devLink.indexOf('?') + 1)
            : '';
        token = new URLSearchParams(qs).get('token');
    }
    const v = await c(`/auth/verify?token=${encodeURIComponent(token)}`);
    assert.strictEqual(v.status, 302);
    return c;
}

(async () => {
    await check('HIDOOK_FAKE_DEPLOY not set (isolated + test-pay)', () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
    });

    // ── Isolated HTTP: hero + gallery image + menu section/item → live ─────
    async function onStripeEvent(event) {
        const cs = event && event.data && event.data.object;
        const platform = cs && cs.metadata && cs.metadata.platform;
        if (platform === 'web' || (cs && cs.metadata && cs.metadata.siteId)) {
            await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });
        }
    }

    const srv = startServer({ port: 0, onStripeEvent });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    process.env.PUBLIC_URL = base;

    await check('isolated: replaced hero + gallery + added menu section/item survive test-pay → /live', async () => {
        const { config: baseCfg } = loadPresetConfig('product-menu');
        const email = `s63-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(base, email);
        const marker = 'S63LIVE-' + crypto.randomUUID().slice(0, 8);
        const duA = dataUrlPng(PNG_A);

        const cfg = JSON.parse(JSON.stringify(baseCfg));
        cfg.business.name = 'S63 ' + marker;
        cfg.business.title = 'S63 ' + marker + ' | Restaurant';
        cfg.business.about = 'About ' + marker;
        // Hero replace (CSS url rewrite — same as applyImageDataUrl)
        if (cfg.hero && typeof cfg.hero.background === 'string') {
            if (/url\s*\(/i.test(cfg.hero.background)) {
                cfg.hero.background = cfg.hero.background.replace(
                    /url\(\s*['"]?[^'")]+['"]?\s*\)/i,
                    "url('" + duA + "')"
                );
            } else {
                cfg.hero.background = "url('" + duA + "')";
            }
        }
        // Normal gallery image
        if (cfg.categories && cfg.categories[0] && cfg.categories[0].photos && cfg.categories[0].photos[0]) {
            cfg.categories[0].photos[0].src = duA;
            cfg.categories[0].photos[0].alt = 'Foto ' + marker;
        }
        // Add menu section + item (builder onListAdd)
        const withMenu = simulateMenuListAdd(cfg, 'menu.en');
        const secIdx = withMenu.menu.en.length - 1;
        withMenu.menu.en[secIdx].category = 'Secțiune ' + marker;
        withMenu.menu.en[secIdx].items = ['Fel special ' + marker, 'Articol nou'];
        withMenu.menu.ro[secIdx].category = 'Secțiune ' + marker;
        withMenu.menu.ro[secIdx].items = ['Fel special ' + marker, 'Articol nou'];
        // Extra dish on first section
        withMenu.menu.en[0].items = (withMenu.menu.en[0].items || []).concat(['Extra ' + marker]);
        withMenu.menu.ro[0].items = (withMenu.menu.ro[0].items || []).concat(['Extra ' + marker]);

        const extracted = runExtractImages(withMenu);
        assert.ok(
            extracted.images.some((i) => (i.dataUrl || '').replace(/\s+/g, '') === duA),
            'payload includes distinctive image'
        );
        assert.ok(
            /url\(\s*['"]?images\//i.test(extracted.cleanConfig.hero.background),
            'clean hero is url(images/…)'
        );
        assert.ok(
            JSON.stringify(extracted.cleanConfig.menu).includes(marker),
            'clean config keeps menu marker'
        );

        const slugHint = 's63-' + crypto.randomUUID().slice(0, 8);
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'RO' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: slugHint,
                config: extracted.cleanConfig,
                images: extracted.images,
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        assert.ok(pubBody.site && pubBody.site.id, 'site id');
        assert.strictEqual(pubBody.site.paid, false, 'unpaid draft');
        assert.ok(pubBody.paymentUrl, 'paymentUrl');
        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;
        const sessM = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
        assert.ok(sessM, 'session id from paymentUrl');
        const sessionId = sessM[1];

        const unpaid = await fetch(`${base}/live/${slug}/`, {
            headers: { Accept: 'text/html' },
            redirect: 'manual',
        });
        assert.strictEqual(unpaid.status, 404, 'unpaid live 404');

        // Test-pay complete (S62 path — sessionId from #test-checkout=)
        const complete = await c('/api/test-pay/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
        });
        assert.ok([200, 201].includes(complete.status), 'test-pay complete ' + complete.status + ' ' + await complete.clone().text());

        await waitForStatus(base, `/live/${slug}/`, 200, { timeoutMs: 25000 });
        const liveRes = await fetch(`${base}/live/${slug}/`, {
            headers: { Accept: 'text/html' },
            redirect: 'manual',
        });
        assert.strictEqual(liveRes.status, 200);
        const liveHtml = await liveRes.text();
        assert.ok(liveHtml.includes(marker) || liveHtml.includes('S63 ' + marker), 'live has business/menu marker');
        assert.ok(
            liveHtml.includes('Secțiune ' + marker) || liveHtml.includes('Fel special ' + marker),
            'live HTML contains added menu section or item'
        );
        assert.ok(
            liveHtml.includes('Extra ' + marker),
            'live HTML contains extra menu item on existing section'
        );
        // Hero / image path references (engine may HTML-escape quotes in style=url)
        assert.ok(
            /images\/(?:hero|gallery)/i.test(liveHtml),
            'live HTML references replaced hero/gallery assets'
        );
        const refs = new Set();
        let mm;
        const reSrc = /(?:src|href)=["'](images\/[^"']+)["']/gi;
        const reUrl = /url\(\s*(?:['"]|&#39;|&quot;)?(images\/[^'")\s&]+)/gi;
        while ((mm = reSrc.exec(liveHtml))) refs.add(mm[1]);
        while ((mm = reUrl.exec(liveHtml))) refs.add(mm[1]);
        assert.ok(refs.size >= 1, 'at least one images/ ref in live HTML, got ' + refs.size);
        let matchedBytes = false;
        for (const rel of [...refs].slice(0, 12)) {
            const imgRes = await fetch(`${base}/live/${slug}/${rel}`, { redirect: 'manual' });
            if (imgRes.status !== 200) continue;
            const buf = Buffer.from(await imgRes.arrayBuffer());
            if (buf.equals(PNG_A)) {
                matchedBytes = true;
                break;
            }
            if (buf.length > 20 && /hero|gallery|logo/i.test(rel)) {
                matchedBytes = true;
                break;
            }
        }
        assert.ok(matchedBytes, 'live image bytes reachable for replaced asset; refs=' + [...refs].join(','));

        // Amount still commercial
        const orders = registry.listOrdersBySite(siteId);
        assert.ok(orders.length >= 1);
        const paid = orders.find((o) => o.status === 'paid') || orders[0];
        assert.strictEqual(paid.amountCents, pricing.PRICE_CENTS);
    });

    await check('isolated: unpaid draft site can be created pre-pay (IG ensureDraft path)', async () => {
        // Same as ensureDraftSiteForInstagram: authenticated /api/publish without live
        const { config: baseCfg } = loadPresetConfig('product-menu');
        const email = `s63-ig-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const c = await loginClient(base, email);
        const cfg = JSON.parse(JSON.stringify(baseCfg));
        cfg.business.name = 'IG Draft ' + crypto.randomUUID().slice(0, 6);
        const extracted = runExtractImages(cfg);
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: 's63-ig-' + crypto.randomUUID().slice(0, 8),
                config: extracted.cleanConfig,
                images: extracted.images,
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const body = await pub.json();
        assert.ok(body.site && body.site.id, 'siteId for social-feed grant');
        assert.strictEqual(body.site.paid, false);
        // Grant without partner secret → 503 is OK (no real Instafidget); must not 401 when authed
        const grant = await c(`/api/sites/${body.site.id}/social-feed/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.notStrictEqual(grant.status, 401, 'authed grant must not 401');
        assert.ok([200, 503, 400].includes(grant.status), 'grant status ' + grant.status);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error('\n' + failed + ' failure(s)');
        process.exit(1);
    }
    console.log('\nAll s63-owner-builder-gaps checks passed.');
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
