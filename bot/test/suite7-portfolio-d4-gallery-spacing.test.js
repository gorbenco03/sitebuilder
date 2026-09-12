'use strict';
/**
 * bot/test/suite7-portfolio-d4-gallery-spacing.test.js — S7-3 / D4.
 *
 * Client preference (design finding, not a functional bug): more breathing
 * room between gallery photos — at a tight gap, on a client-chosen section
 * colour, adjacent photos read as one fused mass rather than separate framed
 * shots — and slightly smaller photos as a result of that wider gap.
 *
 * This measures the REAL rendered gap between two adjacent photos in the
 * same gallery row (via getBoundingClientRect, not the source gap: value —
 * a declared gap is meaningless if grid track sizing eats into it) at
 * 1440/768/390, confirms it grew from the shipped baseline, confirms no
 * horizontal scroll appeared at any of the three widths, and confirms every
 * gallery photo still renders at its declared aspect-ratio (the CLS-safety
 * width/height attributes must not have silently overridden it).
 *
 * Run: node --experimental-sqlite --test bot/test/suite7-portfolio-d4-gallery-spacing.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSite, serveDir, loadPlaywright } = require('./wave10-portfolio-helpers.js');

const BEFORE_REF = process.env.HIDOOK_S73_BEFORE_REF || '216ef0c4d9955084c2593613f2d1817348446b24';
const WIDTHS = [1440, 768, 390];
const MIN_GAP_PX = 16; // "~20px" target, with slack for sub-pixel rendering

async function measureAt(browser, dir, width) {
  const { base, close } = await serveDir(dir);
  try {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
      await page.locator('#hb-cookie-accept').click().catch(() => {});
    }
    await page.waitForTimeout(200);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    const gap = await page.evaluate(() => {
      const deck = document.querySelector('.collage-deck');
      if (!deck) return null;
      const items = Array.from(deck.querySelectorAll(':scope > .collage-photo'));
      // Find two items on the same row (same top) to measure the horizontal gap.
      for (let i = 0; i < items.length - 1; i++) {
        const a = items[i].getBoundingClientRect();
        const b = items[i + 1].getBoundingClientRect();
        if (Math.abs(a.top - b.top) < 1 && b.left > a.left) {
          return b.left - a.right;
        }
      }
      return null;
    });

    const aspectViolations = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll('.collage-photo img')) {
        const cs = getComputedStyle(img);
        const ratio = cs.aspectRatio;
        if (!ratio || ratio === 'auto') continue;
        const r = img.getBoundingClientRect();
        if (r.width < 20 || r.height < 5) continue;
        const parts = ratio.split('/').map((n) => parseFloat(n));
        if (parts.length !== 2 || !parts[1]) continue;
        const expected = r.width / (parts[0] / parts[1]);
        if (Math.abs(expected - r.height) > 3) out.push({ rendered: `${r.width}x${r.height}`, expectedHeight: expected });
      }
      return out;
    });

    await page.close();
    return { overflow, gap, aspectViolations };
  } finally {
    await close();
  }
}

test('gallery gap widened, no horizontal overflow, aspect-ratio still honoured at 1440/768/390', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const { dir } = buildSite({ state: 'after', presetIndex: 0 });
    for (const width of WIDTHS) {
      const { overflow, gap, aspectViolations } = await measureAt(browser, dir, width);
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `${width}px: horizontal overflow — scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`
      );
      assert.ok(gap !== null, `${width}px: could not measure a two-photo row in .collage-deck`);
      assert.ok(gap >= MIN_GAP_PX, `${width}px: measured gallery gap ${gap.toFixed(1)}px, expected >= ${MIN_GAP_PX}px`);
      assert.equal(
        aspectViolations.length, 0,
        `${width}px: ${aspectViolations.length} photo(s) not honouring their declared aspect-ratio: ${JSON.stringify(aspectViolations)}`
      );
    }
  } finally {
    await browser.close();
  }
});

test('red-first: the pre-fix template (pinned ref) has a narrower gap than the fix', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const { dir } = buildSite({ state: 'before', ref: BEFORE_REF, presetIndex: 0 });
    const { gap } = await measureAt(browser, dir, 1440);
    assert.ok(gap !== null, 'could not measure a two-photo row in the pre-fix template');
    assert.ok(
      gap < MIN_GAP_PX,
      `expected the pre-fix template's gap (${gap.toFixed(1)}px) to be under ${MIN_GAP_PX}px — either BEFORE_REF is wrong or this was already fixed there`
    );
  } finally {
    await browser.close();
  }
});
