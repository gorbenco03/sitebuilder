// Measurement script (not a test) — drives the real /app/ editor with
// Playwright and records iframe/drawer scroll position before and after
// clicking a repeatable-list "+ Adaugă" control, on every template that has
// one, at both 1440x900 and 390x844. Used to build FINDINGS.md BEFORE any
// fix is applied (causal evidence), then re-run after the fix for the GREEN
// numbers.
//
// Usage: node 04-QA-Evidence/scroll-jump-fix/measure-scroll-jump.mjs
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  return require(path.join(ROOT, 'node_modules', 'playwright'));
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scroll-jump-measure-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'scroll-jump-measure-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

// Per-template: which safe-list root to exercise. root prefix is matched
// against the data-hb-edit path of the item just before the "+ Adaugă"
// button (see builder/edit-overlay.js addBtn insertion — inserted as
// lastContainer.nextSibling), which is a template-agnostic way to find the
// right button among several lists on one page.
const CASES = [
  { templateId: 'professionals', rootPrefix: 'services.', label: 'professionals / services' },
  { templateId: 'local-service', rootPrefix: 'services.', label: 'local-service / services (custom .hb-ls-add)' },
  { templateId: 'product-menu', rootPrefix: 'menu.ro.', label: 'product-menu / menu.ro (dishes)' },
  { templateId: 'portfolio', rootPrefix: 'categories.', label: 'portfolio / categories (gallery)' },
  { templateId: 'desserdirina', rootPrefix: 'categories.', label: 'desserdirina / categories (gallery)' },
];

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
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
 * with `rootPrefix`. Returns an ElementHandle inside the iframe, or null. */
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

async function measureOne(browser, kase, viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, kase.templateId);

    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();

    // Scroll the iframe's own document down (this is the canvas scroll the
    // owner loses — see PS report). Scroll to roughly 60% of body height so
    // we are well past the top on every template/viewport combo.
    const beforeScroll = await iframeCtx.evaluate(() => {
      const doc = document.documentElement;
      const target = Math.max(200, Math.floor(doc.scrollHeight * 0.55));
      window.scrollTo(0, target);
      return { scrollY: window.scrollY, scrollHeight: doc.scrollHeight, target };
    });

    // Also record the outer /app/ page's own scroll (in case the whole page,
    // not just the iframe, moves) and the drawer body's scrollTop, even
    // though the drawer is closed per the repro steps — 0 either way is a
    // useful sanity check that closing it didn't leave stale scroll state.
    const outerBefore = await page.evaluate(() => ({
      pageScrollY: window.scrollY,
      drawerScrollTop: (document.getElementById('drawer-body') || {}).scrollTop || 0,
    }));

    const addBtnHandle = await findAddButtonForRoot(iframeCtx, kase.rootPrefix);
    const addBtnEl = addBtnHandle && addBtnHandle.asElement ? addBtnHandle.asElement() : null;
    if (!addBtnEl) {
      throw new Error('add button not found for prefix ' + kase.rootPrefix);
    }
    await addBtnEl.scrollIntoViewIfNeeded().catch(() => {});
    // scrollIntoViewIfNeeded on the button itself could itself move the
    // canvas — re-read scroll AFTER that, right before the click, so the
    // "before" number is what a human would actually see the instant before
    // clicking (not what it was mid-test-setup).
    const justBeforeClick = await iframeCtx.evaluate(() => window.scrollY);
    await addBtnEl.click({ timeout: 10000 });
    await page.waitForTimeout(900); // let fullRerender() + srcdoc navigation settle

    const afterScroll = await iframeCtx.evaluate(() => window.scrollY).catch(() => 'ERROR(frame detached/replaced)');
    const outerAfter = await page.evaluate(() => ({
      pageScrollY: window.scrollY,
      drawerScrollTop: (document.getElementById('drawer-body') || {}).scrollTop || 0,
    }));

    return {
      template: kase.templateId,
      viewport: viewport.name,
      scrollHeight: beforeScroll.scrollHeight,
      targetScroll: beforeScroll.target,
      canvasScrollBeforeClick: justBeforeClick,
      canvasScrollAfter: afterScroll,
      outerPageScrollBefore: outerBefore.pageScrollY,
      outerPageScrollAfter: outerAfter.pageScrollY,
      drawerScrollBefore: outerBefore.drawerScrollTop,
      drawerScrollAfter: outerAfter.drawerScrollTop,
    };
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

  const results = [];
  try {
    for (const kase of CASES) {
      for (const vp of VIEWPORTS) {
        try {
          const r = await measureOne(browser, kase, vp);
          results.push(r);
          console.log(JSON.stringify(r));
        } catch (e) {
          console.error('ERROR', kase.label, vp.name, e.message);
          results.push({ template: kase.templateId, viewport: vp.name, error: e.message });
        }
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  fs.writeFileSync(
    path.join(__dirname, process.argv[2] || 'results.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('\nWrote results to', path.join(__dirname, process.argv[2] || 'results.json'));
})().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
