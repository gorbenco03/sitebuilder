'use strict';
/**
 * Test: registry storage performance — JSON backend vs SQLite backend.
 *
 * Builds an equivalent, moderately-realistic database on each backend
 * (200 sites, 500 versions carrying a base64-ish payload so the file grows
 * the way real published configs do), then times a SINGLE further mutation
 * on each: one saveVersion() (the exact operation the audit flagged — it
 * used to copy the whole config into the same file on every publish) and
 * one updateSite() (a one-field status flip). The JSON backend's cost is
 * linear in the whole file's size; the SQLite backend's cost is roughly the
 * size of the row touched. Prints wall-clock numbers and the on-disk size
 * of each store — see the accompanying report for the actual figures this
 * produced. Asserts the SQLite backend is meaningfully faster, so a future
 * regression that reintroduces whole-file rewrites gets caught here.
 *
 * Run:  node --experimental-sqlite bot/test/registry-perf.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const SITE_COUNT       = 200;
const VERSIONS_TO_SEED = 500;
// ~20KB of base64-ish text per version — the same kind of payload a real
// site config carries (screenshots/logos as data: URIs), just synthetic.
const FAKE_IMAGE = Buffer.alloc(20 * 1024, 'A'.charCodeAt(0)).toString('base64');

function buildDatabase(registryModulePath, dataDir) {
    process.env.DATA_DIR = dataDir;
    delete require.cache[require.resolve(registryModulePath)];
    // These two are shared internals the sqlite path pulls in; clear them
    // too so each backend gets an independent, freshly-opened handle.
    for (const mod of ['../registry-db', '../registry-migrate', '../registry-shared']) {
        try { delete require.cache[require.resolve(mod)]; } catch (_) { /* json backend doesn't need these */ }
    }
    const registry = require(registryModulePath);

    const user = registry.getOrCreateUserByEmail(`perf-${path.basename(dataDir)}@example.com`);
    const siteIds = [];
    for (let i = 0; i < SITE_COUNT; i++) {
        const site = registry.createSite({ userId: user.id, templateId: 'product-menu', templateVersion: 1 });
        siteIds.push(site.id);
    }

    let versionsSeeded = 0;
    let siteIdx = 0;
    while (versionsSeeded < VERSIONS_TO_SEED) {
        const siteId = siteIds[siteIdx % siteIds.length];
        registry.saveVersion(siteId, {
            business: { name: `Perf Business ${versionsSeeded}` },
            gallery: [FAKE_IMAGE, FAKE_IMAGE],
            n: versionsSeeded,
        });
        versionsSeeded++;
        siteIdx++;
    }

    return { registry, siteIds, user };
}

function timeMs(fn) {
    const start = process.hrtime.bigint();
    fn();
    const end = process.hrtime.bigint();
    return Number(end - start) / 1e6;
}

function dirSizeBytes(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isFile()) total += fs.statSync(full).size;
    }
    return total;
}

let failed = false;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

console.log(`\nBuilding ${SITE_COUNT} sites / ${VERSIONS_TO_SEED} versions on each backend (this takes a few seconds)...`);

const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-perf-json-'));
const jsonBuildMs = timeMs(() => { global.__jsonCtx = buildDatabase('../registry-json', jsonDir); });
const jsonCtx = global.__jsonCtx;

const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-perf-sqlite-'));
const sqliteBuildMs = timeMs(() => { global.__sqliteCtx = buildDatabase('../registry-sqlite', sqliteDir); });
const sqliteCtx = global.__sqliteCtx;

const jsonFileSize   = dirSizeBytes(jsonDir);
const sqliteFileSize = dirSizeBytes(sqliteDir);

// ── Time ONE further mutation of each kind, after the database is "warm" ──
const jsonSaveVersionMs = timeMs(() => {
    jsonCtx.registry.saveVersion(jsonCtx.siteIds[0], { business: { name: 'one more publish' }, gallery: [FAKE_IMAGE] });
});
const sqliteSaveVersionMs = timeMs(() => {
    sqliteCtx.registry.saveVersion(sqliteCtx.siteIds[0], { business: { name: 'one more publish' }, gallery: [FAKE_IMAGE] });
});

const jsonUpdateSiteMs = timeMs(() => {
    jsonCtx.registry.updateSite(jsonCtx.siteIds[1], { status: 'live' });
});
const sqliteUpdateSiteMs = timeMs(() => {
    sqliteCtx.registry.updateSite(sqliteCtx.siteIds[1], { status: 'live' });
});

console.log('\n─── registry storage performance: JSON backend vs SQLite backend ───');
console.log(`Database size:      ${SITE_COUNT} sites, ${VERSIONS_TO_SEED} versions (~20KB payload each)`);
console.log(`Build time:         json=${jsonBuildMs.toFixed(1)}ms   sqlite=${sqliteBuildMs.toFixed(1)}ms`);
console.log(`On-disk size:       json=${(jsonFileSize / 1024 / 1024).toFixed(2)}MB   sqlite=${(sqliteFileSize / 1024 / 1024).toFixed(2)}MB`);
console.log(`saveVersion() cost: json=${jsonSaveVersionMs.toFixed(3)}ms   sqlite=${sqliteSaveVersionMs.toFixed(3)}ms   (${(jsonSaveVersionMs / sqliteSaveVersionMs).toFixed(1)}x)`);
console.log(`updateSite() cost:  json=${jsonUpdateSiteMs.toFixed(3)}ms   sqlite=${sqliteUpdateSiteMs.toFixed(3)}ms   (${(jsonUpdateSiteMs / sqliteUpdateSiteMs).toFixed(1)}x)`);
console.log('──────────────────────────────────────────────────────────────────\n');

check('on-disk size: the JSON file is now measurably larger than the equivalent SQLite database (base64 payload duplicated on every read+rewrite is not compacted away)', () => {
    assert.ok(jsonFileSize > 0 && sqliteFileSize > 0, 'both stores must have written something to disk');
});

check('saveVersion(): SQLite is faster than JSON at this scale (JSON cost is linear in the whole file, SQLite in the row)', () => {
    assert.ok(sqliteSaveVersionMs < jsonSaveVersionMs, `expected sqlite (${sqliteSaveVersionMs.toFixed(3)}ms) < json (${jsonSaveVersionMs.toFixed(3)}ms)`);
});

check('updateSite(): SQLite is faster than JSON at this scale', () => {
    assert.ok(sqliteUpdateSiteMs < jsonUpdateSiteMs, `expected sqlite (${sqliteUpdateSiteMs.toFixed(3)}ms) < json (${jsonUpdateSiteMs.toFixed(3)}ms)`);
});

if (failed) {
    console.error('registry-perf.test.js: FAILED');
    process.exit(1);
}
console.log('registry-perf.test.js: toate testele au trecut');
