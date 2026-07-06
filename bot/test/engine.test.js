'use strict';
/**
 * Test: build.js render engine
 *
 * (a) renderHtml pe templates/patiserie cu presetul 1 produce acelasi HTML ca
 *     build() clasic pe un tmpdir.
 * (b) generated/engine.js incarcat intr-un vm cu window={} produce un HTML
 *     cu <style> inline, fara {{ si fara href="styles.css".
 * (c) node build.js in ROOT produce index.html byte-identic (invariant).
 *
 * Run:  node bot/test/engine.test.js
 * Iese non-zero la primul esec.
 */

const assert  = require('assert');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const vm      = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

let failed = false;

function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadPreset(templateId, presetIndex) {
    const presetsPath = path.join(ROOT, 'templates', templateId, 'presets.json');
    const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8')).presets;
    if (!presets[presetIndex]) throw new Error(`Preset ${presetIndex} nu exista in ${templateId}`);
    return JSON.parse(JSON.stringify(presets[presetIndex].config)); // deep clone
}

function loadTemplateHtml(templateId) {
    return fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
}

// ─── (a) renderHtml vs build() clasic ────────────────────────────────────────

check('(a) renderHtml(patiserie, preset 0) == build() clasic pe tmpdir', () => {
    const { build, renderHtml } = require('../../build.js');

    const config = loadPreset('patiserie', 0);
    const templateHtml = loadTemplateHtml('patiserie');

    // Randeaza cu noua functie pura
    const rendered = renderHtml(templateHtml, config);

    // Construieste cu build() clasic intr-un tmpdir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-test-'));
    try {
        // Copiaza fisierele necesare lui build()
        fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(config), 'utf8');
        fs.copyFileSync(
            path.join(ROOT, 'templates', 'patiserie', 'template.html'),
            path.join(tmpDir, 'template.html')
        );

        const { outputPath } = build(tmpDir);
        const classic = fs.readFileSync(outputPath, 'utf8');

        assert.strictEqual(rendered, classic,
            'renderHtml produce HTML diferit fata de build() clasic');
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
});

// ─── (b) engine.js in vm ─────────────────────────────────────────────────────

check('(b) engine.js se incarca in vm si expune HidookEngine', () => {
    const engineSrc = fs.readFileSync(
        path.join(ROOT, 'builder', 'generated', 'engine.js'), 'utf8'
    );
    const sandbox = { window: {}, console };
    vm.runInNewContext(engineSrc, sandbox);

    const engine = sandbox.window.HidookEngine;
    assert.ok(engine, 'window.HidookEngine nu e definit');
    assert.strictEqual(typeof engine.renderHtml,    'function', 'renderHtml nu e functie');
    assert.strictEqual(typeof engine.escapeHtml,    'function', 'escapeHtml nu e functie');
    assert.strictEqual(typeof engine.renderPreview, 'function', 'renderPreview nu e functie');
});

check('(b) renderPreview produce <style> inline, fara {{ si fara href="styles.css"', () => {
    const engineSrc = fs.readFileSync(
        path.join(ROOT, 'builder', 'generated', 'engine.js'), 'utf8'
    );
    const sandbox = { window: {}, console };
    vm.runInNewContext(engineSrc, sandbox);

    const engine = sandbox.window.HidookEngine;

    const templateId = 'patiserie';
    const tplDir = path.join(ROOT, 'templates', templateId);

    const files = {
        templateHtml: fs.readFileSync(path.join(tplDir, 'template.html'), 'utf8'),
        stylesCss:    fs.readFileSync(path.join(tplDir, 'styles.css'),    'utf8'),
        scriptJs:     fs.readFileSync(path.join(tplDir, 'script.js'),     'utf8'),
        collageJs:    fs.readFileSync(path.join(tplDir, 'collage.js'),    'utf8'),
    };

    const config = loadPreset('patiserie', 0);
    const html = engine.renderPreview(files, config);

    // Trebuie sa contina <style> inline (CSS-ul inluit)
    assert.ok(html.includes('<style>'), 'HTML-ul nu contine <style> inline');

    // Nu trebuie sa contina {{
    assert.ok(!html.includes('{{'), 'HTML-ul mai contine token-uri nerezolvate: {{');

    // Nu trebuie sa contina referinta externa styles.css
    assert.ok(
        !html.includes('href="styles.css"'),
        'HTML-ul mai contine href="styles.css" (CSS-ul nu e inluit corect)'
    );
});

// ─── (c) invariant: node build.js produce index.html byte-identic ─────────────

check('(c) node build.js in ROOT produce index.html byte-identic', () => {
    // Salveaza continutul curent
    const outputPath = path.join(ROOT, 'index.html');
    const before = fs.readFileSync(outputPath, 'utf8');

    // Ruleaza build.js
    execFileSync(process.execPath, [path.join(ROOT, 'build.js')], {
        cwd: ROOT,
        stdio: 'pipe',
    });

    const after = fs.readFileSync(outputPath, 'utf8');

    assert.strictEqual(after, before,
        'build.js a produs un index.html diferit — invariantul byte-identic e incalcat');
});

// ─── rezultat final ───────────────────────────────────────────────────────────

if (failed) {
    console.error('\nengine.test.js: FAILED');
    process.exit(1);
} else {
    console.log('\nengine.test.js: toate testele au trecut');
}
