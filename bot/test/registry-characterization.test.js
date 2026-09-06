'use strict';
/**
 * Characterization test — bot/registry.js (the JSON-backed data registry).
 *
 * Purpose: pin the CURRENT observable behavior of every one of the 21 exported
 * functions, exactly as it is today, so that a future storage rewrite (SQLite)
 * can be checked against it. This test does not judge the design and does not
 * fix anything it finds odd — odd behavior is asserted as-is and called out in
 * the accompanying report.
 *
 * The module under test is resolved from REGISTRY_MODULE_PATH so this exact
 * suite can later run unchanged against a new implementation:
 *   REGISTRY_MODULE_PATH=/path/to/new/registry.js node --test bot/test/registry-characterization.test.js
 * Default: ../registry.js (the real module).
 *
 * Run:  node --test bot/test/registry-characterization.test.js
 *   or: node bot/test/registry-characterization.test.js
 * Exits non-zero on the first failed assertion group.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ── Isolate ───────────────────────────────────────────────────────────────────
// Each run gets its own throwaway DATA_DIR so we never touch real data.
// Must be set BEFORE requiring the module under test (it resolves paths at load time).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-char-test-'));
process.env.DATA_DIR = tmpDir;

const MODULE_PATH = process.env.REGISTRY_MODULE_PATH
    ? path.resolve(process.env.REGISTRY_MODULE_PATH)
    : path.join(__dirname, '..', 'registry.js');

const registry = require(MODULE_PATH);

// ── Test harness (same shape as bot/test/registry-auth.test.js) ────────────────
let failed = false;
let assertionCount = 0;
const origAssert = assert.strictEqual;
// Wrap a handful of assert methods to count calls without changing behavior.
for (const method of ['strictEqual', 'deepStrictEqual', 'notStrictEqual', 'ok', 'throws', 'doesNotThrow']) {
    const orig = assert[method];
    assert[method] = function (...args) {
        assertionCount++;
        return orig.apply(assert, args);
    };
}

function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

/** Run `fn` with the global Date frozen/shifted so `new Date()` / `Date.now()`
 *  inside registry.js return a controlled instant. This lets us pin
 *  time-dependent behavior (token expiry, createdAt ordering, event pruning)
 *  WITHOUT reaching into on-disk storage internals — so the same trick works
 *  against any backend (JSON file or SQLite), not just the current one. */
function withFakeNow(ms, fn) {
    const RealDate = Date;
    class FakeDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) { super(ms); return; }
            super(...args);
        }
        static now() { return ms; }
    }
    global.Date = FakeDate;
    try {
        return fn();
    } finally {
        global.Date = RealDate;
    }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// =============================================================================
// 1. getOrCreateUserByEmail
// =============================================================================

check('getOrCreateUserByEmail: invalid input throws exact message', () => {
    assert.throws(() => registry.getOrCreateUserByEmail(), /email is required/);
    assert.throws(() => registry.getOrCreateUserByEmail(''), /email is required/);
    assert.throws(() => registry.getOrCreateUserByEmail(null), /email is required/);
    assert.throws(() => registry.getOrCreateUserByEmail(42), /email is required/);
    try { registry.getOrCreateUserByEmail(); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.message, 'email is required'); }
});

check('getOrCreateUserByEmail: shape of a freshly created user', () => {
    const u = registry.getOrCreateUserByEmail('alice@example.com');
    assert.deepStrictEqual(Object.keys(u).sort(), ['createdAt', 'email', 'id'].sort());
    assert.strictEqual(u.email, 'alice@example.com');
    assert.ok(UUID_RE.test(u.id), 'id must be a UUID');
    assert.ok(ISO_RE.test(u.createdAt), 'createdAt must be ISO-8601 with ms + Z');
});

check('getOrCreateUserByEmail: idempotent on the same email (same id, same createdAt)', () => {
    const u1 = registry.getOrCreateUserByEmail('bob@example.com');
    const u2 = registry.getOrCreateUserByEmail('bob@example.com');
    assert.strictEqual(u1.id, u2.id);
    assert.strictEqual(u1.createdAt, u2.createdAt);
});

