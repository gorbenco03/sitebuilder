'use strict';
/**
 * bot/test/wave12-checklist-missing-fields.test.js
 *
 * Wave 12, item 1 of HANDOFF-firstrun.md — "the checklist shows a count but
 * not WHICH field is missing."
 *
 * #checklist-indicator (builder/index.html) reads e.g. "10/15" and, before
 * this wave, its click handler went straight to the quick-start form
 * (name/phone/town) — the owner learned THAT something was unfinished, never
 * WHAT. builder/app.js already computed the exact answer for every required
 * field via isFieldGenuinelyMade() (see updateChecklist()); this wave spends
 * that same computation on a menu (buildChecklistMenu(), section "7-menu" in
 * app.js) naming each missing field with its own schema.json label and
 * landing the owner on it in one click — the details drawer (scrolled to
 * that field's row and focused) for a drawer field, the canvas itself
 * (scrolled, highlighted, and focused when it's a real text field) for
 * everything else.
 *
 * RED: the pre-fix build (BEFORE_REF, this wave's own branch point) has no
 * #checklist-menu at all — the pill's only behaviour is "open quick-start".
 *
 * GREEN: the current tree's menu names the actual missing fields verbatim
 * from schema.json, a click on a canvas field focuses it on the real canvas,
 * a click on a drawer field opens Details scrolled+focused to that exact
 * row, the menu opens/closes with the keyboard, it fits on-screen at 390px,
 * and building it never happens outside the menu's own open path (proof for
 * "must not fire on every keystroke" — see buildChecklistMenu()'s doc
 * comment on why: a postMessage into the preview iframe from a per-keystroke
 * path already caused a real regression once in this project, per
 * HANDOFF-firstrun.md).
 *
 * Run: node --experimental-sqlite --test bot/test/wave12-checklist-missing-fields.test.js
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

const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || '235f2b3';
const TEMPLATE_ID = 'local-service';

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave12-firstrun', 'checklist-missing-fields');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function readGitFile(ref, relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function buildOldBuilderDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave12-old-checklist-'));
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
  await page.locator('#details-drawer').waitFor({ state: 'hidden' }).catch(() => {});
}

function schemaLabel(templateId, key) {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'schema.json'), 'utf8'));
  for (const section of schema.sections || []) {
    for (const field of section.fields || []) {
      if (field.key === key) return field.label;
    }
  }
  throw new Error('field not found in schema: ' + key);
}

test('RED (' + BEFORE_REF + '): the checklist pill has no missing-field list, only "open quick-start"', async () => {
  const oldDir = buildOldBuilderDir();
  const oldServer = await serveDir(oldDir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(20000);
    await startTemplate(page, oldServer.base + '/app/index.html', TEMPLATE_ID);

    const countText = await page.locator('#checklist-text').innerText();
    assert.ok(/\d+\s*\/\s*\d+/.test(countText), 'sanity: pill shows a N/N count, got "' + countText + '"');

    await page.locator('#checklist-indicator').click();
    const menuCount = await page.locator('#checklist-menu').count();
    assert.strictEqual(menuCount, 0, 'pre-fix build must have no #checklist-menu element at all');
    // Old behaviour: the click goes straight to quick-start, naming nothing.
    await page.locator('#demo-content-banner').waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'red-desktop-1440x900-pill-click.png') });
    await page.close();
  } finally {
    await browser.close();
    await oldServer.close();
  }
});

test('GREEN: the menu names the missing fields (schema labels) and lands you on each one', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave12-checklist-'));
  process.env.SERVER_SECRET = 'wave12-checklist-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_FAKE_DEPLOY = '1';
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'build-builder.js'))];
  require(path.join(ROOT, 'scripts', 'build-builder.js'));
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(20000);
    await startTemplate(page, base + '/app/', TEMPLATE_ID);

    const nameLabel = schemaLabel(TEMPLATE_ID, 'business.name'); // canvas field
    const bgLabel = schemaLabel(TEMPLATE_ID, 'hero.background');  // drawer field (background type)

    // Honest count first (Wave 11's own fix — unchanged, sanity-checked here).
    const countText = await page.locator('#checklist-text').innerText();
    const m = /(\d+)\s*\/\s*(\d+)/.exec(countText);
    assert.ok(m && Number(m[1]) < Number(m[2]), 'fresh draft must read as not fully done, got ' + countText);

    // Open the menu — it must name real fields, verbatim from schema.json.
    await page.locator('#checklist-indicator').click();
    await page.locator('#checklist-menu').waitFor({ state: 'visible' });
    const menuText = await page.locator('#checklist-menu').innerText();
    assert.ok(menuText.includes(nameLabel), 'menu must name the missing business.name field using its schema.json label — got: ' + menuText);
    assert.ok(menuText.includes(bgLabel), 'menu must name the missing hero.background field using its schema.json label — got: ' + menuText);
    await page.waitForTimeout(200); // let .account-menu's fadeIn finish before the evidence screenshot
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-desktop-1440x900-menu-open.png') });

    // Click the canvas-field item — business.name is edited inline on the
    // page, not in the drawer. Must close menu+drawer and focus that exact
    // canvas element.
    await page.getByRole('menuitem', { name: nameLabel }).click();
    await page.locator('#checklist-menu').waitFor({ state: 'hidden' });
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await assert.doesNotReject(
      nameField.evaluate((el) => { if (document.activeElement !== el) throw new Error('not focused: ' + (document.activeElement && document.activeElement.tagName)); }),
      'clicking the business.name item must focus that exact field on the canvas'
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-desktop-1440x900-canvas-field-focused.png') });

    // Reopen, click the drawer-field item — hero.background lives in
    // Details. Must open the drawer, scrolled to and focused on that row.
    await page.locator('#checklist-indicator').click();
    await page.locator('#checklist-menu').waitFor({ state: 'visible' });
    await page.getByRole('menuitem', { name: bgLabel }).click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const bgWrap = page.locator('[data-field-key="hero.background"]');
    await bgWrap.waitFor({ state: 'visible' });
    const bgFocused = await bgWrap.evaluate((el) => el.contains(document.activeElement));
    assert.ok(bgFocused, 'clicking the hero.background item must land keyboard focus inside its own drawer field row');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-desktop-1440x900-drawer-field-focused.png') });
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    // Keyboard-operable: focus the pill directly, Enter opens the menu with
    // focus landing inside it, Escape closes it.
    await page.locator('#checklist-indicator').focus();
    await page.keyboard.press('Enter');
    await page.locator('#checklist-menu').waitFor({ state: 'visible' });
    const focusInsideMenu = await page.evaluate(() => !!(document.activeElement && document.activeElement.closest('#checklist-menu')));
    assert.ok(focusInsideMenu, 'opening the menu via the keyboard must move focus into it');
    await page.keyboard.press('Escape');
    await page.locator('#checklist-menu').waitFor({ state: 'hidden' });

    // Must NOT fire on every keystroke: the count already updates through
    // updateChecklist()'s existing per-keystroke path (unchanged); the menu
    // itself must only ever be (re)built from its own open path.
    await page.evaluate(() => {
      window.__hbMenuBuilds = 0;
      const orig = window.buildChecklistMenu;
      window.buildChecklistMenu = function () {
        window.__hbMenuBuilds += 1;
        return orig.apply(this, arguments);
      };
    });
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const textField = page.locator('#details-drawer input[type="text"]').first();
    await textField.click();
    await textField.type('mai lipsesc', { delay: 20 });
    const builds = await page.evaluate(() => window.__hbMenuBuilds);
    assert.strictEqual(builds, 0, 'typing in a drawer field must never rebuild the checklist menu — got ' + builds + ' build(s)');
    await page.locator('#btn-close-drawer').click();

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-summary.txt'),
      'count=' + countText + '\nnameLabel=' + nameLabel + '\nbgLabel=' + bgLabel + '\nmenuBuildsOnKeystroke=' + builds + '\n');
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GREEN: the missing-fields menu fits on-screen and is usable at 390px', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave12-checklist-mobile-'));
  process.env.SERVER_SECRET = 'wave12-checklist-mobile-' + crypto.randomBytes(8).toString('hex');
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
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await startTemplate(page, base + '/app/', TEMPLATE_ID);

    const nameLabel = schemaLabel(TEMPLATE_ID, 'business.name');

    await page.locator('#checklist-indicator').scrollIntoViewIfNeeded();
    await page.locator('#checklist-indicator').tap();
    await page.locator('#checklist-menu').waitFor({ state: 'visible' });
    const box = await page.locator('#checklist-menu').boundingBox();
    assert.ok(box, 'menu must have a bounding box');
    assert.ok(box.x >= 0, 'menu left edge on-screen at 390px, got x=' + box.x);
    assert.ok(box.x + box.width <= 390 + 1, 'menu right edge on-screen at 390px, got right=' + (box.x + box.width));
    await page.waitForTimeout(200); // let .account-menu's fadeIn finish before the evidence screenshot
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-mobile-390x844-menu-open.png') });

    await page.getByRole('menuitem', { name: nameLabel }).tap();
    await page.locator('#checklist-menu').waitFor({ state: 'hidden' });
    const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await assert.doesNotReject(
      nameField.evaluate((el) => { if (document.activeElement !== el) throw new Error('not focused'); }),
      'tapping the business.name item at 390px must focus that exact field on the canvas'
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-mobile-390x844-canvas-field-focused.png') });

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
