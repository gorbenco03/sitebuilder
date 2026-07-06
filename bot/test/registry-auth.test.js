'use strict';
/**
 * Test: registry + auth contracts.
 * Run:  node bot/test/registry-auth.test.js
 * Exits non-zero on the first failed assertion.
 *
 * DATA_DIR is isolated in mkdtemp BEFORE any require so modules see the fresh dir.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Isolate ───────────────────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-auth-test-'));
process.env.DATA_DIR = tmpDir;

// Set env before requiring modules that read env at load time
process.env.SERVER_SECRET      = 'test-server-secret-do-not-use-in-prod';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-12345';

const registry = require('../registry.js');
const auth     = require('../auth.js');

// ── Test harness ──────────────────────────────────────────────────────────────
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
async function checkAsync(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

// =============================================================================
// REGISTRY — users
// =============================================================================

check('getOrCreateUserByEmail creates a new user', () => {
    const u = registry.getOrCreateUserByEmail('ana@test.com');
    assert.strictEqual(u.email, 'ana@test.com');
    assert.ok(typeof u.id === 'string' && u.id.length > 8, 'id should be a UUID');
    assert.ok(typeof u.createdAt === 'string');
});

check('getOrCreateUserByEmail is idempotent', () => {
    const u1 = registry.getOrCreateUserByEmail('ana@test.com');
    const u2 = registry.getOrCreateUserByEmail('ana@test.com');
    assert.strictEqual(u1.id, u2.id, 'same user returned on second call');
});

check('getOrCreateUserByTelegram creates a new user', () => {
    const u = registry.getOrCreateUserByTelegram(111222, { username: 'ionut', firstName: 'Ionuț' });
    assert.strictEqual(u.tgId, '111222');
    assert.strictEqual(u.username, 'ionut');
    assert.strictEqual(u.firstName, 'Ionuț');
});

check('getOrCreateUserByTelegram is idempotent — returns same id', () => {
    const u1 = registry.getOrCreateUserByTelegram(111222);
    const u2 = registry.getOrCreateUserByTelegram(111222, { username: 'ionut_new' });
    assert.strictEqual(u1.id, u2.id, 'same user returned');
    assert.strictEqual(u2.username, 'ionut_new', 'username is updated');
});

check('getUser returns existing user', () => {
    const u  = registry.getOrCreateUserByEmail('geta@test.com');
    const u2 = registry.getUser(u.id);
    assert.strictEqual(u2.email, 'geta@test.com');
});

check('getUser returns null for unknown id', () => {
    assert.strictEqual(registry.getUser('nonexistent-uuid'), null);
});

// =============================================================================
// REGISTRY — login tokens
// =============================================================================

check('createLoginToken returns a 64-char hex token', () => {
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'ana@test.com' });
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(token));
});

check('consumeLoginToken returns payload on valid token', () => {
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'test@x.com' });
    const payload   = registry.consumeLoginToken(token);
    assert.ok(payload, 'payload should not be null');
    assert.strictEqual(payload.email, 'test@x.com');
    assert.strictEqual(payload.purpose, 'login');
});

check('consumeLoginToken is single-use (second consume → null)', () => {
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'once@x.com' });
    const first  = registry.consumeLoginToken(token);
    const second = registry.consumeLoginToken(token);
    assert.ok(first,   'first consume should succeed');
    assert.strictEqual(second, null, 'second consume must return null');
});

check('consumeLoginToken returns null for unknown token', () => {
    const result = registry.consumeLoginToken('a'.repeat(64));
    assert.strictEqual(result, null);
});

check('consumeLoginToken returns null for expired token', () => {
    // Create a token then manually set its expiry in the past
    const { token } = registry.createLoginToken({ purpose: 'login', email: 'exp@x.com' });
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const REGISTRY_FILE = path.join(tmpDir, '.registry.json');
    const db = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    db.tokens[hash].exp = Date.now() - 1000; // expired 1 second ago
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(db));

    const result = registry.consumeLoginToken(token);
    assert.strictEqual(result, null, 'expired token should return null');
});

// =============================================================================
// REGISTRY — sites
// =============================================================================

let testSiteId;

check('createSite returns a valid site object', () => {
    const user = registry.getOrCreateUserByEmail('site-owner@test.com');
    const site = registry.createSite({ userId: user.id, templateId: 'patiserie', templateVersion: 1, slug: 'patiseria-mea-abc123' });
    assert.strictEqual(site.userId, user.id);
    assert.strictEqual(site.templateId, 'patiserie');
    assert.strictEqual(site.templateVersion, 1);
    assert.strictEqual(site.status, 'draft');
    assert.strictEqual(site.paid, false);
    assert.strictEqual(site.url, null);
    assert.ok(site.id && site.id.length > 8);
    testSiteId = site.id;
});

check('getSite returns the created site', () => {
    const site = registry.getSite(testSiteId);
    assert.ok(site, 'site should not be null');
    assert.strictEqual(site.id, testSiteId);
});

check('getSite returns null for unknown id', () => {
    assert.strictEqual(registry.getSite('nonexistent'), null);
});

check('listSites returns all sites for a user', () => {
    const user  = registry.getOrCreateUserByEmail('multi@test.com');
    registry.createSite({ userId: user.id, templateId: 'constructii', templateVersion: 1 });
    registry.createSite({ userId: user.id, templateId: 'servicii',    templateVersion: 1 });
    const sites = registry.listSites(user.id);
    assert.strictEqual(sites.length, 2);
});

check('updateSite patches the site', () => {
    const updated = registry.updateSite(testSiteId, { status: 'live', paid: true, url: 'https://patiseria.pages.dev' });
    assert.strictEqual(updated.status, 'live');
    assert.strictEqual(updated.paid, true);
    assert.strictEqual(updated.url, 'https://patiseria.pages.dev');
    // Verify persisted
    const fresh = registry.getSite(testSiteId);
    assert.strictEqual(fresh.paid, true);
});

// =============================================================================
// REGISTRY — versions (max 10)
// =============================================================================

check('saveVersion stores a version and listVersions returns it', () => {
    const { versionId, publishedAt } = registry.saveVersion(testSiteId, { business: { name: 'v1' } });
    assert.ok(typeof versionId   === 'string' && versionId.length > 8);
    assert.ok(typeof publishedAt === 'string');
    const list = registry.listVersions(testSiteId);
    assert.ok(list.length >= 1);
    assert.ok(list.some(v => v.versionId === versionId));
});

check('getVersionConfig returns the stored config', () => {
    const { versionId } = registry.saveVersion(testSiteId, { business: { name: 'rollback-me' } });
    const cfg = registry.getVersionConfig(testSiteId, versionId);
    assert.ok(cfg, 'config should not be null');
    assert.strictEqual(cfg.business.name, 'rollback-me');
});

check('getVersionConfig returns null for unknown versionId', () => {
    assert.strictEqual(registry.getVersionConfig(testSiteId, 'no-such-version'), null);
});

check('saveVersion keeps at most 10 versions', () => {
    // Save 15 versions
    const user2 = registry.getOrCreateUserByEmail('version-limit@test.com');
    const site2 = registry.createSite({ userId: user2.id, templateId: 'patiserie', templateVersion: 1 });
    for (let i = 0; i < 15; i++) {
        registry.saveVersion(site2.id, { n: i });
    }
    const list = registry.listVersions(site2.id);
    assert.ok(list.length <= 10, `expected ≤10 versions, got ${list.length}`);
    assert.strictEqual(list.length, 10, 'exactly 10 versions should remain');
});

// =============================================================================
// REGISTRY — orders
// =============================================================================

let testOrder;

check('createOrder returns a pending order', () => {
    const user = registry.getOrCreateUserByEmail('buyer@test.com');
    const site = registry.createSite({ userId: user.id, templateId: 'patiserie', templateVersion: 1 });
    const order = registry.createOrder({
        siteId:          site.id,
        userId:          user.id,
        amountCents:     4900,
        currency:        'eur',
        stripeSessionId: 'cs_test_abc123',
    });
    assert.strictEqual(order.status, 'pending');
    assert.strictEqual(order.stripeSessionId, 'cs_test_abc123');
    assert.ok(order.id && order.id.length > 8);
    testOrder = order;
});

check('getOrderBySession finds the order', () => {
    const found = registry.getOrderBySession('cs_test_abc123');
    assert.ok(found, 'should find the order');
    assert.strictEqual(found.id, testOrder.id);
});

check('getOrderBySession returns null for unknown session', () => {
    assert.strictEqual(registry.getOrderBySession('cs_unknown'), null);
});

check('markOrderPaid marks the order as paid', () => {
    const paid = registry.markOrderPaid('cs_test_abc123');
    assert.ok(paid, 'should return the order');
    assert.strictEqual(paid.status, 'paid');
    assert.ok(typeof paid.paidAt === 'string');
});

check('markOrderPaid is idempotent (second call still returns paid order)', () => {
    const paid2 = registry.markOrderPaid('cs_test_abc123');
    assert.ok(paid2, 'should still return the order on second call');
    assert.strictEqual(paid2.status, 'paid');
});

check('markOrderPaid returns null for unknown stripeSessionId', () => {
    assert.strictEqual(registry.markOrderPaid('cs_no_such_session'), null);
});

// =============================================================================
// AUTH — signSession / verifySession
// =============================================================================

check('signSession produces a v1.*.* cookie value', () => {
    const value = auth.signSession('user-abc');
    assert.ok(typeof value === 'string');
    const parts = value.split('.');
    assert.strictEqual(parts[0], 'v1');
    assert.strictEqual(parts.length, 3);
});

check('verifySession round-trips the userId', () => {
    const value  = auth.signSession('user-roundtrip');
    const userId = auth.verifySession(value);
    assert.strictEqual(userId, 'user-roundtrip');
});

check('verifySession returns null for tampered token (last char changed)', () => {
    const value   = auth.signSession('user-tamper');
    const tampered = value.slice(0, -1) + (value.slice(-1) === 'a' ? 'b' : 'a');
    assert.strictEqual(auth.verifySession(tampered), null);
});

check('verifySession returns null for expired session', () => {
    // Sign with 0 days — exp = now (already passed when we call verify a millisecond later)
    const value = auth.signSession('user-expired', { days: -1 });
    const result = auth.verifySession(value);
    assert.strictEqual(result, null);
});

check('verifySession returns null for unknown / garbage input', () => {
    assert.strictEqual(auth.verifySession(null),         null);
    assert.strictEqual(auth.verifySession(''),           null);
    assert.strictEqual(auth.verifySession('v1.bad'),     null);
    assert.strictEqual(auth.verifySession('v2.x.y'),     null);
});

check('buildSessionCookie includes required attributes', () => {
    const value  = auth.signSession('user-cookie');
    const cookie = auth.buildSessionCookie(value);
    assert.ok(cookie.startsWith('hb_session='));
    assert.ok(cookie.includes('Path=/'));
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Lax'));
    assert.ok(cookie.includes('Max-Age=2592000'));
});

check('getSessionUserId parses Cookie header and returns userId', () => {
    const value = auth.signSession('user-from-cookie');
    const req   = { headers: { cookie: `other=xyz; hb_session=${value}; foo=bar` } };
    const uid   = auth.getSessionUserId(req);
    assert.strictEqual(uid, 'user-from-cookie');
});

check('getSessionUserId returns null when cookie absent', () => {
    assert.strictEqual(auth.getSessionUserId({ headers: {} }), null);
});

// =============================================================================
// AUTH — verifyTelegramInitData
// =============================================================================

/**
 * Build a valid, signed Telegram initData string using the test bot token.
 */
