'use strict';
/**
 * bot/test/wave7-calendar-resources-concurrency.test.js
 *
 * Oracle — Wave 7 (audit finding #25, "more than one person or room"): the
 * point of this task. A tenant with N bookable resources (a salon with N
 * stylists) receives K > N genuinely simultaneous "any available" booking
 * requests for the exact same start_utc. This must prove:
 *
 *   1. Exactly N requests confirm — one per resource.
 *   2. Every confirmed booking lands on a DISTINCT resource — never two
 *      confirmed bookings sharing a resource at an overlapping time
 *      (double-booking is impossible even under real race conditions).
 *   3. The remaining K-N requests are correctly refused (downgraded to
 *      'requested', never falsely confirmed), each stored with
 *      resource_id = NULL (an honest "not yet assigned" state — see
 *      engine.reassignBookingAsOwner) rather than pinned to a busy
 *      resource.
 *
 * "Simultaneous" here means genuine OS-level concurrency, not just
 * sequential JS calls in one event loop (which never actually race, since
 * synchronous node:sqlite calls never yield mid-transaction). K worker
 * threads each open their OWN connection to the SAME sqlite file and fire
 * engine.createBooking(..., { serviceId, startUtc }) — no resourceId, i.e.
 * "any available" — at the same instant. This is exactly the scenario the
 * pre-existing single-calendar engine was already proven against live
 * (04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md §3/§8: "index UNIQUE
 * partial + tranzacție BEGIN IMMEDIATE a rezistat live la 20 de cereri
 * simultane pe același slot"), extended here to resolve across N resources
 * instead of a single shared calendar. The locking primitive itself
 * (BEGIN IMMEDIATE + partial UNIQUE index) is untouched — see engine.js
 * createBooking — only the resource-selection logic wrapped around it is
 * new. db.js additionally sets `PRAGMA busy_timeout` so a second real OS
 * connection's BEGIN IMMEDIATE waits for the first writer's commit instead
 * of failing fast with SQLITE_BUSY — a driver-level requirement for this
 * proof to even be meaningful across multiple connections, not a change to
 * the locking design.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-calendar-resources-concurrency.test.js
 * Evidence: 04-QA-Evidence/Wave7-calendar-staff/concurrency-result.json
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');

if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawnSync } = require('child_process');
    const r = spawnSync(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit' }
    );
    process.exit(r.status == null ? 1 : r.status);
}

const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');

const DB_MODULE = path.resolve(__dirname, '..', 'calendar-native', 'db.js');
const ENGINE_MODULE = path.resolve(__dirname, '..', 'calendar-native', 'engine.js');

const N_RESOURCES = 5;
const K_REQUESTS = 20; // > N_RESOURCES on purpose — the audit's own "20 simultaneous" scale

const C = 'cust_wave7_conc';
const S = 'site_wave7_conc';

/**
 * Worker body, sent as source (eval:true) so this stays a single self-
 * contained test file. Each worker opens its own DatabaseSync connection to
 * the shared sqlite file (skipping the retention/reminder background
 * sweeps — irrelevant here and would just add unrelated BEGIN IMMEDIATE
 * transactions to the mix) and fires exactly one "any available" booking.
 */
const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const { openCalendarDb } = require(workerData.dbModule);
const engine = require(workerData.engineModule);

