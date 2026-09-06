'use strict';
/**
 * bot/test/wave11-firstrun-quickstart.test.js
 *
 * Wave 11 — "build a first-run that makes the site theirs in under a
 * minute": three fields (name, phone, town) on the same bar that already
 * told the owner "this is demo content" (builder/index.html's
 * #quickstart-form, wired in builder/app.js's openQuickstart/closeQuickstart/
 * applyQuickstart), propagated to every place that content actually
 * appears — including places nobody would think to check by hand: the
 * business identity cascade (business.title/about/tagline/metaDescription,
 * reusing the existing cascadeBusinessNameIdentity()), the new town cascade
 * (cascadeTownIdentity()) into the same fields plus both addresses and
 * seo.jsonLd's structured data, and the phone into
 * contact.phone/whatsapp/phoneDisplay/waHref (the WhatsApp message link).
 *
 * Skippable ("Nu acum" — same persisted dismissal the old plain-text banner
 * had) and repeatable (the checklist pill in the topbar reopens it any time,
 * not gated on the draft being "fresh").
 *
 * RED: the pre-fix build (BEFORE_REF) has no such form at all — this is new
 * functionality this wave adds, not a bug fix to an existing one.
 *
 * GREEN: the current tree collects the three fields, stamps them everywhere
 * listed above, can be skipped without side effects, and can be reopened and
 * used again afterward.
 *
 * Run: node --experimental-sqlite --test bot/test/wave11-firstrun-quickstart.test.js
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

const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || 'bab4709';

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave11-firstrun', 'quickstart');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function readGitFile(ref, relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function buildOldBuilderDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-old-quickstart-'));
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'builder'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), readGitFile(BEFORE_REF, 'builder/app.js'));
  fs.writeFileSync(path.join(dir, 'index.html'), readGitFile(BEFORE_REF, 'builder/index.html'));
  return root;
}

async function startTemplate(page, entryUrl, templateId) {
  await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('#btn-close-drawer').click().catch(() => {});
}

test('RED (' + BEFORE_REF + '): no quick-start form exists at all', async () => {
  const oldDir = buildOldBuilderDir();
  const oldServer = await serveDir(oldDir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await startTemplate(page, oldServer.base + '/app/index.html', 'desserdirina');
    const count = await page.locator('#quickstart-form').count();
    assert.strictEqual(count, 0, 'pre-fix build must not have a quick-start form — this is new Wave 11 functionality');
    await page.close();
  } finally {
    await browser.close();
    await oldServer.close();
  }
});

test('GREEN: name/phone/town propagate everywhere, quick-start is skippable and repeatable', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-quickstart-'));
  process.env.SERVER_SECRET = 'wave11-quickstart-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_FAKE_DEPLOY = '1';
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

  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await startTemplate(page, base + '/app/', 'desserdirina');

    // Auto-shown on a fresh draft.
    await page.locator('#demo-content-banner').waitFor({ state: 'visible' });
    await page.locator('#quickstart-form').waitFor({ state: 'visible' });

    const beforeConfig = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config)));
    assert.ok(/București/.test(beforeConfig.business.title), 'sanity: fresh draft must still carry the demo town');

    await page.locator('#quickstart-name').fill('Cofetăria Mariei');
    await page.locator('#quickstart-phone').fill('0722111222');
    await page.locator('#quickstart-town').fill('Cluj-Napoca');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-form-filled.png') });
    await page.locator('#btn-quickstart-apply').click();
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config)));

    assert.strictEqual(after.business.name, 'Cofetăria Mariei', 'business.name must be set verbatim');
    assert.ok(after.business.title.includes('Cofetăria Mariei'), 'business.title must pick up the new name');
    assert.ok(after.business.title.includes('Cluj-Napoca'), 'business.title must pick up the new town');
    assert.ok(!after.business.title.includes('București'), 'business.title must no longer carry the demo town');
    assert.ok(after.business.metaDescription.includes('Cluj-Napoca'), 'meta description (Google\'s snippet) must pick up the new town');
    assert.ok(after.footer.address.includes('Cluj-Napoca'), 'footer address must pick up the new town');
    assert.ok(!after.footer.address.includes('București'), 'footer address must no longer carry the demo town');

    assert.strictEqual(after.contact.whatsapp, '40722111222', 'contact.whatsapp must be normalized digits (RO country code assumed for a bare local number)');
    assert.strictEqual(after.contact.phone, '+40722111222', 'contact.phone must be the E.164 form');
    assert.ok(after.contact.waHref.includes('wa.me/40722111222'), 'the WhatsApp message link (contact.waHref) must use the new number');

    if (after.seo && typeof after.seo.jsonLd === 'string' && after.seo.jsonLd) {
      assert.ok(after.seo.jsonLd.includes('Cofetăria Mariei'), 'structured data (seo.jsonLd) must pick up the new name');
      assert.ok(after.seo.jsonLd.includes('Cluj-Napoca'), 'structured data (seo.jsonLd) must pick up the new town');
      // Caught during the manual first-run walkthrough (see the wave report):
      // the initial cut only wrote contact.phone/whatsapp/phoneDisplay/waHref
      // and missed this exact "a place nobody thinks to check" — the demo
      // preset's OLD phone number was still sitting in the structured data
      // Google reads, right next to the (already-fixed) name and town.
      assert.ok(after.seo.jsonLd.includes('+40722111222'), 'structured data (seo.jsonLd) must pick up the new phone — regression check for the "telephone" field specifically');
      assert.ok(!after.seo.jsonLd.includes('+40721234567'), 'structured data (seo.jsonLd) must no longer carry the demo preset\'s own phone number');
    }

    // The canvas itself, not just draft.config — the footer text on the
    // rendered page must show the new town.
    const frame = page.frameLocator('#preview-iframe');
    const footerText = await frame.locator('footer').first().innerText().catch(() => '');
    assert.ok(footerText.includes('Cluj-Napoca'), 'the rendered footer on the canvas must show the new town — got: ' + footerText);

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-propagated-config.json'), JSON.stringify(after, null, 2));

    // Bar closes and clears after a successful apply.
    const bannerHiddenAfterApply = await page.locator('#demo-content-banner').isHidden().catch(() => false);
    assert.ok(bannerHiddenAfterApply, 'the bar must close itself after a successful Aplică');

    // ---- Skippable: a second, independent fresh draft, dismissed with no edits ----
    const page2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await startTemplate(page2, base + '/app/', 'local-service');
    await page2.locator('#demo-content-banner').waitFor({ state: 'visible' });
    const beforeSkip = await page2.evaluate(() => draft.config.business.name);
    await page2.locator('#btn-dismiss-demo-banner').click();
    await page2.locator('#demo-content-banner').waitFor({ state: 'hidden' });
    const afterSkip = await page2.evaluate(() => draft.config.business.name);
    assert.strictEqual(afterSkip, beforeSkip, 'dismissing ("Nu acum") must not touch draft.config at all');

    // ---- Repeatable: reopen via the checklist pill, apply again ----
    await page2.locator('#checklist-indicator').click();
    await page2.locator('#demo-content-banner').waitFor({ state: 'visible' });
    await page2.locator('#quickstart-town').fill('Iași');
    await page2.locator('#btn-quickstart-apply').click();
    await page2.waitForTimeout(500);
    const reapplied = await page2.evaluate(() => draft.config.footer.address);
    assert.ok(reapplied.includes('Iași'), 'reopening via the checklist pill and applying again must still work — footer.address: ' + reapplied);
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-repeatable-reopen.txt'), 'ok: ' + reapplied);

    await page2.close();
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
