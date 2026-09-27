#!/usr/bin/env node
'use strict';
/**
 * scripts/generate-catalog-thumbnails.js — AUDIT-2026-09-27 R-17
 * (catalog-firstrun#1 / performance#1: unresized catalog card thumbnails).
 *
 * Produces one small, recompressed JPEG per template —
 * templates/<id>/catalog-thumb.jpg — for scripts/build-builder.js to copy
 * into builder/generated/thumbs/ at build time instead of the full-size
 * hero/gallery photo. Committed like the existing responsive width-variants
 * (ARCHITECTURE §10a), for the same reason: this repo is zero-npm-dependency,
 * and the only resize tools available (macOS `sips` + Homebrew `cwebp`) do
 * not exist on the Linux box that actually runs the build
 * (Dockerfile/CI both run `node scripts/build-builder.js` on
 * `node:22.20.0-alpine`) — so the resize has to happen once, by hand, ahead
 * of time, with its *output* committed, never inside the build step itself.
 *
 * Written at the template ROOT, not inside images/: bot/test/s54-commercial-
 * photos.test.js and s55-subject-photos.test.js scan every file under
 * templates/<id>/images/ and reject anything below their full-photo size
 * floor as a "leftover chip" — this thumbnail is deliberately small, so it
 * has to live outside the directory those oracles police.
 *
 * Picks the same source photo scripts/build-builder.js's pickThumbnailSource()
 * would (duplicated here on purpose, not required from build-builder.js,
 * which has no exports and is meant to run as a script, not a library).
 *
 * Run: node scripts/generate-catalog-thumbnails.js [templateId ...]
 *      (no args = every template with a presets.json)
 *
 * Re-run by hand whenever a template's catalog-facing hero photo changes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

// ~800px on the long edge: the catalog grid shows each card's photo at well
// under 400 CSS px even on a 3-column desktop layout (.template-card-preview
// height:360px/300px), so 800px covers a 2x-density render with room to
// spare. Quality 78 matches the mid-tier already used for gallery photos in
// scripts/generate-image-variants.js's VARIANT_SPECS.
const MAX_DIMENSION = 800;
// 55, not generate-image-variants.js's 68-78: those are gallery photos shown
// large; these are ~350px catalog cards, where compression artifacts are far
// less visible, so a lower quality buys real bytes with no visible cost —
// verified by eye against q=70/q=50 renders of the same source photo.
const QUALITY = 55;

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);

function pickThumbnailSource(dir) {
  const preferred = [
    'images/cn-hero.jpg', 'images/pr-hero.jpg', 'images/ct-hero.jpg',
    'images/iv-hero.jpg', 'images/sf-hero.jpg',
    'images/torturi-1.jpg', 'images/hero.jpg',
  ];
  for (const rel of preferred) {
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  const imgDir = path.join(dir, 'images');
  if (fs.existsSync(imgDir) && fs.statSync(imgDir).isDirectory()) {
    const names = fs.readdirSync(imgDir).filter((n) => IMAGE_EXTS.has(path.extname(n).toLowerCase()));
    names.sort((a, b) => {
      try {
        return fs.statSync(path.join(imgDir, b)).size - fs.statSync(path.join(imgDir, a)).size;
      } catch (_) {
        return a.localeCompare(b);
      }
    });
    if (names.length) return path.join(imgDir, names[0]);
  }
  return null;
}

function listTemplateIds(argv) {
  if (argv.length) return argv;
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => fs.existsSync(path.join(TEMPLATES_DIR, id, 'presets.json')));
}

function jpegDims(absPath) {
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

function generateForTemplate(id) {
  const tplDir = path.join(TEMPLATES_DIR, id);
  const src = pickThumbnailSource(tplDir);
  if (!src) {
    console.log(`${id}: no local photo to shrink (fallback SVG thumbnail is already tiny) — skipped`);
    return;
  }
  const srcDims = jpegDims(src) || {};
  const longEdge = Math.max(srcDims.width || 0, srcDims.height || 0);
  if (longEdge && longEdge <= MAX_DIMENSION) {
    console.log(`${id}: source already <= ${MAX_DIMENSION}px (${srcDims.width}x${srcDims.height}) — skipped`);
    return;
  }

  const outPath = path.join(tplDir, 'catalog-thumb.jpg');
  const tmpPath = path.join(os.tmpdir(), `catalog-thumb-${process.pid}-${id}.jpg`);
  try {
    execFileSync('sips', [
      '-Z', String(MAX_DIMENSION),
      '--setProperty', 'formatOptions', String(QUALITY),
      src,
      '--out', tmpPath,
    ], { stdio: 'pipe' });
    fs.copyFileSync(tmpPath, outPath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }

  const outDims = jpegDims(outPath);
  const srcBytes = fs.statSync(src).size;
  const outBytes = fs.statSync(outPath).size;
  console.log(
    `${id}: ${path.relative(ROOT, src)} (${srcDims.width}x${srcDims.height}, ${srcBytes}B) -> ` +
    `${path.relative(ROOT, outPath)} (${outDims.width}x${outDims.height}, ${outBytes}B, ` +
    `-${(100 - (outBytes / srcBytes) * 100).toFixed(0)}%)`
  );
}

function main() {
  const ids = listTemplateIds(process.argv.slice(2));
  for (const id of ids) generateForTemplate(id);
}

main();
