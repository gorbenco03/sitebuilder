'use strict';
/**
 * bot/test/suite2-string-gallery-in-photos-panel.test.js — PLAN-QA-2026-09-12,
 * Suite 2, S2-2/S2-3 (B4, second cause).
 *
 * B4's ORIGINAL finding (04-QA-Evidence/QA-Explorare-2026-09-12/reports/
 * 09-robustness-performance.md, D3): professionals' `instagram.gallery`
 * cannot be populated anywhere in the UI. Two of its three stacked causes
 * were fixed elsewhere — SAFE_LIST_PATHS not covering `.gallery` paths
 * (Suite 1 / S1-4) is done; this file covers the second, distinct cause the
 * task briefing assigned here: `findPhotoPaths()` (builder/app.js) only ever
 * recognized arrays of `{src,alt}` OBJECTS (`v.some(p => p && p.src)`), but
 * professionals declares `instagram.gallery` with `itemShape: {".": "text"}`
 * — items are BARE STRINGS, rendered directly as `<img src="{{.}}">`
 * (templates/professionals/template.html:412) — so that check could never
 * match it, no matter how many photos it held.
 *
 * FIX, AND A THIRD CAUSE THIS TASK'S BRIEFING DID NOT KNOW ABOUT:
 *
 * findPhotoPaths() now asks the schema directly (isBareScalarListField() —
 * itemShape `{'.': type}` means "each item IS the value", the same
 * convention build.js's own `{{.}}` token resolver and onListAdd()'s
 * primaryItemShapeKey() already use) instead of sniffing array contents —
 * this generically fixes recognition of ANY bare-scalar-string photo list,
 * proven below with a synthetic schema field (test 3), independent of
 * whether any shipped template currently benefits from it.
 *
 * `instagram.gallery` specifically does NOT benefit from it, and this file's
 * first two tests exist to document and lock in why: build.js's
 * normalizeInstagramForPublic() — the S111 owner policy ("public Instagram
 * section only when Instafidget is connected... no fake gallery pretending
 * to be a live feed") — unconditionally sets `instagram.gallery` to `[]` on
 * EVERY render, in the editor's own live preview and on the published site
 * alike, whether or not a partner embed is connected. This was verified
 * directly: seeding `instagram.handle` + `instagram.gallery` on
 * draft.config and re-rendering never produces an `#instagram` section in
 * the DOM at all (confirmed independently by
 * suite1-lists-from-schema.test.js's own professionals case, which already
 * logs "skipped, 0 items rendered" for this exact field for this exact
 * reason). A photo added to this field could never be seen anywhere, by
 * anyone, regardless of what findPhotoPaths() does — so surfacing an
 * upload control for it in "Poze" would be exactly the "fake gallery" S111
 * was written to eliminate, just relocated into the editor's own UI.
 *
 * DECISION (see the implementation report for the full writeup): rather
 * than "fix" B4 literally as briefed (make instagram.gallery uploadable,
 * expect published photos to show), findPhotoPaths() now explicitly excludes
 * `instagram.gallery` (isS111DeadInstagramGalleryPath()) and the canvas
 * "+ Adaugă" button Wave 1 already puts on it (unreachable via the real UI
 * today, since the containing section never renders — but exercised here
 * directly for a defensive regression check) warns instead of writing a
 * corrupt placeholder. This is the smallest, most reversible response to a
 * real, documented product policy this task's briefing did not know about.
 *
 * RED (pre-fix): test 3 (the generic bare-scalar-list mechanism) fails —
 * no "Poze" section for a schema-declared string-array photo field, no
 * matter its name. Tests 1/2 (the S111 carve-out) are NOT meaningfully RED
 * pre-fix for the same reason in a different way: pre-fix, instagram.gallery
 * ALSO never appears in "Poze" (old code required {src,alt} objects) — but
 * for the wrong reason. What tests 1/2 actually guard is a hypothetical
 * regression: naively deleting only the object-shape restriction (without
 * ALSO adding the S111 carve-out) would have made instagram.gallery
 * incorrectly START appearing. Verified directly as part of this task by
 * temporarily removing isS111DeadInstagramGalleryPath()'s guard and
 * confirming test 1 goes red — see the implementation report's evidence log.
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

/** professionals.instagram.gallery starts EMPTY in the default preset and
 *  its whole section is gated on `@if instagram.handle` — seed both
 *  directly on the document model, same technique
 *  suite1-lists-from-schema.test.js's seedProfessionalsInstagramGallery()
 *  uses (these are plain globals in the page's classic-script realm). */
