'use strict';
/**
 * bot/test/audit27-r-06-drawer-toolbar.test.js
 *
 * AUDIT 2026-09-27 — gap-drawer-backdrop-audit#1, #2, #3 (R-06).
 *
 * #drawer-overlay (z-index:450) and #details-drawer (z-index:460) both used
 * to start at the very top of the viewport (`inset:0` / `top:0`) — above
 * .editor-topbar's own z-index:200. .editor-topbar reserves horizontal room
 * for the drawer (padding-right, builder/app.css) so its in-flow buttons sit
 * clear of the panel, but that did nothing for #btn-publish at phone width,
 * which is `position:absolute` inside the topbar and therefore ignores that
 * padding entirely. Either way, a real click anywhere over the topbar's row
 * hit the backdrop or the drawer panel first and just closed it, instead of
 * reaching "Publică site-ul" underneath — reproduced live by the audit with
 * real Playwright mouse clicks at every common breakpoint, both right after
 * a fresh design is picked (auto-open) and after a manual close+reopen.
 *
 * #3: the quickstart banner (#demo-content-banner / #btn-quickstart-apply)
 * and the previewed site's own WhatsApp float badge got no equivalent
 * reservation, so they sat fully or partially under the drawer too, at
 * several common widths.
 *
 * FIX (builder/app.css only): a single --drawer-inset variable now drives
 * (a) #drawer-overlay and #details-drawer starting below the topbar
 * (`top: var(--topbar-h)` instead of `inset:0` / `top:0`) so neither one can
 * ever cover the topbar row, at any width, auto-opened or manual; (b) the
 * existing topbar padding-right reservation; (c) a matching reservation for
 * the quickstart banner; (d) a matching reservation on the editor canvas
 * (≥768px) so the live preview iframe's own right edge — and anything the
 * previewed page pins to it, like its WhatsApp badge — stays clear too.
 *
 * This oracle drives the real browser builder (Playwright), a real isolated
 * server, and asserts the property directly: at every width in the audit's
 * matrix, with the drawer open (auto where the app opens it on its own,
 * always manually), a REAL mouse click (page.mouse.click at exact on-screen
 * coordinates — not locator.click's actionability-retrying click, which
 * would just hang/fail against an intercepting element instead of proving
 * what a real tap actually hits) on "Publică site-ul" opens #modal-publish —
 * it must fail on the pre-fix CSS (the click closes the drawer instead) and
 * pass on the fix.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-06-drawer-toolbar.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-r06-drawer-toolbar-'));
process.env.SERVER_SECRET = 'r06-drawer-toolbar-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_TEST_PAY = '1';
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

test.after(() => { if (server) server.close(); });

// Same breakpoint x height pairs the audit measured (gap-drawer-backdrop-audit#1).
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 800 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
];

async function openFreshProductMenuDraft(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(700);
}

/** A real click at an element's own on-screen centre — page.mouse.click, not
 * locator.click, so it lands wherever elementFromPoint actually resolves
 * (an intercepting overlay/drawer included) exactly like a real finger/mouse
 * would, instead of Playwright's actionability check hanging or refusing. */
async function realClickCenter(page, locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'target element must have a visible box to click');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  return { x, y };
}

