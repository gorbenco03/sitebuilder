'use strict';
/**
 * bot/test/suite12-drawer-overlay-never-blocks.test.js
 *
 * VERIFIED FINDING (explorer, reproduced 2x+): "the editor freezes" — right
 * after opening a freshly selected design (seen most on desserdirina, also
 * after undo/redo), #drawer-overlay keeps intercepting pointer events over
 * the whole canvas for 10+ seconds although #details-drawer is already
 * closed. Every click on the page does nothing.
 *
 * ROOT CAUSE (builder/app.js, before this fix): showScreen('edit') schedules
 * Details' auto-open inside a bare requestAnimationFrame:
 *
 *   if (shouldAutoOpenDrawer() && !drawerOpen) {
 *     requestAnimationFrame(() => {
 *       if (shouldAutoOpenDrawer() && !drawerOpen) openDrawer();
 *     });
 *   }
 *
 * The re-check inside the callback only guards against the DRAWER's own
 * state changing (a manual open/close) before the frame fires — it does
 * nothing once the app has left the #edit screen entirely before that frame
 * fires (a fast back-navigation, or any redirect landing between the
 * schedule and the next paint). showScreen(name !== 'edit')'s own cleanup is
 * gated on `if (drawerOpen)`, which is still false at that point (the
 * auto-open never got to run) — so it skips its hide, does NOT cancel the
 * pending rAF, and does not touch localStorage's drawer pref either. The
 * stale rAF fires moments later, sees shouldAutoOpenDrawer() still true and
 * drawerOpen still false, and calls openDrawer() — showing #drawer-overlay
 * (position:fixed; inset:0; z-index:450 — covers the ENTIRE viewport
 * regardless of which `.screen` is on display) and #details-drawer on top of
 * whatever screen the app actually navigated to. To the owner this reads as
 * exactly the reported bug: the whole canvas stops responding to clicks,
 * seemingly at random, some time after they picked a design.
 *
 * FIX: every rAF this module schedules that can end in an open/close
 * decision is now tracked (pendingDrawerAutoOpenRaf / pendingDrawerFocusRaf)
 * and explicitly cancelled — not just out-raced by a re-check — the moment
 * the app leaves #edit (unconditionally, not gated on drawerOpen) or the
 * drawer is closed by any other path. #drawer-overlay / #details-drawer
 * visibility is now derived from `drawerOpen` in exactly one place
 * (syncDrawerDom()), so the two can never disagree.
 *
 * This oracle drives the real editor in real Chromium against a real
 * server (same pattern as bot/test/suite8-drawer-edit-survives-rebuild.
 * test.js) and reproduces the race DETERMINISTICALLY by taking control of
 * requestAnimationFrame/cancelAnimationFrame in-page — no reliance on a
 * slow first paint or lucky timing:
 *
 *   1. Force Details' auto-open pref to 'open' (matches a first-time visit).
 *   2. Replace window.requestAnimationFrame/cancelAnimationFrame with a
 *      manually-flushed queue.
 *   3. Call showScreen('edit') — captures the auto-open rAF without firing it.
 *   4. Call showScreen('templates') — simulates leaving #edit before that
 *      frame ever got a chance to paint.
 *   5. Flush the queue by hand (fires whatever is still pending, exactly as
 *      the browser would on its next frame).
 *   6. Assert #drawer-overlay is NOT showing over the templates screen.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-drawer-overlay-never-blocks.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-drawer-overlay-'));
process.env.SERVER_SECRET = 'drawer-overlay-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

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

async function openDesserdirinaEditor(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
}

/** Install a manually-flushed rAF/cAF queue in the page so the test controls
 * exactly when (and whether) a scheduled callback ever runs. */
async function installManualRaf(page) {
  await page.evaluate(() => {
    window.__rafQueue = [];
    window.__rafNextId = 1;
    window.requestAnimationFrame = function (cb) {
      const id = window.__rafNextId++;
      window.__rafQueue.push({ id, cb });
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      window.__rafQueue = window.__rafQueue.filter((e) => e.id !== id);
    };
    window.__flushRaf = function () {
      const queue = window.__rafQueue;
      window.__rafQueue = [];
      queue.forEach((e) => e.cb());
    };
  });
}