check('getOrCreateUserByEmail: returns a copy, not a live reference', () => {
    const u1 = registry.getOrCreateUserByEmail('carol@example.com');
    u1.email = 'MUTATED';
    const u2 = registry.getOrCreateUserByEmail('carol@example.com');
    assert.strictEqual(u2.email, 'carol@example.com', 'stored record must be unaffected by mutating a returned copy');
});

// =============================================================================
// 2. getOrCreateUserByTelegram
// =============================================================================

check('getOrCreateUserByTelegram: invalid input throws exact message', () => {
    assert.throws(() => registry.getOrCreateUserByTelegram(null), /tgId is required/);
    assert.throws(() => registry.getOrCreateUserByTelegram(undefined), /tgId is required/);
    try { registry.getOrCreateUserByTelegram(null); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.message, 'tgId is required'); }
});

check('getOrCreateUserByTelegram: tgId 0 is accepted (0 == null is false)', () => {
    const u = registry.getOrCreateUserByTelegram(0);
    assert.strictEqual(u.tgId, '0');
});

check('getOrCreateUserByTelegram: shape of a freshly created user, meta omitted when not given', () => {
    const u = registry.getOrCreateUserByTelegram(555111);
    assert.strictEqual(u.tgId, '555111');
    assert.ok(UUID_RE.test(u.id));
    assert.ok(ISO_RE.test(u.createdAt));
    assert.ok(!('username' in u), 'username key absent when not provided');
    assert.ok(!('firstName' in u), 'firstName key absent when not provided');
});

check('getOrCreateUserByTelegram: tgId is coerced to string, numeric and string forms collide', () => {
    const uNum = registry.getOrCreateUserByTelegram(700200);
    const uStr = registry.getOrCreateUserByTelegram('700200');
    assert.strictEqual(uNum.id, uStr.id, 'same user for numeric and string tgId');
});

check('getOrCreateUserByTelegram: second call updates provided meta fields, keeps id, keeps unset fields', () => {
    const u1 = registry.getOrCreateUserByTelegram(800300, { username: 'ana', firstName: 'Ana' });
    const u2 = registry.getOrCreateUserByTelegram(800300, { username: 'ana2' });
    assert.strictEqual(u1.id, u2.id);
    assert.strictEqual(u2.username, 'ana2', 'username updated');
    assert.strictEqual(u2.firstName, 'Ana', 'firstName untouched when omitted on the update call');
});

// =============================================================================
// 3. getUser
// =============================================================================

check('getUser: null for unknown / missing id', () => {
    assert.strictEqual(registry.getUser('does-not-exist'), null);
    assert.strictEqual(registry.getUser(undefined), null);
});

check('getUser: returns a copy, not a live reference', () => {
    const u = registry.getOrCreateUserByEmail('dana@example.com');
    const fetched = registry.getUser(u.id);
    fetched.email = 'MUTATED';
    const fetchedAgain = registry.getUser(u.id);
    assert.strictEqual(fetchedAgain.email, 'dana@example.com');
});

// =============================================================================
// 4. createLoginToken
// =============================================================================

check('createLoginToken: returns a 64-char lowercase hex token', () => {
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'x@x.com' });
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(token));
});

check('createLoginToken: two calls with identical payload produce different tokens', () => {
    const t1 = registry.createLoginToken({ purpose: 'login', email: 'same@x.com' }).token;
    const t2 = registry.createLoginToken({ purpose: 'login', email: 'same@x.com' }).token;
    assert.notStrictEqual(t1, t2, 'tokens must be freshly random, not derived from payload');
});

// =============================================================================
// 5. consumeLoginToken
// =============================================================================

check('consumeLoginToken: invalid input returns null (does not throw)', () => {
    assert.strictEqual(registry.consumeLoginToken(null), null);
    assert.strictEqual(registry.consumeLoginToken(''), null);
    assert.strictEqual(registry.consumeLoginToken(undefined), null);
    assert.strictEqual(registry.consumeLoginToken(42), null);
});