async function seedInstagramGallery(page) {
  await page.evaluate(() => {
    /* eslint-disable no-undef */
    setPath(draft.config, 'instagram.handle', 'qa_salon');
    setPath(draft.config, 'instagram.gallery', ['images/pr-hero.jpg', 'images/pr-hero.jpg']);
    fullRerender();
    /* eslint-enable no-undef */
  });
  await page.waitForTimeout(900);
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

test('professionals: instagram.gallery does NOT get a fake, non-functional entry in "Poze" (S111)', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');
    await seedInstagramGallery(page);

    await page.locator('#btn-open-gallery').click();
    await page.locator('#modal-gallery').waitFor({ state: 'visible' });

    const sectionCount = await page.locator('.gallery-path-section[data-photo-path="instagram.gallery"]').count();
    assert.equal(sectionCount, 0,
      'instagram.gallery must NOT get a "Poze" section — any upload there could never be visible (S111), so offering one would be a fake control');

    const modalText = await page.locator('#modal-gallery').textContent();
    assert.ok(!/Galerie Instagram/i.test(modalText),
      'the "Galerie Instagram" label (humanizePhotoPathLabel\'s existing special case) must not appear either');
  } finally {
    await page.close();
  }
});

test('professionals: the #instagram section genuinely never renders even when seeded — documents WHY the exclusion above is correct, not just convenient', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');
    await seedInstagramGallery(page);

    const cfgAfter = await page.evaluate(() => JSON.stringify(draft.config.instagram));
    assert.ok(JSON.parse(cfgAfter).handle === 'qa_salon' && JSON.parse(cfgAfter).gallery.length === 2,
      'sanity: the seed must actually have landed in draft.config — ' + cfgAfter);

    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();
    const sectionExists = await iframeCtx.evaluate(() => !!document.getElementById('instagram'));
    assert.equal(sectionExists, false,
      'the #instagram section must be absent from the rendered preview DOM even with handle+gallery set directly — ' +
      'this is build.js\'s normalizeInstagramForPublic() (S111) unconditionally clearing instagram.handle/gallery on ' +
      'every render; if this assertion ever starts failing, S111 has changed and the exclusion above should be revisited');
  } finally {
    await page.close();
  }
});

test('generic mechanism: a schema-declared bare-scalar-string photo list (itemShape {".":"text"}) gets a working "Poze" section', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');

    // Graft a synthetic field onto the live schema + config to exercise
    // findPhotoPaths()/buildGallerySection()'s bare-scalar-list path in
    // isolation from S111 (which is specific to the literal key
    // "instagram.gallery" — see isS111DeadInstagramGalleryPath()). This is
    // the same class of technique suite1-lists-from-schema.test.js already
    // uses (direct draft.config manipulation via page.evaluate); here it
    // also patches the in-memory schema object app.js reads at
    // findPhotoPaths()-time, since app.js has no server round trip for that.
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

test('professionals: clicking canvas "+ Adaugă" on instagram.gallery never corrupts the array with a placeholder object', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');
    await seedInstagramGallery(page);

    // The generic overlay's "+ Adaugă" for this field is unreachable via
    // the real UI today (the #instagram section it would attach to never
    // renders — see the "genuinely never renders" test above), so this
    // exercises builder/app.js's postMessage handler directly, the same
    // path a real click would take if the section ever did render (e.g. if
    // S111's policy changes in the future).
    const before = await page.evaluate(() => draft.config.instagram.gallery.slice());
    // initPostMessageListener() only accepts messages whose event.source is
    // the preview iframe's own contentWindow (edit-overlay.js runs inside
    // it and calls `parent.postMessage(...)`) — post from THERE, not from
    // the top-level page, or the listener's origin check silently drops it.
    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();
    await iframeCtx.evaluate(() => {
      window.parent.postMessage({ hb: 'list-add', listPath: 'instagram.gallery' }, '*');
    });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => draft.config.instagram.gallery);

    assert.deepEqual(after, before,
      'instagram.gallery must be byte-for-byte unchanged — no {".": "..."} placeholder object pushed');
    assert.ok(after.every((item) => typeof item === 'string'),
      'every item must remain a plain string — got ' + JSON.stringify(after));
  } finally {
    await page.close();
  }
});
