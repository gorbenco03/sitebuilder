'use strict';
/**
 * bot/test/suite12-editor-topbar-no-overlap.test.js
 *
 * Integration regression (2026-09-15): the "Text de exemplu" legend added next
 * to the checklist pill made .editor-topbar-right wide enough, at an ordinary
 * 1280px laptop width, to overflow backwards over the left group — the
 * checklist pill sat on top of the "Mobil" preview button. Playwright
 * described it exactly: visible, enabled, stable, and another element
 * intercepts pointer events. The desserdirina OCR test only caught it because
 * it happened to click that button.
 *
 * This asserts the property directly for every left-group control at common
 * laptop and desktop widths, on a fresh draft where the legend IS showing:
 * the topmost element at the control's centre is the control itself.
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-topbar-overlap-'));
process.env.SERVER_SECRET = 'topbar-overlap-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

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

const WIDTHS = [768, 900, 1024, 1180, 1280, 1366, 1440, 1536, 1920];
const TEMPLATES = ['desserdirina', 'professionals'];
const LEFT_CONTROLS = ['#btn-preview-desktop', '#btn-preview-mobile', '#btn-undo', '#btn-redo'];

test('no editor topbar control is covered by another at laptop and desktop widths', async () => {
    const browser = await chromium.launch({ headless: true });
    const covered = [];
    try {
        for (const templateId of TEMPLATES) {
            for (const width of WIDTHS) {
                const context = await browser.newContext({ viewport: { width, height: 900 } });
                const page = await context.newPage();
                try {
                    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
                    await page.locator('.template-card[data-template-id="' + templateId + '"] .btn-start-tpl').click();
                    await page.waitForURL(/#edit$/, { timeout: 30000 });
                    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
                    const drawer = page.locator('#details-drawer');
                    if (await drawer.isVisible().catch(() => false)) {
                        await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
                        await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                    }
                    await page.waitForFunction(() => {
                        const el = document.getElementById('demo-legend');
                        return !!el && !el.hidden;
                    }, { timeout: 15000 });
                    const result = await page.evaluate((selectors) => selectors.map((sel) => {
                        const el = document.querySelector(sel);
                        if (!el) return { sel, missing: true };
                        // A disabled button (undo/redo on a fresh draft) takes no pointer
                        // events by design, so its hit test lands on the wrapper. Nothing
                        // to cover there; it is checked once it is enabled.
                        if (el.disabled) return { sel, notRendered: true };
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') {
                            return { sel, notRendered: true };
                        }
                        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                        const ok = !!top && (top === el || el.contains(top));
                        return { sel, ok, top: top ? (top.id || top.className || top.tagName) : null };
                    }), LEFT_CONTROLS);
                    for (const r of result) {
                        if (r.missing || r.notRendered) continue;
                        if (!r.ok) covered.push(`${templateId} @ ${width}px: ${r.sel} covered by ${r.top}`);
                    }
                } finally {
                    await context.close();
                }
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepEqual(covered, [], 'topbar controls covered:\n' + covered.join('\n'));
});
