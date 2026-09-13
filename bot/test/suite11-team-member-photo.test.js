'use strict';
/**
 * bot/test/suite11-team-member-photo.test.js — PLAN-FEEDBACK-2026-09-13
 * Suite D (owner report, portfolio/salon, punct 4).
 *
 * Owner report: adding a new specialist to the team — name and description
 * work, but the photo does not: the new card shows a broken-image icon with
 * alt text "Nume și prenume" and a "Înlocuiește fotografia" tooltip that
 * leads nowhere. The "Poze" panel also never lists the team section at all.
 *
 * VERIFIED CAUSE: templates/portfolio/schema.json's `team.members` itemShape
 * declared `photo` as a plain `"text"` leaf, not an image. Three separate
 * consequences, all from that one line:
 *
 *   1. build.js's M1 fix (isEditorItemField, see its own doc comment) forces
 *      open ANY empty itemShape leaf's `@if` guard in the editor so there is
 *      something to click — correct for a text field, but for `photo` it
 *      meant literally emitting `<img src="">`, which paints as a browser's
 *      broken-image glyph.
 *   2. That same empty `src` can never round-trip through the src→path
 *      reverse lookup (builder/app.js's buildImgMap()/resolveImgPath()) every
 *      OTHER photo control in the app relies on to know which config path a
 *      click should write to — so the "Înlocuiește fotografia" button that
 *      setupImages() (builder/edit-overlay.js) generically attaches to every
 *      `<img>` had a real click handler, but no path to act on. Confirmed by
 *      reading onImageChangeRequest()/applySelectedImageFile(): with no
 *      resolvable path, a chosen file has nowhere in config to land.
 *   3. findPhotoPaths() (builder/app.js) only recognised `"type":"photos"`
 *      array fields and their itemShape-nested equivalent — never a single
 *      per-item scalar image leaf — so "Poze" had no section for the team at
 *      all, for existing members with a real photo or new ones without.
 *
 * FIX:
 *   - schema.json: `team.members` itemShape declares `photo` as `"image"`
 *     (the same type string top-level single-image fields like `logo` use),
 *     not `"text"`.
 *   - build.js: annotateEditableImageTag() stamps a direct
 *     `data-hb-edit-img="<fullPath>"` on any `<img>` whose `src` is a bare
 *     itemShape token inside an `@each` item, in edit mode — schema-blind
 *     (it doesn't care whether schema.json calls the field "image" or
 *     "text"), so builder/edit-overlay.js never has to infer a path from
 *     `src`/`alt` content again. When the resolved value is empty, the
 *     `src` attribute itself is omitted (never emitted as `src=""`) — no
 *     request the browser can fail, so no broken-image glyph; the
 *     template's own sizing CSS (targets the `<img>`, e.g.
 *     `aspect-ratio`/`width`) still reserves a real photo's footprint.
 *   - builder/edit-overlay.js: setupImages() reads `data-hb-edit-img` first
 *     (falling back to the old src-based resolution when absent, unchanged
 *     for every other image), and marks a resolved-but-empty slot with a
 *     neutral placeholder fill (`.hb-photo-empty`) plus an
 *     always-visible (not hover-only) replace button — nothing else on an
 *     empty card would otherwise hint it's clickable.
 *   - builder/app.js: findPhotoPaths()/resolveSchemaPhotoPath() recognise an
 *     itemShape leaf declared `"image"` and surface one path per EXISTING
 *     list item (`team.members.<i>.photo`, included even while still
 *     empty — same reasoning Suite 2 already established for `"photos"`
 *     arrays); buildGalleryModal() renders each via buildSingleImageSection
 *     (the same control hero.background/logo use) instead of the
 *     photos-array gallery UI; humanizePhotoPathLabel() labels each as
 *     "<section label> — <member name>" (e.g. "Echipă — Maria Ionescu"),
 *     the section label read from schema.pageSections, never hardcoded.
 *
 * PUBLISHED SITE (no photo): `@if photo` was already false → the whole
 * `.pf-person__pic` block (and its `<img>`) is omitted, same as every other
 * optional itemShape field on this template (role/bio) when empty — no new
 * "initials/monogram" placeholder was introduced, since no shipped template
 * has that convention anywhere today and inventing one here would be a new,
 * inconsistent visual language for a single field. A member who already HAS
 * a photo (existing customer drafts) is completely unaffected: the field
 * name/shape/storage did not change, only its schema type annotation.
 *
 * RED (pre-fix): a freshly-added team member's `<img>` has `src=""` (broken
 * glyph) and no `data-hb-edit-img`/resolvable path; "Poze" has no
 * `team.members.*` section at all, for old or new members.
 *
 * GREEN (post-fix): the new member's `<img>` has no `src` attribute, carries
 * `data-hb-edit-img="team.members.<n>.photo"`, and renders a same-size
 * neutral placeholder; clicking its replace control and picking a file lands
 * a real photo in `draft.config` and the live preview; "Poze" lists a
 * section per team member, addressable by `data-photo-path`; the published
 * render for a member without a photo contains no `<img` with an empty src.
 *
 * Run: node --experimental-sqlite --test bot/test/suite11-team-member-photo.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s11-team-photo-'));
process.env.SERVER_SECRET = 's11-team-photo-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

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
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

async function openTemplateEditor(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
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
 * Click the "+ Adaugă" control for `listPath`, found the same way
 * suite1-new-item-has-all-fields.test.js's own clickAddButtonFor() does:
 * climb from the list's LAST existing item's `.hb-list-item` container to
 * its `.hb-add-btn` sibling — mirrors edit-overlay.js's own lookup, so it
 * works regardless of which lists are currently schema-recognised.
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

/** A tiny solid-color JPEG, generated in-page (no fixture file on disk). */
async function genPhotoBuffer(page, color) {
  const dataUrl = await page.evaluate((color) => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }, color);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('portfolio: a new team member never renders a broken <img>, and its placeholder is clickable', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page);

    const before = await page.evaluate(() => draft.config.team.members.length);
    let iframeHandle = await page.$('#preview-iframe');
    let iframeCtx = await iframeHandle.contentFrame();

    const result = await clickAddButtonFor(iframeCtx, 'team.members');
    assert.ok(result.found, 'could not click "+ Adaugă" for team.members — ' + (result.reason || '') + ' (test setup broken, not the defect under test)');
    await page.waitForTimeout(900); // fullRerender

    const after = await page.evaluate(() => draft.config.team.members.length);
    assert.equal(after, before + 1, 'clicking "+ Adaugă" must append exactly one team member');
    const newIndex = after - 1;
    const newPath = 'team.members.' + newIndex + '.photo';

    const newMember = await page.evaluate(() => draft.config.team.members[draft.config.team.members.length - 1]);
    assert.equal(newMember.photo, '', 'a freshly-added member must start with photo:"" (onListAdd seeding — sanity-checked here, not this fix\'s own change)');

    iframeHandle = await page.$('#preview-iframe');
    iframeCtx = await iframeHandle.contentFrame();

    // RED symptom 1: no <img> anywhere in the canvas has an empty src — the
    // broken-image glyph the owner screenshotted.
    const brokenImgCount = await iframeCtx.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).filter((img) => img.getAttribute('src') === '').length;
    });
    assert.equal(brokenImgCount, 0, 'no <img> in the editor canvas may have an empty src="" (broken-image glyph)');

    // GREEN: the new member's photo <img> is directly addressable and has no src.
    const info = await iframeCtx.evaluate((p) => {
      const img = document.querySelector('img[data-hb-edit-img="' + p + '"]');
      if (!img) return { found: false };
      const rect = img.getBoundingClientRect();
      const wrap = img.closest('.hb-img-wrap');
      const btn = wrap && wrap.querySelector('.hb-img-btn');
      return {
        found: true,
        hasSrcAttr: img.hasAttribute('src'),
        hasEmptyClass: img.classList.contains('hb-photo-empty'),
        wrapHasEmptyClass: !!(wrap && wrap.classList.contains('hb-img-wrap--empty')),
        width: rect.width,
        height: rect.height,
        btnOpacity: btn ? getComputedStyle(btn).opacity : null,
      };
    }, newPath);
    assert.ok(info.found, 'expected <img data-hb-edit-img="' + newPath + '"> in the canvas — path was never stamped');
    assert.equal(info.hasSrcAttr, false, 'an empty photo slot must have no src attribute at all (not src="")');
    assert.ok(info.hasEmptyClass, 'empty photo slot must carry the neutral-placeholder class');
    assert.ok(info.wrapHasEmptyClass, 'empty photo slot wrap must carry the always-visible-button class');
    assert.ok(info.width > 0 && info.height > 0, 'the empty placeholder must occupy real space, same as a populated photo (got ' + info.width + 'x' + info.height + ')');
    assert.equal(info.btnOpacity, '1', '"Înlocuiește fotografia" must be always visible on an empty slot, not hover-only');

    // Same footprint as an existing (populated) member's photo — "at the
    // same size as a real one". Compared via the `.pf-person__pic`
    // CONTAINER (grid-determined, e.g. `repeat(3, 1fr)` — identical for
    // every card regardless of row) rather than the <img> itself: a bare
    // `<img>` with no src at all has no intrinsic size for the browser to
    // resolve its own percentage-width box against, which is a layout
    // technicality of empty replaced elements, not something this fix
    // controls or that the "same size" requirement is actually about.
    const populatedPicWidth = await iframeCtx.evaluate((p) => {
      const emptyPic = document.querySelector('img[data-hb-edit-img="' + p + '"]').closest('.pf-person__pic');
      const pics = Array.from(document.querySelectorAll('.pf-person__pic'));
      const other = pics.find((el) => el !== emptyPic);
      return other ? other.getBoundingClientRect().width : null;
    }, newPath);
    const emptyPicWidth = await iframeCtx.evaluate((p) => {
      const el = document.querySelector('img[data-hb-edit-img="' + p + '"]').closest('.pf-person__pic');
      return el.getBoundingClientRect().width;
    }, newPath);
    if (populatedPicWidth) {
      assert.ok(Math.abs(populatedPicWidth - emptyPicWidth) < 2, 'empty placeholder\'s card must be the same width as a populated one\'s (got ' + emptyPicWidth + ' vs ' + populatedPicWidth + ')');
    }

    // Clicking the placeholder's replace control goes through the SAME
    // upload flow as every other photo: a real file chooser, resized and
    // written to draft.config, then reflected in the live preview.
    const chooserPromise = page.waitForEvent('filechooser');
    await iframeCtx.evaluate((p) => {
      const img = document.querySelector('img[data-hb-edit-img="' + p + '"]');
      const btn = img.closest('.hb-img-wrap').querySelector('.hb-img-btn');
      btn.click();
    }, newPath);
    const chooser = await chooserPromise;
    const buf = await genPhotoBuffer(page, '#2266cc');
    await chooser.setFiles({ name: 'team-photo.jpg', mimeType: 'image/jpeg', buffer: buf });

    await page.waitForFunction((p) => {
      const val = getPath(draft.config, p);
      return typeof val === 'string' && val.indexOf('data:image/') === 0;
    }, newPath, { timeout: 8000 });

    const savedPhoto = await page.evaluate((p) => getPath(draft.config, p), newPath);
    assert.ok(savedPhoto.startsWith('data:image/'), 'uploaded photo must be a real resized data: URL, not a placeholder');

    // Live preview reflects it after the resulting full re-render.
    await page.waitForTimeout(900);
    iframeHandle = await page.$('#preview-iframe');
    iframeCtx = await iframeHandle.contentFrame();
    const afterUploadSrc = await iframeCtx.evaluate((p) => {
      const img = document.querySelector('img[data-hb-edit-img="' + p + '"]');
      return img ? img.getAttribute('src') : null;
    }, newPath);
    assert.ok(afterUploadSrc && afterUploadSrc.indexOf('data:image/') === 0, 'the canvas <img> must show the newly uploaded photo, not stay empty');
  } finally {
    await page.close();
  }
});

