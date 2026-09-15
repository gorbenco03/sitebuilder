'use strict';
/**
 * bot/test/suite12-preview-ready-without-raf.test.js
 *
 * Owner report (2026-09-14, point 5): the landing page "Previzualizare" modal
 * works on the owner's Mac (Safari) but not on Windows.
 *
 * ROOT CAUSE, reproduced on production (lp.hidook.agency) in a Chromium
 * browser: the modal stayed on "Se încarcă previzualizarea…" with the full
 * template already in the iframe's srcdoc. The ready script builder/app.js
 * injects into the preview announced readiness ONLY through
 * requestAnimationFrame — both the normal path and the n>80 "fallback".
 * Chromium (Chrome, Edge) stops rAF in a cross-origin iframe it considers not
 * visible (an occluded or minimised window, a background tab), and the
 * preview is a sandboxed opaque-origin srcdoc, i.e. cross-origin. In that
 * browser a probe iframe with the same sandbox received postMessage from
 * synchronous code, DOMContentLoaded, setTimeout and setInterval — and never
 * from requestAnimationFrame, while the parent page's own rAF fired normally.
 * Replacing just those two calls with a timer on the live page made the ready
 * message arrive and the modal leave its loading state.
 *
 * Headless Chromium in Playwright does not apply that throttling, which is why
 * suite12-template-preview-cross-env could not reproduce it. So this test
 * reproduces the condition deterministically instead of hoping for it: an init
 * script makes requestAnimationFrame never fire INSIDE child frames only (the
 * parent page is visible in the real case and keeps a working rAF). Before the
 * fix every template's preview hangs; after it, each one reaches
 * data-preview-ready="true".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const playwright = require(path.join(ROOT, 'node_modules', 'playwright'));

const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-raf-'));
process.env.SERVER_SECRET = 'suite12-raf-' + crypto.randomBytes(8).toString('hex');
delete process.env.CALENDAR_PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

let server;
let base;

test.before(async () => {
    require(path.join(ROOT, 'scripts', 'build-builder.js'));
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
    if (server) server.close();
});

// Runs in every frame. Only child frames lose rAF: that is Chromium's
// behaviour for a not-visible cross-origin iframe inside a visible page.
const THROTTLE_CHILD_RAF = `
  if (window.parent !== window) {
    window.requestAnimationFrame = function () { return 0; };
    window.cancelAnimationFrame = function () {};
  }
`;

test('landing preview becomes ready even when the iframe never gets an animation frame', async () => {
    const browser = await playwright.chromium.launch({ headless: true });
    try {
        const results = {};
        for (const templateId of TEMPLATE_IDS) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
            await context.addInitScript(THROTTLE_CHILD_RAF);
            const page = await context.newPage();
            try {
                await page.goto(base + '/app/#templates', { waitUntil: 'load' });
                const btn = page.locator('.btn-preview-tpl[data-id="' + templateId + '"]');
                await btn.waitFor({ state: 'visible', timeout: 20000 });
                await btn.click();
                let ready = true;
                try {
                    await page.waitForFunction(() => {
                        const el = document.getElementById('preview-modal-iframe');
                        return !!el && el.dataset.previewReady === 'true' &&
                            el.getAttribute('aria-busy') === 'false' &&
                            !el.classList.contains('preview-iframe--loading');
                    }, { timeout: 8000 });
                } catch (_) {
                    ready = false;
                }
                results[templateId] = ready;
            } finally {
                await context.close();
            }
        }
        const stuck = Object.keys(results).filter((id) => !results[id]);
        assert.deepEqual(stuck, [],
            'preview stuck on "Se încarcă previzualizarea…" when the iframe gets no animation frames: ' +
            stuck.join(', '));
    } finally {
        await browser.close();
    }
});
