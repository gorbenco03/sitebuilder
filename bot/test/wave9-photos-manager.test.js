'use strict';
/**
 * bot/test/wave9-photos-manager.test.js
 *
 * Wave9 "manage all photos" — an independent audit found a fully-built
 * "manage all photos" modal (builder/app.js buildGalleryModal(), the
 * #modal-gallery markup in builder/index.html) that nothing could ever open:
 * the drawer only rendered its "Manage photos" button when
 * findPhotoPaths().length > 0, and findPhotoPaths() never returned anything
 * for ANY shipped template.
 *
 * Root cause: findPhotoPaths() walked draft.config looking for arrays whose
 * items carry a .src (the {src,alt} gallery-photo shape), but its recursive
 * `walk()` only ever recursed into PLAIN OBJECTS — the `else if` branch
 * explicitly excluded arrays (`!Array.isArray(v)`). Every template's real
 * photo gallery lives at categories[i].photos: `categories` itself is an
 * array of {title, blurb, photos} objects, none of which has a `.src`, so
 * the array-of-{src} check on `categories` failed AND the recursion refused
 * to step into the array to look at its items' `.photos` field. The result:
 * findPhotoPaths() returned [] for every template, the drawer's photo
 * section (and the only button that opened the modal) never rendered, and
 * the modal — despite being fully implemented — was structurally
 * unreachable. See HANDOFF-photos.md / the task report for the full trace.
 *
 * Fix (builder/app.js): recurse into arrays-of-objects too, not just plain
 * objects, and layer the modal into a genuine "manage ALL the site's
 * photos" surface: category galleries AND the hero background AND the
 * logo, each demo (still-template-asset) photo flagged, each photo's alt
 * text editable in place, reorder + in-place replace controls, and a
 * dedicated "Poze" topbar button (builder/index.html) as a primary,
 * always-visible entry point instead of a conditional line buried in the
 * "Detalii" drawer.
 *
 * Alongside that, openImagePickerForPath() — the hero-background "Alege o
 * poză" control's picker — read the chosen file straight to a data: URL via
 * FileReader with NO resize, unlike every other upload path in the app
 * (which all funnel through resizeImageToDataUrl(file, 1600, 0.82)). A 6MB+
 * phone photo picked there embedded its full, unresized bytes into the
 * config. Fixed to use the same resize pipeline.
 *
 * RED: the pre-fix build (BEFORE_REF, defaults to the commit this wave
 * started from) never shows a "Manage photos" control in the drawer for a
 * template whose config genuinely has categories[i].photos galleries —
 * served standalone (no bot/server.js needed for this static, no-login
 * repro) via the shared wave5 static-file helper.
 *
 * GREEN: the current working tree, driven through the REAL bot/server.js,
 * in a REAL Chromium tab:
 *   - the "Poze" topbar button opens a modal listing every category
 *     gallery under its own human title, the hero background, and the logo;
 *   - unreplaced template photos are flagged "demo", the owner's own
 *     uploads are not;
 *   - alt text is editable per photo;
 *   - adding a large (multi-MB) synthetic photo through the real file input
 *     resizes it to <=1600px on its long edge before it ever reaches
 *     draft.config;
 *   - the hero-background "Alege o poză" picker does the same (the
 *     previously-unresized path);
 *   - reordering and deleting work, and deleting is undoable via the
 *     editor's own Undo — the exact "replaced the wrong one" recovery this
 *     wave's brief called out explicitly.
 *
 * Uses Playwright's Chromium from node_modules (repo root, symlinked into
 * worktrees) — never a hardcoded browser path.
 *
 * Run: node --experimental-sqlite bot/test/wave9-photos-manager.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { serveDir, loadPlaywright, ROOT } = require('./wave5-desserdirina-helpers.js');

// Pinned to the commit this wave started from (the state audited as
// "unreachable"), not to a moving HEAD — once this fix merges, HEAD stops
// reproducing the bug and this check would fail for the wrong reason.
const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || 'a28ad93';

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave9-photos', 'photo-manager');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

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

function readGitFile(ref, relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** A servable copy of builder/ as it looked at BEFORE_REF: same generated
 * template bundles (unchanged by this fix) but the OLD app.js/index.html,
 * so the drawer/modal wiring is exactly what shipped before this wave.
 *
 * Nested under an "app" subdirectory: index.html's own markup references
 * itself via absolute /app/* paths (matching production, where bot/server.js
 * mounts builder/ at /app/*), so a bare static root wouldn't resolve them —
 * the plain serveDir() helper has no /app/-stripping of its own. */
function buildOldBuilderDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave9-old-builder-'));
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'builder'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), readGitFile(BEFORE_REF, 'builder/app.js'));
  fs.writeFileSync(path.join(dir, 'index.html'), readGitFile(BEFORE_REF, 'builder/index.html'));
  return root;
}

/** Draws a large, JPEG-hostile (blocky random-color) photo entirely inside
 * the real browser (native canvas -> real JPEG encoder) and hands back both
 * the data: URL and an in-memory Buffer Playwright can feed to a file input
 * via setInputFiles — no fixture file on disk, no new dependency. */
