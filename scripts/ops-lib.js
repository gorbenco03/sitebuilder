'use strict';
/**
 * scripts/ops-lib.js — shared primitives for the Hidook Site Builder backup /
 * restore / health tooling (Wave 6, deploy-infrastructure audit follow-up).
 *
 * Zero new runtime dependencies: everything here is Node built-ins
 * (node:sqlite, fs, path, crypto) plus bot/logger.js, which already ships in
 * the product.
 *
 * Both SQLite databases the product writes (bot/registry-sqlite.js and
 * bot/calendar-native/db.js) default their data directory to
 * `process.env.DATA_DIR`, which on Railway is the single mounted volume
 * (see Dockerfile: `ENV DATA_DIR=/data`). That means one DATA_DIR covers
 * both databases, which is what backupAll()/KNOWN_DBS below assume.
 *
 * IMPORTANT — why VACUUM INTO, not `cp`:
 * SQLite in WAL mode (both DB modules set `PRAGMA journal_mode = WAL`) keeps
 * committed-but-not-checkpointed data in a separate `-wal` file. Copying the
 * main `.sqlite` file alone while the process is live can capture a state
 * that is missing recently-committed rows, or — worse — a main file mid
 * checkpoint, which is not guaranteed to be a valid standalone database.
 * `VACUUM INTO` is SQLite's own supported way to write a transactionally
 * consistent snapshot of the *current, fully committed* logical content of
 * a database to a new file, while the source stays open for reads and
 * writes throughout. That is the whole reason this file exists instead of
 * a two-line `fs.copyFileSync` wrapper.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { log } = require('../bot/logger.js');

function loadSqlite() {
    try {
        return require('node:sqlite');
    } catch (e) {
        const err = new Error(
            'ops-lib requires Node.js with node:sqlite (run with --experimental-sqlite on Node < 22.5).'
        );
        err.cause = e;
        throw err;
    }
}

/** The two SQLite databases this product writes, and their default filenames. */
const KNOWN_DBS = [
    { name: 'registry', file: 'registry.sqlite' },
    { name: 'calendar-native', file: 'calendar-native.sqlite' },
];

/** Same default DATA_DIR resolution bot/registry-db.js and
 * bot/calendar-native/db.js use, so ops tooling looks in the same place the
 * app itself reads/writes without requiring a separate config knob. */
function resolveDataDir(explicit) {
    if (explicit) return explicit;
    if (process.env.DATA_DIR) return process.env.DATA_DIR;
    return path.join(__dirname, '..', 'bot');
}

function defaultBackupDir(dataDir) {
    return process.env.BACKUP_DIR || path.join(dataDir, 'backups');
}

/** Filesystem-safe timestamp, sortable lexicographically = sortable chronologically. */
function timestampForFilename(d = new Date()) {
    return d.toISOString().replace(/[:.]/g, '-');
}

