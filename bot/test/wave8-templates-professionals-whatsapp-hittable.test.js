'use strict';
/**
 * bot/test/wave8-templates-professionals-whatsapp-hittable.test.js
 *
 * Oracle for Wave8 finding #2 (HIGH, professionals): the WhatsApp floating
 * button becomes unclickable — visible, correctly styled, but the sticky
 * header intercepts the click — after a realistic edit session.
 *
 * Minimal reproduction (found by bisecting the "realistic edit session" the
 * re-audit described — rename, second text edit, colour, real photo upload,
 * list add/remove, reload, rename again, publish — none of which alone
 * reproduced it at common viewport sizes):
 *
 *   1. Publish "professionals" with a long, entirely realistic business name
 *      (law/consulting firm names routinely run 60-80 chars — the schema's
 *      own maxLen for business.name is 80; nothing adversarial here).
 *   2. Open the LIVE published site at a short viewport — a phone in
 *      landscape, or a phone whose visible viewport has shrunk because the
 *      browser's own address bar / a keyboard is on screen (375×250 is used
 *      below as a robust, reproducible stand-in for that class of device
 *      state; the underlying defect also reproduced at 568×320, 667×375 and
 *      812×375 depending on exactly how many lines the name wrapped to).
 *   3. Check whether `document.elementFromPoint()` at the WhatsApp button's
 *      own on-screen center returns the button (or a descendant of it) —
 *      the only meaningful definition of "clickable": being present and
 *      correctly styled in the DOM is not enough if something else is
 *      painted on top of it.
 *
 * Root cause: `.pr-nav__brand` (the header's business-name text, used
 * whenever the preset has no logo image) had no `white-space`/`overflow`
 * constraint. As a flex child of `.pr-nav__inner` it also had the flexbox
 * default `min-width: auto`, which refuses to shrink below the text's own
 * intrinsic width — so a long name wrapped onto 2-4 lines instead of
 * shrinking, growing `.pr-nav__inner` (and the whole `position: sticky`,
 * `z-index: 40` `<header class="pr-nav">`) taller with every extra line.
 * On a short viewport, that growth is enough for the header's own box to
 * structurally reach down over `.whatsapp-float`'s fixed bottom-right
 * position (z-index: 30) — lower stacking order than the header, so the
 * header wins every click at that screen position even though the WhatsApp
 * button still paints its icon on top visually in a screenshot taken above
 * the fold.
 *
 * Fix (templates/professionals/styles.css):
 *   1. `.pr-nav__brand` now gets `min-width: 0` (required for `text-overflow`
 *      to have any effect on a flex child — without it the browser silently
 *      falls back to the old wrap/overflow behaviour), `max-width: 60vw`,
 *      `overflow: hidden`, `white-space: nowrap`, `text-overflow: ellipsis`.
 *      The header can no longer grow taller than ~59px because of the
 *      business name, at any length or viewport width.
 *   2. Defense in depth: `.whatsapp-float`'s z-index raised from 30 to 41
 *      (above `.pr-nav`'s 40 and `.pr-nav__mobile`'s 39, still below the
 *      `.wa-qr` modal's 50) — so even a *different*, not-yet-found cause of
 *      header growth can no longer make this specific button unclickable.
 *
 * This oracle checks both effects: (a) the header's real-world height stays
 * pinned to a single line across a battery of short/narrow viewports with a
 * long name, and (b) the WhatsApp button is genuinely hittable at its own
 * screen position at each of them — the button being present in the DOM is
 * explicitly NOT accepted as sufficient.
 *
 * Causal RED before the templates/professionals/styles.css fix, GREEN after.
 *
 * The long name is now set in the config published through the API (the form
 * editor that typed it in was removed 2026-10-28).
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-templates-professionals-whatsapp-hittable.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { startHarness, publishConfig } = require('./lib/old-template-live.js');

const ROOT = path.resolve(__dirname, '../..');

// A long, entirely realistic Romanian professional-services business name —
// not adversarial input, well inside schema.json's business.name maxLen:80.
const LONG_NAME = 'Cabinet de Avocatură și Consultanță Juridică Specializată în Drept Comercial';

// The exact class of short/narrow viewport the defect needs: a phone in
// landscape, or a phone whose visible viewport has shrunk (address bar /
// keyboard on screen). All of these reproduced the header/WhatsApp overlap
// against the pre-fix CSS.
const VIEWPORTS = [
  { width: 375, height: 250 },
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 812, height: 375 },
];

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

test('wave8 professionals WhatsApp float: stays genuinely hittable with a long business name on short viewports', async (t) => {
  const H = await startHarness('wave8-pr-wa');

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    // Publish through the API with a long, realistic business name (this is
    // what puts the CSS-derived layout under test on the live static HTML).
    const { liveUrl } = await H.publish('professionals', publishConfig('professionals', (cfg) => {
      cfg.business.name = LONG_NAME;
    }), { slug: 'wave8-pr-wa-' + Date.now() });

    const live = await browser.newPage();
    live.setDefaultTimeout(30000);

    for (const vp of VIEWPORTS) {
      await live.setViewportSize(vp);
      await live.goto(liveUrl, { waitUntil: 'networkidle' });
      if (await live.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
        await live.locator('#hb-cookie-accept').click().catch(() => {});
      }
      await live.waitForTimeout(300);

      const info = await live.evaluate(() => {
        const wa = document.querySelector('a.whatsapp-float');
        const header = document.querySelector('header.pr-nav');
        if (!wa || !header) return { error: 'missing wa or header element' };
        const waRect = wa.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const cx = waRect.left + waRect.width / 2;
        const cy = waRect.top + waRect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return {
          headerHeight: headerRect.height,
          hitIsWa: hit === wa || (hit && wa.contains(hit)),
          hitTag: hit ? hit.tagName : null,
          hitClass: hit ? (hit.className || '') : null,
        };
      });

      const vpLabel = vp.width + 'x' + vp.height;

      // (a) The header must never grow past a single text line's worth of
      // height because of the business name — this is the actual mechanism
      // that let it reach the WhatsApp button.
      assert.ok(
        info.headerHeight < 90,
        'at ' + vpLabel + ': header grew to ' + info.headerHeight + 'px — the long business name is wrapping instead of truncating'
      );

      // (b) The real oracle: the button must be genuinely HITTABLE at its
      // own on-screen position — present-in-DOM is explicitly not enough.
      assert.ok(
        info.hitIsWa,
        'at ' + vpLabel + ': WhatsApp button is not hittable — elementFromPoint at its own center hit ' +
          info.hitTag + '.' + info.hitClass + ' instead'
      );
    }

    await live.close();
  } finally {
    await browser.close();
    await H.close();
  }
});
