'use strict';
/**
 * Instafidget correction oracle — 12-month free bonus + same-browser new tab.
 *
 * Owner correction (VISION §7 / PRODUCT / AGENTS after clarification):
 *   - Instafidget is NOT a separately paid Site Builder add-on.
 *   - Site Builder includes Instafidget free for 12 months; then Instafidget Free
 *     with watermark unless the customer upgrades in Instafidget.
 *   - Editor must open as a normal new tab in the same browser (_blank), not a
 *     named popup with width/height features. Preserve noopener.
 *
 * Run: node bot/test/instafidget-tab-correction.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
/** Required base for this correction card (docs already corrected). */
const PARENT_SHA = '540ad0572afb47f279bb6b6d7da0a78c2a9f5a8f';

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

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function extractConnectInstagram(appSrc) {
  const m = appSrc.match(
    /async function connectInstagram\s*\(\s*\)\s*\{[\s\S]*?\n\}/
  );
  assert.ok(m, 'connectInstagram() must exist in builder/app.js');
  return m[0];
}

function extractPartnerNoteText(html) {
  const m = html.match(/id=["']ig-partner-note["'][^>]*>([\s\S]*?)<\/p>/i);
  assert.ok(m, '#ig-partner-note must exist in builder/index.html');
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Causal RED on required base 540ad05 ──────────────────────────────────
check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} opens Instafidget editor as named popup`, () => {
  const app = parentBlob('builder/app.js');
  const fn = extractConnectInstagram(app);
  assert.ok(
    /window\.open\s*\(\s*session\.editorUrl\s*,\s*['"]instagram-feed-editor['"]/.test(fn),
    'parent must still use named window instagram-feed-editor'
  );
  assert.ok(
    /width\s*=\s*920|height\s*=\s*720/.test(fn),
    'parent must still pass popup size features'
  );
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} LAUNCH.md still says Instafidget is another team`, () => {
  const md = parentBlob('LAUNCH.md');
  assert.ok(
    /Instafidget is another team/i.test(md),
    'parent LAUNCH.md must still say Instafidget is another team'
  );
});

// ── HEAD: editor opens as same-browser new tab ───────────────────────────
check('HEAD connectInstagram opens editor as _blank tab without named popup/size features', () => {
  const app = headRead('builder/app.js');
  const fn = extractConnectInstagram(app);

  assert.ok(
    !/['"]instagram-feed-editor['"]/.test(fn),
    'must not use named popup target instagram-feed-editor'
  );
  assert.ok(
    !/width\s*=\s*\d+|height\s*=\s*\d+/.test(fn),
    'must not pass popup width/height features'
  );
  // window.open(url, '_blank', 'noopener') or equivalent without sizing
  assert.ok(
    /window\.open\s*\(\s*session\.editorUrl\s*,\s*['"]_blank['"]/.test(fn),
    'must open with target _blank'
  );
  assert.ok(
    /noopener/.test(fn),
    'must preserve noopener safety'
  );
  // Guard: no leftover sized feature string on this open
  assert.ok(
    !/window\.open\s*\(\s*session\.editorUrl[\s\S]{0,120}width\s*=/.test(fn),
    'editor open must not include width= features'
  );
});

// ── HEAD: product-visible copy = 12 months free + Free watermark ─────────
check('HEAD #ig-partner-note states free 12 months then Instafidget Free (watermark)', () => {
  const html = headRead('builder/index.html');
  const note = extractPartnerNoteText(html);
  assert.ok(
    /Instafidget,\s*a partner product/i.test(note),
    'partner product framing'
  );
  assert.ok(
    /Included free for 12 months/i.test(note),
    'included free for 12 months'
  );
  assert.ok(
    /Instafidget Free\s*\(watermark\)/i.test(note),
    'then Instafidget Free (watermark)'
  );
});

check('HEAD product-visible surfaces have no paid-separately / separate paid add-on Instafidget copy', () => {
  const surfaces = [
    'builder/index.html',
    'builder/app.js',
    'PRODUCT.md',
    'VISION.md',
    'AGENTS.md',
    'LAUNCH.md',
    'OWNER-STRIPE-TRIAL.md',
    'README.md',
    'GO-LIVE.md',
  ];
  const stale = [
    { name: 'paid separately', re: /paid\s+separately/i },
    { name: 'separate paid add-on', re: /separate\s+paid\s+add[- ]?on/i },
    { name: 'paid add-on', re: /paid\s+add[- ]?on/i },
    { name: 'Instafidget is another team', re: /Instafidget is another team/i },
  ];
  for (const rel of surfaces) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const s of stale) {
      assert.ok(
        !s.re.test(src),
        `${rel} must not contain stale phrase: ${s.name}`
      );
    }
  }
});

check('HEAD LAUNCH.md states Instafidget 12 months free then Free watermark', () => {
  const md = headRead('LAUNCH.md');
  assert.ok(/Instafidget/i.test(md), 'LAUNCH mentions Instafidget');
  assert.ok(
    /free for 12 months|included free for 12 months/i.test(md),
    'LAUNCH: free for 12 months'
  );
  assert.ok(
    /Free with watermark|Free \(watermark\)/i.test(md),
    'LAUNCH: Free with watermark'
  );
});

check('HEAD authority docs keep 12-month free + new-tab rule', () => {
  const vision = headRead('VISION.md');
  const product = headRead('PRODUCT.md');
  const agents = headRead('AGENTS.md');
  assert.ok(
    /gratuit 12 luni|free for 12 months/i.test(vision + product + agents),
    'authority: 12 months free'
  );
  assert.ok(
    /watermark/i.test(vision + product + agents),
    'authority: watermark after year 1'
  );
  assert.ok(
    /tab nou|new tab/i.test(vision + product + agents),
    'authority: editor opens in new tab'
  );
  assert.ok(
    !/paid separately|separate paid add-on/i.test(vision + product + agents),
    'authority: not paid separately'
  );
});

// Stripe commercial model must remain untouched by this correction
check('HEAD Stripe commercial model unchanged (7-day trial, 99, renewal 29)', () => {
  const pricing = require('../pricing.js');
  assert.strictEqual(pricing.PRICE_CENTS, 9900, 'PRICE_CENTS 9900');
  assert.strictEqual(pricing.RENEWAL_CENTS, 2900, 'RENEWAL_CENTS 2900');
  const product = headRead('PRODUCT.md');
  assert.ok(/7-day trial|trial de 7/i.test(product), '7-day trial');
  assert.ok(/\b99\b/.test(product), '99 price');
  assert.ok(/29\/year|29\/an/i.test(product), '29/year renewal');
});

process.exit(failed ? 1 : 0);
