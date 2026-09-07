#!/usr/bin/env node
'use strict';
/**
 * scripts/ops-backup.js — CLI: snapshot every known SQLite database and
 * prune old snapshots to a retention count.
 *
 * Usage:
 *   node --experimental-sqlite scripts/ops-backup.js [--data-dir DIR] [--backup-dir DIR] [--keep N]
 *
 * Env (used when the matching flag is omitted):
 *   DATA_DIR          same variable the app itself reads (default: bot/)
 *   BACKUP_DIR        default: <data-dir>/backups
 *   BACKUP_RETENTION  default: 14
 *
 * Exit code: 0 if every known database was either backed up or found
 * legitimately absent; 1 if any backup attempt threw.
 *
 * Intended use: a Railway cron job / scheduled task running this on an
 * interval, or a manual run before a risky operation. The operator-facing
 * procedure is BACKUP-RESTORE.md §2a. (This used to point at HANDOFF-ops.md,
 * which is no longer in the repository — a dangling reference on the one file
 * an operator reaches for during an incident.)
 */

const { backupAll, resolveDataDir, defaultBackupDir, DEFAULT_RETENTION } = require('./ops-lib');

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--data-dir') out.dataDir = argv[++i];
        else if (a === '--backup-dir') out.backupDir = argv[++i];
        else if (a === '--keep') out.keep = Number(argv[++i]);
    }
    return out;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const dataDir = resolveDataDir(args.dataDir);
    const backupDir = args.backupDir || defaultBackupDir(dataDir);
    const keep = args.keep != null && !Number.isNaN(args.keep) ? args.keep : DEFAULT_RETENTION;

    console.log(`ops-backup: dataDir=${dataDir} backupDir=${backupDir} keep=${keep}`);

    let results;
    try {
        results = backupAll({ dataDir, backupDir, keep });
    } catch (e) {
        console.error('ops-backup: FAILED —', e.message);
        process.exit(1);
    }

    let anyFailed = false;
    for (const r of results) {
        if (r.status === 'backed-up') {
            console.log(`  [ok] ${r.name}: ${r.snapshotPath} (${r.sizeBytes} bytes)` +
                (r.deleted && r.deleted.length ? `, pruned ${r.deleted.length} old snapshot(s)` : ''));
        } else {
            console.log(`  [skip] ${r.name}: ${r.reason}`);
        }
    }
    if (!results.some((r) => r.status === 'backed-up')) {
        console.warn('ops-backup: no databases found to back up — is DATA_DIR correct?');
    }
    process.exit(anyFailed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { main };
