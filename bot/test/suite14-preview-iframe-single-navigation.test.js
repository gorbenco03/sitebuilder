'use strict';
/**
 * bot/test/suite14-preview-iframe-single-navigation.test.js
 *
 * Owner report (2026-09-21): the landing "Previzualizare" still spun forever
 * in Chrome, after the 2026-09-15 fix for rAF throttling was deployed.
 *
 * Reproduced on production: the modal kept showing "Se încarcă
 * previzualizarea…" while the iframe's srcdoc already held the full template.
 * openPreviewModal() swaps the iframe by cloneNode(false) + replaceWith() and
 * then assigns srcdoc. cloneNode copies the srcdoc ATTRIBUTE — the placeholder
 * from the previous swap — so inserting the clone starts a navigation to the
 * placeholder, and in Chromium the srcdoc assigned right after insertion never
 * took. On the live page, removing the attribute before insertion made the
 * real document run and send its ready message; leaving it in place never did.
 *
 * Headless Chromium here does not lose that race on its own, so this test
 * asserts the cause directly: every iframe the preview inserts arrives WITHOUT
 * a srcdoc attribute, so there is exactly one navigation per document. It also
 * checks the preview still becomes ready for every template.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite14-preview-nav-'));
process.env.SERVER_SECRET = 'suite14-preview-nav-' + crypto.randomBytes(8).toString('hex');
delete process.env.CALENDAR_PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

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

test.after(() => {
    if (server) server.close();
});

// Records, for every replaceWith() that inserts #preview-modal-iframe, whether
// the node being inserted already carries a srcdoc attribute.
const RECORD_INSERTS = `
  (function () {
    var orig = Element.prototype.replaceWith;
    window.__previewInserts = [];
    Element.prototype.replaceWith = function () {
      for (var i = 0; i < arguments.length; i++) {
        var n = arguments[i];
        if (n && n.id === 'preview-modal-iframe' && n.tagName === 'IFRAME') {
          window.__previewInserts.push({ hadSrcdoc: n.hasAttribute('srcdoc') });
        }
      }
      return orig.apply(this, arguments);
    };
  })();
`;

test('landing preview inserts each iframe without an inherited srcdoc, and every template gets ready', async () => {
    const browser = await chromium.launch({ headless: true });
    const problems = [];
    try {
        for (const templateId of TEMPLATE_IDS) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
            await context.addInitScript(RECORD_INSERTS);
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
                        return !!el && el.dataset.previewReady === 'true';
                    }, { timeout: 15000 });
                } catch (_) {
                    ready = false;
                }
                const inserts = await page.evaluate(() => window.__previewInserts || []);
                if (inserts.length < 2) problems.push(`${templateId}: expected a placeholder and a document swap, saw ${inserts.length}`);
                const inherited = inserts.filter((x) => x.hadSrcdoc).length;
                if (inherited) problems.push(`${templateId}: ${inherited} iframe(s) inserted still carrying the previous srcdoc`);
                if (!ready) problems.push(`${templateId}: preview never reported ready`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepEqual(problems, [], problems.join('\n'));
});
