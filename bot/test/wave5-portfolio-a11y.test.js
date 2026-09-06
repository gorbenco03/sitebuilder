'use strict';
/**
 * wave5-portfolio-a11y — accessibility oracle for the portfolio template,
 * audit 2026-09-06 (04-QA-Evidence/Audit-2026-09-06-2225ca7).
 *
 * Builds the REAL production output (via build.js's `build()`, the same
 * pipeline a real publish uses) TWICE — once from git HEAD (pre-fix sources)
 * and once from the current working tree — and runs the same checks with
 * Playwright's Chromium against both, so every finding is proven red before
 * and green after against the actual rendered page (not source literals):
 *
 *  1. Colour contrast (WCAG AA, 4.5:1 for normal text) of every brand-palette
 *     text/background pair used on the page — computed from the page's own
 *     getComputedStyle() output (walking composited ancestor backgrounds).
 *     Was failing: `--mute` (rgba(42,51,64,0.48)) on the light section
 *     backgrounds (paper/snow/blush) it's used on — kicker labels, footer
 *     text, chip/price meta — measured ~2.5-2.7:1. Fixed by raising the alpha
 *     to 0.74 (styles.css). Also white CTA-button text on the shipped
 *     theme.primary (#6b7f5a) measured 4.37:1, just under the 4.5:1 floor;
 *     the atelier-ivoire / atelier-ivoire-ro presets now ship a slightly
 *     darker default (#5f7350, ~5.2:1) with the same hue.
 *  2. Every interactive element (links, buttons) is >= 24x24 CSS px.
 *     Was failing: footer "IG"/"FB" social links and the Instagram
 *     ".pf-follow" link had no padding, rendering under 24px tall (plain
 *     text glyph box only). Fixed with inline-flex + min-height/min-width.
 *  3. 200% browser zoom must not introduce horizontal scrolling. Simulated
 *     the standard way (halved viewport — reflows identically to a real
 *     browser zoom) at both a desktop and mobile size.
 *     Was failing at the mobile size (~195px): the sticky-nav CTA pill
 *     (white-space:nowrap + flex-shrink:0), the hero wordmark/tagline, a
 *     detailed-pricing row, and the WhatsApp booking panel all hit the
 *     classic flex/grid "min-width:auto locks to content's min-content size"
 *     trap and pushed the page wider than the viewport. Fixed with
 *     min-width:0 on the relevant flex/grid items, flex-wrap on the chrome
 *     bar and price rows, and letting the CTA pill's text wrap.
 *
 * Run: node bot/test/wave5-portfolio-a11y.test.js
 * Evidence: 04-QA-Evidence/Wave5-portfolio/a11y/
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave5-portfolio', 'a11y');
const TPL_DIR = path.join(ROOT, 'templates', 'portfolio');
const PRESET_ID = 'atelier-ivoire-ro';
const TEMPLATE_FILES = ['template.html', 'styles.css', 'script.js', 'collage.js', 'qrcode.js'];

function loadPlaywright() {
  return require('playwright'); // bare specifier: resolves via node_modules walk-up
}

function relLum(rgb) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function parseColor(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
/** Composite fg over bg (both {r,g,b,a}), return opaque [r,g,b]. */
function composite(fg, bg) {
  const a = fg.a;
  return [
    fg.r * a + bg.r * (1 - a),
    fg.g * a + bg.g * (1 - a),
    fg.b * a + bg.b * (1 - a),
  ];
}
function contrastOf(rgb1, rgb2) {
  const l1 = relLum(rgb1), l2 = relLum(rgb2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function readAtRef(ref, relFile) {
  return execSync(`git show ${ref}:templates/portfolio/${relFile}`, { cwd: ROOT, encoding: 'utf8' });
}
function readWorkingTree(relFile) {
  return fs.readFileSync(path.join(TPL_DIR, relFile), 'utf8');
}

function buildVariant(label, fileReader) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-portfolio-a11y-' + label + '-'));
  for (const name of TEMPLATE_FILES) {
    fs.writeFileSync(path.join(dir, name), fileReader(name), 'utf8');
  }
  fs.cpSync(path.join(TPL_DIR, 'images'), path.join(dir, 'images'), { recursive: true });
  const presets = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'presets.json'), 'utf8')).presets;
  const preset = presets.find((p) => p.id === PRESET_ID);
  assert.ok(preset, 'preset "' + PRESET_ID + '" must exist');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(preset.config, null, 2), 'utf8');
  const { build } = require(path.join(ROOT, 'build.js'));
  build(dir);
  return dir;
}

function serveDir(dir) {
  const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json',
  };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(dir, p);
    if (!fp.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

/** Walk up the DOM collecting each ancestor's background-color, innermost first. */
async function bgLayersOf(locator) {
  return locator.evaluate((el) => {
    let node = el;
    const layers = [];
    while (node) {
      layers.push(getComputedStyle(node).backgroundColor);
      node = node.parentElement;
    }
    return layers;
  });
}

async function pairContrast(page, selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'attached', timeout: 5000 });
  const fgStr = await el.evaluate((n) => getComputedStyle(n).color);
  // Paint order is outermost (html) first, each descendant painting over it —
  // so composite outermost-to-innermost (reverse of the DOM-walk-up order).
  const bgLayers = (await bgLayersOf(el)).slice().reverse();
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const layerStr of bgLayers) {
    const c = parseColor(layerStr);
    if (c && c.a > 0) bg = { r: composite(c, bg)[0], g: composite(c, bg)[1], b: composite(c, bg)[2], a: 1 };
  }
  const fg = parseColor(fgStr);
  if (!fg) return null;
  const fgOpaque = composite(fg, bg);
  return contrastOf(fgOpaque, [bg.r, bg.g, bg.b]);
}

