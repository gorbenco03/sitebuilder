'use strict';
/**
 * bot/test/s74-product-menu-suite7.test.js
 *
 * PLAN-QA-2026-09-12 §3 Suite 7, step S7-4 (product-menu). Two kinds of
 * checks in one file, per the task split:
 *
 *   PART 1 — known defects, fixed here:
 *   - m7/X4: the footer Instagram/Facebook links carried the literal text
 *     "IG"/"FB" (aria-label was already correct, but the visible content —
 *     what suite7-template-contract calls hasSvg — was plain text, not an
 *     icon). templates/product-menu/template.html + styles.css.
 *   - D1: the primary CTA (`.pm-mast__pill`, `.pm-hero__cta--fill`) used
 *     `--r: 4px` — the most-square corner of the 5 templates the client
 *     asked to round out. templates/product-menu/styles.css.
 *   - `services[].icon`: declared in schema.json, always empty in both
 *     presets, and never rendered anywhere in template.html — removed from
 *     both files rather than given a half-built editing surface (see the
 *     report for the argument).
 *
 *   PART 2 — searched but not previously checked, with measurements. Two of
 *   these found NEW, real defects (fixed here); two confirmed the existing
 *   behaviour is fine (kept as green regression coverage, not "failing
 *   first" — there was nothing to fix):
 *   - CTA text contrast against an arbitrary accent color: `--void` (near-
 *     black) was a FIXED CTA text color while `--cta` (the background) is
 *     the owner's own chosen accent — from the builder's 6-swatch palette or
 *     any custom hex. Measured against the 6 swatches (builder/app.js
 *     COLOR_PRESETS) and both shipped presets: 3 of 6 swatches (Indigo
 *     3.69:1, Violet 3.47:1, Roz 4.31:1) AND the live "Traista Verde" preset
 *     itself (2.64:1) fall under the 4.5:1 floor for this ~12px bold label.
 *     Fixed by computing, before first paint, which of two fixed inks
 *     (near-black / near-white) contrasts best against the actual accent,
 *     and — only if even the better one still falls short — nudging the
 *     button's own fill toward black/white until it clears 4.5:1.
 *   - Cookie banner vs. footer: before consent, the fixed bottom banner
 *     overlapped the footer's legal links, hidook credit links, and (at
 *     390px) the Instagram/Facebook icons themselves, at ALL THREE widths.
 *     bot/site-legal.js already carries a `--hb-cookie-clearance` token for
 *     exactly this kind of overlap, but only ever applies it to each
 *     template's HERO — no template's footer, product-menu included, ever
 *     consumed it. Fixed inside templates/product-menu/styles.css alone (no
 *     site-legal.js change, out of this task's file scope) by reserving
 *     that same clearance as padding-bottom on `.pm-foot` while the banner
 *     is open.
 *   - Gallery overload (16 photos in one category): CONFIRMED FINE. 0%
 *     overlap, 0 horizontal scroll at 1440/768/390 — `.collage-deck` is a
 *     plain CSS grid; collage.js's scatter-position math is computed but
 *     genuinely unused (no CSS rule anywhere references `--x`/`--y`/`.placed`
 *     it sets), so the desserdirina-style overlap bug (suite2-collage-scales)
 *     cannot happen here today. Documented as a real gap between the
 *     comment's intent and the code (out of this task's assigned scope to
 *     resurrect), not fixed.
 *   - Long menu (32 items, one category): CONFIRMED FINE. Renders as a plain
 *     `<ul>` inside a `<details>`, no max-height/overflow clipping, no
 *     horizontal scroll at any width.
 *   - Bilingual menu honesty: CONFIRMED FINE. Both presets' `menu.en` is
 *     genuine English (manually read; a French loanword — "crème fraîche" —
 *     trips a crude Romanian-diacritic regex, which is a probe limitation,
 *     not a content bug). The toggle only ever touches `.menu-panel` content
 *     (nav/hero unaffected by a click) and its group is honestly labelled
 *     "Limba meniului" (menu language) rather than implying a whole-site
 *     translation — unlike the desserdirina M8 finding this suite was
 *     modelled on.
 *
 * Uses buildStaticSiteTree() (same renderer bot/webpublish.js runs on a real
 * publish), matching bot/test/suite2-collage-scales.test.js and
 * bot/test/suite2-logo-standard-size.test.js.
 *
 * Run: node --experimental-sqlite --test bot/test/s74-product-menu-suite7.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TPL_DIR = path.join(ROOT, 'templates', 'product-menu');
const PRESETS = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'presets.json'), 'utf8')).presets;

// The 6 accent swatches the builder's color popover offers (builder/app.js,
// COLOR_PRESETS) — "culori saturate din paleta oferită clientului" per
// S7-CONTRACT. Background/"cream" has no such fixed palette (free hex input),
// so it is out of this check's scope.
const PALETTE = {
  Indigo: '#5B5BD6', Turcoaz: '#0D9488', Violet: '#7C3AED',
  Portocaliu: '#EA580C', Roz: '#DB2777', Verde: '#16A34A',
};

function relLum(rgb) {
  const f = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function contrastRatio(a, b) {
  const L1 = relLum(a), L2 = relLum(b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(str) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(str);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
}

function buildSite(config, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's74-pm-'));
  siteExport.buildStaticSiteTree(Object.assign(
    { templateId: 'product-menu', config, images: [], siteDir: dir }, extra || {}
  ));
  return dir;
}

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });

// ---------------------------------------------------------------------------
// PART 1 — known defects
// ---------------------------------------------------------------------------

test('m7/X4: footer Instagram/Facebook links render a real icon, not the literal text IG/FB', async () => {
  const dir = buildSite(PRESETS[0].config);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
    const links = await page.locator('.pm-foot__soc a').evaluateAll((els) => els.map((el) => ({
      ariaLabel: el.getAttribute('aria-label'),
      text: el.textContent.trim(),
      hasSvg: !!el.querySelector('svg'),
      hasIconBg: [el, el.firstElementChild].some((n) => n && /url\(/.test(getComputedStyle(n).backgroundImage)),
    })));
    assert.strictEqual(links.length, 2, 'expected Instagram + Facebook footer links');
    for (const l of links) {
      assert.ok(l.ariaLabel, 'link keeps an accessible name');
      assert.strictEqual(l.text, '', `visible text content must be empty (icon-only), got "${l.text}"`);
      assert.ok(l.hasSvg || l.hasIconBg, `${l.ariaLabel}: must render an actual icon (inline <svg> or an icon background-image), found neither`);
    }
    await page.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1: primary CTA border-radius is ~10px, not the 4px shared by professionals (softer-corners requirement)', async () => {
  const dir = buildSite(PRESETS[0].config);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
    const radii = await page.evaluate(() => ({
      pill: getComputedStyle(document.querySelector('.pm-mast__pill')).borderRadius,
      heroFill: getComputedStyle(document.querySelector('.pm-hero__cta--fill')).borderRadius,
    }));
    for (const [name, val] of Object.entries(radii)) {
      const px = parseFloat(val);
      assert.ok(px >= 8 && px <= 12, `${name}: border-radius must land near 10px, got ${val}`);
    }
    await page.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('services[].icon: removed from schema and presets (dead field — never rendered, no editing surface anywhere)', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'schema.json'), 'utf8'));
  const servicesField = schema.sections.flatMap((s) => s.fields).find((f) => f.key === 'services');
  assert.ok(servicesField, 'services field must still exist');
  assert.ok(!('icon' in servicesField.itemShape), 'services.itemShape must no longer declare icon');
  assert.deepEqual(Object.keys(servicesField.itemShape), ['label'], 'services items are label-only now');

  for (const p of PRESETS) {
    for (const item of p.config.services) {
      assert.ok(!('icon' in item), `${p.id}: a services[] item still carries a leftover icon key`);
      assert.ok(item.label, `${p.id}: services item must still have a label`);
    }
  }

  // template.html never referenced {{icon}} even before this fix (dead
  // field) — pin that so a future edit does not reintroduce a broken
  // reference to a key the schema no longer declares.
  const html = fs.readFileSync(path.join(TPL_DIR, 'template.html'), 'utf8');
  assert.ok(!/\{\{\s*icon\s*\}\}/.test(html), 'template.html must not reference a bare {{icon}} token');
});

test('services rendering is unaffected: labels still show for both presets after the icon-field removal', async () => {
  for (const p of PRESETS) {
    const dir = buildSite(p.config);
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      const labels = await page.locator('.pm-ticket__label').allTextContents();
      assert.deepEqual(labels, p.config.services.map((s) => s.label), `${p.id}: rendered service labels must match config`);
      await page.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// PART 2 — searched and found: real defects (fixed here)
// ---------------------------------------------------------------------------

test('NEW: primary CTA text meets 4.5:1 against every builder accent swatch, not just the two demo presets', async () => {
  const failures = [];
  for (const [name, hex] of Object.entries(PALETTE)) {
    const cfg = JSON.parse(JSON.stringify(PRESETS[0].config));
    cfg.theme.primary = hex;
    const dir = buildSite(cfg);
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      const { bg, fg } = await page.locator('.pm-mast__pill').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fg: cs.color };
      });
      const ratio = contrastRatio(parseRgb(fg), parseRgb(bg));
      if (ratio < 4.5) failures.push(`${name} (${hex}): ${ratio.toFixed(2)}:1 (bg=${bg} fg=${fg})`);
      await page.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.deepEqual(failures, [], `CTA text under 4.5:1 on: ${failures.join('; ')}`);
});

test('NEW: primary CTA text meets 4.5:1 on both shipped presets\' own accent (Traista Verde measured 2.64:1 before the fix)', async () => {
  const failures = [];
  for (const p of PRESETS) {
    const dir = buildSite(p.config);
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      const { bg, fg } = await page.locator('.pm-hero__cta--fill').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fg: cs.color };
      });
      const ratio = contrastRatio(parseRgb(fg), parseRgb(bg));
      if (ratio < 4.5) failures.push(`${p.id} (${p.config.theme.primary}): ${ratio.toFixed(2)}:1`);
      await page.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.deepEqual(failures, [], `CTA text under 4.5:1 on preset(s): ${failures.join('; ')}`);
});

test('NEW: cookie banner never overlaps a footer link/button before consent, at 1440/768/390', async () => {
  const dir = buildSite(PRESETS[0].config);
  try {
    for (const width of [1440, 768, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      await page.waitForTimeout(300); // cookie-banner.js reveal
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => {
        const banner = document.querySelector('#hb-cookie-banner');
        if (!banner || banner.hasAttribute('hidden')) return { visible: false, overlaps: [] };
        const b = banner.getBoundingClientRect();
        const links = [...document.querySelectorAll('.pm-foot a, .hb-legal-links a')];
        const overlaps = links
          .map((a) => {
            const r = a.getBoundingClientRect();
            const ix = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left));
            const iy = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top));
            return { text: (a.textContent || a.getAttribute('aria-label') || '').trim(), area: ix * iy };
          })
          .filter((o) => o.area > 0);
        return { visible: true, overlaps };
      });
      assert.ok(result.visible, `cookie banner must be visible before consent at ${width}px (test assumption)`);
      assert.deepEqual(result.overlaps, [], `at ${width}px, cookie banner overlaps footer link(s): ${result.overlaps.map((o) => o.text).join(', ')}`);
      await page.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PART 2 — searched and confirmed fine (regression coverage, not a fix)
// ---------------------------------------------------------------------------

test('CHECKED-OK: a 16-photo gallery category never overlaps and never causes horizontal scroll (1440/768/390)', async () => {
  const cfg = JSON.parse(JSON.stringify(PRESETS[0].config));
  const photos = [];
  for (let i = 0; i < 16; i++) {
    photos.push({ src: ['images/cn-d1.jpg', 'images/cn-d2.jpg', 'images/cn-d3.jpg'][i % 3], alt: 'Test #' + i });
  }
  cfg.categories = [{ title: 'Categorie test', blurb: 'Test', photos }];
  const dir = buildSite(cfg);
  try {
    for (const width of [1440, 768, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const result = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.collage-photo')].map((el) => el.getBoundingClientRect());
        let worst = 0;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            const inter = ix * iy;
            if (inter > 0) worst = Math.max(worst, inter / Math.min(a.width * a.height, b.width * b.height));
          }
        }
        return { count: boxes.length, worst, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      assert.strictEqual(result.count, 16, `${width}px: expected all 16 photos rendered`);
      assert.ok(result.worst <= 0.15, `${width}px: worst photo overlap ${(result.worst * 100).toFixed(1)}% must be <= 15%`);
      assert.ok(result.overflow <= 1, `${width}px: horizontal overflow ${result.overflow}px must be ~0`);
      await page.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CHECKED-OK: a 32-item menu category renders fully, with no clipping and no horizontal scroll (1440/768/390)', async () => {
  const cfg = JSON.parse(JSON.stringify(PRESETS[0].config));
  const items = Array.from({ length: 32 }, (_, i) => 'Fel de mancare ' + (i + 1));
  cfg.menu.ro = [{ category: 'Categorie lunga', items }];
  cfg.menu.en = [{ category: 'Long category', items: items.map((_, i) => 'Dish ' + (i + 1)) }];
  const dir = buildSite(cfg);
  try {
    for (const width of [1440, 768, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      const result = await page.evaluate(() => ({
        itemCount: document.querySelectorAll('.menu-panel[data-menu-panel="ro"] .pm-items li').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      assert.strictEqual(result.itemCount, 32, `${width}px: all 32 items must render`);
      assert.ok(result.overflow <= 1, `${width}px: horizontal overflow ${result.overflow}px must be ~0`);
      await page.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CHECKED-OK: both presets\' EN menu is genuine English, and the language toggle only ever changes the menu panel', async () => {
  // Manual-content check: every EN category's dish list must not be the RO
  // list (i.e. it was actually translated, not copy-pasted). Category
  // *names* are allowed to coincide (casa-nord's "Desert" is spelled the
  // same in both languages), so this compares the items, which is where a
  // copy-paste would actually show up.
  for (const p of PRESETS) {
    const enCats = p.config.menu.en, roCats = p.config.menu.ro;
    assert.strictEqual(enCats.length, roCats.length, `${p.id}: EN/RO must have the same number of categories`);
    for (let i = 0; i < enCats.length; i++) {
      assert.notStrictEqual(
        enCats[i].items.join('|'), roCats[i].items.join('|'),
        `${p.id}: EN category "${enCats[i].category}" has the same dish list as RO — looks untranslated`
      );
    }
  }

  // Behavioural check: clicking the EN toggle must not touch nav/hero copy,
  // and the toggle group's label must describe the menu, not the whole site
  // (the desserdirina M8 finding this suite is modelled on: a toggle that
  // promised more than it did).
  const dir = buildSite(PRESETS[0].config);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
    const navBefore = await page.locator('#pm-mast-nav').innerText();
    const heroBefore = await page.locator('.pm-hero__copy').innerText();
    const groupLabel = await page.locator('.pm-langs').getAttribute('aria-label');
    await page.click('.menu-lang-btn[data-menu-lang="en"]');
    await page.waitForTimeout(100);
    const navAfter = await page.locator('#pm-mast-nav').innerText();
    const heroAfter = await page.locator('.pm-hero__copy').innerText();
    assert.strictEqual(navAfter, navBefore, 'nav must be unaffected by the menu-language toggle');
    assert.strictEqual(heroAfter, heroBefore, 'hero copy must be unaffected by the menu-language toggle');
    assert.match(groupLabel, /meniu/i, 'the toggle group\'s aria-label must name the menu, not the whole site, as its scope');
    await page.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
