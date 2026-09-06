'use strict';
/**
 * Wave9 desserdirina — WCAG AA contrast regression gate, measured on real
 * rendered pixels (not just getComputedStyle()).
 *
 * Both the original audit and the re-audit flagged the same six instances,
 * all sharing one root cause (a too-light brand pink used as text/fill on a
 * light surface, with the eyebrow label's `opacity: 0.85` making the true
 * rendered result even lighter than its own `color` value — an effect a
 * getComputedStyle-only check cannot see, since CSS `opacity` is a paint-time
 * compositing step, not a property of `color`):
 *
 *   - .section-eyebrow ("Torturi, prăjituri și pâine artizanală")   3.38:1
 *   - .menu-lang-btn "EN" (inactive, ink-on-white)                  4.37:1
 *   - .menu-lang-btn.is-active "RO" (white-on-ink)                  3.38:1
 *   - .menu-cat "Torturi" / "La comandă" / "Servicii și Evenimente" 4.37:1 (x3)
 *
 * (04-QA-Evidence/Audit-2026-09-06-2225ca7/a11y/findings.json, finding
 * A11Y-05; 04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/
 * a11y-desserdirina-productmenu.cjs reproduced the same numbers independently.)
 *
 * Fix (templates/desserdirina/styles.css): a new `--color-primary-ink` token
 * — `color-mix(in srgb, var(--color-primary-dark) 75%, black)` — used as the
 * text colour for the eyebrow/toggle/category-title, and as the active
 * toggle's fill. Mixing toward black only ever darkens, so this stays safe
 * for any accent colour a site picks, not just the default preset's pink.
 *
 * Methodology: this measures REAL rendered pixels, not CSS values, to close
 * exactly the gap that let the eyebrow's opacity slip past a naive check —
 * foreground comes from getComputedStyle (safe now that no target element
 * uses text opacity or a gradient fill), but the BACKGROUND each foreground
 * is judged against is read back from an actual PNG screenshot pixel next to
 * the text, via a small hand-rolled decoder (Node's built-in zlib only, no
 * new dependency) — so a future regression that reintroduces opacity, or
 * puts one of these elements on a gradient/photo background, is caught the
 * same way the audit caught it the first time: by what a visitor actually
 * sees, not by what the stylesheet claims.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path) and the same buildSite/serveDir harness as the other
 * desserdirina oracles in this suite (real build.js rendering).
 *
 * Run: node --experimental-sqlite bot/test/wave9-desserdirina-contrast.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildSite, serveDir, loadPlaywright } = require('./wave5-desserdirina-helpers.js');

const EVIDENCE_DIR = path.resolve(__dirname, '../../04-QA-Evidence/Wave9-desserdirina');

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

/* ---------------- minimal PNG pixel reader (8-bit RGB/RGBA, no interlace) ---------------- */
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

/* The element's own fill, read off the screenshot.
 *
 * This used to be a single pixel 6px in from the element's top-left corner,
 * "inside the element's own fill, away from centred glyphs". That holds for a
 * rectangle and breaks for a rounded one: on a 52x44 pill with
 * border-radius:999px the corner arc has a 22px radius, so (6,6) is outside
 * the painted shape entirely and reads the page behind it. It reported the
 * active language toggle at 1.57:1 — white on a pale antialiased edge — while
 * the button's real fill is rgb(157,51,89), which gives white text 6.88:1.
 * A wrong pixel is worse than no pixel: it fails a build for a defect that
 * does not exist, and it would have passed a genuinely low-contrast fill just
 * as happily if the geometry had landed differently.
 *
 * Read the modal colour along the element's horizontal midline instead. Mid-
 * height misses every corner arc by construction, whatever the radius, and the
 * mode survives the glyphs: text is centred and occupies a minority of that
 * line, so the most common colour on it is the fill. Colours are bucketed to
 * 8 levels per channel so antialiased near-matches count together rather than
 * splitting the vote.
 */
