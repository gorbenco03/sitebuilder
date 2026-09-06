'use strict';
/**
 * bot/test/audit-builder-round2.test.js — oracle for the 2026-09-06 audit
 * findings DSD-02, F1, PORT-05 (04-QA-Evidence/Audit-2026-09-06-2225ca7/).
 * Full analysis + before/after evidence: 04-QA-Evidence/Audit-Fixes-2026-09-06/builder-round2/.
 *
 * DSD-02 [critical] (builder/app.js onListAdd): the desserdirina gallery
 *   'categories' list declares its sub-shape as schema.json "itemSchema"
 *   (every other template spells it "itemShape"). onListAdd only ever read
 *   `f.itemShape`, so for this one list it silently fell through to a bare
 *   '' placeholder item instead of {title, blurb, photos:[]}. Because that
 *   placeholder is a primitive string (not an object), build.js's per-item
 *   token resolution (`typeof item === 'object'`) returns undefined for its
 *   title/blurb tokens, so the rendered category-block gets NO
 *   data-hb-edit attributes at all — edit-overlay.js's detectListGroups
 *   never sees that item's index, so setupListControls attaches the ONLY
 *   remove ("x") button to index 0, the ORIGINAL category. A visitor who
 *   adds a blank category and immediately removes what looks like that same
 *   blank card actually deletes categories.0 — the real one — corrupting/
 *   losing its photos array (build.js then warns '@each "photos" is not an
 *   array — skipping' and the published gallery renders with zero photos).
 *   Fix: accept either `itemShape` or `itemSchema` so the built item always
 *   matches the field's real sub-shape.
 *
 * F1 [high] (builder/app.js prepareInteractivePreviewDocument /
 *   fullRerender / initPostMessageListener): the preview srcdoc iframe has
 *   no allow-same-origin, so the template's own cookie-banner localStorage/
 *   document.cookie persistence silently no-ops — every full re-render
 *   (color, image, list add/remove) is a brand-new document that always
 *   re-shows the banner even after the visitor dismissed it seconds earlier.
 *   Fix: forward the in-preview accept click to the parent (previewCookieAccepted)
 *   and replay it into every subsequent re-render's injected ready-script,
 *   which now force-hides the banner immediately when already accepted.
 *
 * PORT-05 [high] (builder/app.js fullRerender / waitForInteractivePreview):
 *   an image change (async: resize + base64 embed, slower) and a color
 *   change fired in quick succession both call fullRerender() synchronously,
 *   which used to swap iframe.srcdoc immediately every time — producing
 *   multiple overlapping srcdoc navigations where an earlier one never gets
 *   to settle (aria-busy never returns to "false") before the next one
 *   starts, matching the audit's observed stale-pixel/paint lag. Fix:
 *   serialize renders behind a `renderInFlight` flag — a render requested
 *   while one is still loading is queued (`pendingRender`) and replayed,
 *   reading draft.config fresh, once the in-flight one's ready message (or a
 *   4s safety timeout) settles it. Verified via a black-box interceptor on
 *   iframe.setAttribute('aria-busy', ...): a render-start observed while the
 *   iframe is STILL busy from a prior, unsettled generation is one
 *   "overlap" — must be 0 after the fix.
 *
 * FILES OUT OF SCOPE (left as-is; described, not touched):
 *   - build.js:588 emits the "@each ... is not an array" warning but only to
 *     the server console, never to the owner's UI. The audit recommends a
 *     visible-in-UI warning at publish time when @each receives a non-array;
 *     that is a build.js change and stays out of this branch's scope.
 *
 * Run: node bot/test/audit-builder-round2.test.js
 * Evidence: 04-QA-Evidence/Audit-Fixes-2026-09-06/builder-round2/
 * Exits non-zero on failure.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Audit-Fixes-2026-09-06', 'builder-round2');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-builder-round2-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'audit-builder-round2-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.PUBLIC_URL;
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.CLOUDFLARE_API_TOKEN;

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

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const { startServer } = require('../server.js');
  const { onStripeEvent } = require('../web.js');
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();

  try {
    // -----------------------------------------------------------------
    // DSD-02: gallery category add+remove must not corrupt the ORIGINAL
    // category's photos, in the editor AND on the live published site.
    // -----------------------------------------------------------------
    await check('DSD-02: add+remove a gallery category leaves the original photos intact (editor)', async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const eachWarnings = [];
      page.on('console', (msg) => {
        if (/@each\s+"photos"\s+is not an array/.test(msg.text())) eachWarnings.push(msg.text());
      });
      try {
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        const cookieBtn = page.locator('#hb-cookie-accept');
        if (await cookieBtn.count()) await cookieBtn.click({ timeout: 3000 }).catch(() => {});

        await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#details-drawer').waitFor({ state: 'visible' });
        await page.locator('#btn-close-drawer').click();
        await page.locator('#details-drawer').waitFor({ state: 'hidden' });

        const frame = page.frameLocator('#preview-iframe');
        await page.waitForTimeout(400);

        const before = {
          cats: await frame.locator('.category-block').count(),
          photos: await frame.locator('.collage-photo img').count(),
        };
        await page.screenshot({ path: path.join(EVIDENCE, '01-editor-gallery-before-add.png') });
        assert.strictEqual(before.cats, 1, 'preset ships exactly 1 gallery category');
        assert.strictEqual(before.photos, 4, 'preset category ships exactly 4 photos');

        const galleryAddBtn = frame.locator('button.hb-add-btn', { hasText: /^\+ Adaugă$/ });
        await galleryAddBtn.first().scrollIntoViewIfNeeded();
        await galleryAddBtn.first().click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(EVIDENCE, '02-editor-gallery-after-add.png') });

        const afterAdd = {
          cats: await frame.locator('.category-block').count(),
          photos: await frame.locator('.collage-photo img').count(),
        };
        assert.strictEqual(afterAdd.cats, 2, 'a second category-block must appear after Adaugă');
        assert.strictEqual(afterAdd.photos, 4, 'adding a blank category must not touch the original photos');

        const categoryRemoveBtns = frame.locator('.category-block button.hb-remove-btn');
        const rmCount = await categoryRemoveBtns.count();
        assert.strictEqual(rmCount, 2, 'BOTH categories must have their own remove control (DSD-02 regression: the new item used to get none, so the only x removed the ORIGINAL category)');
        await categoryRemoveBtns.nth(rmCount - 1).scrollIntoViewIfNeeded();
        await categoryRemoveBtns.nth(rmCount - 1).click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(EVIDENCE, '03-editor-gallery-after-remove.png') });

        const afterRemove = {
          cats: await frame.locator('.category-block').count(),
          photos: await frame.locator('.collage-photo img').count(),
        };
        assert.strictEqual(afterRemove.cats, 1, 'category count must return to 1 after removing the added one');
        assert.strictEqual(afterRemove.photos, 4, 'DSD-02: the ORIGINAL category\'s 4 photos must survive add+remove');
        assert.deepStrictEqual(eachWarnings, [], 'build.js must never warn "@each photos is not an array" for a well-shaped new item');
      } finally {
        await context.close();
      }
    });

    // -----------------------------------------------------------------
    // DSD-02, continued: prove it end-to-end on a real PAID live site.
    // -----------------------------------------------------------------
    await check('DSD-02: gallery survives add+remove on the LIVE published site', async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      let livePage = null;
      try {
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        const cookieBtn = page.locator('#hb-cookie-accept');
        if (await cookieBtn.count()) await cookieBtn.click({ timeout: 3000 }).catch(() => {});

        await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#details-drawer').waitFor({ state: 'visible' });
        await page.locator('#btn-close-drawer').click();
        await page.locator('#details-drawer').waitFor({ state: 'hidden' });

        const frame = page.frameLocator('#preview-iframe');
        await page.waitForTimeout(400);
        const galleryAddBtn = frame.locator('button.hb-add-btn', { hasText: /^\+ Adaugă$/ });
        await galleryAddBtn.first().scrollIntoViewIfNeeded();
        await galleryAddBtn.first().click();
        await page.waitForTimeout(500);
        const categoryRemoveBtns = frame.locator('.category-block button.hb-remove-btn');
        const rmCount = await categoryRemoveBtns.count();
        await categoryRemoveBtns.nth(rmCount - 1).scrollIntoViewIfNeeded();
        await categoryRemoveBtns.nth(rmCount - 1).click();
        await page.waitForTimeout(500);

        await page.locator('#btn-publish').click();
        await page.locator('#modal-publish').waitFor({ state: 'visible' });

        const runSlug = 'audit-r2-dsd02-' + crypto.randomBytes(4).toString('hex');
        await page.locator('#input-slug').fill(runSlug);
        await page.locator('#btn-publish-continue').click();
        await page.locator('#form-auth-email').waitFor({ state: 'visible' });

        await page.locator('#input-email').fill('audit-r2-dsd02@example.com');
        await page.locator('#btn-send-magic').click();
        await page.locator('#dev-link').waitFor({ state: 'visible' });
        await page.locator('#dev-link').click();
        await page.locator('#modal-success').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').click();
        await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });

        const opened = context.waitForEvent('page');
        await page.locator('#success-url-link').click();
        livePage = await opened;
        await livePage.waitForLoadState('networkidle');
        await livePage.screenshot({ path: path.join(EVIDENCE, '04-live-site-gallery.png'), fullPage: true });

        const liveCats = await livePage.locator('.category-block').count();
        const livePhotos = await livePage.locator('.collage-photo img').count();
        assert.strictEqual(liveCats, 1, 'live site must show exactly the 1 original category');
        assert.strictEqual(livePhotos, 4, 'DSD-02: the live published gallery must still show all 4 original photos');

        const src = await livePage.locator('.collage-photo img').first().getAttribute('src');
        const resp = await context.request.get(new URL(src, livePage.url()).href);
        assert.strictEqual(resp.status(), 200, 'the live photo file must actually be fetchable (not just present in the DOM)');
      } finally {
        if (livePage) await livePage.close().catch(() => {});
        await context.close();
      }
    });

    // -----------------------------------------------------------------
    // F1: the template's own cookie banner must stay dismissed across
    // full re-renders once the visitor accepted it in this session.
    // -----------------------------------------------------------------
    await check('F1: accepted cookie banner does not reappear after color/image re-renders', async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      try {
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        const cookieBtn = page.locator('#hb-cookie-accept');
        if (await cookieBtn.count()) await cookieBtn.click({ timeout: 3000 }).catch(() => {});

        await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#details-drawer').waitFor({ state: 'visible' });
        await page.locator('#btn-close-drawer').click();
        await page.locator('#details-drawer').waitFor({ state: 'hidden' });

        const frame = page.frameLocator('#preview-iframe');
        const banner = frame.locator('#hb-cookie-banner');
        await banner.waitFor({ state: 'visible', timeout: 10000 });
        await page.screenshot({ path: path.join(EVIDENCE, '10-cookie-banner-visible-initial.png') });

        // el.click() (not coordinate-based Locator.click()): the srcdoc
        // iframe has no allow-same-origin, and CDP hit-testing against a
        // truly opaque-origin frame is unreliable for coordinate
        // translation — dispatching .click() directly sidesteps that.
        await frame.locator('#hb-cookie-accept').evaluate((el) => el.click());
        await page.waitForTimeout(300);
        assert.strictEqual(await banner.isHidden(), true, 'banner must hide immediately after accept');

        await page.locator('#btn-color-picker').click();
        await page.locator('#color-custom-text').fill('#1D5B79');
        await page.waitForTimeout(400);
        await page.locator('#btn-color-picker').click();
        await page.locator('#color-popover').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => {
          const f = document.querySelector('#preview-iframe');
          return f && f.getAttribute('aria-busy') === 'false';
        }, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(EVIDENCE, '11-after-color-change.png') });
        assert.strictEqual(
          await page.frameLocator('#preview-iframe').locator('#hb-cookie-banner').isVisible(),
          false,
          'F1: banner must stay hidden after a color-change full re-render'
        );

        await page.locator('#btn-open-drawer').click();
        await page.locator('#details-drawer').waitFor({ state: 'visible' });
        const photoBtn = page.locator('[data-field-key="hero.background"] button');
        if (await photoBtn.count()) {
          const chooserPromise = page.waitForEvent('filechooser');
          await photoBtn.click();
          const chooser = await chooserPromise;
          await chooser.setFiles(path.join(ROOT, 'templates/portfolio/images/iv-mani1.jpg'));
          await page.waitForTimeout(1200);
        }
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(EVIDENCE, '12-after-image-change.png') });
        assert.strictEqual(
          await page.frameLocator('#preview-iframe').locator('#hb-cookie-banner').isVisible(),
          false,
          'F1: banner must stay hidden after an image-change full re-render'
        );
      } finally {
        await context.close();
      }
    });

    // -----------------------------------------------------------------
    // PORT-05: an image change immediately followed by a color change
    // must not produce an overlapping/abandoned srcdoc navigation.
    // -----------------------------------------------------------------
    await check('PORT-05: image change + immediate color change never overlap a srcdoc navigation', async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      try {
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        const cookieBtn = page.locator('#hb-cookie-accept');
        if (await cookieBtn.count()) await cookieBtn.click({ timeout: 3000 }).catch(() => {});

        await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#details-drawer').waitFor({ state: 'visible' });
        await page.waitForTimeout(300);

        // Black-box overlap detector (see file header for the reasoning):
        // aria-busy is set "true" as the FIRST step of the very call that
        // then assigns srcdoc, so the real overlap signal is a NEW
        // render-start observed while the iframe is STILL busy from a
        // prior, unsettled generation.
        await page.evaluate(() => {
          const iframe = document.getElementById('preview-iframe');
          const origSetAttribute = iframe.setAttribute.bind(iframe);
          window.__hbOverlapCount = 0;
          window.__hbRenderStarts = 0;
          window.__hbRenderSettles = 0;
          let busy = false;
          iframe.setAttribute = function (name, value) {
            if (name === 'aria-busy') {
              if (value === 'true') {
                window.__hbRenderStarts++;
                if (busy) window.__hbOverlapCount++;
              } else if (value === 'false') {
                window.__hbRenderSettles++;
              }
              busy = value === 'true';
            }
            return origSetAttribute(name, value);
          };
        });

        const photoBtn = page.locator('[data-field-key="hero.background"] button');
        const chooserPromise = page.waitForEvent('filechooser');
        await photoBtn.click();
        const chooser = await chooserPromise;
        const fileSetPromise = chooser.setFiles(path.join(ROOT, 'templates/desserdirina/images/cover.jpg'));

        // Fired via a single in-page evaluate (near-zero CDP round-trip
        // latency) so it lands as close as possible to the still-in-flight
        // photo resize, instead of trailing behind several separate
        // Playwright actions.
        await page.evaluate(() => {
          document.getElementById('btn-color-picker').click();
          const t = document.getElementById('color-custom-text');
          t.value = '#1D5B79';
          t.dispatchEvent(new Event('input', { bubbles: true }));
          const b = document.getElementById('color-bg-text');
          b.value = '#E7F1F7';
          b.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await fileSetPromise;
        await page.waitForTimeout(50);

        const frame = page.frameLocator('#preview-iframe');
        const cta = frame.locator('.hero-cta').first();
        await cta.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        const immediate = await cta.evaluate((n) => getComputedStyle(n).backgroundColor).catch(() => null);
        await page.screenshot({ path: path.join(EVIDENCE, '20-colors-immediate.png') });

        await page.waitForFunction(() => {
          const f = document.querySelector('#preview-iframe');
          return f && f.getAttribute('aria-busy') === 'false';
        }, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(150);
        const settled = await cta.evaluate((n) => getComputedStyle(n).backgroundColor).catch(() => null);
        await page.screenshot({ path: path.join(EVIDENCE, '21-colors-settled.png') });

        const expectedRgb = 'rgb(29, 91, 121)'; // #1D5B79
        const overlapCount = await page.evaluate(() => window.__hbOverlapCount);
        const starts = await page.evaluate(() => window.__hbRenderStarts);
        const settles = await page.evaluate(() => window.__hbRenderSettles);

        assert.strictEqual(overlapCount, 0, 'PORT-05: no render may start while a previous one is still in flight (got ' + overlapCount + ' overlap(s) of ' + starts + ' render-start(s), ' + settles + ' settled)');
        assert.strictEqual(immediate, expectedRgb, 'CTA must reflect the new accent immediately, no artificial wait');
        assert.strictEqual(settled, expectedRgb, 'CTA must reflect the new accent once settled');
      } finally {
        await context.close();
      }
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('OK audit-builder-round2 (DSD-02 gallery integrity + F1 cookie persistence + PORT-05 render race fixed)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
