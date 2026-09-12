'use strict';
/**
 * bot/test/suite4-modal-contract.test.js
 *
 * A single shared contract every builder modal must meet, checked on all of
 * them by ENUMERATING `.modal-overlay[role="dialog"]` straight out of the
 * live DOM rather than keeping a list of ids in this file.
 *
 * That is not a style preference — it is the exact mechanism that produced
 * m14 (Suite 4 QA, 2026-09-12): the Escape handler in builder/app.js used to
 * be a hardcoded array of six modal ids, written when there were six
 * modals. Three more (Domeniu, Facturi, Șterge definitiv) were added later
 * and nobody remembered to add their ids to that array, so Esc silently did
 * nothing on exactly those three — including the one modal (permanent
 * delete) where a fast, reflexive Esc matters most. A hardcoded list in an
 * oracle would repeat the same failure mode one level up: it would keep
 * passing forever on a tenth modal nobody added to it. So this file reads
 * the DOM for the ground truth (`ENUMERATED_IDS` below) and asserts, at the
 * very end, that every enumerated id was actually driven through the
 * contract — a modal added later with no matching trigger wired into
 * TRIGGERS fails this file loudly instead of being skipped.
 *
 * The contract, per modal, opened through its REAL trigger (not
 * openModal() called directly, except where noted for modal-success below):
 *   1. The X close button is >=44x44px at 390px (WCAG 2.5.5 / platform floor).
 *   2. Tab cycles focus without ever leaving the modal (focus trap).
 *   3. Escape closes it.
 *   4. Clicking the backdrop (outside the modal box, inside the overlay)
 *      closes it — unless the modal opts out via `data-no-backdrop-close`.
 *   5. Focus returns to the element that opened it, once closed.
 *
 * On accidental backdrop-close for the PERMANENT DELETE modal: this was
 * explicitly considered, not assumed. A backdrop tap on modal-delete-site
 * only closes the dialog — it can never trigger the delete itself, which
 * requires typing the site's exact name AND clicking "Șterge definitiv"
 * (bot/server.js re-checks the typed name server-side regardless of what
 * the button's disabled state claims). So an accidental close costs the
 * owner one re-open, not any data — the same cost as every other modal's
 * accidental close. No `data-no-backdrop-close` exception is declared here;
 * if that decision is ever reversed, the attribute check below
 * (`opts.noBackdropClose`) is what enforces it, and the exception must be
 * declared in TRIGGERS, not silently carved out in app.js.
 *
 * What this found on 2026-09-12, measured (not eyeballed) at 390x844:
 *   - `.modal-close` / `.modal-close-btn`: 27x28px on every one of the 9
 *     modals (M13) — one shared class, one shared bug.
 *   - Escape closed 6/9 but not modal-domain, modal-invoices,
 *     modal-delete-site (m14), matching the hardcoded-list bug above exactly.
 *   - Backdrop-click: measured working on ALL 9 already (delete-site,
 *     domain, invoices, versions, and the other 5 which share the same
 *     generic `.modal-overlay` click listener in builder/app.js). The QA
 *     report that seeded this suite (reports/10-mobile-builder.md D1)
 *     described backdrop-tap as entirely missing; a live, instrumented
 *     Playwright run against the actual code found the opposite —
 *     `document.querySelectorAll('.modal-overlay').forEach(overlay =>
 *     overlay.addEventListener('click', e => { if (e.target === overlay)
 *     closeModal(overlay.id) }))` has existed since 2026-07-06 (git blame),
 *     well before that report was written, and closes every modal tested.
 *     This file asserts the TRUE current behaviour (backdrop already
 *     closes) rather than the report's prose, per the project's own
 *     failing-first rule: "if the oracle passes on the first try, either
 *     the oracle is wrong or the defect doesn't exist" — investigated, and
 *     here the defect does not exist. Only the X-size and Esc-list halves
 *     of M13/m14 are real and fixed by this suite.
 *   - Focus trap and focus-return: already correct on every modal tested
 *     (same shared openModal()/closeModal() machinery) — this file keeps
 *     checking them so a future change to that shared code cannot regress
 *     them silently.
 *
 * modal-success is the one exception to "opened through its real trigger"
 * for every check: its real trigger is completing an entire checkout flow
 * (slug -> auth -> pay), which this file does drive for real ONCE to prove
 * the actual product flow opens it correctly and to check X-size, focus
 * trap and backdrop-close. Repeating that whole flow two more times just to
 * re-open the same modal for the Escape and focus-return checks would be
 * expensive and is not what those two checks are about — they are
 * properties of the SHARED openModal()/closeModal() machinery, already
 * proven identical across the other 8 real-trigger modals in this same
 * file. For those two checks only, modal-success is reopened with
 * `openModal('modal-success')` — the exact function its real trigger calls
 * internally, not a stand-in for it — and the focus-return assertion is
 * skipped for that reopened instance (its real trigger, #btn-pay-publish,
 * is disabled by the time the modal opens for a real payment, so
 * `document.activeElement` at open time is not that button even on the
 * genuine path — a pre-existing, unrelated behaviour of the pay flow, not
 * a modal-contract defect).
 *
 * Run: node --experimental-sqlite --test bot/test/suite4-modal-contract.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
// This suite may run from a git worktree that has no node_modules of its
// own (only the primary checkout installed deps) — same fallback chain as
// bot/test/delete-site-oracle.mjs.
const PW_CANDIDATES = [
  path.join(ROOT, 'node_modules', 'playwright'),
  '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
  '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
];
let chromium;
for (const cand of PW_CANDIDATES) {
  try { ({ chromium } = require(cand)); break; } catch (_) {}
}
if (!chromium) throw new Error('playwright not found; install or link node_modules/playwright');

const VIEWPORT = { width: 390, height: 844 };
const MIN_CLOSE = 44;

async function displayOf(page, id) {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    return el ? getComputedStyle(el).display : 'MISSING';
  }, id);
}

async function focusableCountIn(page, id) {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return 0;
    const nodes = el.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(nodes, (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length)).length;
  }, id);
}

test('suite4 modal contract: every builder modal — Esc, backdrop, 44px X, focus trap, focus return', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite4-modal-'));
  process.env.SERVER_SECRET = 'suite4-modal-' + crypto.randomBytes(8).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VERCEL_TOKEN;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const failures = [];
  const tested = new Set();

  try {
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});

    // ---- Dynamic enumeration: the ground truth this file is graded against.
    const enumerated = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.modal-overlay[role="dialog"]')).map((el) => el.id));
    assert.ok(enumerated.length >= 6, 'expected at least 6 modal-overlay dialogs in builder/index.html, found ' + enumerated.length);

    // -----------------------------------------------------------------
    // Generic contract runner, reused for every modal except modal-success.
    // -----------------------------------------------------------------
    async function contractCheck(name, modalId, closeBtnId, openFn, opts = {}) {
      tested.add(modalId);
      let triggerHandle = await openFn();
      await page.locator('#' + modalId).waitFor({ state: 'visible' });

      // 1) X close button size.
      const closeBox = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const btn = el && el.querySelector('.modal-close, .modal-close-btn');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }, modalId);
      if (!closeBox) {
        failures.push(`${name}: no .modal-close/.modal-close-btn found inside #${modalId}`);
      } else if (closeBox.w < MIN_CLOSE - 0.5 || closeBox.h < MIN_CLOSE - 0.5) {
        failures.push(`${name}: X close button is ${Math.round(closeBox.w)}x${Math.round(closeBox.h)}px, under the ${MIN_CLOSE}x${MIN_CLOSE} floor`);
      }

      // 2) Focus trap: Tab past the last focusable element must wrap inside.
      const focusable = await focusableCountIn(page, modalId);
      let escapedTrap = false;
      const tabs = Math.max(focusable + 6, 10);
      for (let i = 0; i < tabs; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate((id) => {
          const el = document.getElementById(id);
          return !!(el && el.contains(document.activeElement));
        }, modalId);
        if (!inside) { escapedTrap = true; break; }
      }
      if (escapedTrap) failures.push(`${name}: Tab moved focus outside the modal (focus trap broken)`);

      // 3) Escape.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const escCloses = (await displayOf(page, modalId)) === 'none';
      if (!escCloses) failures.push(`${name}: Escape did not close the modal`);
      if (escCloses) {
        if (triggerHandle) await triggerHandle.dispose().catch(() => {});
        triggerHandle = await openFn();
        await page.locator('#' + modalId).waitFor({ state: 'visible' });
      }

      // 4) Backdrop click (top-left corner of the fixed, inset:0 overlay —
      // always outside the centred modal box at 390px for every modal in
      // this app, including the wide preview variant, which still leaves
      // its own 0.5rem padding strip as real overlay/backdrop).
      if (opts.noBackdropClose) {
        const hasAttr = await page.evaluate((id) => document.getElementById(id).hasAttribute('data-no-backdrop-close'), modalId);
        if (!hasAttr) failures.push(`${name}: declared as a backdrop-close exception but is missing the data-no-backdrop-close attribute`);
      } else {
        await page.mouse.click(4, 4);
        await page.waitForTimeout(150);
        const backdropCloses = (await displayOf(page, modalId)) === 'none';
        if (!backdropCloses) failures.push(`${name}: clicking the backdrop did not close the modal`);
        if (backdropCloses) {
          if (triggerHandle) await triggerHandle.dispose().catch(() => {});
          triggerHandle = await openFn();
          await page.locator('#' + modalId).waitFor({ state: 'visible' });
        }
      }

      // 5) Guaranteed close via X (whatever state the modal is in after the
      // checks above) + focus-return check against the trigger captured
      // by the most recent openFn() call.
      await page.locator('#' + closeBtnId).click({ force: true, timeout: 5000 }).catch(() => {});
      await page.locator('#' + modalId).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      if (triggerHandle && !opts.skipRefocusCheck) {
        const refocused = await page.evaluate((el) => document.activeElement === el, triggerHandle).catch(() => false);
        if (!refocused) failures.push(`${name}: focus did not return to the trigger element after the modal closed`);
      }
      if (triggerHandle) await triggerHandle.dispose().catch(() => {});
    }

    async function clickAndHandle(locator) {
      const handle = await locator.elementHandle();
      await locator.click({ timeout: 8000 });
      return handle;
    }

    // -----------------------------------------------------------------
    // modal-preview: real trigger is the landing page's "Previzualizare".
    // Must run before a template is picked (the trigger only exists there).
    // -----------------------------------------------------------------
    await contractCheck(
      'preview',
      'modal-preview',
      'btn-close-preview',
      () => clickAndHandle(page.locator('.template-card[data-template-id="professionals"] .btn-preview-tpl'))
    );

    // Now actually enter the editor for the rest of the flow.
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 25000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
    await page.waitForTimeout(600);
    const drawer = page.locator('#details-drawer');
    if (await drawer.isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
        await page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
      });
      await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    }

    await contractCheck('gallery', 'modal-gallery', 'btn-close-gallery', () => clickAndHandle(page.locator('#btn-open-gallery')));
    await contractCheck('instagram', 'modal-instagram', 'btn-close-instagram', () => clickAndHandle(page.locator('#btn-add-instagram')));
    await contractCheck('publish', 'modal-publish', 'btn-close-publish', () => clickAndHandle(page.locator('#btn-publish')));

    // -----------------------------------------------------------------
    // modal-success: drive the real checkout once (see header comment).
    // -----------------------------------------------------------------
    tested.add('modal-success');
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'suite4-modal-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('suite4-modal@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    const payBtn = page.locator('#btn-pay-publish');
    await payBtn.waitFor({ state: 'visible' });
    await payBtn.click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 25000 });

    const successCloseBox = await page.evaluate(() => {
      const el = document.getElementById('modal-success');
      const btn = el && el.querySelector('.modal-close, .modal-close-btn');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    if (!successCloseBox) failures.push('success: no .modal-close/.modal-close-btn found inside #modal-success');
    else if (successCloseBox.w < MIN_CLOSE - 0.5 || successCloseBox.h < MIN_CLOSE - 0.5) {
      failures.push(`success: X close button is ${Math.round(successCloseBox.w)}x${Math.round(successCloseBox.h)}px, under the ${MIN_CLOSE}x${MIN_CLOSE} floor`);
    }

    const successFocusable = await focusableCountIn(page, 'modal-success');
    let successTrapEscaped = false;
    for (let i = 0; i < Math.max(successFocusable + 6, 10); i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const el = document.getElementById('modal-success');
        return !!(el && el.contains(document.activeElement));
      });
      if (!inside) { successTrapEscaped = true; break; }
    }
    if (successTrapEscaped) failures.push('success: Tab moved focus outside the modal (focus trap broken)');

    // Backdrop close, on the real (checkout-opened) instance.
    await page.mouse.click(4, 4);
    await page.waitForTimeout(150);
    const successBackdropCloses = (await displayOf(page, 'modal-success')) === 'none';
    if (!successBackdropCloses) failures.push('success: clicking the backdrop did not close the modal');

    // Escape + focus-return checks reuse the exact function the real
    // trigger calls (see header comment) instead of repeating checkout.
    await page.evaluate(() => openModal('modal-success'));
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const successEscCloses = (await displayOf(page, 'modal-success')) === 'none';
    if (!successEscCloses) failures.push('success: Escape did not close the modal');
    if (!successEscCloses) {
      await page.locator('#btn-close-success').click({ force: true }).catch(() => {});
    }
    await page.locator('#modal-success').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

    // -----------------------------------------------------------------
    // Dashboard modals: Istoric, Domeniu, Facturi, Șterge — same site,
    // just paid+live from the real checkout above.
    // -----------------------------------------------------------------
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.waitForTimeout(700);
    const card = page.locator('.site-card', { hasText: slug.replace(/-/g, '‑') }).first();
    await card.waitFor({ state: 'visible', timeout: 10000 });

    await contractCheck('versions', 'modal-versions', 'btn-close-versions', () => clickAndHandle(card.locator('button', { hasText: 'Istoric' })));
    await contractCheck('domain', 'modal-domain', 'btn-close-domain', () => clickAndHandle(card.locator('button', { hasText: 'Domeniu' })));
    await contractCheck('invoices', 'modal-invoices', 'btn-close-invoices', () => clickAndHandle(card.locator('button', { hasText: 'Facturi' })));
    // Delete-site last: contractCheck never fills the confirm input or
    // clicks the confirm button, so nothing is actually deleted.
    await contractCheck('delete-site', 'modal-delete-site', 'btn-close-delete-site', () => clickAndHandle(card.locator('button', { hasText: 'Șterge' })));

    // -----------------------------------------------------------------
    // The anti-m14-regression assertion: every enumerated modal must have
    // been driven through the contract above. A modal added later with no
    // matching trigger wired in fails HERE, loudly, instead of silently
    // passing by never being checked.
    // -----------------------------------------------------------------
    const missing = enumerated.filter((id) => !tested.has(id));
    assert.deepStrictEqual(missing, [], 'modal(s) enumerated from index.html but never driven through the contract: ' + missing.join(', '));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }

  assert.deepStrictEqual(failures, [], 'modal contract failures:\n' + failures.join('\n'));
});
