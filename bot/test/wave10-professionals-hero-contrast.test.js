'use strict';
/**
 * bot/test/wave10-professionals-hero-contrast.test.js
 *
 * Oracle for the professionals template's hero text contrast, measured on
 * REAL RENDERED PIXELS — not on the CSS colour values.
 *
 * Why this exists: the hero heading/lede/kicker/meta text sits directly on
 * top of `hero.background` — a photo an owner uploads, whose brightness and
 * busyness this template has no control over. The existing
 * wave5-professionals-a11y.test.js contrast check only reads
 * getComputedStyle(el).backgroundColor up the ancestor chain; a
 * background-image/gradient (which is what .pr-hero/.pr-hero__bg/
 * .pr-hero__veil actually paint with) never sets `background-color`, so
 * that check silently falls back to whatever solid colour it finds further
 * up the tree (body's `--paper`) — it was never actually measuring the
 * photo-backed case at all. This is exactly the class of gap the project's
 * own rules call out: "contrast must clear WCAG AA, measured on rendered
 * pixels, not CSS values."
 *
 * Wave10 gave the hero copy a near-opaque "paper card" backdrop
 * (.pr-hero__card, color-mix(paper 90%, transparent) + blur) specifically so
 * contrast no longer depends on the photo at all. This oracle proves that:
 *
 *   1. Against the template's real shipped hero.jpg, every hero text style
 *      clears its WCAG AA floor (4.5:1 normal / 3:1 "large" text), measured
 *      from an actual PNG screenshot pixel sampled next to the glyphs.
 *   2. Against a synthetic WORST CASE — hero.background forced to solid
 *      black, the darkest a photo can ever be — the same still holds, so a
 *      future owner's unusually dark photo upload cannot regress this.
 *
 * Run: node --experimental-sqlite --test bot/test/wave10-professionals-hero-contrast.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { test } = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave10-professionals');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg' };

function serveDir(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(dir, urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function buildExportDir() {
  const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config));
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-prof-contrast-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'templates/professionals/styles.css'), path.join(tmpDir, 'styles.css'));
  fs.copyFileSync(path.join(ROOT, 'templates/professionals/script.js'), path.join(tmpDir, 'script.js'));
  fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(tmpDir, 'images/hero.jpg'));
  return tmpDir;
}

/* ---------------- minimal PNG pixel reader (8-bit RGB/RGBA, no interlace) ----------------
 * Same approach as wave9-desserdirina-contrast.test.js: Node's built-in zlib
 * only, no new dependency. */
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

/** Measure one element's real-pixel AA contrast: foreground from
 * getComputedStyle, background sampled from an actual screenshot PNG just
 * above the element's own top edge (inside the card, on the card's own
 * painted surface — none of the targets below have their own fill). */
async function measureContrast(page, selector, screenshotPath) {
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
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      text: (el.textContent || '').trim(),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    };
  }, selector);
  if (!info) throw new Error(`selector not found: ${selector}`);
  if (!info.inViewport) throw new Error(`${selector}: outside captured viewport (rect=${JSON.stringify(info.rect)})`);

  await page.screenshot({ path: screenshotPath });
  const png = decodePng(fs.readFileSync(screenshotPath));
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);

  // Sample just above the text's left edge, on the card's own surface —
  // clear of any glyph ink.
  const sampleX = info.rect.left + Math.min(4, info.rect.width / 4);
  const sampleY = info.rect.top - 4;
  const bgPixel = getPixel(png, sampleX * dpr, sampleY * dpr);
  const fgColor = parseRgb(info.color);
  const ratio = contrastRatio(fgColor, bgPixel);

  const isLarge = info.fontSize >= 24 || (info.fontSize >= 18.66 && info.fontWeight >= 700);
  const required = isLarge ? 3 : 4.5;
  return { ratio, required, isLarge, fg: fgColor, bg: bgPixel, text: info.text, fontSize: info.fontSize, fontWeight: info.fontWeight };
}

const TARGETS = [
  { sel: '.pr-kicker', label: 'hero kicker (business.profession)' },
  { sel: '#hero-heading', label: 'hero H1 (business.tagline)' },
  { sel: '.pr-lede', label: 'hero lede (hero.qualifier)' },
  { sel: '.pr-hero__meta', label: 'hero meta (modes / languages)' },
];

async function runAgainstBackground(t, browser, label, backgroundOverrideCss) {
  const tmpDir = buildExportDir();
  const server = await serveDir(tmpDir);
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);

  if (backgroundOverrideCss) {
    await page.evaluate((bg) => {
      const el = document.querySelector('.pr-hero__bg');
      el.style.background = bg;
    }, backgroundOverrideCss);
    await page.waitForTimeout(80);
  }

  const results = {};
  for (const target of TARGETS) {
    const shotPath = path.join(EVIDENCE_DIR, `sample-${label}-${target.sel.replace(/[^a-z0-9]+/gi, '_')}.png`);
    const m = await measureContrast(page, target.sel, shotPath);
    results[target.label] = m;
    assert.ok(
      m.ratio >= m.required,
      `[${label}] ${target.label}: ${m.ratio.toFixed(2)}:1 is below the ${m.required}:1 WCAG AA floor ` +
      `(fg=rgb(${m.fg.join(',')}) bg=rgb(${m.bg.join(',')}))`
    );
  }
  return results;
}

test('wave10-professionals: hero text clears WCAG AA on real rendered pixels, over the real photo and a worst-case dark photo', async (t) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const allResults = {};

  await t.test('real shipped hero.jpg', async (t2) => {
    allResults.realPhoto = await runAgainstBackground(t2, browser, 'real-photo', null);
  });

  await t.test('worst-case: hero.background forced to solid black', async (t2) => {
    allResults.worstCaseBlack = await runAgainstBackground(t2, browser, 'worst-black', '#000');
  });

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'hero-contrast-results.json'),
    JSON.stringify(allResults, null, 2)
  );
});
