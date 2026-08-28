'use strict';
/**
 * bot/test/s107-s106-advocate.test.js — S107 remake of S106 ADVOCATE: STILL STANDING.
 *
 * Causal leftovers on parent a25b413 (S103 ACCEPT):
 *   1. Detalii Instagram feed/profil labels still ship English "Link"
 *      (Link feed Instagram (opțional) / Link profil Instagram)
 *   2. Pay-success #success-url-text is a single nowrap run — long professionals
 *      slug clips mid-token at 390px (cabinet-s106-advoc | ate-590523/ off-box)
 *
 * Overlay RED on parent, GREEN on HEAD. Static source only.
 * Run: node bot/test/s107-s106-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'a25b4133826b7573dffe597ad8f6778f94af1d24';

const PM_SCHEMA = 'templates/product-menu/schema.json';
const PORT_SCHEMA = 'templates/portfolio/schema.json';
const LS_SCHEMA = 'templates/local-service/schema.json';
const PRO_SCHEMA = 'templates/professionals/schema.json';
const APP_CSS = 'builder/app.css';
const APP_JS = 'builder/app.js';
const INDEX_HTML = 'builder/index.html';

const BAD_EMBED = 'Link feed Instagram (opțional)';
const BAD_PROFIL = 'Link profil Instagram';
const GOOD_EMBED = 'URL feed Instafidget (opțional)';
const GOOD_PROFIL = 'Instagram profile';
const GOOD_CONTACT_IG = 'Instagram (contact section)';
const GOOD_IG_URL_PM = 'Instagram URL (https://www.instagram.com/...)';
const GOOD_IG_URL_PORT = 'Instagram URL (https://www.instagram.com/...)';

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
 * True when live success URL is still one unbroken nowrap run with no
 * slash-only soft wrap — long /live/<slug>/ can clip at 390 (S106 leak).
 * Fixed when JS inserts <wbr> (or equiv) only after path slashes so the
 * last path token stays intact and the whole URL is not a single nowrap.
 */
