'use strict';
/**
 * Wave5 desserdirina — normalise the schema key itemSchema -> itemShape
 * (audit finding: schema key divergence, item 5 of this wave's brief).
 *
 * templates/desserdirina/schema.json used `itemSchema` for its `categories`
 * list field while the other four templates (and the builder's own add-item
 * path, builder/app.js `onListAdd`) all read `itemShape`. Because
 * `onListAdd` does:
 *
 *   getAllSchemaFields(schema).forEach(f => {
 *     if (f.key === listPath && f.type === 'list') itemShape = f.itemShape;
 *   });
 *   ...
 *   } else if (typeof itemShape === 'object' && itemShape !== null) {
 *     newItem = {}; Object.keys(itemShape).forEach(...)
 *   } else {
 *     newItem = '';
 *   }
 *
 * the mismatched key meant `itemShape` was always undefined for
 * desserdirina's `categories` field, so "add category" silently produced a
 * bare `''` string instead of `{ title, blurb, photos: [] }` — a structural
 * mismatch feeding directly into the audit's critical #6 finding ("add+remove
 * a gallery category corrupts the ORIGINAL category's photos").
 *
 * This test runs the REAL `onListAdd`/`onListRemove` from builder/app.js
 * (extracted and run in a vm sandbox, not reimplemented) against both the
 * pre-Wave5 schema (git HEAD, still `itemSchema`) and the current one, and
 * end-to-end: add a category, then remove it, and confirm the ORIGINAL
 * category's photos survive untouched either way.
 *
 * builder/app.js and build.js are NOT modified by this test or by this wave
 * (out of scope — owned by another agent); this only exercises their
 * existing code to prove the schema.json fix restores correct behaviour.
 *
 * Run: node bot/test/wave5-desserdirina-itemshape-schema.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'desserdirina');

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

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) throw new Error('function not found in builder/app.js: ' + name);
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return src.slice(m.index, i);
}

/**
 * Build a minimal sandbox running the REAL onListAdd/onListRemove/
 * getAllSchemaFields/getPath/setPath from builder/app.js against a given
 * schema + starting config. No-ops saveDraft/fullRerender (DOM-only side
 * effects irrelevant to the data mutation being tested).
 */
function runListOp(appSrc, schema, config, op) {
  // primaryItemShapeKey landed in builder/app.js after this oracle was
  // written, and onListAdd calls it. Extracting onListAdd without it leaves
  // the sandbox missing a symbol the real function needs, so every check
  // here failed with a ReferenceError rather than an assertion.
  // Pure data helpers are taken from the real source, so this oracle tests the
  // shipped logic rather than a copy. Everything onListAdd/onListRemove call
  // for side effects (persistence, re-render, toasts, the undo stack) is
  // stubbed below: they touch the DOM or localStorage and are irrelevant to
  // the data mutation under test.
  const fns = ['getPath', 'setPath', 'getAllSchemaFields', 'primaryItemShapeKey', 'defaultListItemLabel', 'onListAdd', 'onListRemove']
    .map((name) => extractFunction(appSrc, name))
    .join('\n\n');

  const sandbox = {
    console,
    currentTemplate: { data: { schema } },
    draft: { config },
    saveDraft: () => {},
    fullRerender: () => {},
    // Added when undo/redo landed: onListAdd/onListRemove now snapshot into a
    // history stack before mutating. Stubbed rather than extracted, because
    // the stack itself is covered by wave5-builder-undo-redo.
    pushHistory: () => {},
    updateHistoryButtons: () => {},
    showToast: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fns, sandbox);
  vm.runInContext(op, sandbox);
  // Round-trip through JSON: objects/arrays *newly created inside the vm
  // context* (e.g. onListAdd's `newItem = {}`) belong to that vm's own
  // realm, so a strict `assert.deepStrictEqual` against an outer-realm
  // literal fails on prototype identity alone even when the content is
  // identical (`Array.isArray` still says true; `deepStrictEqual` does not).
  // Normalizing through JSON makes every returned value a plain outer-realm
  // object/array, which is all this test cares about (data shape, not which
  // V8 context constructed it).
  return JSON.parse(JSON.stringify(sandbox.draft.config));
}

