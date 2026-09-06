'use strict';
/**
 * Test: bot/registry-migrate.js — the "don't switch, report" contract.
 *
 * If verification fails after copying .registry.json into SQLite, the whole
 * copy must be rolled back (no partial data left in SQLite) and the
 * migration marker must NOT be written, so migrateFromJson() throws instead
 * of silently completing. Simulated here by writing a users row directly
 * into a fresh SQLite db whose id collides with a JSON user record but
 * carries different data — the row-count check still lines up (thanks to
 * INSERT OR IGNORE keeping the row untouched), but the sample deep-equality
 * check must catch the mismatch and fail the migration.
 *
 * Run:  node --experimental-sqlite bot/test/registry-migrate-failure.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-migrate-fail-test-'));
const registryFile = path.join(tmpDir, '.registry.json');

const conflictingId = crypto.randomUUID();
const legacy = {
    users: {
        [conflictingId]: { id: conflictingId, email: 'real@example.com', createdAt: '2025-01-01T00:00:00.000Z' },
    },
    tokens: {}, sites: {}, versions: {}, orders: {}, stripeEvents: {},
};
fs.writeFileSync(registryFile, JSON.stringify(legacy));

process.env.DATA_DIR = tmpDir;
const { openRegistryDb } = require('../registry-db');
const { migrateFromJson, MIGRATION_MARKER_KEY } = require('../registry-migrate');

const db = openRegistryDb({ dataDir: tmpDir });

// Pre-seed a row with the SAME id but a DIFFERENT email — INSERT OR IGNORE
// during migration will leave this row exactly as-is (same row count as the
// JSON source: one), but its content now disagrees with .registry.json.
db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .run(conflictingId, 'stale-pre-existing@example.com', '2024-06-01T00:00:00.000Z');

check('migrateFromJson: verification failure throws instead of completing silently', () => {
    assert.throws(
        () => migrateFromJson(db, { dataDir: tmpDir }),
        /verification failed/,
        'a sample mismatch must be caught and must abort the migration'
    );
});

check('migrateFromJson: migration marker is NOT written after a failed verification', () => {
    const row = db.prepare('SELECT value FROM registry_meta WHERE key = ?').get(MIGRATION_MARKER_KEY);
    assert.strictEqual(row, undefined, 'no marker row must exist — a future call must be free to retry');
});

check('migrateFromJson: .registry.json is still untouched even on failure', () => {
    const onDisk = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    assert.deepStrictEqual(onDisk, legacy);
});

check('registry-sqlite.js module load surfaces the migration failure loudly (no silent empty-db startup)', () => {
    // A fresh require of registry-sqlite.js against this same poisoned
    // DATA_DIR must throw at load time, not start up quietly on bad data —
    // this is "don't switch, report" as experienced by a real process boot.
    delete require.cache[require.resolve('../registry-sqlite')];
    delete require.cache[require.resolve('../registry-db')];
    delete require.cache[require.resolve('../registry-migrate')];
    assert.throws(() => require('../registry-sqlite'), /verification failed/);
});

console.log(`\nregistry-migrate-failure.test.js: module=${require.resolve('../registry-migrate')}`);
if (failed) {
    console.error('registry-migrate-failure.test.js: FAILED');
    process.exit(1);
}
console.log('registry-migrate-failure.test.js: toate testele au trecut');
