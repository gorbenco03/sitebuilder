'use strict';
/**
 * Wave5 desserdirina — no horizontal scroll at 200% zoom in the photo gallery
 * (audit medium #30, accessibility / WCAG 1.4.10 Reflow).
 *
 * Root cause: collage.js spaced scattered photos with
 *   Math.max(40, Math.min(maxSpacing, fitSpacing))
 * — a hard 40px floor that could force the row of photos WIDER than the deck
 * itself on a narrow/zoomed viewport, bleeding the absolutely-positioned
 * photos past the section (and, without a horizontal clip on the section,
 * past the page). Fix: drop the floor to 0 (photos may overlap more tightly,
 * but the row can never exceed the deck width) and add a defensive
 * `overflow-x: clip` on .gallery-section.
 *
 * "200% zoom" is emulated the standard way automated WCAG 1.4.10 checks do it:
 * a browser's page zoom (Ctrl/Cmd+, NOT OS/pinch optical zoom, which does not
 * reflow) shrinks the effective CSS viewport, so 200% zoom on a W-px window
 * lays out identically to a W/2 px viewport at 100%. We check several
 * realistic window widths, both native and halved, spanning the desktop
 * scatter layout and the mobile masonry layout.
 *
 * Note: body already had `overflow-x: hidden` since this template's original
 * commit, which already prevents a page-level scrollbar in every viewport
 * this suite could construct (including a synthetic 40-photo category at the
 * exact viewport where the old JS's 40px spacing floor forced photos wider
 * than their deck). The fixes below are still applied as real, verifiable
 * hardening against that specific overflow class — see HANDOFF-desserdirina.md
 * for the full investigation notes on why the literal audit repro could not
 * be reproduced headlessly.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path).
 *
 * Run: node bot/test/wave5-desserdirina-zoom-reflow.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite, serveDir, loadPlaywright, TEMPLATE_DIR } = require('./wave5-desserdirina-helpers.js');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

const EVIDENCE_DIR = path.join(TEMPLATE_DIR, '..', '..', '04-QA-Evidence', 'Wave5-desserdirina');

// Real browser page-zoom (Ctrl/Cmd+, the mechanism DevTools' zoom control uses,
// as opposed to OS/pinch optical zoom which does NOT reflow) shrinks the
// effective CSS viewport: 200% zoom on a W-px-wide window lays out exactly
// like a W/2 px viewport at 100%. This is also the standard technique for
// automating WCAG 1.4.10 Reflow checks (its own understanding docs define
// "400% zoom of a 1280px design" as equivalent to testing a 320px viewport).
// We check a spread of realistic window widths, at both their native size and
// halved (= 200% zoom), including widths where the scatter/collage desktop
// layout is still active post-halving (>768px effective width).
const WIDTHS = [1920, 1440, 1024, 390];

async function measureOverflowAcrossWidths(dir) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 1000 } });
    await page.goto(base + '/index.html', { waitUntil: 'networkidle', timeout: 30000 });
    for (const w of WIDTHS) {
      for (const factor of [1, 2]) { // 1 = 100% zoom, 2 = 200% zoom (halved viewport)
        const width = Math.round(w / factor);
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(350); // let collage.js's resize handler + IO fire
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        results.push({ nativeWidth: w, zoomFactor: factor, effectiveWidth: width, ...metrics });
      }
    }
    // Evidence screenshot at the 200%-zoom-equivalent of a common desktop width.
    await page.setViewportSize({ width: Math.round(1440 / 2), height: 900 });
    await page.waitForTimeout(300);
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'zoom-200pct-desktop-1440.png'), fullPage: true });
  } finally {
    await browser.close();
    await close();
  }
  return results;
}

(async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await check('static: collage.js no longer has a hard spacing floor above 0', () => {
    const js = fs.readFileSync(path.join(TEMPLATE_DIR, 'collage.js'), 'utf8');
    assert.doesNotMatch(js, /Math\.max\(40,/, 'the 40px spacing floor must be removed (it could force overflow)');
    assert.match(js, /Math\.max\(0,/, 'spacing floor should be 0 (never forces the row wider than the deck)');
  });

  await check('static: .gallery-section has a defensive overflow-x clip', () => {
    const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8');
    const rule = css.match(/\.gallery-section\s*\{([^}]*)\}/)[1];
    assert.match(rule, /overflow-x:\s*clip/);
  });

  await check('RED (pre-Wave5 / HEAD): the old spacing formula has the 40px hard floor', () => {
    const js = require('child_process')
      // Pinned, not HEAD: once this fix merged, HEAD stopped having the bug
      // and this check started failing for the wrong reason. Override with
      // HIDOOK_BEFORE_REF.
      .execFileSync('git', ['-C', TEMPLATE_DIR, 'show',
        (process.env.HIDOOK_BEFORE_REF || '8a13c19') + ':templates/desserdirina/collage.js'], { encoding: 'utf8' })
      .toString();
    assert.match(js, /Math\.max\(40,/, 'expected the pre-fix file to still have the 40px floor (the bug)');
  });

  await check('GREEN (current): no horizontal overflow at 100% or 200% zoom, across desktop + mobile widths', async () => {
    const after = buildSite({ state: 'after' });
    const results = await measureOverflowAcrossWidths(after.dir);
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'zoom-reflow-metrics.json'), JSON.stringify(results, null, 2));
    for (const r of results) {
      assert.ok(
        r.scrollWidth <= r.clientWidth + 1, // +1px rounding tolerance
        `overflow at native=${r.nativeWidth} zoom=${r.zoomFactor}x (effective ${r.effectiveWidth}px): scrollWidth=${r.scrollWidth} > clientWidth=${r.clientWidth}`
      );
    }
  });

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK wave5-desserdirina-zoom-reflow');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