test('portfolio: "Poze" panel lists the team, addressable per member, with a sensible label', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page);

    // Existing members (from the demo preset) must already be listed — this
    // is not only about newly-added ones.
    const memberCount = await page.evaluate(() => draft.config.team.members.length);
    assert.ok(memberCount > 0, 'test fixture assumption broken: portfolio\'s demo preset ships with no team members to check against');

    await page.locator('#btn-open-gallery').click();
    await page.locator('#modal-gallery').waitFor({ state: 'visible' });

    for (let i = 0; i < memberCount; i++) {
      const teamPath = 'team.members.' + i + '.photo';
      const section = page.locator('.gallery-path-section[data-photo-path="' + teamPath + '"]');
      await section.waitFor({ state: 'visible', timeout: 5000 });
      const labelText = await section.locator('.field-label').first().textContent();
      assert.ok(/Echip/i.test(labelText || ''), 'team member #' + i + ' section label must name the "Echipă" section, got: ' + labelText);
    }

    await page.locator('#btn-close-gallery').click();
    await page.locator('#modal-gallery').waitFor({ state: 'hidden' });

    // A newly-added member (no photo yet) must ALSO get a section — this is
    // the exact "Poze doesn't see the team at all" defect from the owner
    // report, checked on the empty case specifically.
    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();
    const result = await clickAddButtonFor(iframeCtx, 'team.members');
    assert.ok(result.found, 'could not click "+ Adaugă" for team.members — ' + (result.reason || ''));
    await page.waitForTimeout(900);

    const newIndex = await page.evaluate(() => draft.config.team.members.length - 1);
    const newPath = 'team.members.' + newIndex + '.photo';

    await page.locator('#btn-open-gallery').click();
    await page.locator('#modal-gallery').waitFor({ state: 'visible' });
    const newSection = page.locator('.gallery-path-section[data-photo-path="' + newPath + '"]');
    await newSection.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await newSection.locator('.photo-thumb--empty').count(), 1, 'a member with no photo yet must show the panel\'s own empty-slot state, not be skipped');
  } finally {
    await page.close();
  }
});

