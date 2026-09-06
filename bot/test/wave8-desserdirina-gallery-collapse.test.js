'use strict';
/**
 * Wave8 desserdirina — HIGH finding #2: the photo gallery renders as a tiny,
 * cramped collage instead of a normal-width grid, on the one template whose
 * whole value proposition is photography.
 *
 * Root cause (confirmed by hand in a real browser before this fix, see
 * HANDOFF/report for the full trace): collage.js positioned each category's
 * photos via CSS custom properties (--x/--y) that default to 0 in the base
 * `.collage-photo` rule, and only set them to their real, spread-out values
 * from an IntersectionObserver callback that fires after the deck has
 * scrolled ~20% into view (plus a 150ms setTimeout). Until that observer
 * fires, EVERY photo in a category renders stacked exactly on top of the
 * others at the deck's center — a single overlapping pile the width of ONE
 * photo (`clamp(200px, 20vw, 280px)`), not a grid — and a click can only
 * ever reach whichever photo the z-index stack put on top.
 *
 * This is not only a slow-scroll race: `page.screenshot({ fullPage: true })`
 * — the exact technique most QA/audit tooling (including the re-audit that
 * flagged this finding) uses to capture a full page — does NOT fire a real
 * scroll event in Chromium, so the observer never runs before the capture.
 * The "GREEN (live, no scroll)" check below reproduces that literally: it
 * loads the freshly published live site and reads photo geometry WITHOUT
 * ever scrolling, matching how the defect was originally caught.
 *
 * Fix: scatter the photos into position immediately (synchronously, right
 * after layout, for every visitor — same as the reduced-motion path already
 * did), instead of gating the very first paint behind a scroll-triggered
 * observer. The subtle "photos spring into place" flourish is lost; a
 * silently-collapsed, mostly-unclickable gallery is not an acceptable trade
 * for it.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path). Uses the same buildSite/serveDir harness as the other
 * desserdirina oracles in this suite (real build.js rendering, no product
 * code touched to test it).
 *
 * Run: node bot/test/wave8-desserdirina-gallery-collapse.test.js
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

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave8-desserdirina', 'gallery-collapse');

// Pinned, not HEAD: once this fix merges, HEAD stops having the bug and this
// check would start failing for the wrong reason. Override with
// HIDOOK_BEFORE_REF if this wave's starting commit changes.
const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || 'f0f8d53';

/**
 * Loads a built desserdirina site and reads the gallery's photo geometry
 * WITHOUT ever performing a real scroll (mirrors both a `fullPage`
 * screenshot and any visitor who has not yet scrolled that far).
 */
async function measureNoScroll(dir) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/index.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(400); // let any load-time JS settle, but never scroll
    const geometry = await page.evaluate(() => {
      const deck = document.querySelector('.collage-deck');
      if (!deck) return null;
      const photos = Array.from(deck.querySelectorAll('.collage-photo'));
      const xs = photos.map((p) => p.getBoundingClientRect().left);
      return {
        photoCount: photos.length,
        xSpread: photos.length ? Math.max(...xs) - Math.min(...xs) : 0,
        anyPlaced: photos.some((p) => p.classList.contains('placed')),
      };
    });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    return geometry;
  } finally {
    await browser.close();
    await close();
  }
}

