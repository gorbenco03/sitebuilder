'use strict';
/**
 * bot/test/s92-s91-advocate.test.js — S92 remake of S91 ADVOCATE: STILL STANDING leaks.
 *
 * Causal leftovers on parent 8307da6 (S89 ACCEPT):
 *   1. Meseriași first-preset Extinderi blurb undiacritic factory
 *   2. local-service Detalii: English "Link Instagram" on contact.instagram.url
 *   3. After dashboard test-pay with empty in-memory draft, #edit / resume dumps to #templates (see note)
 *
 * Form editor removed 2026-10-28: leftover 3 was the editor's empty-draft #edit resume after a
 * dashboard test-pay; its VM simulation and the completeTestCheckout bind check were dropped. The
 * surviving contract is that the retired #edit route lands on #dashboard, not the catalog.
 * Overlay RED on parent, GREEN on HEAD. Static.
 * Run: node bot/test/s92-s91-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '8307da6d7aeb0272453e58d4391e5da460ff79e1';

const LS_PRESETS = 'templates/local-service/presets.json';
const LS_SCHEMA = 'templates/local-service/schema.json';
const PRO_SCHEMA = 'templates/professionals/schema.json';
const APP_JS = 'builder/app.js';

/** Exact undiacritic leftovers a stranger saw on S91 Extinderi blurb. */
const EXTINDERI_LEFTOVERS = [
  'Extinderi casa',
  'autorizatie',
  'constructii noi',
  'mansardari,',
  'portanti cu',
];

const EXTINDERI_FINISHED =
  'Extinderi de locuințe, mansardări, desființări autorizate de pereți portanți și construcții noi în curte.';

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
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

/** First Meseriași preset JSON slice (presets[0] only). */
function firstPresetSource(presetsJsonText) {
  const body = JSON.parse(presetsJsonText);
  const presets = body.presets || [];
  assert.ok(presets.length >= 1, 'local-service has presets');
  return JSON.stringify(presets[0]);
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

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
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

(async () => {
  // ─── Causal RED on parent ───────────────────────────────────────────

  await check('causal RED: parent Meseriași first-preset still has Extinderi undiacritic leftovers', () => {
    const presets = parentBlob(LS_PRESETS);
    assert.ok(presets, 'parent presets');
    const src = firstPresetSource(presets);
    let hits = 0;
    for (const s of EXTINDERI_LEFTOVERS) {
      if (src.includes(s)) hits++;
    }
    assert.ok(hits >= 3, 'parent Extinderi leftovers hits=' + hits);
    assert.ok(!src.includes(EXTINDERI_FINISHED), 'parent lacks finished Extinderi blurb');
  });

  await check('causal RED: parent local-service contact.instagram.url is Link Instagram', () => {
    const schema = parentBlob(LS_SCHEMA);
    assert.ok(schema, 'parent local-service schema');
    const label = schemaFieldLabel(schema, 'contact.instagram.url');
    assert.strictEqual(label, 'Link Instagram', 'parent url label is Link Instagram');
    assert.ok(/\bLink\b/.test(label), 'parent has English Link');
  });

  // ─── GREEN on HEAD ──────────────────────────────────────────────────

  await check('HEAD: Meseriași first-preset has finished Extinderi blurb, no leftovers', () => {
    const src = firstPresetSource(read(LS_PRESETS));
    for (const s of EXTINDERI_LEFTOVERS) {
      assert.ok(!src.includes(s), 'no leftover: ' + s);
    }
    assert.ok(src.includes(EXTINDERI_FINISHED), 'has finished Extinderi blurb');
  });

  await check('HEAD: local-service Instagram contact labels are Romanian', () => {
    const schema = read(LS_SCHEMA);
    const urlLabel = schemaFieldLabel(schema, 'contact.instagram.url');
    const textLabel = schemaFieldLabel(schema, 'contact.instagram.label');
    assert.ok(urlLabel, 'url label exists');
    assert.notStrictEqual(urlLabel, 'Link Instagram');
    assert.ok(!/\bLink\b/.test(urlLabel), 'url label has no English Link: ' + urlLabel);
    assert.ok(
      urlLabel.includes('Instagram') && /(\(secțiune contact\)|\(contact section\))/i.test(urlLabel),
      'url label is Instagram (secțiune contact)-style: ' + urlLabel
    );
    assert.ok(textLabel, 'text label exists');
    assert.ok(!/Text link Instagram|Link text Instagram/i.test(textLabel), 'no English Text link Instagram');
    assert.ok(
      /Etichetă Instagram|Instagram text/i.test(textLabel) ||
      /Instagram label/i.test(textLabel),
      'text label Romanian: ' + textLabel
    );
    // Professionals should align with the same Romanian section label.
    const pro = read(PRO_SCHEMA);
    assert.ok(
      /Instagram \(secțiune contact\)/i.test(pro) || /Instagram \(contact section\)/i.test(pro),
      'professionals Instagram contact label aligns with RO/EN legacy variants'
    );
    assert.ok(!/Link Instagram/.test(pro), 'professionals no Link Instagram');
  });

  await check('HEAD: retired #edit route lands on #dashboard, never dumps to the #templates catalog', () => {
    const appSrc = read(APP_JS);
    const route = extractFunction(appSrc, 'handleRoute') || '';
    assert.ok(route.length > 80, 'handleRoute must exist');
    const editBranch = (route.match(/route === 'edit'\)\s*\{([\s\S]*?)\}\s*else if/) || [])[1] || '';
    assert.ok(editBranch.length > 0, 'edit branch present in handleRoute');
    assert.ok(/location\.hash\s*=\s*['"]#dashboard['"]/.test(editBranch), '#edit redirects to #dashboard');
    assert.ok(!/#templates/.test(editBranch), '#edit must not dump to #templates');
  });

  if (failed) {
    console.error('\n' + failed + ' failed');
    process.exit(1);
  }
  console.log('\nAll s92-s91-advocate checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
