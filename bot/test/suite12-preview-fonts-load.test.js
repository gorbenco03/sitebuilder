'use strict';
/**
 * bot/test/suite12-preview-fonts-load.test.js
 *
 * UPDATE 2026-10-28: the form editor and its sandboxed srcdoc preview iframe were
 * removed, so everything below about the PREVIEW (the CORS header on
 * /app/generated/template-assets fonts, the iframe sandbox tokens) is historical
 * and its checks are gone. The guarantee that reaches customers stays and is now
 * checked on the PUBLISHED site: every desserdirina @font-face loads on
 * /live/<slug>/, with no font console errors.
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
 * This file checks, on the published desserdirina site in a real browser:
 *   - every declared @font-face in document.fonts loads (not "error") once
 *     forced via FontFace#load(), Cormorant Garamond and Montserrat included;
 *   - no font-related console errors are logged getting there.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-preview-fonts-load.test.js
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { startHarness, publishConfig, loadPlaywright } = require('./lib/old-template-live.js');

test('desserdirina published site: every @font-face loads, zero font console errors', async () => {
    const H = await startHarness('suite12-fonts');
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
        const { liveUrl } = await H.publish('desserdirina', publishConfig('desserdirina'));
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultTimeout(30000);

        const consoleErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto(liveUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('.hero, .hero-wordmark, .hero-tagline').first().waitFor({
            state: 'visible',
            timeout: 20000,
        });

        // Force every declared face to actually load (not just the ones the
        // initially-rendered text happens to trigger) so the assertion covers
        // all 20 @font-face rules, not whichever subset paints first.
        const faces = await page.evaluate(async () => {
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

        const fontErrors = consoleErrors.filter((m) => /font/i.test(m));
        assert.deepStrictEqual(
            fontErrors, [],
            'zero font console errors expected, got: ' + JSON.stringify(fontErrors)
        );
    } finally {
        await browser.close();
        await H.close();
    }
});
