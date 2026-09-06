'use strict';
/**
 * Wave5 desserdirina — hero background must survive edits (audit critical #5).
 *
 * templates/desserdirina/template.html rendered the hero background with the
 * `background-image:` CSS property. When hero.background holds a solid
 * colour (or any value the customer typed after clearing the photo), that is
 * NOT a valid `background-image` value, so the whole hero renders empty on
 * the published site. The other four templates already use the `background`
 * shorthand, which accepts both a colour and a url(). This file proves the
 * bug against the pre-Wave5 template (git HEAD) and the fix against the
 * current working tree, using the exact same build.js render pipeline.
 *
 * Run: node bot/test/wave5-desserdirina-hero-background.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite } = require('./wave5-desserdirina-helpers.js');

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

function heroBackgroundDeclaration(html) {
  const m = html.match(/<div\s+class="hero-background"\s+style="([^"]*)"/i);
  assert.ok(m, 'hero-background element must render');
  return m[1];
}

check('RED (pre-Wave5 / HEAD): hero uses the invalid background-image property', () => {
  const before = buildSite({ state: 'before' });
  const html = fs.readFileSync(path.join(before.dir, 'index.html'), 'utf8');
  const decl = heroBackgroundDeclaration(html);
  assert.match(decl, /^background-image:/, 'expected the pre-fix template to use background-image (the bug)');
});

check('RED (pre-Wave5 / HEAD): a solid-colour hero background is invalid CSS under background-image', () => {
  const before = buildSite({ state: 'before' });
  const cfg = JSON.parse(fs.readFileSync(path.join(before.dir, 'config.json'), 'utf8'));
  cfg.hero.background = '#123456'; // customer cleared the photo and picked a colour
  fs.writeFileSync(path.join(before.dir, 'config.json'), JSON.stringify(cfg));
  const { build } = require(path.join(require.resolve('../../build.js')));
  build(before.dir);
  const html = fs.readFileSync(path.join(before.dir, 'index.html'), 'utf8');
  const decl = heroBackgroundDeclaration(html);
  // background-image: #123456 is a value the CSS parser drops entirely -> empty hero.
  assert.match(decl, /^background-image:\s*#123456/i);
});

check('GREEN (current): hero uses the background shorthand (accepts colour AND url())', () => {
  const after = buildSite({ state: 'after' });
  const html = fs.readFileSync(path.join(after.dir, 'index.html'), 'utf8');
  const decl = heroBackgroundDeclaration(html);
  assert.match(decl, /^background:\s*url\(/i, 'expected the fixed template to use the background shorthand');
  assert.ok(!/^background-image:/.test(decl), 'must not have regressed back to background-image');
});

check('GREEN (current): a solid-colour hero background renders as valid CSS under the shorthand', () => {
  const after = buildSite({ state: 'after' });
  const cfg = JSON.parse(fs.readFileSync(path.join(after.dir, 'config.json'), 'utf8'));
  cfg.hero.background = '#123456';
  fs.writeFileSync(path.join(after.dir, 'config.json'), JSON.stringify(cfg));
  const { build } = require('../../build.js');
  build(after.dir);
  const html = fs.readFileSync(path.join(after.dir, 'index.html'), 'utf8');
  const decl = heroBackgroundDeclaration(html);
  assert.strictEqual(decl.replace(/\s+/g, ''), 'background:#123456', 'background: #123456 is valid CSS (unlike background-image: #123456)');
});

if (failed) {
  console.error('\n' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('\nOK wave5-desserdirina-hero-background');
