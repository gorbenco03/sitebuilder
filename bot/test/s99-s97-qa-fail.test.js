'use strict';
/**
 * bot/test/s99-s97-qa-fail.test.js — S99 remake of S97 QA FAIL leaks.
 *
 * Causal leftovers on parent b3e1712 (S95 ACCEPT):
 *   1. Pay-success live URL still wraps mid-slug at hyphen
 *      (#success-url-text white-space:normal + word-break:normal; parent scrolls never fire)
 *   2. Istoric Versiunea N inverted vs publishedAt (oldest-first list + length-idx numbering)
 *
 * Overlay RED on parent, GREEN on HEAD. Static source + pure numbering helper.
 * Run: node bot/test/s99-s97-qa-fail.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'b3e1712c0a903f6aaf98eeb0b3f0c28623e79509';

const APP_CSS = 'builder/app.css';
const APP_JS = 'builder/app.js';
const INDEX_HTML = 'builder/index.html';

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
 * True when the visible live URL can still split a slug token at `-`.
 * Allowed fixes: child #success-url-text nowrap/keep-all, or JS <wbr> only after `/`.
 * Forbidden: break-all / overflow-wrap:anywhere on the live URL; nowrap on .success-url-link itself.
 */
function successUrlCanSplitSlugToken(css, js, html) {
  const linkBlock = cssRule(css, '.success-url-link');
  if (!linkBlock) return true;

  // Forbidden on the link rule itself (S67/S95)
  if (/word-break\s*:\s*break-all/i.test(linkBlock)) return true;
  if (/overflow-wrap\s*:\s*anywhere/i.test(linkBlock)) return true;

  // Child text span rule — prefer dedicated #success-url-text or .success-url-link #success-url-text
  const textBlock =
    cssRule(css, '.success-url-link #success-url-text') ||
    cssRule(css, '#success-url-text');

  const childNowrap =
    textBlock && /white-space\s*:\s*nowrap/i.test(textBlock);
  const childKeepAll =
    textBlock && /word-break\s*:\s*keep-all/i.test(textBlock);

  // JS inserts <wbr> only after path slashes (slug token stays whole)
  const jsWbrAtSlash =
    /<wbr>/i.test(js || '') &&
    (/split\s*\(\s*['"]\/['"]\s*\)/.test(js || '') ||
      /join\s*\(\s*['"]\/<wbr>['"]/.test(js || '') ||
      /\/<wbr>/.test(js || '') ||
      /replace\s*\([^)]*\/[^)]*<wbr>/.test(js || ''));

  // Markup already has wbr structure (unlikely static)
  const htmlWbr = /success-url-text[\s\S]{0,200}<wbr/i.test(html || '');

  if (childNowrap || childKeepAll || jsWbrAtSlash || htmlWbr) {
    return false;
  }

  // Default parent leak: white-space normal + word-break normal on text → hyphen wrap
  return true;
}

/**
 * Simulate Istoric numbering the way loadVersions does (or should).
 * Extract the numbering strategy from app.js source and run against sample data.
 */
function extractLoadVersionsBody(js) {
  const m = js.match(/async function loadVersions\s*\([^)]*\)\s*\{/);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // at '{'
  let depth = 0;
  let i = start;
  for (; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') {
      depth--;
      if (depth === 0) {
        return js.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Derive ordered (verNum, publishedAt) pairs from loadVersions source semantics.
 * Uses static analysis of the forEach loop pattern rather than full DOM.
 */
function istoricNumberingPairs(js, versionsOldestFirst) {
  const body = extractLoadVersionsBody(js);
  assert.ok(body, 'loadVersions body');

  // Detect if source sorts by publishedAt descending before numbering
  const sortsNewestFirst =
    /publishedAt/.test(body) &&
    (/\.sort\s*\(/.test(body) || /slice\s*\(\s*\)\s*\.sort/.test(body)) &&
    (/b\.publishedAt\s*-\s*a\.publishedAt|Date\.parse\s*\(\s*b\.publishedAt\s*\)\s*-\s*Date\.parse\s*\(\s*a\.publishedAt/.test(
      body
    ) ||
      /new Date\s*\(\s*b\.publishedAt\s*\)\s*-\s*new Date\s*\(\s*a\.publishedAt/.test(
        body
      ) ||
      (/\.sort\s*\(\s*\(/.test(body) &&
        /publishedAt/.test(body) &&
        /-\s*a\.|b\s*>\s*a|b\.publishedAt/.test(body)));

  // Simpler: if body copies+sorts before forEach
  const hasSortCopy =
    /(?:sorted|ordered|byDate|versionsSorted|list)\s*=\s*[^\n;]*sort/i.test(body) ||
    /\.slice\s*\(\s*\)\s*\.sort/.test(body) ||
    /\[\s*\.\.\.\s*versions\s*\]\s*\.sort/.test(body) ||
    /versions\s*\.slice\s*\(\s*\)\s*\.sort/.test(body) ||
    (/const\s+\w+\s*=\s*[^;]*versions[^;]*sort/i.test(body));

  let ordered = versionsOldestFirst.slice();
  if (hasSortCopy || sortsNewestFirst) {
    ordered = versionsOldestFirst.slice().sort((a, b) => {
      const ta = new Date(a.publishedAt).getTime();
      const tb = new Date(b.publishedAt).getTime();
      return tb - ta; // newest first (required preference)
    });
  }

  // verNum = length - idx (highest = first in iteration order after optional sort)
  return ordered.map((v, idx) => ({
    verNum: ordered.length - idx,
    publishedAt: v.publishedAt,
  }));
}

function highestVerIsNewest(pairs) {
  assert.ok(pairs.length >= 2, 'need >=2 versions');
  const byVer = pairs.slice().sort((a, b) => b.verNum - a.verNum);
  const highest = byVer[0];
  const times = pairs.map((p) => new Date(p.publishedAt).getTime());
  const maxT = Math.max(...times);
  return new Date(highest.publishedAt).getTime() === maxT;
}

// ─── Causal RED on parent ───────────────────────────────────────────

check('causal RED: parent #success-url-text can still split slug at hyphen', () => {
  const css = parentBlob(APP_CSS);
  const js = parentBlob(APP_JS);
  const html = parentBlob(INDEX_HTML);
  assert.ok(css && js && html, 'parent blobs');
  assert.ok(
    successUrlCanSplitSlugToken(css, js, html),
    'parent still allows mid-slug hyphen wrap on success URL'
  );
  // Explicit: child has neither nowrap nor keep-all
  const textBlock =
    cssRule(css, '.success-url-link #success-url-text') ||
    cssRule(css, '#success-url-text');
  assert.ok(textBlock, 'parent has #success-url-text rule');
  assert.ok(
    !/white-space\s*:\s*nowrap/i.test(textBlock),
    'parent text span is not nowrap'
  );
  assert.ok(
    !/word-break\s*:\s*keep-all/i.test(textBlock),
    'parent text span is not keep-all'
  );
});

check('causal RED: parent Istoric assigns highest Versiunea to oldest when list is oldest-first', () => {
  const js = parentBlob(APP_JS);
  assert.ok(js, 'parent app.js');
  const t1 = '2026-08-25T05:44:00.000Z'; // older
  const t2 = '2026-08-25T05:48:00.000Z'; // newer
  const versions = [{ publishedAt: t1 }, { publishedAt: t2 }]; // oldest first
  const pairs = istoricNumberingPairs(js, versions);
  // Parent bug: no sort → idx0 gets Versiunea 2 (highest) with older t1
  assert.ok(
    !highestVerIsNewest(pairs),
    'parent pairs highest Versiunea with oldest clock: ' + JSON.stringify(pairs)
  );
  assert.strictEqual(pairs[0].verNum, 2, 'parent idx0 = Versiunea N');
  assert.strictEqual(pairs[0].publishedAt, t1, 'parent idx0 is oldest');
});

// ─── GREEN on HEAD ──────────────────────────────────────────────────

check('HEAD: success-url child prevents slug token split at hyphen', () => {
  const css = read(APP_CSS);
  const js = read(APP_JS);
  const html = read(INDEX_HTML);
  assert.ok(
    !successUrlCanSplitSlugToken(css, js, html),
    'slug token cannot wrap at hyphen'
  );
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

check('HEAD: #success-url-text (or equivalent) has nowrap or keep-all or slash-only wrap', () => {
  const css = read(APP_CSS);
  const js = read(APP_JS);
  const textBlock =
    cssRule(css, '.success-url-link #success-url-text') ||
    cssRule(css, '#success-url-text');
  const childNowrap =
    textBlock && /white-space\s*:\s*nowrap/i.test(textBlock);
  const childKeepAll =
    textBlock && /word-break\s*:\s*keep-all/i.test(textBlock);
  const jsWbr =
    /<wbr>/i.test(js) &&
    (/split\s*\(\s*['"]\/['"]/.test(js) || /\/<wbr>/.test(js) || /join\s*\([^)]*wbr/i.test(js));
  assert.ok(
    childNowrap || childKeepAll || jsWbr,
    'child nowrap/keep-all or JS wbr-after-slash required'
  );
});

check('HEAD: Istoric highest Versiunea pairs with newest publishedAt', () => {
  const js = read(APP_JS);
  const t1 = '2026-08-25T05:44:00.000Z'; // older
  const t2 = '2026-08-25T05:48:00.000Z'; // newer
  const versions = [{ publishedAt: t1 }, { publishedAt: t2 }]; // API oldest-first
  const pairs = istoricNumberingPairs(js, versions);
  assert.ok(
    highestVerIsNewest(pairs),
    'highest Versiunea must be newest clock: ' + JSON.stringify(pairs)
  );
  // Newest row first after sort
  assert.strictEqual(pairs[0].publishedAt, t2, 'newest row first');
  assert.strictEqual(pairs[0].verNum, 2, 'newest = highest Versiunea');
  assert.strictEqual(pairs[1].publishedAt, t1, 'oldest row last');
  assert.strictEqual(pairs[1].verNum, 1, 'oldest = Versiunea 1');
});

check('HEAD: loadVersions sorts a copy by publishedAt descending before numbering', () => {
  const js = read(APP_JS);
  const body = extractLoadVersionsBody(js);
  assert.ok(body, 'loadVersions');
  assert.ok(
    /\.slice\s*\(\s*\)\s*\.sort|\[\s*\.\.\.\s*versions\s*\]\s*\.sort|versions\s*\.slice\s*\(\s*\)\s*\.sort/i.test(
      body
    ) ||
      /(?:sorted|ordered|byDate|versionsSorted)\s*=/.test(body),
    'must sort a copy (not mutate API order in place without copy)'
  );
  assert.ok(
    /publishedAt/.test(body) && /\.sort\s*\(/.test(body),
    'sort uses publishedAt'
  );
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nAll s99-s97-qa-fail checks passed');
