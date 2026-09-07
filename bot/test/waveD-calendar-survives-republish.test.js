'use strict';
/**
 * bot/test/waveD-calendar-survives-republish.test.js
 *
 * An owner's real working hours must survive a republish of the site.
 *
 * The staged cutover seeds the calendar engine from the site config —
 * appointment.weekly, appointment.types, timezone, slot interval — so that a
 * freshly enabled calendar is usable immediately. That seeding ran on EVERY
 * publish, and engine.setWeeklyAvailability() is DELETE-then-insert by
 * construction.
 *
 * So:
 *
 *   1. Owner enables the native calendar and publishes. Seeded Mon-Fri 09:00.
 *   2. Owner opens the calendar dashboard and sets their real schedule:
 *      Tuesday and Thursday, 14:00-19:00.
 *   3. Owner goes back to the editor, fixes a typo in their tagline, and
 *      republishes.
 *   4. Their schedule is gone. Monday-Friday 09:00-17:00 is back, from the
 *      config, and the site now accepts bookings at hours they do not work.
 *
 * Nothing warned them, and nothing in the editor suggested that a text edit
 * touches the calendar at all.
 *
 * The rule this locks: the config seeds a calendar that does not exist yet;
 * once it exists, the calendar owns its own availability and the operational
 * settings the owner can reach (timezone, slot interval, cancellation window).
 * Services stay config-owned — appointment.types is edited in the site editor
 * and has no counterpart in the calendar dashboard — so those are still
 * upserted on publish, deliberately.
 *
 * Run: node --experimental-sqlite --test bot/test/waveD-calendar-survives-republish.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function freshDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-republish-'));
    process.env.DATA_DIR = dir;
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    for (const m of ['calendar-native/db.js', 'calendar-native/engine.js', 'calendar-native/cutover.js']) {
        delete require.cache[require.resolve(path.join(ROOT, 'bot', m))];
    }
    const { openCalendarDb } = require(path.join(ROOT, 'bot', 'calendar-native', 'db.js'));
    return { dir, db: openCalendarDb({}) };
}

function nativeConfig() {
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;
    const copy = JSON.parse(JSON.stringify(cfg));
    copy.appointment = Object.assign({}, copy.appointment, { nativeBooking: 'da' });
    return copy;
}

const SITE = { id: 'site0000000000000000000000000001', userId: 'user0000000000000000000000000001', slug: 'cab' };

function windowsOf(engine, db, customerId, siteId) {
    return engine.listWeeklyAvailability(db, customerId, siteId)
        .map((w) => `${w.weekday}:${w.start_minute}-${w.end_minute}`)
        .sort();
}

test('a republish does not overwrite working hours set in the calendar', () => {
    const { dir, db } = freshDb();
    try {
        const cutover = require(path.join(ROOT, 'bot', 'calendar-native', 'cutover.js'));
        const engine = require(path.join(ROOT, 'bot', 'calendar-native', 'engine.js'));

        const first = cutover.preparePublishCutover({ config: nativeConfig(), site: SITE, db });
        assert.ok(first.optedIn, 'the fixture must opt into native booking');
        const { customerId, siteId } = first;
        assert.ok(windowsOf(engine, db, customerId, siteId).length > 0,
            'the first publish must seed a usable calendar — that part is the point of the cutover');

        // The owner sets their real schedule in the calendar dashboard.
        const real = [
            { weekday: 2, start_minute: 14 * 60, end_minute: 19 * 60 },
            { weekday: 4, start_minute: 14 * 60, end_minute: 19 * 60 },
        ];
        engine.setWeeklyAvailability(db, customerId, siteId, real);
        const afterOwner = windowsOf(engine, db, customerId, siteId);
        assert.deepStrictEqual(afterOwner, ['2:840-1140', '4:840-1140'], 'fixture sanity');

        // ... then edits unrelated text and republishes.
        const edited = nativeConfig();
        edited.business.tagline = 'Alt slogan.';
        cutover.preparePublishCutover({ config: edited, site: SITE, db });

        assert.deepStrictEqual(
            windowsOf(engine, db, customerId, siteId), afterOwner,
            'republishing the site replaced the owner\'s working hours with the config\'s. A text edit ' +
            'in the editor must not silently change when the business is open — bookings would be ' +
            'accepted at hours nobody is there.'
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a republish does not overwrite calendar settings the owner can change', () => {
    const { dir, db } = freshDb();
    try {
        const cutover = require(path.join(ROOT, 'bot', 'calendar-native', 'cutover.js'));
        const engine = require(path.join(ROOT, 'bot', 'calendar-native', 'engine.js'));

        const first = cutover.preparePublishCutover({ config: nativeConfig(), site: SITE, db });
        const { customerId, siteId } = first;

        // The owner changes the operational settings the dashboard exposes.
        engine.ensureSettings(db, customerId, siteId, {
            timezone: 'Europe/Chisinau',
            slot_interval_minutes: 45,
            min_cancel_hours: 4,
        });
        const mine = engine.getSettings(db, customerId, siteId);
        assert.strictEqual(mine.timezone, 'Europe/Chisinau', 'fixture sanity');

        cutover.preparePublishCutover({ config: nativeConfig(), site: SITE, db });

        const after = engine.getSettings(db, customerId, siteId);
        assert.strictEqual(after.timezone, 'Europe/Chisinau',
            'republishing reset the calendar timezone to the site config\'s value');
        assert.strictEqual(after.slot_interval_minutes, 45,
            'republishing reset the slot interval to the site config\'s value');
        assert.strictEqual(after.min_cancel_hours, 4,
            'republishing reset the cancellation window');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('the first publish still seeds a usable calendar, and services stay config-owned', () => {
    const { dir, db } = freshDb();
    try {
        const cutover = require(path.join(ROOT, 'bot', 'calendar-native', 'cutover.js'));
        const engine = require(path.join(ROOT, 'bot', 'calendar-native', 'engine.js'));

        const first = cutover.preparePublishCutover({ config: nativeConfig(), site: SITE, db });
        const { customerId, siteId } = first;
        assert.ok(first.seed && first.seed.availabilitySeeded,
            'the first cutover must report that it seeded availability');
        assert.ok(windowsOf(engine, db, customerId, siteId).length >= 5,
            'a calendar with no hours at all would be unbookable on day one');

        // appointment.types is edited in the site editor and has no counterpart
        // in the calendar dashboard, so a republish SHOULD carry it through.
        const renamed = nativeConfig();
        renamed.appointment.types = (renamed.appointment.types || []).map((t, i) =>
            i === 0 ? Object.assign({}, t, { label: 'Consultație redenumită' }) : t);
        cutover.preparePublishCutover({ config: renamed, site: SITE, db });

        const services = engine.listServices(db, customerId, siteId).map((s) => s.name);
        assert.ok(services.includes('Consultație redenumită'),
            'renaming a consultation type in the editor must reach the published calendar — ' +
            'services are config-owned, unlike availability');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