test('a stale Details auto-open never re-shows the overlay after the app has left #edit', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    await openDesserdirinaEditor(page);

    // Start from a clean, known drawer state regardless of what the real
    // (unmocked) auto-open already did on the initial navigation above.
    await page.evaluate(() => {
      if (typeof drawerOpen !== 'undefined' && drawerOpen && typeof closeDrawer === 'function') closeDrawer();
      try { localStorage.setItem('hb-details-drawer-pref', 'open'); } catch (_) {}
    });

    await installManualRaf(page);

    // Step 1: enter #edit — schedules the auto-open rAF but does not run it
    // (our mock never fires callbacks on its own).
    const scheduledAfterEnteringEdit = await page.evaluate(() => {
      showScreen('edit');
      return window.__rafQueue.length;
    });
    assert.equal(
      scheduledAfterEnteringEdit, 1,
      'showScreen(\'edit\') should schedule exactly one auto-open rAF when Details\' pref allows it'
    );

    // Step 2: leave #edit before that frame ever fires — the exact window
    // the freeze bug lives in (a fast navigate-away right after selecting a
    // design, before the browser's next paint).
    await page.evaluate(() => { showScreen('templates'); });

    // Step 3: now let that frame fire, exactly as the real browser would on
    // its next paint.
    await page.evaluate(() => { window.__flushRaf(); });

    const state = await page.evaluate(() => {
      const overlay = document.getElementById('drawer-overlay');
      const drawer = document.getElementById('details-drawer');
      const templatesScreen = document.getElementById('screen-templates');
      const rect = templatesScreen.getBoundingClientRect();
      // A point that is definitely inside the templates screen's own box —
      // if the overlay is (wrongly) still covering it, this element-from-point
      // resolves to the overlay instead of the real templates-screen content.
      const probeX = Math.max(20, Math.min(window.innerWidth - 20, rect.left + 40));
      const probeY = Math.max(20, Math.min(window.innerHeight - 20, rect.top + 40));
      const hit = document.elementFromPoint(probeX, probeY);
      return {
        overlayDisplay: getComputedStyle(overlay).display,
        drawerDisplay: getComputedStyle(drawer).display,
        drawerOpenFlag: typeof drawerOpen !== 'undefined' ? drawerOpen : null,
        currentScreenIsEdit: getComputedStyle(document.getElementById('screen-edit')).display !== 'none',
        hitIsOverlay: hit === overlay,
      };
    });

    assert.equal(state.currentScreenIsEdit, false, 'the test must actually be on the templates screen, not #edit');
    assert.equal(
      state.overlayDisplay, 'none',
      'a stale auto-open rAF must not re-show #drawer-overlay once the app has left #edit — this is the reported freeze'
    );
    assert.equal(
      state.drawerDisplay, 'none',
      '#details-drawer must stay hidden too — the two must never disagree'
    );
    assert.equal(state.drawerOpenFlag, false, 'drawerOpen must reflect reality: nothing is open');
    assert.equal(
      state.hitIsOverlay, false,
      'a click over the templates screen must reach the templates screen, not a blocking #drawer-overlay'
    );

    await page.close();
  } finally {
    await browser.close();
  }
});

test('#drawer-overlay and #details-drawer are always shown/hidden together across open, close and a leftover focus rAF', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    await openDesserdirinaEditor(page);

    await page.evaluate(() => {
      if (typeof drawerOpen !== 'undefined' && drawerOpen && typeof closeDrawer === 'function') closeDrawer();
    });

    async function bothVisible() {
      return page.evaluate(() => {
        const overlay = getComputedStyle(document.getElementById('drawer-overlay')).display;
        const drawer = getComputedStyle(document.getElementById('details-drawer')).display;
        return { overlay, drawer, agree: (overlay === 'none') === (drawer === 'none') };
      });
    }

    // Open via the real topbar button (real rAF, real timing).
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    let snap = await bothVisible();
    assert.equal(snap.agree, true, 'overlay and drawer must agree once open');
    assert.notEqual(snap.overlay, 'none');
    assert.notEqual(snap.drawer, 'none');

    // Close immediately via Escape — before this fix, openDrawer()'s own
    // focus rAF (a SEPARATE pending frame from the auto-open one) was never
    // tracked or cancelled either; assert it cannot leave any visible trace.
    await page.keyboard.press('Escape');
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    snap = await bothVisible();
    assert.equal(snap.agree, true, 'overlay and drawer must agree once closed');
    assert.equal(snap.overlay, 'none');
    assert.equal(snap.drawer, 'none');

    const pendingAfterClose = await page.evaluate(() => ({
      autoOpen: typeof pendingDrawerAutoOpenRaf !== 'undefined' ? pendingDrawerAutoOpenRaf : 'undeclared',
      focus: typeof pendingDrawerFocusRaf !== 'undefined' ? pendingDrawerFocusRaf : 'undeclared',
    }));
    assert.equal(pendingAfterClose.autoOpen, null, 'no auto-open rAF should be left pending after a close');
    assert.equal(pendingAfterClose.focus, null, 'no focus rAF should be left pending after a close');

    await page.close();
  } finally {
    await browser.close();
  }
});
