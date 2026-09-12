'use strict';
/**
 * bot/test/suite1-new-item-has-all-fields.test.js
 *
 * PLAN-QA-2026-09-12 §3 Suite 1, step S1-2 — oracle for M1 ("elementul nou e
 * mai sărac decât cel din preset"), the defect that appears in 4/4 external
 * feedback documents and 3 of the QA-exploration reports (02-editor-core.md
 * D1/D2/D4).
 *
 * Root cause: every template hides an optional itemShape field with
 * `<!-- @if field -->…<!-- @endif -->`. That is correct on the PUBLISHED
 * site (an empty `<p></p>` should not render), but wrong in the EDITOR:
 * `onListAdd()` (builder/app.js) seeds a brand-new item with '' for every
 * non-primary itemShape key, so the freshly rendered card has no
 * `[data-hb-edit]` element at all for that key — nothing exists to click on
 * to type a price/description into.
 *
 * This oracle does NOT hardcode which templates/lists/fields are affected.
 * It reads each template's own schema.json, walks every `type:"list"` field
 * that declares an object `itemShape` (or the desserdirina-spelled
 * `itemSchema`), and for every key in that shape EXCEPT `photos` (a separate
 * suite — see PLAN §3 Suite 2) asserts that after clicking "+ Adaugă" the
 * new item has a `[data-hb-edit="<listPath>.<newIndex>.<key>"]` element with
 * a real, clickable bounding box (>= 40x16px, matching the fix's min-height/
 * min-width placeholder box — see builder/edit-overlay.js CSS + build.js
 * data-hb-placeholder). A list without "+ Adaugă" wiring today (e.g.
 * credentials.items — B3/M2, a different defect) is skipped, not failed, so
 * this oracle keeps working unchanged once another in-flight change
 * (edit-overlay.js's SAFE_LIST_PATHS → schema-derived list detection) makes
 * more lists addable.
 *
 * Two deliberate narrowings, both matching what THIS suite's task actually
 * assigns (not everything an itemShape could theoretically contain):
 *   - only itemShape keys declared literally `"text"` are checked. `"photos"`
 *     is Suite 2's problem (a gallery/upload UI, not a text placeholder), and
 *     a few itemShape values are themselves `"list"` (e.g. product-menu's
 *     `menu.en/ro` sections carry `items: "list"`, a nested @each, not a
 *     leaf field) — neither has anything to do with @if-hides-empty-field.
 *   - the `icon` key is skipped everywhere. PLAN-QA-2026-09-12 §3 Suite 1
 *     step S1-7 explicitly punts icon editing to its own, separate decision
 *     ("emoji picker inline vs. drop from schema — 1 zi de om nu merită") —
 *     it is not part of B2/M1/m3, the three defects this suite's task
 *     assigns. Leaving it unfiltered here would keep this oracle red forever
 *     for a defect this task was never asked to fix.
 *
 * Expected to fail today (before the build.js/build-builder.js fix) on:
 *   - portfolio      services.N.price   (missing entirely — `@if price`)
 *   - professionals  services.N.blurb   (missing entirely — `@if blurb`)
 *   - professionals  process.steps.N.text (missing entirely — `@if text`)
 *   - desserdirina   categories.N.blurb (present but 0×0 — no placeholder)
 *
 * Run: node --experimental-sqlite --test bot/test/suite1-new-item-has-all-fields.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

// This oracle runs inside a git worktree that has no node_modules of its own
// (worktrees are a plain checkout, not a fresh `npm install`) — fall back to
// the main checkout's / the agent host's playwright install, same pattern
// bot/test/delete-site-oracle.mjs and audit-editor-list-add.test.js already
// use. Never a hardcoded browser executable — only the package location.
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s1-new-item-'));
process.env.SERVER_SECRET = 's1-new-item-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

const TEMPLATES = ['local-service', 'portfolio', 'professionals', 'desserdirina', 'product-menu'];

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

/** Same flattening builder/app.js's getAllSchemaFields() does — kept local
 *  and dependency-free so this oracle never depends on the app bundle. */
function getAllSchemaFields(schema) {
  if (!schema || !Array.isArray(schema.sections)) return [];
  const out = [];
  schema.sections.forEach((s) => (s.fields || []).forEach((f) => out.push(f)));
  return out;
}

function loadSchema(templateId) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'schema.json'), 'utf8'));
}

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

/**
 * Runs INSIDE the preview iframe. Finds the list's LAST existing item purely
 * from data-hb-edit paths (no CSS selector guesswork), climbs to its
 * `.hb-list-item` container — the same class edit-overlay.js's
 * setupListControls() stamps on it — and clicks the `.hb-add-btn` it
 * inserted as that container's next sibling. This mirrors edit-overlay.js's
 * OWN lookup, so it works for any list the overlay currently wires up,
 * whatever SAFE_LIST_PATHS (or its schema-derived replacement) contains at
 * merge time.
 */
