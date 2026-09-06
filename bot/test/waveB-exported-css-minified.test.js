'use strict';
/**
 * bot/test/waveB-exported-css-minified.test.js
 *
 * The stylesheet a visitor downloads must be minified — and must still contain
 * every rule the source did.
 *
 * The minifier has existed for a while and ran in exactly one place: the
 * BUILDER's baked preview payload, which is what audit-performance's ceilings
 * watch. The stylesheet copied into the customer's exported and published site
 * was never touched. templates/professionals/styles.css shipped byte-identical
 * to source — 35402 bytes, 36% of it English comments explaining the CSS to
 * whoever maintains it, downloaded by every visitor of every site built from
 * that template. The perf work measured the side nobody loads.
 *
 *   template        source   exported   saved
 *   desserdirina     59087      41584     30%
 *   local-service    20169      15450     23%
 *   portfolio        26865      17304     36%
 *   product-menu     21810      16647     24%
 *   professionals    35402      20568     42%
 *   cookie-banner    13729       9734     29%   (shared, on every site)
 *
 * Size alone is a weak assertion — a minifier that deleted half the rules would
 * pass it happily. So this also checks that every selector in the source
 * survives into the exported file. Rendered-geometry parity was verified
 * separately when this landed: 1261 elements across 5 templates x 2 viewports,
 * identical once animations are frozen (the only differences were a drifting
 * hero mid-animation, 1px on y).
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-exported-css-minified.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')));
}

/** Every rule's prelude — selector list, at-rule or keyframe stop.
 *
 * Both sides are reduced to the SAME canonical shape first (comments gone,
 * every whitespace run a single space) and only then split. An earlier version
 * matched preludes in the raw text and reported keyframe stops — "from", "0%",
 * "0%, 100%" — as deleted rules, because in the source they follow a newline
 * and in the minified file they follow a "{". The rules were all there; the
 * comparison was reading two different shapes. */
function preludes(css) {
    const canonical = String(css)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ');
    const out = new Set();
    for (const m of canonical.matchAll(/(?:^|[{}ـ;])([^{}]+)\{/g)) {
        const sel = m[1].trim();
        if (sel) out.add(sel);
    }
    return out;
}

test('exported stylesheets are minified and keep every rule', () => {
    const failures = [];
    for (const tpl of templates()) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mincss-'));
        try {
            const cfg = JSON.parse(
                fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
            ).presets[0].config;
            siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

            for (const name of ['styles.css', 'cookie-banner.css']) {
                const outPath = path.join(dir, name);
                assert.ok(fs.existsSync(outPath), `${tpl}: exported site is missing ${name}`);
                const exported = fs.readFileSync(outPath, 'utf8');

                if (/\/\*/.test(exported)) {
                    failures.push(`${tpl}/${name}: exported stylesheet still carries CSS comments`);
                }

                if (name === 'styles.css') {
                    const source = fs.readFileSync(path.join(TEMPLATES_DIR, tpl, name), 'utf8');
                    if (exported.length >= source.length) {
                        failures.push(
                            `${tpl}/${name}: exported ${exported.length}b is not smaller than the ` +
                            `${source.length}b source — the minifier did not run on the export path`
                        );
                    }
                    const after = preludes(exported);
                    const lost = [...preludes(source)].filter((s) => !after.has(s));
                    if (lost.length) {
                        failures.push(
                            `${tpl}/${name}: ${lost.length} rule(s) present in the source are missing ` +
                            `from the exported file, e.g. ${JSON.stringify(lost.slice(0, 3))} — ` +
                            `minification must not delete rules`
                        );
                    }
                }
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    assert.deepStrictEqual(failures, [], 'exported CSS problems:\n' + failures.join('\n'));
});