for (const viewport of VIEWPORTS) {
  const autoOpenApplies = viewport.width >= 768; // shouldAutoOpenDrawerOnThisViewport() (app.js)

  const scenarios = autoOpenApplies ? ['auto', 'manual'] : ['manual'];

  for (const scenario of scenarios) {
    test(`Publică site-ul opens the publish modal with Detalii ${scenario}-opened at ${viewport.width}x${viewport.height}`, async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(20000);
        await openFreshProductMenuDraft(page);

        const drawer = page.locator('#details-drawer');

        if (scenario === 'auto') {
          await drawer.waitFor({ state: 'visible', timeout: 8000 });
        } else {
          // Manual path: close it if the app auto-opened it (>=768px), then
          // reopen it the same way the audit's phone-manual-open repro did
          // (bm-04's "safe alternative" for a viewport that suppresses
          // auto-open) — either way we end on a MANUALLY opened drawer.
          if (await drawer.isVisible().catch(() => false)) {
            await page.locator('#btn-close-drawer').click();
            await drawer.waitFor({ state: 'hidden', timeout: 5000 });
          }
          await page.locator('#btn-open-drawer').click();
          await drawer.waitFor({ state: 'visible', timeout: 8000 });
        }

        const publishBtn = page.locator('#btn-publish');
        await publishBtn.waitFor({ state: 'visible' });

        const { x, y } = await realClickCenter(page, publishBtn);
        const hitId = await page.evaluate(([px, py]) => {
          const el = document.elementFromPoint(px, py);
          return el ? (el.id || el.className || el.tagName) : null;
        }, [x, y]);

        const modal = page.locator('#modal-publish');
        const opened = await modal.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

        assert.equal(
          opened, true,
          `a real click on "Publică site-ul" at ${viewport.width}x${viewport.height} (Detalii ${scenario}-opened) must open ` +
          `#modal-publish, not just land on/close the drawer — elementFromPoint at the click point resolved to: ${hitId}`
        );

        await page.close();
      } finally {
        await browser.close();
      }
    });
  }
}

test('the quickstart banner submit button is never visually covered by the open drawer panel', async () => {
  // NOTE: #drawer-overlay is a deliberate click-anywhere-to-close backdrop
  // over the whole canvas (by design — the same as clicking outside any
  // modal), so an elementFromPoint/click-reachability check here would fail
  // even once fixed and prove nothing. The actual defect (gap-drawer-backdrop-
  // audit#3) is that the OPAQUE drawer PANEL (#details-drawer) physically hid
  // the button, at some widths entirely — so this checks a rect overlap
  // against the drawer's own box, exactly like the WhatsApp-badge check below.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
    page.setDefaultTimeout(20000);
    await openFreshProductMenuDraft(page);

    const banner = page.locator('#demo-content-banner');
    const bannerShowing = await banner.isVisible().catch(() => false);
    assert.ok(bannerShowing, 'the quickstart banner should be showing on a genuinely fresh draft — check the fixture, not the fix, if this fails');

    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 8000 });

    const applyBtn = page.locator('#btn-quickstart-apply');
    const applyBox = await applyBtn.boundingBox();
    assert.ok(applyBox, '#btn-quickstart-apply must have a visible box');

    const drawerBox = await page.locator('#details-drawer').boundingBox();
    assert.ok(drawerBox, 'the details drawer must have a box while open');

    const applyRight = applyBox.x + applyBox.width;
    const overlaps = applyRight > drawerBox.x;
    assert.equal(
      overlaps, false,
      `#btn-quickstart-apply (right edge at ${applyRight}) must sit clear of the open drawer panel (left edge at ${drawerBox.x})`
    );

    await page.close();
  } finally {
    await browser.close();
  }
});

test('the previewed site\'s own WhatsApp badge does not overlap the open drawer\'s rect', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    await openFreshProductMenuDraft(page);

    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 8000 });

    const badge = page.frameLocator('#preview-iframe').locator('.whatsapp-float').first();
    const badgeBox = await badge.boundingBox();
    assert.ok(badgeBox, 'the WhatsApp float badge must be present in the default product-menu preview');

    const drawerBox = await page.locator('#details-drawer').boundingBox();
    assert.ok(drawerBox, 'the details drawer must have a box while open');

    const badgeRight = badgeBox.x + badgeBox.width;
    const overlaps = badgeRight > drawerBox.x;
    assert.equal(
      overlaps, false,
      `WhatsApp badge (right edge at ${badgeRight}) must sit clear of the open drawer (left edge at ${drawerBox.x})`
    );

    await page.close();
  } finally {
    await browser.close();
  }
});
