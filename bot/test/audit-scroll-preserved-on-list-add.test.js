'use strict';
/**
 * bot/test/audit-scroll-preserved-on-list-add.test.js
 *
 * Oracle for the product-owner report (2026-09-06/07): "Când adaugi un
 * element nou, pe tine te duce iarăși la începutul paginii, de parcă se face
 * un refresh." ("When you add a new element, it takes you back to the top
 * of the page again, as if a refresh happened.")
 *
 * Root cause: onListAdd() (builder/app.js) mutates draft.config and then
 * calls fullRerender(), which rewrites the preview iframe's `srcdoc` — a
 * brand-new document, so the canvas's scroll position is lost by
 * construction. On a long repeatable list (services, menu dishes, gallery
 * categories, team members) the owner loses their place every single time
 * they add an item.
 *
 * Fix: fullRerender() now captures the OUTGOING document's scroll position
 * before the srcdoc swap and restores it once the new document is
 * interactive — a plain fallback every re-render gets (list add/remove,
 * section reorder, image/color change, ...). onListAdd() additionally passes
 * the new item's own path as a `focusPath`, so sendFocusFieldToIframe()
 * scrolls to AND focuses the freshly created item instead of merely not
 * losing the reader's place.
 *
 * This oracle drives the real editor with Playwright, scrolls the canvas
 * well down into a repeatable list, clicks "+ Adaugă", and asserts the
 * canvas scroll position after the add is NOT back near the top — on every
 * template that ships a repeatable list, at both 1440x900 (desktop) and
 * 390x844 (mobile). Causal RED against main (scroll always lands at 0 after
 * the add), GREEN after the fix (scroll stays deep in the page).
 *
 * Run: node --experimental-sqlite bot/test/audit-scroll-preserved-on-list-add.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  // Ground rule: never a hardcoded browser binary path — always Playwright's
  // own bundled Chromium, resolved from this repo's own node_modules.
  return require(path.join(ROOT, 'node_modules', 'playwright'));
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-scroll-preserved-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'audit-scroll-preserved-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

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

// Every template that ships at least one repeatable list (schema.json
// sections[].fields[].type === 'list') — see templates/*/schema.json. Each
// case names a "safe list" root (builder/edit-overlay.js's SAFE_LIST_PATHS)
// to exercise; `rootPrefix` is matched against the data-hb-edit path of the
// DOM element immediately before the add button (that is how
// edit-overlay.js's setupListControls() itself places the button — as
// lastContainer.nextSibling — so this is a template-agnostic way to find
// the right control among several lists on one page without hardcoding
// per-template CSS classes).
const CASES = [
  { templateId: 'professionals', rootPrefix: 'services.', label: 'professionals / services' },
  { templateId: 'local-service', rootPrefix: 'services.', label: 'local-service / services (own .hb-ls-add controls)' },
  { templateId: 'product-menu', rootPrefix: 'menu.ro.', label: 'product-menu / menu.ro (dishes)' },
  { templateId: 'portfolio', rootPrefix: 'categories.', label: 'portfolio / categories (gallery)' },
  { templateId: 'desserdirina', rootPrefix: 'categories.', label: 'desserdirina / categories (gallery)' },
];

const VIEWPORTS = [
  { name: '1440x900 (desktop)', width: 1440, height: 900 },
  { name: '390x844 (mobile)', width: 390, height: 844 },
];

async function openTemplateEditor(page, templateId) {
  await page.goto(global.__BASE__ + '/app/', { waitUntil: 'domcontentloaded' });
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
  await page.waitForTimeout(400);
}

/** Find the .hb-add-btn (generic overlay) or .hb-ls-add (local-service's own
 * controls) whose immediately-preceding sibling's data-hb-edit path starts
 * with `rootPrefix`. Returns a JSHandle (possibly null-valued). */
async function findAddButtonForRoot(iframeCtx, rootPrefix) {
  return iframeCtx.evaluateHandle((prefix) => {
    const btns = Array.from(document.querySelectorAll('.hb-add-btn, .hb-ls-add'));
    for (const btn of btns) {
      const prev = btn.previousElementSibling;
      if (!prev) continue;
      const el = prev.matches('[data-hb-edit]') ? prev : prev.querySelector('[data-hb-edit]');
      if (!el) continue;
      const p = el.getAttribute('data-hb-edit') || '';
      if (p.indexOf(prefix) === 0) return btn;
    }
    return null;
  }, rootPrefix);
}

async function runCase(browser, kase, viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, kase.templateId);

    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();

    // Scroll well down into the page — past the top fold — before touching
    // the add control, same as a real owner scrolling down a long page to
    // reach a repeatable list further down.
    await iframeCtx.evaluate(() => {
      const doc = document.documentElement;
      window.scrollTo(0, Math.max(200, Math.floor(doc.scrollHeight * 0.55)));
    });

    const addBtnHandle = await findAddButtonForRoot(iframeCtx, kase.rootPrefix);
    const addBtnEl = addBtnHandle && addBtnHandle.asElement ? addBtnHandle.asElement() : null;
    assert.ok(addBtnEl, kase.label + ': add button not found for list root prefix "' + kase.rootPrefix + '"');

    // Bringing the button into view (as a real click requires) is itself
    // allowed to move the scroll — THIS is the position a human would
    // actually be at the instant before clicking.
    await addBtnEl.scrollIntoViewIfNeeded().catch(() => {});
    const scrollBeforeAdd = await iframeCtx.evaluate(() => window.scrollY);
    assert.ok(
      scrollBeforeAdd > 100,
      kase.label + ': test setup did not actually scroll the canvas down (scrollY=' + scrollBeforeAdd + ') — cannot exercise the bug'
    );

    await addBtnEl.click({ timeout: 10000 });
    // Let saveDraft()+fullRerender()'s srcdoc navigation and settle-render
    // (incl. the animation-forcer + double rAF gate) fully complete.
    await page.waitForTimeout(900);

    const scrollAfterAdd = await page.frameLocator('#preview-iframe').locator('html').evaluate(
      (el) => el.ownerDocument.defaultView.scrollY
    ).catch(async () => {
      // Fallback path if the frame reference above raced the navigation.
      const ctx = await (await page.$('#preview-iframe')).contentFrame();
      return ctx.evaluate(() => window.scrollY);
    });

    // The actual bug: EVERY full re-render used to reset scroll to 0 because
    // a fresh srcdoc is a brand-new document. Assert we are nowhere near the
    // top — the precise pixel value legitimately shifts (the new item's
    // scrollIntoView({block:'center'}) can land it at a different offset
    // than where the add button itself was), so this checks "not thrown back
    // to the top", which is the actual complaint, rather than pixel-exact
    // scroll equality.
    assert.ok(
      scrollAfterAdd > scrollBeforeAdd * 0.3,
      kase.label + ' (' + viewport.name + '): scroll jumped back toward the top after adding an item — ' +
        'before=' + scrollBeforeAdd + ', after=' + scrollAfterAdd +
        ' (owner loses their place exactly like a full page refresh)'
    );
  } finally {
    await page.close();
  }
}

(async function main() {
  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  const port = server.address().port;
  global.__BASE__ = 'http://127.0.0.1:' + port;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    for (const kase of CASES) {
      for (const vp of VIEWPORTS) {
        await check(kase.label + ' @ ' + vp.name + ': adding a list item preserves canvas scroll position', async () => {
          await runCase(browser, kase, vp);
        });
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK audit-scroll-preserved-on-list-add');
})().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
