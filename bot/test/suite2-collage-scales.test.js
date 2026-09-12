'use strict';
/**
 * bot/test/suite2-collage-scales.test.js
 *
 * The desserdirina "Creațiile noastre" photo collage stops being usable once
 * a category holds more than a handful of photos.
 *
 * templates/desserdirina/collage.js, compute(): the gap between photos is
 * `fitSpacing = (deckW - photoW) / (n - 1)`, clamped only from above (never
 * wider than ~1.02x a photo) and floored at 0 — there is no lower bound. As
 * n grows, fitSpacing shrinks toward 0 and the photos stack almost directly
 * on top of one another. Measured on the real rendered page with 16 photos
 * (4 demo + 12 added, a realistic "owner filled in their gallery" scenario):
 * 54 overlapping pairs, up to 79% of one photo's area covered by another
 * (04-QA-Evidence/QA-Explorare-2026-09-12/reports/03-images-logo-gallery.md,
 * defect D3/V4). The code comment even says this is deliberate — a trade-off
 * to avoid horizontal overflow — but never caps how bad the overlap itself
 * is allowed to get.
 *
 * This measures actual `.collage-photo` bounding boxes on the real rendered
 * page (not the spacing formula in isolation) with 12 photos in one
 * category and requires no pair to overlap more than 15% of either photo's
 * own area.
 *
 * Uses buildStaticSiteTree() — same renderer bot/webpublish.js runs on a
 * real publish (see suite2-logo-standard-size.test.js for the same choice).
 *
 * Run: node --experimental-sqlite --test bot/test/suite2-collage-scales.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const MAX_OVERLAP_FRACTION = 0.15;
const PHOTO_COUNT = 12;

// Demo photos already shipped in the desserdirina template — reusing them
// (cycled) keeps this oracle self-contained (no fixture files, no network),
// and overlap is a purely geometric property of the layout, independent of
// which actual image bytes sit inside each box.
const DEMO_IMAGES = [
  ['images/torturi-1.jpg', 'Foto test 1'],
  ['images/torturi-2.jpg', 'Foto test 2'],
  ['images/torturi-3.jpg', 'Foto test 3'],
  ['images/torturi-4.jpg', 'Foto test 4'],
  ['images/catering-1.jpg', 'Foto test 5'],
  ['images/catering-2.jpg', 'Foto test 6'],
  ['images/placinte-1.jpg', 'Foto test 7'],
  ['images/cupcakes-1.jpg', 'Foto test 8'],
  ['images/cupcakes-2.jpg', 'Foto test 9'],
];

function buildSiteWithPhotoCount(count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite2-collage-'));
  const cfg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', 'desserdirina', 'presets.json'), 'utf8')
  ).presets[0].config;
  const photos = [];
  for (let i = 0; i < count; i++) {
    const [src, alt] = DEMO_IMAGES[i % DEMO_IMAGES.length];
    photos.push({ src, alt: alt + ' #' + i });
  }
  cfg.categories = [{ title: 'Torturi', blurb: 'Categorie de test', photos }];
  siteExport.buildStaticSiteTree({ templateId: 'desserdirina', config: cfg, images: [], siteDir: dir });
  return dir;
}

async function measureOverlaps(browser, dir, viewport) {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
    // collage.js positions photos synchronously on load (DSD-04), no scroll
    // needed — a short settle covers the transition/transform application.
    await page.waitForTimeout(500);
    return await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.collage-photo')].map((el) => el.getBoundingClientRect());
      const pairs = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          const interArea = ix * iy;
          if (interArea <= 0) continue;
          const aArea = a.width * a.height, bArea = b.width * b.height;
          const frac = interArea / Math.min(aArea, bArea);
          pairs.push({ i, j, frac });
        }
      }
      return { count: boxes.length, pairs };
    });
  } finally {
    await page.close();
  }
}

test('a 12-photo category never overlaps more than 15% of a photo\'s area', async () => {
  const browser = await chromium.launch({ headless: true });
  const dir = buildSiteWithPhotoCount(PHOTO_COUNT);
  try {
    const { count, pairs } = await measureOverlaps(browser, dir, { width: 1440, height: 1000 });
    assert.strictEqual(count, PHOTO_COUNT, 'expected all 12 photos to be rendered as .collage-photo');

    const bad = pairs.filter((p) => p.frac > MAX_OVERLAP_FRACTION);
    const worst = pairs.reduce((m, p) => Math.max(m, p.frac), 0);
    console.log(`  12 photos: ${pairs.length} overlapping pair(s), worst ${(worst * 100).toFixed(1)}%`);
    assert.deepEqual(
      bad.map((p) => `pair (${p.i},${p.j}): ${(p.frac * 100).toFixed(1)}% overlap`),
      [],
      `${bad.length} of ${pairs.length} overlapping pairs exceed the 15% floor (worst ${(worst * 100).toFixed(1)}%)`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await browser.close();
  }
});
