'use strict';
// Causal regressions for F06/F07: real SQLite + local filesystem hosting, no transports.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-trial-regression-'));
Object.assign(process.env, { DATA_DIR: data, NODE_ENV: 'test', HIDOOK_TEST_PAY: '1', HIDOOK_ISOLATED_DEPLOY: '1', SERVER_SECRET: crypto.randomBytes(32).toString('hex') });
for (const k of ['HIDOOK_FAKE_DEPLOY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'CALENDAR_NATIVE_API_BASE']) delete process.env[k];
const SB = require('../../builder/blocks/blocks');
const reg = require('../registry');
const wp = require('../webpublish');
const cutover = require('../calendar-native/cutover');
const engine = require('../calendar-native/engine');
const { getDb } = require('../calendar-native/public-api');
const { startServer } = require('../server');
let server, base;
before(async () => {
    server = startServer({ port: 0 });
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    process.env.PUBLIC_URL = base;
});
after(async () => { await new Promise(r => server.close(r)); });
async function customer() {
    const r = await fetch(base + '/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `publish-${crypto.randomUUID()}@example.com` }) });
    assert.equal(r.status, 200);
    const { devLink } = await r.json();
    const v = await fetch(new URL(devLink, base), { redirect: 'manual' });
    assert.equal(v.status, 302);
    const cookie = v.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return async (url, body) => fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function checkout(c, pack = 'salon') {
    const config = SB.defaultSite(pack);
    const r = await c('/api/publish', { templateId: 'blocks', slug: 'regression-' + crypto.randomUUID().slice(0, 8), config, images: [] });
    assert.equal(r.status, 200, await r.clone().text());
    const pub = await r.json();
    assert.ok(pub.paymentUrl);
    const sessionId = pub.paymentUrl.split('#test-checkout=')[1];
    return { site: pub.site, config, sessionId };
}
async function complete(c, p) { return c('/api/test-pay/complete', { sessionId: p.sessionId }); }

function bookNextSlot(db, site, serviceId) {
    for (let day = 1; day <= 7; day++) {
        const dateLocal = new Date(Date.now() + day * 86400000).toISOString().slice(0, 10);
        const slot = engine.generateSlots(db, site.userId, site.id, { serviceId, dateLocal })[0];
        if (slot) {
            const { booking } = engine.createBooking(db, site.userId, site.id, {
                serviceId, startUtc: slot.start_utc,
                visitorName: 'Local test visitor', visitorEmail: 'local-visitor@example.com',
            });
            // Confirmation outbox increments ICS sequence after creation.
            return engine.getBooking(db, site.userId, site.id, booking.id);
        }
    }
    assert.fail('expected an available Salon slot in the next week');
}

test('F06: local trial is uncharged; cancel then reactivate costs 29 and grants only one year', async () => {
    const c = await customer();
    const p = await checkout(c, 'restaurant');
    const done = await complete(c, p);
    assert.equal(done.status, 200, await done.clone().text());
    const invoices = wp.getInvoiceHistory(reg.getSite(p.site.id));
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].status, 'trial_started');
    assert.equal(invoices[0].amountCents, 9900);
    const days = (Date.parse(invoices[0].scheduledChargeAt) - Date.now()) / 86400000;
    assert.ok(days > 13.99 && days <= 14);
    assert.equal((await c(`/api/sites/${p.site.id}/billing-portal`, {})).status, 200);
    const canceled = reg.getSite(p.site.id);
    assert.equal(canceled.paid, false);
    assert.equal(canceled.status, 'unpublished');
    assert.equal((await fetch(base + '/live/' + p.site.slug + '/')).status, 404);
    const co = await c(`/api/sites/${p.site.id}/checkout`, {});
    assert.equal(co.status, 200, await co.clone().text());
    const renewal = reg.listOrdersBySite(p.site.id).find(o => o.kind === 'renewal');
    assert.equal(renewal.amountCents, 2900);
    const reactivate = await complete(c, { sessionId: renewal.stripeSessionId });
    assert.equal(reactivate.status, 200, await reactivate.clone().text());
    assert.equal((await reactivate.json()).reactivation, true);
    const fresh = reg.getSite(p.site.id);
    const year = reg.addMonthsIso(new Date().toISOString(), 12);
    assert.ok(Math.abs(Date.parse(fresh.paidUntil) - Date.parse(year)) < 5000, 'no phantom second year');
    assert.deepEqual(wp.getInvoiceHistory(fresh).filter(i => i.status === 'paid').map(i => i.amountCents), [2900]);
    const display = await (await c(`/api/sites/${p.site.id}`)).json();
    assert.ok(display.site.chargedAt, 'dashboard must distinguish a paid reactivation from the old trial');
    const until = fresh.paidUntil;
    assert.equal((await complete(c, { sessionId: renewal.stripeSessionId })).status, 200);
    assert.equal(reg.getSite(p.site.id).paidUntil, until, 'duplicate completion never extends twice');
});

test('F07: two customers publish the unchanged Salon pack, with separate service ids; republish cannot cross tenants', async () => {
    const a = await customer(), b = await customer();
    const first = await checkout(a), second = await checkout(b);
    for (const [c, p] of [[a, first], [b, second]]) {
        const done = await complete(c, p);
        assert.equal(done.status, 200, await done.clone().text());
        assert.equal(reg.getSite(p.site.id).status, 'live', 'each Salon must actually become live');
        const contact = await fetch(base + '/live/' + p.site.slug + '/contact.html');
        assert.equal(contact.status, 200);
        assert.match(await contact.text(), /data-hidook-cal-native/);
    }
    const db = getDb({});
    const rows = p => engine.listServices(db, p.site.userId, p.site.id, { activeOnly: false });
    const original = rows(first);
    assert.equal(original.length, 4);
    assert.equal(rows(second).length, 4);
    assert.ok(!rows(second).some(s => original.some(a => a.id === s.id)));
    const bookingA = bookNextSlot(db, first.site, original[0].id);
    const bookingB = bookNextSlot(db, second.site, rows(second)[0].id);
    assert.equal(bookingA.status, 'confirmed');
    assert.equal(bookingB.status, 'confirmed');
    assert.equal(engine.getBooking(db, first.site.userId, first.site.id, bookingB.id), null);
    assert.equal(engine.getBooking(db, second.site.userId, second.site.id, bookingA.id), null);
    const secondIds = rows(second).map(s => s.id);
    SB.bookingBlocks(second.config)[0].data.services[0].min = '45';
    const repub = await b('/api/publish', { siteId: second.site.id, templateId: 'blocks', config: second.config, images: [] });
    assert.equal(repub.status, 200, await repub.clone().text());
    assert.deepEqual(rows(first), original, 'other tenant remains byte-for-byte unchanged');
    assert.equal(rows(second)[0].duration_minutes, 45);
    assert.deepEqual(rows(second).map(s => s.id), secondIds, 'stable service references on republish');
    assert.deepEqual(engine.getBooking(db, first.site.userId, first.site.id, bookingA.id), bookingA);
    assert.deepEqual(engine.getBooking(db, second.site.userId, second.site.id, bookingB.id), bookingB);
});

test('F07: actual booking sync failure returns actionable error, retained entitlement, and retry without another checkout', async () => {
    const c = await customer(), p = await checkout(c);
    const sync = cutover.syncTenantFromBookingBlock;
    cutover.syncTenantFromBookingBlock = () => { throw new Error('injected database unavailable'); };
    let failed;
    try { failed = await complete(c, p); } finally { cutover.syncTenantFromBookingBlock = sync; }
    assert.equal(failed.status, 503);
    const error = await failed.json();
    assert.equal(error.ok, false);
    assert.equal(error.code, 'BOOKING_SYNC');
    assert.match(error.error, /[Îî]ncearcă/);
    assert.equal(reg.getSite(p.site.id).status, 'needs-retry');
    assert.equal(wp.getInvoiceHistory(reg.getSite(p.site.id)).filter(i => i.status === 'paid').length, 0);
    const retry = await c('/api/publish', { siteId: p.site.id, templateId: 'blocks', config: p.config, images: [] });
    assert.equal(retry.status, 200, await retry.clone().text());
    assert.equal((await retry.json()).paymentUrl, null);
    assert.equal(reg.getSite(p.site.id).status, 'live');
    assert.equal(reg.listOrdersBySite(p.site.id).length, 1);
});

test('legacy services keep their ids and attached bookings when the owner republishes', () => {
    const db = getDb({});
    const user = reg.getOrCreateUserByEmail('legacy-publish@example.com');
    const site = reg.createSite({ userId: user.id, templateId: 'blocks', slug: 'legacy-publish', platform: 'web' });
    engine.ensureSettings(db, user.id, site.id, {});
    engine.upsertService(db, user.id, site.id, { id: 'bk_tuns-si-coafat', name: 'Tuns și coafat', duration_minutes: 60, active: 1 });
    engine.setWeeklyAvailability(db, user.id, site.id, Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, start_minute: 540, end_minute: 1020 })));
    const booking = bookNextSlot(db, site, 'bk_tuns-si-coafat');
    assert.equal(booking.status, 'confirmed');
    const config = SB.defaultSite('salon');
    const plan = { services: SB.bookingServices(SB.bookingBlocks(config)[0].data), week: SB.bookingWeek(SB.bookingBlocks(config)[0].data) };
    cutover.syncTenantFromBookingBlock(db, user.id, site.id, plan);
    const rows = engine.listServices(db, user.id, site.id);
    assert.equal(rows.find(s => s.name === 'Tuns și coafat').id, 'bk_tuns-si-coafat');
    assert.deepEqual(engine.getBooking(db, user.id, site.id, booking.id), booking);
    cutover.syncTenantFromBookingBlock(db, user.id, site.id, plan);
    assert.equal(engine.listServices(db, user.id, site.id).length, 4);
    assert.deepEqual(engine.getBooking(db, user.id, site.id, booking.id), booking);
    assert.equal(booking.service_id, 'bk_tuns-si-coafat');
});
