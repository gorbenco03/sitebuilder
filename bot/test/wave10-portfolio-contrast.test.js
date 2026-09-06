'use strict';
/**
 * Wave10 portfolio (Salon) — WCAG AA contrast gate, measured on real
 * rendered pixels (not just getComputedStyle()).
 *
 * This wave's changes (templates/portfolio/styles.css: the gallery's 6-unit
 * sub-grid, and `height: auto` next to every `aspect-ratio` on an `<img>`)
 * touched no `color`/`background`/`opacity` declaration anywhere in the
 * template. This oracle exists anyway, per the task's non-negotiable
 * "contrast must clear WCAG AA, measured on rendered pixels" constraint, as
 * a real proof rather than an assumption — and per the same task's warning
 * that an earlier pass found `opacity` making a rendered result lighter than
 * its declared colour in a way a naive CSS-value check would miss, so this
 * samples an actual screenshot pixel for every background, including two
 * cases a plain getComputedStyle diff could not judge correctly on its own:
 * the sticky header's `backdrop-filter: blur()` composite (its true on-page
 * colour depends on whatever photo/section is scrolled behind it, not just
 * its own rgba fill) and the hero tagline sitting on a gradient veil over a
 * photograph.
 *
 * Covers one representative text/background pair per distinct surface the
 * template uses: --paper (light), --snow (chip cards), --void (dark
 * sections), the translucent sticky nav over the hero photo, and the hero
 * veil-over-photo itself.
 *
 * Run: node --experimental-sqlite bot/test/wave10-portfolio-contrast.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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

/* ---------------- minimal PNG pixel reader (8-bit RGB/RGBA, no interlace) ----------------
 * Same decoder as bot/test/wave9-desserdirina-contrast.test.js — duplicated
 * here rather than imported since that file is a standalone script (no
 * module.exports) owned by a different wave, not a shared helper module. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 8 + len + 4;
  }
  if (bitDepth !== 8) throw new Error('unsupported PNG bit depth ' + bitDepth);
  if (colorType !== 6 && colorType !== 2) throw new Error('unsupported PNG color type ' + colorType);
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawOffset + x];
      const a = x >= channels ? pixels[rowStart + x - channels] : 0;
      const b = y > 0 ? pixels[prevRowStart + x] : 0;
      const c = (y > 0 && x >= channels) ? pixels[prevRowStart + x - channels] : 0;
      let value;
      switch (filterType) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          value = rawByte + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: throw new Error('unsupported PNG filter type ' + filterType);
      }
      pixels[rowStart + x] = value & 0xff;
    }
    rawOffset += stride;
  }
  return { width, height, channels, pixels };
}

function getPixel(png, x, y) {
  const cx = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const idx = (cy * png.width + cx) * png.channels;
  return [png.pixels[idx], png.pixels[idx + 1], png.pixels[idx + 2]];
}

/* ---------------- WCAG contrast math ---------------- */
function relLuminance([r, g, b]) {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contrastRatio(c1, c2) {
  const l1 = relLuminance(c1), l2 = relLuminance(c2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(str) {
  const colorFn = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(str);
  if (colorFn) return [1, 2, 3].map((i) => parseFloat(colorFn[i]) * 255);
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) throw new Error('unparseable colour: ' + str);
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return [parts[0], parts[1], parts[2]];
}

/**
 * Measure one element's real-pixel AA contrast: foreground colour comes
 * straight from getComputedStyle for the element's OWN text-fill colour
 * (none of the checked elements use text `opacity` or a gradient text
 * fill), but the BACKGROUND it's judged against is sampled from an actual
 * screenshot pixel next to the glyphs — including through backdrop-filter
 * blur and photo/gradient composites, which getComputedStyle cannot see at
 * all.
 */
async function measureContrast(page, selector, screenshotPath, opts = {}) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const targetY = window.scrollY + r.top - window.innerHeight / 2 + r.height / 2;
    window.scrollTo({ top: Math.max(0, targetY), left: 0, behavior: 'instant' });
  }, selector);
  await page.waitForTimeout(120);

  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      text: (el.textContent || '').trim(),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    };
  }, selector);
  if (!info) throw new Error(`selector not found: ${selector}`);
  if (!info.inViewport) throw new Error(`${selector}: outside captured viewport after scroll (rect=${JSON.stringify(info.rect)})`);

  await page.screenshot({ path: screenshotPath });
  const png = decodePng(fs.readFileSync(screenshotPath));

  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const dx = opts.sampleDx || 0;
  const dy = opts.sampleDy != null ? opts.sampleDy : -3;
  const sampleX = info.rect.left + (opts.sampleDx != null ? opts.sampleDx : info.rect.width / 2);
  const sampleY = info.rect.top + dy;
  const bgPixel = getPixel(png, sampleX * dpr, sampleY * dpr);
  const fgColor = parseRgb(info.color);
  const ratio = contrastRatio(fgColor, bgPixel);

  const isLarge = info.fontSize >= 24 || (info.fontSize >= 18.66 && info.fontWeight >= 700);
  const required = isLarge ? 3 : 4.5;
  return { ratio, required, isLarge, fg: fgColor, bg: bgPixel, text: info.text, fontSize: info.fontSize, fontWeight: info.fontWeight };
}

