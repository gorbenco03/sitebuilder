'use strict';
/**
 * scripts/ops-health-lib.js — real readiness checks for the Hidook web
 * service, extracted so they can be unit-tested independently of
 * bot/server.js (which this agent does not own — see HANDOFF-ops.md for the
 * exact wiring change proposed for bot/server.js's `/health` route).
 *
 * Audit finding (DI, 2026-09-06): `/health` returned `{ ok: true, ... }`
 * unconditionally — it never touched the database, disk, or anything else.
 * A healthcheck that returns 200 while the database is unreachable is worse
 * than none, because Railway/an on-call human trusts it and looks elsewhere
 * first.
 *
 * This module distinguishes:
 *   - liveness  (isAlive):     "is the process up and able to respond at
 *                               all" — cheap, no I/O, always fast. This is
 *                               what a process supervisor should restart on
 *                               if it fails.
 *   - readiness (checkReadiness): "is the process able to actually serve
 *                               requests correctly right now" — touches the
 *                               real dependencies (both SQLite databases,
 *                               disk headroom). This is what a load
 *                               balancer / Railway's healthcheckPath should
 *                               gate traffic on, and what an alert should
 *                               fire on.
 *
 * Zero new runtime dependencies: Node built-ins + scripts/ops-lib.js +
 * bot/logger.js only.
 */

const path = require('path');
const fs = require('fs');
const { resolveDataDir, checkDatabaseWritable, checkDiskSpace, KNOWN_DBS } = require('./ops-lib');
const { log } = require('../bot/logger.js');

/** Below this fraction of free disk space, readiness reports degraded. */
const DISK_FREE_RATIO_WARN = 0.10;

/** Trivial, no-I/O liveness check: the process can execute JS at all. */
function isAlive() {
    return { ok: true, uptimeSec: Math.round(process.uptime()) };
}

/**
 * Real dependency check: both SQLite databases are reachable AND writable
 * (a real INSERT/DELETE round trip, not just "the file exists" or "the
 * connection opened"), plus disk headroom on the volume that holds them.
 *
 * The calendar-native database is optional at this stage of the product (a
 * site need not have booking enabled), so its absence is not a failure —
 * only an unreadable/unwritable *existing* file is. The registry database
 * is mandatory: every request that touches auth, sites, or orders needs it,
 * so its absence or failure marks the whole response not-ready.
 *
 * @param {{ dataDir?: string }} [opts]
 * @returns {{
 *   ok: boolean,
 *   checks: {
 *     registryDb: ReturnType<typeof checkDatabaseWritable>,
 *     calendarDb: (ReturnType<typeof checkDatabaseWritable> & {skipped?:boolean})|null,
 *     disk: ReturnType<typeof checkDiskSpace>,
 *   },
 *   reasons: string[],
 * }}
 */
function checkReadiness(opts = {}) {
    const dataDir = resolveDataDir(opts.dataDir);
    const reasons = [];

    const registryPath = path.join(dataDir, KNOWN_DBS.find((d) => d.name === 'registry').file);
    const registryDb = checkDatabaseWritable(registryPath);
    if (!registryDb.ok) reasons.push(`registry database not writable: ${registryDb.error}`);

    const calendarPath = path.join(dataDir, KNOWN_DBS.find((d) => d.name === 'calendar-native').file);
    let calendarDb;
    if (!fs.existsSync(calendarPath)) {
        calendarDb = { ok: true, path: calendarPath, skipped: true, ms: 0 };
    } else {
        calendarDb = checkDatabaseWritable(calendarPath);
        if (!calendarDb.ok) reasons.push(`calendar-native database not writable: ${calendarDb.error}`);
    }

    const disk = checkDiskSpace(dataDir);
    if (!disk.ok) {
        reasons.push(`disk space check failed: ${disk.error}`);
    } else if (disk.freeRatio < DISK_FREE_RATIO_WARN) {
        reasons.push(`low disk space: ${(disk.freeRatio * 100).toFixed(1)}% free on ${dataDir}`);
    }

    const ok = reasons.length === 0;
    const result = { ok, checks: { registryDb, calendarDb, disk }, reasons };

    // Structured, operationally-meaningful log line — this is exactly the
    // kind of event an alert (see HANDOFF-ops.md "What to alert on") should
    // fire on when ok:false, or when the same reason repeats across polls.
    log(ok ? 'health.ready' : 'health.not_ready', { dataDir, reasons }, ok ? 'info' : 'error');

    return result;
}

module.exports = { isAlive, checkReadiness, DISK_FREE_RATIO_WARN };
