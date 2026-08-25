'use strict';
/**
 * bot/test/s103-s101-qa-fail.test.js — S103 remake of S101 QA FAIL leak.
 *
 * Causal leftover on parent b3d7d34 (S99 ACCEPT):
 *   Professionals pay-success live URL with long slug paints under Copiază.
 *   #success-url-text is nowrap/keep-all (S99 green) but .success-url-block is a
 *   single horizontal flex row: URL + #btn-copy-url share one line, so the tail
 *   of /live/cabinet-s101-413850/ sits under Copiază (visible cabinet-s101-4).
 *
 * Overlay RED on parent, GREEN on HEAD. Static source only.
 * Run: node bot/test/s103-s101-qa-fail.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'b3d7d349fa197603553b53c02f616a16910cd355';

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
 * True when Copiază can sit as a same-row sibling that steals width from the
 * live URL (parent leak). Fixed when:
 *   - .success-url-block is column, OR
 *   - .success-url-block wraps and the URL takes full row (flex: 1 1 100% / basis 100%), OR
 *   - markup places #btn-copy-url outside the URL row after a full-width URL container
 */
function copyCanCoverSuccessUrl(css, html) {
  const block = cssRule(css, '.success-url-block');
  if (!block) return true;

  const isColumn =
    /flex-direction\s*:\s*column/i.test(block) ||
    /flex-flow\s*:\s*column/i.test(block);

  if (isColumn) return false;

  const wraps =
    /flex-wrap\s*:\s*wrap/i.test(block) ||
    /flex-flow\s*:\s*[^;]*wrap/i.test(block);

  const linkBlock = cssRule(css, '.success-url-link');
  const linkFullRow =
    linkBlock &&
    (/flex\s*:\s*1\s+1\s+100%/i.test(linkBlock) ||
      /flex-basis\s*:\s*100%/i.test(linkBlock) ||
      /width\s*:\s*100%/i.test(linkBlock) ||
      /flex\s*:\s*[^;]*100%/i.test(linkBlock));

  if (wraps && linkFullRow) return false;

  // Markup: button not a peer of the link inside .success-url-block
  // e.g. URL in its own full-width wrapper, button after the block
  const blockHtml = (html || '').match(
    /class=["'][^"']*success-url-block[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div class="success-actions"|$)/i
  );
  if (blockHtml) {
    const inner = blockHtml[1];
    const hasLink = /id=["']success-url-link["']/.test(inner);
    const hasCopy = /id=["']btn-copy-url["']/.test(inner);
    // Button outside the block entirely
    if (hasLink && !hasCopy) return false;
  }

  // Default parent: horizontal flex row, link + button siblings
  const isFlex = /display\s*:\s*flex/i.test(block);
  if (!isFlex) {
    // non-flex: still leak if button is inline sibling without full-width URL
    return true;
  }

  return true;
}

/** S99: slug token must not wrap at hyphen. */
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
      /replace\s*\([^)]*\/[^)]*<wbr>/.test(js || ''));

  const htmlWbr = /success-url-text[\s\S]{0,200}<wbr/i.test(html || '');

  if (childNowrap || childKeepAll || jsWbrAtSlash || htmlWbr) {
    return false;
  }

  return true;
}

// ─── Causal RED on parent ───────────────────────────────────────────

check('causal RED: parent .success-url-block keeps URL + Copiază on one horizontal row', () => {
  const css = parentBlob(APP_CSS);
  const html = parentBlob(INDEX_HTML);
  assert.ok(css && html, 'parent blobs');
  assert.ok(
    copyCanCoverSuccessUrl(css, html),
    'parent still places #btn-copy-url as same-row sibling that can cover URL'
  );

  const block = cssRule(css, '.success-url-block');
  assert.ok(block, 'parent .success-url-block');
  assert.ok(/display\s*:\s*flex/i.test(block), 'parent block is flex');
  assert.ok(
    !/flex-direction\s*:\s*column/i.test(block),
    'parent is not column'
  );
  assert.ok(
    !/flex-wrap\s*:\s*wrap/i.test(block),
    'parent does not wrap'
  );

  // HTML: link and button are both inside .success-url-block
  assert.ok(
    /success-url-block[\s\S]*?id=["']success-url-link["'][\s\S]*?id=["']btn-copy-url["']/i.test(
      html
    ),
    'parent markup has link then Copiază inside success-url-block'
  );
});

// ─── GREEN on HEAD ──────────────────────────────────────────────────

check('HEAD: Copiază no longer same-row covers #success-url-text', () => {
  const css = read(APP_CSS);
  const html = read(INDEX_HTML);
  assert.ok(
    !copyCanCoverSuccessUrl(css, html),
    'layout must give URL full row width (column or wrap+full-basis URL)'
  );
});

check('HEAD: slug token still cannot wrap at hyphen (S99)', () => {
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

check('HEAD: #success-url-text keeps nowrap or keep-all or slash-only wbr', () => {
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
    (/split\s*\(\s*['"]\//.test(js) ||
      /\/<wbr>/.test(js) ||
      /join\s*\([^)]*wbr/i.test(js));
  assert.ok(
    childNowrap || childKeepAll || jsWbr,
    'child nowrap/keep-all or JS wbr-after-slash required'
  );
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nAll s103-s101-qa-fail checks passed');
