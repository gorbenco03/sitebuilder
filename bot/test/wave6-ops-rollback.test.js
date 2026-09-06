'use strict';
/**
 * Test: rollback safety of the schema migrations that actually exist today.
 * Wave 6 ops audit (2026-09-06), item 2.
 *
 * "If a deploy goes bad, what does the owner do?" HANDOFF-ops.md documents
 * the procedure (redeploy the previous Railway image / revert + push). This
 * file proves the two claims that procedure depends on being true, against
 * the real schema code (bot/registry-schema.js, bot/calendar-native/schema.js
 * + bot/calendar-native/db.js), not a description of them:
 *
 *   A. Every migration that has ever shipped (registry V1; calendar-native
 *      V1, V2, V3) is purely additive (CREATE TABLE / ALTER TABLE ADD
 *      COLUMN) — never a DROP or a destructive ALTER. That means code from
 *      BEFORE a migration existed keeps working, unmodified, against a
 *      database that has ALREADY had that migration applied. This is what
 *      makes "roll the app back, leave the database alone" a safe, real
 *      rollback path for schema changes specifically.
 *
 *   B. That schema-level safety is NOT the same as data-level safety. A
 *      rolled-back deploy does not undo any DATA a newer deploy already
 *      wrote or changed (it only reverts code) — proven here with the one
 *      genuinely irreversible operation in this codebase: the retention
 *      module's PII anonymization (bot/calendar-native/retention.js), which
 *      overwrites visitor_name/visitor_email/visitor_phone/note in place.
 *      Rolling back the app does not bring that PII back — restoring the
 *      database from a PRE-anonymization backup (scripts/ops-restore.js,
 *      see wave6-ops-backup-restore.test.js) is the only path that does.
 *      This is the honesty the task asked for: additive schema migrations
 *      are rollback-safe; in-place data mutations are not, regardless of
 *      what the schema looks like.
 *
 *   C. The registry's SQLite cutover itself ships its own rollback switch —
 *      REGISTRY_BACKEND=json — and it still resolves to the original
 *      JSON-file backend module with no code change, exactly as documented
 *      in bot/registry.js.
 *
 * Run:  node --experimental-sqlite bot/test/wave6-ops-rollback.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = false;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

// ---------------------------------------------------------------------------
// A. Static proof: every migration SQL string is additive-only.
// ---------------------------------------------------------------------------

const registrySchema = require('../registry-schema');
const calendarSchema = require('../calendar-native/schema');

/** A migration is "additive-only" if it never drops a table/column and never
 * runs a destructive ALTER (rename/drop column, change type). CREATE TABLE/
 * INDEX and ALTER TABLE ... ADD COLUMN are the only DDL forms this codebase's
 * migrations use; this check would fail loudly the day someone adds a DROP. */
function isAdditiveOnly(sql) {
    const dangerous = /\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bALTER\s+TABLE\s+\S+\s+(DROP|RENAME)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i;
    return !dangerous.test(sql);
}

check('registry-schema.js SCHEMA_SQL_V1 is additive-only (CREATE TABLE/INDEX, no DROP/DELETE)', () => {
    assert.ok(isAdditiveOnly(registrySchema.SCHEMA_SQL_V1));
    assert.ok(/CREATE TABLE/i.test(registrySchema.SCHEMA_SQL_V1));
});

check('calendar-native schema.js V1/V2/V3 are all additive-only', () => {
    const { SCHEMA_SQL_V1, SCHEMA_SQL_V2, SCHEMA_SQL_V3 } = calendarSchema;
    assert.ok(isAdditiveOnly(SCHEMA_SQL_V1));
    assert.ok(isAdditiveOnly(SCHEMA_SQL_V2));
    assert.ok(isAdditiveOnly(SCHEMA_SQL_V3));
    // V3 specifically is the one that could most easily have been written
    // destructively (a rename/retype instead of an add) — pin its exact shape.
    assert.match(SCHEMA_SQL_V3, /ALTER TABLE calendar_bookings ADD COLUMN anonymized_at/i);
});

// ---------------------------------------------------------------------------
// B(part 1). Behavioral proof: code that predates a migration still works,
// unmodified, against a database that already has it applied.
// ---------------------------------------------------------------------------

const { openCalendarDb } = require('../calendar-native/db');

const dataDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'wave6-rollback-forward-compat-'));
const calDbPath = path.join(dataDir1, 'calendar-native.sqlite');
const db = openCalendarDb({ dbPath: calDbPath, skipRetentionSweep: true });

// Confirm the live db really did apply every migration up through V3 (the
// anonymized_at column exists) before we simulate "old code" against it.
check('the freshly-opened calendar db has migrated through V3 (anonymized_at column exists)', () => {
    const cols = db.prepare("PRAGMA table_info(calendar_bookings)").all().map((c) => c.name);
    assert.ok(cols.includes('anonymized_at'), `expected anonymized_at column, got columns: ${cols.join(', ')}`);
});

const OLD_CODE_INSERT_COLUMNS = [
    // Exactly the calendar_bookings columns that existed in SCHEMA_SQL_V1 —
    // i.e. what a pre-V3 deploy's INSERT statement would look like. It never
    // mentions anonymized_at because that deploy's code doesn't know it exists.
    'id', 'customer_id', 'site_id', 'service_id', 'start_utc', 'end_utc',
    'status', 'visitor_name', 'visitor_email', 'visitor_phone', 'note',
    'manage_token_hash', 'created_at', 'updated_at',
];

