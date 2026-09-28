'use strict';
/**
 * bot/test/audit27-t-3-copy-ro-catalog.test.js
 *
 * Task T-3, PLAN-UX-2026-09-27.md §5.8 "Un singur strat de mesaje pentru
 * client (copy + erori)". Before this task, builder/app.js scattered the
 * same Romanian toast/error-fallback/inline-status strings across dozens of
 * call sites (some duplicated verbatim, e.g. "Nu am putut finaliza
 * acțiunea. Încearcă din nou." repeated three times in buildSiteCard()) with
 * no single place to read or fix the product's customer-facing copy.
 *
 * builder/copy-ro.js is now that single place: a frozen `RO` catalog of
 * named Romanian messages plus a `t(key, vars)` interpolation helper,
 * loaded by builder/index.html BEFORE builder/app.js so every call site can
 * reference RO.KEY / t('KEY', {...}) instead of repeating a literal.
 *
 * This oracle fails on the pre-T-3 state (builder/copy-ro.js does not exist
 * at all) and on any regression back toward it, and passes once:
 *   - the catalog file exists, evaluates without throwing, exposes a frozen
 *     RO object and a t() helper;
 *   - builder/index.html's <script> order loads copy-ro.js before app.js;
 *   - no catalog value uses the cedilla forms ş/ţ (Romanian is ș/ț, comma
 *     below — AGENTS.md "correct diacritics ș ț");
 *   - no catalog value still says "proiect" (the renamed term is "site" —
 *     PLAN-UX-2026-09-27 §5.8 / copy-i18n#1);
 *   - no catalog value leaks a bare English UI word from a small denylist;
 *   - every RO.KEY / t('KEY', ...) reference in builder/app.js resolves to
 *     a key that actually exists in the catalog (a typo'd key would
 *     otherwise silently render as `undefined` or the literal key name in
 *     production, never caught by a human reading the source);
 *   - safeServerMessage() (U-09's shared error-fallback gate) sources its
 *     own default fallback text from RO.GENERIC_FALLBACK too, not a
 *     hardcoded literal living outside the catalog.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-t-3-copy-ro-catalog.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const COPY_RO_PATH = path.join(ROOT, 'builder', 'copy-ro.js');
const APP_JS_PATH = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML_PATH = path.join(ROOT, 'builder', 'index.html');

/** Evaluate builder/copy-ro.js in an isolated sandbox and hand back its RO
 * object + t() helper — never require()'d, since the file is a plain
 * browser <script> (no module.exports), same load pattern every other
 * isolated-extraction oracle in this suite already uses for builder/*.js. */
function loadCopyRo() {
  const src = fs.readFileSync(COPY_RO_PATH, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.RO = RO; this.t = t;', sandbox);
  return sandbox;
}

test('T-3: builder/copy-ro.js exists and loads a frozen RO catalog + t() helper', () => {
  assert.ok(fs.existsSync(COPY_RO_PATH), 'builder/copy-ro.js must exist (PLAN-UX-2026-09-27 §5.8)');
  const { RO, t } = loadCopyRo();
  assert.ok(RO && typeof RO === 'object', 'RO catalog must be defined');
  assert.ok(Object.isFrozen(RO), 'RO must be frozen (Object.freeze) so no call site can mutate shared copy');
  assert.strictEqual(typeof t, 'function', 't(key, vars) interpolation helper must exist');
  assert.ok(Object.keys(RO).length > 60, 'catalog must hold a substantial set of migrated messages');
});

test('T-3: builder/index.html loads copy-ro.js BEFORE app.js', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const copyIdx = html.indexOf('copy-ro.js');
  const appIdx = html.indexOf('/app/app.js');
  assert.ok(copyIdx !== -1, 'index.html must load builder/copy-ro.js');
  assert.ok(appIdx !== -1, 'index.html must load builder/app.js');
  assert.ok(copyIdx < appIdx, 'copy-ro.js <script> must come before app.js\'s own <script>, so RO exists when app.js runs');
});

test('T-3: every RO catalog value is correct Romanian — no ş/ţ cedilla, no "proiect", no bare English leak', () => {
  const { RO } = loadCopyRo();

  // A small denylist of bare English UI words that would mean an
  // untranslated fallback slipped into the catalog. Deliberately excludes
  // format/brand terms the product uses on purpose in Romanian sentences
  // (HTML, ZIP, Instagram, Instafidget) — AGENTS.md "Product language:
  // Romanian for visible customer/site surfaces" is about sentences, not
  // banning every loanword.
  const ENGLISH_DENYLIST = [
    'error', 'failed', 'please', 'sorry', 'warning', 'loading', 'retry',
    'success', 'cancel', 'sign in', 'click here', 'try again', 'welcome',
  ];

  for (const [key, value] of Object.entries(RO)) {
    assert.strictEqual(typeof value, 'string', `RO.${key} must be a plain string`);
    assert.ok(!/[şţ]/.test(value), `RO.${key} uses the cedilla ş/ţ instead of ș/ț (comma below): "${value}"`);
    assert.ok(!/proiect/i.test(value), `RO.${key} still says "proiect" — the renamed term is "site": "${value}"`);
    const lower = value.toLowerCase();
    for (const word of ENGLISH_DENYLIST) {
      const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      assert.ok(!re.test(lower), `RO.${key} leaks the English word "${word}": "${value}"`);
    }
  }
});

test('T-3: every RO.KEY / t(\'KEY\', ...) reference in builder/app.js exists in the catalog', () => {
  const appSrc = fs.readFileSync(APP_JS_PATH, 'utf8');
  const { RO } = loadCopyRo();

  const usedDot = new Set(Array.from(appSrc.matchAll(/\bRO\.([A-Z0-9_]+)\b/g), (m) => m[1]));
  const usedT = new Set(Array.from(appSrc.matchAll(/\bt\(\s*'([A-Z0-9_]+)'/g), (m) => m[1]));
  const used = new Set([...usedDot, ...usedT]);

  // Fails on the pre-T-3 state directly too: before this task app.js never
  // referenced RO at all, so `used` would be empty and this assertion
  // catches the regression, not just a typo in an already-migrated key.
  assert.ok(used.size > 60, 'builder/app.js must reference a substantial number of RO catalog keys');

  const missing = [...used].filter((key) => !Object.prototype.hasOwnProperty.call(RO, key));
  assert.deepStrictEqual(
    missing,
    [],
    `builder/app.js references RO keys missing from builder/copy-ro.js: ${missing.join(', ')}`
  );
});

test('T-3: safeServerMessage (U-09) sources its default fallback from RO.GENERIC_FALLBACK', () => {
  const appSrc = fs.readFileSync(APP_JS_PATH, 'utf8');
  const start = /function safeServerMessage\(e, fallbackRo, safeCodes\) \{/.exec(appSrc);
  assert.ok(start, 'safeServerMessage must exist with its documented (e, fallbackRo, safeCodes) signature');
  const closeAt = appSrc.indexOf('\n}', start.index);
  const body = appSrc.slice(start.index, closeAt);
  assert.ok(
    /fallbackRo\s*=\s*fallbackRo\s*\|\|\s*RO\.GENERIC_FALLBACK\s*;/.test(body),
    'safeServerMessage\'s own default fallback must read RO.GENERIC_FALLBACK, not a hardcoded literal outside the catalog'
  );
});
