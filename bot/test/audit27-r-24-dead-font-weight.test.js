'use strict';
/**
 * bot/test/audit27-r-24-dead-font-weight.test.js — oracle for R-24
 * (PLAN-AUDIT-2026-09-27.md, finding performance#3).
 *
 * templates/desserdirina/fonts/ shipped montserrat-300-normal-latin.woff2 +
 * montserrat-300-normal-latin-ext.woff2 (~103KB) declared via @font-face for
 * font-weight:300, but no other CSS rule in the template ever sets
 * font-weight:300 — dead weight copied into every customer export/ZIP and
 * into the browser-builder's generated payload.
 *
 * Fix: the two @font-face blocks + the two font files are removed, and
 * scripts/build-builder.js now only copies a template font file when its
 * name is actually referenced by a url('fonts/…') in that template's CSS —
 * so a future unreferenced font in any template's fonts/ dir is skipped
 * automatically instead of shipping unconditionally.
 *
 * This must fail against the commit this task started from (BEFORE_REF,
 * fbe893f — montserrat-300 present and shipped) and pass on the current
 * working tree.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-24-dead-font-weight.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'desserdirina');

// The commit this task branched from — pins the RED case to a fixed point in
// history so this oracle keeps proving the bug existed, even long after the
// fix is merged and HEAD has moved on. See wave5-desserdirina-helpers.js for
// the same pattern.
const BEFORE_REF = 'fbe893f';

const DEAD_FILES = ['montserrat-300-normal-latin.woff2', 'montserrat-300-normal-latin-ext.woff2'];

function readGitFile(ref, relPath) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    return null;
  }
}

function listGitDir(ref, relDir) {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-tree', '--name-only', ref, relDir + '/'], { encoding: 'utf8' });
    return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => path.basename(l));
  } catch (e) {
    return [];
  }
}

/** font-weight declarations outside any @font-face block (i.e. rules that
 *  would actually USE a weight, as opposed to merely declaring the font
 *  face for it). */
function weightsUsedOutsideFontFace(css) {
  const withoutFontFaceBlocks = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  const matches = withoutFontFaceBlocks.match(/font-weight:\s*(\d+)/g) || [];
  return matches.map((m) => m.replace(/[^\d]/g, ''));
}

// ── RED: at the commit this task started from, the dead weight 300 fonts
//    were declared, shipped as files, and NOT used by any other CSS rule ──
test('R-24 RED: at ' + BEFORE_REF + ', montserrat-300 was dead weight shipped by the template', () => {
  const css = readGitFile(BEFORE_REF, 'templates/desserdirina/styles.css');
  assert.ok(css, 'expected templates/desserdirina/styles.css to exist at ' + BEFORE_REF);

  // The two font files existed and were committed.
  const fontsAtRef = listGitDir(BEFORE_REF, 'templates/desserdirina/fonts');
  for (const f of DEAD_FILES) {
    assert.ok(fontsAtRef.includes(f), `expected ${f} to be present at ${BEFORE_REF} (pre-fix), reproducing the finding`);
  }

  // @font-face declared font-weight:300 for Montserrat...
  assert.match(css, /@font-face[\s\S]{0,200}font-family:\s*'Montserrat'[\s\S]{0,120}font-weight:\s*300/,
    'expected a Montserrat font-weight:300 @font-face block at ' + BEFORE_REF);

  // ...but nothing outside @font-face blocks ever asks for weight 300 —
  // i.e. the declared face was genuinely unused, confirming the finding's repro.
  const usedWeights = weightsUsedOutsideFontFace(css);
  assert.ok(!usedWeights.includes('300'), 'expected font-weight:300 to be unused outside @font-face at ' + BEFORE_REF + ' (that IS the bug)');
});

// ── GREEN: current working tree ships neither the dead @font-face rule nor
//    the two font files ──
test('R-24 GREEN: templates/desserdirina no longer declares or ships font-weight:300', () => {
  const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8');
  assert.ok(!/font-weight:\s*300/.test(css), 'styles.css must not declare font-weight:300 anywhere (dead @font-face removed)');
  assert.ok(!/font-family:\s*'Montserrat'[\s\S]{0,120}font-weight:\s*300/.test(css), 'no Montserrat @font-face for weight 300 must remain');

  const filesOnDisk = fs.readdirSync(path.join(TEMPLATE_DIR, 'fonts'));
  for (const f of DEAD_FILES) {
    assert.ok(!filesOnDisk.includes(f), `${f} must be deleted from templates/desserdirina/fonts/`);
  }

  // Sanity: the fonts that ARE still used remain (weight 400/500/600 Montserrat,
  // Cormorant Garamond 400/500/600/700) — this fix must not have over-deleted.
  assert.ok(filesOnDisk.includes('montserrat-400-normal-latin.woff2'), 'montserrat-400 (used) must still ship');
  assert.ok(filesOnDisk.includes('cormorant-garamond-400-normal-latin.woff2'), 'cormorant-garamond-400 (used) must still ship');
});

// ── GREEN: the export path (bot/site-export.js copies templates/<id>/fonts/
//    verbatim) can no longer ship the dead files, because they no longer
//    exist on disk to copy ──
test('R-24 GREEN: nothing on disk under templates/desserdirina/fonts/ can leak montserrat-300 into an export', () => {
  const filesOnDisk = fs.readdirSync(path.join(TEMPLATE_DIR, 'fonts'));
  assert.strictEqual(filesOnDisk.length, 18, 'expected exactly 18 font files (20 minus the 2 dead montserrat-300 ones)');
  for (const f of filesOnDisk) {
    assert.ok(!f.includes('montserrat-300'), 'no montserrat-300 file may remain in templates/desserdirina/fonts/: ' + f);
  }
});

// ── GREEN: the real build-builder.js pipeline (browser-builder payload)
//    also excludes the dead fonts, and its copy-loop is now guarded by CSS
//    reference generally — not just because the files happen to be gone ──
test('R-24 GREEN: scripts/build-builder.js only copies fonts referenced by the template CSS', () => {
  // Run the real build script against the real repo (it always writes to
  // builder/generated/ — this proves the actual production pipeline, not a
  // re-implementation of it).
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-builder.js')], { cwd: ROOT, stdio: 'pipe' });

  const generatedFontsDir = path.join(ROOT, 'builder', 'generated', 'template-assets', 'desserdirina', 'fonts');
  assert.ok(fs.existsSync(generatedFontsDir), 'expected builder/generated/template-assets/desserdirina/fonts/ to exist after build:app');
  const generated = fs.readdirSync(generatedFontsDir);
  assert.strictEqual(generated.length, 18, 'expected exactly 18 generated font files for desserdirina');
  for (const f of generated) {
    assert.ok(!f.includes('montserrat-300'), 'generated builder payload must not include montserrat-300: ' + f);
  }

  // Read back the guard itself: the copy loop must check CSS reference
  // before copying, so a hypothetical future orphaned font file (present on
  // disk, referenced by no @font-face) would also be skipped — not just
  // "happens to work because these two files were deleted".
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-builder.js'), 'utf8');
  assert.match(
    src,
    /if\s*\(\s*!\s*files\.stylesCss\.includes\(\s*'fonts\/'\s*\+\s*name\s*\)\s*\)\s*continue;/,
    'build-builder.js font-copy loop must skip any font file not referenced by url(\'fonts/<name>\') in that template\'s CSS'
  );
});