function sha256File(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Content-level fingerprint of a SQLite database: every user table, in name
 * order, every row in rowid order, hashed as JSON. Two databases with this
 * same digest hold identical data even if the underlying files differ byte
 * for byte (e.g. a fresh VACUUM vs. the original's page layout). Used by
 * the restore-proof test to assert "the data came back", independent of any
 * particular file-copy implementation detail.
 * @param {string} dbPath
 * @returns {string} sha256 hex digest
 */
function contentDigest(dbPath) {
    const { DatabaseSync } = loadSqlite();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .all()
            .map((r) => r.name);
        const hash = crypto.createHash('sha256');
        for (const t of tables) {
            hash.update(`TABLE:${t}\n`);
            // rowid works for every table in both schemas here (none declare
            // WITHOUT ROWID); ORDER BY rowid gives a stable row order to hash.
            const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();
            hash.update(JSON.stringify(rows));
            hash.update('\n');
        }
        return hash.digest('hex');
    } finally {
        db.close();
    }
}

/**
 * Snapshot one live SQLite database via VACUUM INTO.
 * @param {string} dbPath      path to the live database file (must exist)
 * @param {string} backupDir   directory to write the snapshot into (created if missing)
 * @param {string} name        logical name used in the snapshot filename (e.g. "registry")
 * @returns {{ name: string, dbPath: string, snapshotPath: string, sizeBytes: number, ts: string }}
 */
function backupDatabase(dbPath, backupDir, name) {
    const { DatabaseSync } = loadSqlite();
    if (!fs.existsSync(dbPath)) {
        throw new Error(`ops-lib.backupDatabase: source database does not exist: ${dbPath}`);
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = timestampForFilename();
    const snapshotPath = path.join(backupDir, `${name}-${ts}.sqlite`);

    const db = new DatabaseSync(dbPath);
    try {
        // Best-effort pre-flight check on the source; a corrupt source should
        // still get *attempted* (VACUUM INTO will usually throw itself, and
        // we want that error to be loud) but we log the finding either way.
        let sourceIntegrity = 'unknown';
        try {
            const row = db.prepare('PRAGMA integrity_check').get();
            sourceIntegrity = row && row.integrity_check;
        } catch (e) {
            sourceIntegrity = `check_failed: ${e.message}`;
        }

        db.prepare('VACUUM INTO ?').run(snapshotPath);

        const sizeBytes = fs.statSync(snapshotPath).size;
        log('ops.backup.snapshot_created', { name, dbPath, snapshotPath, sizeBytes, sourceIntegrity });
        return { name, dbPath, snapshotPath, sizeBytes, ts };
    } catch (e) {
        log('ops.backup.snapshot_failed', { name, dbPath, err: e }, 'error');
        // Clean up a partial file VACUUM INTO may have started writing.
        try { if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath); } catch (_) { /* best effort */ }
        throw e;
    } finally {
        db.close();
    }
}

/**
 * Delete snapshots for `name` beyond the most recent `keep`, based on the
 * lexicographic (= chronological, see timestampForFilename) order of
 * filenames matching `${name}-*.sqlite` in backupDir.
 * @returns {string[]} full paths of the snapshots that were deleted
 */
function pruneSnapshots(backupDir, name, keep) {
    if (!fs.existsSync(backupDir)) return [];
    const prefix = `${name}-`;
    const all = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.sqlite'))
        .sort(); // filenames embed a sortable timestamp
    const toDelete = all.length > keep ? all.slice(0, all.length - keep) : [];
    const deleted = [];
    for (const f of toDelete) {
        const full = path.join(backupDir, f);
        try {
            fs.unlinkSync(full);
            deleted.push(full);
        } catch (e) {
            log('ops.backup.prune_failed', { file: full, err: e }, 'error');
        }
    }
    if (deleted.length) log('ops.backup.pruned', { name, kept: keep, deletedCount: deleted.length });
    return deleted;
}

const DEFAULT_RETENTION = Number(process.env.BACKUP_RETENTION || 14);

/**
 * Back up every known database found under dataDir, then prune each to the
 * retention count. Missing databases (e.g. calendar-native.sqlite before the
 * feature is first used) are skipped, not treated as errors.
 * @param {{ dataDir?: string, backupDir?: string, keep?: number }} [opts]
 * @returns {Array<{name:string, status:'backed-up'|'skipped', snapshotPath?:string, sizeBytes?:number, deleted?:string[], reason?:string}>}
 */
function backupAll(opts = {}) {
    const dataDir = resolveDataDir(opts.dataDir);
    const backupDir = opts.backupDir || defaultBackupDir(dataDir);
    const keep = opts.keep != null ? opts.keep : DEFAULT_RETENTION;
    const results = [];
    for (const { name, file } of KNOWN_DBS) {
        const dbPath = path.join(dataDir, file);
        if (!fs.existsSync(dbPath)) {
            log('ops.backup.skipped_missing', { name, dbPath });
            results.push({ name, status: 'skipped', reason: 'source database does not exist' });
            continue;
        }
        const { snapshotPath, sizeBytes } = backupDatabase(dbPath, backupDir, name);
        const deleted = pruneSnapshots(backupDir, name, keep);
        results.push({ name, status: 'backed-up', snapshotPath, sizeBytes, deleted });
    }
    return results;
}

/**
 * Find the most recent snapshot for `name` under backupDir.
 * @returns {string|null} full path, or null if none exist
 */
function latestSnapshot(backupDir, name) {
    if (!fs.existsSync(backupDir)) return null;
    const prefix = `${name}-`;
    const all = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.sqlite'))
        .sort();
    if (!all.length) return null;
    return path.join(backupDir, all[all.length - 1]);
}

/**
 * Restore a snapshot over a live database file.
 *
 * Safety net: before touching `targetPath`, if it currently exists it is
 * itself copied into `preRestoreDir` (default: alongside the normal
 * snapshots, name-prefixed `pre-restore-`), so a restore run by mistake, or
 * against the wrong snapshot, does not destroy data that had no other copy.
 *
 * This function does NOT stop or coordinate with a running server process —
 * it is a file-level operation. The app must not be writing to targetPath
 * while this runs (see HANDOFF-ops.md "Restore procedure": stop the service
 * first). A `-wal`/`-shm` sidecar next to targetPath is removed as part of
 * the restore so a stale WAL cannot shadow the restored content on next
 * open.
 *
 * @param {string} snapshotPath   the backup file to restore from
 * @param {string} targetPath     the live database path to overwrite
 * @param {{ preRestoreDir?: string, name?: string }} [opts]
 * @returns {{ restored: string, preRestoreBackup: string|null, integrity: string }}
 */
function restoreDatabase(snapshotPath, targetPath, opts = {}) {
    const { DatabaseSync } = loadSqlite();
    if (!fs.existsSync(snapshotPath)) {
        throw new Error(`ops-lib.restoreDatabase: snapshot does not exist: ${snapshotPath}`);
    }

    // 1. Verify the snapshot itself is a well-formed database BEFORE we touch
    //    anything live. A corrupt snapshot must fail loudly here, not after
    //    the live file has already been overwritten.
    let snapshotIntegrity;
    {
        const check = new DatabaseSync(snapshotPath, { readOnly: true });
        try {
            const row = check.prepare('PRAGMA integrity_check').get();
            snapshotIntegrity = row && row.integrity_check;
        } finally {
            check.close();
        }
        if (snapshotIntegrity !== 'ok') {
            const err = new Error(`ops-lib.restoreDatabase: snapshot failed integrity_check: ${snapshotIntegrity}`);
            log('ops.restore.snapshot_corrupt', { snapshotPath, snapshotIntegrity }, 'error');
            throw err;
        }
    }

    // 2. Safety copy of whatever is currently at targetPath, if anything.
    let preRestoreBackup = null;
    if (fs.existsSync(targetPath)) {
        const preRestoreDir = opts.preRestoreDir || path.join(path.dirname(targetPath), 'backups');
        fs.mkdirSync(preRestoreDir, { recursive: true });
        const name = opts.name || path.basename(targetPath, '.sqlite');
        preRestoreBackup = path.join(preRestoreDir, `pre-restore-${name}-${timestampForFilename()}.sqlite`);
        try {
            // Same "don't copy out from under a writer" reasoning as backup:
            // use VACUUM INTO on the live file rather than fs.copyFileSync.
            backupDatabase(targetPath, preRestoreDir, `pre-restore-${name}`);
            // backupDatabase names its own file; find what it just wrote so
            // the return value points at something real.
            preRestoreBackup = latestSnapshot(preRestoreDir, `pre-restore-${name}`);
        } catch (e) {
            // If the "live" file is itself unreadable (the disaster we're
            // recovering from), fall back to a raw byte copy so we still
            // keep *something*, then continue with the restore.
            log('ops.restore.pre_restore_vacuum_failed_fallback_copy', { targetPath, err: e }, 'error');
            try {
                fs.copyFileSync(targetPath, preRestoreBackup);
            } catch (e2) {
                log('ops.restore.pre_restore_backup_failed', { targetPath, err: e2 }, 'error');
                preRestoreBackup = null;
            }
        }
    }

    // 3. Remove the live file and any WAL/SHM sidecars so nothing stale can
    //    shadow the restored content when the app next opens targetPath.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const p = targetPath + suffix;
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* best effort */ }
    }

    // 4. Copy the verified snapshot into place.
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(snapshotPath, targetPath);

    // 5. Re-verify the restored file in place (catches a corrupted copy).
    let finalIntegrity;
    {
        const check = new DatabaseSync(targetPath, { readOnly: true });
        try {
            const row = check.prepare('PRAGMA integrity_check').get();
            finalIntegrity = row && row.integrity_check;
        } finally {
            check.close();
        }
    }

    log('ops.restore.completed', { snapshotPath, targetPath, preRestoreBackup, integrity: finalIntegrity });
    return { restored: targetPath, preRestoreBackup, integrity: finalIntegrity };
}

