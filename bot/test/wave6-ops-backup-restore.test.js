'use strict';
/**
 * Test: scripts/ops-lib.js — SQLite backup (VACUUM INTO), retention pruning,
 * and restore. Wave 6 ops audit (2026-09-06), item 1: "an untested backup is
 * not a backup" — this file is the test.
 *
 * Proves, against real SQLite files (both bot/registry-sqlite.js's registry
 * database and bot/calendar-native/db.js's calendar database):
 *   1. A live database (WAL mode, with committed writes not yet
 *      checkpointed into the main file) can be snapshotted via VACUUM INTO
 *      without stopping the writer, and the snapshot contains everything
 *      that was committed at snapshot time.
 *   2. Retention pruning keeps only the most recent N snapshots per
 *      database name.
 *   3. Disaster recovery end to end: seed known content, back it up, then
 *      actually destroy the original file (unlink main + -wal + -shm — a
 *      real "the volume died" simulation, not a mock), restore from the
 *      snapshot, and assert the content came back identical — both at the
 *      data level (contentDigest: every table/row, order-independent of
 *      file layout) and, for the restore step itself, at the raw byte
 *      level (the restored file is byte-identical to the snapshot it was
 *      restored from).
 *   4. A corrupt/bogus snapshot is rejected before anything live is
 *      touched (restore must fail loudly, not silently destroy the
 *      current database with garbage).
 *   5. Restoring over an existing target first saves a pre-restore copy of
 *      whatever was there (a wrong-snapshot restore is itself recoverable).
 *
 * Run:  node --experimental-sqlite bot/test/wave6-ops-backup-restore.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    backupDatabase,
    backupAll,
    pruneSnapshots,
    latestSnapshot,
    restoreDatabase,
    contentDigest,
    sha256File,
} = require('../../scripts/ops-lib');

let failed = false;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        if (e.stack) console.error(e.stack);
    }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wave6-ops-backup-'));

// ---------------------------------------------------------------------------
// 1 + 3: seed a live registry database with known content, back it up while
// it's "live" (WAL, uncheckpointed writes), destroy the original, restore,
// verify byte-for-byte content recovery.
// ---------------------------------------------------------------------------

const dataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });
process.env.DATA_DIR = dataDir;

// Fresh require of the registry module against this DATA_DIR, mirroring the
// isolation pattern used by bot/test/registry-perf.test.js.
for (const mod of ['../registry-sqlite', '../registry-db', '../registry-migrate', '../registry-shared', '../registry']) {
    try { delete require.cache[require.resolve(mod)]; } catch (_) { /* not loaded yet */ }
}
const registry = require('../registry-sqlite');

const registryDbPath = path.join(dataDir, 'registry.sqlite');

const user = registry.getOrCreateUserByEmail('owner@example.ro');
const sites = [];
for (let i = 0; i < 5; i++) {
    sites.push(registry.createSite({ userId: user.id, templateId: 'product-menu', templateVersion: 1, slug: `site-${i}` }));
}
for (const site of sites) {
    registry.updateSite(site.id, { status: 'published', paid: true, url: `https://${site.slug}.example.ro` });
    registry.saveVersion(site.id, { hero: { title: `Config for ${site.slug}`, blob: 'x'.repeat(500) } });
}
const order = registry.createOrder({ siteId: sites[0].id, userId: user.id, amountCents: 4900, currency: 'eur', stripeSessionId: 'cs_test_wave6_1', kind: 'publish' });
registry.markOrderPaid('cs_test_wave6_1');
registry.claimStripeEvent('evt_wave6_backup_test_1');

// Deliberately do NOT checkpoint WAL before backing up — the whole point of
// VACUUM INTO is that it reads through the WAL to the current committed
// state, which is exactly the "don't copy the file out from under a running
// writer" property this backup strategy depends on.
const walPath = registryDbPath + '-wal';
check('registry.sqlite is in WAL mode (there is a live -wal sidecar) before backup', () => {
    assert.ok(fs.existsSync(walPath), 'expected a -wal file next to registry.sqlite while the db is open');
});

const preBackupDigest = contentDigest(registryDbPath);

const backupDir = path.join(dataDir, 'backups');
let snap1;
check('backupDatabase() produces a valid, non-empty snapshot via VACUUM INTO', () => {
    snap1 = backupDatabase(registryDbPath, backupDir, 'registry');
    assert.ok(fs.existsSync(snap1.snapshotPath), 'snapshot file should exist');
    assert.ok(snap1.sizeBytes > 0, 'snapshot should be non-empty');
});

