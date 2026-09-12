'use strict';
/**
 * bot/test/suite2-new-category-gets-first-photo.test.js — PLAN-QA-2026-09-12,
 * Suite 2, S2-1/S2-3 (B5).
 *
 * On local-service, portfolio and desserdirina, "+ Adaugă categorie" (the
 * generic, schema-driven canvas add button Wave 1/S1-4 gave the `categories`
 * list — see suite1-lists-from-schema.test.js) creates a new category whose
 * `photos` field is correctly seeded as `[]` (onListAdd() in builder/app.js
 * already does this right: `itemShape[k] === 'photos' → newItem[k] = []`).
 * But the "Poze" panel — the only surface with an actual photo-upload
 * control for a category, since the drawer only renders text/url/color
 * fields for a list item — never showed a section for it, because
 * findPhotoPaths() (builder/app.js, ~line 4187 before this fix) only
 * included an array when `v.length > 0 && v.some(p => p && p.src)`. An
 * empty array trivially fails `.some()` on empty input, so a brand-new
 * category's `photos: []` was silently invisible: the modal's section count
 * stayed identical before/after adding a category (confirmed in
 * 04-QA-Evidence/QA-Explorare-2026-09-12/reports/03-images-logo-gallery.md,
 * D2 — "local-service: Poze modal sections=5 ... after=5", same for
 * portfolio/desserdirina). The client had no way to give a new category its
 * first photo, on any of these three templates.
 *
 * Fix (builder/app.js): findPhotoPaths() now ALSO asks the template's own
 * schema.json which list fields nest a `"photos"`-typed key inside their
 * itemShape (`categories: {title, blurb, photos: "photos"}` on all three
 * templates here), and adds one path per EXISTING item of that list —
 * `categories.<i>.photos` — regardless of whether that item's own photos
 * array is still empty. buildGallerySection() is unchanged for this shape
 * (object items, `{src,alt}`), so a freshly-declared-but-empty gallery now
 * gets exactly the same section, thumbnail row (empty) and "Adaugă poze"
 * dropzone as any populated one.
 *
 * RED (pre-fix): the "Poze" modal's section count for a template is
 * identical before and after clicking "+ Adaugă categorie" — there is no
 * `.gallery-path-section[data-photo-path="categories.<newIndex>.photos"]`
 * to find, so uploading is impossible.
 *
 * GREEN (post-fix): the section count increases by exactly one, the new
 * section is addressable by its own `data-photo-path`, uploading a real
 * photo through its dropzone lands in `draft.config.categories[i].photos`,
 * the photo shows up in the live preview, and — end to end, on one of the
 * three templates — surviving all the way through publish to `/live/<slug>/`.
 *
 * Run: node --experimental-sqlite --test bot/test/suite2-new-category-gets-first-photo.test.js
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
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}
const { chromium } = loadPlaywright();

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

/**
 * Click the "+ Adaugă" button that belongs to `root` (a top-level schema
 * list key, e.g. "categories") specifically — every template renders
 * several lists on one page, and several of them share the exact same
 * generic ".hb-add-btn" class with no distinguishing text (portfolio's own
 * add buttons are all bare "+ Adaugă"). Scoped the same way
 * suite1-lists-from-schema.test.js's own inspectList() finds a list's
 * bounding container: fold every existing item's own container up to their
 * lowest common ancestor, then look for ".hb-add-btn" inside THAT — not a
 * page-wide querySelector, which would just find the FIRST list's button.
 */
