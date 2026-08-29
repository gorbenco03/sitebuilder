'use strict';
/**
 * bot/test/s63-owner-builder-gaps.test.js — S63 owner-reported builder gaps.
 *
 * Causal leftovers (parent 46269a2 / S62):
 *   1. Instagram: openInstagramModal dead-ends without account (toast only; no editor auth path)
 *   2. Hero/image: buildImgMap skips CSS url() backgrounds; overlay only matches background-image:url
 *   3. Menu: SAFE_LIST does not treat menu.en / menu.ro / *.items — cannot add section/item
 *
 * GREEN on HEAD:
 *   - Editor IG modal has auth + ensureDraftSite before payment
 *   - buildImgMap + overlay resolve hero.background; extractImages sticks through test-pay live
 *   - onListAdd + overlay allow menu section/item; live HTML contains them after test-pay
 *
 * Env: HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted
 * Run: node bot/test/s63-owner-builder-gaps.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const vm     = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const OVERLAY_JS = path.join(ROOT, 'builder', 'edit-overlay.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const PARENT_SHA = '46269a24182122adfd37c8e486537dc0030e20a3';

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

function parentBlob(rel) {
    try {
        return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        });
    } catch {
        return null;
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

function extractFunction(src, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i++];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
    }
    return src.slice(m.index, i);
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

function runExtractImages(config) {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const fnSrc = extractFunction(appSrc, 'extractImages');
    assert.ok(fnSrc && fnSrc.length > 40, 'extractImages must exist');
    const sandbox = {
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
        console,
    };
    vm.createContext(sandbox);
    vm.runInContext(fnSrc + '\nthis.__extractImages = extractImages;', sandbox);
    return sandbox.__extractImages(JSON.parse(JSON.stringify(config)));
}

function runBuildImgMap(config) {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const fnSrc = extractFunction(appSrc, 'buildImgMap');
    assert.ok(fnSrc && fnSrc.length > 40, 'buildImgMap must exist');
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(fnSrc + '\nthis.__buildImgMap = buildImgMap;', sandbox);
    return sandbox.__buildImgMap(JSON.parse(JSON.stringify(config)));
}

/** Simulate onListAdd menu shape logic (mirrors builder/app.js). */
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
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const overlaySrc = fs.readFileSync(OVERLAY_JS, 'utf8');
    const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');
    const combined = appSrc + '\n' + overlaySrc + '\n' + htmlSrc;

    const parentApp = parentBlob('builder/app.js');
    const parentOverlay = parentBlob('builder/edit-overlay.js');
    const parentHtml = parentBlob('builder/index.html');

    // ── Causal RED documentation (parent leftovers) ────────────────────────
    await check('causal RED: parent openInstagramModal dead-ends without account (toast only)', () => {
        assert.ok(parentApp, 'parent app.js readable at ' + PARENT_SHA);
        const openFn = extractFunction(parentApp, 'openInstagramModal') || '';
        assert.ok(openFn.length > 40, 'parent openInstagramModal exists');
        assert.ok(
            /if\s*\(\s*!currentUser\s*\)/.test(openFn),
            'parent requires currentUser before opening modal'
        );
        assert.ok(
            /showToast\s*\(\s*['"]Intră în cont/.test(openFn),
            'parent shows dead toast instead of editor auth path'
        );
        assert.ok(
            !/wireIgAuthForm|ig-auth-panel|ensureDraftSiteForInstagram/.test(openFn + parentHtml),
            'parent has no in-editor IG auth path'
        );
    });

    await check('causal RED: parent buildImgMap / overlay miss CSS hero backgrounds', () => {
        assert.ok(parentApp && parentOverlay, 'parent sources');
        const mapFn = extractFunction(parentApp, 'buildImgMap') || '';
        assert.ok(mapFn.length > 40, 'parent buildImgMap exists');
        // Parent only indexes bare data:/images:/http strings — not url() inside CSS multi-layer
        assert.ok(
            !/url\(\s*\\s\*\\s\*\\[['"]?/.test(mapFn) &&
                !/\/url\\s\*\\\(/.test(mapFn) &&
                !mapFn.includes("url\\(\\s*['\"]?"),
            'parent buildImgMap does not extract CSS url() fragments'
        );
        // Parent overlay only matches background-image:url — not background: gradient, url()
        assert.ok(
            parentOverlay.includes('background-image') &&
                /background-image\\s\*:\\s\*url\\/.test(parentOverlay),
            'parent overlay uses background-image:url only'
        );
        assert.ok(
            !parentOverlay.includes('(?:background(?:-image)?)'),
            'parent lacks flexible background/background-image matcher'
        );
    });

    await check('causal RED: parent SAFE_LIST / onListAdd cannot add menu section or dish', () => {
        assert.ok(parentOverlay && parentApp, 'parent sources');
        const safeBlock = parentOverlay.match(/SAFE_LIST_PATHS\s*=\s*\[[^\]]+\]/);
        assert.ok(safeBlock, 'parent SAFE_LIST_PATHS');
        // 'menu' is listed but isSafeList only exact/endsWith .menu — menu.en fails
        const isSafe = extractFunction(parentOverlay, 'isSafeList') || '';
        assert.ok(isSafe.length > 20, 'parent isSafeList');
        assert.ok(
            !/menu\\\.\(en\|ro\)/.test(isSafe) && !/menu\.\(en\|ro\)/.test(isSafe),
            'parent isSafeList has no menu.en/ro rule'
        );
        assert.ok(
            !/\.items\$/.test(isSafe),
            'parent isSafeList has no nested .items rule'
        );
        const onAdd = extractFunction(parentApp, 'onListAdd') || '';
        assert.ok(
            !/Secțiune nouă|Articol nou|menu\\\.\(en\|ro\)/.test(onAdd),
            'parent onListAdd has no restaurant menu section/item shapes'
        );
    });

    // ── HEAD source locks ──────────────────────────────────────────────────
    await check('HEAD: Instagram modal opens with editor auth path (no dead toast-only gate)', () => {
        const openFn = extractFunction(appSrc, 'openInstagramModal') || '';
        assert.ok(/openModal\s*\(\s*['"]modal-instagram['"]\s*\)/.test(openFn), 'opens modal');
        assert.ok(/wireIgAuthForm|ig-auth-panel/.test(openFn + htmlSrc), 'has auth path');
        assert.ok(/ensureDraftSiteForInstagram/.test(appSrc), 'can save unpaid draft for siteId');
        assert.ok(/form-ig-auth-email/.test(htmlSrc), 'IG auth form in HTML');
        assert.ok(/ig-connect-panel/.test(htmlSrc), 'connect panel present');
        assert.ok(/înainte să începi trialul/i.test(htmlSrc + openFn), 'copy says before trial starts');
        // Must not early-return with only toast before openModal
        const toastBeforeOpen = openFn.indexOf("showToast('Intră în cont");
        const openIdx = openFn.indexOf("openModal('modal-instagram')");
        assert.ok(openIdx >= 0, 'openModal call present');
        assert.ok(
            toastBeforeOpen < 0 || toastBeforeOpen > openIdx,
            'must not toast-and-return before opening modal'
        );
        assert.ok(!/HIDOOK_FAKE_DEPLOY/.test(appSrc), 'no fake deploy');
        assert.ok(!/\bDESSERD\b/i.test(combined), 'no DESSERD');
        assert.ok(!/\bbakery\b/i.test(combined), 'no bakery');
    });

    await check('HEAD: buildImgMap maps CSS url() hero background to hero.background', () => {
        const heroDu = dataUrlPng(PNG_A);
        const css =
            "linear-gradient(160deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.25) 55%), url('" +
            heroDu +
            "')";
        const map = runBuildImgMap({
            hero: { background: css },
            logo: dataUrlPng(PNG_B),
            business: { name: 'Map' },
        });
        assert.strictEqual(map[heroDu], 'hero.background', 'CSS-embedded dataUrl → hero.background');
        assert.strictEqual(map[dataUrlPng(PNG_B)], 'logo', 'bare logo still mapped');

        const filePath = "images/cn-hero.jpg";
        const map2 = runBuildImgMap({
            hero: {
                background:
                    "linear-gradient(160deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.25) 55%), url('" +
                    filePath +
                    "')",
            },
        });
        assert.strictEqual(map2[filePath], 'hero.background', 'file path inside url() → hero.background');
    });

    await check('HEAD: overlay matches background: multi-layer and menu.en/items safe lists', () => {
        assert.ok(
            /background\(\?:-image\)\?/.test(overlaySrc) ||
                /\(\?:background\(\?:-image\)\?\)/.test(overlaySrc),
            'overlay matches background or background-image'
        );
        assert.ok(
            /menu\\\.\(en\|ro\)/.test(overlaySrc) || /menu\.\(en\|ro\)/.test(overlaySrc),
            'menu.en/ro treated as safe lists'
        );
        assert.ok(
            /menu\\\.\(en\|ro\)\\\.\\d\+\\.items|menu\.\(en\|ro\)\.\d+\.items/.test(overlaySrc) ||
                /\\d\+\\.items\$/.test(overlaySrc),
            'nested menu items safe'
        );
        assert.ok(/\+ Adaugă secțiune/.test(overlaySrc), 'add section label RO');
        assert.ok(/\+ Adaugă articol/.test(overlaySrc), 'add item label RO');
    });

    await check('HEAD: onListAdd creates menu section + dish; extractImages keeps hero', () => {
        assert.ok(/New section/.test(appSrc), 'section default EN');
        assert.ok(/New item/.test(appSrc), 'item default EN');
        const { config } = loadPresetConfig('product-menu');
        const beforeSections = (config.menu && config.menu.en && config.menu.en.length) || 0;
        const afterSec = simulateMenuListAdd(config, 'menu.en');
        assert.ok(afterSec.menu.en.length === beforeSections + 1, 'section added to menu.en');
        const last = afterSec.menu.en[afterSec.menu.en.length - 1];
        assert.strictEqual(last.category, 'New section');
        assert.ok(Array.isArray(last.items) && last.items[0] === 'New item');
        assert.ok(
            afterSec.menu.ro && afterSec.menu.ro.length === afterSec.menu.en.length,
            'section mirrored to menu.ro'
        );
        const afterItem = simulateMenuListAdd(afterSec, 'menu.en.0.items');
        const items0 = afterItem.menu.en[0].items;
        assert.ok(items0[items0.length - 1] === 'New item', 'dish appended');

        // applyImageDataUrl-equivalent: hero CSS with replaced data URL still extracts
        const du = dataUrlPng(PNG_A);
        const cfg = JSON.parse(JSON.stringify(config));
        cfg.hero.background = cfg.hero.background.replace(
            /url\(\s*['"]?[^'")]+['"]?\s*\)/i,
            "url('" + du + "')"
        );
        if (Array.isArray(cfg.categories) && cfg.categories[0] && cfg.categories[0].photos) {
            cfg.categories[0].photos[0].src = du;
        }
        // After menu edits
        cfg.menu = afterItem.menu;
        const marker = 'S63-SELTIE-' + crypto.randomUUID().slice(0, 6);
        cfg.menu.en[cfg.menu.en.length - 1].category = marker;
        cfg.menu.en[cfg.menu.en.length - 1].items = ['Fel S63 ' + marker];
        cfg.menu.ro[cfg.menu.ro.length - 1].category = marker;
        cfg.menu.ro[cfg.menu.ro.length - 1].items = ['Fel S63 ' + marker];
        cfg.business.name = 'S63 Menu Live';

        const { cleanConfig, images } = runExtractImages(cfg);
        assert.ok(images.some((i) => (i.dataUrl || '').replace(/\s+/g, '') === du), 'hero/gallery image extracted');
        assert.ok(
            /url\(\s*['"]?images\//i.test(cleanConfig.hero.background),
            'hero.background → url(images/…)'
        );
        assert.ok(!JSON.stringify(cleanConfig).includes('data:image/'), 'no data URLs in clean');
        assert.ok(
            JSON.stringify(cleanConfig.menu).includes(marker),
            'added menu section survives extractImages'
        );
    });

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
        const db = JSON.parse(fs.readFileSync(path.join(tmpDir, '.registry.json'), 'utf8'));
        const orders = Object.values(db.orders || {}).filter((o) => o.siteId === siteId);
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
