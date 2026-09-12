'use strict';
/**
 * bot/test/suite2-string-gallery-in-photos-panel.test.js — PLAN-QA-2026-09-12,
 * Suite 2, S2-2/S2-3 (B4, second cause).
 *
 * B4's ORIGINAL finding (04-QA-Evidence/QA-Explorare-2026-09-12/reports/
 * 09-robustness-performance.md, D3): professionals' `instagram.gallery`
 * could not be populated anywhere in the UI. Two of its three stacked causes
 * were fixed elsewhere — SAFE_LIST_PATHS not covering `.gallery` paths
 * (Suite 1 / S1-4) is done; this file covered the second, distinct cause the
 * task briefing assigned here: `findPhotoPaths()` (builder/app.js) only ever
 * recognized arrays of `{src,alt}` OBJECTS (`v.some(p => p && p.src)`), but
 * professionals declared `instagram.gallery` with `itemShape: {".": "text"}`
 * — items were BARE STRINGS, rendered directly as `<img src="{{.}}">` — so
 * that check could never match it, no matter how many photos it held.
 *
 * FIX: findPhotoPaths() now asks the schema directly (isBareScalarListField()
 * — itemShape `{'.': type}` means "each item IS the value", the same
 * convention build.js's own `{{.}}` token resolver and onListAdd()'s
 * primaryItemShapeKey() already use) instead of sniffing array contents —
 * this generically fixes recognition of ANY bare-scalar-string photo list,
 * proven below with a synthetic schema field, independent of whether any
 * shipped template currently uses that shape.
 *
 * THIRD CAUSE, DISCOVERED WHILE FIXING B4, AND WHY THIS FILE NO LONGER
 * MENTIONS INSTAGRAM: build.js's normalizeInstagramForPublic() — the S111
 * owner policy ("public Instagram section only when Instafidget is
 * connected... no fake gallery pretending to be a live feed") —
 * unconditionally cleared `instagram.gallery` to `[]` on EVERY render, in
 * the editor's own live preview and on the published site alike, whether or
 * not a partner embed was connected. A photo added to that field could
 * never be seen anywhere, by anyone — so, task S9B removed the field
 * itself (schema.json, presets.json, template.html markup, and the
 * isS111DeadInstagramGalleryPath()/"Galerie Instagram" workarounds in
 * builder/app.js this file used to lock in) rather than leave a dead field
 * on the books. The `#instagram` section and the real (embedUrl-connected)
 * feed path are untouched — see bot/test/social-feed-partner.test.js and
 * s3-design-systems.test.js's embedUrl checks.
 *
 * What remains here is the generic mechanism test only — it never depended
 * on Instagram, just needed a schema-declared bare-scalar-string list to
 * exercise isBareScalarListField()/findPhotoPaths() against, and still does
 * via a synthetic field grafted onto professionals' live schema.
 *
 * Run: node --experimental-sqlite --test bot/test/suite2-string-gallery-in-photos-panel.test.js
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
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite2-strgal-'));
  process.env.SERVER_SECRET = 'suite2-strgal-' + crypto.randomBytes(8).toString('hex');
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

test('generic mechanism: a schema-declared bare-scalar-string photo list (itemShape {".":"text"}) gets a working "Poze" section', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');

    // Graft a synthetic field onto the live schema + config to exercise
    // findPhotoPaths()/buildGallerySection()'s bare-scalar-list path — the
    // same class of technique suite1-lists-from-schema.test.js uses (direct
    // draft.config manipulation via page.evaluate); here it also patches
    // the in-memory schema object app.js reads at findPhotoPaths()-time,
    // since app.js has no server round trip for that.
    await page.evaluate(() => {
      /* eslint-disable no-undef */
      currentTemplate.data.schema.sections.push({
        title: 'QA synthetic',
        fields: [{
          key: 'qaStringGallery',
          type: 'list',
          label: 'QA string gallery',
          min: 0,
          max: 12,
          itemShape: { '.': 'text' },
        }],
      });
      setPath(draft.config, 'qaStringGallery', []);
      fullRerender();
      /* eslint-enable no-undef */
    });
    await page.waitForTimeout(400);

    await page.locator('#btn-open-gallery').click();
    await page.locator('#modal-gallery').waitFor({ state: 'visible' });

    const section = page.locator('.gallery-path-section[data-photo-path="qaStringGallery"]');
    await section.waitFor({ state: 'visible', timeout: 5000 });

    // No alt-text input for a bare-scalar path — writing one would have to
    // promote a plain string item into a {src,alt} object, which the
    // template's `{{.}}` token can never read back correctly.
    assert.equal(await section.locator('.photo-thumb-alt').count(), 0,
      'a bare-scalar photo path must not offer an alt-text field (it would corrupt the array\'s shape)');

    const buf = await genPhotoBuffer(page, '#cc3366');
    await section.locator('input[type=file][multiple]').setInputFiles({ name: 'qa.jpg', mimeType: 'image/jpeg', buffer: buf });
    await page.waitForFunction(() => Array.isArray(draft.config.qaStringGallery) && draft.config.qaStringGallery.length > 0, { timeout: 8000 });

    const gallery = await page.evaluate(() => draft.config.qaStringGallery);
    assert.equal(gallery.length, 1, 'exactly one item must be pushed');
    assert.equal(typeof gallery[0], 'string', 'the pushed item must be a BARE STRING, not a {src,alt} object — got ' + JSON.stringify(gallery[0]));
    assert.ok(gallery[0].startsWith('data:image/jpeg'), 'the string must be the real uploaded photo data');
  } finally {
    await page.close();
  }
});
