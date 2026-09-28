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

// modal-domain-disconnect / modal-domain-switch (U-01) only render once a
// domain has actually been submitted (bot/domains.js#startDomainConnection),
// which needs the *.pages.dev host lookup to succeed — the one Cloudflare
// call this file needs, stubbed the same minimal way
// audit27-u-06-domain-modal-steps.test.js does. Reaching the disconnect/
// switch buttons never requires DNS/TLS to actually verify (they render for
// ANY non-'disconnected' status, see renderDomainModal()'s else branch), so
// unlike that oracle this stub never needs to handle the domain-attach or
// DNS-verify calls at all — an unexpected one fails loudly instead of
// silently succeeding.
function fakePagesHostFetch(pagesHost) {
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    if (/\/pages\/projects\/[^/]+$/.test(u) && !u.includes('/domains') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ success: true, result: { subdomain: pagesHost } }) };
    }
    throw new Error('suite4 fake Cloudflare fetch: unhandled request ' + method + ' ' + u);
  };
  return () => { global.fetch = orig; };
}

// Polls the real DOM state instead of sleeping a fixed duration — under
// concurrent system load a close animation/handler can legitimately take
// longer than any fixed sleep would allow, which used to read as "did not
// close" (a false fail) or leave the modal open to block the next check's
// click (a hang). waitFor's own polling absorbs that variance; it returns
// as soon as the real condition is true instead of always waiting the full
// timeout.
async function waitForClosed(page, id, timeout = 5000) {
  try {
    await page.locator('#' + id).waitFor({ state: 'hidden', timeout });
    return true;
  } catch (_) {
    return false;
  }
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
  process.env.CLOUDFLARE_API_TOKEN = 'fake-token';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'fake-account';
  delete process.env.PUBLIC_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VERCEL_TOKEN;
  const restoreFetch = fakePagesHostFetch('suite4-modal-xyz.pages.dev');

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
      const escCloses = await waitForClosed(page, modalId, 5000);
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
        const backdropCloses = await waitForClosed(page, modalId, 5000);
        if (!backdropCloses) failures.push(`${name}: clicking the backdrop did not close the modal`);
        if (backdropCloses) {
          if (triggerHandle) await triggerHandle.dispose().catch(() => {});
          triggerHandle = await openFn();
          await page.locator('#' + modalId).waitFor({ state: 'visible' });
        }
      }

      // 5) Guaranteed close via X (whatever state the modal is in after the
      // checks above) + focus-return check against the trigger captured
      // by the most recent openFn() call. This step is cleanup, not a
      // contract assertion — but the *next* contractCheck's openFn() clicks
      // a trigger button elsewhere on the page, and a still-open modal-box
      // intercepts that click until Playwright's own actionability timeout,
      // which used to surface as an unrelated "hang" on the next modal
      // under load rather than as a failure here. A generous wait (real
      // condition, not a fixed sleep) absorbs slow-machine variance; the
      // forced hide below is a last-resort isolation guarantee so one
      // modal's close animation can never block a later, unrelated check.
      await page.locator('#' + closeBtnId).click({ force: true, timeout: 5000 }).catch(() => {});
      const closedViaX = await waitForClosed(page, modalId, 10000);
      if (!closedViaX) {
        await page.evaluate((id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        }, modalId).catch(() => {});
      }
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

    // PLAN-UX §5.4 (S-4): at this file's 390px touch viewport, the topbar
    // collapses to its primary actions and Instagram/Descarcă HTML/ZIP/
    // Culoare move behind "Mai mult" (builder/app.css, body.mobile-coarse-
    // toolbar). Their own buttons still exist and still own their click
    // handlers (see MOBILE_MORE_MENU_ITEMS in app.js) — reach them the way
    // a real phone now does. app.js focuses #btn-topbar-more before
    // proxying the click, so that is the real opener a modal refocuses on
    // close, and it is what this helper hands back to contractCheck.
    async function clickViaMoreMenu(menuItemLabel) {
      const moreBtn = page.locator('#btn-topbar-more');
      const handle = await moreBtn.elementHandle();
      await moreBtn.click();
      await page.locator('#topbar-more-menu').waitFor({ state: 'visible' });
      await page.getByRole('menuitem', { name: menuItemLabel }).click({ timeout: 8000 });
      return handle;
    }

    // modal-delete-account's real trigger is a dropdown item (R-27, GDPR):
    // open the header account menu, then click "Șterge contul" inside it.
    // Unlike every other trigger in this file, the click handler itself
    // closes (hides) the menu that contains the just-clicked item before
    // the modal opens — so that item cannot be the element focus returns
    // to (a hidden element is never a valid focus target). The product's
    // own openDeleteAccountModal() (builder/app.js) accounts for this by
    // treating the still-visible dropdown TOGGLE button as the opener it
    // hands to openModal(), instead of document.activeElement (which would
    // already be document.body by the time it ran). This helper returns
    // that same toggle button's handle, matching what the product itself
    // now designates as "the element that opened it" — contractCheck's
    // refocus check below verifies the real mechanic, not a stand-in.
    async function openAccountDeleteModal() {
      const toggleBtn = await page.locator('#btn-account-menu-header').elementHandle();
      await page.locator('#btn-account-menu-header').click();
      await page.locator('#account-menu-header-delete-account').waitFor({ state: 'visible' });
      await page.locator('#account-menu-header-delete-account').click({ timeout: 8000 });
      return toggleBtn;
    }

    // modal-logout-everywhere (U-01, PLAN-UX-2026-09-27 §3): same dropdown-
    // item-hides-its-own-menu situation as modal-delete-account above, so
    // the same toggle-button-as-opener pattern applies here.
    async function openLogoutEverywhereModal() {
      const toggleBtn = await page.locator('#btn-account-menu-header').elementHandle();
      await page.locator('#btn-account-menu-header').click();
      await page.locator('#account-menu-header-logout-all').waitFor({ state: 'visible' });
      await page.locator('#account-menu-header-logout-all').click({ timeout: 8000 });
      return toggleBtn;
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
    await contractCheck('instagram', 'modal-instagram', 'btn-close-instagram', () => clickViaMoreMenu('Adaugă Instagram'));
    await contractCheck('publish', 'modal-publish', 'btn-close-publish', () => clickAndHandle(page.locator('#btn-publish')));

    // -----------------------------------------------------------------
    // modal-export-booking (U-04, export lens): only appears when
    // appointment.nativeBooking is on, so turn it on via the real Detalii
    // panel first, then trigger through the real "Descarcă HTML" button.
    // contractCheck never clicks "Continuă descărcarea", so no download or
    // network call actually happens here.
    // -----------------------------------------------------------------
    await page.locator('#btn-open-drawer').click({ timeout: 4000 });
    await drawer.waitFor({ state: 'visible', timeout: 4000 });
    await page.getByRole('button', { name: 'Activează calendarul nativ de programări Hidook' }).click({ timeout: 4000 });
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
      await page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
    });
    await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    await contractCheck('export-booking', 'modal-export-booking', 'btn-close-export-booking', () => clickViaMoreMenu('Descarcă HTML'));

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
    const successBackdropCloses = await waitForClosed(page, 'modal-success', 5000);
    if (!successBackdropCloses) failures.push('success: clicking the backdrop did not close the modal');

    // Escape + focus-return checks reuse the exact function the real
    // trigger calls (see header comment) instead of repeating checkout.
    await page.evaluate(() => openModal('modal-success'));
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    const successEscCloses = await waitForClosed(page, 'modal-success', 5000);
    if (!successEscCloses) failures.push('success: Escape did not close the modal');
    if (!successEscCloses) {
      await page.locator('#btn-close-success').click({ force: true }).catch(() => {});
    }
    // Guaranteed isolation for the dashboard checks that follow — same
    // reasoning as contractCheck's own step 5 above.
    const successClosed = await waitForClosed(page, 'modal-success', 10000);
    if (!successClosed) {
      await page.evaluate(() => {
        const el = document.getElementById('modal-success');
        if (el) el.style.display = 'none';
      }).catch(() => {});
    }

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

    // -----------------------------------------------------------------
    // modal-domain-disconnect / modal-domain-switch (U-01): both replace a
    // window.confirm() and only render once a domain has actually been
    // submitted (renderDomainModal()'s non-'disconnected' branch) — reached
    // here through the real connect form, using the stubbed *.pages.dev
    // lookup declared above (fakePagesHostFetch). Neither check ever clicks
    // its own destructive confirm button, so the domain record this creates
    // is simply left in 'awaiting_dns' — inert, nothing external attached.
    // -----------------------------------------------------------------
    await card.locator('button', { hasText: 'Domeniu' }).click();
    await page.locator('#modal-domain').waitFor({ state: 'visible' });
    await page.locator('#domain-input').fill('suite4-modal-' + Date.now().toString(36) + '.com');
    await page.locator('#btn-domain-connect-submit').click();
    await page.locator('#btn-domain-disconnect').waitFor({ state: 'visible', timeout: 10000 });

    // modal-domain and its two child confirm modals are opened stacked
    // (modal-domain is never closed underneath) — same reasoning as the
    // delete-site/delete-account dropdown-toggle pattern elsewhere in this
    // file: the real trigger for these two modals lives INSIDE another,
    // already-open modal, so the opener re-establishes that outer modal
    // whenever a prior Escape press (which closes every visible overlay)
    // took it down too.
    async function reopenDomainModalIfNeeded() {
      if (!(await page.locator('#modal-domain').isVisible().catch(() => false))) {
        await card.locator('button', { hasText: 'Domeniu' }).click();
        await page.locator('#modal-domain').waitFor({ state: 'visible' });
        await page.locator('#btn-domain-disconnect').waitFor({ state: 'visible', timeout: 10000 });
      }
    }

    await contractCheck('domain-disconnect', 'modal-domain-disconnect', 'btn-close-domain-disconnect', async () => {
      await reopenDomainModalIfNeeded();
      return clickAndHandle(page.locator('#btn-domain-disconnect'));
    });
    await contractCheck('domain-switch', 'modal-domain-switch', 'btn-close-domain-switch', async () => {
      await reopenDomainModalIfNeeded();
      return clickAndHandle(page.locator('#btn-domain-switch'));
    });

    // Leave the dashboard clean for the checks that follow — same
    // guaranteed-close reasoning as contractCheck's own step 5.
    await page.locator('#btn-close-domain').click({ force: true, timeout: 5000 }).catch(() => {});
    await waitForClosed(page, 'modal-domain', 5000);

    await contractCheck('invoices', 'modal-invoices', 'btn-close-invoices', () => clickAndHandle(card.locator('button', { hasText: 'Facturi' })));
    // modal-site-messages (S-2C, PLAN-UX §5.2 supporting piece): real
    // trigger is the card's own "Mesaje" button — present for any paid,
    // live site (same gate as Facturi), regardless of whether it has
    // received any messages yet.
    await contractCheck('site-messages', 'modal-site-messages', 'btn-close-site-messages', () => clickAndHandle(card.locator('button', { hasText: 'Mesaje' })));
    // modal-cancel-subscription (U-01): real trigger is the card's own
    // "Anulează" button (subscription still active — same site, straight
    // from checkout above). contractCheck never clicks the modal's own
    // "Anulează abonamentul" confirm button, so billing state is untouched
    // and the later delete-site check below still finds an active
    // subscription (its own point, see that check's comment).
    await contractCheck('cancel-subscription', 'modal-cancel-subscription', 'btn-close-cancel-subscription', () => clickAndHandle(card.locator('button', { hasText: 'Anulează' })));
    // modal-logout-everywhere (U-01): same dropdown-hides-its-trigger
    // situation as modal-delete-account below — contractCheck never clicks
    // "Deconectează-mă de pe toate", so the signed-in session this whole
    // dashboard section depends on survives into the next checks.
    await contractCheck('logout-everywhere', 'modal-logout-everywhere', 'btn-close-logout-everywhere', openLogoutEverywhereModal);
    // modal-delete-account (R-27, GDPR "Șterge contul definitiv"): same
    // never-actually-confirms-anything property as delete-site below —
    // contractCheck never fills the email-confirm input or clicks
    // "Șterge contul definitiv", so the signed-in user/session this whole
    // dashboard section depends on survives into the next check.
    await contractCheck('delete-account', 'modal-delete-account', 'btn-close-delete-account', openAccountDeleteModal);
    // Delete-site last: contractCheck never fills the confirm input or
    // clicks the confirm button, so nothing is actually deleted. The
    // subscription is still active at this point (see cancel-subscription
    // check above), so this instance also exercises the U-01
    // delete-site-subscription-notice branch — its extra "Anulează
    // abonamentul" button is just one more focusable element inside the
    // modal, already covered by the generic focus-trap check above.
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
    restoreFetch();
  }

  assert.deepStrictEqual(failures, [], 'modal contract failures:\n' + failures.join('\n'));
});
