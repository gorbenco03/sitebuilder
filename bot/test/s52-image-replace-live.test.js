'use strict';
/**
 * bot/test/s52-image-replace-live.test.js — S52 replaced photos on isolated live.
 *
 * Causal lock-in:
 *   - Builder extractImages sends data-URL photos as {name,dataUrl} and rewrites to images/…
 *   - Unpaid draft keeps photos; /live stays 404
 *   - Test-pay → live HTML references images/… and GET image returns distinctive bytes
 *   - Paid edit + republish updates live HTML + image file
 *
 * Env: HIDOOK_ISOLATED_DEPLOY=1, HIDOOK_TEST_PAY=1; HIDOOK_FAKE_DEPLOY deleted
 *
 * Run: node bot/test/s52-image-replace-live.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const vm     = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's52-image-replace-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-s52-' + crypto.randomBytes(4).toString('hex');
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

/** 1×1 red JPEG */
const JPEG_RED_B64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z';
/** Distinctive tiny PNG (red pixel) — unique magic for byte checks */
const PNG_A = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);
/** Second distinctive PNG (green-ish marker via different payload) */
const PNG_B = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

function dataUrlPng(buf) {
    return 'data:image/png;base64,' + buf.toString('base64');
}
function dataUrlJpeg(b64) {
    return 'data:image/jpeg;base64,' + b64;
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

function withBusinessName(config, name) {
    const c = JSON.parse(JSON.stringify(config));
    c.business = c.business || {};
    c.business.name = name;
    if (c.business.title) c.business.title = name + ' | S52';
    if (c.business.about) c.business.about = name + ' — S52 image replace proof.';
    return c;
}

/** Run builder extractImages in a sandbox (mirrors client publish path). */
function runExtractImages(config) {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const fnSrc = extractFunction(appSrc, 'extractImages');
    assert.ok(fnSrc && fnSrc.length > 40, 'extractImages must exist in builder/app.js');
    // deepClone is used by extractImages — provide a minimal polyfill
    const sandbox = {
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
        console,
    };
    vm.createContext(sandbox);
    vm.runInContext(fnSrc + '\nthis.__extractImages = extractImages;', sandbox);
    return sandbox.__extractImages(JSON.parse(JSON.stringify(config)));
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
    const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');
    const combined = appSrc + '\n' + htmlSrc;
    const extractSrc = extractFunction(appSrc, 'extractImages') || '';
    const execPubSrc = extractFunction(appSrc, 'execPublish') || '';

    // ── Builder source ─────────────────────────────────────────────────────
    await check('extractImages exists and is used by execPublish payload', () => {
        assert.ok(extractSrc.length > 40, 'extractImages function body');
        assert.ok(/data:image\//.test(extractSrc), 'must detect data:image values');
        assert.ok(/images\//.test(extractSrc), 'must rewrite paths to images/…');
        assert.ok(/name.*dataUrl|dataUrl.*name/.test(extractSrc), 'must push {name, dataUrl}');
        assert.ok(execPubSrc.length > 40, 'execPublish must exist');
        assert.ok(
            /extractImages\s*\(\s*draft\.config\s*\)/.test(execPubSrc),
            'execPublish must call extractImages(draft.config)'
        );
        assert.ok(
            /images\s*,|images\s*:/.test(execPubSrc) && /api\/publish/.test(execPubSrc),
            'execPublish must POST images on /api/publish'
        );
    });

    await check('extractImages extracts logo + gallery data-URLs and rewrites paths', () => {
        const logoDu = dataUrlPng(PNG_A);
        const galDu = dataUrlJpeg(JPEG_RED_B64);
        const cfg = {
            logo: logoDu,
            categories: [{ title: 'G', photos: [{ src: galDu, alt: 'a' }] }],
            business: { name: 'X' },
        };
        const { cleanConfig, images } = runExtractImages(cfg);
        assert.ok(Array.isArray(images) && images.length >= 2, 'must extract ≥2 images, got ' + images.length);
        const byName = Object.fromEntries(images.map((i) => [i.name, i]));
        assert.ok(byName.logo && byName.logo.dataUrl === logoDu, 'logo dataUrl preserved in payload');
        const gal = images.find((i) => i.name.startsWith('gallery'));
        assert.ok(gal && gal.dataUrl === galDu, 'gallery dataUrl preserved');
        assert.ok(
            typeof cleanConfig.logo === 'string' && cleanConfig.logo.startsWith('images/'),
            'logo path rewritten to images/… got ' + cleanConfig.logo
        );
        const photoSrc = cleanConfig.categories[0].photos[0].src;
        assert.ok(
            typeof photoSrc === 'string' && photoSrc.startsWith('images/'),
            'gallery src rewritten to images/… got ' + photoSrc
        );
        // No leftover data URLs in clean config
        const dumped = JSON.stringify(cleanConfig);
        assert.ok(!dumped.includes('data:image/'), 'cleanConfig must not keep data:image blobs');
    });

    await check('extractImages pulls data-URL out of hero CSS url(...) and keeps url(images/…)', () => {
        const heroDu = dataUrlPng(PNG_A);
        const css =
            "linear-gradient(160deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.25) 55%), url('" +
            heroDu +
            "')";
        const pureBg = heroDu; // click-to-replace often sets pure data URL on hero.background
        const { cleanConfig, images } = runExtractImages({
            hero: { background: css },
            business: { name: 'HeroCSS' },
        });
        assert.ok(
            images.some((i) => i.dataUrl === heroDu || i.dataUrl.replace(/\s+/g, '') === heroDu),
            'hero CSS-embedded dataUrl must be in images payload'
        );
        const bg = cleanConfig.hero.background;
        assert.ok(typeof bg === 'string', 'hero.background string');
        assert.ok(!bg.includes('data:image/'), 'hero.background must not keep data:image blob, got ' + bg.slice(0, 120));
        assert.ok(
            /url\(\s*['"]?images\/[^'")\s]+['"]?\s*\)/i.test(bg),
            'hero.background must keep CSS url(images/…) wrapper, got ' + bg
        );
        assert.ok(/linear-gradient/i.test(bg), 'gradient layer preserved alongside local image');

        const pure = runExtractImages({ hero: { background: pureBg }, business: { name: 'Pure' } });
        assert.ok(pure.images.some((i) => i.dataUrl === pureBg), 'pure hero dataUrl extracted');
        const pbg = pure.cleanConfig.hero.background;
        assert.ok(
            /url\(\s*['"]?images\/[^'")\s]+['"]?\s*\)/i.test(pbg),
            'pure dataUrl on hero.background must become url(images/…), got ' + pbg
        );
        assert.ok(!pbg.includes('data:image/'), 'pure hero path must not remain a bare data URL');
    });

    await check('builder commercial chrome: no DESSERD/bakery/test.local/fake journey', () => {
        assert.ok(/Hidook Site Builder/.test(htmlSrc), 'names Hidook Site Builder');
        assert.ok(!/\bDESSERD\b/i.test(combined), 'no DESSERD');
        assert.ok(!/\bbakery\b/i.test(combined), 'no bakery customer address');
        assert.ok(!/\.test\.local\b/i.test(combined), 'no *.test.local');
        assert.ok(!/HIDOOK_FAKE_DEPLOY/.test(appSrc), 'no fake deploy in builder journey');
    });

    await check('HIDOOK_FAKE_DEPLOY not set (isolated + test-pay journey)', () => {
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        assert.ok(payments.isConfigured(), 'test-pay configured');
    });

    // ── HTTP journey ───────────────────────────────────────────────────────
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

    /**
     * Restaurant or salon: distinctive image on logo + hero CSS + gallery → unpaid 404 → pay →
     * live HTML + image bytes → second image republish.
     */
    async function journeyWithImage(templateId, label) {
        const { presetId, config: baseCfg } = loadPresetConfig(templateId);
        const nameV1 = `S52-${label}-V1-${crypto.randomUUID().slice(0, 8)}`;
        const nameV2 = `S52-${label}-V2-${crypto.randomUUID().slice(0, 8)}`;
        const email = `s52-${label.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}@example.com`;
        const c = await loginClient(base, email);

        const duA = dataUrlPng(PNG_A);
        const cfg1 = withBusinessName(baseCfg, nameV1);
        // Real image fields: logo + hero.background (CSS url) + first gallery photo when present
        cfg1.logo = duA;
        if (cfg1.hero && typeof cfg1.hero.background === 'string') {
            const prev = cfg1.hero.background;
            if (/url\s*\(/i.test(prev)) {
                cfg1.hero.background = prev.replace(
                    /url\(\s*['"]?[^'")]+['"]?\s*\)/i,
                    "url('" + duA + "')"
                );
            } else {
                cfg1.hero.background = "url('" + duA + "')";
            }
        }
        // Prefer categories.0.photos.0.src (restaurant/salon gallery)
        if (Array.isArray(cfg1.categories) && cfg1.categories[0]) {
            const cat = cfg1.categories[0];
            if (Array.isArray(cat.photos) && cat.photos[0]) {
                if (typeof cat.photos[0] === 'string') cat.photos[0] = duA;
                else cat.photos[0].src = duA;
            }
        }

        const extracted1 = runExtractImages(cfg1);
        assert.ok(
            extracted1.images.some((i) => (i.dataUrl || '').replace(/\s+/g, '') === duA),
            `${label}: extractImages must include distinctive dataUrl`
        );
        assert.ok(
            !JSON.stringify(extracted1.cleanConfig).includes('data:image/'),
            `${label}: cleanConfig must not embed data:image after extract`
        );
        if (extracted1.cleanConfig.hero && extracted1.cleanConfig.hero.background) {
            assert.ok(
                /url\(\s*['"]?images\//i.test(extracted1.cleanConfig.hero.background),
                `${label}: hero.background must be url(images/…)`
            );
        }

        const slugHint = `s52-${label.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
        const pub = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
            body: JSON.stringify({
                templateId,
                slug: slugHint,
                config: extracted1.cleanConfig,
                images: extracted1.images,
            }),
        });
        assert.strictEqual(pub.status, 200, await pub.clone().text());
        const pubBody = await pub.json();
        assert.ok(pubBody.site && pubBody.site.id, 'site id');
        assert.strictEqual(pubBody.site.paid, false, 'unpaid draft');
        assert.ok(pubBody.site.url == null || pubBody.site.url === '', 'no live url unpaid');
        assert.ok(pubBody.paymentUrl, 'paymentUrl from test-pay');

        const siteId = pubBody.site.id;
        const slug = pubBody.site.slug;

        const liveUnpaid = await fetch(`${base}/live/${slug}/`, { redirect: 'manual' });
        assert.strictEqual(liveUnpaid.status, 404, `${label} unpaid /live must 404`);

        // Pending draft must retain images for first-pay deploy
        const db = JSON.parse(fs.readFileSync(path.join(tmpDir, '.registry.json'), 'utf8'));
        const orders = Object.values(db.orders || {}).filter((o) => o.siteId === siteId);
        assert.ok(orders.length >= 1, 'pending order');
        const pending = orders.find((o) => o.status === 'pending') || orders[0];
        assert.strictEqual(pending.amountCents, pricing.PRICE_CENTS);
        const draftFile = path.join(tmpDir, `_pending-${pending.id}.json`);
        assert.ok(fs.existsSync(draftFile), 'pending draft file for order');
        const draft = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
        assert.ok(
            Array.isArray(draft.images) &&
                draft.images.some((i) => i && (i.dataUrl || '').replace(/\s+/g, '') === duA),
            `${label}: unpaid pending draft must keep replaced photo dataUrl`
        );

        const event = {
            id: 'evt_s52_' + crypto.randomUUID().slice(0, 10),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: pending.stripeSessionId,
                    payment_status: 'paid',
                    metadata: {
                        platform: 'web',
                        orderId: pending.id,
                        siteId,
                        kind: 'publish',
                    },
                },
            },
        };
        const wh = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event),
        });
        assert.strictEqual(wh.status, 200, await wh.clone().text());

        await waitForStatus(base, `/live/${slug}/`, 200);

        const site = registry.getSite(siteId);
        assert.strictEqual(site.paid, true);
        assert.ok(site.url && site.url.includes('/live/' + slug), 'live URL isolated');

        const live1 = await fetch(site.url.startsWith('http') ? site.url : base + site.url);
        assert.strictEqual(live1.status, 200);
        const html1 = await live1.text();
        assert.ok(html1.includes(nameV1), `${label} live HTML must contain ${nameV1}`);
        assert.ok(
            /images\/[a-z0-9._-]+\.(jpg|jpeg|png|webp)/i.test(html1),
            `${label} live HTML must reference images/… file (not leftover remote preset only)`
        );
        // Collect all local image refs and require at least one matches PNG_A
        const refs = new Set();
        const reSrc = /(?:src|href)=["'](images\/[^"']+)["']/gi;
        const reUrl = /url\(\s*['"]?(images\/[^'")\s]+)['"]?\s*\)/gi;
        let mm;
        while ((mm = reSrc.exec(html1))) refs.add(mm[1]);
        while ((mm = reUrl.exec(html1))) refs.add(mm[1]);
        assert.ok(refs.size >= 1, `${label}: must find images/… ref in live HTML`);
        let matchedA = false;
        for (const imgRel of refs) {
            const imgRes = await fetch(`${base}/live/${slug}/${imgRel}`);
            if (imgRes.status !== 200) continue;
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            if (imgBuf.equals(PNG_A)) {
                matchedA = true;
                break;
            }
        }
        assert.ok(
            matchedA,
            `${label}: at least one live images/… file must equal distinctive PNG_A (not leftover preset)`
        );

        // Edit + republish with second distinctive image
        const duB = dataUrlPng(PNG_B);
        const cfg2 = withBusinessName(baseCfg, nameV2);
        cfg2.logo = duB;
        if (cfg2.hero && typeof cfg2.hero.background === 'string') {
            const prev = cfg2.hero.background;
            if (/url\s*\(/i.test(prev)) {
                cfg2.hero.background = prev.replace(
                    /url\(\s*['"]?[^'")]+['"]?\s*\)/i,
                    "url('" + duB + "')"
                );
            } else {
                cfg2.hero.background = "url('" + duB + "')";
            }
        }
        if (Array.isArray(cfg2.categories) && cfg2.categories[0] && Array.isArray(cfg2.categories[0].photos) && cfg2.categories[0].photos[0]) {
            if (typeof cfg2.categories[0].photos[0] === 'string') cfg2.categories[0].photos[0] = duB;
            else cfg2.categories[0].photos[0].src = duB;
        }
        const extracted2 = runExtractImages(cfg2);

        const rep = await c('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                siteId,
                templateId,
                config: extracted2.cleanConfig,
                images: extracted2.images,
            }),
        });
        assert.strictEqual(rep.status, 200, await rep.clone().text());
        const repBody = await rep.json();
        assert.strictEqual(repBody.site.paid, true);
        assert.ok(repBody.site.url);

        const deadline = Date.now() + 12000;
        let html2 = '';
        let matchedB = false;
        while (Date.now() < deadline) {
            const live2 = await fetch(`${base}/live/${slug}/`);
            assert.strictEqual(live2.status, 200);
            html2 = await live2.text();
            if (html2.includes(nameV2)) {
                const refs2 = new Set();
                let m2;
                const re2 = /(?:src|href)=["'](images\/[^"']+)["']/gi;
                const reU2 = /url\(\s*['"]?(images\/[^'")\s]+)['"]?\s*\)/gi;
                while ((m2 = re2.exec(html2))) refs2.add(m2[1]);
                while ((m2 = reU2.exec(html2))) refs2.add(m2[1]);
                for (const rel of refs2) {
                    const r2 = await fetch(`${base}/live/${slug}/${rel}`);
                    if (r2.status !== 200) continue;
                    const b = Buffer.from(await r2.arrayBuffer());
                    if (b.equals(PNG_B)) {
                        matchedB = true;
                        break;
                    }
                }
                if (matchedB) break;
            }
            await sleep(50);
        }
        assert.ok(html2.includes(nameV2), `${label} republish must show v2 name`);
        assert.ok(!html2.includes(nameV1), `${label} v1 name must be gone after republish`);
        assert.ok(matchedB, `${label}: live image must update to PNG_B after republish`);
        void presetId;
    }

    await check('restaurant product-menu: image replace → unpaid 404 → pay → live bytes → republish', async () => {
        await journeyWithImage('product-menu', 'REST');
    });

    await check('salon portfolio: image replace → unpaid 404 → pay → live bytes → republish', async () => {
        await journeyWithImage('portfolio', 'SALON');
    });

    await check('pricing still 9900 / 2900 only', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll s52-image-replace-live checks passed.');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