function modalFillOnMidline(png, rect, dpr) {
  const y = Math.round((rect.top + rect.height / 2) * dpr);
  const x0 = Math.round((rect.left + 2) * dpr);
  const x1 = Math.round((rect.left + rect.width - 2) * dpr);
  const counts = new Map();
  for (let x = x0; x <= x1; x++) {
    const px = getPixel(png, x, y);
    const key = (px[0] >> 5) + ',' + (px[1] >> 5) + ',' + (px[2] >> 5);
    const entry = counts.get(key) || { n: 0, px };
    entry.n++;
    counts.set(key, entry);
  }
  let best = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best ? best.px : getPixel(png, (rect.left + 6) * dpr, (rect.top + 6) * dpr);
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
/**
 * Chromium resolves a `color-mix()` result (our --color-primary-ink) via
 * getComputedStyle as `color(srgb 0.61 0.2 0.35)` (0-1 range), not
 * `rgb(...)` (0-255) — handle both forms, same as
 * wave5-local-service-a11y.test.js's parseRgb.
 */
function parseRgb(str) {
  const colorFn = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(str);
  if (colorFn) return [1, 2, 3].map((i) => parseFloat(colorFn[i]) * 255);
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) throw new Error('unparseable colour: ' + str);
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return [parts[0], parts[1], parts[2]];
}

/** Alpha channel of a computed backgroundColor, in whichever of the two
 * forms above Chromium returned it (color() has no alpha component in the
 * forms we see here, so it's always opaque; rgba() may carry a 4th value). */
function bgAlpha(str) {
  if (/^color\(srgb/.test(str)) return 1;
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) return 0;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return parts.length > 3 ? parts[3] : 1;
}

/**
 * Measure one element's real-pixel AA contrast: foreground from
 * getComputedStyle (trustworthy here — none of these elements use text
 * opacity or a gradient fill after the fix), background sampled from an
 * actual screenshot PNG next to the glyphs (inside the element's own fill
 * if it has one, e.g. the active pink toggle; otherwise just outside the
 * element on the surface behind it).
 */
async function measureContrast(page, selector, screenshotPath) {
  // Scroll the element into view FIRST: `page.screenshot()` below (no
  // `fullPage`) only captures the current viewport, but getBoundingClientRect
  // reports a position relative to that same viewport regardless of whether
  // the element is actually inside it — sampling an off-screen element's
  // (uncaptured) coordinates against the screenshot silently clamps to the
  // nearest captured edge and reads whatever solid colour happens to be
  // there, which reads as a false pass/fail with no error. Scrolling first
  // guarantees the rect we read matches what the screenshot actually shows.
  // Instant, not `scrollIntoView()` — this page sets `scroll-behavior: smooth`
  // on <html>, which turns scrollIntoView into an animated scroll that is
  // still mid-flight well past a short wait, leaving the element's rect
  // (read immediately after) stale relative to where the screenshot below
  // actually lands.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const targetY = window.scrollY + r.top - window.innerHeight / 2 + r.height / 2;
    window.scrollTo({ top: Math.max(0, targetY), left: 0, behavior: 'instant' });
  }, selector);
  await page.waitForTimeout(80);

  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      text: (el.textContent || '').trim(),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    };
  }, selector);
  if (!info) throw new Error(`selector not found: ${selector}`);
  if (!info.inViewport) throw new Error(`${selector}: still outside the captured viewport after scrollIntoView (rect=${JSON.stringify(info.rect)})`);

  await page.screenshot({ path: screenshotPath });
  const png = decodePng(fs.readFileSync(screenshotPath));

  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const hasOwnFill = bgAlpha(info.backgroundColor) > 0;
  let sampleX, sampleY;
  let bgPixel;
  if (hasOwnFill) {
    bgPixel = modalFillOnMidline(png, info.rect, dpr);
  } else {
    // No fill of its own: sample just above the text, on the surface behind it.
    sampleX = info.rect.left + info.rect.width / 2;
    sampleY = info.rect.top - 3;
    bgPixel = getPixel(png, sampleX * dpr, sampleY * dpr);
  }
  const fgColor = parseRgb(info.color);
  const ratio = contrastRatio(fgColor, bgPixel);

  const isLarge = info.fontSize >= 24 || (info.fontSize >= 18.66 && info.fontWeight >= 700);
  const required = isLarge ? 3 : 4.5;
  return { ratio, required, isLarge, fg: fgColor, bg: bgPixel, text: info.text, fontSize: info.fontSize, fontWeight: info.fontWeight };
}

