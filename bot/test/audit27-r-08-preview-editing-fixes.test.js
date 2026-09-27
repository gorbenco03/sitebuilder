'use strict';
/**
 * bot/test/audit27-r-08-preview-editing-fixes.test.js — PLAN-AUDIT-2026-09-27,
 * task R-08 (Val 1, Rundă 1).
 *
 * Two independent builder/edit-overlay.js defects, both confirmed on HEAD
 * (SHA b45a3e4) by the 2026-09-27 audit:
 *
 *   - preview-fidelity#2: Ctrl/Cmd+A inside an editable preview field did
 *     nothing — window.getSelection().toString() stayed empty before AND
 *     after the shortcut, so typing over a field the owner meant to replace
 *     instead spliced the new text into the middle of the old one ("Casa
 *     Nord" + Ctrl+A + "TESTBUSINESS" -> "Casa TESTBUSINESSNord"). Fixed by
 *     an explicit keydown handler that calls document.execCommand via a
 *     Range scoped to the field itself (edit-overlay.js, in setupTextFields).
 *
 *   - edge-errors#2: the maxLen truncation on input (edit-overlay.js
 *     ~line 984, `value.slice(0, maxLen)`) cuts by UTF-16 code unit. When a
 *     field's maxLen boundary lands inside a surrogate pair (typing 99
 *     characters then an emoji into a maxLen:100 field), the slice keeps a
 *     lone high surrogate. That round-trips through draft save and
 *     /api/publish untouched and renders on the LIVE site as a literal
 *     U+FFFD replacement character, visible to every visitor. Fixed by
 *     detecting a trailing high surrogate after the slice and dropping it
 *     too.
 *
 * RED (pre-fix, reproduced against HEAD b45a3e4 before this task's changes):
 *   - Ctrl+A/Cmd+A over "Casa Nord" then typing "TESTBUSINESS" left the field
 *     reading "Casa TESTBUSINESSNord" — the old text was never replaced.
 *   - Typing 99 "X" + one emoji into business.tagline (maxLen:100, see
 *     templates/product-menu/schema.json:24-30) then publishing produced a
 *     live page whose HTML contained the U+FFFD replacement character.
 *
 * GREEN (this task): Ctrl/Cmd+A selects the field's own text so typing
 * replaces it; the same emoji-straddle input never leaves a lone surrogate,
 * in the editor OR on the published /live/<slug>/ page.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path) and the real bot/server.js + builder app, driving the actual
 * editor and publish flow — this bug lives in edit-overlay.js, which only
 * runs inside the interactive builder's sandboxed iframe, not in a static
 * build.js render.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-08-preview-editing-fixes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const EDIT_OVERLAY_SOURCE = fs.readFileSync(path.join(ROOT, 'builder/edit-overlay.js'), 'utf8');

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
  throw new Error('playwright not found in any candidate location');
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

/** First on-canvas occurrence of `dataHbEditPath` that actually has layout
 * (some templates render the same identity field more than once — header +
 * footer, say — and hidden copies have zero size). */
async function visibleFieldLocator(page, dataHbEditPath) {
  const iframeHandle = await page.$('#preview-iframe');
  const iframeCtx = await iframeHandle.contentFrame();
  const visibleIndex = await iframeCtx.evaluate((p) => {
    const els = Array.from(document.querySelectorAll(`[data-hb-edit="${p}"]`));
    return els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }, dataHbEditPath);
  assert.ok(visibleIndex >= 0, `no visible ${dataHbEditPath} occurrence found`);
  return page.frameLocator('#preview-iframe').locator(`[data-hb-edit="${dataHbEditPath}"]`).nth(visibleIndex);
}

async function screenshot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-r08-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

