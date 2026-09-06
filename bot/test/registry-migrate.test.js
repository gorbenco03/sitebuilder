'use strict';
/**
 * Test: bot/registry-migrate.js — JSON → SQLite migration.
 *
 * Builds a realistic .registry.json by hand (users, tokens, sites with an
 * "extra"-only field, versions with a base64-ish payload, orders, and
 * stripeEvents), runs the migration against a fresh SQLite database, and
 * proves: row counts per collection match, a spot-checked sample is
 * byte-for-byte equal via the public read API, re-running the migration is
 * a no-op (idempotent), and the original .registry.json file is left
 * completely untouched (non-destructive).
 *
 * Run:  node --experimental-sqlite bot/test/registry-migrate.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-migrate-test-'));
const registryFile = path.join(tmpDir, '.registry.json');

// ── Build a realistic legacy .registry.json by hand ─────────────────────────
function buildLegacyRegistry() {
    const users = {};
    const sites = {};
    const versions = {};
    const orders = {};
    const tokens = {};
    const stripeEvents = {};

    for (let i = 0; i < 12; i++) {
        const id = crypto.randomUUID();
        users[id] = { id, email: `user${i}@example.com`, createdAt: new Date(2025, 0, 1 + i).toISOString() };
    }
    const userIds = Object.keys(users);

    for (let i = 0; i < 20; i++) {
        const id = crypto.randomUUID();
        const site = {
            id,
            userId: userIds[i % userIds.length],
            templateId: 'product-menu',
            templateVersion: 1,
            slug: `legacy-site-${i}`,
            projectName: `legacy-site-${i}`,
            platform: 'web',
            status: i % 3 === 0 ? 'live' : 'draft',
            paid: i % 3 === 0,
            url: i % 3 === 0 ? `https://legacy-site-${i}.pages.dev` : null,
            createdAt: new Date(2025, 1, 1 + i).toISOString(),
        };
        // Reproduce the pre-fix Object.assign leak on a couple of records —
        // migration must preserve this as historical data, even though the
        // NEW updateSite() would refuse to write it going forward.
        if (i === 2) site.legacyStrayField = 'from the old Object.assign bug';
        if (i % 3 === 0) { site.paidUntil = new Date(2026, 1, 1 + i).toISOString(); site.stripeSubscriptionStatus = 'active'; }
        sites[id] = site;

        if (i < 8) {
            versions[id] = [];
            for (let v = 0; v < 3; v++) {
                versions[id].push({
                    versionId: crypto.randomUUID(),
                    publishedAt: new Date(2025, 2, 1 + i, 0, 0, v).toISOString(),
                    config: {
                        business: { name: `Legacy Business ${i}` },
                        gallery: [Buffer.alloc(512, 65 + (i % 20)).toString('base64')],
                        n: v,
                    },
                });
            }
        }
    }
    const siteIds = Object.keys(sites);

    for (let i = 0; i < 15; i++) {
        const id = crypto.randomUUID();
        orders[id] = {
            id,
            siteId: siteIds[i % siteIds.length],
            userId: userIds[i % userIds.length],
            amountCents: 9900,
            currency: 'eur',
            stripeSessionId: `cs_legacy_${i}`,
            kind: i % 4 === 0 ? 'renewal' : 'publish',
            status: i % 5 === 0 ? 'paid' : 'pending',
            createdAt: new Date(2025, 3, 1 + i).toISOString(),
            ...(i % 5 === 0 ? { paidAt: new Date(2025, 3, 2 + i).toISOString() } : {}),
        };
    }

    for (let i = 0; i < 6; i++) {
        const raw = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        tokens[hash] = {
            payload: { purpose: 'login', email: `user${i}@example.com` },
            exp: Date.now() + 15 * 60 * 1000,
            used: i % 2 === 0,
        };
    }

    for (let i = 0; i < 10; i++) {
        stripeEvents[`evt_legacy_${i}`] = { seenAt: new Date(2025, 4, 1 + i).toISOString() };
    }

    return { users, tokens, sites, versions, orders, stripeEvents };
}

const legacy = buildLegacyRegistry();
fs.writeFileSync(registryFile, JSON.stringify(legacy));
const originalRegistryFileBytes = fs.readFileSync(registryFile);

// ── Run the migration ────────────────────────────────────────────────────
process.env.DATA_DIR = tmpDir;
const { openRegistryDb } = require('../registry-db');
const { migrateFromJson, MIGRATION_MARKER_KEY } = require('../registry-migrate');

const db = openRegistryDb({ dataDir: tmpDir });

check('migrateFromJson: first run reports migrated+verified with matching counts', () => {
    const result = migrateFromJson(db, { dataDir: tmpDir });
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.counts, {
        users: 12, tokens: 6, sites: 20, versions: 24, orders: 15, stripeEvents: 10,
    });
});

check('migrateFromJson: row counts in SQLite match the JSON source exactly', () => {
    const c = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    assert.strictEqual(c('users'), 12);
    assert.strictEqual(c('tokens'), 6);
    assert.strictEqual(c('sites'), 20);
    assert.strictEqual(c('versions'), 24);
    assert.strictEqual(c('orders'), 15);
    assert.strictEqual(c('stripe_events'), 10);
});

check('migrateFromJson: idempotent — second run is a no-op (already-migrated)', () => {
    const before = db.prepare('SELECT COUNT(*) AS c FROM sites').get().c;
    const result = migrateFromJson(db, { dataDir: tmpDir });
    assert.strictEqual(result.migrated, false);
    assert.strictEqual(result.reason, 'already-migrated');
    const after = db.prepare('SELECT COUNT(*) AS c FROM sites').get().c;
    assert.strictEqual(after, before, 'no duplicate rows from a second migration run');
});

check('migrateFromJson: non-destructive — .registry.json is byte-for-byte untouched', () => {
    const nowBytes = fs.readFileSync(registryFile);
    assert.ok(nowBytes.equals(originalRegistryFileBytes), '.registry.json must not be modified by migration');
});

check('migrateFromJson: migration marker is recorded in registry_meta', () => {
    const row = db.prepare('SELECT value FROM registry_meta WHERE key = ?').get(MIGRATION_MARKER_KEY);
    assert.ok(row && row.value, 'marker row must exist with a timestamp value');
});

// ── Deep-equality spot checks via the public SQLite-backend read API ───────
delete require.cache[require.resolve('../registry-sqlite')];
delete require.cache[require.resolve('../registry-db')];
delete require.cache[require.resolve('../registry-migrate')];
const sqliteRegistry = require('../registry-sqlite');

check('migrated user is readable and byte-identical via getUser()', () => {
    const [id, src] = Object.entries(legacy.users)[3];
    const got = sqliteRegistry.getUser(id);
    assert.deepStrictEqual(got, src);
});

check('migrated site (including a pre-existing stray field from the old Object.assign bug) round-trips via getSite()', () => {
    const strayId = Object.values(legacy.sites).find((s) => s.legacyStrayField).id;
    const got = sqliteRegistry.getSite(strayId);
    assert.strictEqual(got.legacyStrayField, 'from the old Object.assign bug', 'legacy stray field preserved by migration, not dropped');
    assert.deepStrictEqual(got, legacy.sites[strayId]);
});

check('migrated site with billing extras round-trips via getSite()', () => {
    const billedId = Object.values(legacy.sites).find((s) => s.paidUntil).id;
    const got = sqliteRegistry.getSite(billedId);
    assert.deepStrictEqual(got, legacy.sites[billedId]);
});

check('migrated versions round-trip via listVersions()/getVersionConfig(), in original order', () => {
    const [siteId, list] = Object.entries(legacy.versions)[2];
    const got = sqliteRegistry.listVersions(siteId);
    assert.deepStrictEqual(got.map((v) => v.versionId), list.map((v) => v.versionId), 'insertion order preserved');
    for (const v of list) {
        assert.deepStrictEqual(sqliteRegistry.getVersionConfig(siteId, v.versionId), v.config);
    }
});

check('migrated order round-trips via getOrder()/getOrderBySession()', () => {
    const [id, src] = Object.entries(legacy.orders)[7];
    assert.deepStrictEqual(sqliteRegistry.getOrder(id), src);
    assert.deepStrictEqual(sqliteRegistry.getOrderBySession(src.stripeSessionId), src);
});

console.log(`\nregistry-migrate.test.js: module=${require.resolve('../registry-migrate')}`);
if (failed) {
    console.error('registry-migrate.test.js: FAILED');
    process.exit(1);
}
console.log('registry-migrate.test.js: toate testele au trecut');
