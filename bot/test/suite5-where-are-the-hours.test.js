'use strict';
/**
 * bot/test/suite5-where-are-the-hours.test.js
 *
 * PLAN-QA-2026-09-12 Suite 5, S5-3 — M15 (major) + m25.
 *
 * Two things confirmed by QA-Explorare-2026-09-12/reports/07-calendar-native.md
 * (D3, S3):
 *
 *  1. `bot/calendar-native/owner/owner-dashboard.js`'s "Servicii" tab told the
 *     owner, in its own empty-state hint, "Le adaugi și le redenumești în
 *     editor" — but the site editor (`builder/app.js`) has NO screen for
 *     `appointment.types` or `appointment.weekly` (both intentionally
 *     `"editable": false` in schema.json — Suite 1 decided against generic
 *     list buttons producing empty rows on this structured config). The
 *     dashboard sent the owner somewhere that does not exist.
 *
 *  2. The editor's own "Programări native Hidook" panel
 *     (`buildNativeBookingPanel` in builder/app.js) only ever pointed at the
 *     real dashboard ("Deschide programările") once the site was ALREADY
 *     published AND paid (`currentSitePaid`). An owner who just switched
 *     native booking on, on a fresh unpublished draft, got zero indication
 *     from the editor about where hours/services would eventually live.
 *
 * Given the deadline, the plan's chosen fix is NOT a full hours/services
 * editor — it is: (a) stop the dashboard lying about where renaming happens,
 * and (b) always show a plain-language pointer to the real place, in BOTH the
 * unpaid-draft and paid-published states.
 *
 * This oracle reads the two source files directly (both are already tested
 * this way elsewhere in this repo — see wave8-calendar-reachable-flag-
 * consistency.test.js) rather than driving a full browser, since the property
 * under test is what the copy SAYS, not any interactive behaviour.
 *
 * Run: node --experimental-sqlite --test bot/test/suite5-where-are-the-hours.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const DASHBOARD_JS = path.join(ROOT, 'bot/calendar-native/owner/owner-dashboard.js');
const APP_JS = path.join(ROOT, 'builder/app.js');

function extractFunction(src, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i++];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
    }
    return src.slice(m.index, i);
}

test('owner dashboard no longer tells the owner to add/rename services "in the editor"', () => {
    const dashSrc = fs.readFileSync(DASHBOARD_JS, 'utf8');
    const panelSrc = extractFunction(dashSrc, 'paintServices');
    assert.ok(panelSrc, 'could not extract paintServices() from owner-dashboard.js');

    assert.ok(
        !/adaugi.{0,40}redenume[sș]ti.{0,20}în editor/i.test(panelSrc) &&
        !/le redenume[sș]ti.{0,10}în editor/i.test(panelSrc),
        'DEFECT M15: owner-dashboard.js still tells the owner that consultation types are added/' +
        'renamed "în editor" — builder/app.js has no such screen (appointment.types/weekly are ' +
        '"editable": false in schema.json since Suite 1); this sends the owner nowhere'
    );

    // The honest replacement: renaming/duration/pause happen right here, in
    // this same dashboard tab.
    assert.ok(/chiar aici|tot (în )?acest tab/i.test(panelSrc),
        'the corrected copy should say renaming/duration/pause happen right here in the dashboard, ' +
        'not point the owner elsewhere for something this same panel already does');
});

test('the editor\'s native-booking panel always points at the real dashboard location, paid or not', () => {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const panelSrc = extractFunction(appSrc, 'buildNativeBookingPanel');
    assert.ok(panelSrc, 'could not extract buildNativeBookingPanel() from builder/app.js');

    // Must mention BOTH the weekly-hours tab and the services/types tab by
    // their real dashboard names, so an owner can actually find them.
    assert.match(panelSrc, /Disponibilitate/,
        'DEFECT M15/m25: the panel never names "Disponibilitate" (where hours are set) — an owner ' +
        'who just turned native booking on has no idea where to go');
    assert.match(panelSrc, /Servicii/,
        'DEFECT M15/m25: the panel never names "Servicii" (where consultation types are set)');

    // The pointer text must be reachable from an `if (on)` gate that is NOT
    // itself nested inside the `currentSitePaid` gate — i.e. it must render
    // on a fresh unpaid draft too (m25), not only after publish+payment.
    const onlyGate = /if\s*\(on\)\s*\{/;
    assert.match(panelSrc, onlyGate,
        'expected a plain `if (on) { ... }` block (not gated by currentSitePaid) so the hint shows ' +
        'on an unpublished/unpaid draft too — the pre-existing paid-only gate is `if (on && ' +
        'currentSiteId && currentSitePaid ...)`, a different, narrower condition');

    // And the hint text itself must sit textually before the paid-only gate,
    // i.e. it doesn't only exist inside the `currentSitePaid` branch.
    const paidGateIndex = panelSrc.search(/if\s*\(on\s*&&\s*currentSiteId\s*&&\s*currentSitePaid/);
    const disponibilitateIndex = panelSrc.search(/Disponibilitate/);
    assert.ok(paidGateIndex === -1 || disponibilitateIndex < paidGateIndex,
        'DEFECT M15/m25: the "Disponibilitate"/"Servicii" pointer only appears inside the ' +
        'currentSitePaid-gated block — an owner on an unpaid draft would never see it');
});
