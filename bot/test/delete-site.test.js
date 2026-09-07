'use strict';
/**
 * DELETE /api/sites/:id — permanent deletion (not cancel/unpublish).
 *
 * Covers what a Playwright oracle is slow/awkward to exercise precisely:
 * the two refusal rules (active subscription, future calendar booking),
 * server-side ownership, confirmation-name mismatch, and idempotency.
 * The full happy-path (dashboard button → typed confirm → gone from the
 * list + registry row + published dir) is the Playwright oracle's job
 * (bot/test/delete-site-oracle.mjs).
 *
 * Run: node --experimental-sqlite --test bot/test/delete-site.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-delete-site-'));
process.env.DATA_DIR = dataDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.SERVER_SECRET = 'delete-site-test-secret';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

const registry = require('../registry.js');
const auth = require('../auth.js');
const webpublish = require('../webpublish.js');
const { openCalendarDb } = require('../calendar-native/db.js');
const { startServer } = require('../server.js');

let server;
let base;

test.before(async () => {
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function cookieFor(userId) {
    return 'hb_session=' + auth.signSession(userId);
}

async function apiDelete(siteId, cookie, body) {
    const r = await fetch(base + '/api/sites/' + encodeURIComponent(siteId), {
        method: 'DELETE',
        headers: Object.assign(
            { 'Content-Type': 'application/json' },
            cookie ? { Cookie: cookie } : {}
        ),
        body: JSON.stringify(body || {}),
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json };
}

async function makeSite(userId, { slug, paid } = {}) {
    const site = registry.createSite({
        userId,
        templateId: 'professionals',
        templateVersion: 1,
        slug: slug || ('delsite-' + crypto.randomBytes(4).toString('hex')),
        platform: 'web',
    });
    if (paid) registry.updateSite(site.id, { paid: true });
    return registry.getSite(site.id);
}

async function publishIsolated(site) {
    const siteDir = path.join(dataDir, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>' + site.slug + '</h1>');
    const result = await webpublish.publishSite({
        site: registry.getSite(site.id),
        config: {},
        images: [],
        siteDirAlreadyBuilt: true,
    });
    return result;
}

function publishedDir(slug) {
    return path.join(dataDir, 'published', slug);
}

function insertFutureBooking(customerId, siteId, { pastInstead = false } = {}) {
    const db = openCalendarDb({ dataDir });
    const now = Date.now();
    const startMs = pastInstead ? now - 30 * 24 * 60 * 60 * 1000 : now + 30 * 24 * 60 * 60 * 1000;
    const endMs = startMs + 30 * 60 * 1000;
    const ts = new Date().toISOString();
    db.prepare(`
        INSERT INTO calendar_bookings
            (id, customer_id, site_id, service_id, start_utc, end_utc, status,
             visitor_name, visitor_email, manage_token_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
    `).run(
        'bk_' + crypto.randomBytes(6).toString('hex'),
        customerId, siteId, 'svc_test',
        new Date(startMs).toISOString(), new Date(endMs).toISOString(),
        'Vizitator Test', 'vizitator@example.com',
        crypto.randomBytes(8).toString('hex'), ts, ts
    );
    return db;
}

test('DELETE /api/sites/:id requires auth', async () => {
    const site = await makeSite(registry.getOrCreateUserByEmail('noauth@example.com').id);
    const { status, json } = await apiDelete(site.id, null, { confirmName: site.projectName });
    assert.equal(status, 401);
    assert.ok(!registry.getSite(site.id) === false); // site untouched
    assert.ok(registry.getSite(site.id), 'site must still exist after unauthenticated attempt');
    void json;
});

test('DELETE /api/sites/:id refuses another user\'s site (403), does not delete it', async () => {
    const owner = registry.getOrCreateUserByEmail('owner-a@example.com');
    const stranger = registry.getOrCreateUserByEmail('stranger-b@example.com');
    const site = await makeSite(owner.id);
    const { status, json } = await apiDelete(site.id, cookieFor(stranger.id), { confirmName: site.projectName });
    assert.equal(status, 403);
    assert.ok(registry.getSite(site.id), 'a 403 must not delete the site');
    void json;
});

test('DELETE /api/sites/:id rejects a confirmName that does not match exactly (422 CONFIRM_MISMATCH)', async () => {
    const user = registry.getOrCreateUserByEmail('confirm-mismatch@example.com');
    const site = await makeSite(user.id);
    const { status, json } = await apiDelete(site.id, cookieFor(user.id), { confirmName: 'nu e numele corect' });
    assert.equal(status, 422);
    assert.equal(json.code, 'CONFIRM_MISMATCH');
    assert.ok(registry.getSite(site.id), 'a mismatched confirmation must not delete anything');
});

test('DELETE /api/sites/:id refuses (409 ACTIVE_SUBSCRIPTION) while a paid subscription is active', async () => {
    const user = registry.getOrCreateUserByEmail('active-sub@example.com');
    const site0 = await makeSite(user.id, { paid: true });
    registry.updateSite(site0.id, {
        status: 'live',
        stripeSubscriptionStatus: 'active',
        paidUntil: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const site = registry.getSite(site0.id);
    const { status, json } = await apiDelete(site.id, cookieFor(user.id), { confirmName: site.projectName });
    assert.equal(status, 409);
    assert.equal(json.code, 'ACTIVE_SUBSCRIPTION');
    assert.ok(registry.getSite(site.id), 'must not delete a site with an active subscription');
});

test('DELETE /api/sites/:id refuses (409 FUTURE_BOOKINGS) while a future active calendar booking exists', async () => {
    const user = registry.getOrCreateUserByEmail('future-booking@example.com');
    const site = await makeSite(user.id);
    const db = insertFutureBooking(user.id, site.id);
    const { status, json } = await apiDelete(site.id, cookieFor(user.id), { confirmName: site.projectName });
    assert.equal(status, 409);
    assert.equal(json.code, 'FUTURE_BOOKINGS');
    assert.equal(json.count, 1);
    assert.ok(registry.getSite(site.id), 'must not delete a site with a future booking');
    db.close();
});

test('DELETE /api/sites/:id allows deletion when only a PAST booking exists', async () => {
    const user = registry.getOrCreateUserByEmail('past-booking@example.com');
    const site = await makeSite(user.id);
    const db = insertFutureBooking(user.id, site.id, { pastInstead: true });
    const { status, json } = await apiDelete(site.id, cookieFor(user.id), { confirmName: site.projectName });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(registry.getSite(site.id), null);
    db.close();
});

test('DELETE /api/sites/:id deletes everything the site owns on the happy path', async () => {
    const user = registry.getOrCreateUserByEmail('happy-path@example.com');
    const site = await makeSite(user.id, { slug: 'delsite-happy-' + crypto.randomBytes(3).toString('hex') });
    await publishIsolated(site);
    assert.ok(fs.existsSync(publishedDir(site.slug)), 'precondition: published dir must exist');

    // Give it a version (draft) and a local legacy appointment-request file too.
    registry.saveVersion(site.id, { business: { name: 'Test' } });
    assert.equal(registry.listVersions(site.id).length, 1);

    const apptDir = path.join(dataDir, 'appointments');
    fs.mkdirSync(apptDir, { recursive: true });
    const apptFile = path.join(apptDir, site.slug + '.json');
    fs.writeFileSync(apptFile, JSON.stringify({ requests: [] }));

    // Seed a native-calendar tenant with a PAST booking only (must not block; must be erased).
    const db = insertFutureBooking(user.id, site.id, { pastInstead: true });

    const { status, json } = await apiDelete(site.id, cookieFor(user.id), { confirmName: site.projectName });
    assert.equal(status, 200);
    assert.equal(json.ok, true);

    assert.equal(registry.getSite(site.id), null, 'registry row must be gone');
    assert.equal(registry.listVersions(site.id).length, 0, 'drafts/versions must be gone');
    assert.equal(fs.existsSync(publishedDir(site.slug)), false, 'published dir must be gone');
    assert.equal(fs.existsSync(apptFile), false, 'legacy appointment-request file must be gone');

    const remaining = db.prepare(
        'SELECT COUNT(*) AS c FROM calendar_bookings WHERE customer_id = ? AND site_id = ?'
    ).get(user.id, site.id);
    assert.equal(remaining.c, 0, 'calendar-native tenant rows must be erased');
    db.close();
});

test('DELETE /api/sites/:id is idempotent — deleting twice never 500s', async () => {
    const user = registry.getOrCreateUserByEmail('idempotent@example.com');
    const site = await makeSite(user.id);
    const first = await apiDelete(site.id, cookieFor(user.id), { confirmName: site.projectName });
    assert.equal(first.status, 200);
    assert.equal(first.json.ok, true);

    const second = await apiDelete(site.id, cookieFor(user.id), { confirmName: site.projectName });
    assert.equal(second.status, 200);
    assert.equal(second.json.ok, true);
    assert.equal(second.json.alreadyDeleted, true);
});

test('DELETE /api/sites/:id on an unknown id is idempotent (200, not 404/500)', async () => {
    const user = registry.getOrCreateUserByEmail('unknown-id@example.com');
    const { status, json } = await apiDelete('does-not-exist', cookieFor(user.id), { confirmName: 'anything' });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.alreadyDeleted, true);
});
