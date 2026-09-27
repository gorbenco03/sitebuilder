'use strict';
/**
 * bot/test/audit27-r-17-catalog-thumbnails.test.js — AUDIT-2026-09-27 R-17.
 *
 * Finding catalog-firstrun#1 / performance#1
 * (04-QA-Evidence/Audit-2026-09-27-b45a3e4/{catalog-firstrun,performance}):
 * the 5 catalog card thumbnails scripts/build-builder.js writes to
 * builder/generated/thumbs/ were the full-size hero/gallery photo copied
 * byte-for-byte (fs.copyFileSync, no resize) — up to 1600px wide, 158-327KB
 * each, ~1.24MB combined — displayed at a few hundred px per card. Under
 * Fast-3G + 4x CPU throttling, the real photos did not finish until
 * 7.3-9.4s, 2.4-3x past VISION §4.1's <=3s cold-load target.
 *
 * scripts/generate-catalog-thumbnails.js now produces a pre-shrunk, committed
 * templates/<id>/catalog-thumb.jpg (~800px long edge, recompressed) per
 * template, and scripts/build-builder.js prefers it over the full photo.
 * (Lives at the template root, not inside images/, so bot/test/s54-
 * commercial-photos.test.js / s55-subject-photos.test.js don't reject it as
 * a "leftover chip" — those scan images/ only for full-size photo floors.)
 * Both steps run on this machine (macOS, `sips` available) or must already
 * be committed — build-builder.js itself never shells out to `sips`, since
 * the Dockerfile/CI run it on `node:22.20.0-alpine`, which has no `sips`.
 *
 * This test is deliberately build-time / static-file based (no Playwright,
 * no network throttling), matching bot/test/audit-performance.test.js's
 * style: it reproduces the byte/pixel measurement the audit made, not the
 * throttled browser walkthrough (which lives in the audit's own evidence
 * script). It fails against the pre-fix code (full-photo copyFileSync -
 * every thumb over 100KB and at or above 1000px on its long edge) and
 * passes once build-builder.js prefers the shrunk source.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-17-catalog-thumbnails.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

// Generous ceilings — real numbers today are ~57-78KB and 533-800px long
// edge (see scripts/generate-catalog-thumbnails.js output). These catch a
// regression (someone reverting to the full hero) without pinning the exact
// bytes a future re-encode might shift by a few KB.
const PER_THUMB_BYTE_CEILING = 140 * 1024; // pre-fix: 158-327KB per file
const LONG_EDGE_CEILING = 900; // pre-fix: 1000-1600px
const COMBINED_BYTE_CEILING = 600 * 1024; // pre-fix: ~1.24MB combined

// Zero-dependency JPEG dimension reader (same technique as
// bot/test/audit-performance.test.js — header bytes only, no decode, so it
// reads the same on Linux as it was produced on macOS).
function jpegDimensions(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9 || offset + 4 > buf.length) break;
    const segLen = buf.readUInt16BE(offset + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF && offset + 9 <= buf.length) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + segLen;
  }
  return null;
}

test('R-17: every template has a pre-shrunk, committed catalog thumbnail source', () => {
  for (const id of TEMPLATE_IDS) {
    const thumbPath = path.join(ROOT, 'templates', id, 'catalog-thumb.jpg');
    assert.ok(fs.existsSync(thumbPath), `templates/${id}/catalog-thumb.jpg is missing`);
    const dims = jpegDimensions(thumbPath);
    assert.ok(dims, `templates/${id}/catalog-thumb.jpg has no readable JPEG SOF marker`);
    assert.ok(
      Math.max(dims.width, dims.height) <= LONG_EDGE_CEILING,
      `templates/${id}/catalog-thumb.jpg is ${dims.width}x${dims.height} — not resized (ceiling ${LONG_EDGE_CEILING}px)`
    );
    const bytes = fs.statSync(thumbPath).size;
    assert.ok(
      bytes <= PER_THUMB_BYTE_CEILING,
      `templates/${id}/catalog-thumb.jpg is ${bytes}B — not recompressed (ceiling ${PER_THUMB_BYTE_CEILING}B)`
    );
  }
});

test('R-17: build:app ships resized catalog thumbnails, not the full hero photo', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-builder.js')], {
    cwd: ROOT,
    stdio: 'pipe',
  });

  const thumbsDir = path.join(ROOT, 'builder', 'generated', 'thumbs');
  let combinedBytes = 0;

  for (const id of TEMPLATE_IDS) {
    const jpgPath = path.join(thumbsDir, id + '.jpg');
    assert.ok(fs.existsSync(jpgPath), `builder/generated/thumbs/${id}.jpg was not written by build-builder.js`);

    const dims = jpegDimensions(jpgPath);
    assert.ok(dims, `builder/generated/thumbs/${id}.jpg has no readable JPEG SOF marker`);
    assert.ok(
      Math.max(dims.width, dims.height) <= LONG_EDGE_CEILING,
      `builder/generated/thumbs/${id}.jpg is ${dims.width}x${dims.height} — the full-size hero photo is still being ` +
      `shipped to the catalog card instead of a resized thumbnail (ceiling ${LONG_EDGE_CEILING}px)`
    );

    const bytes = fs.statSync(jpgPath).size;
    assert.ok(
      bytes <= PER_THUMB_BYTE_CEILING,
      `builder/generated/thumbs/${id}.jpg is ${bytes}B — over the per-card ceiling (${PER_THUMB_BYTE_CEILING}B); ` +
      `the catalog cold-load will again miss VISION §4.1's <=3s target`
    );
    combinedBytes += bytes;
  }

  assert.ok(
    combinedBytes <= COMBINED_BYTE_CEILING,
    `builder/generated/thumbs/*.jpg total ${combinedBytes}B exceeds the combined ceiling (${COMBINED_BYTE_CEILING}B, ` +
    `pre-fix measured ~1.24MB)`
  );
});

test('R-17: the light template registry records the shipped thumbnail\'s intrinsic size', () => {
  const genPath = path.join(ROOT, 'builder', 'generated', 'templates-data.js');
  const src = fs.readFileSync(genPath, 'utf8');
  const jsonStart = src.indexOf('{');
  const jsonEnd = src.lastIndexOf('}') + 1;
  const data = JSON.parse(src.slice(jsonStart, jsonEnd));
  const byId = new Map(data.registry.templates.map((t) => [t.id, t]));

  for (const id of TEMPLATE_IDS) {
    const entry = byId.get(id);
    assert.ok(entry, `templates-data.js light registry is missing ${id}`);
    assert.ok(typeof entry.thumbWidth === 'number' && entry.thumbWidth > 0, `${id}: thumbWidth missing/invalid`);
    assert.ok(typeof entry.thumbHeight === 'number' && entry.thumbHeight > 0, `${id}: thumbHeight missing/invalid`);
    assert.ok(
      Math.max(entry.thumbWidth, entry.thumbHeight) <= LONG_EDGE_CEILING,
      `${id}: recorded thumbWidth/thumbHeight (${entry.thumbWidth}x${entry.thumbHeight}) still reflects the full photo`
    );
  }
});