check('consumeLoginToken: unknown token returns null', () => {
    assert.strictEqual(registry.consumeLoginToken('f'.repeat(64)), null);
});

check('consumeLoginToken: valid token returns the exact payload, as a copy', () => {
    const payload = { purpose: 'login', email: 'once@x.com', siteId: 'site-1' };
    const { token } = registry.createLoginToken(payload);
    const consumed = registry.consumeLoginToken(token);
    assert.ok(consumed);
    assert.deepStrictEqual(consumed, payload);
    assert.notStrictEqual(consumed, payload, 'must not be the same object reference passed in');
});

check('consumeLoginToken: single-use — second consume of the same token returns null', () => {
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'single@x.com' });
    const first  = registry.consumeLoginToken(token);
    const second = registry.consumeLoginToken(token);
    assert.ok(first);
    assert.strictEqual(second, null);
});

check('consumeLoginToken: expired token (TTL 15 min) returns null, via a frozen clock (no storage peeking)', () => {
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'exp@x.com' });
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    const future = Date.now() + FIFTEEN_MIN_MS + 5000; // 5s past the TTL boundary
    const result = withFakeNow(future, () => registry.consumeLoginToken(token));
    assert.strictEqual(result, null, 'token must be rejected once its TTL has elapsed');
});

check('consumeLoginToken: still valid just before the TTL boundary', () => {
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'notyet@x.com' });
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    const almost = Date.now() + FIFTEEN_MIN_MS - 2000; // 2s before the TTL boundary
    const result = withFakeNow(almost, () => registry.consumeLoginToken(token));
    assert.ok(result, 'token must still be valid before its TTL elapses');
});

// =============================================================================
// 6. createSite (+ slug normalization, incl. the _buildSlug helper it uses)
// =============================================================================

let ownerA, ownerB;

check('createSite: shape of a freshly created site, defaults for optional fields', () => {
    ownerA = registry.getOrCreateUserByEmail('owner-a@example.com');
    const site = registry.createSite({ userId: ownerA.id, templateId: 'product-menu', templateVersion: 3 });
    assert.strictEqual(site.userId, ownerA.id);
    assert.strictEqual(site.templateId, 'product-menu');
    assert.strictEqual(site.templateVersion, 3);
    assert.strictEqual(site.platform, 'web', 'platform defaults to web');
    assert.strictEqual(site.status, 'draft');
    assert.strictEqual(site.paid, false);
    assert.strictEqual(site.url, null);
    assert.ok(UUID_RE.test(site.id));
    assert.ok(ISO_RE.test(site.createdAt));
    assert.strictEqual(site.slug, site.projectName, 'slug and projectName are kept identical');
});

check('createSite: templateId falsy -> templateId null; templateVersion undefined -> null', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: undefined, templateVersion: undefined });
    assert.strictEqual(site.templateId, null);
    assert.strictEqual(site.templateVersion, null);
});

check('createSite: templateVersion 0 is preserved (not coerced to null)', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: 't', templateVersion: 0 });
    assert.strictEqual(site.templateVersion, 0);
});

check('createSite: auto slug is built from templateId (not from any business name), diacritics stripped, punctuation collapsed to hyphens, id-suffixed', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: 'Pâine & Prăjituri!!' });
    const suffix = site.id.replace(/-/g, '').slice(0, 6);
    assert.strictEqual(site.slug, `paine-prajituri-${suffix}`);
});

check('createSite: templateId that normalizes to nothing falls back to the literal "site" base', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: '!!!' });
    const suffix = site.id.replace(/-/g, '').slice(0, 6);
    assert.strictEqual(site.slug, `site-${suffix}`);
});

check('createSite: missing templateId also falls back to "site" base', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: null });
    const suffix = site.id.replace(/-/g, '').slice(0, 6);
    assert.strictEqual(site.slug, `site-${suffix}`);
});

check('createSite: auto slug base is truncated to 40 chars before the id suffix is appended', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: 'a'.repeat(60) });
    const suffix = site.id.replace(/-/g, '').slice(0, 6);
    assert.strictEqual(site.slug, `${'a'.repeat(40)}-${suffix}`);
});

