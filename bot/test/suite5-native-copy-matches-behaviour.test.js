'use strict';
/**
 * bot/test/suite5-native-copy-matches-behaviour.test.js
 *
 * PLAN-QA-2026-09-12 Suite 5, S5-2 — M14 (major).
 *
 * `templates/professionals/template.html` renders `appointment.title`,
 * `appointment.intro` and the FAQ list from `presets.json` in BOTH modes: the
 * old local "cerere manuală" form AND the native Hidook calendar. Those fields
 * were written for the manual form only ("Confirmăm cererea ... formularul nu
 * face o rezervare automată") — but with `appointment.nativeBooking` ON, the
 * native widget confirms slots INSTANTLY. The static copy sat right above the
 * widget and flatly contradicted it, and a leftover FAQ item ("Cererea
 * confirmă automat programarea? Nu.") repeated the same lie further down the
 * same page. Nobody caught it because every test that renders this template
 * with `nativeBooking: 'da'` only ever checked that the widget mount point
 * existed (`data-hidook-cal-native`) — never what the surrounding prose said.
 *
 * This oracle renders the real template with the real preset config, once
 * with native booking off (must keep the OLD wording byte-for-byte — this is
 * still shipping to real "cerere manuală" clients) and once with it on (must
 * NOT contain the manual-request wording, and must contain copy that actually
 * describes instant confirmation).
 *
 * Run: node --experimental-sqlite --test bot/test/suite5-native-copy-matches-behaviour.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));
const cutover = require(path.join(ROOT, 'bot', 'calendar-native', 'cutover.js'));

const TPL = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
const PRESETS = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
).presets;

const SITE = { userId: 'cust_suite5_copy', id: 'site_suite5_copy' };

// The exact manual-request phrases a visitor must NEVER see once native
// booking confirms their slot instantly.
const MANUAL_INTRO_LIE = 'nu face o rezervare automată';
const MANUAL_FAQ_QUESTION = 'Cererea confirmă automat programarea';

function htmlFor(nativeBooking) {
    const cfg = JSON.parse(JSON.stringify(PRESETS[0].config));
    cfg.appointment.nativeBooking = nativeBooking ? 'da' : '';
    const applied = cutover.applyCutoverToConfig(cfg, SITE).config;
    return renderHtml(TPL, applied);
}

test('native booking OFF: the old manual-request copy is untouched', () => {
    const html = htmlFor(false);
    assert.match(html, /Solicită o programare/, 'old section title changed for the manual form');
    assert.ok(html.includes(MANUAL_INTRO_LIE),
        'the manual-request intro ("' + MANUAL_INTRO_LIE + '") must stay exactly as it was — this is ' +
        'still the truth for the old form');
    assert.ok(html.includes(MANUAL_FAQ_QUESTION),
        'the manual-request FAQ item must stay exactly as it was for the old form');
});

test('native booking ON: the page no longer contradicts the widget it just showed', () => {
    const html = htmlFor(true);

    assert.match(html, /data-hidook-cal-native/, 'native widget mount point missing');

    assert.ok(!html.includes(MANUAL_INTRO_LIE),
        'DEFECT M14: with native booking ON, the page still says "' + MANUAL_INTRO_LIE + '" directly ' +
        'above a calendar widget that confirms instantly — the static copy was never split by mode');
    assert.ok(!html.includes(MANUAL_FAQ_QUESTION),
        'DEFECT M14: with native booking ON, the FAQ still asks "' + MANUAL_FAQ_QUESTION + '?" and ' +
        'answers "Nu" — false for a widget that just confirmed the booking instantly');

    // The replacement copy must actually SAY the booking is instant, not just
    // avoid the old lie by accident.
    assert.ok(html.includes('confirmă instant') || html.includes('confirmarea instant') ||
        html.includes('confirmare instant'),
        'native mode has no dedicated copy describing instant confirmation — ' +
        'appointment.nativeTitle / appointment.nativeIntro / faq.nativeItems are missing or empty');
});

test('native booking ON: every preset carries dedicated native copy (not just preset 0)', () => {
    for (const preset of PRESETS) {
        const cfg = JSON.parse(JSON.stringify(preset.config));
        cfg.appointment.nativeBooking = 'da';
        const applied = cutover.applyCutoverToConfig(cfg, SITE).config;
        const html = renderHtml(TPL, applied);
        assert.ok(!html.includes(MANUAL_INTRO_LIE),
            'preset "' + preset.id + '": manual-request lie leaked into native mode');
        assert.ok(!html.includes(MANUAL_FAQ_QUESTION),
            'preset "' + preset.id + '": manual-request FAQ leaked into native mode');
    }
});
