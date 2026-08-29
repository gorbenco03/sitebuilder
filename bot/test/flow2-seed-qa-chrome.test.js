'use strict';
/**
 * Flow 2 seed-QA regression oracle.
 *
 * Locks Romanian customer-visible builder chrome and verifies that every catalog
 * preview renders its first preset with recognisable seed content and photos.
 *
 * Run: node bot/test/flow2-seed-qa-chrome.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (error) {
        failed++;
        console.error('FAIL', name, '-', error.message);
    }
}

const appSrc = read('builder/app.js');
const appCss = read('builder/app.css');
const overlaySrc = read('builder/edit-overlay.js');
const professionalsTemplate = read('templates/professionals/template.html');
const professionalsScript = read('templates/professionals/script.js');
const professionalsPresetsSrc = read('templates/professionals/presets.json');

check('builder chrome contains no known English QA leaks', () => {
    const forbidden = [
        'Preview:',
        'Preview unavailable',
        'Loading your projects',
        'Replace photo',
        'Instagram is live on your site',
        'Instagram connected.',
    ];
    const source = appSrc + '\n' + overlaySrc;
    for (const phrase of forbidden) {
        assert.ok(!source.includes(phrase), `customer-visible English remains: ${phrase}`);
    }
    assert.ok(appSrc.includes('Previzualizare:'), 'preview modal title is Romanian');
    assert.ok(overlaySrc.includes('Înlocuiește fotografia'), 'photo overlay label is Romanian');
});

check('professional booking chrome and presets are Romanian', () => {
    const source = professionalsTemplate + '\n' + professionalsScript + '\n' + professionalsPresetsSrc;
    assert.ok(!source.includes(' · office'), 'office mode remains customer-visible');
    assert.ok(!source.includes(' · phone'), 'phone mode remains customer-visible');
    assert.ok(!professionalsScript.includes("DateTimeFormat('en-US'"), 'day chips still use en-US');

    const presets = JSON.parse(professionalsPresetsSrc).presets || [];
    const allowedModes = new Set(['cabinet', 'telefon', 'online']);
    for (const preset of presets) {
        const types = (((preset || {}).config || {}).appointment || {}).types || [];
        for (const type of types) {
            assert.ok(
                allowedModes.has(type.mode),
                `${preset.id || preset.name}: booking mode is not Romanian: ${type.mode}`
            );
        }
    }
});

check('390px account email stays one ellipsized token', () => {
    const mobileHeader = appCss.match(/\/\* 390 cabinet[\s\S]*?\/\* ---------- Editor Topbar/);
    assert.ok(mobileHeader, 'mobile cabinet header rules exist');
    assert.ok(/white-space:\s*nowrap/.test(mobileHeader[0]), 'email must not wrap mid-domain');
    assert.ok(/overflow:\s*hidden/.test(mobileHeader[0]), 'tight email is clipped safely');
    assert.ok(/text-overflow:\s*ellipsis/.test(mobileHeader[0]), 'tight email uses an ellipsis');
    assert.ok(!/overflow-wrap:\s*anywhere/.test(mobileHeader[0]), 'email must not shred at arbitrary letters');
});

check('all five first presets render seed content and local photography', () => {
    const engineSrc = read('builder/generated/engine.js');
    const sandbox = { window: {}, console };
    vm.runInNewContext(engineSrc, sandbox);
    const engine = sandbox.window.HidookEngine;
    assert.ok(engine && typeof engine.renderPreview === 'function', 'generated preview engine exists');

    const registry = JSON.parse(read('templates/registry.json')).templates || [];
    assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
    for (const entry of registry) {
        const id = entry.id;
        const dir = `templates/${id}`;
        const presets = JSON.parse(read(`${dir}/presets.json`)).presets || [];
        assert.ok(presets[0] && presets[0].config, `${id}: first preset exists`);
        const config = presets[0].config;
        const files = {
            templateHtml: read(`${dir}/template.html`),
            stylesCss: read(`${dir}/styles.css`),
            scriptJs: read(`${dir}/script.js`),
            imageMap: {},
        };
        const collagePath = path.join(ROOT, dir, 'collage.js');
        if (fs.existsSync(collagePath)) files.collageJs = fs.readFileSync(collagePath, 'utf8');
        const imageDir = path.join(ROOT, dir, 'images');
        if (fs.existsSync(imageDir)) {
            for (const name of fs.readdirSync(imageDir)) {
                files.imageMap[`images/${name}`] = `/app/generated/template-assets/${id}/images/${name}`;
            }
        }

        const html = engine.renderPreview(files, config);
        const businessName = String(((config || {}).business || {}).name || '').trim();
        assert.ok(businessName && html.includes(businessName), `${id}: preview omits seed business name`);
        assert.ok(!html.includes('{{'), `${id}: preview contains unresolved template tokens`);
        if (id !== 'professionals') {
            assert.ok(
                html.includes(`/app/generated/template-assets/${id}/images/`),
                `${id}: preview omits local photography`
            );
        }
        assert.ok(html.includes('data-hidook-preview'), `${id}: deterministic preview visibility CSS missing`);
    }
});

if (failed) {
    console.error(`\nflow2-seed-qa-chrome.test.js: ${failed} failure(s)`);
    process.exit(1);
}
console.log('\nflow2-seed-qa-chrome.test.js: all checks passed');
