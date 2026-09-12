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

  // Regression ceilings. Re-measured on this tree by building twice, once with
  // minifyCss/trimJsWhitespace short-circuited to identity:
  //
  //   template        minified   unminified   ceiling
  //   product-menu       82126        89171     83800
  //   local-service     103391       110467    105500
  //   portfolio         103598       118279    105700
  //   professionals     121228       143138    123700
  //
  // Re-measured on 2026-09-12 (S9B): instagram.gallery — and, on desserdirina
  // and product-menu, the never-schema-declared instagram.posts — removed
  // from every schema.json/template.html, plus the CSS rules that only ever
  // styled that now-gone markup (.pr-ig-grid, .ls-iggrid, .pf-ig__grid,
  // .pm-ig-grid/.pm-embeds, desserdirina's whole .instagram-embeds-grid/
  // .insta-frame/.instagram-grid/.insta-card block). Both fields were dead:
  // build.js's normalizeInstagramForPublic() clears them on every render,
  // connected or not (see that function's doc comment), so no template
  // markup reading them could ever show anything. templateHtml and
  // stylesCss both shrank on all five (desserdirina isn't gated by this
  // ceiling table, but its own payload dropped ~3.3KB), tightening every
  // margin back down toward the ~2%-over-minified band this gate is meant
  // to hold — left alone, four of them would have drifted to +4–5%,
  // silently handing back the exact growth budget the note below warns
  // about.
  //
  // Re-measured twice on 2026-09-12 before that, after each wave that added
  // shipped features rather than drift. First: portfolio gained a whole
  // appointment section (schema + template + three presets) so a salon can
  // take bookings online, and professionals gained the separate native-mode
  // copy that stops the page contradicting its own booking widget. Then the
  // template pass added, across all five, real SVG social icons in place of
  // "IG"/"FB" text, contrast-safe colour tokens, a translucent panel behind
  // portfolio's price list, and product-menu's pre-paint ink picker.
  //
  // These used to sit at the midpoint between the two. That rule stopped
  // serving its purpose once the stylesheets grew long explanatory comments:
  // the minifier strips them, so the unminified figure climbed (professionals
  // 112023 -> 124892) while the shipped payload barely moved, and a midpoint
  // ceiling would have handed out ~7KB of silent growth budget.
  //
  // Re-measured on 2026-09-12 (Instagram teaser): S111 made the public
  // Instagram section disappear from the BUILDER PREVIEW too, whenever a
  // customer hadn't connected Instagram — an owner never discovered the
  // feature existed. build.js renderHtml() now sets a render-only
  // cfg.instagram.showTeaser flag in editMode when disconnected, and each
  // template's template.html + styles.css gained a fixed-contract
  // `.hb-ig-teaser` "here's an example" section (gated by
  // `<!-- @if instagram.showTeaser -->`, so it never reaches a published
  // site — see bot/test/suite10-instagram-teaser-editmode.test.js). That is
  // real shipped-feature markup+CSS, not drift, so the ceilings move up with
  // it, same as every prior wave noted above.
  //
  //   template        minified   ceiling (minified * 1.02, rounded up)
  //   product-menu       86844     88600
  //   local-service     108171    110400
  //   portfolio         108243    110500
  //   professionals     125689    128300
  //
  // Two properties have to hold, and both still do at minified + ~2%:
  //   1. Well under unminified, so deleting the minifier trips this gate. The
  //      earlier generation of these ceilings sat ABOVE the unminified size
  //      and passed happily with the minifier removed — a dead gate.
  //   2. Tight enough to notice real payload growth rather than absorb it.
  // The "embedded styles.css is smaller than the raw source" check below is
  // the direct minifier-ran assertion; this one is the growth guard.
  const HEAVY_JS_CEILING_BYTES = {
    'product-menu': 88600,
    'local-service': 110400,
    portfolio: 110500,
    professionals: 128300,
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
  //
  // Wave7 (2026-09-06, images/**) added a responsive-image pipeline:
  // scripts/generate-image-variants.js writes two WebP width-variants
  // (480w mobile, 960w desktop) per gallery/Instagram photo alongside the
  // original JPEG, so a <picture> can serve the right file per viewport
  // instead of the one-size-for-everyone photo this ceiling used to gate.
  //
  // That necessarily makes the ON-DISK images/ total bigger — 3 files per
  // photo (1 JPEG fallback + 2 WebP widths) instead of 1 — even though the
  // whole point of the change is that any ONE visitor downloads LESS than
  // before (their browser picks exactly one <picture> candidate). Disk
  // storage stopped being a faithful proxy for "bytes a visitor receives"
  // the moment variants were introduced, so the ceilings below were
  // re-measured and raised (current measured combined total: 20.15MB,
  // largest single template: local-service at 7.06MB) rather than left at
  // the pre-variant numbers, which the real regression check further down
  // — "responsive image variants exist and shrink what a phone downloads"
  // — now covers instead: it fails if a phone-sized visitor ever again ends
  // up downloading anywhere near what a desktop visitor does. These two
  // ceilings stay only to catch a raw unedited multi-MB dump (or the
  // variant generator running away and producing many more widths than
  // intended) being reintroduced.
  const IMAGE_DIR_CEILING_MB = 23; // measured 20.15MB with Wave7 variants; was 16 pre-variants
  const PER_TEMPLATE_IMAGE_DIR_CEILING_MB = 8.5; // measured max 7.06MB (local-service); was 6 pre-variants
  let totalImageBytes = 0;
  for (const id of TPLS) {
    const imgDir = path.join(ROOT, 'templates', id, 'images');
    check(`${id}: images/ directory total size is optimized`, () => {
      const bytes = dirTotalBytes(imgDir);
      totalImageBytes += bytes;
      assert.ok(
        bytes < PER_TEMPLATE_IMAGE_DIR_CEILING_MB * 1024 * 1024,
        `${imgDir} is ${(bytes / 1024 / 1024).toFixed(2)}MB, expected < ${PER_TEMPLATE_IMAGE_DIR_CEILING_MB}MB`
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

  // ── Wave7: the actual regression gate — a phone must download far less ────
  // than a desktop for the same photos. images/variants.json (written by
  // scripts/generate-image-variants.js) records every gallery/Instagram
  // photo's WebP width-variants and their real encoded byte counts. This is
  // deliberately NOT a check on the original *.jpg/*.png files — those stay
  // fully covered, unmodified, by bot/test/s54-commercial-photos.test.js and
  // bot/test/s55-subject-photos.test.js, which is also why this file's own
  // generator never writes a .jpg/.png: it would otherwise collide with
  // those oracles' "every file in images/ must clear the commercial floor"
  // scan. The floor for the format THIS check is about (WebP) is expressed
  // right here instead, per-variant, rather than by editing s54/s55: those
  // two files scan by file extension (`/\.(jpe?g|png)$/i`) and simply never
  // see a .webp file, so they remain accurate for what they've always
  // tested and needed no change.
  for (const id of TPLS) {
    const manifestPath = path.join(ROOT, 'templates', id, 'images', 'variants.json');
    check(`${id}: responsive image variants exist and shrink what a phone downloads`, () => {
      if (!fs.existsSync(manifestPath)) {
        // professionals ships only a CSS-background hero photo (no <img>
        // gallery/Instagram grid) — there is nothing to generate variants for.
        assert.strictEqual(id, 'professionals', `${id}: expected images/variants.json`);
        return;
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const entries = Object.entries(manifest);
      if (entries.length === 0) {
        // professionals ships only a CSS-background hero photo (no <img>
        // gallery/Instagram grid) — the generator correctly produced an
        // empty manifest rather than nothing at all.
        assert.strictEqual(id, 'professionals', `${id}: variants.json has no entries`);
        return;
      }

      let originalBytes = 0;
      let mobileBytes = 0;
      let desktopBytes = 0;
      for (const [rel, entry] of entries) {
        const abs = path.join(ROOT, 'templates', id, rel);
        assert.ok(fs.existsSync(abs), `${id}: variants.json references missing original ${rel}`);
        originalBytes += fs.statSync(abs).size;

        assert.ok(Array.isArray(entry.variants) && entry.variants.length >= 2,
          `${id}/${rel}: expected >= 2 width-variants, got ${entry.variants && entry.variants.length}`);
        const sorted = [...entry.variants].sort((a, b) => a.width - b.width);
        for (const v of sorted) {
          const webpAbs = path.join(ROOT, 'templates', id, v.webp);
          assert.ok(fs.existsSync(webpAbs), `${id}: missing variant file ${v.webp}`);
          assert.strictEqual(fs.statSync(webpAbs).size, v.bytes, `${id}/${v.webp}: manifest byte count is stale`);
        }
        mobileBytes += sorted[0].bytes;
        desktopBytes += sorted[sorted.length - 1].bytes;

        // The desktop/largest variant must stay real commercial scale — the
        // same 960px-wide floor s54/s55 pin on the JPEG original, expressed
        // here for the WebP a modern-browser desktop visitor actually gets.
        assert.ok(
          sorted[sorted.length - 1].width >= 960,
          `${id}/${rel}: largest variant is only ${sorted[sorted.length - 1].width}w, expected >= 960w`
        );
      }

      // The whole point of width-variants: a phone downloads far less than
      // a desktop does for the same photo set, and far less than the single
      // fixed-size JPEG every viewport used to receive pre-Wave7.
      assert.ok(
        mobileBytes < desktopBytes * 0.55,
        `${id}: mobile bytes (${mobileBytes}) not meaningfully smaller than desktop bytes (${desktopBytes})`
      );
      assert.ok(
        mobileBytes < originalBytes * 0.4,
        `${id}: mobile bytes (${mobileBytes}) not meaningfully smaller than pre-Wave7 original JPEG bytes (${originalBytes})`
      );
    });
  }

  // ── PERF-06: below-fold gallery/instagram images stay lazy + async-decoded ─
  for (const id of TPLS) {
    check(`${id}: template.html keeps loading=lazy + decoding=async on repeating gallery images`, () => {
      const html = fs.readFileSync(path.join(ROOT, 'templates', id, 'template.html'), 'utf8');
      const lazyImgs = html.match(/<img\b[^>]*loading=["']lazy["'][^>]*>/g) || [];
      if (lazyImgs.length === 0) {
        // professionals ships only a CSS-background hero photo, a nav logo
        // (above the fold, correctly eager) and a JS-populated WhatsApp QR
        // <img> (no static src to lazy-load) — no <img> gallery/Instagram
        // grid at all, same reason the variants.json check above special-
        // cases it. S9B removed its one repeating-image markup (the
        // instagram.gallery grid) as a dead field, so this template
        // legitimately has nothing left to gate on lazy-loading.
        assert.strictEqual(id, 'professionals', id + ' must keep at least one loading="lazy" <img>');
        return;
      }
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
