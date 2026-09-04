'use strict';
/**
 * bot/calendar-native/db.js — SQLite handle for native Hidook calendar.
 *
 * System of record is relational SQLite (Node built-in `node:sqlite`, flag
 * `--experimental-sqlite`). Not JSON files. Path defaults under DATA_DIR.
 *
 * VISION.md §8 — tenant key = customer_id + site_id.
 */

const fs = require('fs');
const path = require('path');
const { SCHEMA_SQL, SCHEMA_VERSION } = require('./schema');

function loadSqlite() {
    try {
        return require('node:sqlite');
    } catch (e) {
        const err = new Error(
            'Native calendar requires Node.js with node:sqlite (run with --experimental-sqlite on Node 22.5+).'
        );
        err.cause = e;
        throw err;
    }
}

/**
 * @param {{ dbPath?: string, dataDir?: string }} [opts]
 * @returns {import('node:sqlite').DatabaseSync}
 */
function openCalendarDb(opts = {}) {
    const { DatabaseSync } = loadSqlite();
    let dbPath = opts.dbPath;
    if (!dbPath) {
        const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..');
        fs.mkdirSync(dataDir, { recursive: true });
        dbPath = path.join(dataDir, 'calendar-native.sqlite');
    }
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA journal_mode = WAL;');
    migrate(db);
    return db;
}

/** @param {import('node:sqlite').DatabaseSync} db */
function migrate(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    const current = row && row.v != null ? Number(row.v) : 0;
    if (current < SCHEMA_VERSION) {
        db.exec('BEGIN IMMEDIATE;');
        try {
            db.exec(SCHEMA_SQL);
            db.prepare(
                'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
            ).run(SCHEMA_VERSION, new Date().toISOString());
            db.exec('COMMIT;');
        } catch (e) {
            try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
            throw e;
        }
    }
}

module.exports = {
    openCalendarDb,
    loadSqlite,
    SCHEMA_VERSION,
};