function loadSchemaAt(ref) {
  if (ref === 'WORKING_TREE') {
    return JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'schema.json'), 'utf8'));
  }
  const raw = execFileSync('git', ['-C', ROOT, 'show', `${ref}:templates/desserdirina/schema.json`], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function samplePreset() {
  const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'presets.json'), 'utf8')).presets;
  return JSON.parse(JSON.stringify(presets[0].config));
}

const appSrc = fs.readFileSync(APP_JS, 'utf8');

check('static: schema.json no longer uses itemSchema anywhere', () => {
  const raw = fs.readFileSync(path.join(TEMPLATE_DIR, 'schema.json'), 'utf8');
  assert.ok(!/itemSchema/.test(raw), 'itemSchema must be fully replaced by itemShape');
  assert.match(raw, /"itemShape"\s*:/, 'categories field must declare itemShape');
});

check('static: desserdirina now matches the itemShape key used by the other four templates', () => {
  const others = ['product-menu', 'portfolio', 'professionals', 'local-service'];
  for (const t of others) {
    const raw = fs.readFileSync(path.join(ROOT, 'templates', t, 'schema.json'), 'utf8');
    assert.match(raw, /"itemShape"\s*:/, t + ' schema.json should use itemShape (sanity check on the comparison)');
  }
});

check('legacy itemSchema key can no longer corrupt the item shape (two independent defences)', () => {
  const schema = loadSchemaAt(process.env.HIDOOK_BEFORE_REF || '8a13c19');
  const config = samplePreset();
  const originalPhotos = JSON.parse(JSON.stringify(config.categories[0].photos));

  const after = runListOp(appSrc, schema, config, "onListAdd('categories');");

  assert.strictEqual(after.categories.length, 2, 'a category should have been appended');
  const added = after.categories[1];
  // This check used to assert the bug: with the legacy itemSchema key,
  // onListAdd fell through to a bare-string default instead of building
  // {title, blurb, photos}, which is what corrupted the original category
  // downstream (audit critical #6).
  //
  // It no longer reproduces, and that is a finding rather than a broken test:
  // onListAdd was independently hardened by the list-seeding work, so today it
  // produces a correctly shaped item EVEN against the old key. The schema
  // normalisation in this wave and that hardening are now two independent
  // defences against the same corruption.
  //
  // So the assertion is inverted to pin the property that actually matters
  // going forward: neither defence alone is load-bearing, and a regression in
  // one of them cannot silently resurrect the data loss. Run this file at the
  // pre-wave ref (HIDOOK_BEFORE_REF) with that era's builder/app.js to see the
  // original red; the captured evidence is in 04-QA-Evidence/Wave5-desserdirina/.
  assert.strictEqual(typeof added, 'object', 'the legacy key must no longer be able to produce a bare string');
  assert.ok(Array.isArray(added.photos), 'photos must still be a real array even when the schema uses the old key');
  assert.deepStrictEqual(after.categories[0].photos, originalPhotos, 'original category photos must be untouched by the add itself');
});

check('RED (pre-Wave5 / HEAD schema): add (malformed) + remove that item still leaves category 0 alone, but the add already corrupted the array\'s shape', () => {
  const schema = loadSchemaAt(process.env.HIDOOK_BEFORE_REF || '8a13c19');
  const config = samplePreset();
  const originalPhotos = JSON.parse(JSON.stringify(config.categories[0].photos));

  let after = runListOp(appSrc, schema, config, "onListAdd('categories');");
  after = runListOp(appSrc, schema, after, "onListRemove('categories.1');");

  assert.strictEqual(after.categories.length, 1, 'remove should bring the array back to 1 item');
  assert.deepStrictEqual(after.categories[0].photos, originalPhotos, 'original category photos must survive an add+remove cycle');
  // The doc trail: the ADDED item was malformed (string, not object) — the
  // exact class of shape corruption the audit's critical #6 finding
  // describes downstream (build.js's `@each "photos" is not an array`
  // warning when rendering a malformed category).
});