function successUrlIsSingleNowrapClip(css, js, html) {
  const textBlock =
    cssRule(css, '.success-url-link #success-url-text') ||
    cssRule(css, '#success-url-text');

  const childNowrap =
    textBlock && /white-space\s*:\s*nowrap/i.test(textBlock);

  const jsWbrAtSlash =
    /<wbr>/i.test(js || '') &&
    (/split\s*\(\s*['"]\/['"]\s*\)/.test(js || '') ||
      /join\s*\(\s*['"]\/<wbr>['"]/.test(js || '') ||
      /\/<wbr>/.test(js || '') ||
      /replace\s*\([^)]*\/[^)]*<wbr>/.test(js || '') ||
      /createElement\s*\(\s*['"]wbr['"]\s*\)/i.test(js || ''));

  const htmlWbr = /success-url-text[\s\S]{0,200}<wbr/i.test(html || '');

  // Segment nowrap (wrap only between path tokens) is the allowed fix.
  const segNowrap =
    cssRule(css, '.success-url-seg') ||
    cssRule(css, '.success-url-link #success-url-text .success-url-seg') ||
    cssRule(css, '#success-url-text .success-url-seg');
  const hasSegNowrap =
    segNowrap && /white-space\s*:\s*nowrap/i.test(segNowrap);

  // Parent leak: whole #success-url-text is nowrap AND no slash-only wrap path.
  if (childNowrap && !jsWbrAtSlash && !htmlWbr && !hasSegNowrap) {
    return true;
  }

  // Still a leak if no wrap-at-slash mechanism at all while text is nowrap-only.
  if (childNowrap && !jsWbrAtSlash && !htmlWbr) {
    return true;
  }

  return false;
}

/**
 * S99: slug token must not wrap at hyphen.
 * Allowed: segment nowrap, child keep-all, or JS wbr-only-after-slash.
 */
function successUrlCanSplitSlugToken(css, js, html) {
  const linkBlock = cssRule(css, '.success-url-link');
  if (!linkBlock) return true;

  if (/word-break\s*:\s*break-all/i.test(linkBlock)) return true;
  if (/overflow-wrap\s*:\s*anywhere/i.test(linkBlock)) return true;

  const textBlock =
    cssRule(css, '.success-url-link #success-url-text') ||
    cssRule(css, '#success-url-text');

  const childNowrap =
    textBlock && /white-space\s*:\s*nowrap/i.test(textBlock);
  const childKeepAll =
    textBlock && /word-break\s*:\s*keep-all/i.test(textBlock);

  const jsWbrAtSlash =
    /<wbr>/i.test(js || '') &&
    (/split\s*\(\s*['"]\/['"]\s*\)/.test(js || '') ||
      /join\s*\(\s*['"]\/<wbr>['"]/.test(js || '') ||
      /\/<wbr>/.test(js || '') ||
      /replace\s*\([^)]*\/[^)]*<wbr>/.test(js || '') ||
      /createElement\s*\(\s*['"]wbr['"]\s*\)/i.test(js || ''));

  const htmlWbr = /success-url-text[\s\S]{0,200}<wbr/i.test(html || '');

  const segNowrap =
    cssRule(css, '.success-url-seg') ||
    cssRule(css, '.success-url-link #success-url-text .success-url-seg') ||
    cssRule(css, '#success-url-text .success-url-seg');
  const hasSegNowrap =
    segNowrap && /white-space\s*:\s*nowrap/i.test(segNowrap);

  if (childNowrap || childKeepAll || jsWbrAtSlash || htmlWbr || hasSegNowrap) {
    return false;
  }

  return true;
}

function copyIsStackedColumn(css) {
  const block = cssRule(css, '.success-url-block');
  if (!block) return false;
  return (
    /flex-direction\s*:\s*column/i.test(block) ||
    /flex-flow\s*:\s*column/i.test(block)
  );
}

// ─── Causal RED on parent ───────────────────────────────────────────

check('causal RED: parent product-menu instagram.embedUrl is Link feed leftover', () => {
  const schema = parentBlob(PM_SCHEMA);
  assert.ok(schema, 'parent product-menu schema');
  const label = schemaFieldLabel(schema, 'instagram.embedUrl');
  assert.strictEqual(label, BAD_EMBED, 'parent embed label');
  assert.ok(/\bLink\b/.test(label), 'parent has English Link');
});

check('causal RED: parent portfolio instagram.embedUrl is Link feed leftover', () => {
  const schema = parentBlob(PORT_SCHEMA);
  assert.ok(schema, 'parent portfolio schema');
  const label = schemaFieldLabel(schema, 'instagram.embedUrl');
  assert.strictEqual(label, BAD_EMBED);
  assert.ok(/\bLink\b/.test(label));
});

check('causal RED: parent local-service embed+profil still English Link', () => {
  const schema = parentBlob(LS_SCHEMA);
  assert.ok(schema, 'parent local-service schema');
  const embed = schemaFieldLabel(schema, 'instagram.embedUrl');
  const profil = schemaFieldLabel(schema, 'instagram.url');
  assert.strictEqual(embed, BAD_EMBED);
  assert.strictEqual(profil, BAD_PROFIL);
  assert.ok(/\bLink\b/.test(embed) && /\bLink\b/.test(profil));
});

check('causal RED: parent professionals embed+profil still English Link', () => {
  const schema = parentBlob(PRO_SCHEMA);
  assert.ok(schema, 'parent professionals schema');
  const embed = schemaFieldLabel(schema, 'instagram.embedUrl');
  const profil = schemaFieldLabel(schema, 'instagram.url');
  assert.strictEqual(embed, BAD_EMBED);
  assert.strictEqual(profil, BAD_PROFIL);
  assert.ok(/\bLink\b/.test(embed) && /\bLink\b/.test(profil));
});

check('causal RED: parent success URL is single nowrap run (clips long slug at 390)', () => {
  const css = parentBlob(APP_CSS);
  const js = parentBlob(APP_JS);
  const html = parentBlob(INDEX_HTML);
  assert.ok(css && js && html, 'parent blobs');
  assert.ok(
    successUrlIsSingleNowrapClip(css, js, html),
    'parent #success-url-text nowrap with no wrap-at-slash'
  );
  const textBlock =
    cssRule(css, '.success-url-link #success-url-text') ||
    cssRule(css, '#success-url-text');
  assert.ok(textBlock, 'parent has #success-url-text rule');
  assert.ok(
    /white-space\s*:\s*nowrap/i.test(textBlock),
    'parent text span is nowrap'
  );
  assert.ok(
    !/<wbr>/i.test(js) || !/createElement\s*\(\s*['"]wbr['"]\s*\)/i.test(js),
    'parent JS does not insert slash-only wbr for success URL'
  );
});

// ─── GREEN on HEAD ──────────────────────────────────────────────────

const COMMERCIAL = [
  ['product-menu', PM_SCHEMA],
  ['portfolio', PORT_SCHEMA],
  ['local-service', LS_SCHEMA],
  ['professionals', PRO_SCHEMA],
];

for (const [name, rel] of COMMERCIAL) {
  check(`HEAD: ${name} instagram.embedUrl is Feed Instagram (opțional), no Link`, () => {
    const schema = read(rel);
    const label = schemaFieldLabel(schema, 'instagram.embedUrl');
    assert.ok(label, 'embedUrl label');
    assert.strictEqual(label, GOOD_EMBED, 'exact embed label: ' + label);
    assert.ok(!/\bLink\b/.test(label), 'no English Link: ' + label);
  });
}

check('HEAD: local-service instagram.url is Profil Instagram, no Link', () => {
  const label = schemaFieldLabel(read(LS_SCHEMA), 'instagram.url');
  assert.strictEqual(label, GOOD_PROFIL);
  assert.ok(!/\bLink\b/.test(label));
});

check('HEAD: professionals instagram.url is Profil Instagram, no Link', () => {
  const label = schemaFieldLabel(read(PRO_SCHEMA), 'instagram.url');
  assert.strictEqual(label, GOOD_PROFIL);
  assert.ok(!/\bLink\b/.test(label));
});

check('HEAD: restaurant/salon contact.instagram.url stays Instagram (contact section)', () => {
  const pm = schemaFieldLabel(read(PM_SCHEMA), 'contact.instagram.url');
  const port = schemaFieldLabel(read(PORT_SCHEMA), 'contact.instagram.url');
  assert.strictEqual(pm, GOOD_CONTACT_IG);
  assert.strictEqual(port, GOOD_CONTACT_IG);
});

check('HEAD: restaurant/salon instagram.url stays Instagram URL (...) / Instagram address (...)', () => {
  const pm = schemaFieldLabel(read(PM_SCHEMA), 'instagram.url');
  const port = schemaFieldLabel(read(PORT_SCHEMA), 'instagram.url');
  assert.strictEqual(pm, GOOD_IG_URL_PM);
  assert.strictEqual(port, GOOD_IG_URL_PORT);
  assert.ok(!/\bLink\b/.test(pm) && !/\bLink\b/.test(port));
});

check('HEAD: success URL is not a single nowrap clip (wrap-only-at-slash)', () => {
  const css = read(APP_CSS);
  const js = read(APP_JS);
  const html = read(INDEX_HTML);
  assert.ok(
    !successUrlIsSingleNowrapClip(css, js, html),
    'must wrap only at / (wbr) so long slug is fully readable at 390'
  );
});

check('HEAD: slash-only wbr (or segment nowrap) keeps last path token intact', () => {
  const css = read(APP_CSS);
  const js = read(APP_JS);
  const html = read(INDEX_HTML);

  const jsWbrAtSlash =
    /<wbr>/i.test(js) &&
    (/split\s*\(\s*['"]\/['"]\s*\)/.test(js) ||
      /join\s*\(\s*['"]\/<wbr>['"]/.test(js) ||
      /\/<wbr>/.test(js) ||
      /replace\s*\([^)]*\/[^)]*<wbr>/.test(js) ||
      /createElement\s*\(\s*['"]wbr['"]\s*\)/i.test(js));

  const segNowrap =
    cssRule(css, '.success-url-seg') ||
    cssRule(css, '.success-url-link #success-url-text .success-url-seg') ||
    cssRule(css, '#success-url-text .success-url-seg');
  const hasSegNowrap =
    segNowrap && /white-space\s*:\s*nowrap/i.test(segNowrap);

  assert.ok(
    jsWbrAtSlash || hasSegNowrap,
    'JS wbr-after-slash or .success-url-seg nowrap required'
  );

  // Whole #success-url-text must NOT stay nowrap (that is the 390 clip).
  const textBlock =
    cssRule(css, '.success-url-link #success-url-text') ||
    cssRule(css, '#success-url-text');
  if (textBlock && /white-space\s*:\s*nowrap/i.test(textBlock)) {
    // Only OK if segments also exist and parent nowrap is effectively overridden
    // — still forbidden for this leak: whole-URL nowrap is the clip.
    assert.fail('#success-url-text must not be nowrap on the whole URL (390 clip)');
  }

  assert.ok(
    !successUrlCanSplitSlugToken(css, js, html),
    'slug token cannot wrap at hyphen (S99)'
  );
});

check('HEAD: .success-url-block stays column (S103 Copiază under URL)', () => {
  const css = read(APP_CSS);
  assert.ok(copyIsStackedColumn(css), '.success-url-block is column');
});

check('HEAD: .success-url-link itself has no nowrap and no break-all (S67/S95)', () => {
  const css = read(APP_CSS);
  const block = cssRule(css, '.success-url-link');
  assert.ok(block, '.success-url-link rule');
  assert.ok(
    !/white-space\s*:\s*nowrap/i.test(block),
    'no white-space:nowrap on .success-url-link itself'
  );
  assert.ok(
    !/word-break\s*:\s*break-all/i.test(block),
    'no word-break:break-all on .success-url-link'
  );
  assert.ok(
    !/overflow-wrap\s*:\s*anywhere/i.test(block),
    'no overflow-wrap:anywhere on .success-url-link'
  );
  assert.ok(
    !/text-overflow\s*:\s*ellipsis/i.test(block),
    'no ellipsis hiding the slug'
  );
});

check('HEAD: showSuccessScreen wires slash-only soft breaks into #success-url-text', () => {
  const js = read(APP_JS);
  // Must touch success-url-text and insert wbr / path split (not textContent-only).
  assert.ok(
    /function showSuccessScreen/.test(js),
    'showSuccessScreen present'
  );
  const m = js.match(/function showSuccessScreen\s*\([^)]*\)\s*\{/);
  assert.ok(m, 'showSuccessScreen signature');
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let i = start;
  for (; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = js.slice(start, i + 1);
  assert.ok(
    /createElement\s*\(\s*['"]wbr['"]\s*\)/i.test(body) ||
      /\/<wbr>/.test(body) ||
      (/innerHTML/.test(body) && /wbr/i.test(body)) ||
      (/split\s*\(\s*['"]\/['"]\s*\)/.test(body) && /wbr/i.test(body)),
    'showSuccessScreen must insert slash-only wbr (not plain textContent only)'
  );
  // Must not use break-all style injection
  assert.ok(!/break-all/.test(body), 'no break-all in showSuccessScreen');
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nAll s107-s106-advocate checks passed');
