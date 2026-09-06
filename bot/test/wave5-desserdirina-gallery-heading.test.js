'use strict';
/**
 * Wave5 desserdirina — gallery heading + layout prominence (audit medium #4).
 *
 * "Galerie fără titlu, minusculă în layout chiar necoruptă" — on the template
 * whose whole value proposition is photography, the photo section shipped
 * with an EMPTY heading (both presets set galleryTitle: "") and photo tiles
 * sized only by a single fixed `height: 320px` with the width left to
 * whatever the uploaded photo's aspect ratio produced.
 *
 * Fix: presets now ship a real Romanian heading + category copy, schema.json
 * makes galleryTitle a required field going forward, template.html adds a
 * section eyebrow, and styles.css gives the gallery a larger, viewport-
 * responsive tile size instead of a single small fixed height.
 *
 * Run: node bot/test/wave5-desserdirina-gallery-heading.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite, TEMPLATE_DIR } = require('./wave5-desserdirina-helpers.js');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
  }
}

check('RED (pre-Wave5 / HEAD): both presets ship a blank galleryTitle', () => {
  const before = buildSite({ state: 'before' });
  const cfg = JSON.parse(fs.readFileSync(path.join(before.dir, 'config.json'), 'utf8'));
  assert.strictEqual(cfg.galleryTitle, '', 'expected the pre-fix preset to reproduce the reported bug (blank title)');
  const html = fs.readFileSync(path.join(before.dir, 'index.html'), 'utf8');
  assert.match(html, /<h2 class="section-title gallery-heading" id="gallery-heading"><\/h2>/, 'expected an empty rendered heading, matching the audit finding');
});

check('RED (pre-Wave5 / HEAD): gallery photo tiles are sized only by a single fixed height (no explicit width)', () => {
  const css = require('child_process')
    .execFileSync('git', ['-C', TEMPLATE_DIR, 'show', 'HEAD:templates/desserdirina/styles.css'], { encoding: 'utf8' })
    .toString();
  const rule = css.match(/\.collage-photo\s*\{([^}]*)\}/)[1];
  assert.match(rule, /height:\s*320px/);
  assert.match(rule, /width:\s*auto/, 'expected the pre-fix rule to leave width unconstrained (auto), driven only by each photo\'s own aspect ratio');
});

check('GREEN (current): both presets ship a real, non-empty Romanian gallery heading', () => {
  const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'presets.json'), 'utf8')).presets;
  assert.ok(presets.length >= 1);
  for (const p of presets) {
    const title = p.config.galleryTitle;
    assert.ok(typeof title === 'string' && title.trim().length > 0, p.id + ' galleryTitle must be non-empty');
    assert.ok(/[ăâîșț]/i.test(title) || /[a-zA-Z]/.test(title), p.id + ' galleryTitle should be readable Romanian text');
    const cat = p.config.categories[0];
    assert.ok(cat.title && cat.title.trim().length > 0, p.id + ' first category title must be non-empty');
  }
});

check('GREEN (current): schema.json requires galleryTitle going forward', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'schema.json'), 'utf8'));
  const field = schema.sections.flatMap((s) => s.fields).find((f) => f.key === 'galleryTitle');
  assert.ok(field, 'galleryTitle field must exist in schema');
  assert.strictEqual(field.required, true, 'galleryTitle should be required so future sites cannot ship blank');
});

check('GREEN (current): rendered gallery heading is non-empty and has an eyebrow label above it', () => {
  const after = buildSite({ state: 'after' });
  const html = fs.readFileSync(path.join(after.dir, 'index.html'), 'utf8');
  assert.match(html, /<h2 class="section-title gallery-heading" id="gallery-heading">[^<]+<\/h2>/, 'heading must render with real text');
  assert.match(html, /class="gallery-header"/, 'gallery must have a header wrapper');
  assert.match(html, /gallery-header">\s*<p class="section-eyebrow">/, 'gallery header should carry an eyebrow label like the other sections');
});

check('GREEN (current): gallery photo tiles reserve BOTH width and height (fixed box, not "auto")', () => {
  const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8');
  const rule = css.match(/\.collage-photo\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /width:\s*auto/, 'width must no longer be "auto" (that starved the layout of a real footprint and blocked CLS reservation)');
  assert.match(rule, /width:\s*clamp\(/, 'width should scale with viewport (clamp) instead of a bare fixed px, for a bigger presence on large screens');
  assert.match(rule, /height:\s*clamp\(/);
});

if (failed) {
  console.error('\n' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('\nOK wave5-desserdirina-gallery-heading');
