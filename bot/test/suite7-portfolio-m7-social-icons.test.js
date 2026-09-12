'use strict';
/**
 * bot/test/suite7-portfolio-m7-social-icons.test.js — S7-3 / m7 & X4.
 *
 * The footer Instagram/Facebook links had `aria-label="Instagram"` /
 * `"Facebook"` for assistive tech, but their VISIBLE content was the bare
 * text "IG" / "FB" — no glyph, no icon, nothing that reads as a network
 * mark at a glance, and barely legible once the footer's --paper background
 * is a client-chosen colour (the text glyph carries no independent
 * background of its own).
 *
 * This checks the rendered link has a real icon (an inline <svg> or an
 * element with a `background-image: url(...image/svg+xml...)`) and that its
 * OWN visible text content is no longer the literal "IG"/"FB" abbreviation.
 * It also keeps the existing >=44x44 touch-target floor these links already
 * had, since the fix replaces their content.
 *
 * Run: node --experimental-sqlite --test bot/test/suite7-portfolio-m7-social-icons.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSite, serveDir, loadPlaywright } = require('./wave10-portfolio-helpers.js');

const BEFORE_REF = process.env.HIDOOK_S73_BEFORE_REF || '216ef0c4d9955084c2593613f2d1817348446b24';

async function inspectSocialLinks(browser, dir) {
  const { base, close } = await serveDir(dir);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    const links = await page.locator('.pf-foot__soc a').all();
    const out = [];
    for (const link of links) {
      const info = await link.evaluate((a) => {
        const hasSvg = !!a.querySelector('svg') || Array.from(a.querySelectorAll('*')).some((el) => {
          const bg = getComputedStyle(el).backgroundImage || '';
          return bg.includes('image/svg+xml');
        });
        return {
          ariaLabel: a.getAttribute('aria-label'),
          text: (a.textContent || '').trim(),
          hasSvg,
        };
      });
      const box = await link.boundingBox();
      out.push({ ...info, box });
    }
    await page.close();
    return out;
  } finally {
    await close();
  }
}

test('footer Instagram/Facebook links render a real icon, not "IG"/"FB" text', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const { dir } = buildSite({ state: 'after', presetIndex: 2 });
    const links = await inspectSocialLinks(browser, dir);
    assert.ok(links.length >= 2, `expected >=2 footer social links (Instagram + Facebook), found ${links.length}`);
    for (const link of links) {
      assert.ok(link.hasSvg, `${link.ariaLabel}: no SVG icon found (background-image or inline <svg>)`);
      assert.notEqual(link.text.toUpperCase(), 'IG', `${link.ariaLabel}: visible text is still the bare "IG" abbreviation`);
      assert.notEqual(link.text.toUpperCase(), 'FB', `${link.ariaLabel}: visible text is still the bare "FB" abbreviation`);
      assert.ok(link.box, `${link.ariaLabel}: no bounding box (not laid out)`);
      assert.ok(
        link.box.width >= 44 && link.box.height >= 44,
        `${link.ariaLabel}: touch target measured ${link.box.width.toFixed(1)}x${link.box.height.toFixed(1)}, need >= 44x44`
      );
    }
  } finally {
    await browser.close();
  }
});

test('red-first: the pre-fix template (pinned ref) still ships bare "IG"/"FB" text', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const { dir } = buildSite({ state: 'before', ref: BEFORE_REF, presetIndex: 2 });
    const links = await inspectSocialLinks(browser, dir);
    assert.ok(links.length >= 2, 'expected >=2 footer social links in the pre-fix template');
    const stillText = links.some((l) => !l.hasSvg && (l.text.toUpperCase() === 'IG' || l.text.toUpperCase() === 'FB'));
    assert.ok(stillText, 'expected the pre-fix template to still show bare "IG"/"FB" text — either BEFORE_REF is wrong or this was already fixed there');
  } finally {
    await browser.close();
  }
});