// DELIBERATE CHANGE (1 of 4, storage rewrite): an explicit slug that collides
// with an existing site is now rejected with a clear error instead of being
// silently allowed. Two sites could previously take the same public /live
// address — a real bug, reproduced independently, not just a QUIRK to pin.
// A real database gives us a UNIQUE constraint for free, so it is fixed now.
// bot/server.js already checks slug availability before calling createSite
// (isSlugAvailable), so this does not change its happy path.
check('createSite: FIXED — an explicit slug colliding with an existing site is rejected', () => {
    const s1 = registry.createSite({ userId: ownerA.id, templateId: 't', slug: 'taken-slug' });
    assert.strictEqual(s1.slug, 'taken-slug');
    assert.throws(
        () => registry.createSite({ userId: ownerA.id, templateId: 't', slug: 'taken-slug' }),
        /taken-slug/,
        'a second createSite with the same explicit slug must be rejected, not silently allowed'
    );
});

check('createSite: returns a copy, not a live reference', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: 't' });
    site.status = 'MUTATED';
    const fresh = registry.getSite(site.id);
    assert.strictEqual(fresh.status, 'draft');
});

// =============================================================================
// 7. getSite
// =============================================================================

check('getSite: null for unknown id', () => {
    assert.strictEqual(registry.getSite('nope'), null);
});

// =============================================================================
// 8 & 9. listSites / listAllSites (isolation)
// =============================================================================

let siteA1, siteA2, siteB1;

check('listSites: only returns sites belonging to the requested user (isolation)', () => {
    ownerB = registry.getOrCreateUserByEmail('owner-b@example.com');
    const before = registry.listAllSites().length;

    siteA1 = registry.createSite({ userId: ownerA.id, templateId: 't' });
    siteA2 = registry.createSite({ userId: ownerA.id, templateId: 't' });
    siteB1 = registry.createSite({ userId: ownerB.id, templateId: 't' });

    const sitesA = registry.listSites(ownerA.id);
    const sitesB = registry.listSites(ownerB.id);

    assert.ok(sitesA.some(s => s.id === siteA1.id));
    assert.ok(sitesA.some(s => s.id === siteA2.id));
    assert.ok(!sitesA.some(s => s.id === siteB1.id), 'owner A must not see owner B site');
    assert.deepStrictEqual(sitesB.map(s => s.id), [siteB1.id]);

    assert.strictEqual(registry.listAllSites().length, before + 3, 'listAllSites sees every user');
});

check('listSites: empty array for a user with no sites', () => {
    const noone = registry.getOrCreateUserByEmail('noone@example.com');
    assert.deepStrictEqual(registry.listSites(noone.id), []);
});

// =============================================================================
// 10. updateSite
// =============================================================================

check('updateSite: unknown site throws exact message', () => {
    assert.throws(() => registry.updateSite('missing-id', { status: 'live' }), /Site not found: missing-id/);
    try { registry.updateSite('missing-id', {}); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.message, 'Site not found: missing-id'); }
});

check('updateSite: partial patch overwrites given keys, preserves the rest', () => {
    const updated = registry.updateSite(siteA1.id, { status: 'live', paid: true, url: 'https://x.pages.dev' });
    assert.strictEqual(updated.status, 'live');
    assert.strictEqual(updated.paid, true);
    assert.strictEqual(updated.url, 'https://x.pages.dev');
    assert.strictEqual(updated.userId, ownerA.id, 'untouched field preserved');
    assert.strictEqual(updated.templateId, siteA1.templateId, 'untouched field preserved');
    assert.strictEqual(updated.slug, siteA1.slug, 'untouched field preserved');

    const persisted = registry.getSite(siteA1.id);
    assert.strictEqual(persisted.paid, true, 'change is persisted, not just returned');
});

