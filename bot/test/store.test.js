'use strict';
/**
 * Test: store.js atomic save/flush round-trip + no leftover .tmp file.
 * Run:  node bot/test/store.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// Isolate .sessions.json under a throwaway DATA_DIR before requiring store.js
// (store.js resolves SESSIONS_FILE at load time).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
process.env.DATA_DIR = tmpDir;
const SESSIONS_FILE = path.join(tmpDir, '.sessions.json');

const store = require('../store.js');

let failed = false;
function check(name, fn) {
    try { fn(); console.log('PASS', name); }
    catch (e) { failed = true; console.error('FAIL', name, '-', e.message); }
}

check('loadSessions returns [] when no file exists', () => {
    assert.deepStrictEqual(store.loadSessions(), []);
});

check('flush writes the map atomically and round-trips', () => {
    const map = new Map([[123, { step: 'name', biz: 'Cafe' }], [456, { step: 'done' }]]);
    store.flush(map);
    assert.ok(fs.existsSync(SESSIONS_FILE), '.sessions.json exists after flush');
    const loaded = new Map(store.loadSessions());
    assert.strictEqual(loaded.size, 2);
    assert.deepStrictEqual(loaded.get(123), { step: 'name', biz: 'Cafe' });
    // numeric chat ids must round-trip back to Number, not string
    assert.ok(loaded.has(123) && !loaded.has('123'), 'numeric key coerced to Number');
});

check('atomic write leaves no .tmp file behind', () => {
    assert.ok(!fs.existsSync(SESSIONS_FILE + '.tmp'), 'no leftover .tmp');
});

check('scheduleSave (debounced) eventually persists, then resolves', (/* sync */) => {
    // scheduleSave is async (800ms debounce); we assert it queues without throwing.
    const map = new Map([[789, { step: 'pay' }]]);
    assert.doesNotThrow(() => store.scheduleSave(map));
});

// scheduleSave is debounced ~800ms; verify it actually lands, then exit.
setTimeout(() => {
    check('scheduleSave persists after the debounce window', () => {
        const loaded = new Map(store.loadSessions());
        assert.deepStrictEqual(loaded.get(789), { step: 'pay' });
        assert.ok(!fs.existsSync(SESSIONS_FILE + '.tmp'), 'no leftover .tmp after scheduleSave');
    });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    if (failed) { console.error('\nstore.test.js: FAILED'); process.exit(1); }
    console.log('\nstore.test.js: all passed');
}, 1000);
