'use strict';
/**
 * Wave10 portfolio (Salon) — gallery grid regression gate.
 *
 * Concrete defect this guards against (ORIGINAL, still true of commit
 * 20a3a2b — see the "before" check below): a gallery category's photo count
 * is owner-editable (add/remove via the drawer's "+ Adaugă" control) and
 * this template's shipped presets never divide evenly by 3 (every category
 * has either 3 or 4 photos). At >=834px the gallery used a plain 3-column
 * CSS grid, so a 4-photo category left its 4th photo alone on a new row,
 * stranded next to two-thirds of a row of empty page background.
 *
 * SUPERSEDED FIX, SUPERSEDED HERE (feedback 2026-09-13, Suite C): Wave10's
 * own fix for that was a 6-unit sub-grid that STRETCHED the leftover
 * photo(s) to fill the row (`grid-column: span 6` + `aspect-ratio: 21/9` on
 * a lone remainder). That is exactly the NEW defect the owner reported with
 * a screenshot: adding a 4th/5th photo to the gallery rendered it as a huge
 * full-width banner under the row of three. "No empty gap in the last row"
 * and "no photo ever renders bigger than its siblings" cannot both hold
 * when a remainder is forced to fill leftover space by stretching — so this
 * file's old "after" assertion (emptyFraction < 0.03) no longer applies and
 * is REPLACED below with the invariant that supersedes it.
 *
 * CURRENT FIX (templates/portfolio/styles.css + collage.js): `.collage-deck`
 * is a single-row flex track (2-up under 834px, 3-up from 834px, never
 * wraps) — every photo, at any count, renders at the same size. A category
 * with more photos than fit on one row becomes a horizontal scroll-snap
 * carousel (real prev/next <button>s + native touch swipe) instead of
 * wrapping to a second row or stretching a leftover photo to fill it. See
 * bot/test/suite11-portfolio-gallery-uniform.test.js for the full carousel
 * contract (breakpoints, button behaviour, no page horizontal scroll); this
 * file keeps only the two checks in its own original scope: the historical
 * red-before regression proof, and (rewritten) that every shipped preset's
 * gallery photos are uniformly sized on the real rendered page.
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

/**
 * SUITE C replacement for the "after" half of this file: the current design
 * never wraps `.collage-deck` into multiple rows (it is a single-row flex
 * track that scrolls instead, see styles.css/collage.js) so `measureGalleryGaps`'s
 * "group into rows by top offset" logic no longer describes it — every item
 * shares the same top, whether or not it is currently scrolled into view.
 * What matters now: every `.collage-photo` in a deck renders at the SAME
 * width (no stretched orphan), and — when the deck doesn't fit on one row —
 * the carousel nav buttons are actually present to reach the rest.
 */
async function measureUniformity(dir, viewport) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(300); // let collage.js's initCarousel() measure overflow
    return await page.evaluate(() => {
      const stages = [...document.querySelectorAll('.collage-stage')];
      return stages.map((stage) => {
        const deck = stage.querySelector(':scope > .collage-deck');
        const items = [...deck.querySelectorAll(':scope > .collage-photo')];
        const widths = items.map((el) => el.getBoundingClientRect().width);
        const overflowing = deck.scrollWidth > deck.clientWidth + 1;
        const prev = stage.querySelector(':scope > .collage-nav--prev');
        const next = stage.querySelector(':scope > .collage-nav--next');
        return {
          count: items.length,
          maxWidth: Math.max(...widths),
          minWidth: Math.min(...widths),
          overflowing,
          navShown: !!(prev && !prev.hidden && next && !next.hidden),
        };
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

  // 2) Green-after (rewritten, Suite C): every shipped preset's gallery
  //    photos render at a uniform size — no orphan stretched to fill a
  //    partial row — and any category that doesn't fit on one row exposes
  //    working carousel nav buttons instead of silently clipping photos.
  for (const presetIndex of [0, 1, 2]) {
    await check(`after (working tree): preset ${presetIndex} — gallery photos are uniformly sized at 1440px, carousel nav present when needed`, async () => {
      const { dir } = buildSite({ state: 'after', presetIndex });
      const decks = await measureUniformity(dir, DESKTOP);
      results.after[`preset${presetIndex}`] = decks;
      for (const d of decks) {
        const spread = d.maxWidth - d.minWidth;
        assert.ok(
          spread <= 1,
          `category with ${d.count} photos: widths range ${d.minWidth.toFixed(1)}-${d.maxWidth.toFixed(1)}px (spread ${spread.toFixed(1)}px) — a photo is stretched relative to its siblings`
        );
        if (d.overflowing) {
          assert.ok(d.navShown, `category with ${d.count} photos overflows its row but the carousel nav buttons are not shown`);
        }
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
