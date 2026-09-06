'use strict';
/**
 * bot/test/wave5-preview-injection-anchor.test.js
 *
 * renderPreview() injects two scripts into the preview document: the animation
 * forcer and, in edit mode, the whole inline editor (edit-overlay.js). Both
 * used `html.replace('</body>', ...)`, and String.replace with a string pattern
 * rewrites the FIRST match.
 *
 * So a template that merely MENTIONS the closing body tag earlier in the
 * document -- inside an HTML comment, say -- captured the injection. The editor
 * was spliced into that comment and never executed. Every observable symptom
 * pointed somewhere else: the document rendered fine, data-hb-edit attributes
 * were all present, the srcdoc string contained the overlay source, and nothing
 * logged a warning. The template simply had no working inline editor.
 *
 * That is exactly what happened to templates/professionals, where a comment
 * explaining a cookie-banner fix quoted the tag it was talking about. The
 * regression reached main and was caught by a list oracle timing out, not by
 * anything that named the real cause.
 *
 * These checks pin the fix at the mechanism, so no future template can lose its
 * editor by writing a tag name in prose.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-preview-injection-anchor.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const GEN = path.join(ROOT, 'builder', 'generated');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

function loadEngine() {
    const sandbox = { window: {}, console, document: { addEventListener() {} } };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(GEN, 'engine.js'), 'utf8'), sandbox, { filename: 'engine.js' });
    return sandbox;
}

function heavyFor(sandbox, id) {
    vm.runInContext(fs.readFileSync(path.join(GEN, 'templates', id + '.js'), 'utf8'), sandbox, { filename: id + '.js' });
    return sandbox.window.HIDOOK_TEMPLATE_HEAVY[id];
}

function firstPresetConfig(id) {
    return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, id, 'presets.json'), 'utf8')).presets[0].config;
}

/** Is `index` inside an HTML comment in `html`? */
function insideComment(html, index) {
    const open = html.lastIndexOf('<!--', index);
    if (open === -1) return false;
    const close = html.indexOf('-->', open);
    return close === -1 || close > index;
}

const TEMPLATE_IDS = fs
    .readdirSync(TEMPLATES_DIR)
    .filter((d) => fs.existsSync(path.join(TEMPLATES_DIR, d, 'template.html')));

test('every template gets a live edit overlay, not one buried in a comment', () => {
    const sandbox = loadEngine();
    for (const id of TEMPLATE_IDS) {
        const html = sandbox.window.HidookEngine.renderPreview(
            heavyFor(sandbox, id).files, firstPresetConfig(id), { editMode: true }
        );
        const at = html.indexOf('<script data-hidook-edit-overlay>');
        assert.notStrictEqual(at, -1, id + ': the edit overlay script tag is missing entirely');
        assert.ok(!insideComment(html, at),
            id + ': the edit overlay was injected INSIDE an HTML comment -- inline editing is dead on this template');

        const forcerAt = html.indexOf('<script data-hidook-forcer>');
        assert.notStrictEqual(forcerAt, -1, id + ': the animation forcer script tag is missing entirely');
        assert.ok(!insideComment(html, forcerAt), id + ': the animation forcer was injected inside an HTML comment');
    }
});

test('a template that quotes the closing body tag in prose still gets its editor', () => {
    const sandbox = loadEngine();
    const id = TEMPLATE_IDS[0];
    const heavy = heavyFor(sandbox, id);

    // The exact shape of the regression: prose near the top of the document
    // that happens to contain the tag the injector anchors on.
    const files = Object.assign({}, heavy.files, {
        templateHtml: heavy.files.templateHtml.replace(
            /<body([^>]*)>/i,
            '<body$1>\n<!-- the banner used to mount just before </body>, which caused a layout shift -->'
        ),
    });
    assert.match(files.templateHtml, /<!-- the banner used to mount/, 'fixture must actually apply');

    const html = sandbox.window.HidookEngine.renderPreview(files, firstPresetConfig(id), { editMode: true });
    const at = html.indexOf('<script data-hidook-edit-overlay>');
    assert.notStrictEqual(at, -1, 'overlay must still be injected');
    assert.ok(!insideComment(html, at),
        'the injector anchored on the first closing-body tag it found, which was inside a comment');
});

test('the injector anchors on the LAST closing body tag', () => {
    // Guards the mechanism directly, so a refactor cannot quietly reintroduce
    // first-match semantics even if no shipped template currently trips it.
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-builder.js'), 'utf8');
    const previewRegion = src.slice(src.indexOf('function renderPreview('), src.indexOf('function renderHtmlFile') + 1 || undefined);
    assert.doesNotMatch(previewRegion, /html\.replace\(\s*['"]<\/body>['"]/,
        'renderPreview must not use a first-match string replace on the closing body tag');
    assert.match(src, /function insertBeforeBodyClose/, 'the last-match insertion helper must exist');
    assert.match(src, /lastIndexOf\(tag\)/, 'the helper must anchor on the last occurrence');
});