async function genLargePhotoDataUrl(page, w, h) {
  const dataUrl = await page.evaluate(({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const block = 6;
    for (let y = 0; y < h; y += block) {
      for (let x = 0; x < w; x += block) {
        ctx.fillStyle = 'rgb(' + ((Math.random() * 255) | 0) + ',' + ((Math.random() * 255) | 0) + ',' + ((Math.random() * 255) | 0) + ')';
        ctx.fillRect(x, y, block, block);
      }
    }
    return c.toDataURL('image/jpeg', 0.95);
  }, { w, h });
  return dataUrl;
}

function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  return Buffer.from(base64, 'base64');
}

async function decodedDims(page, src) {
  return page.evaluate((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('image failed to decode'));
    img.src = src;
  }), src);
}

/**
 * `entryUrl` differs between the two servers this file drives: the real
 * bot/server.js serves builder/ under /app/*, while the RED check's plain
 * static-file server (serveDir) is rooted directly at the builder copy.
 */
async function openPortfolioEditor(page, entryUrl) {
  await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
}

/** Locate a gallery section in the modal by its own human-readable title
 * (the category's title, or "Fundal principal (hero)" / "Logo") instead of
 * a positional index — section order is an implementation detail. */
function gallerySection(page, titleText) {
  return page.locator('#modal-gallery .gallery-path-section').filter({
    has: page.locator('.field-label', { hasText: titleText }),
  });
}

