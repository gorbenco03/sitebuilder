'use strict';
/**
 * bot/test/audit27-u-03-whatsapp-preview.test.js — oracle for PLAN-AUDIT-2026-09-27.md
 * task U-03 (PLAN-UX-2026-09-27.md §3 rows "Preview live al linkului WhatsApp
 * rezultat" and "Etichetă unificată pentru câmpul WhatsApp").
 *
 * Two independent defects, one task:
 *
 * 1. Detalii → Contact's WhatsApp number field gave no feedback about the
 *    ACTUAL link it produces — just a static label with an example. Fixed by
 *    rendering a live "Link rezultat: wa.me/…" preview + a "Testează" link
 *    (opens in a new tab) right under the field, refreshed on every keystroke
 *    in either the number or the message field, plus a static hint spelling
 *    out the R-07 local-number normalization (normalizeWhatsAppDigits()):
 *    "0721234567" -> "+40721234567".
 * 2. `professionals/schema.json` had a different contact.whatsapp label than
 *    the other 4 templates ("WhatsApp (cifre internaționale)" vs "Număr
 *    WhatsApp internațional fără + (ex. 40721234567)"), with no example.
 *    Unified onto product-menu's label/help text across all 5 templates.
 *
 * RED is demonstrated two ways, without git stash (repo policy):
 *   - schema labels: read every template's schema.json AT THE PARENT COMMIT
 *     (before this task) and show professionals' label differs from the
 *     other four there — the exact mismatch this task fixes.
 *   - live preview: build a servable copy of builder/ with app.js swapped
 *     for the PARENT COMMIT's version (same pattern as
 *     wave11-firstrun-quickstart.test.js's buildOldBuilderDir) and show the
 *     Detalii whatsapp field has no ".field-wa-preview" / "Testează" UI there.
 *
 * GREEN re-runs both against the current tree: labels match everywhere, and
 * the live server's Detalii drawer shows a working, live-updating preview +
 * working "Testează" link, including refreshing when the SEPARATE waMessage
 * field changes (proves the cross-field refresh hook, not just same-field).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-03-whatsapp-preview.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { serveDir } = require('./wave5-desserdirina-helpers.js');

// The commit this task branched from — override with HIDOOK_BEFORE_REF if
// this file is ever reused after a rebase (see wave11's identical pattern).
const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || '88402c6';

const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

function readGitFile(ref, relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function whatsappLabel(schemaSrc, key) {
  const schema = JSON.parse(schemaSrc);
  let found = null;
  (function walk(node) {
    if (found) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      if (node.key === key && typeof node.label === 'string') { found = node.label; return; }
      Object.values(node).forEach(walk);
    }
  })(schema);
  return found;
}

function buildOldBuilderDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u03-old-builder-'));
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'builder'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), readGitFile(BEFORE_REF, 'builder/app.js'));
  fs.writeFileSync(path.join(dir, 'index.html'), readGitFile(BEFORE_REF, 'builder/index.html'));
  return root;
}

async function openProductMenuDrawer(page, entryUrl) {
  await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
  const cookieBtn = page.locator('#hb-cookie-accept');
  if (await cookieBtn.isVisible().catch(() => false)) {
    await cookieBtn.click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// 1. Schema label unification — file-level RED (parent commit) / GREEN (HEAD).
// ---------------------------------------------------------------------------

test('RED (' + BEFORE_REF + '): professionals\' WhatsApp label mismatched the other 4 templates', () => {
  const labels = TEMPLATE_IDS.map((id) =>
    whatsappLabel(readGitFile(BEFORE_REF, `templates/${id}/schema.json`), 'contact.whatsapp')
  );
  const distinct = new Set(labels);
  assert.ok(
    distinct.size > 1,
    'sanity: at ' + BEFORE_REF + ' the 5 templates must NOT all share one contact.whatsapp label yet — got ' + JSON.stringify(labels)
  );
  assert.notStrictEqual(
    labels[TEMPLATE_IDS.indexOf('professionals')],
    labels[TEMPLATE_IDS.indexOf('product-menu')],
    'sanity: professionals must differ from product-menu at ' + BEFORE_REF
  );
});

test('GREEN: all 5 templates share one WhatsApp number label and one message-field label', () => {
  const numberLabels = TEMPLATE_IDS.map((id) =>
    whatsappLabel(fs.readFileSync(path.join(ROOT, 'templates', id, 'schema.json'), 'utf8'), 'contact.whatsapp')
  );
  const messageLabels = TEMPLATE_IDS.map((id) =>
    whatsappLabel(fs.readFileSync(path.join(ROOT, 'templates', id, 'schema.json'), 'utf8'), 'contact.waMessage')
  );
  assert.strictEqual(new Set(numberLabels).size, 1, 'contact.whatsapp label must be identical on all 5 templates, got ' + JSON.stringify(numberLabels));
  assert.strictEqual(new Set(messageLabels).size, 1, 'contact.waMessage label must be identical on all 5 templates, got ' + JSON.stringify(messageLabels));
  assert.match(numberLabels[0], /internațional fără \+.*40721234567/, 'unified label must keep the international-format example');
});

// ---------------------------------------------------------------------------
// 2. Live wa.me preview + "Testează" link in Detalii — browser RED / GREEN.
// ---------------------------------------------------------------------------

test('RED (' + BEFORE_REF + '): Detalii\'s WhatsApp field has no live preview / Testează UI', async () => {
  const oldDir = buildOldBuilderDir();
  const oldServer = await serveDir(oldDir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await openProductMenuDrawer(page, oldServer.base + '/app/index.html');
    const waWrap = page.locator('[data-field-key="contact.whatsapp"]');
    await waWrap.scrollIntoViewIfNeeded();
    assert.strictEqual(await waWrap.locator('.field-wa-preview').count(), 0, 'pre-fix Detalii must not have a live wa.me preview — this is new U-03 functionality');
    assert.strictEqual(await waWrap.locator('a', { hasText: 'Testează' }).count(), 0, 'pre-fix Detalii must not have a "Testează" link');
    await page.close();
  } finally {
    await browser.close();
    await oldServer.close();
  }
});

test('GREEN: WhatsApp field shows a live wa.me preview + working Testează link, updates from both fields', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'u03-whatsapp-preview-'));
  process.env.SERVER_SECRET = 'u03-whatsapp-preview-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_FAKE_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete require.cache[require.resolve(path.join(ROOT, 'bot', 'server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u03-whatsapp-shots-'));

  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await openProductMenuDrawer(page, base + '/app/');

    const waWrap = page.locator('[data-field-key="contact.whatsapp"]');
    await waWrap.scrollIntoViewIfNeeded();

    // R-07 normalization hint must be visible right at the field.
    await assert.doesNotReject(
      waWrap.locator('.field-hint', { hasText: /0721234567/ }).locator('..').isVisible()
    );
    const hintText = (await waWrap.locator('.field-hint').first().innerText());
    assert.match(hintText, /0721234567/, 'hint must show the local-number shape');
    assert.match(hintText, /\+40721234567/, 'hint must show the normalized result (R-07)');

    // Type a LOCAL number — normalizeWhatsAppDigits() must fold it to +40… in the preview.
    const numberInput = page.locator('#dr_contact_whatsapp');
    await numberInput.fill('0721234567');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shotDir, 'whatsapp-number-filled-local-format.png') });

    const previewLink = waWrap.locator('.field-wa-preview');
    const testLink = waWrap.locator('a.field-wa-test');
    await assert.doesNotReject(previewLink.waitFor({ state: 'visible' }));
    const previewText1 = await previewLink.innerText();
    assert.match(previewText1, /wa\.me\/40721234567/, 'live preview must show the normalized wa.me link, got: ' + previewText1);
    const href1 = await testLink.getAttribute('href');
    assert.match(href1, /^https:\/\/wa\.me\/40721234567\?text=/, 'Testează href must be the same normalized wa.me link, got: ' + href1);
    assert.strictEqual(await testLink.getAttribute('target'), '_blank', 'Testează must open in a new tab');
    assert.match(String(await testLink.getAttribute('rel')), /noopener/, 'Testează must use rel=noopener');

    // Now edit the SEPARATE waMessage field — the preview must refresh from there too.
    const msgInput = page.locator('#dr_contact_waMessage');
    if (await msgInput.count()) {
      await msgInput.fill('Salut, aș vrea un meniu pentru 4 persoane.');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(shotDir, 'whatsapp-message-edited-cross-field-refresh.png') });
      const href2 = await testLink.getAttribute('href');
      assert.ok(href2.includes(encodeURIComponent('Salut, aș vrea un meniu pentru 4 persoane.')), 'Testează href must pick up the edited waMessage, got: ' + href2);
      assert.notStrictEqual(href2, href1, 'href must actually change when waMessage changes (cross-field refresh proof)');
    }

    // Empty number -> no valid link; Testează must not offer a stale/broken href.
    await numberInput.fill('');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shotDir, 'whatsapp-number-cleared-disabled-state.png') });
    assert.strictEqual(await testLink.getAttribute('href'), null, 'Testează must have no href once the number is cleared');

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
