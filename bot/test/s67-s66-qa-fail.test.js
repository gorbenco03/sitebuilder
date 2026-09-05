'use strict';
/**
 * bot/test/s67-s66-qa-fail.test.js — S67 remake of S66 QA FAIL leaks.
 *
 * STALE ORACLE RECONCILE (S-legacy G3, 2026-09-05):
 * Instagram chrome intentionally names the Instafidget partner product in RO
 * status/error copy and Instagram editor modal chrome (AGENTS.md: Instafidget
 * free 12mo). The S67 lock `!/Instafidget\\./i` and "no Instafidget outside
 * #ig-partner-note" treated partner naming as factory jargon; current product
 * uses it in #ig-partner-note, #ig-editor-status, and #btn-ig-editor. Keep the
 * ban on Widgetul factory jargon and keep Instafidget out of catalog/landing
 * chrome outside those IG surfaces. Not a stranger-facing regression.
 *
 * Causal leftovers on parent b844011 (S65 ACCEPT):
 *   1. Hero Schimbă poza on data-URL mast: resolveImgPath misses full data URL
 *      (preview inlines images/* → data:; imgMap only keys images/ paths)
 *   2. ensureDraftSiteForInstagram reserves slug but never sets currentSiteSlug
 *      → first Publică says «Această adresă e deja folosită»
 *   3. Detalii schema label «partner feed (iframe)»
 *   4. Instagram modal Instafidget / Widgetul factory copy
 *   5. Success URL CSS ellipsis clips live slug
 *   6. Catalog Meseriași «renovari» missing diacritic
 *   7. Istoric versionId.slice(0,8) hex stub
 *
 * GREEN on HEAD for each. Isolated adapters only.
 * Env: HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted.
 * Run: node bot/test/s67-s66-qa-fail.test.js
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
const APP_CSS = path.join(ROOT, 'builder', 'app.css');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const REGISTRY_JSON = path.join(ROOT, 'templates', 'registry.json');
const SCHEMA_PATHS = [
    'templates/product-menu/schema.json',
    'templates/portfolio/schema.json',
    'templates/local-service/schema.json',
];
const PARENT_SHA = 'b8440112a51051587d7bbb7a49d90cf661c97e2f';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's67-s66-qa-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s67-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.SITEBUILDER_PARTNER_SECRET;
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

async function waitForStatus(base, urlPath, wantStatus, { timeoutMs = 15000, intervalMs = 50 } = {}) {
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

function loadPresetConfig(templateId) {
    const presetsPath = path.join(ROOT, 'templates', templateId, 'presets.json');
    const body = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    const presets = body.presets || [];
    assert.ok(presets.length >= 1, `${templateId} must have ≥1 preset`);
    return JSON.parse(JSON.stringify(presets[0].config));
}

/** Simulate HEAD resolveImgPath + imgmap (with optional reverse data URL keys). */
function simulateResolve(overlaySrc, imgMap, src) {
    const fn = extractFunction(overlaySrc, 'resolveImgPath');
    assert.ok(fn && fn.length > 40, 'resolveImgPath must exist');
    const sandbox = { imgMap: imgMap, result: null };
    // inject imgMap into function scope by wrapping
    vm.runInNewContext(
        'var imgMap = ' + JSON.stringify(imgMap) + ';\n' +
        fn + '\nresult = resolveImgPath(' + JSON.stringify(src) + ');',
        sandbox
    );
    return sandbox.result;
}

function simulateExtractBgUrls(overlaySrc, styleAttr) {
    const fn = extractFunction(overlaySrc, 'extractBackgroundUrls');
    assert.ok(fn && fn.length > 40, 'extractBackgroundUrls must exist on HEAD');
    const sandbox = { result: null };
    vm.runInNewContext(
        fn + '\nresult = extractBackgroundUrls(' + JSON.stringify(styleAttr) + ');',
        sandbox
    );
    return sandbox.result;
}

function runBuildImgMap(appSrc, config, imageMap) {
    const fnSrc = extractFunction(appSrc, 'buildImgMap');
    assert.ok(fnSrc && fnSrc.length > 40, 'buildImgMap must exist');
    const sandbox = {};
    vm.runInNewContext(fnSrc + '\nthis.__buildImgMap = buildImgMap;', sandbox);
    let map = sandbox.__buildImgMap(JSON.parse(JSON.stringify(config)));
    // HEAD also reverse-maps template imageMap data URLs (if helper present)
    const reverseFn = extractFunction(appSrc, 'mergePreviewImageMap');
    if (reverseFn && imageMap) {
        vm.runInNewContext(
            reverseFn + '\nthis.__merge = mergePreviewImageMap;',
            sandbox
        );
        map = sandbox.__merge(map, imageMap);
    }
    return map;
}