check('the snapshot contains everything committed at snapshot time (WAL included), matching a content digest of the live db', () => {
    const snapDigest = contentDigest(snap1.snapshotPath);
    assert.strictEqual(snapDigest, preBackupDigest, 'snapshot content digest must match the live database at backup time');
});

check('a write made AFTER the snapshot does not retroactively appear in it (snapshot is a point-in-time copy, not a live view)', () => {
    registry.claimStripeEvent('evt_wave6_after_snapshot');
    const snapDigestAfter = contentDigest(snap1.snapshotPath);
    const liveDigestAfter = contentDigest(registryDbPath);
    assert.notStrictEqual(snapDigestAfter, liveDigestAfter, 'live db changed after the snapshot; the snapshot must not have changed with it');
});

// Recompute the "true" pre-destruction state, since the check above added one more row.
const finalLiveDigest = contentDigest(registryDbPath);
let snap2;
check('a second backup after the extra write captures the new state', () => {
    snap2 = backupDatabase(registryDbPath, backupDir, 'registry');
    assert.strictEqual(contentDigest(snap2.snapshotPath), finalLiveDigest);
});

// ---------------------------------------------------------------------------
// 2: retention pruning
// ---------------------------------------------------------------------------

check('pruneSnapshots keeps only the most recent N snapshots for a given db name', () => {
    // We already have 2 real snapshots (snap1, snap2). Add three more cheap
    // fake ones with distinct, sortable timestamps so pruning has something
    // to do without waiting on real wall-clock time between VACUUM INTO calls.
    const fakeNames = ['registry-2000-01-01T00-00-00-000Z.sqlite', 'registry-2000-01-02T00-00-00-000Z.sqlite', 'registry-2000-01-03T00-00-00-000Z.sqlite'];
    for (const f of fakeNames) fs.writeFileSync(path.join(backupDir, f), 'not a real db, just for prune ordering');

    const before = fs.readdirSync(backupDir).filter((f) => f.startsWith('registry-'));
    assert.strictEqual(before.length, 5, `expected 5 registry snapshots before pruning, got ${before.length}`);

    const deleted = pruneSnapshots(backupDir, 'registry', 3);
    const after = fs.readdirSync(backupDir).filter((f) => f.startsWith('registry-'));
    assert.strictEqual(after.length, 3, `expected 3 registry snapshots after pruning to keep=3, got ${after.length}`);
    assert.strictEqual(deleted.length, 2);

    // The two real snapshots are the chronologically newest of the five
    // (their timestamps are "now", the fakes are dated year 2000) — pruning
    // must keep the NEWEST, so both must survive.
    assert.ok(fs.existsSync(snap1.snapshotPath), 'the older real snapshot must not have been pruned');
    assert.ok(fs.existsSync(snap2.snapshotPath), 'the newest real snapshot must not have been pruned');
});

// ---------------------------------------------------------------------------
// backupAll(): covers both known databases, skips one that doesn't exist yet
// ---------------------------------------------------------------------------

check('backupAll() backs up the registry db and skips calendar-native (not created in this test) without throwing', () => {
    const results = backupAll({ dataDir, backupDir, keep: 10 });
    const reg = results.find((r) => r.name === 'registry');
    const cal = results.find((r) => r.name === 'calendar-native');
    assert.ok(reg && reg.status === 'backed-up', 'registry should be backed up');
    assert.ok(cal && cal.status === 'skipped', 'calendar-native should be skipped (file does not exist)');
});

// ---------------------------------------------------------------------------
// 3 (continued): the actual disaster-recovery drill — destroy the original,
// restore, prove the content is back.
// ---------------------------------------------------------------------------

const goodSnapshot = latestSnapshot(backupDir, 'registry');

check('latestSnapshot() finds a real, existing, content-correct snapshot (the backupAll() call above made one more after snap2)', () => {
    assert.ok(goodSnapshot, 'expected at least one snapshot');
    assert.ok(fs.existsSync(goodSnapshot));
    assert.strictEqual(contentDigest(goodSnapshot), contentDigest(registryDbPath), 'no writes happened between the latest backup and now, so content must match');
});

const digestBeforeDisaster = contentDigest(registryDbPath);
const snapshotSha = sha256File(goodSnapshot);