function extractFunction(source, name) {
  const start = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(source);
  if (!start) return '';
  let index = start.index + start[0].length;
  let depth = 1;
  while (index < source.length && depth > 0) {
    const char = source[index++];
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return source.slice(start.index, index);
}

let browser;
let server;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r08-'));
  process.env.SERVER_SECRET = 'audit27-r08-' + crypto.randomBytes(8).toString('hex');
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

test('preview-fidelity#2: isSelectAllShortcut() identifies exactly Ctrl+A / Cmd+A, nothing else', () => {
  const source = extractFunction(EDIT_OVERLAY_SOURCE, 'isSelectAllShortcut');
  assert.ok(source, 'isSelectAllShortcut must remain an extractable named function in edit-overlay.js');

  const sandbox = { console };
  vm.runInNewContext(`${source}\nthis.isSelectAllShortcut = isSelectAllShortcut;`, sandbox);

  const cases = [
    [{ key: 'a', ctrlKey: true }, true, 'Ctrl+A'],
    [{ key: 'A', ctrlKey: true }, true, 'Ctrl+Shift-cased A'],
    [{ key: 'a', metaKey: true }, true, 'Cmd+A'],
    [{ key: 'a', ctrlKey: false, metaKey: false }, false, 'plain "a"'],
    [{ key: 'a', ctrlKey: true, shiftKey: true }, false, 'Ctrl+Shift+A'],
    [{ key: 'a', ctrlKey: true, altKey: true }, false, 'Ctrl+Alt+A'],
    [{ key: 'z', ctrlKey: true }, false, 'Ctrl+Z (undo, must not be treated as select-all)'],
  ];
  for (const [event, expected, label] of cases) {
    assert.equal(sandbox.isSelectAllShortcut(event), expected, `isSelectAllShortcut(${label}) must be ${expected}`);
  }
});

test('preview-fidelity#2: the per-field keydown handler wires isSelectAllShortcut to a Range scoped to that field', () => {
  // Source-anchored guard, independent of any one browser build's own native
  // Select-All behavior inside an opaque-origin sandboxed iframe (this
  // repo's bundled headless Chromium already selects text on Ctrl+A without
  // any of this code — see the full end-to-end test below — so a purely
  // behavioral check alone would stay green even if this wiring were
  // deleted). Fails if the fix is reverted; passes with it in place.
  assert.match(
    EDIT_OVERLAY_SOURCE,
    /el\.addEventListener\('keydown', function \(e\) \{\s*if \(!isSelectAllShortcut\(e\)\) return;\s*e\.preventDefault\(\);\s*var range = document\.createRange\(\);\s*range\.selectNodeContents\(el\);\s*var sel = window\.getSelection\(\);\s*sel\.removeAllRanges\(\);\s*sel\.addRange\(range\);/,
    'setupTextFields() must call isSelectAllShortcut(e) on keydown and, when true, select the FIELD (el) via a Range — not fall through to whatever the browser does by default'
  );
});

test('edge-errors#2: the maxLen truncation drops a trailing lone high surrogate', () => {
  assert.match(
    EDIT_OVERLAY_SOURCE,
    /value = value\.slice\(0, maxLen\);[\s\S]{0,400}?charCodeAt\(value\.length - 1\)[\s\S]{0,200}?0xd800[\s\S]{0,200}?0xdbff[\s\S]{0,80}?value\.slice\(0, -1\)/,
    'the maxLen truncation on input must check for and drop a trailing lone high surrogate (0xD800-0xDBFF) after slicing, so an emoji straddling the limit never leaves a U+FFFD on the live site'
  );
});

test('preview-fidelity#2: Ctrl/Cmd+A selects an editable preview field, so typing replaces it', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'product-menu');
    const target = await visibleFieldLocator(page, 'business.name');

    const before = (await target.evaluate((el) => el.textContent)) || '';
    assert.ok(before.length > 0, 'business.name demo preset must start non-empty for this test to mean anything');

    await target.click();
    await screenshot(page, '01-clicked-business-name-field');

    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Meta+A').catch(() => {});
    await screenshot(page, '02-after-ctrl-cmd-a');

    await page.keyboard.insertText('TESTBUSINESS');
    await page.waitForTimeout(200);
    await screenshot(page, '03-after-typing-over-selection');

    const after = await target.evaluate((el) => el.textContent);
    assert.equal(
      after,
      'TESTBUSINESS',
      `Ctrl/Cmd+A must select the field's whole text so typing replaces it — got "${after}" (started as "${before}")`
    );
  } finally {
    await page.close();
  }
});

test('edge-errors#2: an emoji straddling maxLen never leaves a lone surrogate, in the editor or on the live site', async () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'product-menu', 'schema.json'), 'utf8'));
  const maxLen = (schema.sections || []).flatMap((s) => s.fields || []).find((f) => f.key === 'business.tagline').maxLen;
  assert.equal(maxLen, 100, 'sanity: schema.json must still declare business.tagline maxLen:100');

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'product-menu');
    const target = await visibleFieldLocator(page, 'business.tagline');

    await target.click();
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.press('Delete');

    // 99 plain characters + one astral emoji (2 UTF-16 code units) = 101
    // code units, one past maxLen:100 — the exact straddle from the finding.
    const straddling = 'X'.repeat(99) + '\u{1F600}';
    await page.keyboard.insertText(straddling);
    await page.waitForTimeout(300);
    await screenshot(page, '04-tagline-after-emoji-straddle-maxlen');

    const fieldText = await target.evaluate((el) => el.textContent);
    const lastCode = fieldText.charCodeAt(fieldText.length - 1);
    assert.ok(
      !(lastCode >= 0xd800 && lastCode <= 0xdbff),
      `field text ends with a lone high surrogate (charCode ${lastCode}) — the emoji-straddle truncation bug is back`
    );
    assert.ok(!fieldText.includes('�'), 'field text must never contain U+FFFD');

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'audit27-r08-emoji-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('audit27-r08-emoji@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
    await screenshot(page, '05-published-emoji-straddle-site');

    let liveResp;
    let liveHtml = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      liveResp = await page.request.get(global.__BASE__ + '/live/' + slug + '/');
      if (liveResp.status() === 200) { liveHtml = await liveResp.text(); break; }
      await page.waitForTimeout(300);
    }
    assert.equal(liveResp.status(), 200, 'the published page must be reachable');
    assert.ok(
      !liveHtml.includes('�'),
      'the published live HTML must never contain U+FFFD — a lone surrogate from the emoji-straddle truncation reached a real visitor'
    );
  } finally {
    await page.close();
  }
});