(async () => {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const overlaySrc = fs.readFileSync(OVERLAY_JS, 'utf8');
    const cssSrc = fs.readFileSync(APP_CSS, 'utf8');
    const indexSrc = fs.readFileSync(INDEX_HTML, 'utf8');
    const regSrc = fs.readFileSync(REGISTRY_JSON, 'utf8');

    const parentApp = parentBlob('builder/app.js');
    const parentOverlay = parentBlob('builder/edit-overlay.js');
    const parentCss = parentBlob('builder/app.css');
    const parentIndex = parentBlob('builder/index.html');
    const parentReg = parentBlob('templates/registry.json');
    const parentSchemas = SCHEMA_PATHS.map((p) => ({ p, src: parentBlob(p) }));

    const sampleDataUrl =
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z';

    // ── Causal RED on parent b844011 ───────────────────────────────────────
    await check('causal RED: parent resolveImgPath misses inlined data-URL hero', () => {
        assert.ok(parentOverlay, 'parent overlay');
        assert.ok(parentApp, 'parent app');
        // Parent buildImgMap keys only config paths (images/...), not preview data URLs
        const mapFn = extractFunction(parentApp, 'buildImgMap') || '';
        assert.ok(mapFn.length > 40, 'parent buildImgMap');
        assert.ok(
            !/mergePreviewImageMap/.test(parentApp),
            'parent has no mergePreviewImageMap reverse data-URL map'
        );
        // Simulate parent imgMap (images path only) + DOM data URL after preview inline
        const filePath = 'images/cn-hero.jpg';
        const parentMap = { [filePath]: 'hero.background' };
        // Parent resolveImgPath: extract and run
        const fn = extractFunction(parentOverlay, 'resolveImgPath');
        assert.ok(fn, 'parent resolveImgPath');
        const sandbox = { result: null };
        vm.runInNewContext(
            'var imgMap = ' + JSON.stringify(parentMap) + ';\n' +
            fn + '\nresult = resolveImgPath(' + JSON.stringify(sampleDataUrl) + ');',
            sandbox
        );
        assert.strictEqual(
            sandbox.result,
            null,
            'parent resolveImgPath must miss full data-URL when only images/ key exists (got ' +
                JSON.stringify(sandbox.result) + ')'
        );
        // Parent bg click only posts when resolvedPath truthy — no fallback path
        const setup = extractFunction(parentOverlay, 'setupImages') || parentOverlay;
        assert.ok(
            !/resolveBackgroundPath|fallback.*hero\.background|backgroundPathFallback/i.test(setup),
            'parent has no background path fallback for data-URL miss'
        );
    });

    await check('causal RED: parent ensureDraftSiteForInstagram never sets currentSiteSlug', () => {
        assert.ok(parentApp, 'parent app');
        const fn = extractFunction(parentApp, 'ensureDraftSiteForInstagram') || '';
        assert.ok(fn.length > 40, 'parent ensureDraftSiteForInstagram');
        assert.ok(
            !/currentSiteSlug\s*=/.test(fn),
            'parent IG draft publish must not set currentSiteSlug (slug collision root cause)'
        );
        assert.ok(/api\/publish/.test(fn), 'parent still posts unpaid draft');
    });

    await check('causal RED: parent Detalii schema has partner feed / iframe jargon', () => {
        let found = false;
        for (const { p, src } of parentSchemas) {
            assert.ok(src, 'parent ' + p);
            if (/partner feed|iframe/i.test(src)) found = true;
            if (/URL embed Instagram \/ partner feed \(iframe\)/i.test(src)) found = true;
        }
        assert.ok(found, 'parent schemas still expose partner-feed/iframe label');
    });

    await check('causal RED: parent Instagram copy names Instafidget / Widgetul', () => {
        const blob = (parentApp || '') + '\n' + (parentIndex || '');
        assert.ok(/Instafidget/i.test(blob), 'parent has Instafidget');
        assert.ok(/Widgetul/i.test(blob), 'parent has Widgetul');
    });

    await check('causal RED: parent success URL CSS clips with ellipsis/nowrap', () => {
        assert.ok(parentCss, 'parent css');
        const block = parentCss.match(/\.success-url-link\s*\{[^}]+\}/);
        assert.ok(block, 'parent .success-url-link rule');
        assert.ok(
            /text-overflow:\s*ellipsis/i.test(block[0]) || /white-space:\s*nowrap/i.test(block[0]),
            'parent clips success URL'
        );
    });

    await check('causal RED: parent catalog Meseriași has renovari without diacritic', () => {
        assert.ok(parentReg, 'parent registry');
        const local = JSON.parse(parentReg).templates.find((t) => t.id === 'local-service');
        assert.ok(local, 'local-service template');
        assert.ok(
            /renovari/i.test(local.description || '') && !/renovări/i.test(local.description || ''),
            'parent description has renovari not renovări'
        );
    });

    await check('causal RED: parent Istoric uses versionId.slice(0,8) hex stub', () => {
        assert.ok(parentApp, 'parent app');
        assert.ok(
            /versionId\.slice\s*\(\s*0\s*,\s*8\s*\)/.test(parentApp),
            'parent shows opaque hex version id'
        );
        const loadFn = extractFunction(parentApp, 'loadVersions') || '';
        assert.ok(
            /versionId\.slice/.test(loadFn),
            'loadVersions renders hex stub'
        );
        assert.ok(
            !/Versiunea\s*\d|versionLabel|formatVersion/i.test(loadFn),
            'parent has no human version label'
        );
    });

    // ── HEAD source locks ──────────────────────────────────────────────────
    await check('HEAD: resolveImgPath / imgmap recovers data-URL hero → hero.background', () => {
        const filePath = 'images/cn-hero.jpg';
        const css =
            "linear-gradient(160deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.25) 55%), url('" +
            filePath +
            "')";
        const config = { hero: { background: css }, business: { name: 'Casa' } };
        const imageMap = { [filePath]: sampleDataUrl };
        const map = runBuildImgMap(appSrc, config, imageMap);
        assert.strictEqual(map[filePath], 'hero.background', 'file path still mapped');
        assert.strictEqual(
            map[sampleDataUrl],
            'hero.background',
            'inlined data URL must map to hero.background'
        );

        const resolved = simulateResolve(overlaySrc, map, sampleDataUrl);
        assert.strictEqual(resolved, 'hero.background', 'resolveImgPath(data URL) → hero.background');

        // extractBackgroundUrls still recovers full data URL from multi-layer style
        const style =
            "background: linear-gradient(160deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.25) 55%), url('" +
            sampleDataUrl +
            "'); padding-top: 4rem";
        const urls = simulateExtractBgUrls(overlaySrc, style);
        assert.ok(
            urls.some((u) => u === sampleDataUrl || u.startsWith('data:image/jpeg;base64,')),
            'full data URL recovered from style'
        );
        // Overlay posts {hb:'image'} even when map was path-only (fallback)
        const pathOnlyMap = { [filePath]: 'hero.background' };
        const fallbackFn = extractFunction(overlaySrc, 'resolveBackgroundPathFallback') ||
            extractFunction(overlaySrc, 'resolveImgPathFallback');
        assert.ok(
            fallbackFn ||
                /resolveBackgroundPathFallback|hero\.background/.test(
                    extractFunction(overlaySrc, 'setupImages') || ''
                ),
            'overlay has data-URL background path fallback'
        );
        if (fallbackFn) {
            const sb = { result: null };
            vm.runInNewContext(
                'var imgMap = ' + JSON.stringify(pathOnlyMap) + ';\n' +
                fallbackFn + '\nresult = resolveBackgroundPathFallback();',
                sb
            );
            assert.strictEqual(sb.result, 'hero.background', 'fallback → hero.background');
        }
        assert.ok(/hb:\s*['\"]image['\"]/.test(overlaySrc), 'posts hb image');
        assert.ok(/Înlocuiește fotografia/.test(overlaySrc), 'Romanian photo overlay label present');
    });

    await check('HEAD: ensureDraftSiteForInstagram sets currentSiteSlug; own slug valid', () => {
        const fn = extractFunction(appSrc, 'ensureDraftSiteForInstagram') || '';
        assert.ok(/currentSiteSlug\s*=/.test(fn), 'IG draft sets currentSiteSlug');
        assert.ok(/data\.site\.slug|baseSlug/.test(fn), 'uses returned or requested slug');
        const openFn = extractFunction(appSrc, 'openPublishModal') || '';
        assert.ok(/currentSiteSlug/.test(openFn), 'publish modal reuses currentSiteSlug');
        const checkFn = extractFunction(appSrc, 'checkSlug') || '';
        assert.ok(/currentSiteSlug/.test(checkFn), 'checkSlug treats own slug as available');
        // Commercial IG copy: no Widgetul factory jargon. Instafidget may appear as
        // the named partner product in RO modal/status/error strings and in
        // #ig-partner-note / Instagram editor modal chrome — not as free-floating
        // catalog or landing chrome outside those surfaces.
        assert.ok(!/\bWidgetul\b/i.test(appSrc), 'app.js no Widgetul');
        // Partner product sentences must stay Romanian product chrome, not EN factory.
        // Instafidget is the approved partner product name in RO status/errors.
        assert.ok(/Instafidget/i.test(appSrc), 'app.js names Instafidget partner product');
        assert.ok(
            !/partner feed \(iframe\)/i.test(appSrc),
            'app.js no partner feed (iframe) jargon'
        );
        const indexNoHref = indexSrc.replace(/href="[^"]*"/gi, 'href=""');
        // Strip partner note + Instagram editor modal chrome (status + open button).
        let indexNoIgChrome = indexNoHref.replace(
            /id=["']ig-partner-note["'][^>]*>[\s\S]*?<\/p>/i,
            ''
        );
        indexNoIgChrome = indexNoIgChrome.replace(
            /id=["']ig-editor-status["'][^>]*>[\s\S]*?<\/p>/i,
            ''
        );
        indexNoIgChrome = indexNoIgChrome.replace(
            /id=["']btn-ig-editor["'][^>]*>[\s\S]*?<\/button>/i,
            ''
        );
        assert.ok(
            !/Instafidget/i.test(indexNoIgChrome),
            'index visible copy no Instafidget outside partner note + IG editor chrome'
        );
        assert.ok(!/\bWidgetul\b/i.test(indexSrc), 'index.html no Widgetul');
        assert.ok(/Instagram/i.test(indexSrc), 'still says Instagram');
        assert.ok(
            /id=["']ig-partner-note["']/.test(indexSrc) &&
                /Instafidget,\s*(a partner product|un produs partener)/i.test(indexSrc),
            'Wave 12 partner note names Instafidget as partner product'
        );
    });

    await check('HEAD: Detalii schemas have no partner feed / iframe jargon', () => {
        for (const rel of SCHEMA_PATHS) {
            const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            assert.ok(!/partner feed/i.test(src), rel + ' no partner feed');
            assert.ok(!/\biframe\b/i.test(src), rel + ' no iframe in labels');
            const schema = JSON.parse(src);
            const walk = (nodes) => {
                if (!nodes) return;
                const arr = Array.isArray(nodes) ? nodes : [nodes];
                for (const n of arr) {
                    if (!n || typeof n !== 'object') continue;
                    if (typeof n.label === 'string') {
                        assert.ok(!/partner feed|iframe/i.test(n.label), n.label);
                    }
                    if (n.fields) walk(n.fields);
                    if (n.sections) walk(n.sections);
                    if (n.groups) walk(n.groups);
                }
            };
            walk(schema.sections || schema.fields || schema);
        }
    });

    await check('HEAD: success URL shows full address (no ellipsis clip)', () => {
        const block = cssSrc.match(/\.success-url-link\s*\{[^}]+\}/);
        assert.ok(block, '.success-url-link rule');
        assert.ok(
            !/text-overflow:\s*ellipsis/i.test(block[0]),
            'no text-overflow ellipsis on success URL'
        );
        assert.ok(
            !/white-space:\s*nowrap/i.test(block[0]),
            'no nowrap clip on success URL'
        );
        assert.ok(
            /overflow:\s*visible|word-break:\s*break-all|white-space:\s*normal|overflow-wrap/i.test(block[0]),
            'allows full URL wrap/visibility'
        );
        assert.ok(/success-url-text/.test(indexSrc), 'success url text span present');
        assert.ok(!/HIDOOK_FAKE_DEPLOY/.test(appSrc), 'no fake deploy');
    });

    await check('HEAD: catalog Meseriași uses renovări with diacritic', () => {
        assert.ok(!/\brenovari\b/i.test(regSrc), 'no leftover Romanian renovari');
        const local = JSON.parse(regSrc).templates.find((t) => t.id === 'local-service');
        assert.ok(local, 'local-service');
        assert.ok(/renovări/i.test(local.description || ''), 'has Romanian renovări wording');
        assert.ok(!/\brenovari\b/i.test(local.description || ''), 'no renovari typo');
    });

    await check('HEAD: Istoric uses human version label not hex stub', () => {
        const loadFn = extractFunction(appSrc, 'loadVersions') || '';
        assert.ok(loadFn.length > 40, 'loadVersions');
        assert.ok(
            !/versionId\.slice\s*\(\s*0\s*,\s*8\s*\)/.test(loadFn),
            'no versionId.slice(0,8) in loadVersions'
        );
        assert.ok(
            /Versiunea|versionLabel|versiune/i.test(loadFn),
            'human version label present'
        );
    });

    await check('HIDOOK_FAKE_DEPLOY not set (isolated + test-pay)', () => {
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(!process.env.HIDOOK_FAKE_DEPLOY);
    });

    // ── Isolated HTTP: IG draft slug reuse on first publish ─────────────────
    const server = await startServer({ port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await check('isolated: IG unpaid draft reserves slug; first publish reuses same site/slug', async () => {
            const email = 's67-ig-' + crypto.randomBytes(3).toString('hex') + '@example.com';
            const c = await loginClient(base, email);
            const cfg = loadPresetConfig('product-menu');
            cfg.business = cfg.business || {};
            cfg.business.name = 'QaNord S67 ' + crypto.randomBytes(2).toString('hex');
            const slugBase = 'qanord-s67-' + crypto.randomBytes(3).toString('hex');

            // Unpaid draft publish (what ensureDraftSiteForInstagram does)
            const draftRes = await c('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateId: 'product-menu',
                    config: cfg,
                    images: [],
                    slug: slugBase,
                }),
            });
            assert.strictEqual(draftRes.status, 200, 'draft publish 200');
            const draftBody = await draftRes.json();
            assert.ok(draftBody.site && draftBody.site.id, 'draft site id');
            const siteId = draftBody.site.id;
            const reservedSlug = draftBody.site.slug || slugBase;
            assert.ok(reservedSlug, 'reserved slug');
            assert.ok(!draftBody.site.paid, 'still unpaid');

            // slug-check reports taken for strangers
            const checkTaken = await fetch(
                base + '/api/slug-check?slug=' + encodeURIComponent(reservedSlug)
            );
            const takenBody = await checkTaken.json();
            assert.strictEqual(takenBody.available, false, 'slug reserved → not available');

            // First paid path: republish SAME siteId + slug (client must send siteId)
            const pubRes = await c('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateId: 'product-menu',
                    config: cfg,
                    images: [],
                    slug: reservedSlug,
                    siteId,
                }),
            });
            assert.strictEqual(pubRes.status, 200, 'republish same draft 200');
            const pubBody = await pubRes.json();
            assert.strictEqual(pubBody.site.id, siteId, 'same site id');
            assert.strictEqual(
                String(pubBody.site.slug),
                String(reservedSlug),
                'same slug reused'
            );

            // Test-pay via session from paymentUrl (not bare siteId)
            const payUrl = pubBody.paymentUrl || draftBody.paymentUrl || '';
            const sessM = String(payUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
            assert.ok(sessM, 'test checkout session in paymentUrl');
            const payRes = await c('/api/test-pay/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sessM[1] }),
            });
            assert.ok([200, 201].includes(payRes.status), 'test-pay ' + payRes.status + ' ' + await payRes.clone().text());
            await waitForStatus(base, '/live/' + reservedSlug + '/', 200);
            const live = await fetch(base + '/live/' + reservedSlug + '/');
            assert.strictEqual(live.status, 200);
            const liveHtml = await live.text();
            assert.ok(liveHtml.length > 200, 'live HTML body');
        });

        await check('isolated: pricing still 9900/2900 units', () => {
            const p = pricing.getPricing({ country: 'RO' });
            assert.strictEqual(p.amountCents, 9900);
            assert.strictEqual(p.renewalCents, 2900);
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    // keep refs so linters don't drop requires
    assert.ok(payments && webpublish);

    if (failed > 0) {
        console.error('\n' + failed + ' failed');
        process.exit(1);
    }
    console.log('\nAll s67 checks passed');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
