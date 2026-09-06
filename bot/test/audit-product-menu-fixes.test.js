'use strict';
/**
 * Oracle for Audit-2026-09-06 (HEAD 2225ca7) product-menu (Restaurant) fixes:
 *
 *   PM-01 [critical] Gallery lightbox created by collage.js had zero CSS —
 *                     a click on a photo broke the page layout instead of
 *                     opening a viewer.
 *   PM-03 [high]      Hero CTA ("REZERVĂ O MASĂ") stayed transparent no
 *                     matter which accent color the client picked, because
 *                     a same-specificity `.hero-cta` rule declared later in
 *                     styles.css always won the cascade over
 *                     `.pm-hero__cta--fill`.
 *   PM-04 [high]      On mobile the header nav links vanished completely,
 *                     with no hamburger fallback.
 *
 * Static checks (fast, source-only) verify the fix is structurally present.
 * Browser checks (Playwright + build.js#renderHtml, no live server needed)
 * verify real computed styles / geometry, per the audit note that reasoning
 * about CSS is not a substitute for checking actual pixels.
 *
 * Run: node bot/test/audit-product-menu-fixes.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const templateHtml = read('templates/product-menu/template.html');
const stylesCss = read('templates/product-menu/styles.css');
const scriptJs = read('templates/product-menu/script.js');
const presetsRaw = JSON.parse(read('templates/product-menu/presets.json'));
const presets = presetsRaw.presets || [];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    failed++;
    console.error('FAIL', name, '-', error.message);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ============================================================
// Static source checks
// ============================================================

check('PM-03: primary hero CTA no longer carries the conflicting "hero-cta" class', () => {
  assert.ok(
    /<a href="#contact-card" class="pm-hero__cta pm-hero__cta--fill">/.test(templateHtml),
    'primary hero CTA does not have the expected class list "pm-hero__cta pm-hero__cta--fill"'
  );
  assert.ok(
    !/class="[^"]*\bhero-cta\b[^"]*\bpm-hero__cta--fill\b[^"]*"/.test(templateHtml) &&
    !/class="[^"]*\bpm-hero__cta--fill\b[^"]*\bhero-cta\b[^"]*"/.test(templateHtml),
    'primary hero CTA still carries "hero-cta", which overrides its fill background to transparent'
  );
});

check('PM-04: accessible hamburger button wired to the nav via aria-controls', () => {
  assert.ok(/<nav[^>]*id="pm-mast-nav"/.test(templateHtml), 'nav is missing id="pm-mast-nav"');
  assert.ok(
    /<button[^>]*id="pm-mast-burger"[^>]*aria-expanded="false"[^>]*aria-controls="pm-mast-nav"/.test(templateHtml),
    'hamburger button is missing id/aria-expanded/aria-controls wiring to #pm-mast-nav'
  );
  assert.ok(
    /id="pm-mast-burger"[^>]*aria-label="[^"]*meniu[^"]*"/i.test(templateHtml),
    'hamburger button is missing a Romanian aria-label'
  );
});

check('PM-01: lightbox CSS gives the collage.js-created overlay real full-screen styling', () => {
  assert.ok(/\.lightbox\s*\{[^}]*position:\s*fixed/.test(stylesCss), '.lightbox is not position:fixed');
  assert.ok(/\.lightbox\s*\{[^}]*inset:\s*0/.test(stylesCss), '.lightbox does not cover the viewport (inset:0)');
  assert.ok(/\.lightbox\s*\{[^}]*z-index:\s*\d+/.test(stylesCss), '.lightbox has no explicit stacking order');
  assert.ok(/\.lightbox\[hidden\]\s*\{[^}]*display:\s*none/.test(stylesCss), '.lightbox[hidden] does not hide the element');
  assert.ok(/\.lightbox-img\s*\{[^}]*object-fit:\s*contain/.test(stylesCss), '.lightbox-img is missing object-fit: contain');
  assert.ok(/\.lightbox-close\b/.test(stylesCss), '.lightbox-close is unstyled');
  assert.ok(/\.lightbox-nav\b/.test(stylesCss), '.lightbox-nav is unstyled');
});

check('script.js registers the new mobile-nav controller', () => {
  assert.ok(/function initMobileNav\s*\(/.test(scriptJs), 'initMobileNav() is not defined in script.js');
  assert.ok(/initMobileNav\(\);/.test(scriptJs), 'initMobileNav() is never called from DOMContentLoaded');
});

check('at least one product-menu preset is available to render for the browser checks', () => {
  assert.ok(presets.length > 0, 'templates/product-menu/presets.json has no presets');
});

// ============================================================
// Browser checks — real computed styles / geometry via Playwright.
// Renders actual template.html + styles.css + script.js + collage.js
// (through build.js#renderHtml, the same engine bot/server.js uses) to a
// temp folder and loads it as a normal file:// page — no server needed.
// ============================================================

async function runBrowserChecks() {
  let chromium;
  try {
    ({ chromium } = require(path.join(ROOT, 'node_modules/playwright')));
  } catch (error) {
    console.warn('SKIP browser checks: playwright is not available -', error.message);
    return;
  }
  if (!presets.length) {
    console.warn('SKIP browser checks: no preset to render');
    return;
  }

  const preset = presets[0];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-audit-oracle-'));
  for (const asset of ['styles.css', 'script.js', 'collage.js']) {
    fs.copyFileSync(path.join(ROOT, 'templates/product-menu', asset), path.join(tmp, asset));
  }

  function renderTo(config) {
    const html = renderHtml(templateHtml, config);
    fs.writeFileSync(path.join(tmp, 'index.html'), html, 'utf8');
    return 'file://' + path.join(tmp, 'index.html');
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // ---- PM-03: hero CTA fill tracks the accent color, at several colors ----
    const testColors = ['#c4a574', '#1D5B79', '#7C3AED', '#16A34A'];
    for (const hex of testColors) {
      const config = clone(preset.config);
      config.theme = Object.assign({}, config.theme, { primary: hex });
      await page.goto(renderTo(config));
      const bg = await page.locator('.pm-hero__cta--fill').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const expectedRgb = await page.evaluate((h) => {
        const probe = document.createElement('div');
        probe.style.color = h;
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      }, hex);
      check(`PM-03: hero CTA background matches accent ${hex}`, () => {
        assert.notStrictEqual(bg, 'rgba(0, 0, 0, 0)', 'hero CTA background is transparent');
        assert.strictEqual(bg, expectedRgb, `expected ${expectedRgb}, got ${bg}`);
      });
    }

    // ---- PM-01: clicking a gallery photo opens a real full-screen lightbox ----
    {
      const config = clone(preset.config);
      await page.goto(renderTo(config));
      await page.locator('.collage-photo').first().click();
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => {
        const lb = document.querySelector('.lightbox');
        if (!lb) return null;
        const cs = getComputedStyle(lb);
        const rect = lb.getBoundingClientRect();
        return {
          hidden: lb.hasAttribute('hidden'),
          position: cs.position,
          zIndex: Number(cs.zIndex) || 0,
          bg: cs.backgroundColor,
          w: rect.width,
          h: rect.height,
        };
      });
      const vp = page.viewportSize();
      check('PM-01: clicking a photo opens a real full-screen lightbox (not a broken inline element)', () => {
        assert.ok(state, '.lightbox element was never created by collage.js');
        assert.strictEqual(state.hidden, false, 'lightbox still carries [hidden] after the click');
        assert.strictEqual(state.position, 'fixed', 'lightbox is not position:fixed (would break page flow)');
        assert.ok(state.zIndex > 0, 'lightbox has no stacking order (z-index)');
        assert.notStrictEqual(state.bg, 'rgba(0, 0, 0, 0)', 'lightbox has no visible backdrop');
        assert.ok(Math.abs(state.w - vp.width) < 2, `lightbox width ${state.w} does not cover viewport ${vp.width}`);
        assert.ok(Math.abs(state.h - vp.height) < 2, `lightbox height ${state.h} does not cover viewport ${vp.height}`);
      });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      const hiddenAfterEscape = await page.evaluate(() => {
        const lb = document.querySelector('.lightbox');
        return lb ? lb.hasAttribute('hidden') : null;
      });
      check('PM-01: Escape re-hides the lightbox', () => {
        assert.strictEqual(hiddenAfterEscape, true, 'lightbox did not re-hide on Escape');
      });
    }

    // ---- PM-04: mobile hamburger reveals/hides nav, accessible controls ----
    {
      const config = clone(preset.config);
      const url = renderTo(config);
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.goto(url);

      const navCollapsedInitially = await mobile.locator('#pm-mast-nav').evaluate((el) => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return cs.display === 'none' || cs.visibility === 'hidden' || rect.height < 4;
      });
      check('PM-04: nav links are not reachable on a 390px viewport before opening the menu', () => {
        assert.ok(navCollapsedInitially, 'nav is already expanded without opening the hamburger');
      });

      const burger = mobile.locator('#pm-mast-burger');
      await burger.click();
      await mobile.waitForTimeout(300);
      const expandedState = await burger.getAttribute('aria-expanded');
      const navBox = await mobile.locator('#pm-mast-nav').boundingBox();
      const linkCount = await mobile.locator('#pm-mast-nav a').count();
      const burgerBox = await burger.boundingBox();
      check('PM-04: opening the hamburger exposes the nav links with touch-friendly targets', () => {
        assert.strictEqual(expandedState, 'true', 'aria-expanded was not set to "true" when opened');
        assert.ok(navBox && navBox.height > 40, 'nav panel did not visibly open');
        assert.ok(linkCount >= 2, `expected multiple nav links, found ${linkCount}`);
        assert.ok(burgerBox.width >= 44 && burgerBox.height >= 44, `hamburger touch target ${burgerBox.width}x${burgerBox.height} is below 44x44`);
      });

      await mobile.keyboard.press('Escape');
      await mobile.waitForTimeout(300);
      const expandedAfterEscape = await burger.getAttribute('aria-expanded');
      const navCollapsedAfterEscape = await mobile.locator('#pm-mast-nav').evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.visibility === 'hidden' || el.getBoundingClientRect().height < 4;
      });
      check('PM-04: Escape closes the mobile menu and resets aria-expanded', () => {
        assert.strictEqual(expandedAfterEscape, 'false', 'aria-expanded was not reset to "false" after Escape');
        assert.ok(navCollapsedAfterEscape, 'nav panel is still visibly open after Escape');
      });

      await mobile.close();
    }
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

runBrowserChecks()
  .catch((error) => {
    failed++;
    console.error('FAIL browser checks crashed -', error && error.stack || error);
  })
  .then(() => {
    if (failed) {
      console.error(`\naudit-product-menu-fixes.test.js: ${failed} failure(s)`);
      process.exit(1);
    }
    console.log('\naudit-product-menu-fixes.test.js: all checks passed');
  });
