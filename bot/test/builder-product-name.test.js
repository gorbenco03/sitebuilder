'use strict';
/**
 * bot/test/builder-product-name.test.js — S35 builder chrome names
 * Hidook Site Builder.
 *
 * PRODUCT: public name is Hidook Site Builder. The commercial surface
 * builder/index.html (opened as /app/) must show that name in the tab
 * title, header logo text, and logo aria-label — not only bare "Hidook"
 * or marketing-only Romanian copy without the product name.
 *
 * Run: node bot/test/builder-product-name.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BUILDER_HTML = path.join(ROOT, 'builder', 'index.html');

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

const src = fs.readFileSync(BUILDER_HTML, 'utf8');

check('builder/index.html exists', () => {
    assert.ok(fs.existsSync(BUILDER_HTML), 'builder/index.html must exist');
});

check('document <title> contains exact phrase Hidook Site Builder', () => {
    const m = src.match(/<title>([^<]*)<\/title>/i);
    assert.ok(m, 'builder/index.html must have a <title>');
    const title = m[1];
    assert.ok(
        title.includes('Hidook Site Builder'),
        'title must contain exact phrase "Hidook Site Builder", got: ' + title
    );
});

check('header logo visible span is Hidook Site Builder', () => {
    // Logo link: <a ... class="logo" ...> ... <span class="logo-word">Hidook<span class="logo-word-full"> Site Builder</span></span>
    const logoMatch = src.match(
        /<span class="logo-word">([^<]*)<span class="logo-word-full">([^<]*)<\/span><\/span>/i
    );
    assert.ok(logoMatch, 'builder/index.html must have logo-word span text');
    const label = (logoMatch[1] + logoMatch[2]).trim();
    assert.strictEqual(
        label,
        'Hidook Site Builder',
        'logo <span> must be exactly "Hidook Site Builder", got: ' + label
    );
});

check('header logo aria-label names Hidook Site Builder', () => {
    const m = src.match(/class="logo"[^>]*aria-label="([^"]*)"/i)
        || src.match(/aria-label="([^"]*)"[^>]*class="logo"/i);
    assert.ok(m, 'logo link must have aria-label');
    const aria = m[1];
    assert.ok(
        aria.includes('Hidook Site Builder'),
        'logo aria-label must name Hidook Site Builder, got: ' + aria
    );
});

check('builder/index.html must not introduce DESSERD / desserdina', () => {
    assert.ok(
        !/\bDESSERD\b/i.test(src) && !/desserdina/i.test(src),
        'builder chrome must not name DESSERD/desserdina'
    );
});

check('builder/index.html states card 7-day trial (not pay-once / keep-site)', () => {
    assert.ok(/7[\s-]*day\s+trial/i.test(src), 'builder chrome must state 7-day trial');
    assert.ok(!/pay\s+once/i.test(src), 'builder chrome must not say pay once');
    assert.ok(
        !/keep-site|keep site/i.test(src),
        'builder chrome must not introduce keep-site copy'
    );
    assert.ok(
        !/\bid\s*=\s*["']trial-countdown["']/.test(src),
        'builder must not reintroduce unpaid trial-countdown chrome'
    );
});

if (failed) {
    console.error('\nbuilder-product-name: FAILED');
    process.exit(1);
}
console.log('\nbuilder-product-name: OK');
process.exit(0);