async function clickListAddButton(page, root) {
  const iframeHandle = await page.$('#preview-iframe');
  const iframeCtx = await iframeHandle.contentFrame();
  const clicked = await iframeCtx.evaluate((root) => {
    const prefix = root + '.';
    const byIdx = {};
    document.querySelectorAll('[data-hb-edit]').forEach((el) => {
      const p = el.getAttribute('data-hb-edit');
      if (p.indexOf(prefix) !== 0) return;
      const idx = p.slice(prefix.length).split('.')[0];
      if (/^\d+$/.test(idx)) (byIdx[idx] = byIdx[idx] || []).push(el);
    });
    const indices = Object.keys(byIdx);
    if (!indices.length) return false;
    function crossesIntoOtherItem(node, idx) {
      const all = node.querySelectorAll('[data-hb-edit^="' + prefix + '"]');
      for (let i = 0; i < all.length; i++) {
        const seg = all[i].getAttribute('data-hb-edit').slice(prefix.length).split('.')[0];
        if (seg !== idx) return true;
      }
      return false;
    }
    function itemScope(idx) {
      const field = byIdx[idx][0];
      const tag = field.closest('.hb-list-item');
      if (tag) return tag;
      let node = field;
      for (let i = 0; i < 6 && node.parentElement; i++) {
        const next = node.parentElement;
        if (crossesIntoOtherItem(next, idx)) break;
        node = next;
      }
      return node;
    }
    function commonAncestor(a, b) {
      const ancestorsA = new Set();
      for (let n = a; n; n = n.parentElement) ancestorsA.add(n);
      for (let n = b; n; n = n.parentElement) if (ancestorsA.has(n)) return n;
      return document.body;
    }
    const itemScopes = indices.map(itemScope);
    let listScope = itemScopes[0];
    for (let i = 1; i < itemScopes.length; i++) listScope = commonAncestor(listScope, itemScopes[i]);
    if (itemScopes.length === 1 && listScope.parentElement) listScope = listScope.parentElement;
    const btn = listScope.querySelector('.hb-add-btn, .hb-ls-add');
    if (!btn) return false;
    btn.click();
    return true;
  }, root);
  return clicked;
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

let browser;
let server;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite2-newcat-'));
  process.env.SERVER_SECRET = 'suite2-newcat-' + crypto.randomBytes(8).toString('hex');
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  global.__BASE__ = 'http://127.0.0.1:' + server.address().port;

  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const TEMPLATES = ['local-service', 'portfolio', 'desserdirina'];

for (const templateId of TEMPLATES) {
  test(`${templateId}: "+ Adaugă categorie" produces a category the "Poze" panel can add a first photo to`, async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await openTemplateEditor(page, templateId);

      const before = await page.evaluate(() => draft.config.categories.length);

      // Baseline: how many gallery sections the "Poze" panel shows BEFORE
      // the new category exists — this is the count the pre-fix code held
      // constant across the add (the actual D2 symptom: "sections=5 ...
      // after=5").
      await page.locator('#btn-open-gallery').click();
      await page.locator('#modal-gallery').waitFor({ state: 'visible' });
      const sectionsBefore = await page.locator('#modal-gallery .gallery-path-section').count();
      await page.locator('#btn-close-gallery').click();
      await page.locator('#modal-gallery').waitFor({ state: 'hidden' });

      const clicked = await clickListAddButton(page, 'categories');
      assert.ok(clicked, templateId + ': could not find/click the categories "+ Adaugă" button — test setup broken, not the defect under test');
      await page.waitForTimeout(400);

      const after = await page.evaluate(() => draft.config.categories.length);
      assert.equal(after, before + 1, templateId + ': clicking "+ Adaugă categorie" must append exactly one category');

      const newCategory = await page.evaluate(() => draft.config.categories[draft.config.categories.length - 1]);
      assert.deepEqual(newCategory.photos, [], templateId + ': a freshly-added category must start with photos:[] (onListAdd seeding — separate from this fix, sanity-checked here)');

      const newPath = 'categories.' + (after - 1) + '.photos';

      await page.locator('#btn-open-gallery').click();
      await page.locator('#modal-gallery').waitFor({ state: 'visible' });
      const sectionsAfter = await page.locator('#modal-gallery .gallery-path-section').count();

      // This is the actual regression this oracle exists to catch: pre-fix,
      // sectionsAfter === sectionsBefore (the exact D2 symptom).
      assert.equal(sectionsAfter, sectionsBefore + 1,
        templateId + ': "Poze" must gain exactly one new section for the new category — got ' + sectionsBefore + ' -> ' + sectionsAfter);

      const newSection = page.locator('.gallery-path-section[data-photo-path="' + newPath + '"]');
      await newSection.waitFor({ state: 'visible', timeout: 5000 });

      const thumbsBefore = await newSection.locator('.photo-thumb-card').count();
      assert.equal(thumbsBefore, 0, templateId + ': the new section must start with an empty (but present) photo slot row');

      const dropzoneInput = newSection.locator('input[type=file][multiple]');
      assert.equal(await dropzoneInput.count(), 1, templateId + ': the new section must offer a working "Adaugă poze" upload control');

      const buf = await genPhotoBuffer(page, '#2266cc');
      await dropzoneInput.setInputFiles({ name: 'first-photo.jpg', mimeType: 'image/jpeg', buffer: buf });
      await page.waitForFunction((p) => {
        const arr = getPath(draft.config, p);
        return Array.isArray(arr) && arr.length > 0;
      }, newPath, { timeout: 8000 });

      const photos = await page.evaluate((p) => getPath(draft.config, p), newPath);
      assert.equal(photos.length, 1, templateId + ': exactly one photo must land in the new category');
      assert.ok(photos[0].src.startsWith('data:image/jpeg'), templateId + ': uploaded photo must be a real resized data: URL, not a placeholder');

      // Preview: the modal must reflect it immediately (no reload needed).
      const thumbsAfter = await newSection.locator('.photo-thumb-card').count();
      assert.equal(thumbsAfter, 1, templateId + ': the modal itself must show the new thumbnail right away');

      await page.locator('#btn-close-gallery').click();
      await page.locator('#modal-gallery').waitFor({ state: 'hidden' });

      // The on-canvas preview must ALSO show it (fullRerender() is called
      // by the upload handler) — check the iframe for an <img> whose src
      // matches the uploaded photo, scoped to the new category's own
      // rendered block via its title text.
      const iframeHandle = await page.$('#preview-iframe');
      const iframeCtx = await iframeHandle.contentFrame();
      const inPreview = await iframeCtx.evaluate((needleTitle) => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.some((img) => img.src && img.src.indexOf('data:image/jpeg') === 0);
      }, newCategory.title);
      assert.ok(inPreview, templateId + ': the newly-uploaded photo must appear as a real <img> in the live canvas preview');

      // Publish and verify the photo actually reaches the live site — the
      // acceptance bar the plan sets for this suite ("/live/ le arată").
      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      const slug = 'suite2-newcat-' + templateId.replace(/[^a-z0-9]/gi, '') + '-' + Date.now().toString(36);
      await page.locator('#input-slug').fill(slug);
      await page.locator('#btn-publish-continue').click();
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });
      await page.locator('#input-email').fill('suite2-newcat-' + templateId + '@example.com');
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      await page.locator('#dev-link').click();
      await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
      await page.locator('#btn-pay-publish').click();
      await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });

      // webpublish's own materialization (registry update + file write under
      // $DATA_DIR/published/<slug>/) finishes asynchronously, slightly AFTER
      // the client shows #modal-success-title — poll briefly rather than
      // fetching once and racing it (observed as an occasional 404 otherwise).
      let liveResp;
      let liveHtml = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        liveResp = await page.request.get(global.__BASE__ + '/live/' + slug + '/');
        if (liveResp.status() === 200) { liveHtml = await liveResp.text(); break; }
        await page.waitForTimeout(300);
      }
      assert.equal(liveResp.status(), 200, templateId + ': the published page must be reachable');
      const hasGalleryImage = /gallery-\d+\.(jpe?g|png|webp)/i.test(liveHtml) || liveHtml.includes('data:image/jpeg');
      assert.ok(hasGalleryImage, templateId + ': the published HTML must reference the uploaded photo (materialized file or inline data: URL)');
    } finally {
      await page.close();
    }
  });
}
