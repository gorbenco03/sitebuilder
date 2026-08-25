'use strict';
/**
 * bot/test/s95-s94-advocate.test.js — S95 remake of S94 ADVOCATE: STILL STANDING leaks.
 *
 * Causal leftovers on parent 33649fa (S92 ACCEPT):
 *   1. Restaurant/Salon Detalii: English "Link Instagram" on contact.instagram.url + instagram.url
 *   2. Detalii URL fields mid-clip long Instagram handles (native single-line / ellipsis)
 *   3. Pay-success .success-url-link word-break:break-all splits live slug mid-token
 *   4. Restaurant first-preset about undiacritic "Gatim seara"
 *
 * Overlay RED on parent, GREEN on HEAD. Static source only.
 * Run: node bot/test/s95-s94-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '33649fa9891026c53b931ab83da1f99b66a013ee';

const PM_SCHEMA = 'templates/product-menu/schema.json';
const PORT_SCHEMA = 'templates/portfolio/schema.json';
const PM_PRESETS = 'templates/product-menu/presets.json';
const APP_CSS = 'builder/app.css';
const APP_JS = 'builder/app.js';
const INDEX_HTML = 'builder/index.html';

const BAD_CONTACT_IG_LABEL = 'Link Instagram pentru secțiunea contact';
const BAD_IG_URL_LABEL = 'Link complet Instagram (https://www.instagram.com/...)';
const GOOD_CONTACT_IG = 'Instagram (contact section)';
const GOOD_IG_URL = 'Instagram URL (https://www.instagram.com/...)';
// Causal-RED constants: the pre-translation Romanian about text (checked against git history).
const GATIM_BAD = 'Gatim seara';
const GATIM_GOOD = 'Gătim seara';
// HEAD constants: ASCII-hyphen mojibake vs the correct typographic em dash in the
// finished English about copy — same "finished, not degraded" invariant, new language.
const COOK_BAD_EN = 'We cook at night -';
const COOK_GOOD_EN = 'We cook at night —';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

function parentBlob(rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function schemaFieldLabel(schemaText, key) {
  const schema = JSON.parse(schemaText);
  let found = null;
  function walk(n) {
    if (found) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (n.key === key && typeof n.label === 'string') found = n.label;
      Object.values(n).forEach(walk);
    }
  }
  walk(schema);
  return found;
}

function firstPresetAbout(presetsJsonText) {
  const body = JSON.parse(presetsJsonText);
  const presets = body.presets || [];
  assert.ok(presets.length >= 1, 'product-menu has presets');
  const about = presets[0] && presets[0].config && presets[0].config.business
    ? presets[0].config.business.about
    : '';
  return String(about || '');
}

/** Extract a CSS rule block for selector (first match, non-greedy). */
function cssRule(css, selector) {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}',
    'i'
  );
  const m = css.match(re);
  return m ? m[0] : null;
}

/**
 * Success-url mid-slug leak: word-break:break-all (or overflow-wrap:anywhere alone
 * without a slug-preserving alternative) on .success-url-link.
 */
function successUrlSplitsSlug(css) {
  const block = cssRule(css, '.success-url-link');
  if (!block) return false;
  const breakAll = /word-break\s*:\s*break-all/i.test(block);
  const anywhere = /overflow-wrap\s*:\s*anywhere/i.test(block);
  // Horizontal scroll / keep-all / soft breaks at / are OK alternatives.
  const scrollSafe =
    /overflow-x\s*:\s*auto/i.test(block) ||
    /overflow-x\s*:\s*scroll/i.test(block) ||
    /word-break\s*:\s*keep-all/i.test(block);
  if (scrollSafe && !breakAll) return false;
  return breakAll || (anywhere && breakAll);
}

/**
 * Detalii URL field still mid-clips: no dedicated URL field rule that allows
 * wrap or horizontal scroll, and no field-input--url class wiring.
 */
