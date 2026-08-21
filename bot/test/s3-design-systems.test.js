'use strict';
/**
 * S3: commercial catalog is exactly three art-directed systems.
 * Includes causal anti-clone checks vs pre-S3 DESSERD verticals on cdf1ba2.
 * Run: node bot/test/s3-design-systems.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const EXPECTED = ['product-menu', 'local-service', 'portfolio'];
const REJECTED = ['patiserie', 'constructii', 'servicii', 'beauty', 'evenimente'];

/** Parent accepted before S3; DESSERD-era verticals live here for similarity baselines. */
const BASELINE_REF = 'cdf1ba2b54e8d911d281904fdfd8141344d7ad79';

const CLONE_PAIRS = [
    { id: 'product-menu', baseline: 'patiserie', forbidHex: ['#C8715A', '#FAF6F1', '#4A2C2A'] },
    { id: 'local-service', baseline: 'constructii', forbidHex: [] },
    { id: 'portfolio', baseline: 'beauty', forbidHex: [] },
];

/** Max Jaccard on significant CSS custom-property values and on HTML class names. */
const MAX_SIMILARITY = 0.4;

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

function gitShow(repoPath) {
    return execFileSync('git', ['show', `${BASELINE_REF}:${repoPath}`], {
        encoding: 'utf8',
        cwd: ROOT,
        maxBuffer: 8 * 1024 * 1024,
    });
}

function significantCssPropValues(css) {
    const vals = new Set();
    for (const m of css.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
        const name = m[1].toLowerCase();
        const raw = m[2].trim().toLowerCase().replace(/\s+/g, ' ');
        // Spacing-scale-only tokens are too generic; keep color/font/shadow/radius language.
        if (/^(s\d+|space-)/.test(name)) continue;
        vals.add(`${name}=${raw}`);
    }
    return vals;
}

function htmlClassNames(html) {
    const names = new Set();
    for (const m of html.matchAll(/\bclass\s*=\s*"([^"]+)"/gi)) {
        for (const c of m[1].split(/\s+/)) {
            if (c) names.add(c);
        }
    }
    return names;
}

function jaccard(a, b) {
    const A = a instanceof Set ? a : new Set(a);
    const B = b instanceof Set ? b : new Set(b);
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    const uni = A.size + B.size - inter;
    return uni === 0 ? 0 : inter / uni;
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

check('systems are not DESSERD clones (css prop values + class names < 40%; forbidden brand hex)', () => {
    for (const pair of CLONE_PAIRS) {
        const cssPath = path.join(ROOT, 'templates', pair.id, 'styles.css');
        const htmlPath = path.join(ROOT, 'templates', pair.id, 'template.html');
        const css = fs.readFileSync(cssPath, 'utf8');
        const html = fs.readFileSync(htmlPath, 'utf8');
        const baseCss = gitShow(`templates/${pair.baseline}/styles.css`);
        const baseHtml = gitShow(`templates/${pair.baseline}/template.html`);

        for (const hex of pair.forbidHex) {
            assert.ok(
                !css.toLowerCase().includes(hex.toLowerCase()),
                `${pair.id} CSS still contains forbidden brand token ${hex}`
            );
        }

        const cssSim = jaccard(significantCssPropValues(css), significantCssPropValues(baseCss));
        const clsSim = jaccard(htmlClassNames(html), htmlClassNames(baseHtml));
        assert.ok(
            cssSim < MAX_SIMILARITY,
            `${pair.id} CSS custom-prop similarity to ${pair.baseline} is ${(cssSim * 100).toFixed(1)}% (max ${MAX_SIMILARITY * 100}%)`
        );
        assert.ok(
            clsSim < MAX_SIMILARITY,
            `${pair.id} HTML class-name similarity to ${pair.baseline} is ${(clsSim * 100).toFixed(1)}% (max ${MAX_SIMILARITY * 100}%)`
        );
        console.log(
            `  ${pair.id} vs ${pair.baseline}: cssSim=${cssSim.toFixed(3)} clsSim=${clsSim.toFixed(3)}`
        );
    }
});

if (failed) {
    console.error('\ns3-design-systems.test.js: FAILED');
    process.exit(1);
}
console.log('\ns3-design-systems.test.js: all passed');