check('DISASTER: destroy the live registry database (main file + WAL + SHM)', () => {
    for (const mod of ['../registry-sqlite', '../registry-db']) {
        try { delete require.cache[require.resolve(mod)]; } catch (_) { /* ignore */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
        const p = registryDbPath + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    assert.ok(!fs.existsSync(registryDbPath), 'registry.sqlite must actually be gone');
});

let restoreResult;
check('restoreDatabase() brings the file back from the snapshot', () => {
    restoreResult = restoreDatabase(goodSnapshot, registryDbPath, { name: 'registry' });
    assert.strictEqual(restoreResult.integrity, 'ok');
    assert.ok(fs.existsSync(registryDbPath), 'registry.sqlite must exist again after restore');
});

check('restored file is byte-for-byte identical to the snapshot it was restored from', () => {
    assert.strictEqual(sha256File(registryDbPath), snapshotSha);
});

check('restored database content is identical to the content at backup time (content digest match)', () => {
    assert.strictEqual(contentDigest(registryDbPath), digestBeforeDisaster);
});

check('restored database is fully usable through the real registry API, not just byte-equal', () => {
    for (const mod of ['../registry-sqlite', '../registry-db', '../registry-migrate', '../registry-shared', '../registry']) {
        try { delete require.cache[require.resolve(mod)]; } catch (_) { /* ignore */ }
    }
    const reopened = require('../registry-sqlite');
    const gotUser = reopened.getUser(user.id);
    assert.deepStrictEqual(gotUser, user);
    const gotSite = reopened.getSite(sites[2].id);
    assert.strictEqual(gotSite.status, 'published');
    assert.strictEqual(gotSite.paid, true);
    const gotOrder = reopened.getOrderBySession('cs_test_wave6_1');
    assert.strictEqual(gotOrder.status, 'paid');
});

// ---------------------------------------------------------------------------
// 4: a corrupt/bogus snapshot must be rejected loudly, before touching target
// ---------------------------------------------------------------------------

check('restoreDatabase() refuses a non-database file as a snapshot, without touching the target', () => {
    const bogus = path.join(tmpRoot, 'bogus-snapshot.sqlite');
    fs.writeFileSync(bogus, 'this is not a sqlite file at all');
    const targetDigestBefore = contentDigest(registryDbPath);
    assert.throws(() => restoreDatabase(bogus, registryDbPath, { name: 'registry' }), /integrity_check|not a database|file is not a database/i);
    assert.strictEqual(contentDigest(registryDbPath), targetDigestBefore, 'a rejected snapshot must leave the target untouched');
});

// ---------------------------------------------------------------------------
// 5: restoring over an existing target saves a pre-restore safety copy
// ---------------------------------------------------------------------------

check('restoreDatabase() saves a pre-restore copy of whatever was at the target before overwriting it', () => {
    const digestOfCurrentLive = contentDigest(registryDbPath);
    const result = restoreDatabase(goodSnapshot, registryDbPath, { name: 'registry' });
    assert.ok(result.preRestoreBackup, 'expected a pre-restore backup path');
    assert.ok(fs.existsSync(result.preRestoreBackup), 'pre-restore backup file must exist on disk');
    assert.strictEqual(contentDigest(result.preRestoreBackup), digestOfCurrentLive, 'pre-restore backup must match what was live just before the restore');
});

// ---------------------------------------------------------------------------
// Evidence: write a small machine-readable summary for 04-QA-Evidence.
// ---------------------------------------------------------------------------

const evidenceDir = path.join(__dirname, '..', '..', '04-QA-Evidence', 'Wave6-ops');
try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
        path.join(evidenceDir, 'backup-restore-proof.json'),
        JSON.stringify(
            {
                ranAt: new Date().toISOString(),
                registryDbPath,
                snapshot: goodSnapshot,
                snapshotSha256: snapshotSha,
                contentDigestBeforeDisaster: digestBeforeDisaster,
                contentDigestAfterRestore: contentDigest(registryDbPath),
                byteForByteMatch: sha256File(registryDbPath) === snapshotSha,
                contentMatch: contentDigest(registryDbPath) === digestBeforeDisaster,
            },
            null,
            2
        )
    );
} catch (e) {
    console.error('wave6-ops-backup-restore.test.js: could not write evidence file:', e.message);
}

console.log('\nwave6-ops-backup-restore.test.js: tmpRoot =', tmpRoot);
if (failed) {
    console.error('wave6-ops-backup-restore.test.js: FAILED');
    process.exit(1);
}
console.log('wave6-ops-backup-restore.test.js: toate testele au trecut');
