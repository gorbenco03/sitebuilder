'use strict';
/**
 * bot/test/suite12-no-editor-controls-on-non-owner-content.test.js
 *
 * VERIFIED FINDING (explorer): the "Înlocuiește fotografia" (replace photo)
 * control is attached to the internal WhatsApp QR-code <img id="wa-qr-img">
 * — 0x0 at rest, painted at runtime by templates/shared/qrcode.js from
 * contact.waHref, not owner photography. It can never usefully be used and
 * should not exist. Confirmed present in ALL FIVE templates (the WhatsApp QR
 * modal is a shared feature, not professionals-only) — see each template's
 * template.html, `<div class="wa-qr__code"><img id="wa-qr-img" ...>`.
 *
 * SWEEP: the same class of bug — an editor affordance generically attached
 * to non-owner content by builder/edit-overlay.js's broad `querySelectorAll
 * ('img')` / `querySelectorAll('[style]')` scans — also applied to
 * local-service's `#lightbox-img` (a zoom preview that only ever mirrors
 * whichever real gallery photo is open; not itself a field with a config
 * path). Every OTHER `<img>` across the five templates (logos, gallery
 * photos, team photos, the Instagram teaser's example tiles) is either real
 * owner content (resolves through imgMap / a `data-hb-edit-img` stamp) or
 * already excluded structurally via `[data-hb-ig-teaser]` — see
 * suite10-instagram-teaser-*.test.js for that one.
 *
 * FIX (structural, not per-template selectors): a generic `[data-hb-non-
 * owner]` marker, stamped directly on the non-owner `<img>` in each
 * template's template.html, which builder/edit-overlay.js's setupImages()
 * (both the <img> loop and the inline-background-style loop) now skips via
 * `el.closest('[data-hb-ig-teaser], [data-hb-non-owner]')` — the same
 * mechanism the Instagram teaser already used, generalised so a future
 * non-owner element only needs the marker, never a new line of JS.
 *
 * This oracle drives the real editor in real Chromium against a real server
 * (same pattern as suite8/suite6) for all five templates, inspects the real
 * sandboxed preview iframe (where edit-overlay.js actually runs), and
 * asserts the QR image (and, for local-service, the lightbox image) stays a
 * bare, unwrapped <img> with no "Înlocuiește fotografia" button anywhere
 * near it.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-no-editor-controls-on-non-owner-content.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-non-owner-'));
process.env.SERVER_SECRET = 'non-owner-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

const TEMPLATE_IDS = ['desserdirina', 'local-service', 'portfolio', 'product-menu', 'professionals'];

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

async function openEditor(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('.template-card[data-template-id="' + templateId + '"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
}

test('the WhatsApp QR-code image never grows a "Înlocuiește fotografia" control, in any template', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);

    for (const templateId of TEMPLATE_IDS) {
      await openEditor(page, templateId);
      const frame = page.frameLocator('#preview-iframe');

      const qrImg = frame.locator('#wa-qr-img');
      const qrCount = await qrImg.count();
      assert.equal(qrCount, 1, templateId + ': every template ships the shared WhatsApp QR <img id="wa-qr-img">');

      const marked = await qrImg.evaluate((el) => el.hasAttribute('data-hb-non-owner'));
      assert.equal(marked, true, templateId + ': #wa-qr-img must carry the structural data-hb-non-owner marker');

      // Still a direct child of .wa-qr__code — setupImages() did NOT insert
      // its usual `<span class="hb-img-wrap">` around it.
      const stillUnwrapped = await frame.locator('.wa-qr__code > img#wa-qr-img').count();
      assert.equal(stillUnwrapped, 1, templateId + ': #wa-qr-img must stay a bare, unwrapped <img>');

      const wrapCount = await frame.locator('.wa-qr__code .hb-img-wrap').count();
      assert.equal(wrapCount, 0, templateId + ': no .hb-img-wrap must exist around the QR code');

      const btnCount = await frame.locator('.wa-qr__code .hb-img-btn').count();
      assert.equal(btnCount, 0, templateId + ': no "Înlocuiește fotografia" button must exist near the QR code');
    }

    await page.close();
  } finally {
    await browser.close();
  }
});

test('local-service\'s lightbox zoom image never grows a "Înlocuiește fotografia" control either', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    await openEditor(page, 'local-service');
    const frame = page.frameLocator('#preview-iframe');

    const lightboxImg = frame.locator('#lightbox-img');
    assert.equal(await lightboxImg.count(), 1, 'local-service ships #lightbox-img');
    assert.equal(
      await lightboxImg.evaluate((el) => el.hasAttribute('data-hb-non-owner')), true,
      '#lightbox-img must carry the structural data-hb-non-owner marker'
    );
    assert.equal(
      await frame.locator('.lightbox > img#lightbox-img').count(), 1,
      '#lightbox-img must stay a bare, unwrapped <img>'
    );
    assert.equal(await frame.locator('.lightbox .hb-img-wrap').count(), 0, 'no .hb-img-wrap around the lightbox image');
    assert.equal(await frame.locator('.lightbox .hb-img-btn').count(), 0, 'no replace-photo button near the lightbox image');

    await page.close();
  } finally {
    await browser.close();
  }
});
