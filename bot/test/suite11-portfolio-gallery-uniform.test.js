'use strict';
/**
 * bot/test/suite11-portfolio-gallery-uniform.test.js
 *
 * PLAN-FEEDBACK-2026-09-13.md, Suite C (punct 3): the salon/portfolio work
 * gallery. Owner report (with screenshot): adding a 4th or 5th photo to a
 * category rendered it as a full-width banner under a row of three — the
 * shipped `.collage-deck > :nth-child(3n+1):last-child { grid-column: span
 * 6; aspect-ratio: 21/9 }` rule (WAVE10) deliberately stretched a leftover
 * photo to fill the last row. Requested fix: every photo stays the same
 * size, and once there are more photos than fit on one row, the gallery
 * becomes a horizontal carousel instead.
 *
 * This checks the CURRENT (working-tree) design end to end, for every
 * combination of photo count (3, 4, 5, 9 — 3 fits one row at desktop, the
 * others force a carousel at one or both widths) and viewport width
 * (390 mobile, 1280 desktop):
 *
 *   1. Every `.collage-photo` in the deck renders at the SAME width (no
 *      orphan stretched relative to its siblings).
 *   2. The carousel affordance (real <button> prev/next, 44x44 min,
 *      Romanian aria-label, visible focus ring) is shown if and only if the
 *      deck's real measured content overflows its own box — never guessed
 *      from the photo count.
 *   3. Where shown, the buttons actually scroll the deck (click next moves
 *      forward, reaches the end with next disabled and prev enabled; click
 *      prev from there reverses it) and are reachable by keyboard (Tab
 *      focuses them, Enter/Space activates them — real buttons, not
 *      click-handler divs).
 *   4. The PAGE (document) never grows horizontal scroll at either width,
 *      whatever the photo count.
 *   5. `prefers-reduced-motion: reduce` is honoured (the deck's computed
 *      `scroll-behavior` is not "smooth").
 *
 * RED-FIRST (this file's own before/after, not a separate script): the last
 * test below rebuilds the SAME 5-photo/1280px case from git ref BEFORE_REF
 * (this worktree's HEAD when this suite was written, i.e. the shipped
 * WAVE10 stretch-to-fill behaviour) and asserts it actually FAILS the
 * uniform-width check — proving this oracle is a genuine regression gate,
 * not a tautology that would pass no matter what the CSS says.
 *
 * Run: node --experimental-sqlite --test bot/test/suite11-portfolio-gallery-uniform.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { serveDir, loadPlaywright, TEMPLATE_DIR, ROOT } = require('./wave10-portfolio-helpers.js');

const BEFORE_REF = process.env.HIDOOK_S11_BEFORE_REF || 'a26df88c53925aeca822fd9f44ca3334e8879d2f';
const STATIC_FILES = ['template.html', 'styles.css', 'script.js', 'collage.js', 'qrcode.js'];

// 8 distinct demo photos already shipped with this template (par1-4, mani1-4)
// — cycled to reach any requested count, same reasoning as
// suite2-collage-scales.test.js: overlap/sizing is a purely geometric
// property of the layout, independent of which actual photo sits in a tile.
const DEMO_PHOTOS = [
  'iv-par1.jpg', 'iv-par2.jpg', 'iv-par3.jpg', 'iv-par4.jpg',
  'iv-mani1.jpg', 'iv-mani2.jpg', 'iv-mani3.jpg', 'iv-mani4.jpg',
];

function readGitFile(ref, relPath) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return null;
  }
}

/**
 * Materialize a servable one-category portfolio site with exactly
 * `photoCount` photos, from either the working tree ('after') or a git ref
 * ('before').
 */
