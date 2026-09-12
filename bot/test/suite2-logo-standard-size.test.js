'use strict';
/**
 * bot/test/suite2-logo-standard-size.test.js
 *
 * The client asked, explicitly, for a standard logo size across the five
 * templates. There wasn't one — the SAME uploaded logo file rendered at a
 * different height on every template, with no common rule at all:
 *
 *   professionals   22x22px   (.pr-nav__logo,  height:22px fixed)
 *   portfolio       22x22px   (.pf-chrome__logo, height:22px fixed)
 *   product-menu    28x28px   (.pm-mast__logo, height:28px fixed)
 *   local-service   120x40px  (.ls-hero__logo, height:40px + aspect-ratio:3/1
 *                              box — a square logo is letterboxed inside it)
 *   desserdirina    460x460px (.hero-logo, max-width:460px/width:min(82vw,460px),
 *                              NO height limit at all — a square logo becomes
 *                              as tall as the whole hero, on mobile too)
 *
 * (04-QA-Evidence/QA-Explorare-2026-09-12/reports/03-images-logo-gallery.md,
 * defect D1 — confirmed on all 5.)
 *
 * This measures the SAME two uploaded logos (one square, one 3:1 wide) on
 * the real rendered output of all 5 templates, at desktop and mobile
 * viewports, and requires the displayed height to land inside one common,
 * reasonable range and the width to never balloon past a sane cap — instead
 * of asserting a specific CSS property is present (which was true for 4 of
 * the 5 templates already, at 4 different values).
 *
 * Uses buildStaticSiteTree() (the same renderer bot/webpublish.js runs on a
 * real publish) rather than the full checkout->publish HTTP flow — cheaper,
 * and the rendered HTML is byte-identical either way (see
 * bot/test/wave10-portfolio-gallery-grid.test.js / waveB-cls-all-templates
 * for the same pattern on other Suite/Wave oracles).
 *
 * Run: node --experimental-sqlite --test bot/test/suite2-logo-standard-size.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
const { makeSolidPng, toDataUrl } = require('./suite2-png-helpers.js');

// Element that carries the primary, always-visible logo on each template —
// the one the QA report measured (portfolio/product-menu also render a
// smaller logo in the footer; that is a separate, deliberately-smaller
// context and out of scope for this defect).
const TEMPLATE_SELECTORS = {
  professionals: '.pr-nav__logo',
  portfolio: '.pf-chrome__logo',
  'product-menu': '.pm-mast__logo',
  'local-service': '.ls-hero__logo',
  desserdirina: '.hero-logo',
};

// A "standard" is only meaningful as a shared window: 32-48px is what the
// plan calls reasonable for desktop, 28-40px for mobile. A single flat
// max-height inside the OVERLAP of both (32-40px) satisfies both viewports
// with one rule, which is exactly the fix (no per-breakpoint override).
const DESKTOP_HEIGHT_RANGE = [32, 48];
const MOBILE_HEIGHT_RANGE = [28, 40];
const MAX_WIDTH = 200;

const SQUARE_LOGO = toDataUrl(makeSolidPng(200, 200, [40, 90, 220]));
const WIDE_LOGO = toDataUrl(makeSolidPng(1200, 300, [40, 90, 220]));

function buildSite(templateId, logoDataUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite2-logo-'));
  const cfg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')
  ).presets[0].config;
  cfg.logo = logoDataUrl;
  siteExport.buildStaticSiteTree({ templateId, config: cfg, images: [], siteDir: dir });
  return dir;
}

async function measureLogo(browser, dir, selector, viewport) {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
    // desserdirina's logo sits inside .hero-mark, which runs a 0.3s-delay,
    // 1.2s reveal animation (scale 0.9 -> 1) on load — measuring mid-animation
    // would read a systematically smaller (and viewport-dependent-looking)
    // box for no layout reason at all. Settle past it on every template.
    await page.waitForTimeout(1700);
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const box = await el.boundingBox();
    return box;
  } finally {
    await page.close();
  }
}

test('the same logo renders at a consistent, reasonable size on all 5 templates', async () => {
  const browser = await chromium.launch({ headless: true });
  const problems = [];
  const report = [];
  try {
    for (const [templateId, selector] of Object.entries(TEMPLATE_SELECTORS)) {
      for (const [logoLabel, logoDataUrl] of [['square 200x200', SQUARE_LOGO], ['wide 1200x300', WIDE_LOGO]]) {
        const dir = buildSite(templateId, logoDataUrl);
        try {
          for (const [vpLabel, viewport, range] of [
            ['desktop', { width: 1440, height: 900 }, DESKTOP_HEIGHT_RANGE],
            ['mobile', { width: 390, height: 844 }, MOBILE_HEIGHT_RANGE],
          ]) {
            const box = await measureLogo(browser, dir, selector, viewport);
            report.push(`${templateId} / ${logoLabel} / ${vpLabel}: ${Math.round(box.width)}x${Math.round(box.height)}px`);

            if (box.height < range[0] || box.height > range[1]) {
              problems.push(
                `${templateId} (${selector}) ${logoLabel} @${vpLabel}: height ${box.height.toFixed(1)}px ` +
                `outside the [${range[0]}, ${range[1]}] standard range`
              );
            }
            if (box.width > MAX_WIDTH) {
              problems.push(
                `${templateId} (${selector}) ${logoLabel} @${vpLabel}: width ${box.width.toFixed(1)}px ` +
                `exceeds the ${MAX_WIDTH}px cap`
              );
            }
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    await browser.close();
  }
  report.forEach((r) => console.log('  ' + r));
  assert.deepEqual(problems, [], 'logo size is not standardised:\n' + problems.join('\n'));
});
