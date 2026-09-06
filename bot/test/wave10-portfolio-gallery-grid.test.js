'use strict';
/**
 * Wave10 portfolio (Salon) — gallery grid regression gate.
 *
 * Concrete defect this guards against: a gallery category's photo count is
 * owner-editable (add/remove via the drawer's "+ Adaugă" control) and this
 * template's shipped presets never divide evenly by 3 (every category has
 * either 3 or 4 photos). At >=834px the gallery used a plain 3-column CSS
 * grid, so a 4-photo category left its 4th photo alone on a new row,
 * stranded next to two-thirds of a row of empty page background — confirmed
 * by rendering this exact template and comparing it side-by-side against
 * local-service/product-menu (04-QA-Evidence/Wave10-portfolio/ has the
 * before/after captures). This was the single most "looks unfinished" thing
 * found on the page.
 *
 * The fix (templates/portfolio/styles.css, `.collage-deck` at >=834px) is a
 * 6-unit sub-grid where a trailing remainder of 1 spans the full row (a wide
 * "feature" shot) and a remainder of 2 splits the row evenly between them —
 * either way, the last row's items always sum to the full row width, so
 * there is never a large empty gap. This test proves that geometrically, on
 * the real rendered page (not by reading the CSS source), for every shipped
 * preset, and proves the *previous* commit (20a3a2b) actually had the gap —
 * i.e. this is a real red-before/green-after regression test, not a
 * tautology that would pass no matter what the CSS says.
 *
 * Run: node --experimental-sqlite bot/test/wave10-portfolio-gallery-grid.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite, serveDir, loadPlaywright } = require('./wave10-portfolio-helpers.js');

const EVIDENCE_DIR = path.resolve(__dirname, '../../04-QA-Evidence/Wave10-portfolio');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed += 1;
    console.error('FAIL', name, '-', e.message);
  }
}

/**
 * For every `.collage-deck` on the page, compute how much of the LAST row's
 * width is actually covered by grid items vs left empty. Returns, per deck,
 * the count of photos and the fraction of the last row's width that is
 * empty (0 = fully covered, ~0.66 = the pre-fix "lone thumbnail" defect).
 */
async function measureGalleryGaps(dir, viewport) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    // Force lazy images to decode/layout across the whole page.
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total; y += 600) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    return await page.evaluate(() => {
      const decks = [...document.querySelectorAll('.collage-deck')];
      return decks.map((deck) => {
        const items = [...deck.children];
        const deckRect = deck.getBoundingClientRect();
        const rects = items.map((el) => el.getBoundingClientRect());
        // Group items into rows by their top offset (rounded, to absorb
        // sub-pixel differences between items in the same visual row).
        const rows = [];
        for (const r of rects) {
          const top = Math.round(r.top);
          let row = rows.find((rw) => Math.abs(rw.top - top) < 2);
          if (!row) { row = { top, rects: [] }; rows.push(row); }
          row.rects.push(r);
        }
        rows.sort((a, b) => a.top - b.top);
        const lastRow = rows[rows.length - 1];
        const coveredWidth = lastRow.rects.reduce((sum, r) => sum + r.width, 0);
        const emptyFraction = 1 - coveredWidth / deckRect.width;
        return { count: items.length, rowCount: rows.length, lastRowItems: lastRow.rects.length, emptyFraction };
      });
    });
  } finally {
    await browser.close();
    await close();
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const DESKTOP = { width: 1440, height: 1000 };
  const results = { before: {}, after: {} };

  // 1) Red-before: prove the pre-fix commit actually had the gap, so this
  //    test is a genuine regression guard and not a tautology.
  await check('before (20a3a2b): at least one gallery category has a large empty gap in its last row', async () => {
    const { dir } = buildSite({ state: 'before', presetIndex: 0 });
    const gaps = await measureGalleryGaps(dir, DESKTOP);
    results.before.preset0 = gaps;
    const worst = Math.max(...gaps.map((g) => g.emptyFraction));
    assert.ok(worst > 0.5, `expected the pre-fix template to have a >50% empty last row somewhere, worst was ${worst}`);
  });

  // 2) Green-after: every shipped preset, every category's last row is
  //    (near-)fully covered, at desktop width where the 3-column grid (and
  //    therefore the remainder problem) applies.
  for (const presetIndex of [0, 1, 2]) {
    await check(`after (working tree): preset ${presetIndex} has no empty gallery row gap at 1440px`, async () => {
      const { dir } = buildSite({ state: 'after', presetIndex });
      const gaps = await measureGalleryGaps(dir, DESKTOP);
      results.after[`preset${presetIndex}`] = gaps;
      for (const g of gaps) {
        // A few px of gap rounding/border-radius is fine; anything under ~3%
        // of the row width is not a visible "empty column" the way >60% was.
        assert.ok(
          g.emptyFraction < 0.03,
          `category with ${g.count} photos left ${(g.emptyFraction * 100).toFixed(1)}% of its last row empty`
        );
      }
    });
  }

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'gallery-grid-gaps.json'), JSON.stringify(results, null, 2));

  if (failed) {
    console.error(`\nwave10-portfolio-gallery-grid.test.js: ${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nwave10-portfolio-gallery-grid.test.js: all checks passed');
}

main().catch((e) => {
  console.error('FAIL wave10-portfolio-gallery-grid:', e.stack || e.message);
  process.exit(1);
});
