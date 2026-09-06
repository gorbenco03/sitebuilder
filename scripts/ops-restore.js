#!/usr/bin/env node
'use strict';
/**
 * scripts/ops-restore.js — CLI: restore a SQLite database from a snapshot
 * made by scripts/ops-backup.js.
 *
 * Usage:
 *   node --experimental-sqlite scripts/ops-restore.js --name registry --yes
 *   node --experimental-sqlite scripts/ops-restore.js --name calendar-native --snapshot /data/backups/calendar-native-2026-09-06T10-00-00-000Z.sqlite --yes
 *   node --experimental-sqlite scripts/ops-restore.js --snapshot PATH --target PATH --yes
 *
 * --name         one of the known databases (registry | calendar-native);
 *                resolves the live target path and, unless --snapshot is
 *                also given, the latest snapshot for that name.
 * --snapshot     explicit snapshot file to restore from (default: latest
 *                for --name under --backup-dir).
 * --target       explicit live path to overwrite (default: derived from
 *                --name under --data-dir).
 * --data-dir     default: DATA_DIR env, else bot/ (same as the app).
 * --backup-dir   default: <data-dir>/backups.
 * --yes          required. Without it, ops-restore.js prints what it WOULD
 *                do and exits 1 without touching anything — this operation
 *                overwrites a live database file and must never run by
 *                accident (e.g. a copy-pasted command from a runbook).
 *
 * STOP THE APP FIRST. This is a file-level operation; see HANDOFF-ops.md
 * "Restore procedure" for the full step-by-step. Before overwriting, the
 * current target (if any) is itself snapshotted into <backup-dir> with a
 * `pre-restore-` prefix, so a restore run against the wrong snapshot is
 * itself recoverable.
 */

const path = require('path');
const { KNOWN_DBS, resolveDataDir, defaultBackupDir, latestSnapshot, restoreDatabase } = require('./ops-lib');

function parseArgs(argv) {
    const out = { yes: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--name') out.name = argv[++i];
        else if (a === '--snapshot') out.snapshot = argv[++i];
        else if (a === '--target') out.target = argv[++i];
        else if (a === '--data-dir') out.dataDir = argv[++i];
        else if (a === '--backup-dir') out.backupDir = argv[++i];
        else if (a === '--yes') out.yes = true;
    }
    return out;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const dataDir = resolveDataDir(args.dataDir);
    const backupDir = args.backupDir || defaultBackupDir(dataDir);

    let target = args.target;
    let name = args.name;
    if (!target) {
        if (!name) {
            console.error('ops-restore: need --target PATH, or --name registry|calendar-native');
            process.exit(1);
        }
        const known = KNOWN_DBS.find((d) => d.name === name);
        if (!known) {
            console.error(`ops-restore: unknown --name "${name}", expected one of: ${KNOWN_DBS.map((d) => d.name).join(', ')}`);
            process.exit(1);
        }
        target = path.join(dataDir, known.file);
    }
    if (!name) name = path.basename(target, '.sqlite');

    let snapshot = args.snapshot;
    if (!snapshot) {
        snapshot = latestSnapshot(backupDir, name);
        if (!snapshot) {
            console.error(`ops-restore: no snapshot found for "${name}" under ${backupDir} — pass --snapshot PATH explicitly`);
            process.exit(1);
        }
    }

    console.log(`ops-restore: will restore\n  snapshot: ${snapshot}\n  target:   ${target}`);
    if (!args.yes) {
        console.log('ops-restore: DRY RUN (no --yes given) — nothing was touched.');
        console.log('ops-restore: stop the app before re-running with --yes. See HANDOFF-ops.md "Restore procedure".');
        process.exit(1);
    }

    try {
        const result = restoreDatabase(snapshot, target, { name });
        console.log(`ops-restore: OK — integrity=${result.integrity}`);
        if (result.preRestoreBackup) {
            console.log(`ops-restore: previous content saved to ${result.preRestoreBackup}`);
        }
        process.exit(0);
    } catch (e) {
        console.error('ops-restore: FAILED —', e.message);
        process.exit(1);
    }
}

if (require.main === module) main();

module.exports = { main };
