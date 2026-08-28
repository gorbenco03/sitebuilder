'use strict';
/**
 * bot/test/wave17-w15-qa-fail.test.js — Wave 17 remake of Wave 15 QA FAIL leaks.
 *
 * Opened chrome on parent e2cf8ec (Wave 14):
 *   390 dashboard card name/slug shreds letter-by-letter (qalive-w15 → q/al/iv/e/-/w/1/5)
 *   Trial line also stacks one token per line
 *   After cancel: badge Draft but card still promises "first charge 99… on <date>"
 *
 * VISION 2026-08-26: card → 7-day trial → live now → charge day 7 unless cancel.
 * Trial first-charge line only while site is actually live/active in trial.
 *
 * Run: node bot/test/wave17-w15-qa-fail.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'e2cf8ecdcdd419f01c17a2b287665f2534678aa0';

const BUILDER_JS = 'builder/app.js';
const BUILDER_CSS = 'builder/app.css';

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

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return src.slice(m.index, i);
}

function cssRule(css, selector) {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}',
    'i'
  );
  const m = css.match(re);
  return m ? m[0] : null;
}

/**
 * True when trial first-charge line is gated on live/active status (Active badge).
 * Prefer the runtime assignment of hostLine.textContent, not comments.
 */
function trialLineRequiresLiveActive(cardSrc) {
  if (!cardSrc) return false;
  // Find the runtime trial label / textContent assignment (not the comment).
  const assignRe =
    /(?:hostLine\.textContent|trialLabel)\s*=[\s\S]{0,120}?(?:first charge|prima taxare)/;
  const m = assignRe.exec(cardSrc);
  if (!m) return false;
  const idx = m.index;
  const window = cardSrc.slice(Math.max(0, idx - 450), idx + 40);
  // live && active near the trial gate (same as Active badge).
  const liveAndActive =
    /status\s*===\s*['"]live['"]\s*\|\|\s*site\.status\s*===\s*['"]active['"]/.test(
      window
    ) ||
    /status\s*===\s*['"]active['"]\s*\|\|\s*site\.status\s*===\s*['"]live['"]/.test(
      window
    ) ||
    // const isLiveActive = site.status === 'live' || site.status === 'active';
    // if (site.paid && !hostingExpired && isLiveActive)
    (/isLiveActive/.test(window) &&
      /status\s*===\s*['"]live['"]/.test(cardSrc.slice(Math.max(0, idx - 700), idx)) &&
      /status\s*===\s*['"]active['"]/.test(cardSrc.slice(Math.max(0, idx - 700), idx)) &&
      /paid\s*&&\s*!hostingExpired\s*&&\s*isLiveActive/.test(window));
  return liveAndActive;
}

/** Parent paid-only trial gate (no live/active). */
function trialLinePaidOnlyGate(cardSrc) {
  if (!cardSrc) return false;
  // Classic W14 leak: if (site.paid && !hostingExpired) { if (isSiteInTrial(site))
  // Must NOT already include && isLiveActive / live|active in that outer if.
  const m = cardSrc.match(
    /if\s*\(\s*site\.paid\s*&&\s*!hostingExpired(\s*&&\s*[^)]+)?\s*\)\s*\{[\s\S]{0,160}?if\s*\(\s*isSiteInTrial\s*\(\s*site\s*\)\s*\)/
  );
  if (!m) return false;
  const outerExtra = m[1] || '';
  // Paid-only when outer if has no live/active / isLiveActive conjunction.
  if (/isLiveActive|status\s*===/.test(outerExtra)) return false;
  return true;
}

/** Narrow media stacks .site-card-actions so name keeps width after thumb. */
function actionsStackAtNarrow(css) {
  // @media (max-width: 390|400|420|430|480px) … .site-card-actions { flex-basis:100% / width:100% }
  const mediaRe =
    /@media\s*\(\s*max-width\s*:\s*(390|400|420|430|440|480)px\s*\)\s*\{([\s\S]*?)(?=@media|$)/gi;
  let m;
  while ((m = mediaRe.exec(css))) {
    const body = m[2];
    // Find .site-card-actions rule inside this media (may be nested depth 1)
    const act = body.match(/\.site-card-actions\s*\{([^}]*)\}/i);
    if (!act) continue;
    const decl = act[1];
    if (
      /flex-basis\s*:\s*100%/i.test(decl) ||
      /width\s*:\s*100%/i.test(decl) ||
      /flex\s*:\s*1\s+1\s+100%/i.test(decl)
    ) {
      return true;
    }
  }
  return false;
}

// ── Causal RED on parent Wave 14 / W15 FAIL HEAD ─────────────────────────
check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} .site-card-name break-word mid-shreds`, () => {
  const css = parentBlob(BUILDER_CSS);
  const block = cssRule(css, '.site-card-name');
  assert.ok(block, 'parent .site-card-name rule');
  assert.ok(
    /overflow-wrap\s*:\s*break-word/i.test(block),
    'parent .site-card-name uses overflow-wrap:break-word (letter shred at 390)'
  );
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} actions do not stack at narrow width`, () => {
  const css = parentBlob(BUILDER_CSS);
  assert.ok(
    !actionsStackAtNarrow(css),
    'parent has no narrow flex-basis:100% on .site-card-actions (actions steal name column)'
  );
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} trial line without live/active gate`, () => {
  const js = parentBlob(BUILDER_JS);
  const card = extractFunction(js, 'buildSiteCard') || '';
  assert.ok(card.length > 40, 'parent buildSiteCard');
  assert.ok(/first charge/.test(card), 'parent has first charge trial line');
  assert.ok(
    trialLinePaidOnlyGate(card),
    'parent draws trial line on paid && !hostingExpired && isSiteInTrial only'
  );
  assert.ok(
    !trialLineRequiresLiveActive(card),
    'parent does not gate trial line on live/active (Draft still promises first charge)'
  );
});

// ── HEAD GREEN ───────────────────────────────────────────────────────────
check('HEAD .site-card-name does not mid-break hyphenated slug tokens', () => {
  const css = headRead(BUILDER_CSS);
  const block = cssRule(css, '.site-card-name');
  assert.ok(block, '.site-card-name rule');
  assert.ok(
    !/overflow-wrap\s*:\s*break-word/i.test(block),
    '.site-card-name must not use overflow-wrap:break-word'
  );
  assert.ok(
    !/word-break\s*:\s*break-all/i.test(block),
    '.site-card-name must not use word-break:break-all'
  );
  assert.ok(
    !/overflow-wrap\s*:\s*anywhere/i.test(block),
    '.site-card-name must not use overflow-wrap:anywhere'
  );
  // Wrap only at spaces: normal overflow-wrap + normal word-break (or keep-all).
  assert.ok(
    /overflow-wrap\s*:\s*normal/i.test(block) ||
      /word-break\s*:\s*(normal|keep-all)/i.test(block),
    '.site-card-name wraps at spaces only (overflow-wrap/word-break normal|keep-all)'
  );
  // Still must not regress S111 nowrap+ellipsis mid-clip.
  assert.ok(
    !(
      /white-space\s*:\s*nowrap/i.test(block) &&
      /text-overflow\s*:\s*ellipsis/i.test(block)
    ),
    'must not restore nowrap+ellipsis mid-clip'
  );
});

check('HEAD .site-trial-line wraps at spaces/· not mid-token', () => {
  const css = headRead(BUILDER_CSS);
  const block =
    cssRule(css, '.site-trial-line') ||
    cssRule(css, '.site-hosting-until.site-trial-line') ||
    '';
  assert.ok(block, '.site-trial-line rule present');
  assert.ok(
    !/overflow-wrap\s*:\s*break-word/i.test(block),
    'trial line must not break-word mid-token'
  );
  assert.ok(
    !/word-break\s*:\s*break-all/i.test(block),
    'trial line must not break-all'
  );
  assert.ok(
    /overflow-wrap\s*:\s*normal/i.test(block) ||
      /word-break\s*:\s*(normal|keep-all)/i.test(block) ||
      /white-space\s*:\s*normal/i.test(block),
    'trial line uses safe wrap at spaces'
  );
});

check('HEAD narrow dashboard stacks .site-card-actions (name keeps width after thumb)', () => {
  const css = headRead(BUILDER_CSS);
  assert.ok(
    actionsStackAtNarrow(css),
    'at max-width ≤480px .site-card-actions must flex-basis/width 100% so name row is thumb+info only'
  );
});

check('HEAD trial first-charge line only while live/active (not Draft after cancel)', () => {
  const js = headRead(BUILDER_JS);
  const card = extractFunction(js, 'buildSiteCard') || '';
  assert.ok(card.length > 40, 'buildSiteCard');
  assert.ok((/7-day trial|Trial de 7|7\u2011zile|7 zile/i.test(card)) && /first charge|prima taxare/i.test(card), 'trial line copy retained');
  assert.ok(
    trialLineRequiresLiveActive(card),
    'first charge line must require status live or active (same as Active badge)'
  );
  assert.ok(
    !trialLinePaidOnlyGate(card),
    'must not keep paid-only trial gate that leaks on cancelled Draft'
  );
});

check('HEAD live-in-trial copy still trial 7 zile · prima taxare 99 pe <date>', () => {
  const js = headRead(BUILDER_JS);
  const card = extractFunction(js, 'buildSiteCard') || js;
  assert.ok(
    (/7-day trial|Trial de 7|7\u2011zile|7 zile/i.test(card)) &&
      /first charge|prima taxare/i.test(card) &&
      (/\\u00b7|·/.test(card) || /\u00b7/.test(card) || /·/.test(card)),
    'live trial line keeps middot form'
  );
  // Wave 14 live-link slash wrap must not regress.
  const css = headRead(BUILDER_CSS);
  const live = cssRule(css, '.site-live-link');
  assert.ok(live, '.site-live-link');
  assert.ok(
    !/word-break\s*:\s*break-all/i.test(live),
    'do not regress .site-live-link break-all'
  );
});

check('HEAD hyphenated name/slug stays one unit (NB hyphen or nowrap token)', () => {
  const js = headRead(BUILDER_JS);
  const card = extractFunction(js, 'buildSiteCard') || '';
  // Either non-breaking hyphen in name text, or a nowrap token class on the name.
  const hasNbHyphen =
    /\\u2011/.test(card) ||
    /\u2011/.test(card) ||
    /replace\s*\(\s*\/-\/g\s*,\s*['"]\\u2011['"]\s*\)/.test(card) ||
    /replace\s*\(\s*\/-\/g\s*,\s*['']\u2011['']\s*\)/.test(card) ||
    /replace\s*\(\s*\/-\\\/g/.test(card);
  const hasNowrapName =
    /site-card-name[\s\S]{0,200}nowrap|site-name-token|white-space\s*=\s*['"]nowrap['"]/.test(
      card
    );
  // CSS-side keep-all / normal on name is required above; JS NB hyphen is the
  // reliable fix for U+002D soft-wrap. Accept either NB hyphen injection or
  // explicit nowrap token markup on the name node.
  const css = headRead(BUILDER_CSS);
  const nameBlock = cssRule(css, '.site-card-name') || '';
  const cssKeepsHyphen =
    /hyphens\s*:\s*none/i.test(nameBlock) &&
    /overflow-wrap\s*:\s*normal/i.test(nameBlock);
  assert.ok(
    hasNbHyphen || hasNowrapName || cssKeepsHyphen,
    'hyphenated slug must stay one unit (NB hyphen, nowrap token, or hyphens:none + overflow-wrap:normal)'
  );
});

process.exit(failed ? 1 : 0);