// DELIBERATE CHANGE (4 of 4, storage rewrite): a patch key outside the known
// site schema is now dropped instead of being persisted via a raw
// Object.assign. The original let any caller silently pollute stored site
// records with arbitrary keys — a real bug, reproduced independently, not
// just a QUIRK to pin. The known-field allowlist (bot/registry-shared.js)
// was built by enumerating every updateSite call site across the codebase,
// so no real caller's happy path loses a field it actually uses.
check('updateSite: FIXED — a patch key outside the known site schema is dropped, not persisted', () => {
    const before = registry.getSite(siteA1.id);
    const updated = registry.updateSite(siteA1.id, { totallyNewField: 'surprise' });
    assert.strictEqual(updated.totallyNewField, undefined, 'unknown field must not appear on the returned record');
    const persisted = registry.getSite(siteA1.id);
    assert.strictEqual(persisted.totallyNewField, undefined, 'unknown field must not be persisted');
    assert.strictEqual(persisted.status, before.status, 'known fields are untouched by a patch that carries only unknown keys');
});

check('updateSite: returns a copy, not a live reference', () => {
    const updated = registry.updateSite(siteA2.id, { status: 'live' });
    updated.status = 'MUTATED';
    const fresh = registry.getSite(siteA2.id);
    assert.strictEqual(fresh.status, 'live');
});

// =============================================================================
// 11, 12, 13. saveVersion / listVersions / getVersionConfig
// =============================================================================

let versionSite;

check('saveVersion: returns only { versionId, publishedAt } — not the full record', () => {
    versionSite = registry.createSite({ userId: ownerA.id, templateId: 't' });
    const result = registry.saveVersion(versionSite.id, { business: { name: 'v1' } });
    assert.deepStrictEqual(Object.keys(result).sort(), ['publishedAt', 'versionId'].sort());
    assert.ok(UUID_RE.test(result.versionId));
    assert.ok(ISO_RE.test(result.publishedAt));
});

check('saveVersion: deep-clones the config at save time (later mutation of the input object does not leak in)', () => {
    const config = { business: { name: 'original' } };
    const { versionId } = registry.saveVersion(versionSite.id, config);
    config.business.name = 'MUTATED-AFTER-SAVE';
    const stored = registry.getVersionConfig(versionSite.id, versionId);
    assert.strictEqual(stored.business.name, 'original', 'saveVersion must not keep a live reference to the input');
});

check('getVersionConfig: returns a deep COPY, not a live reference into the store (critical for the rewrite)', () => {
    const { versionId } = registry.saveVersion(versionSite.id, { business: { name: 'rollback-me' }, nested: { deep: [1, 2, 3] } });
    const cfg1 = registry.getVersionConfig(versionSite.id, versionId);
    cfg1.business.name = 'MUTATED';
    cfg1.nested.deep.push(4);
    const cfg2 = registry.getVersionConfig(versionSite.id, versionId);
    assert.strictEqual(cfg2.business.name, 'rollback-me', 'mutating a returned config must not affect the stored one');
    assert.deepStrictEqual(cfg2.nested.deep, [1, 2, 3], 'mutating a returned nested array must not affect the stored one');
});

check('getVersionConfig: null for unknown versionId or unknown siteId', () => {
    assert.strictEqual(registry.getVersionConfig(versionSite.id, 'no-such-version'), null);
    assert.strictEqual(registry.getVersionConfig('no-such-site', 'no-such-version'), null);
});

check('listVersions: entries expose only { versionId, publishedAt }, no config payload', () => {
    const list = registry.listVersions(versionSite.id);
    assert.ok(list.length >= 1);
    for (const v of list) {
        assert.deepStrictEqual(Object.keys(v).sort(), ['publishedAt', 'versionId'].sort());
    }
});

check('listVersions: empty array for a site with no versions', () => {
    const freshSite = registry.createSite({ userId: ownerA.id, templateId: 't' });
    assert.deepStrictEqual(registry.listVersions(freshSite.id), []);
});

