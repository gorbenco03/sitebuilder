'use strict';
/**
 * bot/test/suite1-empty-field-stays-clickable.test.js
 *
 * PLAN-QA-2026-09-12 §3 Suite 1, step S1-3 — oracle for B2 (blocker):
 * emptying a text field (click → Ctrl/Cmd+A → Delete → blur) collapses its
 * `[data-hb-edit]` span to a 0×0 box. The element is still in the DOM
 * (`contenteditable="true"`, `textContent === ''`) but has no rendered
 * dimensions, so a real click can never land on it again — Playwright's own
 * actionability check fails with "element is outside of the viewport",
 * exactly the failure 02-editor-core.md D5 captured. The only recovery today
 * is Ctrl+Z (Undo); a user who wanted to retype the title has no way back.
 *
 * Covers both field shapes mentioned in the task brief:
 *   - a single-line field: `business.name` (the hero title/wordmark) — every
 *     template's schema declares it `type:"text"` with a `maxLen`.
 *   - a multi-line field: `business.about` (the "Despre noi" paragraph) —
 *     every template's schema declares it `type:"textarea"`.
 *   `business.name` renders more than once per page (nav brand, hero
 *   wordmark, footer, sr-only heading, …) — this oracle targets the first
 *   VISIBLE instance (`:visible`), the one a real owner would actually see
 *   and click, not the accessibility-only sr-only copy.
 *
 * Acceptance (per PLAN-QA-2026-09-12 task brief): after emptying, the
 * field's own bounding box stays >= 24px tall, and a real click on it
 * refocuses it (`document.activeElement` is that exact element again).
 *
 * Run: node --experimental-sqlite --test bot/test/suite1-empty-field-stays-clickable.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

// See suite1-new-item-has-all-fields.test.js's loadPlaywright() doc comment:
// this worktree has no node_modules of its own.
function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'playwright'),
    '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s1-empty-field-'));
process.env.SERVER_SECRET = 's1-empty-field-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

const TEMPLATES = ['local-service', 'portfolio', 'professionals', 'desserdirina', 'product-menu'];
const FIELDS = [
  { path: 'business.name', kind: 'single-line (title)' },
  { path: 'business.about', kind: 'multi-line (paragraph)' },
];

let server;
let base;
let browser;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function openTemplateEditor(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
    await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

TEMPLATES.forEach((templateId) => {
  FIELDS.forEach(({ path: fieldPath, kind }) => {
    test(`suite1-empty-field-stays-clickable: ${templateId} ${fieldPath} (${kind})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(30000);
      try {
        await openTemplateEditor(page, templateId);
        const frame = page.frameLocator('#preview-iframe');

        // `business.name` renders more than once per page (nav brand, hero
        // wordmark, footer, an sr-only heading, …) and — see the debug trail
        // that led here — committing an edit to it triggers a FULL iframe
        // re-render (a fresh srcdoc, to keep every occurrence in sync), not
        // the live in-place DOM edit plain single-occurrence fields get. So
        // this cannot tag one DOM node and keep re-using that exact node
        // (the tag would not survive the reload), and it cannot use a
        // `:visible` selector either (that stops matching the instant the
        // field collapses to 0×0 — the very bug under test — and Playwright
        // then hangs re-resolving a locator that can never match again).
        // Instead: find the POSITION of the first visible occurrence once,
        // then always address it as "the Nth `[data-hb-edit="path"]` match"
        // — a plain attribute-equality locator that re-resolves correctly
        // against whatever document is live at the time, re-render or not.
        const iframeHandle = await page.$('#preview-iframe');
        const iframeCtx = await iframeHandle.contentFrame();
        const visibleIndex = await iframeCtx.evaluate((path) => {
          const els = Array.from(document.querySelectorAll('[data-hb-edit="' + path + '"]'));
          return els.findIndex((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
        }, fieldPath);
        assert.ok(visibleIndex >= 0, `${templateId} ${fieldPath}: no visible occurrence found before the test even started`);

        const target = frame.locator(`[data-hb-edit="${fieldPath}"]`).nth(visibleIndex);
        const before = await target.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, text: el.textContent };
        });
        assert.ok(before.w > 0 && before.h > 0, `${templateId} ${fieldPath}: field is not even visible before editing`);
        assert.ok((before.text || '').trim().length > 0, `${templateId} ${fieldPath}: field is already empty before the test — cannot exercise the empty-out repro`);

        // Click → select-all → delete → blur (Tab moves focus away, the
        // standard way to trigger a real blur event on a contenteditable).
        await target.click();
        await page.keyboard.press('Control+A').catch(() => {});
        await page.keyboard.press('Meta+A').catch(() => {});
        await page.keyboard.press('Delete');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400);

        const after = await target.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, text: el.textContent };
        });
        assert.equal((after.text || '').trim(), '', `${templateId} ${fieldPath}: field did not actually go empty`);
        assert.ok(
          after.h >= 24,
          `${templateId} ${fieldPath}: emptied field collapsed to ${after.w}x${after.h}px (must stay >= 24px tall so it can be clicked again)`
        );

        // The real acceptance criterion: a genuine click must be able to
        // land on the field again. Playwright's own actionability check
        // times out here today (0x0 box) — that IS the reported bug.
        let clicked = true;
        let clickError = null;
        try {
          await target.click({ timeout: 5000 });
        } catch (e) {
          clicked = false;
          clickError = e.message;
        }
        assert.ok(
          clicked,
          `${templateId} ${fieldPath}: could not click the emptied field again (${clickError}) — same "Element is outside of the viewport" failure as 02-editor-core.md D5`
        );

        // `business.name` renders more than once per page — confirm it is
        // THIS exact element (not merely "some element with the same path")
        // that got refocused.
        const refocused = await target.evaluate((el) => document.activeElement === el);
        assert.ok(refocused, `${templateId} ${fieldPath}: click landed but did not refocus this exact field (document.activeElement mismatch)`);
      } finally {
        await page.close();
      }
    });
  });
});