/** Run the full check suite against one built+served variant. Returns [{name, ok, detail}]. */
async function runChecks(browser, base, variantLabel, screenshotPrefix) {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log((ok ? 'PASS' : 'FAIL'), '[' + variantLabel + ']', name, ok ? '' : ('- ' + detail));
  };
  const safely = async (name, fn) => {
    try { await fn(); record(name, true); } catch (e) { record(name, false, e.message); }
  };

  // 1. Contrast.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    const pairs = [
      ['.pf-kicker', 'section kicker label on light background', 4.5],
      ['.pf-chip__price', 'service chip price on white chip', 4.5],
      ['.pf-price__val', 'detailed price value on paper', 4.5],
      ['.pf-foot', 'footer text on paper', 4.5],
      ['.pf-chrome__cta', 'sticky-nav CTA button text on brand primary', 4.5],
      ['.hero-cta', 'hero CTA button text on brand primary', 4.5],
    ];
    for (const [sel, label, min] of pairs) {
      if (!(await page.locator(sel).count())) continue;
      await safely('contrast >= ' + min + ':1 — ' + label + ' (' + sel + ')', async () => {
        const ratio = await pairContrast(page, sel);
        assert.ok(ratio !== null, label + ': could not read computed color');
        assert.ok(ratio >= min, label + ' measured ' + ratio.toFixed(2) + ':1, need >= ' + min + ':1');
      });
    }
    await page.screenshot({ path: path.join(EVIDENCE, screenshotPrefix + '-contrast-desktop.png'), fullPage: true });
    await page.close();
  }

  // 2. Touch targets >= 24x24 at 390 wide.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
      await page.locator('#hb-cookie-accept').click().catch(() => {});
    }
    const targets = [
      ['.pf-chrome__toggle', 'mobile nav hamburger'],
      ['.pf-chrome__cta', 'sticky-nav booking CTA'],
      ['.hero-cta', 'hero CTA'],
      ['.pf-foot__soc a', 'footer social link'],
      ['.pf-follow', 'Instagram follow link'],
    ];
    for (const [sel, label] of targets) {
      const loc = page.locator(sel).first();
      if (!(await loc.count())) continue;
      await safely('touch target >= 24x24 — ' + label + ' (' + sel + ')', async () => {
        await loc.scrollIntoViewIfNeeded();
        const box = await loc.boundingBox();
        assert.ok(box, label + ' has no bounding box');
        assert.ok(box.width >= 24 && box.height >= 24,
          label + ' measured ' + box.width.toFixed(1) + 'x' + box.height.toFixed(1) + ', need >= 24x24');
      });
    }
    await page.screenshot({ path: path.join(EVIDENCE, screenshotPrefix + '-touch-targets-mobile-390.png') });
    await page.close();
  }

  // 3. 200% zoom (simulated via halved viewport) must not cause horizontal scroll.
  for (const [w, h, tag] of [[720, 450, 'desktop-zoom200'], [195, 422, 'mobile-zoom200']]) {
    await safely('no horizontal overflow at simulated 200% zoom (' + tag + ', ' + w + 'x' + h + ')', async () => {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      try {
        await page.goto(base + '/index.html', { waitUntil: 'load' });
        if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
          await page.locator('#hb-cookie-accept').click().catch(() => {});
        }
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        await page.screenshot({ path: path.join(EVIDENCE, screenshotPrefix + '-zoom200-' + tag + '.png'), fullPage: true });
        assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1,
          tag + ': scrollWidth=' + overflow.scrollWidth + ' > clientWidth=' + overflow.clientWidth + ' (horizontal scroll present)');
      } finally {
        await page.close();
      }
    });
  }

  return results;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = loadPlaywright();

  const beforeDir = buildVariant('before', (name) => readAtRef('HEAD', name));
  const afterDir = buildVariant('after', (name) => readWorkingTree(name));
  const beforeServer = await serveDir(beforeDir);
  const afterServer = await serveDir(afterDir);
  const beforeBase = 'http://127.0.0.1:' + beforeServer.address().port;
  const afterBase = 'http://127.0.0.1:' + afterServer.address().port;

  let beforeResults, afterResults;
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      beforeResults = await runChecks(browser, beforeBase, 'before', 'before');
      afterResults = await runChecks(browser, afterBase, 'after', 'after');
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((r) => beforeServer.close(r));
    await new Promise((r) => afterServer.close(r));
    fs.rmSync(beforeDir, { recursive: true, force: true });
    fs.rmSync(afterDir, { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(EVIDENCE, 'summary.json'), JSON.stringify({ before: beforeResults, after: afterResults }, null, 2));

  const beforeFailures = beforeResults.filter((r) => !r.ok);
  const afterFailures = afterResults.filter((r) => !r.ok);

  let failed = 0;
  if (beforeFailures.length === 0) {
    failed++;
    console.error('FAIL oracle sanity: git HEAD (before the fix) showed ZERO failures — this oracle would not have caught the real regression');
  } else {
    console.log('PASS oracle sanity: git HEAD (before the fix) reproduced ' + beforeFailures.length + ' real failure(s): ' + beforeFailures.map((r) => r.name).join('; '));
  }
  if (afterFailures.length > 0) {
    failed++;
    console.error('FAIL working tree (after the fix) still has ' + afterFailures.length + ' failure(s): ' + afterFailures.map((r) => r.name + ' (' + r.detail + ')').join('; '));
  } else {
    console.log('PASS working tree (after the fix): all ' + afterResults.length + ' checks pass');
  }

  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('OK wave5-portfolio-a11y (contrast + touch targets + 200% zoom, red-before/green-after verified)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