check('saveVersion: keeps at most the last 10 versions, oldest dropped first (FIFO)', () => {
    const site = registry.createSite({ userId: ownerA.id, templateId: 't' });
    const ids = [];
    for (let i = 0; i < 15; i++) {
        ids.push(registry.saveVersion(site.id, { n: i }).versionId);
    }
    const list = registry.listVersions(site.id);
    assert.strictEqual(list.length, 10, 'exactly 10 versions retained');
    const keptIds = list.map(v => v.versionId);
    assert.deepStrictEqual(keptIds, ids.slice(-10), 'the 10 most recently saved versions are kept, in order');
    for (const droppedId of ids.slice(0, 5)) {
        assert.strictEqual(registry.getVersionConfig(site.id, droppedId), null, 'dropped version is no longer retrievable');
    }
});

// =============================================================================
// 14-19. Orders
// =============================================================================

let orderSite, orderUser;

check('createOrder: shape, kind normalization, currency default', () => {
    orderUser = registry.getOrCreateUserByEmail('buyer@example.com');
    orderSite = registry.createSite({ userId: orderUser.id, templateId: 't' });

    const o1 = registry.createOrder({ siteId: orderSite.id, userId: orderUser.id, amountCents: 4900, currency: 'eur', stripeSessionId: 'cs_1' });
    assert.strictEqual(o1.status, 'pending');
    assert.strictEqual(o1.kind, 'publish', 'kind defaults to publish when omitted');
    assert.strictEqual(o1.currency, 'eur');
    assert.ok(UUID_RE.test(o1.id));
    assert.ok(ISO_RE.test(o1.createdAt));

    const o2 = registry.createOrder({ siteId: orderSite.id, userId: orderUser.id, amountCents: 1900, currency: '', stripeSessionId: 'cs_2', kind: 'renewal' });
    assert.strictEqual(o2.kind, 'renewal');
    assert.strictEqual(o2.currency, 'eur', 'falsy currency falls back to eur');

    const o3 = registry.createOrder({ siteId: orderSite.id, userId: orderUser.id, amountCents: 100, currency: 'usd', stripeSessionId: 'cs_3', kind: 'bogus-kind' });
    assert.strictEqual(o3.kind, 'publish', 'QUIRK: any kind other than the literal "renewal" is normalized to publish');
});

check('findPendingOrder: null when siteId falsy or no matching rows', () => {
    assert.strictEqual(registry.findPendingOrder(null, 'publish'), null);
    assert.strictEqual(registry.findPendingOrder(undefined, 'publish'), null);
    assert.strictEqual(registry.findPendingOrder('', 'publish'), null);
    const emptySite = registry.createSite({ userId: orderUser.id, templateId: 't' });
    assert.strictEqual(registry.findPendingOrder(emptySite.id, 'publish'), null);
});

check('findPendingOrder: filters by siteId + kind + pending status, ignores paid orders', () => {
    const site = registry.createSite({ userId: orderUser.id, templateId: 't' });
    const renewalOrder = registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_renewal_x', kind: 'renewal' });
    const paidOrder = registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_paid_x', kind: 'publish' });
    registry.markOrderPaid('cs_paid_x');

    assert.strictEqual(registry.findPendingOrder(site.id, 'publish'), null, 'the only publish order for this site is already paid');
    const found = registry.findPendingOrder(site.id, 'renewal');
    assert.strictEqual(found.id, renewalOrder.id);
    void paidOrder;
});

