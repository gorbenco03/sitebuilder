'use strict';
/**
 * bot/test/suite11-contact-chips-editable.test.js
 *
 * PLAN-FEEDBACK-2026-09-13, Suite B (points 2, 6, 8, 10): four owner
 * screenshots, one root cause each for two different rows.
 *
 *   - local-service ("Cere o ofertă gratuită"): the address row
 *     "București și împrejurimi" could not be clicked into.
 *   - portfolio ("Programează o vizită"): the address chip
 *     "Strada Icoanei 18 / București 020451" could not be clicked into.
 *   - professionals (Contact): the address row
 *     "Strada Academiei 12, etajul 4 / București 010014" could not be
 *     clicked into.
 *   - desserdirina ("Comandă acum"): neither the address row NOR the
 *     "WhatsApp" row could be clicked into.
 *
 * Root causes (see build.js and templates/*\/template.html):
 *
 *   1. The address always rendered via the RAW sink `{{& contact.address}}`
 *      (needed so a multi-line address can carry real <br> line breaks).
 *      replaceTokens()'s `if (raw) { … }` branch returned early for every
 *      raw sink, before ever reaching the "wrap in <span data-hb-edit>"
 *      logic that every plain `{{token}}` gets in edit mode — so the
 *      address span never became a target you could click into on ANY of
 *      the five templates (product-menu has the exact same raw sink and is
 *      exercised here too, even though the owner did not screenshot it).
 *
 *   2. desserdirina's own contact section hardcoded the English word
 *      "WhatsApp" as a literal string (`<span>WhatsApp</span>`) — not a
 *      token at all — while every other template already rendered
 *      `{{labels.whatsapp}}` there. There was nothing to click into because
 *      there was no field.
 *
 * The fix:
 *   - build.js: the `contact.address` raw sink now wraps its sanitized
 *     value in the same `<span data-hb-edit="contact.address"
 *     data-hb-kind="text">` shape every other editable field gets, gated
 *     exactly like the generic path (editMode + text context only — the
 *     published/export render path is untouched, still returns the bare
 *     sanitized string). A `data-hb-multiline="br"` marker tells
 *     builder/edit-overlay.js this field's line breaks are real <br>
 *     elements, not a plain-text '\n' — see its setupTextFields() doc
 *     comment for the read/write contract that keeps this consistent with
 *     sanitizeAddress()'s "escape everything, then un-escape only <br>"
 *     rule (bot/flow.js's formatAddressHtml, frozen/Telegram, stores
 *     addresses the exact same way already).
 *   - templates/desserdirina/template.html: the hardcoded "WhatsApp" text
 *     is now `{{labels.whatsapp}}`, matching the other four templates
 *     (which already had this token — despite the owner report, local-
 *     service/portfolio/professionals/product-menu's own WhatsApp rows
 *     were already correctly wired; only desserdirina's was hardcoded. See
 *     the "already worked" assertions below.).
 *   - build.js's normalizeConfigForRender() defaults labels.whatsapp to
 *     "WhatsApp" when a config never set it (same pattern as the existing
 *     labels.menuLang default) — so a config saved before this field
 *     existed still publishes the same word it always did.
 *
 * This suite asserts, in the real builder (a real browser driving the real
 * sandboxed srcdoc iframe, not a render-only assertion), for each of the
 * four reported templates:
 *   1. the address field is a real, clickable, contenteditable span (not a
 *      bare, unwrapped raw-HTML sink);
 *   2. clicking it does not navigate (it usually sits inside a Google Maps
 *      <a>, same hazard the phone row already solved — see
 *      wave9-edit-label-no-activate.test.js);
 *   3. typing a two-line address (with a real Enter keystroke) persists to
 *      draft.config as `"line 1<br>line 2"`;
 *   4. the published (non-editMode) render shows those exact two lines with
 *      a real <br>;
 *   5. typing `<script>…</script>` into the field stays inert, escaped text
 *      everywhere — never a live tag;
 *   6. the WhatsApp label is a real, clickable, contenteditable span that
 *      persists an edit the same way.
 *
 * Run: node --test bot/test/suite11-contact-chips-editable.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite11-contact-'));
process.env.SERVER_SECRET = 'suite11-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;

// Rebuild builder/generated/engine.js so it embeds the CURRENT
// builder/edit-overlay.js source (it is inlined verbatim as a string — see
// scripts/build-builder.js's EDIT_OVERLAY_SRC) — otherwise this suite would
// silently exercise a stale bundle.
require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

// Four templates from the owner's screenshots. product-menu shares the same
// build.js root cause for its address row (see the doc comment above) but
// was not screenshotted — a lighter, address-only check for it lives in the
// last test below as sweep evidence, not a full duplicate of every case.
const TEMPLATES = ['local-service', 'portfolio', 'professionals', 'desserdirina'];

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
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

async function openEditor(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 3000 }).catch(() => {});
  }
}

async function selectAllAndType(page, text) {
  await page.keyboard.press('Control+a').catch(() => {});
  await page.keyboard.press('Meta+a').catch(() => {});
  await page.keyboard.type(text);
}

for (const templateId of TEMPLATES) {
  test(`[${templateId}] contact.address: editable inline, multi-line survives, <script> stays inert`, async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    try {
      await openEditor(page, templateId);
      const frame = page.frameLocator('#preview-iframe');
      const addr = frame.locator('[data-hb-edit="contact.address"]').first();
      await addr.waitFor({ state: 'attached' });

      // 1) Structural proof: a real editable field, not a bare raw sink.
      const attrs = await addr.evaluate((el) => ({
        contenteditable: el.getAttribute('contenteditable'),
        kind: el.getAttribute('data-hb-kind'),
        multiline: el.getAttribute('data-hb-multiline'),
      }));
      assert.equal(attrs.contenteditable, 'true', templateId + ': address must be contenteditable');
      assert.equal(attrs.kind, 'text', templateId + ': address must carry data-hb-kind="text"');
      assert.equal(attrs.multiline, 'br', templateId + ': address must be marked <br>-based multiline');

      // 2) Clicking it must not navigate (it sits inside a Google Maps <a>
      //    on this preset, or a plain <span> when there is no maps link —
      //    either way the canvas must stay put, same guarantee the phone
      //    row already has).
      const before = await page.evaluate(() => location.href);
      await addr.click();
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => location.href);
      assert.equal(after, before, templateId + ': clicking the address must not navigate the canvas');

      // 3) Replace it with a real two-line address, typed with an actual
      //    Enter keystroke (not a pasted '\n').
      await selectAllAndType(page, 'Strada Nouă 25');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Cluj-Napoca 400000');
      await addr.blur();
      await page.waitForTimeout(500);

      const stored = await page.evaluate(() => draft.config.contact.address);
      assert.equal(
        stored,
        'Strada Nouă 25<br>Cluj-Napoca 400000',
        templateId + ': multi-line address must persist to config with a real <br> marker, got ' + JSON.stringify(stored)
      );

      // 4) Published (non-editMode) render must show the exact same lines.
      const tplHtml = fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
      let cfg = await page.evaluate(() => draft.config);
      let publicHtml = renderHtml(tplHtml, cfg);
      assert.match(
        publicHtml,
        /Strada Nouă 25<br>Cluj-Napoca 400000/,
        templateId + ': published HTML must render the same two lines with a real <br>'
      );

      // 5) <script> typed into the field must never become a live tag.
      await addr.click();
      await selectAllAndType(page, '<script>window.__hbXss = true;</script>');
      await addr.blur();
      await page.waitForTimeout(500);

      cfg = await page.evaluate(() => draft.config);
      publicHtml = renderHtml(tplHtml, cfg);
      assert.ok(
        !/<script>window\.__hbXss/.test(publicHtml),
        templateId + ': typed <script> must never render as a live tag in published HTML'
      );
      assert.ok(
        publicHtml.includes('&lt;script&gt;window.__hbXss'),
        templateId + ': typed <script> must render as inert, escaped text'
      );
    } finally {
      await page.close();
    }
  });

  test(`[${templateId}] labels.whatsapp: editable inline and persists`, async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    try {
      await openEditor(page, templateId);
      const frame = page.frameLocator('#preview-iframe');
      const wa = frame.locator('[data-hb-edit="labels.whatsapp"]').first();
      await wa.waitFor({ state: 'attached' });
      assert.equal(
        await wa.getAttribute('contenteditable'),
        'true',
        templateId + ': WhatsApp label must be contenteditable'
      );

      const before = await page.evaluate(() => location.href);
      await wa.click();
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => location.href);
      assert.equal(after, before, templateId + ': clicking the WhatsApp label must not navigate');

      await selectAllAndType(page, 'Scrie-ne pe WhatsApp');
      await wa.blur();
      await page.waitForTimeout(500);

      const stored = await page.evaluate(() => draft.config.labels.whatsapp);
      assert.equal(stored, 'Scrie-ne pe WhatsApp', templateId + ': WhatsApp label edit must persist to config');

      const tplHtml = fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
      const cfg = await page.evaluate(() => draft.config);
      const publicHtml = renderHtml(tplHtml, cfg);
      assert.match(publicHtml, /Scrie-ne pe WhatsApp/, templateId + ': published HTML must show the new WhatsApp label');
    } finally {
      await page.close();
    }
  });
}

// Sweep evidence: product-menu's contact.address goes through the exact same
// build.js raw-sink fix (it was never screenshotted, but the cause and the
// fix are template-agnostic) — a lighter check, not a full duplicate of the
// four cases above.
test('[product-menu] contact.address is also editable inline (same root cause, not screenshotted)', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  try {
    await openEditor(page, 'product-menu');
    const frame = page.frameLocator('#preview-iframe');
    const addr = frame.locator('[data-hb-edit="contact.address"]').first();
    await addr.waitFor({ state: 'attached' });
    assert.equal(await addr.getAttribute('contenteditable'), 'true', 'product-menu: address must be contenteditable');
    assert.equal(await addr.getAttribute('data-hb-multiline'), 'br', 'product-menu: address must be <br>-multiline');

    await addr.click();
    await selectAllAndType(page, 'Bulevardul Unirii 5<br literal test');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Iași 700000');
    await addr.blur();
    await page.waitForTimeout(500);

    const stored = await page.evaluate(() => draft.config.contact.address);
    assert.ok(stored.includes('<br>Iași 700000'), 'product-menu: typed line break must persist as a real <br> marker');
  } finally {
    await page.close();
  }
});

// desserdirina-specific regression guard: the WhatsApp row used to be a
// hardcoded English literal, never a token. Prove the template markup no
// longer ships that literal at all (the "editable" behaviour is already
// covered by the parametrized test above).
test('[desserdirina] the WhatsApp row is no longer a hardcoded literal in the template source', () => {
  const tplHtml = fs.readFileSync(path.join(ROOT, 'templates', 'desserdirina', 'template.html'), 'utf8');
  assert.ok(
    !/<span>WhatsApp<\/span>/.test(tplHtml),
    'desserdirina: the contact-section WhatsApp row must not be a hardcoded literal any more'
  );
  assert.match(
    tplHtml,
    /<span class="contact-icon whatsapp" aria-hidden="true"><\/span>\s*<span>\{\{labels\.whatsapp\}\}<\/span>/,
    'desserdirina: the WhatsApp row must render {{labels.whatsapp}}'
  );
});
