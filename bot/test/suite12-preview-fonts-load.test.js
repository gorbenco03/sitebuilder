'use strict';
/**
 * bot/test/suite12-preview-fonts-load.test.js
 *
 * Explorer's verified finding (reproduced twice; also open item "m2" from an
 * earlier QA plan): in the editor preview, desserdirina never loaded its own
 * self-hosted fonts (Cormorant Garamond / Montserrat, templates/desserdirina/
 * fonts/*.woff2, declared via @font-face in templates/desserdirina/
 * styles.css). The preview iframe is a sandboxed `srcdoc` document with no
 * `allow-same-origin` (bot/test/suite9-preview-sandbox.test.js guards that,
 * and it stays that way — see that file's header for why), which gives it an
 * opaque "null" origin. Two independent things were wrong for that origin:
 *
 *   1. renderPreview() (scripts/build-builder.js) inlines styles.css verbatim
 *      into a <style> tag. A srcdoc document has no template-relative base
 *      URL, so styles.css's own relative url('fonts/x.woff2') resolved
 *      against the /app/ document instead — a path that doesn't exist, so it
 *      fell through serveStatic()'s SPA fallback to index.html (200, but the
 *      wrong bytes and the wrong content-type).
 *   2. Even pointed at the real file, @font-face fetches are always CORS-mode
 *      — unlike <img src>, which is why the template's images never needed
 *      this — so the opaque srcdoc origin needs Access-Control-Allow-Origin
 *      on the response before the browser will use it.
 *
 * The fix: scripts/build-builder.js now copies templates/<id>/fonts/*.woff2
 * next to the already-existing template-assets/<id>/images/* tree and
 * rewrites the inlined CSS to the real, absolute /app/generated/
 * template-assets/<id>/fonts/<file> URL; bot/server.js adds
 * Access-Control-Allow-Origin: * to responses under that font-file path only
 * (never credentials, never a blanket grant on the rest of /app/).
 *
 * This file checks, in the real builder:
 *   - every desserdirina @font-face declared in document.fonts loads (not
 *     "error") once forced via FontFace#load(), and zero font CORS console
 *     errors are logged getting there;
 *   - the preview iframe sandbox still lacks allow-same-origin (the fix is
 *     the asset path + CORS header, never the sandbox);
 *   - the font file responses themselves carry ACAO with no credentials
 *     flag, and unrelated /app/ routes carry no ACAO at all (scoped, not
 *     blanket, CORS).
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-preview-fonts-load.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-fonts-'));
process.env.DATA_DIR = dataDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.SERVER_SECRET = 'suite12-fonts-test-secret';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.HIDOOK_FAKE_DEPLOY;

// The fix lives partly in scripts/build-builder.js's font-copying/CSS-rewrite
// step — make sure builder/generated/* reflects the current source before the
// server serves it, the same way npm run build:app does in dev/CI.
execFileSync('node', [path.join(ROOT, 'scripts', 'build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
});

const { startServer } = require('../server.js');

let server;
let base;

test.before(async () => {
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('desserdirina font-asset responses carry ACAO, correct type, no credentials flag', async () => {
    const fontDir = path.join(ROOT, 'templates', 'desserdirina', 'fonts');
    const names = fs.readdirSync(fontDir).filter((n) => /\.(?:woff2?|ttf|otf)$/i.test(n));
    assert.ok(names.length > 0, 'expected real font files under templates/desserdirina/fonts/');

    for (const name of names) {
        const url = base + '/app/generated/template-assets/desserdirina/fonts/' + name;
        const r = await fetch(url, { headers: { Origin: 'null' } });
        assert.equal(r.status, 200, url + ' must 200 (the real asset, not the SPA-fallback index.html)');
        assert.equal(
            r.headers.get('access-control-allow-origin'), '*',
            url + ' must carry ACAO so the opaque srcdoc preview origin can use it'
        );
        assert.equal(
            r.headers.get('access-control-allow-credentials'), null,
            url + ' must never pair a wildcard ACAO with a credentials flag'
        );
        assert.match(r.headers.get('content-type') || '', /^font\//i, url + ' content-type');
    }
});

test('non-font /app/ routes carry no Access-Control-Allow-Origin (scoped, not blanket, CORS)', async () => {
    const routes = ['/app/', '/app/app.js', '/app/app.css', '/app/generated/templates-data.js'];
    for (const route of routes) {
        const r = await fetch(base + route, { headers: { Origin: 'null' } });
        assert.equal(
            r.headers.get('access-control-allow-origin'), null,
            route + ' must not carry the font-only CORS header'
        );
    }
});

test('desserdirina preview in the real builder: every @font-face loads, sandbox unchanged, zero font CORS errors', async () => {
    let chromium;
    try {
        ({ chromium } = require(path.join(ROOT, 'node_modules', 'playwright')));
    } catch {
        assert.fail('playwright not available — see HARD RULES: "Playwright from node_modules only"');
    }

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultTimeout(30000);

        const consoleErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
        if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
            await page.locator('#hb-cookie-accept').click().catch(() => {});
        }
        await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/, { timeout: 30000 });

        const iframeLocator = page.locator('#preview-iframe');
        await iframeLocator.waitFor({ state: 'visible', timeout: 30000 });

        // The fix is the asset path + CORS header, never the sandbox — assert
        // that stays true (bot/test/suite9-preview-sandbox.test.js owns this
        // more generally; re-asserted here so a regression that "fixed" fonts
        // by loosening the sandbox fails in the same file as the font check).
        const sandboxAttr = await iframeLocator.getAttribute('sandbox');
        const tokens = new Set(String(sandboxAttr || '').split(/\s+/).filter(Boolean));
        assert.ok(!tokens.has('allow-same-origin'), '#preview-iframe must stay without allow-same-origin');

        const frameHandle = await iframeLocator.elementHandle();
        const contentFrame = await frameHandle.contentFrame();
        await contentFrame.locator('body').waitFor({ state: 'attached', timeout: 20000 });
        await contentFrame.locator('.hero, .hero-wordmark, .hero-tagline').first().waitFor({
            state: 'visible',
            timeout: 20000,
        });

        // Force every declared face to actually load (not just the ones the
        // initially-rendered text happens to trigger) so the assertion covers
        // all 20 @font-face rules, not whichever subset paints first.
        const faces = await contentFrame.evaluate(async () => {
            const list = Array.from(document.fonts);
            await Promise.all(list.map((f) => f.load().catch(() => {})));
            return list.map((f) => ({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
        });

        assert.ok(faces.length > 0, 'expected desserdirina @font-face rules to register in document.fonts');
        const notLoaded = faces.filter((f) => f.status !== 'loaded');
        assert.deepStrictEqual(notLoaded, [], 'every declared face must report "loaded": ' + JSON.stringify(notLoaded));

        const families = new Set(faces.map((f) => f.family));
        assert.ok(families.has('Cormorant Garamond'), 'Cormorant Garamond must be registered in document.fonts');
        assert.ok(families.has('Montserrat'), 'Montserrat must be registered in document.fonts');

        const fontCorsErrors = consoleErrors.filter(
            (m) => /blocked by CORS policy/i.test(m) && /font/i.test(m)
        );
        assert.deepStrictEqual(
            fontCorsErrors, [],
            'zero font CORS console errors expected, got: ' + JSON.stringify(fontCorsErrors)
        );
    } finally {
        await browser.close();
    }
});
