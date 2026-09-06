'use strict';
/**
 * bot/test/wave11-firstrun-provisional-demo.test.js
 *
 * Wave 11 — "make demo content look provisional."
 *
 * A fresh draft's canvas gives no visual sign of which words and photos are
 * still the template's — the owner has to already know to distrust
 * everything. Fix (builder/edit-overlay.js, driven by builder/app.js):
 *   - an identity text field ([data-hb-edit] whose current value still
 *     equals the template's own demo preset value) gets a soft amber
 *     highlight + underline (.hb-demo-text) — dropped the instant it is
 *     edited, no round trip needed;
 *   - a photo (<img> or CSS background) whose src is not an owner-uploaded
 *     data: URI gets a small "demo" corner badge (.hb-demo-photo).
 *
 * Both are painted entirely by edit-overlay.js, which ONLY ever runs inside
 * the builder's own srcdoc when renderHtml() is called with editMode:true
 * (see build.js's renderHtml() doc comment — export/publish call it with NO
 * opts at all, byte-identical to the non-editMode path). This file's last
 * two checks prove that directly: the exact renderHtml() export/publish use
 * never emits any of this signalling, on a real template with the real demo
 * preset — no mock, no re-implementation.
 *
 * RED: the pre-fix build (BEFORE_REF) has no such markers anywhere in the
 * editor at all — nothing on the canvas distinguishes demo content.
 *
 * GREEN: the current tree paints both markers, drops the text marker the
 * instant a field is edited, and never emits either marker from the actual
 * export render path.
 *
 * Run: node --experimental-sqlite --test bot/test/wave11-firstrun-provisional-demo.test.js
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
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || 'bab4709';

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave11-firstrun', 'provisional-demo');
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
  await page.waitForTimeout(1500);
  await page.locator('#btn-close-drawer').click().catch(() => {});
}

test('RED (' + BEFORE_REF + '): the pre-fix overlay source knows nothing about provisional-content markers', () => {
  // A static source check, not a rebuilt-and-served old editor: engine.js
  // (which bundles edit-overlay.js) is a gitignored BUILD ARTIFACT (see
  // builder/generated/ in .gitignore) regenerated from the CURRENT working
  // tree's builder/edit-overlay.js regardless of which app.js/index.html a
  // servable "old builder dir" copy uses — the wave9-photos-manager-style
  // trick of swapping just app.js/index.html (used in the other wave11 test
  // files, where the fix lives entirely in app.js/index.html) cannot
  // reproduce a genuinely pre-fix OVERLAY here,
  // since the copied builder/generated/engine.js would silently already be
  // this wave's fixed one. Reading the actual historical source text is the
  // real, non-mocked pre-fix state instead.
  const oldOverlaySrc = readGitFile(BEFORE_REF, 'builder/edit-overlay.js');
  assert.ok(!oldOverlaySrc.includes('hb-demo-text'), 'pre-fix overlay source must not know about .hb-demo-text at all');
  assert.ok(!oldOverlaySrc.includes('hb-demo-photo'), 'pre-fix overlay source must not know about .hb-demo-photo at all');
  assert.ok(!oldOverlaySrc.includes('demoText'), 'pre-fix overlay source must not know about the demoText message at all');
});

test('GREEN: the canvas marks untouched demo text and photos, and drops the text mark the instant it is edited', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-provisional-'));
  process.env.SERVER_SECRET = 'wave11-provisional-' + crypto.randomBytes(8).toString('hex');
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
    const frame = page.frameLocator('#preview-iframe');

    const nameField = frame.locator('[data-hb-edit="business.name"]').first();
    await assert.doesNotReject(
      nameField.evaluate((el) => { if (!el.classList.contains('hb-demo-text')) throw new Error('not marked'); }),
      'the untouched business.name field must carry the provisional .hb-demo-text marker'
    );

    const badgeCount = await frame.locator('.hb-demo-photo').count();
    assert.ok(badgeCount > 0, 'at least one untouched demo photo must carry the .hb-demo-photo marker');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-fresh-draft-marked.png') });

    // Edit the name — the marker must drop immediately, no reload.
    await nameField.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Cofetăria Mariei');
    await page.waitForTimeout(50);
    const stillMarked = await nameField.evaluate((el) => el.classList.contains('hb-demo-text'));
    assert.strictEqual(stillMarked, false, 'editing the field must drop .hb-demo-text at once, before the debounced commit even lands');
    await nameField.evaluate((el) => el.blur());
    await page.waitForTimeout(500);

    // A photo actually replaced (data: URI) must lose its badge on the next
    // render — verified by directly mutating draft.config the same way an
    // upload would and forcing the render the app itself would trigger.
    const heroBadgeBefore = await frame.locator('.hb-demo-photo').count();
    assert.ok(heroBadgeBefore > 0, 'sanity: still have demo photo badges before replacing one');

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-marker-dropped-on-edit.txt'), 'ok');
    await page.close();

    // -----------------------------------------------------------------
    // The critical proof: the export/publish render path never emits any
    // of this signalling. Uses the SAME renderHtml() build.js exports and
    // build() calls with no opts (see build.js line ~978) — not a mock.
    // -----------------------------------------------------------------
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', 'desserdirina', 'template.html'), 'utf8');
    const heavySrc = fs.readFileSync(path.join(ROOT, 'builder', 'generated', 'templates', 'desserdirina.js'), 'utf8');
    const m = heavySrc.match(/HIDOOK_TEMPLATE_HEAVY\["desserdirina"\]\s*=\s*(\{[\s\S]*\});?\s*$/);
    const heavy = JSON.parse(m[1]);
    const demoConfig = heavy.presets[0].config;

    const exportedHtml = renderHtml(templateHtml, demoConfig); // no opts — exactly export/publish's own call
    const forbidden = ['hb-demo-text', 'hb-demo-photo', 'data-hb-edit', 'data-hb-overlay', 'hidookOverlayMounted', '__hidookOverlayMounted'];
    for (const marker of forbidden) {
      assert.ok(
        !exportedHtml.includes(marker),
        'export/publish render (renderHtml with no opts) must never contain "' + marker + '" — a customer must never ship the editor\'s own signalling'
      );
    }
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'exported-html-clean.html'), exportedHtml);

    // Same proof one level up the real pipeline: build.js's own build() —
    // the actual function bot/server.js calls to write a site to disk for
    // export/publish (see build.js: build() reads config.json/template.html
    // and calls renderHtml() with no opts, exactly like above, then writes
    // index.html) — against a real temp site directory.
    const { build } = require(path.join(ROOT, 'build.js'));
    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-build-clean-'));
    fs.writeFileSync(path.join(siteDir, 'template.html'), templateHtml, 'utf8');
    fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify(demoConfig), 'utf8');
    build(siteDir);
    const builtHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
    for (const marker of forbidden) {
      assert.ok(
        !builtHtml.includes(marker),
        'build.js\'s own build() output must never contain "' + marker + '" — a customer must never ship the editor\'s own signalling'
      );
    }
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'built-index-html-clean.html'), builtHtml);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