(async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  // ---------------------------------------------------------------------
  // RED — pre-fix build: the drawer never offers a way to manage photos,
  // even though the Salon (portfolio) preset genuinely has two category
  // galleries (categories[0].photos / categories[1].photos).
  // ---------------------------------------------------------------------
  const oldDir = buildOldBuilderDir();
  const oldServer = await serveDir(oldDir);
  await check('RED (' + BEFORE_REF + '): drawer never offers "Manage photos" for a template with real galleries', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    try {
      await openPortfolioEditor(page, oldServer.base + '/app/index.html');
      const drawer = page.locator('#details-drawer');
      await drawer.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      const drawerText = (await drawer.textContent().catch(() => '')) || '';
      assert.ok(
        !/manage photos/i.test(drawerText),
        'pre-fix drawer must not surface "Manage photos" for a template whose config has category galleries — findPhotoPaths() should be returning [] here (the bug)'
      );
    } finally {
      await page.close();
    }
  });
  await oldServer.close();

  // ---------------------------------------------------------------------
  // GREEN — current working tree via the real bot/server.js.
  // ---------------------------------------------------------------------
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave9-photos-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'wave9-photos-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_FAKE_DEPLOY = '1';
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  try {
    let page;

    await check('GREEN: "Poze" topbar button opens a modal listing both galleries + hero background', async () => {
      page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.setDefaultTimeout(20000);
      await openPortfolioEditor(page, base + '/app/');
      const drawer = page.locator('#details-drawer');
      if (await drawer.isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
      }

      await page.locator('#btn-open-gallery').click();
      const modal = page.locator('#modal-gallery');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      const modalText = (await modal.textContent()) || '';
      assert.ok(/Fundal principal/i.test(modalText), 'modal must list the hero background');
      assert.ok(/Coafură și culoare/i.test(modalText), 'modal must list the first category by its own title');
      assert.ok(/Manichiură și nail art/i.test(modalText), 'modal must list the second category by its own title');

      const demoBadges = await modal.locator('.photo-thumb-badge', { hasText: 'demo' }).count();
      assert.ok(demoBadges >= 5, 'unreplaced template photos must be flagged demo — got ' + demoBadges);

      const altInputs = modal.locator('.photo-thumb-alt');
      const altCount = await altInputs.count();
      assert.ok(altCount >= 8, 'every category photo must have an editable alt-text field — got ' + altCount);
      const firstAlt = (await altInputs.first().inputValue()) || '';
      assert.ok(firstAlt.trim().length > 0, 'alt field must start pre-filled from the preset, not blank');

      fs.writeFileSync(path.join(EVIDENCE_DIR, 'modal-open-demo-badges.png'), await page.screenshot());
    });

    await check('GREEN: alt text typed into a photo persists to draft.config', async () => {
      const altInput = page.locator('#modal-gallery .photo-thumb-alt').first();
      await altInput.fill('Poză test alt din oracle');
      await page.waitForTimeout(250);
      const saved = await page.evaluate(() => draft.config.categories[0].photos[0].alt);
      assert.strictEqual(saved, 'Poză test alt din oracle');
    });

    await check('GREEN: a large synthetic phone photo added to a gallery is resized to <=1600px before it reaches config', async () => {
      const bigDataUrl = await genLargePhotoDataUrl(page, 4000, 3000);
      const bigBuffer = dataUrlToBuffer(bigDataUrl);
      assert.ok(bigBuffer.length > 3 * 1024 * 1024, 'test fixture must itself be a genuinely large photo — got ' + bigBuffer.length + ' bytes');

      const beforeCount = await page.evaluate(() => draft.config.categories[0].photos.length);
      const dropzoneInput = gallerySection(page, 'Coafură și culoare').locator('input[type=file][multiple]');
      await dropzoneInput.setInputFiles({ name: 'phone-photo.jpg', mimeType: 'image/jpeg', buffer: bigBuffer });
      await page.waitForFunction(
        (n) => draft.config.categories[0].photos.length > n,
        beforeCount,
        { timeout: 10000 }
      );

      const photos = await page.evaluate(() => draft.config.categories[0].photos);
      assert.strictEqual(photos.length, beforeCount + 1, 'exactly one photo must have been added');
      const added = photos[photos.length - 1];
      assert.ok(added.src.startsWith('data:image/jpeg'), 'added photo must be a resized data: URL');
      assert.ok(
        added.src.length < bigDataUrl.length * 0.6,
        'resized photo must be meaningfully smaller than the original — original ' + bigDataUrl.length + ' chars, stored ' + added.src.length
      );

      const dims = await decodedDims(page, added.src);
      assert.ok(Math.max(dims.w, dims.h) <= 1600, 'resized photo must be capped at 1600px on its long edge — got ' + dims.w + 'x' + dims.h);

      fs.writeFileSync(path.join(EVIDENCE_DIR, 'after-large-upload.png'), await page.screenshot());
    });

    await check('GREEN: deleting a photo, then Undo, restores it in place', async () => {
      // Uses the second category (untouched by the upload check above) so
      // this check's counts are independent of upload order/timing.
      const beforePhotos = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.categories[1].photos)));
      await gallerySection(page, 'Manichiură și nail art').locator('.photo-thumb-del').first().click();
      await page.waitForTimeout(300);
      const afterDelete = await page.evaluate(() => draft.config.categories[1].photos.length);
      assert.strictEqual(afterDelete, beforePhotos.length - 1, 'delete must remove exactly one photo');

      // The #btn-undo topbar button sits visually BEHIND the modal's own
      // full-viewport overlay — a real user would have to close the modal
      // first to click it. Ctrl+Z is the natural "undo that mistake right
      // now" reflex, and works here because the keydown listener lives on
      // `document` (unaffected by the overlay's stacking, unlike a pointer
      // click) — see the "Undo / redo keyboard shortcuts" wiring in app.js.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
      const restored = await page.evaluate(() => draft.config.categories[1].photos);
      assert.deepStrictEqual(restored, beforePhotos, 'Undo must restore the exact photo, in its original position — "replaced/deleted the wrong one" must be recoverable');
    });

    await check('GREEN: reordering a photo actually swaps its position in config', async () => {
      const before = await page.evaluate(() => draft.config.categories[1].photos.map((p) => p.alt));
      await gallerySection(page, 'Manichiură și nail art').locator('.photo-thumb-mini-btn[aria-label="Mută mai târziu"]').first().click();
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => draft.config.categories[1].photos.map((p) => p.alt));
      assert.strictEqual(after[0], before[1]);
      assert.strictEqual(after[1], before[0]);
    });

    await check('GREEN: the hero-background picker (previously unresized) now resizes large uploads too', async () => {
      await page.locator('#btn-close-gallery').click().catch(() => {});
      await page.locator('#btn-open-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'visible' });

      const bigDataUrl = await genLargePhotoDataUrl(page, 4000, 3000);
      const bigBuffer = dataUrlToBuffer(bigDataUrl);
      assert.ok(bigBuffer.length > 3 * 1024 * 1024, 'fixture must be large — got ' + bigBuffer.length);

      // openImagePickerForPath() reuses the single shared #img-file-input and
      // opens it via a real input.click() — Playwright intercepts that as a
      // native "filechooser" event, so the file must be supplied through
      // that event (not a bare locator.setInputFiles, which can race the
      // picker's own cancel/focus bookkeeping and silently drop the file).
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('#details-drawer').getByRole('button', { name: 'Alege o poză' }).click(),
      ]);
      await fileChooser.setFiles({ name: 'hero-big.jpg', mimeType: 'image/jpeg', buffer: bigBuffer });
      await page.waitForFunction(
        () => /^data:image\/jpeg/.test((/url\('([^']+)'\)/.exec(draft.config.hero.background) || [])[1] || ''),
        { timeout: 10000 }
      );

      const bg = await page.evaluate(() => draft.config.hero.background);
      const m = /url\('([^']+)'\)/.exec(bg);
      assert.ok(m, 'hero.background must embed the new image as a url(\'data:...\')');
      const heroDataUrl = m[1];
      assert.ok(
        heroDataUrl.length < bigDataUrl.length * 0.6,
        'hero background image must be resized, not stored raw — original ' + bigDataUrl.length + ' chars, stored ' + heroDataUrl.length
      );
      const dims = await decodedDims(page, heroDataUrl);
      assert.ok(Math.max(dims.w, dims.h) <= 1600, 'hero background must be capped at 1600px on its long edge too — got ' + dims.w + 'x' + dims.h);
    });

    if (page) await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK wave9-photos-manager');
})().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
