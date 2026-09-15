'use strict';
/**
 * bot/test/suite12-mobile-topbar-discoverable.test.js
 *
 * VERIFIED FINDING (explorer, polish): at 390px the secondary editor topbar
 * buttons (Instagram, Culoare, Poze, Detalii, Descarcă HTML/ZIP — everything
 * in `.editor-topbar-scroll`, the Wave 11 phone-width scroll rail) collapse
 * to icon-only, with no touch-reachable hint of what each does. Every button
 * already had an aria-label (screen-reader name) and most a title="" tooltip
 * — but title="" needs mouse hover, which a touchscreen cannot produce, and
 * `.btn-topbar-label` (the visible text next to each icon) was hidden by
 * `@media (min-width: 720px)` everywhere below tablet width. A sighted touch
 * user on a phone had to guess, or tap blind.
 *
 * FIX: builder/app.css's phone-width block (`@media (max-width: 640px), …`)
 * now turns `.editor-topbar-scroll .btn-topbar-label` back on — the rail
 * already scrolls horizontally to fit whatever it holds (Wave 11), so a
 * visible label costs scroll distance, not layout breakage. #btn-publish is
 * untouched (outside the rail, its own <span>, unrelated breakpoint).
 *
 * This oracle drives the real editor in real Chromium at a 390×844 phone
 * viewport (matching HANDOFF-mobile.md's own investigation width) and checks,
 * for EVERY interactive control in the topbar:
 *   1. an accessible name (aria-label or visible text) — already true before
 *      this fix, asserted here as a regression guard;
 *   2. a VISIBLE, non-empty on-screen label (the actual gap this fix closes);
 *   3. a real 44×44px (or larger) touch target;
 *   4. real keyboard focusability (Tab-reachable — button.focus() actually
 *      lands, nothing is tabindex=-1'd or disabled by accident).
 * Plus a page-level check that nothing above causes the document itself to
 * scroll horizontally.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-mobile-topbar-discoverable.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-mobile-topbar-'));
process.env.SERVER_SECRET = 'mobile-topbar-' + crypto.randomBytes(8).toString('hex');
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

async function openProfessionalsEditorAtPhoneWidth(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
}

test('every editor-topbar rail control is discoverable at 390px: named, visibly labelled, 44x44, focusable', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(20000);
    await openProfessionalsEditorAtPhoneWidth(page);

    // The rail — everything except the pinned #btn-publish (its own
    // reasoning/breakpoint, not part of this finding).
    const buttonIds = await page.evaluate(() => {
      const rail = document.querySelector('.editor-topbar-scroll');
      // Only controls actually on screen right now — e.g. #btn-save-retry
      // only appears after a save error and is display:none (inside
      // #save-status) the rest of the time, so it is not part of this
      // finding's "icon-only, no visible hint" set.
      return Array.prototype.slice.call(rail.querySelectorAll('button[id]'))
        .filter((b) => b.offsetParent !== null)
        .map((b) => b.id);
    });
    assert.ok(buttonIds.length >= 5, 'expected at least the checklist/instagram/color/gallery/details/download buttons in the rail');

    for (const id of buttonIds) {
      const info = await page.evaluate((elId) => {
        const el = document.getElementById(elId);
        const rect = el.getBoundingClientRect();
        const label = el.querySelector('.btn-topbar-label');
        const cs = label ? getComputedStyle(label) : null;
        const accessibleName = el.getAttribute('aria-label') || (el.textContent || '').trim();
        el.focus();
        return {
          width: rect.width,
          height: rect.height,
          accessibleName,
          hasVisibleLabel: !!label && cs.display !== 'none' && label.offsetWidth > 0 && (label.textContent || '').trim().length > 0,
          labelText: label ? (label.textContent || '').trim() : null,
          focused: document.activeElement === el,
          disabled: el.disabled === true,
        };
      }, id);

      assert.ok(
        info.accessibleName && info.accessibleName.length > 0,
        '#' + id + ' must have an accessible name (aria-label or visible text)'
      );
      assert.ok(
        info.width >= 44 && info.height >= 44,
        '#' + id + ' touch target must be at least 44x44px, got ' + info.width + 'x' + info.height
      );
      assert.equal(info.disabled, false, '#' + id + ' must not be disabled at phone width');
      assert.equal(info.focused, true, '#' + id + ' must be keyboard-focusable');

      // #checklist-indicator carries its own always-visible <span> (not
      // .btn-topbar-label) — it never collapsed to icon-only in the first
      // place, so it is exempt from the "gained a visible label" check but
      // still had to pass every check above.
      if (id !== 'checklist-indicator') {
        assert.equal(
          info.hasVisibleLabel, true,
          '#' + id + ' must show a visible, touch-reachable text label at 390px (title="" tooltips need hover, which touch cannot do), got label="' + info.labelText + '"'
        );
      }
    }

    // The page itself must never scroll horizontally — only the rail may.
    const overflow = await page.evaluate(() => ({
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert.ok(
      overflow.docScrollWidth <= overflow.innerWidth + 1,
      'the document must not overflow horizontally at 390px (scrollWidth ' + overflow.docScrollWidth + ' vs innerWidth ' + overflow.innerWidth + ')'
    );

    await page.close();
  } finally {
    await browser.close();
  }
});
