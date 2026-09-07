'use strict';
/**
 * bot/test/wave13-native-calendar-static-export.test.js
 *
 * A statically-exported site must be able to LOAD the native booking widget.
 *
 * Confirmed live on the owner's own site (https://profesionals.pages.dev): the
 * booking section rendered its heading, its intro and its privacy notice, and
 * the mount point was there with the right tenant ids — but the published HTML
 * carried `data-api-base=""`, so the browser was told to fetch
 *
 *     https://profesionals.pages.dev/calendar-native/widget/public-booking-widget.js
 *     https://profesionals.pages.dev/calendar-native/widget/public-booking-widget.css
 *     https://profesionals.pages.dev/api/calendar-native/services?...
 *
 * Cloudflare Pages answers all three with the site's own index.html (200,
 * text/html), so the script tag is ignored, no stylesheet applies, and the
 * widget never boots. Nothing errors anywhere: the owner switched the calendar
 * on, the backend seeded three services correctly, the API answered with proper
 * CORS — and the visitor simply saw a booking section with no way to book.
 *
 * Root cause: resolveNativeApiBase() read only CALENDAR_PUBLIC_BASE_URL and
 * PUBLIC_BASE_URL. Neither is set anywhere in this repo — not in the Dockerfile,
 * railway.json, CI, or GO-LIVE.md — while the rest of the application configures
 * itself from PUBLIC_URL. This is the SAME defect, with the same root cause,
 * that sent every visitor's cancel link to http://127.0.0.1:0
 * (bot/calendar-native/email/index.js#manageBaseUrl). It was fixed there and
 * not here.
 *
 * Run: node --experimental-sqlite --test bot/test/wave13-native-calendar-static-export.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const cutover = require(path.join(ROOT, 'bot', 'calendar-native', 'cutover.js'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const TPL = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
const PRESETS = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
).presets;

const ENV_KEYS = ['CALENDAR_PUBLIC_BASE_URL', 'PUBLIC_BASE_URL', 'PUBLIC_URL'];

function withEnv(vars, fn) {
    const saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    try {
        return fn();
    } finally {
        for (const k of ENV_KEYS) {
            if (saved[k] == null) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
}

const SITE = { userId: 'cust_static_export', id: 'site_static_export' };

test('PUBLIC_URL — the variable production actually sets — resolves the widget origin', () => {
    for (const key of ENV_KEYS) {
        const base = withEnv({ [key]: 'https://lp.hidook.agency' }, () =>
            cutover.applyCutoverToConfig({ appointment: { nativeBooking: 'da' } }, SITE)
                .config.appointment.nativeApiBase);
        assert.equal(base, 'https://lp.hidook.agency',
            key + ' did not resolve the native API base — a static export publishes ' +
            'data-api-base="" and the widget can never load');
    }
});

test('the more specific variable still wins over the general one', () => {
    const base = withEnv({
        CALENDAR_PUBLIC_BASE_URL: 'https://rezervari.exemplu.ro',
        PUBLIC_BASE_URL: 'https://nope.example',
        PUBLIC_URL: 'https://also-nope.example',
    }, () => cutover.applyCutoverToConfig({ appointment: { nativeBooking: 'da' } }, SITE)
        .config.appointment.nativeApiBase);
    assert.equal(base, 'https://rezervari.exemplu.ro');
});

test('an explicit per-site override still beats every environment variable', () => {
    const base = withEnv({ PUBLIC_URL: 'https://lp.hidook.agency' }, () =>
        cutover.applyCutoverToConfig(
            { appointment: { nativeBooking: 'da', nativeApiBase: 'https://api.clientul.ro/' } }, SITE
        ).config.appointment.nativeApiBase);
    assert.equal(base, 'https://api.clientul.ro');
});

test('a same-origin deployment (no public URL configured at all) still renders relative', () => {
    const base = withEnv({}, () =>
        cutover.applyCutoverToConfig({ appointment: { nativeBooking: 'da' } }, SITE)
            .config.appointment.nativeApiBase);
    assert.equal(base, '', 'local/same-origin serving must keep relative URLs');
});

test('with production env, the published HTML points every widget URL at the bot host', () => {
    const cfg = JSON.parse(JSON.stringify(PRESETS[0].config));
    cfg.appointment.nativeBooking = 'da';
    const applied = withEnv({ PUBLIC_URL: 'https://lp.hidook.agency' }, () =>
        cutover.applyCutoverToConfig(cfg, SITE).config);
    const html = renderHtml(TPL, applied);

    assert.match(html, /data-hidook-cal-native/, 'widget mount missing');

    // Every URL the widget needs must be absolute, or Cloudflare Pages answers
    // it with the site's own index.html and the widget silently never boots.
    const offenders = [];
    const re = /(?:src|href|data-api-base)="([^"]*calendar-native[^"]*|)"/g;
    let m;
    while ((m = re.exec(html))) {
        const url = m[1];
        if (!/calendar-native/.test(url) && m[0].indexOf('data-api-base') === -1) continue;
        if (!/^https?:\/\//i.test(url)) offenders.push(m[0]);
    }
    assert.deepEqual(offenders, [],
        'these resolve against the static host, not the bot host:\n' + offenders.join('\n'));

    assert.match(html, /data-api-base="https:\/\/lp\.hidook\.agency"/);
    assert.match(html, /src="https:\/\/lp\.hidook\.agency\/calendar-native\/widget\/public-booking-widget\.js"/);
    assert.match(html, /href="https:\/\/lp\.hidook\.agency\/calendar-native\/widget\/public-booking-widget\.css"/);
});

test('switching the calendar on with no reachable origin is reported, not swallowed', () => {
    const logPath = path.join(ROOT, 'bot', 'logger.js');
    const logger = require(logPath);
    const seen = [];
    const original = logger.log;
    logger.log = (event, detail, level) => { seen.push({ event, detail, level }); };
    try {
        withEnv({}, () =>
            cutover.applyCutoverToConfig({ appointment: { nativeBooking: 'da' } }, SITE));
    } finally {
        logger.log = original;
    }
    const warned = seen.find((e) => /native_api_base|api_base/.test(String(e.event)));
    assert.ok(warned,
        'the calendar was switched on with no public origin configured and nothing was logged — ' +
        'the owner sees a booking section that cannot book, and the server says nothing.\n' +
        'events seen: ' + JSON.stringify(seen.map((e) => e.event)));
});