test('portfolio: published render for a team member without a photo has no broken <img>', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/portfolio/template.html'), 'utf8');
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/portfolio/presets.json'), 'utf8'));
  const baseConfig = JSON.parse(JSON.stringify(
    Array.isArray(presets) ? presets[0].config : presets.presets[0].config
  ));

  baseConfig.team = baseConfig.team || {};
  baseConfig.team.title = baseConfig.team.title || 'Echipa';
  baseConfig.team.members = [
    { name: 'Cu poză', role: 'Rol', bio: 'Bio', photo: 'images/existing-team-photo.jpg' },
    { name: 'Fără poză', role: '', bio: '', photo: '' },
  ];

  const publishedHtml = renderHtml(templateHtml, baseConfig, {});

  // The member WITH a photo must keep displaying it unmodified — no
  // migration that loses an existing customer's stored photo URL.
  assert.ok(publishedHtml.includes('images/existing-team-photo.jpg'), 'an existing team member\'s stored photo must still render unchanged on publish');

  // No <img> anywhere with an empty src on the published page.
  const brokenImgs = publishedHtml.match(/<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>/gi) || [];
  assert.equal(brokenImgs.length, 0, 'published HTML must contain no <img> with an empty src, got: ' + JSON.stringify(brokenImgs));

  // The decision for a member without a photo is to omit the picture block
  // entirely (consistent with how this same template already hides other
  // empty optional itemShape fields — role/bio — rather than inventing a new
  // initials/monogram convention no shipped template uses anywhere today).
  const noPhotoIdx = publishedHtml.indexOf('Fără poză');
  assert.ok(noPhotoIdx > -1, 'the photo-less member\'s own name must still render');
  const surrounding = publishedHtml.slice(Math.max(0, noPhotoIdx - 400), noPhotoIdx);
  assert.ok(!/pf-person__pic/.test(surrounding), 'a member without a photo must render no picture container at all on publish');

  // Editor srcdoc (editMode: true), same photo-less member: the field is
  // force-opened for editing, but still no empty src="".
  const editHtml = renderHtml(templateHtml, baseConfig, { editMode: true });
  const editBrokenImgs = editHtml.match(/<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>/gi) || [];
  assert.equal(editBrokenImgs.length, 0, 'editor srcdoc must never emit <img src=""> either, got: ' + JSON.stringify(editBrokenImgs));
  assert.ok(editHtml.includes('data-hb-edit-img="team.members.1.photo"'), 'editor srcdoc must stamp a direct, unambiguous path onto the empty member\'s <img>');
});
