'use strict';
/**
 * bot/test/waveD-calendar-reachable.test.js
 *
 * Reaching the calendar, and getting back out.
 *
 * Reported by the product owner, and all three are the same shape — the
 * feature works, and nothing tells you where it is:
 *
 *   "ca să-mi configurez calendarul trebuie să intru pe șablon, acolo din
 *    detalii să dau activează... trebuie și undeva în dashboard să fie"
 *
 *     The dashboard offered a "Programări" button only for a site where the
 *     calendar was ALREADY switched on. So the one screen an owner looks at to
 *     manage their projects had no way to START using the calendar: you had to
 *     know to open the site, find Detalii, scroll to Programări, and flip a
 *     setting nobody had mentioned.
 *
 *   "la servicii scrie că niciun serviciu nu e configurat"
 *
 *     True, and unexplained. The services in that panel ARE the site's
 *     consultation types, created by the publish-time cutover — so before the
 *     first publish with the calendar on there genuinely are none. The panel
 *     said "Niciun serviciu configurat." and stopped, which reads as a fault.
 *
 *   "pe pagina de programări nu există buton back"
 *
 *     The page opens in a new tab from the builder, so the browser's own back
 *     button is dead — there is nowhere to go back to. The only way out was the
 *     address bar.
 *
 * Run: node --experimental-sqlite --test bot/test/waveD-calendar-reachable.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function boot() {
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    process.env.HIDOOK_TEST_PAY = '1';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-reach-'));
    process.env.DATA_DIR = dir;
    process.env.SERVER_SECRET = 'reach-' + crypto.randomBytes(8).toString('hex');
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const server = startServer({ port: 0 });
    return { dir, server };
}

test('the bookings page offers a way back to the projects list', async () => {
    const { dir, server } = boot();
    await new Promise((r) => { if (server.listening) return r(); server.once('listening', r); });
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        const js = await (await fetch(base + '/calendar-native/owner/owner-dashboard.js')).text();
        assert.match(js, /hod-back/,
            'the bookings page renders no back control. It opens in a new tab, so the browser back ' +
            'button has nowhere to go — the only way out was the address bar.');
        assert.match(js, /\/app\/#dashboard/,
            'the back control must return to the builder\'s projects list, not just anywhere');

        const css = await (await fetch(base + '/calendar-native/owner/owner-dashboard.css')).text();
        assert.match(css, /\.hod-back[\s\S]{0,400}min-height:\s*44px/,
            'the back control must be a real 44px touch target like every other control on the page');
    } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('the empty services panel explains where services come from', async () => {
    const { dir, server } = boot();
    await new Promise((r) => { if (server.listening) return r(); server.once('listening', r); });
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        const js = await (await fetch(base + '/calendar-native/owner/owner-dashboard.js')).text();
        const emptyState = /Niciun serviciu[\s\S]{0,400}?<\/li>/.exec(js);
        assert.ok(emptyState, 'expected an empty-services message in the panel');
        const text = emptyState[0];
        assert.match(text, /tipurile de consultație|tipuri de consultație/i,
            'the empty state must say WHAT a service is here — the site\'s consultation types');
        assert.match(text, /publicare/i,
            'the empty state must say services appear after publishing with the calendar on, which is ' +
            'the reason the list is empty before that');
        assert.doesNotMatch(text, /^\s*<li class="hod-hint">Niciun serviciu configurat\.<\/li>/,
            'a bare "no service configured" reads as a fault rather than a next step');
    } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('the dashboard offers the first step, not only the finished state', () => {
    // buildSiteCard used to return early when native booking was off, so the
    // projects list showed nothing at all for a site whose calendar had never
    // been enabled.
    const app = fs.readFileSync(path.join(ROOT, 'builder', 'app.js'), 'utf8');
    assert.match(app, /Configurează calendarul/,
        'the dashboard must offer a way to START setting the calendar up, not only a link for sites ' +
        'where it is already on');
    // And it must land on the switch rather than dumping the owner in the editor.
    assert.match(app, /loadSiteForEdit\(site\.id,\s*'appointment\.nativeBooking'\)/,
        'the setup button must deep-link to the booking switch — an owner who has never seen the ' +
        'setting will not find it by being dropped into the editor');
    assert.match(app, /async function loadSiteForEdit\(siteId, focusFieldKey\)/,
        'loadSiteForEdit must accept the field to focus');
});
