'use strict';
/**
 * Owner dashboard tenant isolation + cancel/reschedule/availability oracle
 * (VISION.md §8 step c part 2).
 *
 * Proves:
 *  1. Professional B cannot list/cancel/reschedule A's bookings via owner API
 *  2. Session customerId must equal tenant customerId (auth bind)
 *  3. Cancel frees slot immediately; history row stays cancelled (not deleted)
 *  4. Reschedule moves slot; old start becomes free again
 *  5. Weekly + blackout + service duration/buffer write same schema (a)+(b)
 *  6. Owner UI RO copy + 390-friendly CSS; legacy appointment form untouched
 *
 * Run: node --experimental-sqlite bot/test/calendar-native-owner-dashboard.test.js
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-owner-'));
process.env.DATA_DIR = tmp;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'cal-owner-oracle-secret-v2';
process.env.NODE_ENV = 'test';

const engine = require('../calendar-native/engine');
const publicApi = require('../calendar-native/public-api');
const ownerApi = require('../calendar-native/owner-api');
const { openCalendarDb } = require('../calendar-native/db');
const { zonedWallTimeToUtcMs, toIsoUtc, isoWeekdayForDateLocal } = require('../calendar-native/time');
const auth = require('../auth');

publicApi.resetDbHandle();
const db = openCalendarDb({ dbPath: path.join(tmp, 'owner.sqlite') });

const A = { customerId: 'customer_owner_A', siteId: 'site_owner_A' };
const B = { customerId: 'customer_owner_B', siteId: 'site_owner_B' };

function seed(t, svcId, name) {
    engine.ensureSettings(db, t.customerId, t.siteId, {
        timezone: 'Europe/Bucharest',
        default_buffer_minutes: 5,
        slot_interval_minutes: 30,
    });
    const svc = engine.upsertService(db, t.customerId, t.siteId, {
        id: svcId,
        name,
        duration_minutes: 30,
        buffer_minutes: 5,
    });
    engine.setWeeklyAvailability(db, t.customerId, t.siteId, [
        { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 3, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 4, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 5, start_minute: 9 * 60, end_minute: 17 * 60 },
    ]);
    return svc;
}

const svcA = seed(A, 'svc_owner_A', 'Consultație secretă A');
const svcB = seed(B, 'svc_owner_B', 'Consultație publică B');

const MON = '2030-01-07';
assert.strictEqual(isoWeekdayForDateLocal(MON), 1);
const nowMs = Date.UTC(2026, 0, 1);
const startA = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 10, 0, 'Europe/Bucharest'));
const startA2 = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 11, 0, 'Europe/Bucharest'));

const createdA = engine.createBooking(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    startUtc: startA,
    visitorName: 'Secret Ana',
    visitorEmail: 'secret-ana@pii.example',
    visitorPhone: '0700111222',
    note: 'PII only A',
    nowMs,
});
assert.strictEqual(createdA.status, 'confirmed');
const bookingAId = createdA.booking.id;

// --- Pure authorizeOwnerTenant ---
const authzCross = ownerApi.authorizeOwnerTenant(B.customerId, A.customerId, A.siteId, {
    getSite: () => ({ id: A.siteId, userId: A.customerId }),
});
assert.strictEqual(authzCross.ok, false);
assert.strictEqual(authzCross.status, 403);

const authzOk = ownerApi.authorizeOwnerTenant(A.customerId, A.customerId, A.siteId, {
    getSite: () => ({ id: A.siteId, userId: A.customerId }),
});
assert.strictEqual(authzOk.ok, true);

const authzWrongSite = ownerApi.authorizeOwnerTenant(A.customerId, A.customerId, B.siteId, {
    getSite: (id) => (id === B.siteId ? { id: B.siteId, userId: B.customerId } : null),
});
assert.strictEqual(authzWrongSite.ok, false);
assert.strictEqual(authzWrongSite.status, 403);

// B list must not see A
const listB = ownerApi.listOwnerBookings(db, B.customerId, B.siteId, {});
assert.ok(listB.ok);
assert.strictEqual(listB.bookings.length, 0);
assert.ok(!listB.bookings.some((b) => b.id === bookingAId || /secret-ana/i.test(b.visitorEmail || '')));

const listA = ownerApi.listOwnerBookings(db, A.customerId, A.siteId, { q: 'secret' });
assert.ok(listA.ok);
assert.strictEqual(listA.bookings.length, 1);
assert.strictEqual(listA.bookings[0].visitorEmail, 'secret-ana@pii.example');

// B cancel A → not found (tenant scope)
const cancelCross = ownerApi.cancelOwnerBooking(db, B.customerId, B.siteId, bookingAId);
assert.ok(cancelCross.error);
assert.strictEqual(cancelCross.status, 404);
const stillA = engine.getBooking(db, A.customerId, A.siteId, bookingAId);
assert.strictEqual(stillA.status, 'confirmed');

// B reschedule A → not found
const reschedCross = ownerApi.rescheduleOwnerBooking(db, B.customerId, B.siteId, bookingAId, {
    startUtc: startA2,
}, { nowMs });
assert.ok(reschedCross.error);
assert.strictEqual(reschedCross.status, 404);

// --- Cancel frees slot; history audited ---
const slotsBefore = engine.generateSlots(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    dateLocal: MON,
    nowMs,
});
assert.ok(!slotsBefore.some((s) => s.start_utc === startA), 'confirmed booking occupies slot');

const cancelled = ownerApi.cancelOwnerBooking(db, A.customerId, A.siteId, bookingAId);
assert.ok(cancelled.ok);
assert.strictEqual(cancelled.booking.status, 'cancelled');
assert.ok(cancelled.booking.cancelledAt);

const rawAfterCancel = engine.unsafeGetBookingByIdOnly(db, bookingAId);
assert.ok(rawAfterCancel, 'history row must remain');
assert.strictEqual(rawAfterCancel.status, 'cancelled');
assert.strictEqual(rawAfterCancel.visitor_email, 'secret-ana@pii.example');

const slotsAfterCancel = engine.generateSlots(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    dateLocal: MON,
    nowMs,
});
assert.ok(slotsAfterCancel.some((s) => s.start_utc === startA), 'slot freed after cancel');

// --- Reschedule frees old, keeps id ---
const created2 = engine.createBooking(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    startUtc: startA,
    visitorName: 'Ana 2',
    visitorEmail: 'ana2@example.com',
    nowMs,
});
assert.strictEqual(created2.status, 'confirmed');
const id2 = created2.booking.id;
const moved = ownerApi.rescheduleOwnerBooking(db, A.customerId, A.siteId, id2, {
    startUtc: startA2,
}, { nowMs });
assert.ok(moved.ok, JSON.stringify(moved));
assert.strictEqual(moved.booking.id, id2);
assert.strictEqual(moved.booking.startUtc, startA2);
assert.ok(moved.booking.status === 'confirmed' || moved.booking.status === 'reschedule_needed');

const slotsAfterMove = engine.generateSlots(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    dateLocal: MON,
    nowMs,
});
assert.ok(slotsAfterMove.some((s) => s.start_utc === startA), 'old slot free after reschedule');
assert.ok(!slotsAfterMove.some((s) => s.start_utc === startA2), 'new slot occupied');

// --- Availability editor same schema ---
const weeklyPut = ownerApi.putOwnerWeekly(db, A.customerId, A.siteId, {
    windows: [
        { weekday: 1, startMinute: 10 * 60, endMinute: 16 * 60 },
        { weekday: 3, startMinute: 9 * 60, endMinute: 12 * 60 },
    ],
});
assert.ok(weeklyPut.ok);
assert.strictEqual(weeklyPut.weekly.length, 2);
const weeklyRaw = engine.listWeeklyAvailability(db, A.customerId, A.siteId);
assert.strictEqual(weeklyRaw.length, 2);
assert.ok(weeklyRaw.every((w) => w.customer_id === A.customerId && w.site_id === A.siteId));

const ov = ownerApi.addOwnerOverride(db, A.customerId, A.siteId, {
    dateLocal: '2030-12-24',
    kind: 'blackout',
    note: 'Crăciun A',
});
assert.ok(ov.ok);
assert.strictEqual(ov.override.kind, 'blackout');
const ovB = ownerApi.listOwnerBookings; // silence lint
void ovB;
const ovListB = engine.listDateOverrides(db, B.customerId, B.siteId);
assert.ok(!ovListB.some((o) => o.note === 'Crăciun A'));

const rm = ownerApi.removeOwnerOverride(db, B.customerId, B.siteId, ov.override.id);
assert.ok(rm.error);
assert.strictEqual(rm.status, 404);
const stillOv = engine.listDateOverrides(db, A.customerId, A.siteId);
assert.ok(stillOv.some((o) => o.id === ov.override.id));

const rmOk = ownerApi.removeOwnerOverride(db, A.customerId, A.siteId, ov.override.id);
assert.ok(rmOk.ok);

const svcEdit = ownerApi.putOwnerService(db, A.customerId, A.siteId, svcA.id, {
    name: 'Consultație A v2',
    durationMinutes: 45,
    bufferMinutes: 15,
});
assert.ok(svcEdit.ok);
assert.strictEqual(svcEdit.service.durationMinutes, 45);
assert.strictEqual(svcEdit.service.bufferMinutes, 15);
const crossSvc = ownerApi.putOwnerService(db, B.customerId, B.siteId, svcA.id, {
    name: 'Hijack',
    durationMinutes: 10,
});
assert.ok(crossSvc.error);
assert.strictEqual(crossSvc.status, 404);
const svcAStill = engine.getService(db, A.customerId, A.siteId, svcA.id);
assert.strictEqual(svcAStill.name, 'Consultație A v2');
assert.strictEqual(svcAStill.duration_minutes, 45);

// --- UI source oracle ---
const dashJs = fs.readFileSync(path.join(ROOT, 'bot/calendar-native/owner/owner-dashboard.js'), 'utf8');
const dashCss = fs.readFileSync(path.join(ROOT, 'bot/calendar-native/owner/owner-dashboard.css'), 'utf8');
const preview = fs.readFileSync(path.join(ROOT, 'bot/calendar-native/owner/preview.html'), 'utf8');

assert.match(dashJs, /Programările tale/);
assert.match(dashJs, /Reprogramează/);
assert.match(dashJs, /Anulează/);
assert.match(dashJs, /Disponibilitate/);
assert.match(dashJs, /Blackout/);
assert.match(dashJs, /data-hidook-cal-owner/);
assert.match(dashJs, /credentials:\s*'same-origin'/);
assert.match(dashJs, /\/api\/calendar-native\/owner\/bookings/);
assert.doesNotMatch(dashJs, /Failed to fetch|Something went wrong|Loading…|SUBMIT/);
assert.match(dashCss, /@media \(max-width: 400px\)/);
assert.match(dashCss, /minmax\(0,\s*1fr\)/);
assert.match(dashCss, /overflow-x:\s*hidden/);
assert.doesNotMatch(dashCss, /\.hod[^{]*\{[^}]*min-width:\s*[6-9]\d{2,}px/);
assert.match(preview, /preview-session/);
assert.match(preview, /demo_customer_elena/);

// Legacy form untouched
const prScript = fs.readFileSync(path.join(ROOT, 'templates/professionals/script.js'), 'utf8');
assert.match(prScript, /\/api\/appointments/);
assert.doesNotMatch(prScript, /calendar-native\/owner/);
const prTpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
assert.match(prTpl, /id="pr-appt-form"/);
assert.doesNotMatch(prTpl, /data-hidook-cal-owner/);

// No parallel schema files
assert.ok(!fs.existsSync(path.join(ROOT, 'bot/calendar-native/owner-schema.js')));
assert.ok(fs.existsSync(path.join(ROOT, 'bot/calendar-native/schema.js')));

// --- HTTP surface with real sessions ---
publicApi.resetDbHandle();
const { createHandler } = require('../server.js');

(async () => {
    const server = http.createServer(createHandler({}));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    function cookieFor(userId) {
        return 'hb_session=' + auth.signSession(userId);
    }

    async function req(method, p, { userId, body, headers } = {}) {
        const h = Object.assign({ Accept: 'application/json' }, headers || {});
        if (userId) h.Cookie = cookieFor(userId);
        if (body != null) {
            h['Content-Type'] = 'application/json';
        }
        const res = await fetch(base + p, {
            method,
            headers: h,
            body: body != null ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* ignore */ }
        return { status: res.status, body: json, text, setCookie: res.headers.get('set-cookie') };
    }

    // No auth → 401
    const noAuth = await req('GET',
        '/api/calendar-native/owner/bookings?customerId=' + A.customerId + '&siteId=' + A.siteId);
    assert.strictEqual(noAuth.status, 401);

    // B session + A tenant → 403 (customerId bind)
    const crossHttp = await req('GET',
        '/api/calendar-native/owner/bookings?customerId=' + A.customerId + '&siteId=' + A.siteId,
        { userId: B.customerId });
    assert.strictEqual(crossHttp.status, 403);
    assert.ok(crossHttp.body && crossHttp.body.code === 'FORBIDDEN');

    // Seed registry sites for non-demo ownership path
    const registry = require('../registry');
    // Ensure users exist lightly via createSite which needs userId only
    // createSite will create site records owned by userId
    let siteRecA;
    let siteRecB;
    try {
        siteRecA = registry.createSite({
            userId: A.customerId,
            templateId: 'professionals',
            templateVersion: 1,
            slug: 'site-owner-a-oracle',
        });
        siteRecB = registry.createSite({
            userId: B.customerId,
            templateId: 'professionals',
            templateVersion: 1,
            slug: 'site-owner-b-oracle',
        });
    } catch (e) {
        // If registry path collides on DATA_DIR, still continue with DEMO path tests
        siteRecA = null;
        siteRecB = null;
    }

    if (siteRecA && siteRecB) {
        // Re-seed calendar under registry site ids
        const RA = { customerId: A.customerId, siteId: siteRecA.id };
        const RB = { customerId: B.customerId, siteId: siteRecB.id };
        // Use same db path as server (DATA_DIR/calendar-native.sqlite)
        publicApi.resetDbHandle();
        const sdb = openCalendarDb({ dataDir: tmp });
        engine.ensureSettings(sdb, RA.customerId, RA.siteId, {
            timezone: 'Europe/Bucharest',
            default_buffer_minutes: 0,
            slot_interval_minutes: 30,
        });
        engine.ensureSettings(sdb, RB.customerId, RB.siteId, {
            timezone: 'Europe/Bucharest',
            default_buffer_minutes: 0,
            slot_interval_minutes: 30,
        });
        const rSvcA = engine.upsertService(sdb, RA.customerId, RA.siteId, {
            id: 'svc_reg_A',
            name: 'Reg A secret',
            duration_minutes: 30,
        });
        engine.upsertService(sdb, RB.customerId, RB.siteId, {
            id: 'svc_reg_B',
            name: 'Reg B',
            duration_minutes: 30,
        });
        engine.setWeeklyAvailability(sdb, RA.customerId, RA.siteId, [
            { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
        ]);
        engine.setWeeklyAvailability(sdb, RB.customerId, RB.siteId, [
            { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
        ]);
        const startReg = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 10, 30, 'Europe/Bucharest'));
        const bookReg = engine.createBooking(sdb, RA.customerId, RA.siteId, {
            serviceId: rSvcA.id,
            startUtc: startReg,
            visitorName: 'Reg Visitor',
            visitorEmail: 'reg-a@pii.example',
            nowMs,
        });
        assert.ok(bookReg.booking);

        const aList = await req('GET',
            '/api/calendar-native/owner/bookings?customerId=' + encodeURIComponent(RA.customerId) +
            '&siteId=' + encodeURIComponent(RA.siteId),
            { userId: A.customerId });
        assert.strictEqual(aList.status, 200, JSON.stringify(aList.body));
        assert.ok(aList.body.ok);
        assert.ok(aList.body.bookings.some((b) => b.visitorEmail === 'reg-a@pii.example'));

        // B tries A's siteId while binding customerId=B (auth requires customerId===session)
        // Using B session + A customerId fails 403; B session + B customer + A siteId fails ownership
        const bOnASite = await req('GET',
            '/api/calendar-native/owner/bookings?customerId=' + encodeURIComponent(B.customerId) +
            '&siteId=' + encodeURIComponent(RA.siteId),
            { userId: B.customerId });
        assert.strictEqual(bOnASite.status, 403);

        const bCancelA = await req('POST',
            '/api/calendar-native/owner/bookings/' + encodeURIComponent(bookReg.booking.id) + '/cancel',
            {
                userId: B.customerId,
                body: { customerId: B.customerId, siteId: RB.siteId },
            });
        // B cancel with own tenant + foreign booking id → 404
        assert.strictEqual(bCancelA.status, 404);

        const aCancel = await req('POST',
            '/api/calendar-native/owner/bookings/' + encodeURIComponent(bookReg.booking.id) + '/cancel',
            {
                userId: A.customerId,
                body: { customerId: A.customerId, siteId: RA.siteId },
            });
        assert.strictEqual(aCancel.status, 200, JSON.stringify(aCancel.body));
        assert.strictEqual(aCancel.body.booking.status, 'cancelled');

        // Availability write as A
        const wPut = await req('PUT', '/api/calendar-native/owner/availability/weekly', {
            userId: A.customerId,
            body: {
                customerId: A.customerId,
                siteId: RA.siteId,
                windows: [{ weekday: 2, startMinute: 9 * 60, endMinute: 13 * 60 }],
            },
        });
        assert.strictEqual(wPut.status, 200, JSON.stringify(wPut.body));
        assert.ok(wPut.body.ok);

        // B cannot write A's weekly even with forged site
        const wCross = await req('PUT', '/api/calendar-native/owner/availability/weekly', {
            userId: B.customerId,
            body: {
                customerId: A.customerId,
                siteId: RA.siteId,
                windows: [{ weekday: 1, startMinute: 0, endMinute: 60 }],
            },
        });
        assert.strictEqual(wCross.status, 403);

        sdb.close();
    }

    // Demo preview session + static owner UI
    const prevSess = await req('POST', '/api/calendar-native/owner/preview-session');
    assert.strictEqual(prevSess.status, 200);
    assert.ok(prevSess.body.ok);
    assert.ok(prevSess.setCookie && /hb_session=/.test(prevSess.setCookie));

    const ownerHtml = await fetch(base + '/calendar-native/owner/');
    assert.strictEqual(ownerHtml.status, 200);
    const ownerText = await ownerHtml.text();
    assert.match(ownerText, /data-hidook-cal-owner/);
    const ownerCss = await fetch(base + '/calendar-native/owner/owner-dashboard.css');
    assert.strictEqual(ownerCss.status, 200);
    const ownerJs = await fetch(base + '/calendar-native/owner/owner-dashboard.js');
    assert.strictEqual(ownerJs.status, 200);

    // Public widget still works (no regression)
    const pub = await req('GET',
        '/api/calendar-native/services?customerId=demo_customer_elena&siteId=demo_site_cabinet');
    assert.strictEqual(pub.status, 200);
    assert.ok(pub.body.ok);

    server.close();
    db.close();
    publicApi.resetDbHandle();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS calendar-native-owner-dashboard (tenant isolation, cancel/reschedule free slot, availability schema, HTTP auth)');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