async function main() {
  fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const { dir } = buildSite({ state: 'after' });
  const { base, close } = await serveDir(dir);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);

    const targets = [
      { sel: '.section-eyebrow', label: 'eyebrow (about section)' },
      { sel: '.menu-lang-btn:not(.is-active)', label: 'language toggle, inactive ("EN")' },
      { sel: '.menu-lang-btn.is-active', label: 'language toggle, active ("RO")' },
      { sel: '.menu-cat', label: 'menu category title (first: "Torturi")' },
    ];

    const results = {};
    for (const t of targets) {
      await check(`${t.label}: meets WCAG AA on real rendered pixels`, async () => {
        const shotPath = path.join(EVIDENCE_DIR, `sample-${t.sel.replace(/[^a-z0-9]+/gi, '_')}.png`);
        const m = await measureContrast(page, t.sel, shotPath);
        results[t.label] = m;
        console.log(
          `  ${t.label}: ${m.ratio.toFixed(2)}:1 (need ${m.required}:1${m.isLarge ? ', large-text exemption' : ''}) ` +
          `fg=rgb(${m.fg.join(',')}) bg=rgb(${m.bg.join(',')}) text="${m.text.slice(0, 40)}"`
        );
        assert.ok(
          m.ratio >= m.required,
          `${t.label}: ${m.ratio.toFixed(2)}:1 is below the ${m.required}:1 floor (fg=rgb(${m.fg.join(',')}) bg=rgb(${m.bg.join(',')}))`
        );
      });
    }

    // All three menu categories individually (not just the first match) —
    // the audit flagged "Torturi", "La comandă", AND "Servicii și Evenimente".
    await check('all three RO menu category titles individually meet WCAG AA', async () => {
      const cats = await page.evaluate(() => {
        const panel = document.querySelector('.menu-panel[data-menu-panel="ro"]');
        return Array.from(panel.querySelectorAll('.menu-cat')).map((el) => el.textContent.trim());
      });
      assert.strictEqual(cats.length, 3, `expected 3 RO categories, got ${cats.length}: ${cats.join(', ')}`);
      for (let i = 1; i <= cats.length; i++) {
        const sel = `.menu-panel[data-menu-panel="ro"] .menu-group:nth-of-type(${i}) .menu-cat`;
        const shotPath = path.join(EVIDENCE_DIR, `sample-menu-cat-${i}.png`);
        const m = await measureContrast(page, sel, shotPath);
        console.log(`  RO category "${cats[i - 1]}": ${m.ratio.toFixed(2)}:1 (need ${m.required}:1)`);
        assert.ok(m.ratio >= m.required, `RO category "${cats[i - 1]}": ${m.ratio.toFixed(2)}:1 below ${m.required}:1`);
      }
    });

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'contrast-results.json'),
      JSON.stringify(results, (k, v) => (Buffer.isBuffer(v) ? undefined : v), 2)
    );

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'after-full-1440.png'), fullPage: false });
    await page.close();
  } finally {
    await browser.close();
    await close();
  }

  if (failed) {
    console.error(`\nwave9-desserdirina-contrast.test.js: ${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nwave9-desserdirina-contrast.test.js: all checks passed');
}

main().catch((e) => {
  console.error('FAIL wave9-desserdirina-contrast:', e.stack || e.message);
  process.exit(1);
});
