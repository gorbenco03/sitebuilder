#!/usr/bin/env node
/**
 * scripts/generate-image-variants.js — Wave7 responsive image pipeline.
 *
 * Generates 2 WebP width-variants (480w mobile, 960w desktop) per eligible
 * source JPEG in each template's images/ directory, and writes a manifest
 * (images/variants.json) that build.js reads at render time to emit
 * <picture>/srcset/sizes/width/height markup — WITHOUT ever touching the
 * original JPEG files (those stay exactly as committed, so bot/test/
 * s54-commercial-photos.test.js and s55-subject-photos.test.js, which scan
 * every *.jpg/*.png in images/ for the commercial-quality floor, keep
 * passing unmodified: this script never writes a .jpg/.png file, only .webp
 * and one .json manifest, neither of which those oracles' file-extension
 * filter matches).
 *
 * Zero npm dependencies. Uses two local command-line tools instead:
 *   - macOS `sips`   — resize (down-scale only, by target width)
 *   - `cwebp`        — encode WebP (Homebrew: `brew install webp`)
 *
 * `sips` (Apple's built-in tool) cannot itself write WebP or AVIF on this
 * machine — it has no installed codec for either format (`sips -s format
 * webp ... ` fails with "Can't write format: org.webmproject.webp", and AVIF
 * isn't in its --formats list at all). WebP was picked as "the modern format
 * plus a fallback" specifically because `cwebp` is a small, single-purpose,
 * widely-available system binary (not an npm package — nothing is added to
 * package.json / node_modules, and the *shipped* build has zero runtime
 * dependency on it) that can run once, locally, to produce real static files
 * that get committed. AVIF was rejected: this machine has no AVIF encoder at
 * all (`avifenc` not found), so it would need a *heavier* dependency
 * (ImageMagick's delegate, or a native npm module) for a marginal extra
 * saving over WebP — not worth it under the zero-new-dependency constraint.
 *
 * Excluded on purpose (not given variants):
 *   - hero images   — referenced only via CSS `background: url(...)`, never
 *                      an <img>. picture/srcset only works on <img>; a CSS
 *                      background can't pick a srcset candidate by viewport
 *                      width from a plain inline style="" attribute (no
 *                      @media inside a style attribute). Left entirely alone
 *                      — see HANDOFF-images.md for the follow-up this implies
 *                      for whoever owns template.html/styles.css.
 *   - *-og.jpg files — OpenGraph/social-preview images. Consumed once by a
 *                      crawler (Facebook/Twitter/WhatsApp link-preview bots),
 *                      never by a viewport — there is no "small" or "large"
 *                      variant of a value an <img> never renders, so a
 *                      responsive srcset buys nothing here.
 *   - unreferenced files (e.g. desserdirina/images/cover.jpg, which no
 *     preset or template.html points at) — nothing would ever serve them.
 *
 * Run: node scripts/generate-image-variants.js [templateId ...]
 *      (no args = all templates with a presets.json)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

// [targetWidth, cwebp quality] — 2 widths per source image (mobile / desktop-grid).
// Grid photo cards in every template top out well under 480 CSS px per column
// even on a 1440px viewport (2-3 column grids inside a ~1200px max-width
// container), so 960w already covers a 2x-density render of the largest
// realistic column width — no third "native" tier is needed for gallery/
// Instagram photos (only heroes are shown near full-viewport width, and
// heroes are excluded — see file header).
const VARIANT_SPECS = [
  { width: 480, quality: 68 },
  { width: 960, quality: 78 },
];

const OG_RE = /(^|[-_])og\.(jpe?g|png)$/i;

function listTemplateIds(argv) {
  if (argv.length) return argv;
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => fs.existsSync(path.join(TEMPLATES_DIR, id, 'presets.json')));
}

/** Collect "images/…" refs that appear as plain JSON strings (photos.src,
 *  instagram.gallery items, collage arrays, …) — i.e. actual <img> sources,
 *  as opposed to CSS url(...) values (hero backgrounds only in this codebase). */
function collectImgTagRefs(raw) {
  const refs = new Set();
  for (const m of raw.matchAll(/"(images\/[^"]+\.(?:jpe?g|png))"/gi)) {
    refs.add(m[1]);
  }
  return refs;
}

function jpegOrPngDims(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    const seglen = buf.readUInt16BE(i + 2);
    if (seglen < 2) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + seglen;
  }
  throw new Error('no SOF/IHDR found in ' + absPath);
}

function generateForTemplate(id) {
  const tplDir = path.join(TEMPLATES_DIR, id);
  const imgDir = path.join(tplDir, 'images');
  const presetsRaw = fs.readFileSync(path.join(tplDir, 'presets.json'), 'utf8');
  const refs = collectImgTagRefs(presetsRaw);

  const manifest = {};
  let addedBytes = 0;
  let skippedHeroOrOg = 0;
  let processed = 0;

  for (const rel of refs) {
    const name = path.basename(rel);
    if (OG_RE.test(name)) { skippedHeroOrOg++; continue; }
    const abs = path.join(tplDir, rel);
    if (!fs.existsSync(abs)) { console.warn(`  ⚠️  ${id}: missing ${rel}`); continue; }

    const { w: nativeW, h: nativeH } = jpegOrPngDims(abs);
    const ext = path.extname(name);
    const base = name.slice(0, -ext.length);

    const widths = [...new Set(VARIANT_SPECS.map((s) => Math.min(s.width, nativeW)))].sort((a, b) => a - b);
    const variants = [];

    for (const targetW of widths) {
      const spec = VARIANT_SPECS.find((s) => Math.min(s.width, nativeW) === targetW) || VARIANT_SPECS[VARIANT_SPECS.length - 1];
      const outName = `${base}-${targetW}w.webp`;
      const outPath = path.join(imgDir, outName);
      const tmpJpeg = path.join(os.tmpdir(), `wave7-${process.pid}-${base}-${targetW}.jpg`);
      try {
        if (targetW === nativeW) {
          execFileSync('cwebp', ['-quiet', '-q', String(spec.quality), '-m', '6', abs, '-o', outPath]);
        } else {
          execFileSync('sips', ['--resampleWidth', String(targetW), abs, '--out', tmpJpeg], { stdio: 'pipe' });
          execFileSync('cwebp', ['-quiet', '-q', String(spec.quality), '-m', '6', tmpJpeg, '-o', outPath]);
        }
      } finally {
        if (fs.existsSync(tmpJpeg)) fs.unlinkSync(tmpJpeg);
      }
      const bytes = fs.statSync(outPath).size;
      addedBytes += bytes;
      variants.push({ width: targetW, webp: `images/${outName}`, bytes });
    }

    manifest[rel] = { width: nativeW, height: nativeH, variants };
    processed++;
  }

  const manifestPath = path.join(imgDir, 'variants.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(
    `${id}: ${processed} images → variants, ${skippedHeroOrOg} hero/og skipped, ` +
    `+${(addedBytes / 1024).toFixed(0)}KB webp added, manifest → ${path.relative(ROOT, manifestPath)}`
  );
  return { processed, addedBytes };
}

function main() {
  const ids = listTemplateIds(process.argv.slice(2));
  let totalAdded = 0;
  for (const id of ids) {
    const { addedBytes } = generateForTemplate(id);
    totalAdded += addedBytes;
  }
  console.log(`\nTotal WebP bytes added across ${ids.length} template(s): ${(totalAdded / 1024 / 1024).toFixed(2)}MB`);
}

if (require.main === module) main();

module.exports = { collectImgTagRefs, jpegOrPngDims };
