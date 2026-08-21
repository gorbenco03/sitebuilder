'use strict';
/**
 * S3: commercial catalog is exactly three art-directed systems.
 * Run: node bot/test/s3-design-systems.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EXPECTED = ['product-menu', 'local-service', 'portfolio'];
const REJECTED = ['patiserie', 'constructii', 'servicii', 'beauty', 'evenimente'];

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

check('registry.templates maps to exactly product-menu, local-service, portfolio', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'registry.json'), 'utf8'));
    assert.ok(Array.isArray(reg.templates), 'registry.templates must be an array');
    const ids = reg.templates.map((t) => t.id);
    assert.deepStrictEqual(ids, EXPECTED, `expected ${JSON.stringify(EXPECTED)}, got ${JSON.stringify(ids)}`);
    for (const bad of REJECTED) {
        assert.ok(!ids.includes(bad), `rejected id still listed: ${bad}`);
    }
    assert.strictEqual(reg.templates.length, 3);
});

check('each system folder renders via renderHtml (no unresolved {{, editMode fields)', () => {
    const { renderHtml } = require('../../build.js');
    for (const tid of EXPECTED) {
        const dir = path.join(ROOT, 'templates', tid);
        assert.ok(fs.existsSync(dir), `missing template folder: ${tid}`);
        for (const f of ['template.html', 'styles.css', 'script.js', 'schema.json', 'presets.json']) {
            assert.ok(fs.existsSync(path.join(dir, f)), `${tid} missing ${f}`);
        }
        const presets = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets;
        assert.ok(Array.isArray(presets) && presets.length >= 2, `${tid} needs ≥2 presets`);
        const tpl = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
        const cfg = JSON.parse(JSON.stringify(presets[0].config));
        const html = renderHtml(tpl, cfg);
        assert.ok(!html.includes('{{'), `${tid}: unresolved tokens remain`);
        assert.ok(html.includes(cfg.business.name) || html.toLowerCase().includes(String(cfg.business.name).toLowerCase()),
            `${tid}: business.name not in output`);
        const edit = renderHtml(tpl, cfg, { editMode: true });
        assert.ok(edit.includes('data-hb-edit="business.name"'), `${tid}: missing business.name edit hook`);
        assert.ok(edit.includes('data-hb-edit="services.0.label"'), `${tid}: missing services.0.label edit hook`);
        for (const re of [/<style[^>]*>[\s\S]*?<\/style>/gi, /<script[^>]*>[\s\S]*?<\/script>/gi, /<title>[\s\S]*?<\/title>/gi]) {
            for (const block of edit.match(re) || []) {
                assert.ok(!block.includes('data-hb-edit'), `${tid}: data-hb-edit inside raw block`);
            }
        }
        assert.ok((edit.match(/data-hb-edit=/g) || []).length > 5, `${tid}: too few editable fields`);
    }
});

check('old five template folders are not shipped', () => {
    for (const bad of REJECTED) {
        const p = path.join(ROOT, 'templates', bad);
        assert.ok(!fs.existsSync(p), `old template folder still present: ${bad}`);
    }
});

if (failed) {
    console.error('\ns3-design-systems.test.js: FAILED');
    process.exit(1);
}
console.log('\ns3-design-systems.test.js: all passed');