function buildValidInitData(tgId, overrides = {}) {
    const authDate = Math.floor(Date.now() / 1000);
    const user     = JSON.stringify({ id: tgId, first_name: 'Andrei', username: 'andrei_test' });
    const params   = new URLSearchParams({
        auth_date: String(authDate),
        user,
        ...overrides,
    });
    // Remove hash if it was injected via overrides (we'll add it below)
    params.delete('hash');

    // Build data_check_string
    const pairs = [];
    for (const [k, v] of params.entries()) { pairs.push(`${k}=${v}`); }
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    // Compute hash
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
    const hash      = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    params.set('hash', hash);
    return params.toString();
}

check('verifyTelegramInitData accepts valid initData', () => {
    const initData = buildValidInitData(999888);
    const result   = auth.verifyTelegramInitData(initData);
    assert.ok(result, 'should return an object');
    assert.strictEqual(result.tgId, '999888');
    assert.strictEqual(result.firstName, 'Andrei');
    assert.strictEqual(result.username,  'andrei_test');
});

check('verifyTelegramInitData returns null for wrong hash', () => {
    const initData = buildValidInitData(777666);
    // Replace last 4 chars of hash with 'ffff'
    const tampered = initData.replace(/hash=[0-9a-f]{64}/, (m) => m.slice(0, -4) + 'ffff');
    assert.strictEqual(auth.verifyTelegramInitData(tampered), null);
});

