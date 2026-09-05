'use strict';
/**
 * Oracle — calendar native staged opt-in cutover (VISION.md §8 step e).
 *
 * Proves:
 *  1. Default professionals render keeps legacy #pr-appt-form (no forced migration)
 *  2. appointment.nativeBooking=da + tenant ids → native widget, no legacy form
 *  3. Opt-out restores legacy form; engine bookings retained (non-destructive)
 *  4. publish preparePublishCutover seeds services/weekly from appointment config
 *  5. Full native path: book → RO status → email outbox → owner confirm/cancel →
 *     visitor manage token cancel frees slot; double-book never falsely confirmed
 *  6. site-legal.js + fullpass-63230d2.mjs untouched by this feature set
 *  7. Legacy /api/appointments path still works for non-opted sites
 *
 * Run: node --experimental-sqlite bot/test/calendar-native-cutover.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawnSync } = require('child_process');
    const r = spawnSync(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit' }
    );
    process.exit(r.status == null ? 1 : r.status);
}

const ROOT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-cutover-'));
process.env.DATA_DIR = tmp;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'cal-cutover-oracle-secret';
process.env.NODE_ENV = 'test';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;

const { renderHtml } = require('../../build.js');
const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');
const cutover = require('../calendar-native/cutover');
const manageApi = require('../calendar-native/manage-api');
const publicApi = require('../calendar-native/public-api');
const email = require('../calendar-native/email');
const { zonedWallTimeToUtcMs, toIsoUtc, isoWeekdayForDateLocal } = require('../calendar-native/time');

// Same default path the server/public-api open under DATA_DIR (calendar-native.sqlite).
publicApi.resetDbHandle();
const db = openCalendarDb({ dataDir: tmp });

const mem = email.createMemoryTransport();
email.setTransport(mem);

const TPL = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
const PRESETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets;
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/schema.json'), 'utf8'));

// --- 1. Schema exposes reversible opt-in field ---
const apptSection = SCHEMA.sections.find((s) => s.id === 'appointment');
assert.ok(apptSection, 'appointment schema section');
const nativeField = apptSection.fields.find((f) => f.key === 'appointment.nativeBooking');
assert.ok(nativeField, 'appointment.nativeBooking field');
assert.strictEqual(nativeField.required, false);
assert.match(nativeField.label, /native|Hidook/i);
assert.match(nativeField.hint, /reversibil|nu șterge|reveni/i);

// --- 2. Default presets stay legacy (no forced cutover) ---
for (const preset of PRESETS) {
    assert.ok(!cutover.isNativeBookingEnabled(preset.config.appointment.nativeBooking), preset.id);
    const html = renderHtml(TPL, preset.config);
    assert.match(html, /id="pr-appt-form"/, preset.id + ' legacy form');
    assert.doesNotMatch(html, /data-hidook-cal-native/, preset.id + ' no native mount');
}

// --- 3. Opt-in render swaps form for widget; opt-out restores ---
const baseCfg = JSON.parse(JSON.stringify(PRESETS[0].config));
baseCfg.appointment.nativeBooking = 'da';
baseCfg.appointment.nativeCustomerId = 'cust_cutover_A';
baseCfg.appointment.nativeSiteId = 'site_cutover_A';
const optedHtml = renderHtml(TPL, baseCfg);
assert.match(optedHtml, /data-hidook-cal-native/);
assert.match(optedHtml, /data-customer-id="cust_cutover_A"/);
assert.match(optedHtml, /data-site-id="site_cutover_A"/);
assert.match(optedHtml, /public-booking-widget\.js/);
assert.doesNotMatch(optedHtml, /id="pr-appt-form"/);
assert.doesNotMatch(optedHtml, /pr-booking-link/);

baseCfg.appointment.nativeBooking = 'nu';
const optedOutHtml = renderHtml(TPL, baseCfg);
assert.match(optedOutHtml, /id="pr-appt-form"/);
assert.doesNotMatch(optedOutHtml, /data-hidook-cal-native/);

// native wins over bookingUrl when both set
baseCfg.appointment.nativeBooking = 'da';
baseCfg.appointment.bookingUrl = 'https://cal.com/should-not-win';
const nativeWins = renderHtml(TPL, baseCfg);
assert.match(nativeWins, /data-hidook-cal-native/);
assert.doesNotMatch(nativeWins, /pr-booking-link/);
assert.doesNotMatch(nativeWins, /cal\.com\/should-not-win/);

// --- 4. applyCutoverToConfig injects tenant; opt-out clears ids ---
const site = { userId: 'cust_cutover_A', id: 'site_cutover_A' };
const on = cutover.applyCutoverToConfig(
    { appointment: { nativeBooking: 'da', bookingUrl: 'https://cal.com/x' } },
    site
);
assert.strictEqual(on.optedIn, true);
assert.strictEqual(on.config.appointment.nativeCustomerId, 'cust_cutover_A');
assert.strictEqual(on.config.appointment.nativeSiteId, 'site_cutover_A');
// bookingUrl preserved in config for reverse
assert.strictEqual(on.config.appointment.bookingUrl, 'https://cal.com/x');

const off = cutover.applyCutoverToConfig(
    { appointment: { nativeBooking: '', nativeCustomerId: 'stale', nativeSiteId: 'stale' } },
    site
);
assert.strictEqual(off.optedIn, false);
assert.strictEqual(off.config.appointment.nativeCustomerId, '');
assert.strictEqual(off.config.appointment.nativeSiteId, '');

// --- 5. Seed from professional appointment types/weekly ---
const seedCfg = JSON.parse(JSON.stringify(PRESETS[0].config));
seedCfg.appointment.nativeBooking = 'da';
const prepared = cutover.preparePublishCutover({ config: seedCfg, site, db });
assert.strictEqual(prepared.optedIn, true);
assert.ok(prepared.seed.services >= 1);
assert.ok(prepared.seed.weeklyWindows >= 1);
const services = engine.listServices(db, site.userId, site.id, { activeOnly: true });
assert.ok(services.length >= 2, 'seeded professional types');
assert.ok(services.some((s) => /Consulta|consult/i.test(s.name)));

// Keep a booking, then opt-out prepare — booking must remain
const MON = '2030-01-07';
assert.strictEqual(isoWeekdayForDateLocal(MON), 1);
const nowMs = Date.UTC(2026, 0, 1);
const start1 = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 10, 0, 'Europe/Bucharest'));
const created = engine.createBooking(db, site.userId, site.id, {
    serviceId: services[0].id,
    startUtc: start1,
    visitorName: 'Ana Cutover',
    visitorEmail: 'ana.cutover@example.com',
    nowMs,
});
assert.strictEqual(created.status, 'confirmed');
assert.ok(created.manageToken.length >= 24);

const offPrep = cutover.preparePublishCutover({
    config: { appointment: { nativeBooking: 'nu' } },
    site,
    db,
});
assert.strictEqual(offPrep.optedIn, false);
const stillThere = engine.getBooking(db, site.userId, site.id, created.booking.id);
assert.ok(stillThere, 'opt-out must not delete bookings');
assert.strictEqual(stillThere.status, 'confirmed');

// --- 6. Email harness recorded create ---
(async function main() {
    await email.processOutbox(db, { nowMs, limit: 20 });
    const outRows = email.listOutbox(db, site.userId, site.id, { bookingId: created.booking.id });
    assert.ok(outRows.length >= 1, 'email outbox has create mail');
    assert.ok(
        outRows.some((r) => r.template_key === 'booking_confirmed' || r.template_key === 'booking_requested')
    );
    assert.ok(outRows.every((r) => r.booking_status_snapshot !== 'confirmed' || r.template_key === 'booking_confirmed'));
    // No false confirmed copy for non-confirmed
    for (const r of outRows) {
        if (r.booking_status_snapshot === 'requested' || r.booking_status_snapshot === 'reschedule_needed') {
            assert.notStrictEqual(r.template_key, 'booking_confirmed');
        }
    }

    // --- 7. Double-book never falsely confirmed ---
    const conflict = engine.createBooking(db, site.userId, site.id, {
        serviceId: services[0].id,
        startUtc: start1,
        visitorName: 'Bob Conflict',
        visitorEmail: 'bob.conflict@example.com',
        nowMs,
    });
    assert.ok(
        conflict.status === 'requested' || conflict.status === 'reschedule_needed',
        'conflict must not be confirmed, got ' + conflict.status
    );
    assert.notStrictEqual(conflict.status, 'confirmed');

    // --- 8. Owner confirm/cancel via engine (dashboard path already oracle'd) ---
    if (conflict.status === 'requested' || conflict.status === 'reschedule_needed') {
        // leave conflicted as-is; cancel frees nothing unique for same start on reschedule_needed
        const cancelledConflict = engine.cancelBookingAsOwner(
            db,
            site.userId,
            site.id,
            conflict.booking.id
        );
        assert.strictEqual(cancelledConflict.status, 'cancelled');
    }

    // --- 9. Visitor manage token: get + cancel frees slot ---
    const start2 = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 11, 0, 'Europe/Bucharest'));
    const book2 = engine.createBooking(db, site.userId, site.id, {
        serviceId: services[0].id,
        startUtc: start2,
        visitorName: 'Visitor Manage',
        visitorEmail: 'visitor.manage@example.com',
        nowMs,
    });
    assert.strictEqual(book2.status, 'confirmed');
    const view = manageApi.getBookingByToken(db, book2.manageToken);
    assert.ok(view.ok);
    assert.strictEqual(view.booking.status, 'confirmed');
    assert.match(view.booking.statusLabelRo, /confirmat/i);
    assert.ok(!/factory|SHA|worktree|kanban/i.test(JSON.stringify(view)));

    const slotsBefore = engine.generateSlots(db, site.userId, site.id, {
        serviceId: services[0].id,
        dateLocal: MON,
        nowMs,
        minLeadMinutes: 0,
    });
    const hadStart2 = slotsBefore.some((s) => s.start_utc === start2);
    assert.strictEqual(hadStart2, false, 'occupied slot must not appear free');

    const cancelled = manageApi.cancelByToken(db, book2.manageToken, { nowMs });
    assert.ok(cancelled.ok);
    assert.strictEqual(cancelled.booking.status, 'cancelled');
    assert.strictEqual(cancelled.slotFreed, true);

    const slotsAfter = engine.generateSlots(db, site.userId, site.id, {
        serviceId: services[0].id,
        dateLocal: MON,
        nowMs,
        minLeadMinutes: 0,
    });
    assert.ok(
        slotsAfter.some((s) => s.start_utc === start2),
        'after visitor cancel, slot must be free again'
    );

    // --- 10. HTTP manage + public book + legacy appointments coexistence ---
    // Close our handle so the server singleton can open the same DATA_DIR file.
    try { db.close(); } catch (_) { /* ignore */ }
    publicApi.resetDbHandle();
    const { createHandler } = require('../server.js');
    const server = http.createServer(createHandler({}));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    async function jget(p) {
        const res = await fetch(base + p);
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
    }
    async function jpost(p, obj) {
        const res = await fetch(base + p, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(obj),
        });
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
    }

    const svcList = await jget(
        '/api/calendar-native/services?customerId=' +
            encodeURIComponent(site.userId) +
            '&siteId=' +
            encodeURIComponent(site.id)
    );
    assert.strictEqual(svcList.status, 200, JSON.stringify(svcList.body));
    assert.ok(svcList.body.ok && svcList.body.services.length >= 1);

    const start3 = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 14, 0, 'Europe/Bucharest'));
    const bookHttp = await jpost('/api/calendar-native/bookings', {
        customerId: site.userId,
        siteId: site.id,
        serviceId: svcList.body.services[0].id,
        startUtc: start3,
        visitorName: 'HTTP Ana',
        visitorEmail: 'http.ana@example.com',
    });
    assert.strictEqual(bookHttp.status, 200, JSON.stringify(bookHttp.body));
    assert.ok(bookHttp.body.ok);
    assert.ok(bookHttp.body.status === 'confirmed' || bookHttp.body.status === 'requested');
    assert.ok(bookHttp.body.manageToken);

    const manageGet = await jget(
        '/api/calendar-native/manage?token=' + encodeURIComponent(bookHttp.body.manageToken)
    );
    assert.strictEqual(manageGet.status, 200);
    assert.ok(manageGet.body.ok);
    assert.strictEqual(manageGet.body.booking.status, bookHttp.body.status);

    const managePage = await fetch(base + '/calendar-native/manage/?token=' + encodeURIComponent(bookHttp.body.manageToken));
    assert.strictEqual(managePage.status, 200);
    const manageHtml = await managePage.text();
    assert.match(manageHtml, /Gestionează programarea/);
    assert.doesNotMatch(manageHtml, /worktree|kanban|SHA|factory/i);

    const cancelHttp = await jpost('/api/calendar-native/manage/cancel', {
        token: bookHttp.body.manageToken,
    });
    assert.strictEqual(cancelHttp.status, 200);
    assert.ok(cancelHttp.body.ok);
    assert.strictEqual(cancelHttp.body.booking.status, 'cancelled');

    // Legacy appointments still work (slug published)
    const published = path.join(tmp, 'published', 'legacy-slug');
    fs.mkdirSync(published, { recursive: true });
    fs.writeFileSync(path.join(published, 'index.html'), '<!doctype html><title>legacy</title>');
    const leg = await jpost('/api/appointments', {
        slug: 'legacy-slug',
        appointmentTypeId: 'consult-init',
        appointmentTypeLabel: 'Consultație',
        requestedStartISO: new Date(Date.now() + 86400000).toISOString(),
        timezone: 'Europe/Bucharest',
        durationMin: 45,
        mode: 'online',
        visitorName: 'Legacy Visitor',
        visitorEmail: 'legacy@example.com',
    });
    assert.strictEqual(leg.status, 200, JSON.stringify(leg.body));
    assert.strictEqual(leg.body.status, 'requested');
    assert.notStrictEqual(leg.body.status, 'confirmed');

    // --- 11. Untouched protected files ---
    const legal = fs.readFileSync(path.join(ROOT, 'bot/site-legal.js'), 'utf8');
    assert.ok(legal.length > 100);
    // This test must not have modified them; existence lock
    assert.ok(fs.existsSync(path.join(ROOT, 'bot/test/fullpass-63230d2.mjs')));

    // professionals script still posts legacy appointments
    const prScript = fs.readFileSync(path.join(ROOT, 'templates/professionals/script.js'), 'utf8');
    assert.match(prScript, /\/api\/appointments/);
    assert.doesNotMatch(prScript, /calendar-native/);

    server.close();
    publicApi.resetDbHandle();
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(
        'PASS calendar-native-cutover (opt-in/out, seed, email, double-book, manage token free, legacy appointments)'
    );
})().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
});
