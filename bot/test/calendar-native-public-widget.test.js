'use strict';
/**
 * Behavioral oracle — public native booking widget + API (VISION.md §8 step c part 1).
 *
 * Covers:
 *  1. Widget/API only shows that tenant's free slots (no cross-tenant leak)
 *  2. createBooking rejects Sunday / blackout starts (HIGH residual closed)
 *  3. Error path: RO message + alt contact chrome in widget; no fake-success markup on error
 *  4. Widget CSS usable at 390 (no fixed desktop-only min-width clipping controls)
 *  5. Legacy appointment form path untouched (professionals script still posts /api/appointments)
 *
 * Run: node --experimental-sqlite bot/test/calendar-native-public-widget.test.js
 *   or: node --test bot/test/calendar-native-public-widget.test.js
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
const engine = require('../calendar-native/engine');
const publicApi = require('../calendar-native/public-api');
const { openCalendarDb } = require('../calendar-native/db');
const { zonedWallTimeToUtcMs, toIsoUtc, isoWeekdayForDateLocal } = require('../calendar-native/time');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-native-widget-'));
process.env.DATA_DIR = tmp;
publicApi.resetDbHandle();
const db = openCalendarDb({ dbPath: path.join(tmp, 'widget.sqlite') });

const A = { customerId: 'cust_widget_A', siteId: 'site_widget_A' };
const B = { customerId: 'cust_widget_B', siteId: 'site_widget_B' };

function seedTenant(t, svcId, svcName) {
    engine.ensureSettings(db, t.customerId, t.siteId, {
        timezone: 'Europe/Bucharest',
        default_buffer_minutes: 0,
        slot_interval_minutes: 30,
    });
    const svc = engine.upsertService(db, t.customerId, t.siteId, {
        id: svcId,
        name: svcName,
        duration_minutes: 30,
    });
    // Mon–Fri only
    engine.setWeeklyAvailability(db, t.customerId, t.siteId, [
        { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 3, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 4, start_minute: 9 * 60, end_minute: 17 * 60 },
        { weekday: 5, start_minute: 9 * 60, end_minute: 17 * 60 },
    ]);
    return svc;
}

const svcA = seedTenant(A, 'svc_wa', 'Serviciu A secret');
const svcB = seedTenant(B, 'svc_wb', 'Serviciu B public');

// Blackout on A's Tuesday 2030-01-08
const TUE = '2030-01-08';
assert.strictEqual(isoWeekdayForDateLocal(TUE), 2);
engine.addDateOverride(db, A.customerId, A.siteId, {
    date_local: TUE,
    kind: 'blackout',
    note: 'A blackout secret',
});

// Monday open for both
const MON = '2030-01-07';
assert.strictEqual(isoWeekdayForDateLocal(MON), 1);
const nowMs = Date.UTC(2026, 0, 1);

// --- 1. Public services scoped ---
const svcListA = publicApi.listPublicServices(db, A.customerId, A.siteId);
assert.ok(svcListA.ok);
assert.ok(svcListA.services.every((s) => s.id === 'svc_wa'));
assert.ok(!svcListA.services.some((s) => s.id === 'svc_wb' || /B public/.test(s.name)));

const svcListB = publicApi.listPublicServices(db, B.customerId, B.siteId);
assert.ok(svcListB.ok);
assert.ok(!svcListB.services.some((s) => s.id === 'svc_wa' || /A secret/.test(s.name)));

// --- 1b. Slots: B never sees A's blackout as "empty for B" incorrectly, and A blackout zeros A ---
const slotsATue = publicApi.listPublicSlots(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    fromDateLocal: TUE,
    toDateLocal: TUE,
    nowMs,
});
assert.ok(slotsATue.ok);
assert.strictEqual(slotsATue.slots.length, 0, 'A blackout → no free slots via public API');

const slotsBTue = publicApi.listPublicSlots(db, B.customerId, B.siteId, {
    serviceId: svcB.id,
    fromDateLocal: TUE,
    toDateLocal: TUE,
    nowMs,
});
assert.ok(slotsBTue.ok);
assert.ok(slotsBTue.slots.length > 0, 'B must still have Tuesday slots (A blackout isolated)');

const slotsAMon = publicApi.listPublicSlots(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    fromDateLocal: MON,
    toDateLocal: MON,
    nowMs,
});
assert.ok(slotsAMon.ok && slotsAMon.slots.length > 0);

// Cross-tenant: B cannot pull A's service slots
const cross = publicApi.listPublicSlots(db, B.customerId, B.siteId, {
    serviceId: svcA.id,
    fromDateLocal: MON,
    toDateLocal: MON,
    nowMs,
});
assert.ok(cross.error || cross.status === 404, 'B + A serviceId must fail');
assert.notStrictEqual(cross.ok, true);

// Book on A Monday — B slots unaffected
const startA = slotsAMon.slots[0].startUtc;
const bookedA = publicApi.createPublicBooking(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    startUtc: startA,
    visitorName: 'Visitor A',
    visitorEmail: 'a-visitor@example.com',
}, { nowMs });
assert.ok(bookedA.ok);
assert.strictEqual(bookedA.status, 'confirmed');

const slotsBMon = publicApi.listPublicSlots(db, B.customerId, B.siteId, {
    serviceId: svcB.id,
    fromDateLocal: MON,
    toDateLocal: MON,
    nowMs,
});
assert.ok(slotsBMon.slots.some((s) => s.startUtc === startA), 'A booking must not consume B capacity');

// Public slot payload must not leak PII fields
for (const s of slotsAMon.slots) {
    assert.ok(!('visitorName' in s) && !('visitor_email' in s) && !('note' in s));
}

// --- 2. Reject Sunday (no weekly) and blackout via createBooking / public API ---
const SUN = '2030-01-13';
assert.strictEqual(isoWeekdayForDateLocal(SUN), 7);
const sundayStart = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 13, 10, 0, 'Europe/Bucharest'));

let threw = null;
try {
    engine.createBooking(db, A.customerId, A.siteId, {
        serviceId: svcA.id,
        startUtc: sundayStart,
        visitorName: 'Hack',
        visitorEmail: 'hack@example.com',
        nowMs,
    });
} catch (e) {
    threw = e;
}
assert.ok(threw, 'Sunday createBooking must throw');
assert.strictEqual(threw.code, 'SLOT_OUTSIDE_AVAILABILITY');

const sunPublic = publicApi.createPublicBooking(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    startUtc: sundayStart,
    visitorName: 'Hack',
    visitorEmail: 'hack@example.com',
}, { nowMs });
assert.ok(sunPublic.error);
assert.strictEqual(sunPublic.code, 'SLOT_OUTSIDE_AVAILABILITY');
assert.ok(/program|disponibil|liber/i.test(sunPublic.error), 'RO error for outside availability');
assert.notStrictEqual(sunPublic.ok, true);
assert.ok(!sunPublic.id, 'no booking id on reject');

const blackoutStart = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 8, 10, 0, 'Europe/Bucharest'));
const boPublic = publicApi.createPublicBooking(db, A.customerId, A.siteId, {
    serviceId: svcA.id,
    startUtc: blackoutStart,
    visitorName: 'Hack',
    visitorEmail: 'hack2@example.com',
}, { nowMs });
assert.ok(boPublic.error);
assert.strictEqual(boPublic.code, 'SLOT_OUTSIDE_AVAILABILITY');
assert.ok(!boPublic.ok);

// Engine-level blackout reject
threw = null;
try {
    engine.createBooking(db, A.customerId, A.siteId, {
        serviceId: svcA.id,
        startUtc: blackoutStart,
        visitorName: 'Hack',
        visitorEmail: 'hack3@example.com',
        nowMs,
    });
} catch (e) {
    threw = e;
}
assert.ok(threw && threw.code === 'SLOT_OUTSIDE_AVAILABILITY');

// --- 3. Widget error chrome (static source oracle) ---
const widgetJs = fs.readFileSync(
    path.join(ROOT, 'bot/calendar-native/widget/public-booking-widget.js'),
    'utf8'
);
const widgetCss = fs.readFileSync(
    path.join(ROOT, 'bot/calendar-native/widget/public-booking-widget.css'),
    'utf8'
);
const previewHtml = fs.readFileSync(
    path.join(ROOT, 'bot/calendar-native/widget/preview.html'),
    'utf8'
);

assert.match(widgetJs, /Programările online sunt temporar indisponibile/);
assert.match(widgetJs, /data-hnb-error/);
assert.match(widgetJs, /buildAltHtml/);
assert.match(widgetJs, /WhatsApp|contactPhone|wa\.me/);
assert.match(widgetJs, /Nu am înregistrat nicio programare/);
// Error path must never mark fake success
assert.doesNotMatch(
    widgetJs,
    /showError[\s\S]{0,200}data-hnb-success/,
    'showError must not set success markers'
);
assert.match(widgetJs, /data-hnb-success.*confirmed/);
// No English factory chrome in visitor strings
for (const bad of ['Failed to fetch', 'Something went wrong', 'Please fill', 'Loading…', 'SUBMIT']) {
    assert.ok(!widgetJs.includes(bad), 'no English chrome: ' + bad);
}
assert.match(widgetJs, /Se trimite…/);
assert.match(widgetJs, /Confirmă programarea/);

// 390: responsive slots / no huge fixed min-width on root
assert.match(widgetCss, /@media \(max-width: 400px\)/);
assert.match(widgetCss, /minmax\(0,\s*1fr\)/);
assert.doesNotMatch(widgetCss, /\.hnb\s*\{[^}]*min-width:\s*[6-9]\d{2,}px/);

// Preview mounts native widget with demo tenant + alt contacts
assert.match(previewHtml, /data-hidook-cal-native/);
assert.match(previewHtml, /demo_customer_elena/);
assert.match(previewHtml, /data-contact-whatsapp/);
assert.match(previewHtml, /public-booking-widget\.js/);

// --- 5. Legacy appointment form remains default; cutover is opt-in only ---
const prScript = fs.readFileSync(path.join(ROOT, 'templates/professionals/script.js'), 'utf8');
assert.match(prScript, /\/api\/appointments/);
assert.doesNotMatch(prScript, /calendar-native/);
const prTpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
assert.match(prTpl, /id="pr-appt-form"/);
assert.match(prTpl, /appointment\.nativeBooking/, 'cutover gate present');
assert.match(prTpl, /data-hidook-cal-native/, 'native mount behind opt-in');
// Default preset must NOT render the native mount (no forced migration)
const { renderHtml } = require('../../build.js');
const prPreset = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')
).presets[0].config;
const defaultPrHtml = renderHtml(prTpl, prPreset);
assert.match(defaultPrHtml, /id="pr-appt-form"/);
assert.doesNotMatch(defaultPrHtml, /data-hidook-cal-native/);

// --- HTTP surface: services/slots/bookings + widget static + no appointments regression ---
publicApi.resetDbHandle();
const { createHandler } = require('../server.js');

(async () => {
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

    // Demo tenant auto-seed on services
    const demoSvc = await jget(
        '/api/calendar-native/services?customerId=demo_customer_elena&siteId=demo_site_cabinet'
    );
    assert.strictEqual(demoSvc.status, 200, 'demo services');
    assert.ok(demoSvc.body.ok && demoSvc.body.services.length >= 1);

    const demoSlots = await jget(
        '/api/calendar-native/slots?customerId=demo_customer_elena&siteId=demo_site_cabinet' +
        '&serviceId=' + encodeURIComponent(demoSvc.body.services[0].id) +
        '&from=2030-01-07&to=2030-01-10'
    );
    assert.strictEqual(demoSlots.status, 200);
    assert.ok(demoSlots.body.ok);
    assert.ok(Array.isArray(demoSlots.body.slots));
    // No PII keys on slots
    const blob = JSON.stringify(demoSlots.body);
    assert.ok(!/visitor_email|visitorName|manage_token_hash/.test(blob));

    // Book a free demo slot
    assert.ok(demoSlots.body.slots.length > 0, 'demo has future free slots');
    const book = await jpost('/api/calendar-native/bookings', {
        customerId: 'demo_customer_elena',
        siteId: 'demo_site_cabinet',
        serviceId: demoSvc.body.services[0].id,
        startUtc: demoSlots.body.slots[0].startUtc,
        visitorName: 'Ana Ionescu',
        visitorEmail: 'ana@example.com',
        visitorPhone: '0722000000',
    });
    assert.strictEqual(book.status, 200, JSON.stringify(book.body));
    assert.ok(book.body.ok);
    assert.ok(book.body.status === 'confirmed' || book.body.status === 'requested');
    assert.ok(book.body.manageToken);

    // Reject Sunday via HTTP
    const sunHttp = await jpost('/api/calendar-native/bookings', {
        customerId: 'demo_customer_elena',
        siteId: 'demo_site_cabinet',
        serviceId: demoSvc.body.services[0].id,
        startUtc: sundayStart,
        visitorName: 'X',
        visitorEmail: 'x@example.com',
    });
    assert.strictEqual(sunHttp.status, 400);
    assert.strictEqual(sunHttp.body.code, 'SLOT_OUTSIDE_AVAILABILITY');
    assert.ok(!sunHttp.body.ok);
    assert.match(String(sunHttp.body.error), /disponibil|program|liber/i);

    // Widget static
    const prev = await fetch(base + '/calendar-native/widget/');
    assert.strictEqual(prev.status, 200);
    const prevText = await prev.text();
    assert.match(prevText, /data-hidook-cal-native/);
    const css = await fetch(base + '/calendar-native/widget/public-booking-widget.css');
    assert.strictEqual(css.status, 200);
    const js = await fetch(base + '/calendar-native/widget/public-booking-widget.js');
    assert.strictEqual(js.status, 200);

    // Cross-tenant HTTP: unknown tenant without seed → not configured
    const ghost = await jget(
        '/api/calendar-native/services?customerId=other_cust&siteId=other_site'
    );
    assert.ok(ghost.status === 404 || (ghost.body && ghost.body.code === 'NOT_CONFIGURED'));

    server.close();
    db.close();
    publicApi.resetDbHandle();
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log('PASS calendar-native-public-widget (tenant slots, blackout/Sunday reject, RO error chrome, HTTP)');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
