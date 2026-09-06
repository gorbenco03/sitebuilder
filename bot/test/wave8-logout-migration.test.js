'use strict';
/**
 * Wave 8 (AUDIT-07 re-audit): the `sessions` table (SCHEMA_SQL_V2, added so
 * logout can revoke an issued cookie) must be a purely additive migration —
 * an existing production database (SQLite, on the /data mount) must open,
 * migrate, and keep every row it already had.
 *
 * Part 1 (SQLite backend, the default in production): hand-build a
 * database in the OLD (v1-only) shape — no `sessions` table, no v2 row in
 * registry_schema_migrations — seed it with a user and a site the way a
 * real pre-Wave-8 deployment would have them, then require
 * bot/registry-sqlite.js against that same DATA_DIR. Its module-load-time
 * migrateSchema() call must detect current=1, apply SCHEMA_SQL_V2, and the
 * seeded rows must still read back unchanged. The new session functions
 * must then work against that same (now-migrated) database.
 *
 * Part 2 (JSON backend, REGISTRY_BACKEND=json — the documented emergency
 * exit): an old .registry.json with no "sessions" key at all must keep
 * working once bot/registry-json.js's new session functions run against it.
 *
 * Run: node --experimental-sqlite bot/test/wave8-logout-migration.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

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

// =============================================================================
// Part 1 — SQLite: seed v1 shape, migrate, verify data intact + sessions work
// =============================================================================

const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-migrate-sqlite-'));
process.env.DATA_DIR = sqliteDir;
delete process.env.REGISTRY_BACKEND; // sqlite is the default

const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_SQL_V1 } = require('../registry-schema.js');

const dbPath = path.join(sqliteDir, 'registry.sqlite'); // matches bot/registry-db.js's default path
const seedUserId = 'seed-user-v1';
const seedSiteId = 'seed-site-v1';
const seedUserCreatedAt = new Date('2026-01-01T00:00:00.000Z').toISOString();

(function seedOldShapeDatabase() {
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA journal_mode = WAL;');
    raw.exec(SCHEMA_SQL_V1); // the exact v1 DDL — no sessions table
    raw.exec(`
        CREATE TABLE IF NOT EXISTS registry_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    raw.prepare('INSERT INTO registry_schema_migrations (version, applied_at) VALUES (1, ?)')
        .run(new Date().toISOString());

    raw.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
        .run(seedUserId, 'seed@old-shape.test', seedUserCreatedAt);
    raw.prepare(`
        INSERT INTO sites (id, user_id, template_id, template_version, slug, project_name, platform, status, paid, url, created_at, extra)
        VALUES (?, ?, 'product-menu', 1, 'seed-slug-v1', 'seed-slug-v1', 'web', 'draft', 0, NULL, ?, '{}')
    `).run(seedSiteId, seedUserId, seedUserCreatedAt);

    // Confirm the pre-migration shape really has no sessions table, so the
    // migration below is proven to be the thing that adds it.
    const before = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    assert.strictEqual(before, undefined, 'test setup bug: sessions table must not exist before migration');
    raw.close();
})();

check('pre-migration: seeded DB really is at schema version 1', () => {
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare('SELECT MAX(version) AS v FROM registry_schema_migrations').get();
    raw.close();
    assert.strictEqual(Number(row.v), 1);
});

// First require of registry-sqlite.js in this process → runs migrateSchema()
// at module load, against the SAME DATA_DIR/registry.sqlite file seeded above.
const registrySqlite = require('../registry-sqlite.js');

check('migration ran: schema version is now 2', () => {
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare('SELECT MAX(version) AS v FROM registry_schema_migrations').get();
    raw.close();
    assert.strictEqual(Number(row.v), 2);
});

check('migration is additive: sessions table now exists', () => {
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    raw.close();
    assert.ok(row, 'sessions table must exist after migration');
});

check('pre-existing user row survived the migration unchanged', () => {
    const u = registrySqlite.getUser(seedUserId);
    assert.ok(u, 'seeded user must still be readable');
    assert.strictEqual(u.email, 'seed@old-shape.test');
    assert.strictEqual(u.createdAt, seedUserCreatedAt);
});

check('pre-existing site row survived the migration unchanged', () => {
    const s = registrySqlite.getSite(seedSiteId);
    assert.ok(s, 'seeded site must still be readable');
    assert.strictEqual(s.userId, seedUserId);
    assert.strictEqual(s.slug, 'seed-slug-v1');
    assert.strictEqual(s.status, 'draft');
    assert.strictEqual(s.paid, false);
});

check('new session functions work against the migrated database', () => {
    const sid = 'wave8-migration-test-sid';
    const exp = Math.floor(Date.now() / 1000) + 3600;
    registrySqlite.createSession(sid, seedUserId, exp);
    assert.strictEqual(registrySqlite.isSessionValid(sid), true);
    assert.strictEqual(registrySqlite.revokeSession(sid), true);
    assert.strictEqual(registrySqlite.isSessionValid(sid), false);
});

check('re-running the migration path (server restart) is a no-op, not an error', () => {
    // Simulates the process restarting: open the DB again from scratch.
    const { openRegistryDb } = require('../registry-db.js');
    const db2 = openRegistryDb({ dataDir: sqliteDir });
    const row = db2.prepare('SELECT MAX(version) AS v FROM registry_schema_migrations').get();
    assert.strictEqual(Number(row.v), 2, 'schema stays at version 2, not reapplied');
    const stillThere = db2.prepare('SELECT email FROM users WHERE id = ?').get(seedUserId);
    assert.strictEqual(stillThere.email, 'seed@old-shape.test');
    db2.close();
});

// =============================================================================
// Part 2 — JSON backend: old .registry.json with no "sessions" key at all
// =============================================================================

const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-migrate-json-'));
const jsonRegistryFile = path.join(jsonDir, '.registry.json');

const oldShapeJson = {
    users: {
        'seed-user-json': { id: 'seed-user-json', email: 'seed-json@old-shape.test', createdAt: seedUserCreatedAt },
    },
    tokens: {},
    sites: {
        'seed-site-json': {
            id: 'seed-site-json', userId: 'seed-user-json', templateId: 'local-service',
            templateVersion: 1, slug: 'seed-json-slug', projectName: 'seed-json-slug',
            platform: 'web', status: 'draft', paid: false, url: null, createdAt: seedUserCreatedAt,
        },
    },
    versions: {},
    orders: {},
    // Deliberately no "sessions" key — the exact shape a pre-Wave-8 file has.
};
fs.writeFileSync(jsonRegistryFile, JSON.stringify(oldShapeJson));

check('JSON backend: old file has no "sessions" key (test setup sanity)', () => {
    const raw = JSON.parse(fs.readFileSync(jsonRegistryFile, 'utf8'));
    assert.strictEqual(raw.sessions, undefined);
});

(function withJsonBackend(fn) {
    const savedDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = jsonDir;
    try {
        fn(require('../registry-json.js'));
    } finally {
        process.env.DATA_DIR = savedDataDir;
    }
})((registryJson) => {
    check('JSON backend: pre-existing user survives once session functions run', () => {
        const u = registryJson.getUser('seed-user-json');
        assert.ok(u, 'seeded user must still be readable');
        assert.strictEqual(u.email, 'seed-json@old-shape.test');
    });

    check('JSON backend: pre-existing site survives', () => {
        const s = registryJson.getSite('seed-site-json');
        assert.ok(s, 'seeded site must still be readable');
        assert.strictEqual(s.slug, 'seed-json-slug');
    });

    check('JSON backend: session functions work against a file with no prior "sessions" key', () => {
        const sid = 'wave8-json-migration-test-sid';
        const exp = Math.floor(Date.now() / 1000) + 3600;
        registryJson.createSession(sid, 'seed-user-json', exp);
        assert.strictEqual(registryJson.isSessionValid(sid), true);
        assert.strictEqual(registryJson.revokeSession(sid), true);
        assert.strictEqual(registryJson.isSessionValid(sid), false);
    });

    check('JSON backend: user/site data still intact after the sessions key was created', () => {
        const raw = JSON.parse(fs.readFileSync(jsonRegistryFile, 'utf8'));
        assert.ok(raw.sessions, 'sessions key should now exist');
        assert.strictEqual(raw.users['seed-user-json'].email, 'seed-json@old-shape.test');
        assert.strictEqual(raw.sites['seed-site-json'].slug, 'seed-json-slug');
    });
});

// =============================================================================
try { fs.rmSync(sqliteDir, { recursive: true, force: true }); } catch (_) {}
try { fs.rmSync(jsonDir, { recursive: true, force: true }); } catch (_) {}

if (failed) {
    console.error(`\nwave8-logout-migration.test.js: ${failed} FAILED`);
    process.exit(1);
}
console.log('\nwave8-logout-migration.test.js: toate testele au trecut');