check('verifyTelegramInitData returns null for stale auth_date (>24h ago)', () => {
    const tgId     = 555444;
    const authDate = Math.floor(Date.now() / 1000) - 90000; // 25 hours ago
    const user     = JSON.stringify({ id: tgId, first_name: 'Old', username: 'old_user' });

    // Build with old auth_date
    const params = new URLSearchParams({ auth_date: String(authDate), user });
    const pairs  = [];
    for (const [k, v] of params.entries()) { pairs.push(`${k}=${v}`); }
    pairs.sort();
    const dataCheckString = pairs.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
    const hash      = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', hash);

    assert.strictEqual(auth.verifyTelegramInitData(params.toString()), null, 'stale auth_date must be rejected');
});

check('verifyTelegramInitData returns null when TELEGRAM_BOT_TOKEN unset', () => {
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.strictEqual(auth.verifyTelegramInitData('hash=abc'), null);
    process.env.TELEGRAM_BOT_TOKEN = saved;
});

check('verifyTelegramInitData returns null for null/empty input', () => {
    assert.strictEqual(auth.verifyTelegramInitData(null), null);
    assert.strictEqual(auth.verifyTelegramInitData(''),   null);
});

// =============================================================================
// Cleanup
// =============================================================================

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

if (failed) {
    console.error('\nregistry-auth.test.js: FAILED');
    process.exit(1);
}
console.log('\nregistry-auth.test.js: toate testele au trecut');