/**
 * Liveness+readiness probe for one SQLite database: open it, prove it is
 * both readable and writable with a real round trip (not just "the file
 * exists"), and report elapsed time. Used by scripts/ops-health-lib.js and
 * directly testable on its own.
 * @param {string} dbPath
 * @returns {{ ok: boolean, path: string, error?: string, ms: number }}
 */
function checkDatabaseWritable(dbPath) {
    const start = Date.now();
    const { DatabaseSync } = loadSqlite();
    if (!fs.existsSync(dbPath)) {
        return { ok: false, path: dbPath, error: 'database file does not exist', ms: Date.now() - start };
    }
    let db;
    try {
        db = new DatabaseSync(dbPath);
        db.exec('CREATE TABLE IF NOT EXISTS _ops_healthcheck (id INTEGER PRIMARY KEY, ts TEXT)');
        db.prepare('INSERT INTO _ops_healthcheck (ts) VALUES (?)').run(new Date().toISOString());
        db.exec('DELETE FROM _ops_healthcheck WHERE id NOT IN (SELECT id FROM _ops_healthcheck ORDER BY id DESC LIMIT 5)');
        return { ok: true, path: dbPath, ms: Date.now() - start };
    } catch (e) {
        return { ok: false, path: dbPath, error: e.message, ms: Date.now() - start };
    } finally {
        if (db) { try { db.close(); } catch (_) { /* ignore */ } }
    }
}

/**
 * Free disk space at (or above) `dir`, in bytes and as a fraction.
 * @param {string} dir
 * @returns {{ ok: boolean, freeBytes?: number, totalBytes?: number, freeRatio?: number, error?: string }}
 */
function checkDiskSpace(dir) {
    try {
        const stat = fs.statfsSync(dir);
        const totalBytes = stat.blocks * stat.bsize;
        const freeBytes = stat.bavail * stat.bsize;
        const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 1;
        return { ok: true, freeBytes, totalBytes, freeRatio };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    KNOWN_DBS,
    DEFAULT_RETENTION,
    resolveDataDir,
    defaultBackupDir,
    timestampForFilename,
    sha256File,
    contentDigest,
    backupDatabase,
    pruneSnapshots,
    backupAll,
    latestSnapshot,
    restoreDatabase,
    checkDatabaseWritable,
    checkDiskSpace,
};
