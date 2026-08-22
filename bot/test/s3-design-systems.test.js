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

/** S47 — vertical products: restaurant / salon / trade (not bakery theatre or shared Apple paper). */
check('S47: every system ships instagram.embedUrl iframe markup', () => {
    for (const tid of EXPECTED) {
        const html = fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
        assert.ok(
            html.includes('instagram.embedUrl'),
            `${tid}: missing instagram.embedUrl @if path`
        );
        assert.ok(
            /class="[^"]*instagram-embed-iframe/.test(html) || html.includes('instagram-embed-iframe'),
            `${tid}: missing instagram-embed-iframe class on iframe`
        );
        assert.ok(
            html.includes('instagram.gallery'),
            `${tid}: missing instagram.gallery fallback path`
        );
    }
});

check('S47: no MENU BOARD / chalkboard bakery identity copy', () => {
    const forbidden = [/MENU\s*BOARD/i, /chalkboard/i];
    for (const tid of EXPECTED) {
        const html = fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
        const css = fs.readFileSync(path.join(ROOT, 'templates', tid, 'styles.css'), 'utf8');
        const presets = fs.readFileSync(path.join(ROOT, 'templates', tid, 'presets.json'), 'utf8');
        const blob = `${html}\n${css}\n${presets}`;
        for (const re of forbidden) {
            assert.ok(!re.test(blob), `${tid}: still contains forbidden identity pattern ${re}`);
        }
    }
    const pmPresets = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'product-menu', 'presets.json'), 'utf8')
    );
    for (const p of pmPresets.presets) {
        const name = String(p.name || '') + String(p.config?.business?.name || '');
        const about = String(p.config?.business?.about || '');
        const title = String(p.config?.business?.title || '');
        const blob = `${name} ${about} ${title}`.toLowerCase();
        assert.ok(
            !/cofet[aă]rie|patiserie|pr[aă]jitur|torturi la comand[aă]|dulce de la/i.test(blob),
            `product-menu preset "${p.id}" still bakery/patisserie default persona`
        );
    }
});

check('S47: three systems do not share one identical Apple #f5f5f7 paper token', () => {
    function defaultPaperToken(css) {
        // Prefer --paper, then --color-cream, from the :root block defaults (not comments).
        const root = css.match(/:root\s*\{[\s\S]*?\}/);
        assert.ok(root, 'missing :root block');
        const block = root[0];
        const paper = block.match(/--paper\s*:\s*([^;]+);/i);
        const cream = block.match(/--color-cream\s*:\s*([^;]+);/i);
        const raw = (paper && paper[1]) || (cream && cream[1]);
        assert.ok(raw, 'missing --paper / --color-cream default');
        return raw.trim().toLowerCase().replace(/\s+/g, '');
    }
    const papers = {};
    for (const tid of EXPECTED) {
        const css = fs.readFileSync(path.join(ROOT, 'templates', tid, 'styles.css'), 'utf8');
        papers[tid] = defaultPaperToken(css);
        console.log(`  ${tid} paper=${papers[tid]}`);
    }
    const vals = Object.values(papers);
    const allSame = vals.every((v) => v === vals[0]);
    assert.ok(!allSame, `all three systems share the same paper token ${vals[0]}`);
    const apple = '#f5f5f7';
    const appleCount = vals.filter((v) => v === apple).length;
    assert.ok(
        appleCount < 3,
        'all three systems still default to Apple paper #f5f5f7'
    );
});

check('S47: renderHtml resolves presets with embedUrl when present', () => {
    const { renderHtml } = require('../../build.js');
    for (const tid of EXPECTED) {
        const dir = path.join(ROOT, 'templates', tid);
        const presets = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets;
        const tpl = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
        const cfg = JSON.parse(JSON.stringify(presets[0].config));
        if (!cfg.instagram) cfg.instagram = {};
        if (!cfg.instagram.handle) cfg.instagram.handle = 'demo.handle';
        if (!cfg.instagram.url) cfg.instagram.url = 'https://www.instagram.com/demo.handle';
        cfg.instagram.embedUrl = 'https://example.com/embed/demo';
        if (!cfg.instagram.gallery || !cfg.instagram.gallery.length) {
            cfg.instagram.gallery = ['https://picsum.photos/seed/s47-ig/600/600'];
        }
        const html = renderHtml(tpl, cfg);
        assert.ok(!html.includes('{{'), `${tid}: unresolved tokens with embedUrl`);
        assert.ok(
            html.includes('https://example.com/embed/demo'),
            `${tid}: embedUrl not rendered into iframe src`
        );
        assert.ok(html.includes('instagram-embed-iframe'), `${tid}: embed iframe class missing in output`);
    }
});

if (failed) {
    console.error('\ns3-design-systems.test.js: FAILED');
    process.exit(1);
}
console.log('\ns3-design-systems.test.js: all passed');