function detaliiUrlStillClips(css, js) {
  const hasUrlClassRule =
    /\.field-input--url\b/.test(css) ||
    /\.field-input\[type\s*=\s*["']url["']\]/.test(css) ||
    /textarea\.field-input--url|\.field-textarea--url/.test(css);
  if (!hasUrlClassRule) {
    // Parent: plain .field-input only — native single-line clip.
    return true;
  }
  const urlRule =
    cssRule(css, '.field-input--url') ||
    css.match(/\.field-input\[type\s*=\s*["']url["']\]\s*\{[^}]+\}/i) ||
    cssRule(css, '.field-textarea--url');
  const block = Array.isArray(urlRule) ? urlRule[0] : urlRule;
  if (!block) return true;
  const ellipsisClip =
    /text-overflow\s*:\s*ellipsis/i.test(block) &&
    /white-space\s*:\s*nowrap/i.test(block);
  if (ellipsisClip) return true;
  const allowsRead =
    /overflow-x\s*:\s*auto/i.test(block) ||
    /overflow-x\s*:\s*scroll/i.test(block) ||
    /white-space\s*:\s*pre-wrap/i.test(block) ||
    /white-space\s*:\s*normal/i.test(block) ||
    /overflow-wrap/i.test(block) ||
    /word-break\s*:\s*break-word/i.test(block) ||
    /word-break\s*:\s*normal/i.test(block);
  // JS must actually apply the class / use wrap-capable control for url fields.
  const jsWires =
    /field-input--url|field-textarea--url|type\s*===\s*['"]url['"]/.test(js || '');
  return !(allowsRead && jsWires);
}

// ─── Causal RED on parent ───────────────────────────────────────────

check('causal RED: parent product-menu contact.instagram.url is Link Instagram leftover', () => {
  const schema = parentBlob(PM_SCHEMA);
  assert.ok(schema, 'parent product-menu schema');
  const label = schemaFieldLabel(schema, 'contact.instagram.url');
  assert.strictEqual(label, BAD_CONTACT_IG_LABEL, 'parent contact ig url label');
  assert.ok(/\bLink\b/.test(label), 'parent has English Link');
});

check('causal RED: parent product-menu instagram.url has English Link', () => {
  const schema = parentBlob(PM_SCHEMA);
  assert.ok(schema, 'parent product-menu schema');
  const label = schemaFieldLabel(schema, 'instagram.url');
  assert.ok(label, 'instagram.url label');
  assert.ok(/\bLink\b/.test(label), 'parent ig.url has Link: ' + label);
  assert.ok(
    label === BAD_IG_URL_LABEL || /Link complet Instagram/i.test(label),
    'parent ig.url is Link complet leftover: ' + label
  );
});

check('causal RED: parent portfolio contact.instagram.url is Link Instagram leftover', () => {
  const schema = parentBlob(PORT_SCHEMA);
  assert.ok(schema, 'parent portfolio schema');
  const label = schemaFieldLabel(schema, 'contact.instagram.url');
  assert.strictEqual(label, BAD_CONTACT_IG_LABEL, 'parent portfolio contact ig');
  assert.ok(/\bLink\b/.test(label), 'parent portfolio has English Link');
});

check('causal RED: parent restaurant first-preset about has Gatim seara', () => {
  const presets = parentBlob(PM_PRESETS);
  assert.ok(presets, 'parent presets');
  const about = firstPresetAbout(presets);
  assert.ok(about.includes(GATIM_BAD), 'parent has Gatim seara');
  assert.ok(!about.includes(GATIM_GOOD), 'parent lacks Gătim seara');
});

check('causal RED: parent success-url-link word-break break-all splits slug', () => {
  const css = parentBlob(APP_CSS);
  assert.ok(css, 'parent css');
  const block = cssRule(css, '.success-url-link');
  assert.ok(block, 'parent .success-url-link rule');
  assert.ok(
    /word-break\s*:\s*break-all/i.test(block),
    'parent has word-break:break-all on success url'
  );
  assert.ok(successUrlSplitsSlug(css), 'parent success url splits slug token');
});

check('causal RED: parent Detalii URL fields still mid-clip long handles', () => {
  const css = parentBlob(APP_CSS);
  const js = parentBlob(APP_JS);
  assert.ok(css && js, 'parent css+js');
  assert.ok(
    detaliiUrlStillClips(css, js),
    'parent Detalii URL fields still native-clip'
  );
});

// ─── GREEN on HEAD ──────────────────────────────────────────────────

check('HEAD: product-menu contact.instagram.url is commercial English without Link', () => {
  const schema = read(PM_SCHEMA);
  const urlLabel = schemaFieldLabel(schema, 'contact.instagram.url');
  const textLabel = schemaFieldLabel(schema, 'contact.instagram.label');
  assert.ok(urlLabel, 'url label');
  assert.notStrictEqual(urlLabel, BAD_CONTACT_IG_LABEL);
  assert.ok(!/\bLink\b/.test(urlLabel), 'no English Link: ' + urlLabel);
  assert.ok(
    urlLabel.includes('Instagram') && /\(contact section\)/i.test(urlLabel),
    'Instagram (contact section)-style: ' + urlLabel
  );
  assert.strictEqual(urlLabel, GOOD_CONTACT_IG, 'exact family label');
  assert.ok(textLabel, 'text label');
  assert.ok(!/Textul linkului Instagram/i.test(textLabel), 'no Textul linkului Instagram');
  assert.ok(
    /Instagram label/i.test(textLabel),
    'text label commercial: ' + textLabel
  );
});

check('HEAD: product-menu instagram.url has no English Link', () => {
  const schema = read(PM_SCHEMA);
  const label = schemaFieldLabel(schema, 'instagram.url');
  assert.ok(label, 'instagram.url label');
  assert.ok(!/\bLink\b/.test(label), 'no English Link: ' + label);
  assert.ok(
    /Instagram URL/i.test(label) && /instagram\.com/i.test(label),
    'Instagram URL (...): ' + label
  );
  assert.strictEqual(label, GOOD_IG_URL, 'exact feed url label');
});

check('HEAD: portfolio contact.instagram.url same commercial English (no Link)', () => {
  const schema = read(PORT_SCHEMA);
  const urlLabel = schemaFieldLabel(schema, 'contact.instagram.url');
  const textLabel = schemaFieldLabel(schema, 'contact.instagram.label');
  const igUrl = schemaFieldLabel(schema, 'instagram.url');
  assert.ok(urlLabel, 'portfolio contact ig url');
  assert.notStrictEqual(urlLabel, BAD_CONTACT_IG_LABEL);
  assert.ok(!/\bLink\b/.test(urlLabel), 'portfolio no Link: ' + urlLabel);
  assert.strictEqual(urlLabel, GOOD_CONTACT_IG);
  assert.ok(textLabel && !/Textul linkului Instagram/i.test(textLabel), 'portfolio text label');
  assert.ok(/Instagram text/i.test(textLabel), 'portfolio Instagram text: ' + textLabel);
  assert.ok(igUrl && !/\bLink\b/.test(igUrl), 'portfolio ig.url no Link: ' + igUrl);
  assert.strictEqual(igUrl, 'Instagram URL (https://www.instagram.com/...)');
});

check('HEAD: restaurant first-preset about has "We cook at night —", not a stripped hyphen', () => {
  const about = firstPresetAbout(read(PM_PRESETS));
  assert.ok(about.includes(COOK_GOOD_EN), 'has "We cook at night —"');
  assert.ok(!about.includes(COOK_BAD_EN), 'no "We cook at night -" (ASCII hyphen)');
  // Full about still has the rest of the sentence (not truncated rewrite).
  assert.ok(/We cook at night\s*—/.test(about), 'em dash kept');
});

check('HEAD: success-url does not word-break:break-all the live slug', () => {
  const css = read(APP_CSS);
  const indexSrc = read(INDEX_HTML);
  const block = cssRule(css, '.success-url-link');
  assert.ok(block, '.success-url-link rule');
  assert.ok(
    !/word-break\s*:\s*break-all/i.test(block),
    'no word-break:break-all on success url (mid-slug leak)'
  );
  assert.ok(!successUrlSplitsSlug(css), 'slug token stays intact');
  // S67 still wants full visibility without ellipsis/nowrap clip.
  assert.ok(
    !/text-overflow\s*:\s*ellipsis/i.test(block),
    'no ellipsis on success url'
  );
  assert.ok(
    !/white-space\s*:\s*nowrap/i.test(block),
    'no nowrap on .success-url-link (S67)'
  );
  assert.ok(
    /overflow\s*:\s*visible|white-space\s*:\s*normal|overflow-wrap|overflow-x\s*:\s*auto/i.test(
      block
    ),
    'allows full URL visibility/scroll'
  );
  assert.ok(/success-url-text/.test(indexSrc), 'success url text span present');
});

check('HEAD: Detalii URL fields do not nowrap-ellipsis-clip long Instagram URLs', () => {
  const css = read(APP_CSS);
  const js = read(APP_JS);
  assert.ok(
    !detaliiUrlStillClips(css, js),
    'Detalii URL fields wrap or horizontal-scroll; full handle readable'
  );
  // Explicit: no ellipsis+nowrap combo on the URL field rule.
  const urlBlock =
    cssRule(css, '.field-input--url') ||
    (css.match(/\.field-input\[type\s*=\s*["']url["']\]\s*\{[^}]+\}/i) || [])[0] ||
    cssRule(css, '.field-textarea--url');
  assert.ok(urlBlock, 'dedicated URL field CSS rule');
  assert.ok(
    !(
      /text-overflow\s*:\s*ellipsis/i.test(urlBlock) &&
      /white-space\s*:\s*nowrap/i.test(urlBlock)
    ),
    'URL field must not nowrap+ellipsis clip'
  );
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nAll s95-s94-advocate checks passed');
