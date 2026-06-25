'use strict';
/**
 * Test: ledger append/read round-trip on an isolated temp DATA_DIR.
 * Run:  node bot/test/ledger.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// Isolate the ledger file under a throwaway DATA_DIR before requiring the module
// (ledger.js resolves DATA_DIR at load time).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
process.env.DATA_DIR = tmpDir;

const ledger = require('../ledger.js');

let failed = false;
function check(name, fn) {
    try { fn(); console.log('PASS', name); }
    catch (e) { failed = true; console.error('FAIL', name, '-', e.message); }
}

check('read() returns [] before any append', () => {
    assert.deepStrictEqual(ledger.read(), []);
});

check('append injects a ts and returns the written record', () => {
    const rec = ledger.append({ event: 'built', chatId: 7, slug: 'cafe' });
    assert.ok(rec, 'append returned a record');
    assert.strictEqual(rec.event, 'built');
    assert.strictEqual(typeof rec.ts, 'string');
});

check('append preserves an explicit ts', () => {
    ledger.append({ event: 'paid', chatId: 7, ts: '2020-01-01T00:00:00.000Z' });
    const rows = ledger.read();
    const paid = rows.find((r) => r.event === 'paid');
    assert.strictEqual(paid.ts, '2020-01-01T00:00:00.000Z');
});

check('read() returns all appended records in order', () => {
    ledger.append({ event: 'published', chatId: 7, slug: 'cafe' });
    const rows = ledger.read();
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map((r) => r.event), ['built', 'paid', 'published']);
});

check('a malformed trailing line is skipped, valid lines survive', () => {
    fs.appendFileSync(ledger.LEDGER_FILE, '{not valid json\n', 'utf8');
    const rows = ledger.read();
    assert.strictEqual(rows.length, 3, 'corrupt line ignored, 3 good rows remain');
});

check('file is true JSONL: one JSON object per line', () => {
    const raw = fs.readFileSync(ledger.LEDGER_FILE, 'utf8').split('\n').filter(Boolean);
    // 3 good lines + 1 corrupt line we appended
    assert.strictEqual(raw.length, 4);
    assert.doesNotThrow(() => JSON.parse(raw[0]));
});

// Cleanup (best-effort)
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

if (failed) { console.error('\nledger.test.js: FAILED'); process.exit(1); }
console.log('\nledger.test.js: all passed');
