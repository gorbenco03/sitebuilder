'use strict';
/**
 * bot/test/wave8-templates-zoom-overflow.test.js
 *
 * Oracle for Wave8 finding #3 (MEDIUM): horizontal overflow at 200% zoom on
 * product-menu, portfolio and professionals.
 *
 * Minimal reproduction (found by diagnosing which specific elements exceed
 * the viewport's right edge, rather than guessing): publish the template
 * with a realistic but long rename (an owner renaming to a real, longer
 * business name — nothing adversarial, well inside each schema's own
 * maxLen), open the live site at 390px, apply
 * `document.documentElement.style.zoom = 2` (this codebase's own
 * 200%-zoom test approximation), and check `document.documentElement`'s
 * scrollWidth/clientWidth and whether the page can actually be scrolled
 * sideways.
 *
 * Root causes found (two independent mechanisms, both about content that
 * cannot break onto a new line):
 *
 *   1. templates/professionals: contact.email ("contact@cabinet....ro") is
 *      one unbreakable token with no white-space to wrap on. It renders (a)
 *      inside `.pr-contact__list`, a CSS Grid whose implicit auto column
 *      has default min-width:auto on its <li> items — refusing to shrink
 *      the column below the email's own min-content width, and every row
 *      shares that one column so ALL of them got forced wide; and (b) as a
 *      plain inline `<a>` in `.pr-appt__fallback`, where inline text only
 *      wraps between words by default. Fixed with min-width:0 on the grid
 *      items (needed for anything else to have effect on a grid child) plus
 *      overflow-wrap/word-break on both spots. A separate, unrelated
 *      overflow source in the same template — `.pr-appt__submit`'s
 *      `min-width: 12rem` hard floor exceeding the ~195px effective layout
 *      width 200% zoom produces on a 390px phone — is fixed by switching to
 *      `width: min(100%, 12rem)`.
 *   2. templates/portfolio (same mechanism, different content): a long
 *      Instagram handle/address is one unbreakable token inside `.pf-row` /
 *      `.contact-item` chips. `.pf-appt__list` already wraps chips onto new
 *      lines (flex-wrap:wrap), but a flex item's default min-width still
 *      refuses to shrink a SINGLE chip below its own content's width. Fixed
 *      with the same overflow-wrap/word-break/max-width:100% shape.
 *      templates/product-menu's structurally identical `.pm-link` /
 *      `.contact-item` chips got the same defensive fix (checked
 *      statically below — not exercised live here since this preset's
 *      Instagram/Facebook labels are short and not derived from the
 *      business name, so this pass could not itself force a long token
 *      through them).
 *
 * Both templates also had a residual few-pixel-to-tens-of-pixels overflow
 * left over from non-content chrome (portfolio's off-canvas hamburger
 * drawer, which is `position:fixed` and hidden via `transform:
 * translateX(100%)` rather than `display:none` so it can slide in;
 * professionals' nav row, whose brand/CTA/hamburger are each already near
 * their practical minimum width). Both get `overflow-x: hidden` on `html`
 * AND `body` as a standard, low-risk backstop — confirmed by an ACTUAL
 * scroll attempt (`scrollTo`/mouse wheel), not just the scrollWidth number,
 * since a position:fixed/sticky descendant can still nudge that number
 * independently of what a visitor can actually scroll to.
 *
 * This oracle checks both effects per template: (a) scrollWidth no longer
 * exceeds clientWidth, and (b) the page is not actually scrollable
 * sideways (scrollX stays 0 after scrollTo + wheel) — the real user-facing
 * definition of "no horizontal overflow", since (a) alone can be misleading
 * under this zoom-approximation methodology.
 *
 * Causal RED before the templates/{professionals,portfolio}/styles.css
 * fixes, GREEN after.
 *
 * The long name is set in the config published through the API (the form
 * editor that typed it in was removed 2026-10-28).
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-templates-zoom-overflow.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { startHarness, publishConfig } = require('./lib/old-template-live.js');

const ROOT = path.resolve(__dirname, '../..');

const LONG_NAMES = {
  professionals: 'Cabinet de Avocatură și Consultanță Juridică Specializată în Drept Comercial',
  portfolio: 'Atelier de Înfrumusețare și Îngrijire Personală Ivoire Deluxe București',
};

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

async function publishWithLongName(H, templateId, longName) {
  const { liveUrl } = await H.publish(templateId, publishConfig(templateId, (cfg) => {
    if (longName) cfg.business.name = longName;
  }), { slug: 'wave8-zoom-' + templateId + '-' + Date.now() });
  return liveUrl;
}

async function checkNoZoomOverflow(browser, liveUrl) {
  const live = await browser.newPage();
  live.setDefaultTimeout(30000);
  await live.setViewportSize({ width: 390, height: 844 });
  await live.goto(liveUrl, { waitUntil: 'networkidle' });
  if (await live.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await live.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await live.waitForTimeout(300);
  await live.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await live.waitForTimeout(300);

  const before = await live.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  await live.evaluate(() => { window.scrollTo(9999, 0); });
  await live.waitForTimeout(150);
  await live.mouse.wheel(500, 0);
  await live.waitForTimeout(150);
  const scrollXAfter = await live.evaluate(() => window.scrollX);

  await live.close();
  return { ...before, scrollXAfter };
}

test('wave8 zoom overflow: professionals stays scroll-free at 200% zoom / 390px with a long business name', async (t) => {
  const H = await startHarness('wave8-zoom-pr');

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const liveUrl = await publishWithLongName(H, 'professionals', LONG_NAMES.professionals);
    const result = await checkNoZoomOverflow(browser, liveUrl);

    assert.ok(
      result.scrollWidth <= result.clientWidth + 2,
      'professionals: scrollWidth (' + result.scrollWidth + ') must not exceed clientWidth (' + result.clientWidth + ') at 200% zoom / 390px'
    );
    assert.ok(
      result.scrollXAfter <= 2,
      'professionals: the page must not actually be scrollable sideways — scrollX reached ' + result.scrollXAfter + ' after scrollTo+wheel'
    );
  } finally {
    await browser.close();
    await H.close();
  }
});

test('wave8 zoom overflow: portfolio stays scroll-free at 200% zoom / 390px with a long business name', async (t) => {
  const H = await startHarness('wave8-zoom-pf');

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const liveUrl = await publishWithLongName(H, 'portfolio', LONG_NAMES.portfolio);
    const result = await checkNoZoomOverflow(browser, liveUrl);

    assert.ok(
      result.scrollWidth <= result.clientWidth + 2,
      'portfolio: scrollWidth (' + result.scrollWidth + ') must not exceed clientWidth (' + result.clientWidth + ') at 200% zoom / 390px'
    );
    assert.ok(
      result.scrollXAfter <= 2,
      'portfolio: the page must not actually be scrollable sideways — scrollX reached ' + result.scrollXAfter + ' after scrollTo+wheel'
    );
  } finally {
    await browser.close();
    await H.close();
  }
});

test('wave8 zoom overflow: product-menu contact chips carry the same defensive overflow-wrap as the other two templates', () => {
  // Static check only (see file comment): this preset's Instagram/Facebook
  // labels are short and not derived from the business name, so a live
  // pass could not itself force a long enough token through .pm-link to
  // reproduce overflow — but the CSS class is shared verbatim with
  // portfolio's .pf-row/.contact-item, which COULD (and did) reproduce it,
  // so product-menu carries the identical latent risk and gets the
  // identical preventive fix.
  const css = fs.readFileSync(path.join(ROOT, 'templates/product-menu/styles.css'), 'utf8');
  const ruleMatch = css.match(/\.pm-link,\s*\.contact-item\s*\{([^}]*)\}/);
  assert.ok(ruleMatch, '.pm-link, .contact-item rule must exist in templates/product-menu/styles.css');
  const body = ruleMatch[1];
  assert.match(body, /overflow-wrap:\s*break-word/, '.pm-link/.contact-item must allow a long unbreakable token to wrap');
  assert.match(body, /max-width:\s*100%/, '.pm-link/.contact-item must not force a chip wider than its container');
});
