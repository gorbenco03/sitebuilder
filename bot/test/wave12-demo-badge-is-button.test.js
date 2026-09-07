'use strict';
/**
 * bot/test/wave12-demo-badge-is-button.test.js
 *
 * Wave 12, item 2 of HANDOFF-firstrun.md — "the 'demo' badge and the
 * 'replace photo' button sit in different corners of the same image."
 *
 * Before this wave, a background hero photo that was still the template's
 * own asset (not a genuine owner upload — see isDemoSrcValue() in
 * builder/edit-overlay.js) got TWO independent, differently-positioned
 * markers: a "demo" corner tag (.hb-demo-photo::after, top-left) and the
 * always-visible "Înlocuiește fotografia" fix button (.hb-bg-btn, top-right)
 * — two signals for one fact, planted in opposite corners of the same
 * photo instead of reinforcing each other.
 *
 * Fix (builder/edit-overlay.js only): a background photo's flag now folds
 * directly into the fix — the same always-visible button gets a distinct
 * "hb-demo-bg" host class, an amber restyle (matching .hb-demo-text's own
 * provisional-content colour), and its label gains a "Poză demo — " prefix,
 * while its click handler is untouched (same gesture does both jobs — see
 * applyPendingDemoBadges()'s doc comment). A plain <img> photo (e.g. a
 * gallery photo or logo), whose replace button only shows on hover, keeps
 * the old persistent corner tag — dropping it there would make the flag
 * invisible without a hover, defeating Wave 11's own "glance at the canvas"
 * point.
 *
 * RED: a static source-and-CSS check against BEFORE_REF (this wave's own
 * branch point) proving the pre-fix badge and button really did occupy
 * different corners (top-left vs top-right) with a single, unbranched
 * addDemoBadge(host) — not a rebuilt-and-served old editor: builder/generated
 * is a gitignored build artifact regenerated from the CURRENT working tree's
 * edit-overlay.js regardless of which files a copied "old builder dir" uses
 * (same reasoning as bot/test/wave11-firstrun-provisional-demo.test.js's own
 * RED test — see its doc comment).
 *
 * GREEN: driving the real editor, a demo hero background carries exactly one
 * marker (never both classes at once), its always-visible replace button is
 * visibly flagged ("Poză demo —" prefix) without moving to a second corner,
 * and clicking that one button still fires the exact same photo-change
 * request it always did.
 *
 * Run: node --experimental-sqlite --test bot/test/wave12-demo-badge-is-button.test.js
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

const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || '235f2b3';
const TEMPLATE_ID = 'local-service'; // hero.background is required:true here — always a demo photo on a fresh draft

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave12-firstrun', 'demo-badge-is-button');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function readGitFile(ref, relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
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

test('RED (' + BEFORE_REF + '): the demo badge and the replace-photo button sit in different, unrelated corners', () => {
  const oldOverlaySrc = readGitFile(BEFORE_REF, 'builder/edit-overlay.js');

  // Pre-fix: a single, unbranched addDemoBadge(host) — no per-shape handling.
  assert.ok(/function addDemoBadge\(host\)\s*\{/.test(oldOverlaySrc),
    'pre-fix addDemoBadge() must take a single "host" argument — no bg/img distinction existed yet');
  assert.ok(!oldOverlaySrc.includes('hb-demo-bg'),
    'pre-fix overlay source must not know about a merged "hb-demo-bg" treatment at all');

  // The badge sits top-LEFT...
  const badgeRule = (oldOverlaySrc.match(/\.hb-demo-photo::after\s*\{([^}]*)\}/) || [])[1] || '';
  assert.ok(badgeRule, 'pre-fix .hb-demo-photo::after rule must exist');
  assert.ok(/top:\s*6px/.test(badgeRule) && /left:\s*6px/.test(badgeRule),
    'pre-fix demo badge must sit top-left — got: ' + badgeRule);

  // ...while the background photo's replace button sits top-RIGHT, and is
  // always visible (no opacity:0 default — unlike the <img> button, which
  // is centered and hover-only).
  const bgBtnRule = (oldOverlaySrc.match(/\.hb-bg-btn\s*\{([^}]*)\}/) || [])[1] || '';
  assert.ok(bgBtnRule, 'pre-fix .hb-bg-btn rule must exist');
  assert.ok(/top:\s*12px/.test(bgBtnRule) && /right:\s*12px/.test(bgBtnRule),
    'pre-fix replace-photo button must sit top-right — a different corner than the badge — got: ' + bgBtnRule);
  assert.ok(!/opacity:\s*0/.test(bgBtnRule),
    'pre-fix replace-photo button on a background photo must already be always-visible (not hover-only)');

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'red-css-rules.txt'),
    'badge (.hb-demo-photo::after):\n' + badgeRule + '\n\nbutton (.hb-bg-btn):\n' + bgBtnRule + '\n');
});

test('GREEN: one marker, one control — the always-visible replace button carries the demo flag itself', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave12-demo-badge-'));
  process.env.SERVER_SECRET = 'wave12-demo-badge-' + crypto.randomBytes(8).toString('hex');
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
    const frame = page.frameLocator('#preview-iframe');

    // Exactly one merged-marker host exists (the hero background), and it
    // never ALSO carries the separate corner-tag class — one signal, not two.
    const mergedHost = frame.locator('.hb-demo-bg').first();
    await mergedHost.waitFor({ state: 'attached' });
    const bothClasses = await frame.locator('.hb-demo-bg.hb-demo-photo').count();
    assert.strictEqual(bothClasses, 0, 'a background host must never carry both the merged class and the old separate corner-tag class at once');

    // The flag now lives ON the always-visible replace button itself —
    // same element, same corner, same click as before.
    const bgBtn = mergedHost.locator(':scope > .hb-bg-btn').first();
    await bgBtn.waitFor({ state: 'visible' }); // always visible for backgrounds — no hover needed
    const btnText = await bgBtn.innerText();
    assert.ok(/demo/i.test(btnText), 'the replace button on a demo background must itself say "demo" — got: ' + btnText);
    assert.ok(btnText.includes('Înlocuiește fotografia'), 'the replace button must still carry its original Romanian action text — got: ' + btnText);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-desktop-1440x900-merged-badge-button.png') });

    // Same gesture still does the job: clicking it must still fire the
    // exact same {hb:'image', path:'hero.background', ...} request to the
    // parent that the plain, non-demo button always did.
    await page.evaluate(() => {
      window.__hbLastImageMsg = null;
      window.addEventListener('message', (e) => {
        if (e.data && e.data.hb === 'image') window.__hbLastImageMsg = e.data;
      });
    });
    await bgBtn.click();
    await page.waitForTimeout(200);
    const msg = await page.evaluate(() => window.__hbLastImageMsg);
    assert.ok(msg, 'clicking the merged demo badge/button must still post an {hb:"image"} request to the parent');
    assert.strictEqual(msg.path, 'hero.background', 'the request must still target hero.background, unchanged');

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-summary.txt'),
      'buttonText=' + btnText + '\nclickMessage=' + JSON.stringify(msg) + '\n');
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GREEN: the merged badge/button is visible and correctly flagged at 390px too', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave12-demo-badge-mobile-'));
  process.env.SERVER_SECRET = 'wave12-demo-badge-mobile-' + crypto.randomBytes(8).toString('hex');
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
    const frame = page.frameLocator('#preview-iframe');

    const bgBtn = frame.locator('.hb-demo-bg > .hb-bg-btn').first();
    await bgBtn.waitFor({ state: 'visible' });
    const btnText = await bgBtn.innerText();
    assert.ok(/demo/i.test(btnText) && btnText.includes('Înlocuiește fotografia'), 'flag + action text present at 390px — got: ' + btnText);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-mobile-390x844-merged-badge-button.png') });

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