async function main() {
  // NOTE: this directory is shared with the other wave10-portfolio-*.test.js
  // oracles AND with 04-QA-Evidence/Wave10-portfolio/capture.mjs's
  // before/after/comparison screenshots — do NOT rm the whole directory
  // here, only (re)create it and overwrite this file's own predictably-named
  // outputs (sample-*.png, contrast-results.json) below.
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const { chromium } = loadPlaywright();
  const { dir } = buildSite({ state: 'after', presetIndex: 0 });
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    // Force everything to load so backgrounds behind translucent/blurred
    // elements (e.g. the sticky nav) are the real, final composited scene.
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total; y += 500) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    const cases = [
      // [label, selector, sample opts]
      ['hero tagline over photo veil', '.pf-hero__tag', { sampleDy: 6 }],
      ['sticky nav link (blurred dark chrome over hero)', '.pf-chrome__nav a', {}],
      ['gallery category kicker on --paper', '.pf-gal .pf-kicker', {}],
      ['gallery category blurb on --paper', '.pf-series__b', {}],
      ['about section body copy on --void', '.pf-about .pf-copy', {}],
      ['service chip price on --snow card', '.pf-chip__price', {}],
      ['price list value on --paper', '.pf-price__val', {}],
      ['schedule hours on --paper', '.pf-sched__hours', {}],
      ['team member role on --snow card', '.pf-person__role', {}],
      ['footer text on --paper', '.pf-foot__inner > div > p', {}],
    ];

    for (const [label, selector, opts] of cases) {
      await check(`AA contrast: ${label} (${selector})`, async () => {
        const shot = path.join(EVIDENCE_DIR, `sample-${label.replace(/[^a-z0-9]+/gi, '_')}.png`);
        const r = await measureContrast(page, selector, shot, opts);
        results.push({ label, selector, ...r });
        assert.ok(
          r.ratio >= r.required - 0.02, // tiny epsilon for PNG/AA-rendering rounding
          `${label}: ${r.ratio.toFixed(2)}:1 (need ${r.required}:1) fg=${r.fg} bg=${r.bg} text="${r.text}"`
        );
      });
    }

    await page.close();
  } finally {
    await browser.close();
    await close();
  }

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'contrast-results.json'),
    JSON.stringify(results, (k, v) => (Buffer.isBuffer(v) ? undefined : v), 2)
  );

  if (failed) {
    console.error(`\nwave10-portfolio-contrast.test.js: ${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nwave10-portfolio-contrast.test.js: all checks passed');
}

main().catch((e) => {
  console.error('FAIL wave10-portfolio-contrast:', e.stack || e.message);
  process.exit(1);
});
