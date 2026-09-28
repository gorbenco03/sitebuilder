'use strict';
/**
 * bot/test/audit27-s-3-undo-redo-persist.test.js
 *
 * Task S-3, PLAN-UX-2026-09-27.md §5.3 "Undo/redo real dincolo de sesiunea
 * curentă" (04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json,
 * ux-benchmark lens: "Undo/redo persistent dincolo de sesiune — standard la
 * toți competitorii majori; Hidook îl are doar în sesiunea curentă").
 *
 * Before this fix, resetHistory() (builder/app.js) always started a
 * brand-new one-entry undo/redo baseline on every #edit load, including a
 * plain reload — a reload or an accidental tab close+reopen silently threw
 * away every undo step with no warning to the owner mid-edit.
 *
 * Fix: pushHistory()/undo()/redo() now also persist historyState into
 * sessionStorage (builder/history-store.js), keyed by the same per-draft
 * scope key drafts already use and stamped with the same ownerUserId
 * ownership contract as hb.draft.scopes.v1 (gap-cross-account-draft-leak-
 * depth / R-02). resetHistory() resumes that persisted stack instead of a
 * fresh baseline when the scope+account match and the top entry still
 * matches what was actually just loaded into draft.config.
 *
 * Two things this oracle proves, both against the REAL browser/server, no
 * reimplementation:
 *
 *   1. Edit 3 fields, reload, undo twice restores the earlier values — the
 *      actual task acceptance criterion.
 *   2. A DIFFERENT account signed in on the SAME tab, right after the first
 *      account's real "Deconectare", sees NO trace of that history — same
 *      threat model / same real-UI repro shape as
 *      audit27-r-02-cross-account-draft-isolation.test.js, applied to the
 *      new persisted history store instead of the draft store.
 *
 * Reviewer rejection (2026-09-27), fixed in this revision: resetHistory()'s
 * resume check compared the PERSISTED top entry (image-stripped by
 * historyStoreStripImages()) against the freshly-reloaded draft.config's raw
 * JSON (never stripped) — any session whose current state included a real
 * uploaded photo made that comparison fail on EVERY reload, silently
 * discarding the persisted stack. Two more things this revision proves:
 *
 *   3. A real photo upload (over the strip threshold) as one of the edited
 *      steps still resumes the persisted stack after a reload — not just
 *      text-only sessions (E2E, real browser, real file-picker upload).
 *   4. Unit-level: resetHistory()'s resume decision is symmetric about image
 *      stripping — proven directly against the shipped functions (no
 *      browser), so this invariant has a cheap regression guard that doesn't
 *      depend on a photo's exact re-encoded byte size in a real browser.
 *
 * Local only — HIDOOK_TEST_PAY offline stub, no real Stripe/DNS calls.
 * Run: node --experimental-sqlite --test bot/test/audit27-s-3-undo-redo-persist.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function freshTmpDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function withServer(envOverrides, fn) {
  const saved = {};
  const clearKeys = ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY'];
  for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
  for (const k of clearKeys) saved[k] = process.env[k];
  Object.assign(process.env, envOverrides);
  for (const k of clearKeys) delete process.env[k];

  for (const rel of ['../server.js', '../webpublish.js', '../domains.js', '../registry.js']) {
    delete require.cache[require.resolve(rel)];
  }
  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    await fn(base);
  } finally {
    server.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function acceptCookiesAndStart(page, base, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** Edit one canvas text field by its `data-hb-edit` path, wait for
 * draft.config to actually reflect it, then wait past the debounced
 * server-autosave/history-persist settle window (same 1600ms budget
 * audit27-r-02 uses for the same reason). */
async function editField(page, fieldPath, text) {
  const field = page.frameLocator('#preview-iframe').locator(`[data-hb-edit="${fieldPath}"]`).first();
  await field.click({ clickCount: 3 });
  await page.keyboard.type(text, { delay: 12 });
  await field.blur().catch(() => {});
  await page.waitForFunction(
    ({ p, expected }) => {
      if (typeof draft === 'undefined' || !draft.config) return false;
      let v = draft.config;
      for (const part of p.split('.')) { if (v == null) return false; v = v[part]; }
      return v === expected;
    },
    { p: fieldPath, expected: text },
    { timeout: 5000 }
  );
  await page.waitForTimeout(1600);
}

