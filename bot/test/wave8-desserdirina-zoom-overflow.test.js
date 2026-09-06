'use strict';
/**
 * Wave8 desserdirina — MEDIUM finding #3: 42% horizontal overflow at 200%
 * zoom (desktop 1440px), far worse than every other template's "a few
 * percent". Also present at 390px mobile.
 *
 * Root cause: `.gallery-section` sized itself with `width: min(1320px,
 * 94vw)` / `max-width: 100vw`. `vw` is defined against the browser's real
 * viewport and does NOT shrink under the CSS `zoom` property — the standard
 * headless-browser stand-in for real pinch/ctrl-zoom (Chromium's
 * `document.documentElement.style.zoom` scales rendering without touching
 * viewport-unit math). So at `zoom: 2` the section kept computing ~94% of
 * the FULL, un-zoomed viewport, and that box then got rendered at 2x on top
 * of that — nearly doubling its effective width and blowing past the
 * viewport by a wide margin. `.gallery-section`'s parent (`.main-content`)
 * is a plain, unconstrained block that already reflows correctly under
 * zoom, so switching to `%` (94%, 100%) makes the section track its actual
 * available width instead of the raw viewport.
 *
 * NOTE on methodology: this repo's OTHER zoom oracle
 * (wave5-desserdirina-zoom-reflow.test.js) emulates 200% zoom by halving the
 * real viewport width, which is the more accurate WCAG 1.4.10 technique —
 * and does NOT reproduce this specific bug, because shrinking the viewport
 * correctly recomputes `vw` too. This oracle instead uses
 * `document.documentElement.style.zoom`, exactly the technique the re-audit
 * that flagged this finding used (and that this template's audit evidence
 * describes as "an approximation of real browser/device zoom") — the
 * `vw`-under-`zoom` mismatch only exists in that emulation, but a real site
 * still shipped it, so it is a real bug worth fixing regardless of which
 * measurement technique exposes it.
 *
 * Uses Playwright's bundled Chromium from node_modules. Reuses the
 * buildSite/serveDir harness shared with the other desserdirina oracles
 * (real build.js rendering).
 *
 * Run: node bot/test/wave8-desserdirina-zoom-overflow.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite, serveDir, loadPlaywright, TEMPLATE_DIR, ROOT } = require('./wave5-desserdirina-helpers.js');

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

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave8-desserdirina', 'zoom-overflow');
const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || 'f0f8d53';

/** Measures document scrollWidth/clientWidth at 100% then CSS `zoom: 2`, at a given viewport width. */
async function measureCssZoomOverflow(dir, width) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(base + '/index.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement.scrollWidth,
      clientWidth: document.scrollingElement.clientWidth,
    }));
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement.scrollWidth,
      clientWidth: document.scrollingElement.clientWidth,
    }));
    return { before, after };
  } finally {
    await browser.close();
    await close();
  }
}

(async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await check('static: .gallery-section no longer sizes itself with vw', () => {
    const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8');
    const rule = css.match(/\.gallery-section\s*\{([^}]*)\}/)[1];
    // Strip comments first: the fix's own explanatory comment legitimately
    // discusses "vw" in prose, which must not trip this check — only the
    // actual declared property VALUES matter here.
    const ruleNoComments = rule.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(ruleNoComments, /\bvw\b/, '.gallery-section must not use vw in a declaration (it does not shrink under the CSS zoom property)');
    assert.match(ruleNoComments, /min\(1320px,\s*94%\)/, 'expected the % equivalent width to still be present');
  });

  await check('RED (pre-fix / ' + BEFORE_REF + '): .gallery-section used vw for width/max-width', () => {
    const css = require('child_process')
      .execFileSync('git', ['-C', ROOT, 'show', BEFORE_REF + ':templates/desserdirina/styles.css'], { encoding: 'utf8' })
      .toString();
    const rule = css.match(/\.gallery-section\s*\{([^}]*)\}/)[1];
    assert.match(rule, /94vw/, 'expected the pre-fix rule to still use 94vw (the bug)');
    assert.match(rule, /max-width:\s*100vw/, 'expected the pre-fix rule to still use max-width:100vw (the bug)');
  });

  await check('RED (pre-fix / ' + BEFORE_REF + ', live via build.js): 200%-zoom overflow at 1440px and 390px', async () => {
    const beforeSite = buildSite({ state: 'before', ref: BEFORE_REF });
    const r1440 = await measureCssZoomOverflow(beforeSite.dir, 1440);
    const r390 = await measureCssZoomOverflow(beforeSite.dir, 390);
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'red-metrics.json'), JSON.stringify({ r1440, r390 }, null, 2));
    assert.ok(
      r1440.after.scrollWidth > r1440.after.clientWidth + 50,
      'expected pre-fix 1440px zoom:2 to overflow substantially, got scrollWidth=' + r1440.after.scrollWidth + ' clientWidth=' + r1440.after.clientWidth
    );
    assert.ok(
      r390.after.scrollWidth > r390.after.clientWidth + 20,
      'expected pre-fix 390px zoom:2 to overflow, got scrollWidth=' + r390.after.scrollWidth + ' clientWidth=' + r390.after.clientWidth
    );
  });

  await check('GREEN (current, live via build.js): no horizontal overflow at 200% CSS zoom, 1440px and 390px', async () => {
    const after = buildSite({ state: 'after' });
    const r1440 = await measureCssZoomOverflow(after.dir, 1440);
    const r390 = await measureCssZoomOverflow(after.dir, 390);
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'green-metrics.json'), JSON.stringify({ r1440, r390 }, null, 2));
    assert.ok(
      r1440.after.scrollWidth <= r1440.after.clientWidth + 2,
      '1440px @ 200% zoom still overflows: scrollWidth=' + r1440.after.scrollWidth + ' clientWidth=' + r1440.after.clientWidth
    );
    assert.ok(
      r390.after.scrollWidth <= r390.after.clientWidth + 2,
      '390px @ 200% zoom still overflows: scrollWidth=' + r390.after.scrollWidth + ' clientWidth=' + r390.after.clientWidth
    );
  });

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK wave8-desserdirina-zoom-overflow');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
