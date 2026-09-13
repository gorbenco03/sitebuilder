'use strict';
/**
 * bot/test/suite11-portfolio-booking-copy-honest.test.js
 *
 * PLAN-FEEDBACK-2026-09-13, Suite E — owner report (portfolio/salon,
 * screenshot in the editor): the appointment section says kicker
 * "PROGRAMĂRI", title "Programează-te online", intro "Alege serviciul, ziua
 * și ora care ți se potrivesc. Primești confirmarea pe email imediat ce
 * rezervarea e făcută." — an explicit online-booking-with-a-form promise —
 * but with native booking off (the default for every preset:
 * appointment.nativeBooking starts empty) the section renders nothing but a
 * "PROGRAMEAZĂ-TE PE WHATSAPP" button. `appointment.title`/`intro` were
 * shared verbatim between both modes in templates/portfolio/template.html,
 * so the copy always described the online form even when the page could not
 * deliver it.
 *
 * Same defect SHAPE as professionals' M14 (commit 169c62c, oracle
 * suite5-native-copy-matches-behaviour.test.js), fixed the same way: the
 * page's copy must never promise what the page does not do. Since
 * portfolio's *default* copy is the one that used to describe the online
 * form, the fix here runs the opposite direction from professionals':
 * `appointment.title`/`intro` become the WhatsApp-honest pair (used when
 * nativeBooking is OFF) and new `appointment.nativeTitle`/`nativeIntro`
 * fields (mirroring professionals' schema/template shape exactly) hold the
 * online-booking copy, rendered only when nativeBooking is ON alongside the
 * `#hnb-root` widget.
 *
 * This file checks, against the REAL template + REAL presets (not a hand-
 * rolled fixture config):
 *   1. native OFF (the default): no online-booking promise anywhere in the
 *      published render, and the WhatsApp path (button + label) is present.
 *   2. native ON: the `#hnb-root` widget mount is present and the heading/
 *      intro describe instant online booking, not WhatsApp.
 *   3. Migration/fallback: a draft with a CUSTOMISED appointment.title/intro
 *      keeps that exact text — the fix must never silently overwrite an
 *      owner's own writing, only the untouched shipped default.
 *   4. The editor-only activation hint (build.js's editMode branch, same
 *      structural gate as instagram.showTeaser) appears in the editMode
 *      render when native is off, and is completely absent from the public
 *      (non-editMode) render — the same guard shape as
 *      suite10-instagram-teaser-never-published.test.js.
 *
 * Run: node --experimental-sqlite --test bot/test/suite11-portfolio-booking-copy-honest.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));
const cutover = require(path.join(ROOT, 'bot', 'calendar-native', 'cutover.js'));

const TPL = fs.readFileSync(path.join(ROOT, 'templates', 'portfolio', 'template.html'), 'utf8');
const PRESETS = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', 'portfolio', 'presets.json'), 'utf8')
).presets;

const SITE = { userId: 'cust_suite11_copy', id: 'site_suite11_copy' };

// The exact online-booking promise a visitor must never see when the page
// only offers a WhatsApp button underneath it.
const ONLINE_PROMISE_TITLE = 'Programează-te online';
const ONLINE_PROMISE_INTRO_FRAGMENT = 'confirmarea pe email';

function extractHeadingAndIntro(html) {
    const h2 = /<h2[^>]*id="appt-heading"[^>]*>([\s\S]*?)<\/h2>/.exec(html);
    const p = /<h2[^>]*id="appt-heading"[^>]*>[\s\S]*?<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/.exec(html);
    return { heading: h2 ? h2[1].trim() : null, intro: p ? p[1].trim() : null };
}

function htmlFor(preset, nativeBooking) {
    const cfg = JSON.parse(JSON.stringify(preset.config));
    cfg.appointment.nativeBooking = nativeBooking ? 'da' : '';
    const applied = cutover.applyCutoverToConfig(cfg, SITE).config;
    return renderHtml(TPL, applied);
}

test('native booking OFF (the default): no online-booking promise, WhatsApp path shows', () => {
    for (const preset of PRESETS) {
        const html = htmlFor(preset, false);
        const label = `preset "${preset.id}"`;

        assert.ok(!html.includes('id="hnb-root"'), `${label}: native widget mount must not render with nativeBooking off`);

        const { heading, intro } = extractHeadingAndIntro(html);
        assert.ok(heading, `${label}: appointment heading missing from render`);
        assert.notEqual(heading, ONLINE_PROMISE_TITLE,
            `DEFECT: ${label} still titles the section "${ONLINE_PROMISE_TITLE}" while native booking is off ` +
            `and only a WhatsApp button renders below it — the owner-reported bug`);
        assert.ok(!(intro || '').includes(ONLINE_PROMISE_INTRO_FRAGMENT),
            `DEFECT: ${label}'s intro still promises "${ONLINE_PROMISE_INTRO_FRAGMENT}" while nativeBooking is off`);

        // The WhatsApp fallback must still be there — this fix must not
        // remove the one booking path that actually works in this mode.
        assert.ok(html.includes(preset.config.labels.waBookBtn) || html.includes('wa.me'),
            `${label}: WhatsApp booking path missing from the render`);
    }
});

test('native booking ON: widget mounts and the copy actually describes online booking', () => {
    for (const preset of PRESETS) {
        const html = htmlFor(preset, true);
        const label = `preset "${preset.id}"`;

        assert.match(html, /id="hnb-root"/, `${label}: native widget mount point missing with nativeBooking on`);

        const { heading, intro } = extractHeadingAndIntro(html);
        assert.ok(heading && /online/i.test(heading),
            `${label}: with native booking ON, heading ("${heading}") does not describe online booking — ` +
            `appointment.nativeTitle is missing or not wired`);
        assert.ok(intro && intro.length > 0,
            `${label}: with native booking ON, intro is empty — appointment.nativeIntro is missing or not wired`);
    }
});

test('customised appointment.title/intro survive: the fix never overwrites an owner\'s own writing', () => {
    const preset = PRESETS[0];
    const cfg = JSON.parse(JSON.stringify(preset.config));
    const customTitle = 'Sună-ne sau scrie pe WhatsApp — te programăm noi';
    const customIntro = 'Preferăm să vorbim direct cu tine ca să înțelegem exact ce vrei.';
    cfg.appointment.title = customTitle;
    cfg.appointment.intro = customIntro;
    cfg.appointment.nativeBooking = '';
    const applied = cutover.applyCutoverToConfig(cfg, SITE).config;
    const html = renderHtml(TPL, applied);

    assert.ok(html.includes(customTitle), 'a customised appointment.title must survive rendering byte-for-byte');
    assert.ok(html.includes(customIntro), 'a customised appointment.intro must survive rendering byte-for-byte');
});

test('editor-only activation hint: present only in editMode, absent from the public render', () => {
    const preset = PRESETS[0];
    const cfgOff = JSON.parse(JSON.stringify(preset.config));
    cfgOff.appointment.nativeBooking = '';

    const publicHtml = renderHtml(TPL, cfgOff);
    const editHtml = renderHtml(TPL, cfgOff, { editMode: true });

    assert.ok(!/data-hb-appt-hint/.test(publicHtml),
        'DEFECT: the editor-only "where to turn on online booking" hint leaked into the PUBLIC render');
    assert.ok(/data-hb-appt-hint/.test(editHtml),
        'the editor-only hint never appears even in editMode — owners are never told online booking exists');

    // Once native booking is ON there is nothing to hint at — the real form
    // is already showing.
    const cfgOn = JSON.parse(JSON.stringify(preset.config));
    cfgOn.appointment.nativeBooking = 'da';
    const appliedOn = cutover.applyCutoverToConfig(cfgOn, SITE).config;
    const editHtmlOn = renderHtml(TPL, appliedOn, { editMode: true });
    assert.ok(!/data-hb-appt-hint/.test(editHtmlOn),
        'the activation hint should not render once native booking is already on');
});

test('every preset in presets.json carries its own nativeTitle/nativeIntro (not just preset 0)', () => {
    for (const preset of PRESETS) {
        assert.ok(typeof preset.config.appointment.nativeTitle === 'string' && preset.config.appointment.nativeTitle.trim(),
            `preset "${preset.id}": appointment.nativeTitle missing or empty`);
        assert.ok(typeof preset.config.appointment.nativeIntro === 'string' && preset.config.appointment.nativeIntro.trim(),
            `preset "${preset.id}": appointment.nativeIntro missing or empty`);
        assert.notEqual(preset.config.appointment.title, ONLINE_PROMISE_TITLE,
            `preset "${preset.id}": appointment.title (the OFF-mode copy) still carries the online-booking default`);
    }
});