check('findPendingOrder: when several pending rows match, the newest (by createdAt) wins', () => {
    const site = registry.createSite({ userId: orderUser.id, templateId: 't' });
    const older = withFakeNow(1000000, () =>
        registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_older', kind: 'publish' }));
    const newer = withFakeNow(2000000, () =>
        registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_newer', kind: 'publish' }));
    const found = registry.findPendingOrder(site.id, 'publish');
    assert.strictEqual(found.id, newer.id, 'newest pending order returned');
    void older;
});

check('attachStripeSession: null on missing args or unknown orderId; updates in place otherwise, no new row', () => {
    const site = registry.createSite({ userId: orderUser.id, templateId: 't' });
    const order = registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_temp' });

    assert.strictEqual(registry.attachStripeSession(null, 'cs_new'), null);
    assert.strictEqual(registry.attachStripeSession(order.id, null), null);
    assert.strictEqual(registry.attachStripeSession('no-such-order', 'cs_new'), null);

    const before = registry.listAllSites; // no-op reference just to keep lint calm
    void before;

    const updated = registry.attachStripeSession(order.id, 'cs_attached');
    assert.strictEqual(updated.id, order.id);
    assert.strictEqual(updated.stripeSessionId, 'cs_attached');

    assert.strictEqual(registry.getOrderBySession('cs_temp'), null, 'old session id no longer resolves (in-place update)');
    const bySession = registry.getOrderBySession('cs_attached');
    assert.strictEqual(bySession.id, order.id);
});

check('markOrderPaid: first call transitions pending->paid and stamps paidAt; unknown session -> null', () => {
    const site = registry.createSite({ userId: orderUser.id, templateId: 't' });
    registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_pay_1' });

    assert.strictEqual(registry.markOrderPaid('cs_no_such_session'), null);

    const paid = registry.markOrderPaid('cs_pay_1');
    assert.ok(paid);
    assert.strictEqual(paid.status, 'paid');
    assert.ok(ISO_RE.test(paid.paidAt));
});

check('markOrderPaid: idempotent — second call on an already-paid order returns null (no re-entry)', () => {
    const site = registry.createSite({ userId: orderUser.id, templateId: 't' });
    registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_pay_2' });
    const first  = registry.markOrderPaid('cs_pay_2');
    const second = registry.markOrderPaid('cs_pay_2');
    assert.ok(first);
    assert.strictEqual(second, null, 'callers must not re-publish on the second webhook delivery');
    // status/paidAt from the first call are stable on read
    const persisted = registry.getOrderBySession('cs_pay_2');
    assert.strictEqual(persisted.status, 'paid');
    assert.strictEqual(persisted.paidAt, first.paidAt);
});

check('getOrderBySession / getOrder: null for unknown', () => {
    assert.strictEqual(registry.getOrderBySession('nope'), null);
    assert.strictEqual(registry.getOrder('nope'), null);
});

check('getOrder: returns a copy, not a live reference', () => {
    const site = registry.createSite({ userId: orderUser.id, templateId: 't' });
    const order = registry.createOrder({ siteId: site.id, userId: orderUser.id, amountCents: 100, currency: 'eur', stripeSessionId: 'cs_copy_check' });
    const fetched = registry.getOrder(order.id);
    fetched.status = 'MUTATED';
    const fetchedAgain = registry.getOrder(order.id);
    assert.strictEqual(fetchedAgain.status, 'pending');
});

// =============================================================================
// 20. claimStripeEvent
// =============================================================================

// DELIBERATE CHANGE (3 of 4, storage rewrite): a falsy or non-string eventId
// is now rejected explicitly instead of always returning true and recording
// nothing. The original silently disabled webhook idempotency for malformed
// events — a real bug, reproduced independently, not just a QUIRK to pin.
// Both real call sites (bot/webpublish.js) already guard with
// `if (eventId && ...)` before calling claimStripeEvent, so this does not
// change their happy path.
check('claimStripeEvent: FIXED — a falsy or non-string eventId is rejected explicitly', () => {
    assert.throws(() => registry.claimStripeEvent(null), /eventId/);
    assert.throws(() => registry.claimStripeEvent(undefined), /eventId/);
    assert.throws(() => registry.claimStripeEvent(''), /eventId/);
    assert.throws(() => registry.claimStripeEvent(12345), /eventId/);
});

check('claimStripeEvent: idempotent — first claim true, repeat claims of the same id false', () => {
    assert.strictEqual(registry.claimStripeEvent('evt_abc123'), true);
    assert.strictEqual(registry.claimStripeEvent('evt_abc123'), false);
    assert.strictEqual(registry.claimStripeEvent('evt_abc123'), false, 'stays false on further repeats');
});

check('claimStripeEvent: distinct ids are independent', () => {
    assert.strictEqual(registry.claimStripeEvent('evt_x'), true);
    assert.strictEqual(registry.claimStripeEvent('evt_y'), true);
    assert.strictEqual(registry.claimStripeEvent('evt_x'), false);
    assert.strictEqual(registry.claimStripeEvent('evt_y'), false);
});

check('claimStripeEvent: bounded growth — beyond ~500 seen ids, the oldest are evicted and become claimable again', () => {
    // Use a controlled, strictly increasing clock so the eviction sort (by seenAt) is deterministic.
    let t = 10_000_000;
    const step = () => (t += 1000);

    withFakeNow(step(), () => registry.claimStripeEvent('evt_bound_first'));
    for (let i = 0; i < 500; i++) {
        withFakeNow(step(), () => registry.claimStripeEvent(`evt_bound_${i}`));
    }
    // 'evt_bound_first' should have been evicted (oldest of 501 seen ids, cap is 500) -> claimable again.
    const reclaim = withFakeNow(step(), () => registry.claimStripeEvent('evt_bound_first'));
    assert.strictEqual(reclaim, true, 'the oldest event id must have been pruned once the 500 cap was exceeded');
    // A recently-seen one must still be remembered.
    const stillKnown = withFakeNow(step(), () => registry.claimStripeEvent('evt_bound_499'));
    assert.strictEqual(stillKnown, false, 'a recently-seen event id must still be remembered');
});

// =============================================================================
// 21. addMonthsIso
// =============================================================================

check('addMonthsIso: end-of-month overflow rolls into the following month (Jan 31 + 1 -> Mar 2, non-leap-safe case)', () => {
    assert.strictEqual(registry.addMonthsIso('2024-01-31T00:00:00.000Z', 1), '2024-03-02T00:00:00.000Z');
});

check('addMonthsIso: leap-day input, +12 months lands on a non-leap year (Feb 29 2024 + 12 -> Mar 1 2025)', () => {
    assert.strictEqual(registry.addMonthsIso('2024-02-29T00:00:00.000Z', 12), '2025-03-01T00:00:00.000Z');
});

check('addMonthsIso: crosses a year boundary correctly (Dec 15 2023 + 2 -> Feb 15 2024)', () => {
    assert.strictEqual(registry.addMonthsIso('2023-12-15T10:30:00.000Z', 2), '2024-02-15T10:30:00.000Z');
});

check('addMonthsIso: months=0 or omitted returns the same instant, ISO-normalized', () => {
    assert.strictEqual(registry.addMonthsIso('2024-06-15T00:00:00.000Z', 0), '2024-06-15T00:00:00.000Z');
    assert.strictEqual(registry.addMonthsIso('2024-06-15T00:00:00.000Z'), '2024-06-15T00:00:00.000Z', 'months undefined treated as 0');
});

check('addMonthsIso: null/undefined fromIso uses "now" as the base', () => {
    const fixedNow = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z
    const result = withFakeNow(fixedNow, () => registry.addMonthsIso(null, 1));
    const expected = new Date(fixedNow);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    assert.strictEqual(result, expected.toISOString());
});

// DELIBERATE CHANGE (2 of 4, storage rewrite): an unparseable fromIso string
// is now rejected explicitly instead of silently falling back to "now". The
// original could silently grant a year of paid commercial hosting from
// "now" on bad input — a real billing bug, reproduced independently, not
// just a QUIRK to pin. Both real call sites (bot/webpublish.js) only ever
// pass a value already known to be a valid ISO string, so this does not
// change their happy path. null/undefined (and other falsy values) still
// mean "use now" — that branch is untouched.
check('addMonthsIso: FIXED — an unparseable fromIso string is rejected explicitly', () => {
    assert.throws(() => registry.addMonthsIso('not-a-real-date', 0), /fromIso/);
});

// =============================================================================
// Summary / cleanup
// =============================================================================

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }

console.log(`\nregistry-characterization.test.js: ${assertionCount} assertions checked, module=${MODULE_PATH}`);

if (failed) {
    console.error('registry-characterization.test.js: FAILED');
    process.exit(1);
}
console.log('registry-characterization.test.js: toate testele au trecut');