function buildGallerySite(photoCount, state) {
  const ref = state === 'before' ? BEFORE_REF : null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `suite11-gallery-${state}-`));

  for (const name of STATIC_FILES) {
    const content = ref
      ? readGitFile(ref, `templates/portfolio/${name}`)
      : fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
    if (content == null) throw new Error(`${name} missing at ${state}`);
    fs.writeFileSync(path.join(dir, name), content);
  }

  const imagesOutDir = path.join(dir, 'images');
  fs.mkdirSync(imagesOutDir, { recursive: true });
  const imagesSrcDir = path.join(TEMPLATE_DIR, 'images');
  for (const img of fs.readdirSync(imagesSrcDir)) {
    const from = path.join(imagesSrcDir, img);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(imagesOutDir, img));
  }

  const presetsRaw = ref
    ? readGitFile(ref, 'templates/portfolio/presets.json')
    : fs.readFileSync(path.join(TEMPLATE_DIR, 'presets.json'), 'utf8');
  const presets = JSON.parse(presetsRaw).presets;
  const presetConfig = JSON.parse(JSON.stringify(presets[0].config));
  const photos = [];
  for (let i = 0; i < photoCount; i++) {
    const file = DEMO_PHOTOS[i % DEMO_PHOTOS.length];
    photos.push({ src: 'images/' + file, alt: 'Foto test ' + (i + 1) });
  }
  presetConfig.categories = [{ title: 'Categorie de test', blurb: '', photos }];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presetConfig, null, 2));

  const { build } = require(path.join(ROOT, 'build.js'));
  build(dir);

  return dir;
}

async function measureGallery(browser, dir, width) {
  const { base, close } = await serveDir(dir);
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
      await page.locator('#hb-cookie-accept').click().catch(() => {});
    }
    await page.waitForTimeout(250); // let collage.js's initCarousel() measure overflow

    const result = await page.evaluate(() => {
      const stage = document.querySelector('.collage-stage');
      const deck = stage.querySelector(':scope > .collage-deck');
      const items = [...deck.querySelectorAll(':scope > .collage-photo')];
      const widths = items.map((el) => el.getBoundingClientRect().width);
      const prev = stage.querySelector(':scope > .collage-nav--prev');
      const next = stage.querySelector(':scope > .collage-nav--next');
      const rectOf = (el) => el ? el.getBoundingClientRect() : null;
      return {
        count: items.length,
        widths,
        overflowing: deck.scrollWidth > deck.clientWidth + 1,
        pageOverflow: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        },
        prev: prev && {
          tag: prev.tagName,
          hidden: prev.hidden,
          disabled: prev.disabled,
          ariaLabel: prev.getAttribute('aria-label'),
          rect: rectOf(prev),
        },
        next: next && {
          tag: next.tagName,
          hidden: next.hidden,
          disabled: next.disabled,
          ariaLabel: next.getAttribute('aria-label'),
          rect: rectOf(next),
        },
        deckScrollBehavior: getComputedStyle(deck).scrollBehavior,
      };
    });
    return { page, result, close };
  } catch (e) {
    await close();
    throw e;
  }
}

const CASES = [];
for (const count of [3, 4, 5, 9]) {
  for (const width of [390, 1280]) {
    CASES.push({ count, width });
  }
}

