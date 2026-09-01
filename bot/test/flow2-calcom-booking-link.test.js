'use strict';
/**
 * Flow 2 — customer-owned Cal.com booking link for professionals.
 *
 * Run: node bot/test/flow2-calcom-booking-link.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'professionals', 'template.html');
const SCHEMA_PATH = path.join(ROOT, 'templates', 'professionals', 'schema.json');
const PRESETS_PATH = path.join(ROOT, 'templates', 'professionals', 'presets.json');
const REGISTRY_PATH = path.join(ROOT, 'templates', 'registry.json');
const APP_PATH = path.join(ROOT, 'builder', 'app.js');
const BUILDER_INDEX_PATH = path.join(ROOT, 'builder', 'index.html');
const { renderHtml } = require('../../build.js');

let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (error) {
        failed++;
        console.error('FAIL', name, '-', error.message);
        if (process.env.VERBOSE) console.error(error.stack);
    }
}

function loadProfessionals() {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8')).presets;
    const config = JSON.parse(JSON.stringify(presets[0].config));
    return { template, presets, config };
}

function getIframeSandboxTokens(html, id) {
    const iframe = html.match(new RegExp(`<iframe\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i'));
    assert.ok(iframe, `#${id} iframe`);
    const sandbox = iframe[0].match(/\bsandbox=["']([^"']*)["']/i);
    assert.ok(sandbox, `#${id} sandbox`);
    return new Set(sandbox[1].trim().split(/\s+/).filter(Boolean));
}

check('professionals catalog copy describes local requests and optional customer-owned Cal.com', () => {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const professionals = registry.templates.find((template) => template.id === 'professionals');
    assert.ok(professionals, 'professionals registry entry');
    assert.strictEqual(typeof professionals.description, 'string');
    assert.match(professionals.description, /Avocați.*consultanți.*cereri de programare/i);
    assert.match(professionals.description, /link Cal\.com opțional/i);
    assert.doesNotMatch(professionals.description, /fără calendar extern|fara calendar extern|calendar extern/i);
    assert.doesNotMatch(professionals.description, /cal\.diy|calendar (?:găzduit|oferit) de Hidook/i);
});

check('interactive previews allow safe new tabs without same-origin access', () => {
    const html = fs.readFileSync(BUILDER_INDEX_PATH, 'utf8');
    for (const id of ['preview-iframe', 'preview-modal-iframe']) {
        const tokens = getIframeSandboxTokens(html, id);
        for (const required of ['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox']) {
            assert.ok(tokens.has(required), `#${id} sandbox includes ${required}`);
        }
        assert.ok(!tokens.has('allow-same-origin'), `#${id} sandbox excludes allow-same-origin`);
    }
});

check('Detalii exposes an optional Romanian Cal.com booking-link field', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const appointment = schema.sections.find((section) => section.id === 'appointment');
    assert.ok(appointment, 'appointment schema section');
    const field = appointment.fields.find((item) => item.key === 'appointment.bookingUrl');
    assert.ok(field, 'appointment.bookingUrl field');
    assert.strictEqual(field.type, 'url');
    assert.strictEqual(field.required, false);
    assert.ok(field.maxLen >= 250 && field.maxLen <= 500, 'bounded URL length');
    assert.match(field.label, /Link Cal\.com de programări.*opțional/i);
    assert.match(field.hint, /cont gratuit.*cal\.com.*lipește linkul/i);
});

check('professional presets keep bookingUrl empty so demos retain request forms', () => {
    const { presets } = loadProfessionals();
    assert.ok(presets.length >= 2, 'professional presets');
    for (const preset of presets) {
        assert.strictEqual(preset.config.appointment.bookingUrl, '', `${preset.id}: bookingUrl`);
    }
});

check('empty booking URL keeps the existing local appointment-request form', () => {
    const { template, config } = loadProfessionals();
    config.appointment.bookingUrl = '';
    const html = renderHtml(template, config);
    assert.match(html, /<form[^>]+id="pr-appt-form"/i);
    assert.doesNotMatch(html, /class="[^"]*pr-booking-link[^"]*"/i);
});

check('valid booking URL replaces the local form with a safe new-tab Romanian CTA', () => {
    const { template, config } = loadProfessionals();
    const bookingUrl = 'https://cal.com/demo/hidook-test';
    config.appointment.bookingUrl = bookingUrl;
    const html = renderHtml(template, config);
    const link = html.match(/<a\b[^>]*class="[^"]*pr-booking-link[^"]*"[^>]*>\s*Programează-te\s*<\/a>/i);
    assert.ok(link, 'prominent Programează-te booking link');
    assert.match(link[0], new RegExp(`href="${bookingUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i'));
    assert.match(link[0], /target="_blank"/i);
    assert.match(link[0], /rel="[^"]*noopener[^"]*"/i);
    assert.doesNotMatch(html, /id="pr-appt-form"/i);
});

check('clearing a previously valid booking URL restores the local request form', () => {
    const { template, config } = loadProfessionals();
    config.appointment.bookingUrl = 'https://cal.com/demo/hidook-test';
    const linkedHtml = renderHtml(template, config);
    assert.match(linkedHtml, /class="[^"]*pr-booking-link[^"]*"/i);
    assert.doesNotMatch(linkedHtml, /id="pr-appt-form"/i);

    config.appointment.bookingUrl = '';
    const clearedHtml = renderHtml(template, config);
    assert.match(clearedHtml, /<form[^>]+id="pr-appt-form"/i);
    assert.doesNotMatch(clearedHtml, /class="[^"]*pr-booking-link[^"]*"/i);
});

check('custom Cal.com domains are accepted when they use http or https', () => {
    const { template, config } = loadProfessionals();
    config.appointment.bookingUrl = 'https://programari.exemplu.ro/consultatie';
    const html = renderHtml(template, config);
    assert.match(html, /href="https:\/\/programari\.exemplu\.ro\/consultatie"/i);
    assert.doesNotMatch(html, /id="pr-appt-form"/i);
});

check('invalid booking URLs never become hrefs and fall back to the request form', () => {
    const { template, config } = loadProfessionals();
    for (const invalid of ['cal.com/demo', 'javascript:alert(1)', 'https://', 'ftp://cal.com/demo']) {
        config.appointment.bookingUrl = invalid;
        const html = renderHtml(template, config);
        assert.doesNotMatch(html, /class="[^"]*pr-booking-link[^"]*"/i, invalid);
        assert.doesNotMatch(html, new RegExp(`href="${invalid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i'), invalid);
        assert.match(html, /<form[^>]+id="pr-appt-form"/i, invalid);
    }
});

check('builder rejects invalid URL input with Romanian visible error copy before saving', () => {
    const app = fs.readFileSync(APP_PATH, 'utf8');
    assert.match(app, /function\s+isPlausibleHttpUrl\s*\(/);
    assert.match(app, /Introdu un link complet care începe cu http:\/\/ sau https:\/\//);
    assert.match(app, /setCustomValidity|aria-invalid/);
    assert.match(app, /field-input--url\[aria-invalid=["']true["']\]/);
    assert.match(app, /invalidUrlInput\.focus\(\)/);
});

check('builder saves cleared booking URLs and fully refreshes their structural preview', () => {
    const app = fs.readFileSync(APP_PATH, 'utf8');
    const inputHandler = app.match(/input\.addEventListener\('input', \(\) => \{([\s\S]*?)\n  \}\);/);
    assert.ok(inputHandler, 'drawer input handler');
    const source = inputHandler[1];
    const invalidGuard = source.indexOf('if (!updateUrlValidity()) return;');
    const nextValue = source.indexOf("const nextValue = type === 'url' ? input.value.trim() : input.value;");
    const saveValue = source.indexOf('setPath(draft.config, key, nextValue);');
    assert.ok(invalidGuard >= 0 && invalidGuard < nextValue, 'invalid URLs return before save');
    assert.ok(nextValue >= 0 && nextValue < saveValue, 'empty trimmed URL reaches setPath');
    assert.match(
        source,
        /if \(key === 'appointment\.bookingUrl'\) \{\s*scheduleRerender\(true\);\s*\}/,
        'booking URL changes require a full preview render'
    );
});

if (failed) {
    console.error('flow2-calcom-booking-link: FAILED', failed);
    process.exit(1);
}
console.log('flow2-calcom-booking-link: ok');
