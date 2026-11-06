'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const { openCalendarDb } = require('../calendar-native/db');

test('calendar startup waits for an existing writer before switching journal mode', { timeout: 10_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-startup-lock-'));
    const dbPath = path.join(dir, 'calendar.sqlite');
    const seed = new DatabaseSync(dbPath);
    seed.exec('PRAGMA journal_mode = DELETE; CREATE TABLE startup_lock (id INTEGER);');
    seed.close();
    const barrier = new SharedArrayBuffer(4);
    const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(workerData.dbPath);
        db.exec('BEGIN EXCLUSIVE; INSERT INTO startup_lock VALUES (1);');
        parentPort.postMessage('locked');
        Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
        setTimeout(() => { db.exec('COMMIT;'); db.close(); }, 250);
    `, { eval: true, workerData: { dbPath, barrier } });
    const exited = new Promise((resolve, reject) => {
        worker.once('error', reject);
        worker.once('exit', code => code === 0 ? resolve() : reject(new Error('lock worker exit ' + code)));
    });
    // Attach a handler before awaiting startup: no unhandled rejection on failure.
    exited.catch(() => {});
    let db;
    try {
        await new Promise((resolve, reject) => {
            worker.once('message', message => message === 'locked' ? resolve() : reject(new Error(message)));
            worker.once('error', reject);
        });
        Atomics.store(new Int32Array(barrier), 0, 1);
        Atomics.notify(new Int32Array(barrier), 0);
        db = openCalendarDb({ dbPath, skipRetentionSweep: true, skipReminderSweep: true });
        assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
        assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM startup_lock').get().count, 1);
        assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'calendar_bookings'").get(), 'normal calendar migration still completes');
    } finally {
        if (db) db.close();
        Atomics.store(new Int32Array(barrier), 0, 1);
        Atomics.notify(new Int32Array(barrier), 0);
        await exited;
    }
});

test('synchronized concurrent calendar opens preserve the original 20-request/5-resource SQL oracle', { timeout: 30_000 }, async () => {
    // Reuse every original booking/SQL assertion, adding only a startup barrier.
    let source = fs.readFileSync(path.join(__dirname, 'wave7-calendar-resources-concurrency.test.js'), 'utf8');
    function replaceOnce(before, after) {
        assert.equal(source.split(before).length, 2, 'original concurrency seam must remain unique: ' + before);
        source = source.replace(before, after);
    }
    replaceOnce('let result;\ntry {', 'let result;\nparentPort.postMessage({ ready: true });\nAtomics.wait(new Int32Array(workerData.startupBarrier), 0, 0);\ntry {');
    replaceOnce('function runWorker(workerData) {', 'const startupBarrier = new SharedArrayBuffer(4);\nlet ready = 0;\nfunction runWorker(workerData) {');
    replaceOnce('eval: true, workerData', 'eval: true, workerData: { ...workerData, startupBarrier }');
    replaceOnce("w.on('message', (msg) => resolve(msg));", "w.on('message', (msg) => { if (msg.ready) { if (++ready === K_REQUESTS) { Atomics.store(new Int32Array(startupBarrier), 0, 1); Atomics.notify(new Int32Array(startupBarrier), 0); } } else resolve(msg); });");
    replaceOnce('error: String((e && e.message) || e)', 'error: String((e && e.stack) || e)');
    const child = spawn(process.execPath, ['--experimental-sqlite', '--eval', source], { cwd: __dirname });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 25_000);
    try {
        const code = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', (code, signal) => resolve(signal || code));
        });
        assert.equal(code, 0, output);
        assert.match(output, /5 confirmed \/ 15 correctly refused \/ 0 double-booked/);
    } finally { clearTimeout(timer); }
});
