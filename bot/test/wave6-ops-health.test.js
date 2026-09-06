'use strict';
/**
 * Test: scripts/ops-health-lib.js (real readiness checks) + a characterization
 * of bot/server.js's current `/health` route. Wave 6 ops audit (2026-09-06),
 * item 3.
 *
 * bot/server.js and bot/web.js are owned by another agent in this wave —
 * this file does not modify them. What it does:
 *
 *   1. Fully test the new, real dependency checks in scripts/ops-health-lib.js
 *      (registry DB reachable+writable, calendar DB reachable+writable-or-
 *      absent, disk headroom) in isolation — this is the module HANDOFF-ops.md
 *      asks bot/server.js to call from a new `/health/ready` route.
 *   2. CHARACTERIZE today's `/health`: prove, against a real running server,
 *      that it returns 200 {ok:true} even when the registry database is
 *      completely broken. This is the audit finding made concrete
 *      ("a healthcheck that returns 200 while the database is unreachable
 *      is worse than none"). This half of the file is expected to keep
 *      passing (i.e. keep reproducing the gap) until the other agent wires
 *      in the HANDOFF-ops.md change — at which point the assertions in the
 *      "characterization" block below should be revisited, not silently
 *      left green for the wrong reason.
 *
 * Run:  node --experimental-sqlite bot/test/wave6-ops-health.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let failed = false;
function check(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => console.log('PASS', name))
        .catch((e) => { failed = true; console.error('FAIL', name, '-', e.message); });
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, json: JSON.parse(body) });
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function main() {
    // -------------------------------------------------------------------
    // Part 1: scripts/ops-health-lib.js on its own
    // -------------------------------------------------------------------
    const { isAlive, checkReadiness } = require('../../scripts/ops-health-lib');

    await check('isAlive() reports ok with no I/O', () => {
        const r = isAlive();
        assert.strictEqual(r.ok, true);
        assert.strictEqual(typeof r.uptimeSec, 'number');
    });

    const healthyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave6-health-ok-'));
    await check('checkReadiness() is ok:true against a real, healthy registry database (calendar db absent is not a failure)', () => {
        // Create a real registry.sqlite the same way the app does.
        for (const mod of ['../registry-sqlite', '../registry-db', '../registry-migrate', '../registry-shared', '../registry']) {
            try { delete require.cache[require.resolve(mod)]; } catch (_) { /* ignore */ }
        }
        const prevDataDir = process.env.DATA_DIR;
        process.env.DATA_DIR = healthyDir;
        try {
            require('../registry-sqlite'); // opens/creates registry.sqlite as a side effect
        } finally {
            process.env.DATA_DIR = prevDataDir;
        }

        const r = checkReadiness({ dataDir: healthyDir });
        // Database checks must be clean regardless of the host's actual free
        // disk space (this suite runs on shared/sandboxed machines that may
        // legitimately be low on disk right now) — assert those precisely,
        // and assert the disk check itself *ran successfully* rather than
        // asserting a specific headroom threshold that isn't this test's job.
        assert.strictEqual(r.checks.registryDb.ok, true, `expected registry db ok, got ${JSON.stringify(r.checks.registryDb)}`);
        assert.strictEqual(r.checks.calendarDb.skipped, true, 'calendar db was never created in this dir, must be reported as skipped, not failed');
        assert.strictEqual(r.checks.disk.ok, true, `expected the disk check itself to succeed, got ${JSON.stringify(r.checks.disk)}`);
        assert.ok(r.checks.disk.freeBytes > 0);
        // Only fail on ok:false for a reason OTHER than disk headroom — a
        // real database problem must never be masked by a coincidentally
        // low-disk sandbox.
        const nonDiskReasons = r.reasons.filter((msg) => !/disk space/.test(msg));
        assert.deepStrictEqual(nonDiskReasons, [], `unexpected non-disk readiness failure: ${JSON.stringify(nonDiskReasons)}`);
    });

    const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave6-health-broken-'));
    await check('checkReadiness() is ok:false when the registry database file is corrupt/unreadable', () => {
        // A real corruption scenario: the file exists (so it's not "just
        // hasn't been created yet") but is not a valid SQLite database —
        // e.g. a truncated/garbage write from a crashed process or a bad
        // volume mount.
        fs.writeFileSync(path.join(brokenDir, 'registry.sqlite'), 'not a sqlite database, deliberately corrupt');
        const r = checkReadiness({ dataDir: brokenDir });
        assert.strictEqual(r.ok, false);
        assert.ok(r.reasons.some((msg) => /registry database not writable/.test(msg)), `expected a registry reason, got ${JSON.stringify(r.reasons)}`);
        assert.strictEqual(r.checks.registryDb.ok, false);
    });

    await check('checkReadiness() is ok:false when the (existing) calendar-native database is corrupt', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave6-health-cal-broken-'));
        fs.copyFileSync(path.join(healthyDir, 'registry.sqlite'), path.join(dir, 'registry.sqlite'));
        fs.writeFileSync(path.join(dir, 'calendar-native.sqlite'), 'garbage, not sqlite');
        const r = checkReadiness({ dataDir: dir });
        assert.strictEqual(r.ok, false);
        assert.ok(r.reasons.some((msg) => /calendar-native database not writable/.test(msg)), `expected a calendar reason, got ${JSON.stringify(r.reasons)}`);
    });

    // -------------------------------------------------------------------
    // Part 2: characterize bot/server.js's CURRENT /health (unowned file —
    // not modified here; see HANDOFF-ops.md for the proposed fix).
    // -------------------------------------------------------------------
    const serverTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wave6-health-server-'));
    process.env.DATA_DIR = serverTmp;
    // A registry.sqlite that exists but is garbage — the exact "database is
    // unreachable" scenario the audit finding is about.
    fs.writeFileSync(path.join(serverTmp, 'registry.sqlite'), 'deliberately corrupt, not a real database');

    delete require.cache[require.resolve('../server.js')];
    const { startServer } = require('../server.js');
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;

    await check('CHARACTERIZATION (audit gap, not a desired behavior): GET /health returns 200 {ok:true} even though the registry database is corrupt/unreachable', async () => {
        const { status, json } = await getJson(`${base}/health`);
        assert.strictEqual(status, 200, 'current /health always answers 200');
        assert.strictEqual(json.ok, true, 'current /health never actually checks the database — see HANDOFF-ops.md for the proposed fix (readiness route backed by scripts/ops-health-lib.js)');
    });

    await new Promise((resolve) => srv.close(resolve));

    console.log('\nwave6-ops-health.test.js: healthyDir =', healthyDir, 'brokenDir =', brokenDir, 'serverTmp =', serverTmp);
    if (failed) {
        console.error('wave6-ops-health.test.js: FAILED');
        process.exit(1);
    }
    console.log('wave6-ops-health.test.js: toate testele au trecut');
}

main().catch((e) => {
    console.error('wave6-ops-health.test.js: uncaught error -', e);
    process.exit(1);
});