(async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await check('static: collage.js positions photos immediately, not gated behind a scroll observer', () => {
    const js = fs.readFileSync(path.join(TEMPLATE_DIR, 'collage.js'), 'utf8');
    assert.doesNotMatch(
      js,
      /new IntersectionObserver/,
      'the initial photo placement must not depend on a scroll-triggered IntersectionObserver'
    );
    assert.match(
      js,
      /compute\(\);\s*\n(?:[^\n]*\n)*?\s*apply\(true\);/,
      'apply(true) (real --x/--y positions) must run unconditionally right after compute()'
    );
  });

  await check('RED (pre-fix / ' + BEFORE_REF + '): old collage.js gated real positions behind IntersectionObserver', () => {
    const js = require('child_process')
      .execFileSync('git', ['-C', ROOT, 'show', BEFORE_REF + ':templates/desserdirina/collage.js'], { encoding: 'utf8' })
      .toString();
    assert.match(js, /new IntersectionObserver/, 'expected the pre-fix file to still gate scatter behind IntersectionObserver (the bug)');
    assert.match(js, /apply\(false\)/, 'expected the pre-fix file\'s initial call to be apply(false) (positions left at 0)');
  });

  await check('MECHANISM (isolated fixture, real browser): pre-fix collage.js leaves photos collapsed with no scroll', async () => {
    const oldJs = require('child_process')
      .execFileSync('git', ['-C', ROOT, 'show', BEFORE_REF + ':templates/desserdirina/collage.js'], { encoding: 'utf8' })
      .toString();
    const geometry = await measureWithScript(oldJs);
    assert.strictEqual(geometry.anyPlaced, false, 'pre-fix: no photo should have the "placed" class before any scroll');
    assert.ok(geometry.xSpread < 5, 'pre-fix: photos should be collapsed on top of each other (xSpread ~0), got ' + geometry.xSpread);
  });

  await check('MECHANISM (isolated fixture, real browser): current collage.js spreads photos with no scroll', async () => {
    const newJs = fs.readFileSync(path.join(TEMPLATE_DIR, 'collage.js'), 'utf8');
    const geometry = await measureWithScript(newJs);
    assert.strictEqual(geometry.anyPlaced, true, 'current: photos must be placed immediately, no scroll required');
    assert.ok(geometry.xSpread > 300, 'current: photos should be spread across the deck (xSpread > 300px), got ' + geometry.xSpread);
  });

  await check('GREEN (live site via build.js, no scroll ever performed): gallery renders as a spread grid, not a collapsed pile', async () => {
    const after = buildSite({ state: 'after' });
    const geometry = await measureNoScroll(after.dir);
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'no-scroll-geometry.json'), JSON.stringify(geometry, null, 2));
    assert.ok(geometry, 'gallery deck must be present');
    assert.ok(geometry.photoCount >= 1, 'gallery must have at least one photo to test');
    assert.strictEqual(geometry.anyPlaced, true, 'photos must be placed without any scroll');
    assert.ok(
      geometry.xSpread > 100 || geometry.photoCount === 1,
      'photos must be spread out (xSpread=' + geometry.xSpread + ') instead of collapsed, unless there is only 1 photo'
    );
  });

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK wave8-desserdirina-gallery-collapse');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Builds a minimal, isolated HTML fixture reproducing the collage DOM shape
 * (one `.collage-deck` with 4 `.collage-photo` figures) plus the CSS rules
 * that matter for this defect, runs `scriptSrc` (either the old or current
 * collage.js content) against it in a real browser, and returns geometry
 * WITHOUT ever scrolling — isolating the JS mechanism from the rest of the
 * template (styling, fonts, other sections) so the red/green comparison is
 * about this bug specifically, not incidental page content.
 */
async function measureWithScript(scriptSrc) {
  const { chromium } = loadPlaywright();
  const html = `<!doctype html><html><head><style>
    body { margin: 0; height: 3000px; } /* tall page: deck starts off-screen, like the real template */
    .collage-stage { display: flex; justify-content: center; margin-top: 2000px; }
    .collage-deck { position: relative; width: 1000px; height: 400px; }
    .collage-photo {
      position: absolute; left: 50%; top: 20px; width: 220px; height: 300px; margin: 0;
      --x: 0px; --y: 0px; --r: 0deg; --dx: 0px; --dy: 0px;
      transform: translate(calc(-50% + var(--x) + var(--dx)), calc(var(--y) + var(--dy))) rotate(var(--r));
    }
    .collage-photo img { width: 100%; height: 100%; }
  </style></head><body>
    <div class="collage-stage"><div class="collage-deck">
      <figure class="collage-photo"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7"></figure>
      <figure class="collage-photo"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7"></figure>
      <figure class="collage-photo"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7"></figure>
      <figure class="collage-photo"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7"></figure>
    </div></div>
    <script>${scriptSrc}</script>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(400); // never scroll
    return await page.evaluate(() => {
      const photos = Array.from(document.querySelectorAll('.collage-photo'));
      const xs = photos.map((p) => p.getBoundingClientRect().left);
      return {
        xSpread: photos.length ? Math.max(...xs) - Math.min(...xs) : 0,
        anyPlaced: photos.some((p) => p.classList.contains('placed')),
      };
    });
  } finally {
    await browser.close();
  }
}
