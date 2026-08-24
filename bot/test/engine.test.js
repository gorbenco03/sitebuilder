'use strict';
/**
 * Test: build.js render engine
 *
 * (a) renderHtml pe templates/product-menu cu presetul 1 produce acelasi HTML ca
 *     build() clasic pe un tmpdir.
 * (b) generated/engine.js incarcat intr-un vm cu window={} produce un HTML
 *     cu <style> inline, fara {{ si fara href="styles.css".
 * (c) node build.js in ROOT produce index.html byte-identic (invariant).
 * (d) renderHtml editMode pe product-menu preset0 → contine data-hb-edit="business.name"
 *     in context text; {{business.title}} din atribut content= NU e invelit.
 * (e) Token dintr-o bucla @each are index corect: data-hb-edit="services.0.label".
 * (f) Fara editMode, ZERO 'data-hb-edit' in output.
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

check('(a) renderHtml(product-menu, preset 0) == build() clasic pe tmpdir', () => {
    const { build, renderHtml } = require('../../build.js');

    const config = loadPreset('product-menu', 0);
    const templateHtml = loadTemplateHtml('product-menu');

    // Randeaza cu noua functie pura
    const rendered = renderHtml(templateHtml, config);

    // Construieste cu build() clasic intr-un tmpdir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-test-'));
    try {
        // Copiaza fisierele necesare lui build()
        fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(config), 'utf8');
        fs.copyFileSync(
            path.join(ROOT, 'templates', 'product-menu', 'template.html'),
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

    const templateId = 'product-menu';
    const tplDir = path.join(ROOT, 'templates', templateId);

    const files = {
        templateHtml: fs.readFileSync(path.join(tplDir, 'template.html'), 'utf8'),
        stylesCss:    fs.readFileSync(path.join(tplDir, 'styles.css'),    'utf8'),
        scriptJs:     fs.readFileSync(path.join(tplDir, 'script.js'),     'utf8'),
        collageJs:    fs.readFileSync(path.join(tplDir, 'collage.js'),    'utf8'),
    };

    const config = loadPreset('product-menu', 0);
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

// ─── (d) editMode: data-hb-edit in context text, NU in atribute ──────────────

check('(d) editMode: business.name apare ca data-hb-edit in context text (h1/p)', () => {
    const { renderHtml } = require('../../build.js');
    const config = loadPreset('product-menu', 0);
    const templateHtml = loadTemplateHtml('product-menu');

    const html = renderHtml(templateHtml, config, { editMode: true });

    // Trebuie sa contina un span cu data-hb-edit="business.name"
    assert.ok(
        html.includes('data-hb-edit="business.name"'),
        'editMode: data-hb-edit="business.name" nu e prezent in output'
    );

    // Span-ul trebuie sa aiba data-hb-kind="text"
    assert.ok(
        html.includes('data-hb-kind="text"'),
        'editMode: data-hb-kind="text" nu e prezent in output'
    );
});

check('(d) editMode: tokenul din atribut content= NU e invelit in span', () => {
    const { renderHtml } = require('../../build.js');
    const config = loadPreset('product-menu', 0);
    const templateHtml = loadTemplateHtml('product-menu');

    const html = renderHtml(templateHtml, config, { editMode: true });

    // meta og:title — valoarea atributului content= nu trebuie sa fie un span
    // Cautam: content="<span ...>" — asta ar fi o greseala
    const attrWrapped = /content="[^"]*data-hb-edit/.test(html);
    assert.ok(!attrWrapped, 'editMode: un token din atribut content= a fost gresit invelit in span');

    // href attribute — nu trebuie sa contina data-hb-edit
    const hrefWrapped = /href="[^"]*data-hb-edit/.test(html);
    assert.ok(!hrefWrapped, 'editMode: un token din atribut href= a fost gresit invelit in span');

    // alt attribute — nu trebuie sa contina data-hb-edit
    const altWrapped = /alt="[^"]*data-hb-edit/.test(html);
    assert.ok(!altWrapped, 'editMode: un token din atribut alt= a fost gresit invelit in span');
});

// ─── (e) editMode in bucla @each: path indexat corect ────────────────────────

check('(e) editMode: token din @each services are index corect (services.0.label)', () => {
    const { renderHtml } = require('../../build.js');
    const config = loadPreset('product-menu', 0);
    const templateHtml = loadTemplateHtml('product-menu');

    // Asigura-te ca exista cel putin un element in services
    assert.ok(
        Array.isArray(config.services) && config.services.length > 0,
        'Preset 0 trebuie sa aiba cel putin un element in services'
    );

    const html = renderHtml(templateHtml, config, { editMode: true });

    assert.ok(
        html.includes('data-hb-edit="services.0.label"'),
        'editMode: data-hb-edit="services.0.label" nu e prezent in output (token de bucla)'
    );

    // Daca exista un al doilea element in services, verifica si services.1.label
    if (config.services.length > 1) {
        assert.ok(
            html.includes('data-hb-edit="services.1.label"'),
            'editMode: data-hb-edit="services.1.label" nu e prezent (al doilea element bucla)'
        );
    }
});

// ─── (f) fara editMode: ZERO data-hb-edit in output ──────────────────────────

check('(f) fara editMode: output-ul NU contine niciun data-hb-edit', () => {
    const { renderHtml } = require('../../build.js');
    const config = loadPreset('product-menu', 0);
    const templateHtml = loadTemplateHtml('product-menu');

    // Fara opts
    const htmlNoOpts = renderHtml(templateHtml, config);
    assert.ok(
        !htmlNoOpts.includes('data-hb-edit'),
        'renderHtml fara opts: output contine data-hb-edit (invariant incalcat)'
    );

    // Cu opts={} (editMode absent/falsy)
    const htmlEmptyOpts = renderHtml(templateHtml, config, {});
    assert.ok(
        !htmlEmptyOpts.includes('data-hb-edit'),
        'renderHtml cu opts={}: output contine data-hb-edit'
    );

    // Cu opts={editMode: false}
    const htmlFalseMode = renderHtml(templateHtml, config, { editMode: false });
    assert.ok(
        !htmlFalseMode.includes('data-hb-edit'),
        'renderHtml cu editMode:false: output contine data-hb-edit'
    );
});

// ─── (g) renderPreview in engine.js accepta opts si le paseaza mai departe ───

check('(g) engine.js renderPreview(files, config, {editMode:true}) contine data-hb-edit', () => {
    const engineSrc = fs.readFileSync(
        path.join(ROOT, 'builder', 'generated', 'engine.js'), 'utf8'
    );
    const sandbox = { window: {}, console };
    vm.runInNewContext(engineSrc, sandbox);

    const engine = sandbox.window.HidookEngine;
    const templateId = 'product-menu';
    const tplDir = path.join(ROOT, 'templates', templateId);

    const files = {
        templateHtml: fs.readFileSync(path.join(tplDir, 'template.html'), 'utf8'),
        stylesCss:    fs.readFileSync(path.join(tplDir, 'styles.css'),    'utf8'),
        scriptJs:     fs.readFileSync(path.join(tplDir, 'script.js'),     'utf8'),
        collageJs:    fs.readFileSync(path.join(tplDir, 'collage.js'),    'utf8'),
    };

    const config = loadPreset('product-menu', 0);
    const html = engine.renderPreview(files, config, { editMode: true });

    assert.ok(
        html.includes('data-hb-edit="business.name"'),
        'engine.js renderPreview editMode: data-hb-edit="business.name" nu e prezent'
    );
    assert.ok(
        html.includes('data-hb-edit="services.0.label"'),
        'engine.js renderPreview editMode: data-hb-edit="services.0.label" nu e prezent'
    );
    // Trebuie sa injecteze si style-ul de affordante pentru edit
    assert.ok(
        html.includes('data-hidook-edit-affordances'),
        'engine.js renderPreview editMode: style data-hidook-edit-affordances nu e injectat'
    );
    // Trebuie sa injecteze overlay script
    assert.ok(
        html.includes('data-hidook-edit-overlay'),
        'engine.js renderPreview editMode: script data-hidook-edit-overlay nu e injectat'
    );
});

check('(h) editMode: continutul <style>/<script>/<title> NU e invelit (regresie: span in CSS = pagina alba)', () => {
    // Bug real: {{theme.primary}} din <style> era invelit in <span data-hb-edit>,
    // corupand intregul stylesheet al temei → editorul se randa complet alb.
    const { renderHtml } = require('../../build.js');
    for (const tid of ['product-menu', 'local-service', 'portfolio', 'professionals']) {
        const tpl = fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tid, 'presets.json'), 'utf8')).presets[0].config;
        const html = renderHtml(tpl, cfg, { editMode: true });
        for (const re of [/<style[^>]*>[\s\S]*?<\/style>/gi, /<script[^>]*>[\s\S]*?<\/script>/gi, /<title>[\s\S]*?<\/title>/gi]) {
            for (const block of html.match(re) || []) {
                assert.ok(!block.includes('data-hb-edit'),
                    tid + ': data-hb-edit gasit intr-un bloc raw-text: ' + block.slice(0, 80));
            }
        }
        assert.ok((html.match(/data-hb-edit=/g) || []).length > 5, tid + ': prea putine campuri editabile');
    }
});

// ─── rezultat final ───────────────────────────────────────────────────────────

if (failed) {
    console.error('\nengine.test.js: FAILED');
    process.exit(1);
} else {
    console.log('\nengine.test.js: toate testele au trecut');
}
