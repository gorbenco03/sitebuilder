'use strict';
/**
 * bot/test/audit-performance.test.js — regression gate for the
 * AUDIT-2026-09-06 (04-QA-Evidence/Audit-2026-09-06-2225ca7/performance)
 * fixes: PERF-01 (slow "Start" click), PERF-02 (unoptimized images),
 * PERF-04 (zero minification), PERF-06 (LCP/CLS on published sites).
 *
 * These are threshold checks against measured before/after numbers in
 * 04-QA-Evidence/Audit-Fixes-2026-09-06/performance/{before,after}.json,
 * not exact-value pins — the goal is to catch *regressions* (someone
 * re-adding a 600KB unedited hero JPEG, or reverting the CSS minifier),
 * not to freeze the current byte count forever.
 *
 * Deliberately build-time / static-file based (no Playwright, no network
 * throttling) so it stays fast and non-flaky in CI, matching the style of
 * bot/test/wave1-perf-theme.test.js. The throttled, browser-driven
 * before/after A-B measurement lives in
 * 04-QA-Evidence/Audit-Fixes-2026-09-06/performance/measure.mjs instead.
 *
 * Run: node bot/test/audit-performance.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const GEN = path.join(ROOT, 'builder', 'generated');
// Only the 4 template systems this fix pass was scoped to touch.
// desserdirina is intentionally excluded — it is owned by another branch.
const TPLS = ['product-menu', 'local-service', 'portfolio', 'professionals'];

let failed = false;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed = true;
    console.error('FAIL', name, '-', e.message);
  }
}

// Minimal, zero-dependency JPEG dimension reader (parses SOF0-SOF15
// markers). Works identically on macOS and Linux — no `sips`/ImageMagick
// needed, so this oracle (and the image files it checks) behave the same
// in CI/production as they do on the machine that produced them.
function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || offset + 4 > buf.length) break; // EOI / truncated
    const segLen = buf.readUInt16BE(offset + 2);
    const isSOF =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF && offset + 9 <= buf.length) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + segLen;
  }
  return null;
}

function dirTotalBytes(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isFile()) total += fs.statSync(p).size;
  }
  return total;
}

(async () => {
  // ── PERF-04: build:app runs and produces minified-but-valid heavy JS ──────
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-builder.js')], {
    cwd: ROOT,
    stdio: 'pipe',
  });

  // Regression ceilings, each placed midway between the CURRENT minified and
  // unminified size of that payload, measured on this tree by building twice
  // (once with minifyCss/trimJsWhitespace short-circuited to identity):
  //
  //   template        minified   unminified   ceiling
  //   product-menu       81103        83178     82100
  //   local-service      91565        93021     92300
  //   portfolio          94879        96823     95800
  //   professionals     107289       110325    108800
  //
  // Placing them strictly between the two means a silent revert of the CSS
  // minifier in scripts/build-builder.js fails this check — verified by
  // re-running with the minifier disabled (4/4 red). The absolute numbers
  // are larger than the ones in
  // 04-QA-Evidence/Audit-Fixes-2026-09-06/performance/after.json because
  // the mobile-nav, honest-appointment-form and shared-QR waves landed on
  // main after that measurement; the *minifier savings* are what this gate
  // pins, not the absolute payload size.
  const HEAVY_JS_CEILING_BYTES = {
    'product-menu': 82100,
    'local-service': 92300,
    portfolio: 95800,
    professionals: 108800,
  };

  for (const id of TPLS) {
    const heavyPath = path.join(GEN, 'templates', id + '.js');
    check(`${id}: heavy JS payload exists and is syntactically valid`, () => {
      assert.ok(fs.existsSync(heavyPath), 'missing ' + heavyPath);
      execFileSync(process.execPath, ['--check', heavyPath], { stdio: 'pipe' });
    });

    check(`${id}: heavy JS payload under regression ceiling (PERF-01/PERF-04)`, () => {
      const bytes = fs.statSync(heavyPath).size;
      const ceiling = HEAVY_JS_CEILING_BYTES[id];
      assert.ok(
        bytes < ceiling,
        `${id}.js is ${bytes} bytes, expected < ${ceiling} (CSS minification may have regressed)`
      );
    });

    check(`${id}: embedded styles.css is smaller than the raw source (minifier ran)`, () => {
      const heavyBody = fs.readFileSync(heavyPath, 'utf8');
      // Format: window.HIDOOK_TEMPLATE_HEAVY = window.HIDOOK_TEMPLATE_HEAVY || {};\n
      //         window.HIDOOK_TEMPLATE_HEAVY["<id>"] = {...json...};\n
      const marker = 'HIDOOK_TEMPLATE_HEAVY[' + JSON.stringify(id) + '] = ';
      const start = heavyBody.indexOf(marker);
      assert.ok(start !== -1, 'could not locate assignment marker for ' + id);
      const jsonStart = start + marker.length;
      const heavy = JSON.parse(heavyBody.slice(jsonStart, heavyBody.lastIndexOf(';\n')));
      const embeddedCss = heavy.files.stylesCss;
      const rawCss = fs.readFileSync(path.join(ROOT, 'templates', id, 'styles.css'), 'utf8');
      assert.ok(embeddedCss.length > 0, 'embedded stylesCss must not be empty');
      assert.ok(
        embeddedCss.length < rawCss.length * 0.97,
        `embedded CSS (${embeddedCss.length}b) should be meaningfully smaller than raw source (${rawCss.length}b)`
      );
      // calc()/combinator spacing must survive minification (never over-collapsed).
      if (rawCss.includes('calc(')) {
        assert.ok(embeddedCss.includes('calc('), id + ' minified CSS lost a calc() expression');
      }
    });
  }

  // ── PERF-02/PERF-06: template source images stay optimized ────────────────
  const IMAGE_DIR_CEILING_MB = 16; // post-fix measured ~9.9MB; pre-fix was ~23.3MB
  let totalImageBytes = 0;
  for (const id of TPLS) {
    const imgDir = path.join(ROOT, 'templates', id, 'images');
    check(`${id}: images/ directory total size is optimized`, () => {
      const bytes = dirTotalBytes(imgDir);
      totalImageBytes += bytes;
      // Per-template ceiling generous enough to allow adding a few photos,
      // tight enough to catch a raw unedited multi-MB dump being reintroduced.
      assert.ok(
        bytes < 6 * 1024 * 1024,
        `${imgDir} is ${(bytes / 1024 / 1024).toFixed(2)}MB, expected < 6MB`
      );
    });

    check(`${id}: no JPEG exceeds the optimization bounding box`, () => {
      const files = fs.readdirSync(imgDir).filter((f) => /\.jpe?g$/i.test(f));
      assert.ok(files.length > 0, 'expected JPEGs in ' + imgDir);
      for (const name of files) {
        const buf = fs.readFileSync(path.join(imgDir, name));
        const dims = jpegDimensions(buf);
        assert.ok(dims, `could not parse JPEG dimensions for ${name}`);
        const longest = Math.max(dims.width, dims.height);
        // Hero images are allowed up to 1600px (see scratchpad optimize
        // heuristic); everything else up to 1000px. Use a single generous
        // 1700px ceiling here so this stays a regression guard, not a pin.
        assert.ok(
          longest <= 1700,
          `${name} is ${dims.width}x${dims.height} (longest side ${longest}px), expected <= 1700px`
        );
      }
    });
  }

  check('combined images/ total across the 4 fixed template systems is optimized', () => {
    const mb = totalImageBytes / 1024 / 1024;
    assert.ok(
      mb < IMAGE_DIR_CEILING_MB,
      `combined templates/{${TPLS.join(',')}}/images total is ${mb.toFixed(2)}MB, expected < ${IMAGE_DIR_CEILING_MB}MB`
    );
  });

  // ── PERF-06: below-fold gallery/instagram images stay lazy + async-decoded ─
  for (const id of TPLS) {
    check(`${id}: template.html keeps loading=lazy + decoding=async on repeating gallery images`, () => {
      const html = fs.readFileSync(path.join(ROOT, 'templates', id, 'template.html'), 'utf8');
      const lazyImgs = html.match(/<img\b[^>]*loading=["']lazy["'][^>]*>/g) || [];
      assert.ok(lazyImgs.length >= 1, id + ' must keep at least one loading="lazy" <img>');
      for (const tag of lazyImgs) {
        assert.ok(
          /decoding=["']async["']/.test(tag),
          id + ' lazy <img> missing decoding="async": ' + tag
        );
      }
    });
  }

  if (failed) {
    console.error('\naudit-performance.test.js: FAILED');
    process.exit(1);
  }
  console.log('\naudit-performance.test.js: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