async function readField(page, fieldPath) {
  return page.evaluate((p) => {
    if (typeof draft === 'undefined' || !draft.config) return null;
    let v = draft.config;
    for (const part of p.split('.')) { if (v == null) return null; v = v[part]; }
    return v;
  }, fieldPath);
}

/** Real "Deconectare" via the editor topbar account menu — never a raw API call. */
async function signOutFromEditor(page) {
  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').click();
  await page.waitForURL(/#templates$/);
}

/** Sign in from the dashboard auth form — same real magic-link flow as
 * audit27-r-02, entered directly via /app/#dashboard so it also works for a
 * SECOND account reusing the SAME tab right after the first one signed out. */
async function signInFromDashboard(page, base, email) {
  await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator('#btn-dashboard-auth').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.waitForTimeout(600);
}

/** Generates a genuinely large (noisy, near-incompressible) JPEG in-page —
 * a real uploaded photo, not a fixture on disk — big enough after resize to
 * exceed history-store.js's HISTORY_IMAGE_STRIP_THRESHOLD (20000 base64
 * chars; an ordinary compressed photo clears this easily, a solid-color
 * swatch like suite11's does not, which is why this generates per-pixel
 * random noise instead). */
async function genNoisyPhotoBuffer(page, w, h) {
  const dataUrl = await page.evaluate(({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    const buf = imgData.data;
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = Math.floor(Math.random() * 256);
      buf[i + 1] = Math.floor(Math.random() * 256);
      buf[i + 2] = Math.floor(Math.random() * 256);
      buf[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return c.toDataURL('image/jpeg', 0.85);
  }, { w, h });
  return { dataUrl, buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

/** Uploads via the "Poze" gallery modal's Logo section — same real
 * file-picker path as suite2-transparent-png.test.js / suite11-team-
 * member-photo.test.js, not a direct draft.config write. */
async function uploadLogoPhoto(page, buffer) {
  await page.locator('#btn-open-gallery').click();
  const modal = page.locator('#modal-gallery');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  const logoSection = modal.locator('.gallery-path-section').filter({
    has: page.locator('.field-label', { hasText: 'Logo' }),
  });
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    logoSection.getByRole('button', { name: /Alege o poz|Înlocuiește/ }).click(),
  ]);
  await fileChooser.setFiles({ name: 'audit27-s3-photo.jpg', mimeType: 'image/jpeg', buffer });
  await page.waitForFunction(() => !!(typeof draft !== 'undefined' && draft.config && draft.config.logo && draft.config.logo.indexOf('data:image/') === 0), { timeout: 10000 });
  const closeBtn = modal.locator('#btn-close-gallery, .modal-close').first();
  if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Unit-level harness for the resume-vs-fresh-baseline invariant (reviewer
// requirement: "add a unit-level check ... since this is exactly the kind of
// invariant that's easy to silently break again later"). Extracts the real
// resetHistory()/historyTrim()/historySnapshotBytes() functions straight out
// of builder/app.js and runs them, together with the REAL builder/history-
// store.js, in a vm sandbox — no reimplementation of either file's logic.
// ---------------------------------------------------------------------------

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

function makeFakeSessionStorage() {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
}

/** Builds a sandboxed `resetHistory()` wired to the REAL history-store.js,
 * with everything resetHistory() only reaches through a `typeof x ===
 * 'function'` guard replaced by a harmless stub (updateHistoryButtons,
 * hideTabConflictBanner) or a controllable fake (currentScopeKey,
 * currentAccountKey, draft.config) — same isolated-extraction shape as
 * s52-image-replace-live.test.js's runExtractImages(). */
function buildHistorySandbox() {
  const appSrc = fs.readFileSync(path.join(ROOT, 'builder/app.js'), 'utf8');
  const historyStoreSrc = fs.readFileSync(path.join(ROOT, 'builder/history-store.js'), 'utf8');

  const resetHistorySrc = extractFunction(appSrc, 'resetHistory');
  const historyTrimSrc = extractFunction(appSrc, 'historyTrim');
  const historySnapshotBytesSrc = extractFunction(appSrc, 'historySnapshotBytes');
  // resetHistory()'s no-persisted-match fallback path calls pushHistory(null)
  // directly (not typeof-guarded, unlike most of its other cross-file calls)
  // — needed here too, which in turn calls persistHistorySnapshot().
  const pushHistorySrc = extractFunction(appSrc, 'pushHistory');
  const persistHistorySnapshotSrc = extractFunction(appSrc, 'persistHistorySnapshot');
  assert.ok(resetHistorySrc, 'resetHistory must exist in builder/app.js');
  assert.ok(historyTrimSrc, 'historyTrim must exist in builder/app.js');
  assert.ok(historySnapshotBytesSrc, 'historySnapshotBytes must exist in builder/app.js');
  assert.ok(pushHistorySrc, 'pushHistory must exist in builder/app.js');
  assert.ok(persistHistorySnapshotSrc, 'persistHistorySnapshot must exist in builder/app.js');

  const maxEntriesMatch = /const HISTORY_MAX_ENTRIES\s*=\s*(\d+);/.exec(appSrc);
  const maxBytesMatch = /const HISTORY_MAX_BYTES\s*=\s*([^;]+);/.exec(appSrc);
  const coalesceMsMatch = /const HISTORY_COALESCE_MS\s*=\s*(\d+);/.exec(appSrc);
  assert.ok(maxEntriesMatch, 'HISTORY_MAX_ENTRIES must exist in builder/app.js');
  assert.ok(maxBytesMatch, 'HISTORY_MAX_BYTES must exist in builder/app.js');
  assert.ok(coalesceMsMatch, 'HISTORY_COALESCE_MS must exist in builder/app.js');

  const scaffold = [
    'var HISTORY_MAX_ENTRIES = ' + maxEntriesMatch[1] + ';',
    'var HISTORY_MAX_BYTES = ' + maxBytesMatch[1] + ';',
    'var HISTORY_COALESCE_MS = ' + coalesceMsMatch[1] + ';',
    'var historyState = { stack: [], index: -1, coalesceKey: null, coalesceAt: 0 };',
    'var pendingHistoryCoalesceKey = null;',
    'var draft = { config: null };',
    'var __scopeKey = null;',
    'var __accountId = null;',
    'function updateHistoryButtons() {}',
    'function hideTabConflictBanner() {}',
    'function currentScopeKey() { return __scopeKey; }',
    'function currentAccountKey() { return __accountId; }',
    historyStoreSrc,
    historySnapshotBytesSrc,
    historyTrimSrc,
    persistHistorySnapshotSrc,
    pushHistorySrc,
    resetHistorySrc,
    'this.__api = {',
    '  resetHistory: resetHistory,',
    '  getHistoryState: function () { return historyState; },',
    '  setDraftConfig: function (c) { draft.config = c; },',
    '  setScope: function (s) { __scopeKey = s; },',
    '  setAccount: function (a) { __accountId = a; },',
    '  historyStoreSave: historyStoreSave,',
    '  historyStoreLoad: historyStoreLoad,',
    '  historyStoreStripImages: historyStoreStripImages,',
    '};',
  ].join('\n');

  const sandbox = { sessionStorage: makeFakeSessionStorage(), console };
  vm.createContext(sandbox);
  vm.runInContext(scaffold, sandbox);
  return sandbox.__api;
}

test('edit 3 fields, reload, undo twice restores the earlier values (persisted across the reload)', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-s-3-persist-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-s-3-'),
    SERVER_SECRET: 'audit27-s-3-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await acceptCookiesAndStart(page, base, 'local-service');

      const name0 = await readField(page, 'business.name');
      const tagline0 = await readField(page, 'business.tagline');
      const zone0 = await readField(page, 'business.zone');
      assert.ok(name0, 'business.name must have preset text to begin with');
      assert.ok(tagline0, 'business.tagline must have preset text to begin with');
      assert.ok(zone0, 'business.zone must have preset text to begin with');

      // ---- Edit 3 distinct fields — 3 distinct undo steps (each field has
      // its own coalesce key, see pendingHistoryCoalesceKey in app.js). ----
      await editField(page, 'business.name', 'Nume Modificat Unu');
      await editField(page, 'business.tagline', 'Tagline Modificat Doi');
      await editField(page, 'business.zone', 'Zona Modificat Trei');

      const beforeReload = await page.evaluate(() => ({
        index: historyState.index,
        length: historyState.stack.length,
      }));
      assert.ok(beforeReload.length >= 4, `expected baseline + 3 edits, got stack length ${beforeReload.length}`);
      assert.equal(beforeReload.index, beforeReload.length - 1, 'pointer sits at the most recent edit before reload');
      await page.screenshot({ path: path.join(shotDir, '01-three-fields-edited-before-reload.png') });

      // ---- RELOAD — the whole point of this oracle. Before the fix,
      // resetHistory() always started a fresh one-entry baseline here. ----
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#preview-iframe').waitFor({ state: 'visible' });
      await page.waitForTimeout(1200);
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(400);
      }

      assert.equal(await readField(page, 'business.name'), 'Nume Modificat Unu', 'the edited values themselves must survive the reload');
      assert.equal(await readField(page, 'business.tagline'), 'Tagline Modificat Doi');
      assert.equal(await readField(page, 'business.zone'), 'Zona Modificat Trei');

      const afterReload = await page.evaluate(() => ({
        index: historyState.index,
        length: historyState.stack.length,
      }));
      assert.equal(afterReload.length, beforeReload.length, 'the persisted undo stack must be resumed, not reset to a fresh baseline, after a reload');
      assert.equal(afterReload.index, beforeReload.index, 'the pointer must resume at the same position, not reset to 0');

      const undoBtn = page.locator('#btn-undo');
      assert.equal(await undoBtn.isDisabled(), false, 'Undo must be enabled right after a reload that resumed real history');
      await page.screenshot({ path: path.join(shotDir, '02-after-reload-history-resumed.png') });

      // ---- Undo twice — must restore the two most-recently-edited fields'
      // EARLIER values, leaving the first edit (business.name) intact. ----
      await undoBtn.click();
      await page.waitForTimeout(1200);
      assert.equal(await readField(page, 'business.zone'), zone0, 'first undo (after reload) must revert business.zone to its pre-edit value');
      assert.equal(await readField(page, 'business.tagline'), 'Tagline Modificat Doi', 'first undo must not touch the earlier tagline edit yet');
      await page.screenshot({ path: path.join(shotDir, '03-after-first-undo.png') });

      await undoBtn.click();
      await page.waitForTimeout(1200);
      assert.equal(await readField(page, 'business.tagline'), tagline0, 'second undo (after reload) must revert business.tagline to its pre-edit value');
      assert.equal(await readField(page, 'business.name'), 'Nume Modificat Unu', 'second undo must leave the first (name) edit in place');
      await page.screenshot({ path: path.join(shotDir, '04-after-second-undo.png') });

      console.log('PASS audit27-s-3 (reload persistence): screenshots at', shotDir);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('logout clears this tab\'s persisted history, and a different account in another tab of the same browser sees none of it', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-s-3-crossaccount-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-s-3-xacct-'),
    SERVER_SECRET: 'audit27-s-3-xacct-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const emailA = 'audit27-s3-a-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const emailB = 'audit27-s3-b-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const secretMarker = 'ISTORIC-PRIVAT-CONT-A-' + crypto.randomUUID().slice(0, 8);

      // ---- Account A: start a design, sign in, edit a private marker into
      // the canvas (creating a persisted, account-A-owned undo step), then
      // sign out via the real "Deconectare" menu item, in its OWN tab —
      // this is the exact scenario historyStoreClearOwned() exists for
      // (clearOwnedLocalDraftState() in builder/app.js). ----
      const pageA = await context.newPage();
      pageA.setDefaultTimeout(30000);
      await acceptCookiesAndStart(pageA, base, 'product-menu');
      await signInFromDashboard(pageA, base, emailA);
      await pageA.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
      await pageA.locator('#preview-iframe').waitFor({ state: 'visible' });
      await pageA.waitForTimeout(1000);
      if (await pageA.locator('#details-drawer').isVisible().catch(() => false)) {
        await pageA.locator('#btn-close-drawer').click().catch(() => {});
        await pageA.waitForTimeout(300);
      }
      await editField(pageA, 'business.name', secretMarker);

      const accountAId = await pageA.evaluate(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null);
      assert.ok(accountAId, 'account A must actually be signed in for this repro to mean anything');

      const historyDumpAfterA = await pageA.evaluate(() => sessionStorage.getItem('hb.history.v1') || '');
      assert.match(
        historyDumpAfterA,
        new RegExp(escapeForRegExp(secretMarker)),
        'sanity check: the persisted history store must actually hold account A\'s edit before logout'
      );
      assert.match(
        historyDumpAfterA,
        new RegExp(escapeForRegExp(accountAId)),
        'sanity check: the persisted record must be stamped with account A\'s id'
      );
      await pageA.screenshot({ path: path.join(shotDir, '01-account-a-history-has-marker.png') });

      await signOutFromEditor(pageA);
      await pageA.screenshot({ path: path.join(shotDir, '02-account-a-after-real-logout.png') });

      // ---- Storage-level check, in A's OWN tab, right after the real
      // logout, no reload in between: doLogout() -> clearOwnedLocalDraftState()
      // -> historyStoreClearOwned() must have already scrubbed A's record. ----
      const historyDumpAfterLogout = await pageA.evaluate(() => sessionStorage.getItem('hb.history.v1') || '');
      assert.doesNotMatch(
        historyDumpAfterLogout,
        new RegExp(escapeForRegExp(secretMarker)),
        'logout must clear account A\'s persisted undo history from this tab\'s sessionStorage'
      );
      // ...and the toolbar itself must reflect it — nothing left to undo,
      // in this same tab, immediately after logout.
      assert.equal(await pageA.locator('#btn-undo').isDisabled(), true, 'Undo must be disabled in this tab immediately after logout — no lingering in-memory history either');
      await pageA.close();

      // ---- A genuinely different tab of the SAME browser context (shares
      // localStorage/cookies, but sessionStorage starts empty — same
      // "genuinely fresh tab" shape as audit27-r-02's own repro) signs in
      // as a DIFFERENT account and opens /app/#edit. ----
      const pageB = await context.newPage();
      pageB.setDefaultTimeout(30000);
      await signInFromDashboard(pageB, base, emailB);
      await pageB.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
      await pageB.waitForTimeout(800);
      await pageB.screenshot({ path: path.join(shotDir, '03-account-b-fresh-tab-edit-route.png') });

      const canvasText = await pageB.frameLocator('#preview-iframe').locator('body').innerText().catch(() => '');
      assert.doesNotMatch(
        canvasText,
        new RegExp(escapeForRegExp(secretMarker)),
        'account B\'s editor canvas must never show account A\'s private marker'
      );
      const undoBtnB = pageB.locator('#btn-undo');
      assert.equal(await undoBtnB.isDisabled(), true, 'account B must start with nothing to undo — no inherited history from A');

      const historyDumpForB = await pageB.evaluate(() => sessionStorage.getItem('hb.history.v1') || '');
      assert.doesNotMatch(
        historyDumpForB,
        new RegExp(escapeForRegExp(secretMarker)),
        'account B must never see account A\'s marker anywhere in the persisted history store'
      );

      // ---- Narrow, deterministic gate check on the shipped functions
      // themselves (same pattern as audit27-r-02's "gate only" test): even if
      // a record for A's old scope key somehow survived, historyStoreLoad()
      // must refuse to hand it to a DIFFERENT signed-in account. ----
      const gateResult = await pageB.evaluate((accId) => {
        const scopeKey = 'local:seeded-for-gate-check';
        const seeded = { ownerUserId: 'seeded-foreign-account-id', index: 0, entries: [{ json: '{"x":1}', size: 8 }], updatedAt: Date.now() };
        const all = JSON.parse(sessionStorage.getItem('hb.history.v1') || '{}');
        all[scopeKey] = seeded;
        sessionStorage.setItem('hb.history.v1', JSON.stringify(all));
        const loadedForRealAccount = historyStoreLoad(scopeKey, accId);
        const loadedForForeignOwner = historyStoreLoad(scopeKey, 'seeded-foreign-account-id');
        // Clean up the seeded probe record so it doesn't leak into other assertions.
        const all2 = JSON.parse(sessionStorage.getItem('hb.history.v1') || '{}');
        delete all2[scopeKey];
        sessionStorage.setItem('hb.history.v1', JSON.stringify(all2));
        return { loadedForRealAccount, loadedForForeignOwner: !!loadedForForeignOwner };
      }, accountAId);
      assert.equal(gateResult.loadedForRealAccount, null, 'historyStoreLoad() must refuse a record stamped to a DIFFERENT account than the one asking');
      assert.equal(gateResult.loadedForForeignOwner, true, 'sanity check: the SAME owner id must still be able to read its own seeded record');

      await pageB.screenshot({ path: path.join(shotDir, '04-account-b-final-state-clean.png') });
      console.log('PASS audit27-s-3 (cross-account isolation): screenshots at', shotDir);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('a session that includes a real photo upload still resumes its history after a reload (reviewer-found regression)', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-s-3-photo-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-s-3-photo-'),
    SERVER_SECRET: 'audit27-s-3-photo-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      // product-menu ships a real single-image "Logo" field in the gallery
      // modal (see suite2-transparent-png.test.js) — no list-add needed.
      await acceptCookiesAndStart(page, base, 'product-menu');

      const name0 = await readField(page, 'business.name');
      const tagline0 = await readField(page, 'business.tagline');
      assert.ok(name0, 'business.name must have preset text to begin with');
      assert.ok(tagline0, 'business.tagline must have preset text to begin with');

      // Step 1: a plain text edit.
      await editField(page, 'business.name', 'Nume Inainte De Poza');

      // Step 2: a REAL photo upload, big enough after resize to exceed
      // history-store.js's HISTORY_IMAGE_STRIP_THRESHOLD (20000 base64
      // chars) — this is the exact condition the reviewer found broken.
      const { buffer } = await genNoisyPhotoBuffer(page, 600, 400);
      await uploadLogoPhoto(page, buffer);
      const uploadedLogo = await readField(page, 'logo');
      assert.ok(uploadedLogo && uploadedLogo.indexOf('data:image/') === 0, 'the logo must actually be stored as a data: URL after upload');
      assert.ok(uploadedLogo.length > 20000, `uploaded photo must exceed the strip threshold to exercise the bug (got ${uploadedLogo.length} chars)`);
      await page.waitForTimeout(1600); // past the debounced server-save/history-persist window

      // Step 3: another plain text edit, on top of the photo.
      await editField(page, 'business.tagline', 'Tagline Dupa Poza');

      const beforeReload = await page.evaluate(() => ({ index: historyState.index, length: historyState.stack.length }));
      assert.ok(beforeReload.length >= 3, `expected baseline + name edit + photo + tagline edit, got stack length ${beforeReload.length}`);
      assert.equal(beforeReload.index, beforeReload.length - 1);

      // Sanity: at this point (no reload yet) the persisted sessionStorage
      // copy of the TOP entry must already be stripped (this is what used to
      // defeat the raw-string comparison in resetHistory()) while the live,
      // in-memory top entry still carries the real image — proves this
      // oracle is actually exercising the reported failure mode, not a
      // no-op.
      const persistedTopStripped = await page.evaluate(() => {
        const all = JSON.parse(sessionStorage.getItem('hb.history.v1') || '{}');
        const scopeKey = typeof currentScopeKey === 'function' ? currentScopeKey() : null;
        const rec = scopeKey ? all[scopeKey] : null;
        const top = rec && rec.entries && rec.entries[rec.index];
        return !!(top && top.json.indexOf('__HB_HISTORY_IMAGE_OMITTED__') >= 0);
      });
      assert.equal(persistedTopStripped, true, 'sanity check: the persisted top entry must have its large image stripped before the reload (history-store.js contract)');

      await page.screenshot({ path: path.join(shotDir, '01-photo-and-text-edits-before-reload.png') });

      // ---- RELOAD — before the fix, resetHistory()'s raw string compare
      // between the (stripped) persisted top entry and the (unstripped)
      // freshly-reloaded draft.config always failed here, silently
      // discarding the whole persisted stack back to a fresh 1-entry
      // baseline. ----
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#preview-iframe').waitFor({ state: 'visible' });
      await page.waitForTimeout(1200);
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(400);
      }

      assert.equal(await readField(page, 'business.name'), 'Nume Inainte De Poza', 'the edited values themselves must survive the reload');
      assert.equal(await readField(page, 'business.tagline'), 'Tagline Dupa Poza');
      const logoAfterReload = await readField(page, 'logo');
      assert.ok(logoAfterReload && logoAfterReload.indexOf('data:image/') === 0, 'the real uploaded photo must survive the reload (ordinary draft persistence, unaffected by history stripping)');

      const afterReload = await page.evaluate(() => ({ index: historyState.index, length: historyState.stack.length }));
      assert.equal(afterReload.length, beforeReload.length, 'the persisted undo stack must be RESUMED, not reset to a fresh baseline, even though the session included a real photo upload');
      assert.equal(afterReload.index, beforeReload.index, 'the pointer must resume at the same position, not reset to 0');

      const undoBtn = page.locator('#btn-undo');
      assert.equal(await undoBtn.isDisabled(), false, 'Undo must be enabled right after a reload that resumed real history');
      await page.screenshot({ path: path.join(shotDir, '02-after-reload-history-resumed.png') });

      // ---- Undo past the photo step: earlier text values must come back.
      // The image placeholder left on the resumed photo-step entry itself is
      // an accepted, documented trade-off (history-store.js file header) —
      // what must NOT happen is the whole stack having been thrown away. ----
      await undoBtn.click(); // undo tagline edit
      await page.waitForTimeout(1200);
      assert.equal(await readField(page, 'business.tagline'), tagline0, 'first undo (after reload) must revert business.tagline to its pre-edit value');
      await page.screenshot({ path: path.join(shotDir, '03-after-undo-tagline.png') });

      await undoBtn.click(); // undo the photo step
      await page.waitForTimeout(1200);
      assert.equal(await readField(page, 'business.name'), 'Nume Inainte De Poza', 'undoing the photo step must not disturb the earlier (still-intact) name edit');
      await page.screenshot({ path: path.join(shotDir, '04-after-undo-photo-step.png') });

      await undoBtn.click(); // undo the name edit — back to the original baseline
      await page.waitForTimeout(1200);
      assert.equal(await readField(page, 'business.name'), name0, 'undoing all the way must restore the original preset name');

      console.log('PASS audit27-s-3 (photo-inclusive session resumes after reload): screenshots at', shotDir);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('unit: resetHistory() resumes a persisted stack whose top entry had a large image stripped (symmetric normalization)', () => {
  const api = buildHistorySandbox();
  const scopeKey = 'local:unit-test-photo-scope';
  const accountId = 'acct-unit-test';
  api.setScope(scopeKey);
  api.setAccount(accountId);

  const bigImage = 'data:image/jpeg;base64,' + 'A'.repeat(25000); // > HISTORY_IMAGE_STRIP_THRESHOLD (20000)
  const configEarlier = { business: { name: 'Nume Zero' }, logo: '' };
  const configWithImage = { business: { name: 'Nume Unu' }, logo: bigImage };

  // Simulate what a real editing session would have already persisted: a
  // 2-entry stack, written through the REAL historyStoreSave() — which
  // strips the large image exactly like it would before any real reload.
  const stack = [
    { json: JSON.stringify(configEarlier), size: JSON.stringify(configEarlier).length },
    { json: JSON.stringify(configWithImage), size: JSON.stringify(configWithImage).length },
  ];
  const saved = api.historyStoreSave(scopeKey, accountId, stack, 1);
  assert.equal(saved, true, 'test setup: historyStoreSave() must succeed against the fake sessionStorage');

  // The freshly "reloaded" draft.config, exactly as a real reload would hand
  // it to resetHistory() — the REAL, unstripped image, never touched by
  // history-store.js at all (it comes from the site's own saved config).
  api.setDraftConfig(configWithImage);

  api.resetHistory();

  const hs = api.getHistoryState();
  assert.equal(hs.stack.length, 2, 'the persisted 2-entry stack must be RESUMED, not collapsed to a fresh 1-entry baseline, even though its top entry had the image stripped');
  assert.equal(hs.index, 1, 'the pointer must resume at the same index the session was persisted at');
});

test('unit: resetHistory() still falls back to a fresh baseline when the persisted top entry genuinely does not match the loaded draft', () => {
  const api = buildHistorySandbox();
  const scopeKey = 'local:unit-test-stale-scope';
  const accountId = 'acct-unit-test';
  api.setScope(scopeKey);
  api.setAccount(accountId);

  const bigImage = 'data:image/jpeg;base64,' + 'B'.repeat(25000);
  const persistedConfig = { business: { name: 'Nume Persistat' }, logo: bigImage };
  // A DIFFERENT current config (a stale/foreign persisted stack, or a config
  // that genuinely changed some other way) — must NOT resume, even after
  // stripping images symmetrically on both sides.
  const liveConfig = { business: { name: 'Nume Cu Totul Altul' }, logo: bigImage };

  const stack = [{ json: JSON.stringify(persistedConfig), size: JSON.stringify(persistedConfig).length }];
  api.historyStoreSave(scopeKey, accountId, stack, 0);
  api.setDraftConfig(liveConfig);

  api.resetHistory();

  const hs = api.getHistoryState();
  assert.equal(hs.stack.length, 1, 'a genuinely mismatched persisted stack must fall back to a fresh baseline, not resume');
  assert.equal(hs.index, 0);
  assert.equal(hs.stack[0].json, JSON.stringify(liveConfig), 'the fresh baseline must be the actually-loaded draft.config, not the stale persisted one');
});