async function clickAddButtonFor(iframeCtx, listPath) {
  return iframeCtx.evaluate((listPath) => {
    const all = Array.from(document.querySelectorAll('[data-hb-edit]'));
    const prefix = listPath + '.';
    let maxIdx = -1;
    all.forEach((el) => {
      const p = el.getAttribute('data-hb-edit');
      if (p === listPath || p.indexOf(prefix) === 0) {
        const rest = p.length > listPath.length ? p.slice(listPath.length + 1) : '';
        const idx = parseInt(rest.split('.')[0], 10);
        if (!Number.isNaN(idx) && idx > maxIdx) maxIdx = idx;
      }
    });
    if (maxIdx < 0) return { found: false, reason: 'no existing item found for "' + listPath + '"' };
    const itemPath = listPath + '.' + maxIdx;
    const itemEls = all.filter((el) => {
      const p = el.getAttribute('data-hb-edit');
      return p === itemPath || p.indexOf(itemPath + '.') === 0;
    });
    let container = null;
    for (const el of itemEls) {
      let cur = el;
      while (cur && cur !== document.body) {
        if (cur.classList && cur.classList.contains('hb-list-item')) { container = cur; break; }
        cur = cur.parentElement;
      }
      if (container) break;
    }
    if (!container) return { found: false, reason: 'no .hb-list-item ancestor for "' + itemPath + '"' };
    let sib = container.nextElementSibling;
    let addBtn = null;
    let hops = 0;
    while (sib && hops < 5) {
      if (sib.classList && sib.classList.contains('hb-add-btn')) { addBtn = sib; break; }
      sib = sib.nextElementSibling;
      hops++;
    }
    if (!addBtn) return { found: false, reason: 'no .hb-add-btn sibling after last item of "' + listPath + '"' };
    const rect = addBtn.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { found: false, reason: '.hb-add-btn has a zero-size box' };
    addBtn.scrollIntoView({ block: 'center' });
    addBtn.click();
    return { found: true, newIndex: maxIdx + 1 };
  }, listPath);
}

TEMPLATES.forEach((templateId) => {
  test(`suite1-new-item-has-all-fields: ${templateId}`, async (t) => {
    const schema = loadSchema(templateId);
    const listFields = getAllSchemaFields(schema).filter((f) => {
      const shape = f.itemShape !== undefined ? f.itemShape : f.itemSchema;
      return f.type === 'list' && shape && typeof shape === 'object';
    });
    if (listFields.length === 0) {
      t.skip(`${templateId}: no object-itemShape lists declared in schema.json`);
      return;
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await openTemplateEditor(page, templateId);
      const iframeHandle = await page.$('#preview-iframe');
      const iframeCtx = await iframeHandle.contentFrame();

      for (const field of listFields) {
        const itemShape = field.itemShape !== undefined ? field.itemShape : field.itemSchema;
        // Only scalar text leaves — see the "deliberate narrowings" doc
        // comment above for why "photos", nested "list" values, and "icon"
        // are excluded.
        // `photo` is declared "text" in portfolio's team.members itemShape but
        // holds an image path rendered as <img src>, so it has no text box to
        // click — images are Suite 2's scope, not this oracle's. Same reason
        // as `icon`. If either ever grows a real editing surface, drop it here.
        const IMAGE_LIKE = ['icon', 'photo', 'photos', 'image', 'img'];
        const keys = Object.keys(itemShape).filter(
          (k) => itemShape[k] === 'text' && IMAGE_LIKE.indexOf(k) === -1
        );
        if (keys.length === 0) continue;

        const result = await clickAddButtonFor(iframeCtx, field.key);
        if (!result.found) {
          await t.test(`${field.key}: skipped — ${result.reason}`, () => {});
          continue;
        }
        // fullRerender rebuilds the whole iframe (~700ms per the QA-explorare
        // measurement in 02-editor-core.md S2) — wait for the new srcdoc to
        // settle before inspecting it.
        await page.waitForTimeout(900);
        const newIframeHandle = await page.$('#preview-iframe');
        const newIframeCtx = await newIframeHandle.contentFrame();

        const newItemPath = field.key + '.' + result.newIndex;
        const measurements = await newIframeCtx.evaluate(({ newItemPath, keys }) => {
          return keys.map((k) => {
            const el = document.querySelector('[data-hb-edit="' + newItemPath + '.' + k + '"]');
            if (!el) return { key: k, present: false, w: 0, h: 0 };
            const r = el.getBoundingClientRect();
            return { key: k, present: true, w: r.width, h: r.height };
          });
        }, { newItemPath: newItemPath, keys: keys });

        for (const m of measurements) {
          await t.test(`${templateId} ${field.key}.${m.key}: clickable on the freshly added item`, () => {
            assert.ok(
              m.present,
              `${templateId} ${field.key}: itemShape key "${m.key}" has NO [data-hb-edit="${newItemPath}.${m.key}"] element — nothing to click`
            );
            assert.ok(m.w >= 40, `${templateId} ${field.key}.${m.key}: width ${m.w}px < 40px (${JSON.stringify(m)})`);
            assert.ok(m.h >= 16, `${templateId} ${field.key}.${m.key}: height ${m.h}px < 16px (${JSON.stringify(m)})`);
          });
        }
      }
    } finally {
      await page.close();
    }
  });
});
