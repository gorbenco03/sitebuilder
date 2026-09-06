'use strict';
/**
 * bot/registry-db.js — SQLite handle for the registry.
 *
 * Same shape as bot/calendar-native/db.js: node:sqlite (flag
 * --experimental-sqlite below Node 22.5, native from 22.5 on — production is
 * pinned to 22.20.0, see Dockerfile). Path defaults under DATA_DIR.
 */

const fs = require('fs');
const path = require('path');
const { SCHEMA_SQL, SCHEMA_SQL_V1, SCHEMA_VERSION } = require('./registry-schema');

function loadSqlite() {
    try {
        return require('node:sqlite');
    } catch (e) {
        const err = new Error(
            'The SQLite registry backend requires Node.js with node:sqlite ' +
            '(run with --experimental-sqlite on Node < 22.5). ' +
            'Set REGISTRY_BACKEND=json to use the JSON-file backend instead.'
        );
        err.cause = e;
        throw err;
    }
}

/**
 * @param {{ dbPath?: string, dataDir?: string }} [opts]
 * @returns {import('node:sqlite').DatabaseSync}
 */
function openRegistryDb(opts = {}) {
    const { DatabaseSync } = loadSqlite();
    let dbPath = opts.dbPath;
    if (!dbPath) {
        const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname);
        fs.mkdirSync(dataDir, { recursive: true });
        dbPath = path.join(dataDir, 'registry.sqlite');
    }
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    migrateSchema(db);
    return db;
}

/** Apply the structural (DDL) schema, versioned like bot/calendar-native/db.js. */
function migrateSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS registry_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    const row = db.prepare('SELECT MAX(version) AS v FROM registry_schema_migrations').get();
    let current = row && row.v != null ? Number(row.v) : 0;
    const ts = new Date().toISOString();

    if (current < 1) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL_V1);
            db.prepare(
                'INSERT OR IGNORE INTO registry_schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(1, ts);
            db.exec('COMMIT;');
            current = 1;
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    // Safety net for a brand-new path that somehow skipped stepwise migration.
    if (current < SCHEMA_VERSION) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL);
            db.prepare(
                'INSERT OR IGNORE INTO registry_schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(SCHEMA_VERSION, ts);
            db.exec('COMMIT;');
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }
}

/** True if `e` is a node:sqlite UNIQUE-constraint violation. */
function isUniqueViolation(e) {
    return !!(e && e.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/i.test(String(e.message || '')));
}

module.exports = {
    openRegistryDb,
    loadSqlite,
    migrateSchema,
    isUniqueViolation,
    SCHEMA_VERSION,
};