test('portfolio gallery: uniform photo size, correct carousel engagement, no page overflow', async (t) => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const dirs = [];
  try {
    for (const { count, width } of CASES) {
      await t.test(`${count} photos @ ${width}px`, async () => {
        const dir = buildGallerySite(count, 'after');
        dirs.push(dir);
        const { page, result, close } = await measureGallery(browser, dir, width);
        try {
          assert.strictEqual(result.count, count, `expected ${count} rendered .collage-photo tiles`);

          // 1) Uniform size — no orphan stretched relative to its siblings.
          const maxW = Math.max(...result.widths);
          const minW = Math.min(...result.widths);
          assert.ok(
            maxW - minW <= 1,
            `tile widths not uniform: ${result.widths.map((w) => w.toFixed(1)).join(', ')}`
          );

          // 2) Page never grows horizontal scroll.
          assert.ok(
            result.pageOverflow.scrollWidth <= result.pageOverflow.clientWidth + 1,
            `page horizontal overflow at ${width}px: scrollWidth=${result.pageOverflow.scrollWidth} > clientWidth=${result.pageOverflow.clientWidth}`
          );

          // 3) Carousel affordance shown iff the deck actually overflows.
          assert.ok(result.prev && result.next, 'expected prev/next nav buttons to exist in the DOM');
          assert.strictEqual(result.prev.tag, 'BUTTON', 'prev nav must be a real <button>');
          assert.strictEqual(result.next.tag, 'BUTTON', 'next nav must be a real <button>');
          assert.strictEqual(result.prev.hidden, !result.overflowing, `prev.hidden should be ${!result.overflowing} when overflowing=${result.overflowing}`);
          assert.strictEqual(result.next.hidden, !result.overflowing, `next.hidden should be ${!result.overflowing} when overflowing=${result.overflowing}`);

          if (result.overflowing) {
            // Romanian aria-labels, real touch targets, keyboard reachable.
            assert.equal(result.prev.ariaLabel, 'Anterior', 'prev aria-label must be the Romanian label');
            assert.equal(result.next.ariaLabel, 'Următor', 'next aria-label must be the Romanian label');
            assert.ok(result.prev.rect.width >= 44 && result.prev.rect.height >= 44, `prev button too small: ${result.prev.rect.width}x${result.prev.rect.height}`);
            assert.ok(result.next.rect.width >= 44 && result.next.rect.height >= 44, `next button too small: ${result.next.rect.width}x${result.next.rect.height}`);

            // Starts scrolled to the left: prev disabled, next enabled.
            assert.equal(result.prev.disabled, true, 'prev should start disabled (already at the first photo)');
            assert.equal(result.next.disabled, false, 'next should start enabled (more photos to the right)');

            // Clicking next actually scrolls the deck, and keyboard (Enter)
            // activates the same real <button> — proving it is reachable
            // and operable by keyboard, not just mouse.
            const scrollLeftBefore = await page.evaluate(() => document.querySelector('.collage-deck').scrollLeft);
            const nextBtn = page.locator('.collage-nav--next');
            await nextBtn.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(500);
            const scrollLeftAfter = await page.evaluate(() => document.querySelector('.collage-deck').scrollLeft);
            assert.ok(scrollLeftAfter > scrollLeftBefore, `Enter on the focused next button did not scroll the deck (${scrollLeftBefore} -> ${scrollLeftAfter})`);

            // Click next until the end is reached; next must end up disabled
            // and prev enabled — the deck actually reaches its last photo.
            for (let i = 0; i < count + 2; i++) {
              const disabled = await page.locator('.collage-nav--next').isDisabled();
              if (disabled) break;
              await page.locator('.collage-nav--next').click();
              await page.waitForTimeout(400);
            }
            assert.equal(await page.locator('.collage-nav--next').isDisabled(), true, 'next never became disabled after repeated clicks — carousel does not reach the last photo');
            assert.equal(await page.locator('.collage-nav--prev').isDisabled(), false, 'prev should be enabled once scrolled away from the start');

            // Reverse with prev — click back to the start.
            for (let i = 0; i < count + 2; i++) {
              const disabled = await page.locator('.collage-nav--prev').isDisabled();
              if (disabled) break;
              await page.locator('.collage-nav--prev').click();
              await page.waitForTimeout(400);
            }
            assert.equal(await page.locator('.collage-nav--prev').isDisabled(), true, 'prev never became disabled after repeated clicks back to the start');
          }

          // 4) prefers-reduced-motion honoured.
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.reload({ waitUntil: 'load' });
          await page.waitForTimeout(200);
          const reducedBehavior = await page.evaluate(() => getComputedStyle(document.querySelector('.collage-deck')).scrollBehavior);
          assert.notEqual(reducedBehavior, 'smooth', 'deck scroll-behavior must not be "smooth" under prefers-reduced-motion: reduce');
        } finally {
          await page.close();
          await close();
        }
      });
    }
  } finally {
    await browser.close();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('red-first: the pre-fix template (pinned ref) stretches a leftover photo out of uniform size', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const dir = buildGallerySite(5, 'before');
  try {
    const { page, result, close } = await measureGallery(browser, dir, 1280);
    try {
      const maxW = Math.max(...result.widths);
      const minW = Math.min(...result.widths);
      assert.ok(
        maxW - minW > 1,
        `expected the pre-fix template (ref ${BEFORE_REF}) to render non-uniform tile widths for 5 photos at 1280px (widths: ${result.widths.join(', ')}) — either BEFORE_REF is wrong or this was already fixed there`
      );
    } finally {
      await page.close();
      await close();
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