check('a pre-V3 style INSERT (no anonymized_at column mentioned) succeeds against the V3-migrated table', () => {
    const now = new Date().toISOString();
    const sql = `INSERT INTO calendar_bookings (${OLD_CODE_INSERT_COLUMNS.join(', ')}) VALUES (${OLD_CODE_INSERT_COLUMNS.map(() => '?').join(', ')})`;
    db.prepare(sql).run(
        'bk_old_code_1', 'cust_1', 'site_1', 'svc_1',
        '2020-01-01T10:00:00.000Z', '2020-01-01T10:30:00.000Z',
        'confirmed', 'Maria Popescu', 'maria@example.ro', null, null,
        'hash1', now, now
    );
    const row = db.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_old_code_1');
    assert.ok(row, 'row should have been inserted');
    assert.strictEqual(row.anonymized_at, null, 'a column the old code never mentioned defaults to NULL, not an error');
});

check('a pre-V3 style SELECT (explicit column list excluding anonymized_at) succeeds against the V3-migrated table', () => {
    const sql = `SELECT ${OLD_CODE_INSERT_COLUMNS.join(', ')} FROM calendar_bookings WHERE id = ?`;
    const row = db.prepare(sql).get('bk_old_code_1');
    assert.strictEqual(row.visitor_name, 'Maria Popescu');
    assert.ok(!('anonymized_at' in row), 'old code asked for specific columns, so the new one is simply absent from the result — not an error either way');
});

// ---------------------------------------------------------------------------
// B(part 2). Honesty check: rolling back code does NOT undo data already
// mutated by a newer deploy. Anonymization is the concrete, real example.
// ---------------------------------------------------------------------------

const { runRetentionSweep } = require('../calendar-native/retention');
const { backupDatabase, restoreDatabase, latestSnapshot } = require('../../scripts/ops-lib');

const backupDir1 = path.join(dataDir1, 'backups');

check('SETUP: a second, old-enough-to-anonymize booking exists with real PII, and we back it up BEFORE any anonymization runs', () => {
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO calendar_bookings (id, customer_id, site_id, service_id, start_utc, end_utc, status, visitor_name, visitor_email, visitor_phone, note, manage_token_hash, created_at, updated_at)
        VALUES ('bk_old_pii', 'cust_1', 'site_1', 'svc_1', '2020-02-02T11:00:00.000Z', '2020-02-02T11:30:00.000Z', 'confirmed', 'Ion Vasilescu', 'ion@example.ro', '+40712345678', 'alergic la nuci', 'hash2', ?, ?)
    `).run(now, now);
    backupDatabase(calDbPath, backupDir1, 'calendar-native');
    const snap = latestSnapshot(backupDir1, 'calendar-native');
    assert.ok(snap);
});

check('runRetentionSweep anonymizes the old booking\'s PII in place (this is the "new deploy" mutating data)', () => {
    const { anonymizedCount } = runRetentionSweep(db, { nowMs: Date.now() });
    assert.ok(anonymizedCount >= 1, `expected at least 1 row anonymized, got ${anonymizedCount}`);
    const row = db.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_old_pii');
    assert.notStrictEqual(row.visitor_name, 'Ion Vasilescu');
    assert.notStrictEqual(row.visitor_email, 'ion@example.ro');
    assert.strictEqual(row.visitor_phone, null);
    assert.ok(row.anonymized_at, 'anonymized_at should now be set');
});

check('"rolling back the deploy" (there is no code path that un-anonymizes) leaves the PII gone — code rollback is not data recovery', () => {
    // There genuinely is no un-anonymize function anywhere in
    // bot/calendar-native/ — this assertion documents that absence by
    // construction: the row after the "mutation" step above is still
    // anonymized, and nothing in this codebase can change that without
    // touching the database directly.
    const row = db.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_old_pii');
    assert.notStrictEqual(row.visitor_name, 'Ion Vasilescu');
});

check('ONLY a database restore from the pre-sweep backup recovers the original PII', () => {
    db.close(); // must not hold the file open while ops-restore overwrites it
    const snap = latestSnapshot(backupDir1, 'calendar-native');
    restoreDatabase(snap, calDbPath, { name: 'calendar-native' });
    const reopened = openCalendarDb({ dbPath: calDbPath, skipRetentionSweep: true });
    try {
        const row = reopened.prepare('SELECT * FROM calendar_bookings WHERE id = ?').get('bk_old_pii');
        assert.strictEqual(row.visitor_name, 'Ion Vasilescu');
        assert.strictEqual(row.visitor_email, 'ion@example.ro');
        assert.strictEqual(row.anonymized_at, null, 'restored to the pre-sweep state: not yet anonymized');
    } finally {
        reopened.close();
    }
});

// ---------------------------------------------------------------------------
// C. The registry's own emergency exit: REGISTRY_BACKEND=json still resolves
// to the original JSON-file module, no code change required.
// ---------------------------------------------------------------------------

check('REGISTRY_BACKEND=json makes bot/registry.js resolve to registry-json.js (the pre-SQLite-cutover rollback switch)', () => {
    const prev = process.env.REGISTRY_BACKEND;
    process.env.REGISTRY_BACKEND = 'json';
    delete require.cache[require.resolve('../registry')];
    try {
        const reg = require('../registry');
        const jsonImpl = require('../registry-json');
        assert.strictEqual(reg.createSite, jsonImpl.createSite, 'registry.js must re-export the JSON backend\'s own functions when REGISTRY_BACKEND=json');
    } finally {
        if (prev == null) delete process.env.REGISTRY_BACKEND; else process.env.REGISTRY_BACKEND = prev;
        delete require.cache[require.resolve('../registry')];
    }
});

console.log('\nwave6-ops-rollback.test.js: dataDir1 =', dataDir1);
if (failed) {
    console.error('wave6-ops-rollback.test.js: FAILED');
    process.exit(1);
}
console.log('wave6-ops-rollback.test.js: toate testele au trecut');
