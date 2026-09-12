'use strict';
/**
 * bot/test/suite7-portfolio-m9-pricelist-contrast.test.js — S7-3 / M9.
 *
 * The detailed price list (`.pf-price`) and the online-booking intro
 * (`#appointment .pf-kicker/.pf-display/.pf-copy`) sit on the page's --paper
 * background, which is driven by `theme.cream` — a colour the client picks
 * freely from the builder's colour popover (background swatch), not limited
 * to a light neutral. The list's divider/leader/value colours and the
 * appointment section's kicker/copy were tuned only for the shipped
 * near-white paper/snow/blush defaults (ink-alpha colours, see the styles.css
 * comment on `--mute`), so a saturated `theme.cream` pushed them under WCAG
 * AA — confirmed measured: with `theme.cream = #e8720c` (orange), the row
 * divider measured ~1.15:1, the price value ~2.97:1, and even solid-ink
 * `.pf-price__name` ~4.16:1 — all under the 4.5:1 (text) / 3:1 (dividers)
 * floor. Some of this range (a background lightness band roughly between
 * "safe for dark ink" and "safe for light text") cannot be fixed by picking
 * a different flat ink/white colour at all: neither solid black nor solid
 * white text clears WCAG AA against it. So a controlled backdrop — a
 * translucent panel mixed toward --snow rather than toward --paper — is
 * used instead, keeping the panel light even in the worst case (the section
 * background is pure black), and text/border colours are mixed against
 * --ink calibrated to hold their ratio against that worst case.
 *
 * This checks the REAL rendered/composited colours (walking every ancestor
 * background-color, same technique as wave5-portfolio-a11y.test.js) at 3
 * saturated `theme.cream` values taken from the product's own colour
 * palette (builder/app.js COLOR_PRESETS — normally offered for the accent
 * colour, reused here as a stand-in "saturated colour the client can pick"
 * since the background swatch itself has no curated palette), not just the
 * one colour the original finding measured.
 *
 * Before this fix, `.pf-price` had no background of its own (it inherited
 * --paper straight) and `.pf-price__row`/`.pf-price__dots` used a bare
 * ~10-25% ink-alpha border, which measurably fails even on the DEFAULT
 * preset background (~1.19:1 / 1.58:1, both under the 3:1 divider floor) —
 * this oracle also locks that in, not only the saturated-theme case.
 *
 * Run: node --experimental-sqlite --test bot/test/suite7-portfolio-m9-pricelist-contrast.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSite, serveDir, loadPlaywright, ROOT } = require('./wave10-portfolio-helpers.js');

// Pinned to the commit this task started from (pre-fix) so this stays a
// faithful "was it ever broken" check regardless of how HEAD moves later.
const BEFORE_REF = process.env.HIDOOK_S73_BEFORE_REF || '216ef0c4d9955084c2593613f2d1817348446b24';

const THEMES = [
  { label: 'default preset', cream: null },
  { label: 'orange (original D1 finding)', cream: '#e8720c' },
  { label: 'Roz (builder/app.js COLOR_PRESETS)', cream: '#DB2777' },
  { label: 'Violet (builder/app.js COLOR_PRESETS)', cream: '#7C3AED' },
];

// Selector, CSS property, human label, minimum ratio (WCAG AA: 4.5:1 normal
// text, 3:1 large text / functional borders).
const CHECKS = [
  ['.pf-price__name', 'color', 'price row name', 4.5],
  ['.pf-price__val', 'color', 'price row value', 4.5],
  ['.pf-price__row', 'borderBottomColor', 'price row divider', 3],
  ['.pf-price__dots', 'borderBottomColor', 'price dotted leader', 3],
  ['#appointment .pf-kicker', 'color', 'appointment kicker', 4.5],
  ['#appointment .pf-display', 'color', 'appointment heading (large text)', 3],
  ['#appointment .pf-copy', 'color', 'appointment intro copy', 4.5],
];

function relLum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastOf(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseColor(str) {
  const colorFn = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/.exec(str);
  if (colorFn) {
    return {
      r: parseFloat(colorFn[1]) * 255, g: parseFloat(colorFn[2]) * 255, b: parseFloat(colorFn[3]) * 255,
      a: colorFn[4] !== undefined ? parseFloat(colorFn[4]) : 1,
    };
  }
  const m = /rgba?\(([^)]+)\)/.exec(String(str));
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
function composite(fg, bg) {
  const a = fg.a;
  return [fg.r * a + bg.r * (1 - a), fg.g * a + bg.g * (1 - a), fg.b * a + bg.b * (1 - a)];
}
async function bgLayersOf(locator) {
  return locator.evaluate((el) => {
    let node = el; const layers = [];
    while (node) { layers.push(getComputedStyle(node).backgroundColor); node = node.parentElement; }
    return layers;
  });
}
async function measure(page, selector, prop) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'attached', timeout: 5000 });
  const fgStr = await el.evaluate((n, p) => getComputedStyle(n)[p], prop);
  const bgLayers = (await bgLayersOf(el)).slice().reverse(); // outermost first (paint order)
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const layerStr of bgLayers) {
    const c = parseColor(layerStr);
    if (c && c.a > 0) bg = { r: composite(c, bg)[0], g: composite(c, bg)[1], b: composite(c, bg)[2], a: 1 };
  }
  const fg = parseColor(fgStr);
  if (!fg) return null;
  const fgOpaque = composite(fg, bg);
  return contrastOf(fgOpaque, [bg.r, bg.g, bg.b]);
}

async function runAgainst(browser, dir, presetConfig, theme) {
  if (theme.cream) {
    presetConfig.theme = presetConfig.theme || {};
    presetConfig.theme.cream = theme.cream;
    // Re-render with the overridden theme.
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presetConfig, null, 2));
    const { build } = require(require('path').join(ROOT, 'build.js'));
    build(dir);
  }
  const { base, close } = await serveDir(dir);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    const results = [];
    for (const [sel, prop, label, need] of CHECKS) {
      if (!(await page.locator(sel).count())) continue;
      const ratio = await measure(page, sel, prop);
      results.push({ sel, label, need, ratio });
    }
    await page.close();
    return results;
  } finally {
    await close();
  }
}

test('M9: price list + appointment intro clear WCAG AA on the default preset and 3 saturated theme.cream values', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    for (const theme of THEMES) {
      const { dir, presetConfig } = buildSite({ state: 'after', presetIndex: 2 }); // atelier-ivoire-ro
      const results = await runAgainst(browser, dir, presetConfig, theme);
      assert.ok(results.length > 0, `${theme.label}: no checks ran — selectors missing?`);
      for (const r of results) {
        assert.ok(
          r.ratio !== null && r.ratio >= r.need,
          `[${theme.label}] ${r.label} (${r.sel}) measured ${r.ratio === null ? 'N/A' : r.ratio.toFixed(2)}:1, need >= ${r.need}:1`
        );
      }
    }
  } finally {
    await browser.close();
  }
});

test('red-first: the pre-fix template (pinned ref) fails this same check on the ORIGINAL D1 orange value', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const { dir, presetConfig } = buildSite({ state: 'before', ref: BEFORE_REF, presetIndex: 2 });
    const results = await runAgainst(browser, dir, presetConfig, { label: 'orange (pre-fix)', cream: '#e8720c' });
    const failures = results.filter((r) => r.ratio === null || r.ratio < r.need);
    assert.ok(
      failures.length > 0,
      'expected the pre-fix template to fail at least one contrast check on orange theme.cream, but all passed — ' +
      'either the pinned BEFORE_REF is wrong or the bug was already fixed there'
    );
  } finally {
    await browser.close();
  }
});