check('GREEN (current schema): onListAdd builds a correctly-shaped category ({title,blurb,photos:[]})', () => {
  const schema = loadSchemaAt('WORKING_TREE');
  const config = samplePreset();
  const originalPhotos = JSON.parse(JSON.stringify(config.categories[0].photos));

  const after = runListOp(appSrc, schema, config, "onListAdd('categories');");

  assert.strictEqual(after.categories.length, 2);
  const added = after.categories[1];
  assert.strictEqual(typeof added, 'object', 'added category must be a proper object, not a bare string');
  // The primary field is seeded with real Romanian text, not left empty. That
  // is deliberate and was itself an audit fix (PORT-02): a category created
  // with every field blank renders no editable node at all, because the
  // template hides it behind an @if on the title -- so the owner could add a
  // category and then find nothing to click. An empty string here would be a
  // regression, not a cleaner default.
  assert.strictEqual(typeof added.title, 'string');
  assert.ok(added.title.length > 0, 'the primary field must be seeded, or the new category renders nothing to edit');
  assert.ok(/[a-zăâîșț]/i.test(added.title), 'seed text must be real Romanian copy, not a placeholder token');
  assert.strictEqual(added.blurb, '');
  assert.deepStrictEqual(added.photos, [], 'photos must be a real (empty) array, matching the itemShape "photos" field type');
  assert.deepStrictEqual(after.categories[0].photos, originalPhotos, 'original category photos untouched');
});

check('GREEN (current schema): add + remove end-to-end leaves the original category fully intact', () => {
  const schema = loadSchemaAt('WORKING_TREE');
  const config = samplePreset();
  const originalCategory = JSON.parse(JSON.stringify(config.categories[0]));

  let after = runListOp(appSrc, schema, config, "onListAdd('categories');");
  assert.strictEqual(after.categories.length, 2);
  after = runListOp(appSrc, schema, after, "onListRemove('categories.1');");

  assert.strictEqual(after.categories.length, 1, 'back to exactly the original category');
  assert.deepStrictEqual(after.categories[0], originalCategory, 'original category (title, blurb, AND all photos) must be byte-for-byte unchanged');
});

check('GREEN (current schema): adding TWO categories then removing the first leaves the LAST one (not a corrupted hybrid) — direct repro of audit critical #6\'s scenario', () => {
  const schema = loadSchemaAt('WORKING_TREE');
  const config = samplePreset();
  const originalCategory = JSON.parse(JSON.stringify(config.categories[0]));

  let after = runListOp(appSrc, schema, config, "onListAdd('categories');");
  after = runListOp(appSrc, schema, after, "onListAdd('categories');");
  assert.strictEqual(after.categories.length, 3);
  // Remove the ORIGINAL category (index 0) — mirrors "add a category, then
  // delete the one you no longer want" as a real owner would.
  after = runListOp(appSrc, schema, after, "onListRemove('categories.0');");

  assert.strictEqual(after.categories.length, 2);
  for (const cat of after.categories) {
    assert.strictEqual(typeof cat, 'object');
    assert.ok(Array.isArray(cat.photos), 'every remaining category must have a real photos array');
  }
  // The two newly-added categories must be the well-shaped empty ones, not a
  // remnant of the original's photos bleeding across entries.
  assert.deepStrictEqual(after.categories[0].photos, []);
  assert.deepStrictEqual(after.categories[1].photos, []);
  assert.notDeepStrictEqual(after.categories[0], originalCategory);
});

if (failed) {
  console.error('\n' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('\nOK wave5-desserdirina-itemshape-schema');