let result;
try {
    const db = openCalendarDb({
        dbPath: workerData.dbPath,
        skipRetentionSweep: true,
        skipReminderSweep: true,
    });
    const out = engine.createBooking(db, workerData.customerId, workerData.siteId, {
        serviceId: workerData.serviceId,
        startUtc: workerData.startUtc,
        visitorName: 'Vizitator ' + workerData.idx,
        visitorEmail: 'vizitator' + workerData.idx + '@example.com',
        nowMs: workerData.nowMs,
    });
    result = {
        ok: true,
        idx: workerData.idx,
        bookingId: out.booking.id,
        status: out.status,
        resourceId: out.booking.resource_id,
    };
    db.close();
} catch (e) {
    result = { ok: false, idx: workerData.idx, error: String((e && e.message) || e), code: e && e.code };
}
parentPort.postMessage(result);
`;

function runWorker(workerData) {
    return new Promise((resolve, reject) => {
        const w = new Worker(WORKER_SRC, { eval: true, workerData });
        w.on('message', (msg) => resolve(msg));
        w.on('error', reject);
        w.on('exit', (code) => {
            if (code !== 0) reject(new Error('worker exited with code ' + code));
        });
    });
}

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-wave7-conc-'));
    const dbPath = path.join(tmp, 'wave7-concurrency.sqlite');

    // --- Seed: one tenant, one service, N_RESOURCES stylists all offering it,
    // all open 24h on the target weekday so availability walls are never the
    // limiting factor — only resource occupancy is under test. Seeding runs
    // on the main thread BEFORE any worker opens the file, so schema
    // migration + settings/service/resource rows are never racy.
    const db = openCalendarDb({ dbPath, skipRetentionSweep: true, skipReminderSweep: true });
    engine.ensureSettings(db, C, S, {
        timezone: 'UTC',
        default_buffer_minutes: 0,
        slot_interval_minutes: 30,
        min_cancel_hours: 0,
    });
    const svc = engine.upsertService(db, C, S, {
        name: 'Tuns și styling',
        duration_minutes: 30,
    });
    const resources = [];
    for (let i = 0; i < N_RESOURCES; i++) {
        const r = engine.upsertResource(db, C, S, { name: 'Stilist ' + (i + 1), sort_order: i });
        engine.setWeeklyAvailability(db, C, S, [
            { weekday: 1, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 2, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 3, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 4, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 5, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 6, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 7, start_minute: 0, end_minute: 24 * 60 },
        ], { resourceId: r.id });
        resources.push(r);
    }
    // Explicit assignment (not relying on the "zero rows = all" fallback) —
    // this is exactly what a migrated tenant's services look like once a
    // second resource has been added (schema.js v5 doc comment).
    engine.setServiceResources(db, C, S, svc.id, resources.map((r) => r.id));

    const resourceIds = new Set(resources.map((r) => r.id));
    assert.strictEqual(resourceIds.size, N_RESOURCES, 'setup: distinct resource ids');

    const TARGET_START_UTC = '2031-03-03T10:00:00.000Z'; // a Monday
    assert.strictEqual(new Date(TARGET_START_UTC).getUTCDay(), 1, 'setup: target date must be a Monday');
    const NOW_MS = Date.parse('2031-01-01T00:00:00.000Z'); // well before the target — never "in the past"

    db.close(); // hand the file off cleanly before any worker opens it

    // --- Fire K_REQUESTS genuinely concurrent "any available" bookings at
    // the exact same instant, each from its own OS thread + own sqlite
    // connection.
    const jobs = [];
    for (let i = 0; i < K_REQUESTS; i++) {
        jobs.push(runWorker({
            dbModule: DB_MODULE,
            engineModule: ENGINE_MODULE,
            dbPath,
            customerId: C,
            siteId: S,
            serviceId: svc.id,
            startUtc: TARGET_START_UTC,
            nowMs: NOW_MS,
            idx: i,
        }));
    }
    const results = await Promise.all(jobs);

    // --- Every worker must complete without throwing (no SQLITE_BUSY
    // escaping as an unhandled error — see the busy_timeout comment above).
    const failed = results.filter((r) => !r.ok);
    assert.strictEqual(
        failed.length, 0,
        'every concurrent request must resolve to a booking outcome, never an unhandled error: ' +
            JSON.stringify(failed)
    );

    const confirmed = results.filter((r) => r.status === 'confirmed');
    const requested = results.filter((r) => r.status === 'requested');
    const other = results.filter((r) => r.status !== 'confirmed' && r.status !== 'requested');

    assert.strictEqual(other.length, 0, 'no result outside confirmed/requested: ' + JSON.stringify(other));
    assert.strictEqual(
        confirmed.length, N_RESOURCES,
        `exactly ${N_RESOURCES} of ${K_REQUESTS} concurrent "any available" requests must confirm (one per resource), got ${confirmed.length}`
    );
    assert.strictEqual(
        requested.length, K_REQUESTS - N_RESOURCES,
        `the remaining ${K_REQUESTS - N_RESOURCES} requests must be correctly refused (status=requested), got ${requested.length}`
    );

    // --- No resource double-booked: every confirmed booking's resource_id
    // is one of the seeded resources, and all N confirmed resource_ids are
    // pairwise distinct (worker-reported view).
    const confirmedResourceIds = confirmed.map((r) => r.resourceId);
    assert.ok(
        confirmedResourceIds.every((id) => resourceIds.has(id)),
        'every confirmed booking must land on one of the seeded resources'
    );
    assert.strictEqual(
        new Set(confirmedResourceIds).size, N_RESOURCES,
        'the confirmed bookings must cover all N resources with no repeats (no double-booking): ' +
            JSON.stringify(confirmedResourceIds)
    );

    // --- Refused requests are honestly unresolved, not silently pinned to a
    // busy resource.
    assert.ok(
        requested.every((r) => r.resourceId == null),
        'a refused "any available" request must be stored with resource_id = NULL, never a busy resource: ' +
            JSON.stringify(requested)
    );

    // --- Re-open the database independently (main thread, third connection)
    // and re-derive every assertion straight from SQL — the DB itself, not
    // just the workers' self-reported results, must show zero double-booking.
    const verifyDb = openCalendarDb({ dbPath, skipRetentionSweep: true, skipReminderSweep: true });
    const allBookings = verifyDb.prepare(
        `SELECT id, status, resource_id, start_utc, end_utc FROM calendar_bookings
         WHERE customer_id = ? AND site_id = ? AND start_utc = ?`
    ).all(C, S, TARGET_START_UTC);
    assert.strictEqual(allBookings.length, K_REQUESTS, 'DB must have exactly K_REQUESTS rows at the target start_utc');

    const dbConfirmed = allBookings.filter((b) => b.status === 'confirmed');
    const dbRequested = allBookings.filter((b) => b.status === 'requested');
    assert.strictEqual(dbConfirmed.length, N_RESOURCES, 'DB: exactly N_RESOURCES confirmed rows');
    assert.strictEqual(dbRequested.length, K_REQUESTS - N_RESOURCES, 'DB: remaining rows requested');

    const dbConfirmedResourceIds = dbConfirmed.map((b) => b.resource_id);
    assert.strictEqual(
        new Set(dbConfirmedResourceIds).size, N_RESOURCES,
        'DB: confirmed rows must occupy N_RESOURCES distinct resources — no double-booking'
    );
    assert.ok(dbRequested.every((b) => b.resource_id == null), 'DB: refused rows carry resource_id = NULL');

    // Direct double-booking sweep: no resource may have two ACTIVE bookings
    // whose [start,end) ranges overlap. With every booking sharing the exact
    // same start/end here this reduces to "no resource_id repeats among
    // active bookings", already shown above, but assert the general overlap
    // form too so this oracle also covers a future refactor that stops
    // giving every worker the same identical instant.
    const activeByResource = new Map();
    for (const b of allBookings) {
        if (b.status !== 'confirmed' && b.status !== 'requested') continue;
        if (!b.resource_id) continue; // unresolved rows occupy nothing
        if (!activeByResource.has(b.resource_id)) activeByResource.set(b.resource_id, []);
        activeByResource.get(b.resource_id).push(b);
    }
    for (const [resourceId, rows] of activeByResource) {
        for (let i = 0; i < rows.length; i++) {
            for (let j = i + 1; j < rows.length; j++) {
                const overlap = rows[i].start_utc < rows[j].end_utc && rows[j].start_utc < rows[i].end_utc;
                assert.ok(!overlap, `resource ${resourceId} has two overlapping active bookings — double-booked`);
            }
        }
    }

    verifyDb.close();

    // --- Evidence artifact: exact numbers for the task report.
    const evidenceDir = path.resolve(__dirname, '..', '..', '04-QA-Evidence', 'Wave7-calendar-staff');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
        path.join(evidenceDir, 'concurrency-result.json'),
        JSON.stringify({
            scenario: 'N resources, K genuinely concurrent "any available" requests for the same instant',
            mechanism: 'worker_threads, one node:sqlite connection per worker, shared WAL-mode sqlite file, PRAGMA busy_timeout=5000',
            nResources: N_RESOURCES,
            kRequests: K_REQUESTS,
            confirmed: confirmed.length,
            requested: requested.length,
            confirmedResourceIds: confirmedResourceIds.sort(),
            doubleBooked: 0,
            allWorkersResolvedWithoutError: failed.length === 0,
            targetStartUtc: TARGET_START_UTC,
            generatedAt: new Date().toISOString(),
        }, null, 2) + '\n'
    );

    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(
        `PASS wave7-calendar-resources-concurrency ` +
        `(${N_RESOURCES} resources, ${K_REQUESTS} concurrent "any available" requests: ` +
        `${confirmed.length} confirmed / ${requested.length} correctly refused / 0 double-booked)`
    );
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
