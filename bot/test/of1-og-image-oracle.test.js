'use strict';
/**
 * OF-1 oracle — social preview images are automatic, never a customer field.
 *
 * Run: node bot/test/of1-og-image-oracle.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '6a393dd7df8c3ec8f8a8b87b676e0b988c0bee3a';
const SYSTEMS = ['professionals', 'local-service', 'portfolio', 'product-menu', 'desserdirina'];
const FIELD_COPY = 'Imagine pentru partajare socială';

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parentBlob(rel) {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
}

function fields(schema) {
    return (schema.sections || []).flatMap((section) => section.fields || []);
}

function heroImage(config) {
    const background = String(config.hero && config.hero.background || '');
    const match = background.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/i);
    return match && (match[1] || match[2] || match[3]);
}

function metaContent(html, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(new RegExp(`<meta\\s+${escaped}\\s+content="([^"]*)"`, 'i'));
    return match && match[1].replace(/&amp;/g, '&');
}

function clearImageCandidates(value, key) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item) => clearImageCandidates(item, key));
        return;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
        if (childKey === 'background' || /^(?:image|imageUrl|photo|logo|src)$/i.test(childKey)) {
            value[childKey] = '';
        } else {
            clearImageCandidates(childValue, childKey);
        }
    }
}

let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (error) {
        failed += 1;
        console.error('FAIL', name, '-', error.message);
    }
}

check('causal RED: base exposes seo.ogImage in every customer schema', () => {
    for (const id of SYSTEMS) {
        const schema = JSON.parse(parentBlob(`templates/${id}/schema.json`));
        assert.ok(fields(schema).some((field) => field.key === 'seo.ogImage'), `${id} base field missing`);
    }
});

check('causal RED: base drops social meta when professionals has hero photo but no pasted URL', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-of1-parent-'));
    const parentBuildPath = path.join(tempDir, 'build.js');
    fs.writeFileSync(parentBuildPath, parentBlob('build.js'), 'utf8');
    const { renderHtml } = require(parentBuildPath);
    const template = parentBlob('templates/professionals/template.html');
    const presets = JSON.parse(parentBlob('templates/professionals/presets.json'));
    const config = JSON.parse(JSON.stringify(presets.presets[0].config));
    delete config.seo.ogImage;
    const expected = heroImage(config);
    assert.ok(expected, 'base fixture needs a hero photo');
    try {
        const html = renderHtml(template, config);
        assert.strictEqual(metaContent(html, 'property="og:image"'), null);
        assert.strictEqual(metaContent(html, 'name="twitter:image"'), null);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

check('customer schemas and drawer expose no social-image URL control', () => {
    for (const id of SYSTEMS) {
        const source = read(`templates/${id}/schema.json`);
        const schema = JSON.parse(source);
        assert.ok(!fields(schema).some((field) => field.key === 'seo.ogImage'), `${id} exposes seo.ogImage`);
        assert.ok(!source.includes(FIELD_COPY), `${id} exposes customer-facing social-image copy`);
    }
    const app = read('builder/app.js');
    assert.match(app, /HIDDEN_DRAWER_KEYS\s*=\s*\[[^\]]*['"]seo\.ogImage['"]/s);
});

check('all systems derive og:image and twitter:image from the current hero photo', () => {
    const { renderHtml } = require(path.join(ROOT, 'build.js'));
    for (const id of SYSTEMS) {
        const template = read(`templates/${id}/template.html`);
        const presets = JSON.parse(read(`templates/${id}/presets.json`));
        for (const preset of presets.presets) {
            const config = JSON.parse(JSON.stringify(preset.config));
            if (!config.seo) config.seo = {};
            config.seo.ogImage = 'https://cms-leftover.invalid/manual.jpg';
            const expected = heroImage(config);
            assert.ok(expected, `${id}/${preset.id} needs a hero image fixture`);
            const html = renderHtml(template, config);
            assert.strictEqual(metaContent(html, 'property="og:image"'), expected, `${id}/${preset.id} og:image`);
            assert.strictEqual(metaContent(html, 'name="twitter:image"'), expected, `${id}/${preset.id} twitter:image`);
            assert.ok(!html.includes('cms-leftover.invalid'), `${id}/${preset.id} kept pasted URL`);
        }
    }
});

check('root sample also derives both social tags from its hero photo', () => {
    const { renderHtml } = require(path.join(ROOT, 'build.js'));
    const config = JSON.parse(read('config.json'));
    const expected = heroImage(config);
    delete config.seo.ogImage;
    const html = renderHtml(read('template.html'), config);
    assert.strictEqual(metaContent(html, 'property="og:image"'), expected);
    assert.strictEqual(metaContent(html, 'name="twitter:image"'), expected);
});

check('templates emit no dead social-image tags when site data has no photo', () => {
    const { renderHtml } = require(path.join(ROOT, 'build.js'));
    for (const rel of ['template.html', ...SYSTEMS.map((id) => `templates/${id}/template.html`)]) {
        const config = rel === 'template.html'
            ? JSON.parse(read('config.json'))
            : JSON.parse(read(rel.replace('template.html', 'presets.json'))).presets[0].config;
        const empty = JSON.parse(JSON.stringify(config));
        clearImageCandidates(empty);
        if (empty.seo) empty.seo.ogImage = 'https://cms-leftover.invalid/manual.jpg';
        const html = renderHtml(read(rel), empty);
        assert.strictEqual(metaContent(html, 'property="og:image"'), null, `${rel} dead og:image`);
        assert.strictEqual(metaContent(html, 'name="twitter:image"'), null, `${rel} dead twitter:image`);
    }
});

if (failed) process.exit(1);
console.log(`\nOF-1 oracle passed (${SYSTEMS.length} systems + root sample).`);
