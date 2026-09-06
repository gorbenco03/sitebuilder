'use strict';
/**
 * bot/test/wave11-firstrun-checklist-honesty.test.js
 *
 * Wave 11 — "make the checklist tell the truth."
 *
 * A brand-new draft is seeded from the template's own demo preset — a
 * plausible business name, phone, address, testimonials and photos that read
 * as a finished, real site (see builder/app.js's IDENTITY_FIELD_KEYS doc
 * comment). Before this wave, the checklist pill (updateChecklist() ->
 * isFieldComplete()) only asked "is this field non-empty?" — so a draft
 * nobody had touched yet showed as fully done (N/N), the exact failure
 * described in the task brief: nothing tells the owner they haven't started.
 *
 * Fix: isFieldGenuinelyMade() (builder/app.js) additionally requires an
 * identity field (name/tagline/title/meta description/about/phone
 * display/addresses) to differ from that same preset's own value, and a
 * photo field to be a genuine owner upload (a data: URI, never a bare
 * template asset path) — see the function's doc comment for the full
 * rationale, including why button-label/color/language fields are
 * deliberately EXEMPT (their demo default is a perfectly fine finished value
 * for a real owner too).
 *
 * Publishing itself is NOT gated by this honesty check — isFieldComplete()
 * (the plain non-empty check) still gates openPublishModal(), unchanged, so
 * an owner who wants to publish with the demo content untouched still can.
 * This file's last GREEN check guards specifically against reintroducing
 * that regression (it broke bot/test/fullpass-63230d2.mjs during this wave's
 * own development — see the wave report).
 *
 * RED: the pre-fix build (BEFORE_REF, the commit this wave started from)
 * shows a freshly-started, completely untouched draft as fully done.
 *
 * GREEN: the current working tree shows it as NOT fully done, the count
 * rises as identity fields are genuinely edited, and publish is still
 * reachable without editing anything.
 *
 * Run: node --experimental-sqlite --test bot/test/wave11-firstrun-checklist-honesty.test.js
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

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave11-firstrun', 'checklist-honesty');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function readGitFile(ref, relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Same technique as wave9-photos-manager.test.js: same (unchanged) generated
 * template bundles, but the OLD app.js/index.html — served under /app/* so
 * index.html's absolute /app/* references resolve, matching production. */
function buildOldBuilderDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-old-builder-'));
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

function parseChecklist(text) {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(text || '');
  if (!m) return null;
  return { done: Number(m[1]), total: Number(m[2]) };
}

test('RED (' + BEFORE_REF + '): a fresh, untouched draft reads as fully done', async () => {
  const oldDir = buildOldBuilderDir();
  const oldServer = await serveDir(oldDir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await startTemplate(page, oldServer.base + '/app/index.html', 'desserdirina');
    const text = await page.locator('#checklist-text').innerText();
    const parsed = parseChecklist(text);
    assert.ok(parsed, 'checklist pill must show a N/N count — got "' + text + '"');
    assert.strictEqual(
      parsed.done, parsed.total,
      'pre-fix bug: a completely untouched draft must read as fully done (' + text + ') — that is exactly what this wave fixes'
    );
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'red-fully-done.txt'), text);
    await page.close();
  } finally {
    await browser.close();
    await oldServer.close();
  }
});

test('GREEN: a fresh, untouched draft reads as NOT fully done, and rises as identity fields are genuinely edited', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-checklist-'));
  process.env.SERVER_SECRET = 'wave11-checklist-' + crypto.randomBytes(8).toString('hex');
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

    const before = parseChecklist(await page.locator('#checklist-text').innerText());
    assert.ok(before, 'checklist pill must show a N/N count');
    assert.ok(
      before.done < before.total,
      'a fresh, untouched draft must NOT read as fully done — got ' + before.done + '/' + before.total
    );
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-not-fully-done.txt'), before.done + '/' + before.total);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'green-fresh-draft.png') });

    // Genuinely edit business.name on the canvas (not the drawer) — the
    // count must rise by at least one, and never regress past the total.
    const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameField.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Cofetăria Mariei');
    await nameField.evaluate((el) => el.blur());
    await page.waitForTimeout(500);

    const after = parseChecklist(await page.locator('#checklist-text').innerText());
    assert.ok(after, 'checklist pill must still show a N/N count after editing');
    assert.strictEqual(after.total, before.total, 'the total required-field count must not change from an edit');
    assert.ok(
      after.done > before.done,
      'editing business.name away from the demo value must increase the done count — before=' + before.done + ' after=' + after.done
    );

    // Regression guard: publishing an UNTOUCHED draft must still be allowed —
    // isFieldComplete() (the plain non-empty gate) is unchanged; only the
    // checklist DISPLAY got honest. Verified on a second, fresh, genuinely
    // untouched template so the business.name edit above cannot help it pass.
    await startTemplate(page, base + '/app/', 'local-service');
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 8000 });
    const toastVisible = await page.locator('#toast').isVisible().catch(() => false);
    const blockingToast = toastVisible ? await page.locator('#toast').innerText().catch(() => '') : '';
    assert.ok(
      !/Completează mai întâi/i.test(blockingToast),
      'publishing a fully-untouched demo draft must not be blocked by the checklist honesty fix — toast: ' + blockingToast
    );
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-publish-still-allowed.txt'), 'modal-publish visible, no blocking toast');

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
