'use strict';
/**
 * bot/test/builder-publish-product-name.test.js — S36 publish plan names
 * Hidook Site Builder.
 *
 * PRODUCT: public name is Hidook Site Builder. The first publish-plan step
 * in builder/index.html must name that product — not generic "platforma
 * Hidook". S35 chrome (title + logo) must remain.
 *
 * Form editor removed 2026-10-28: the publish modal's plan list (step 1) is
 * gone, so the two checks on its first step were replaced by one that scans
 * the whole of index.html for the generic "platforma Hidook" wording.
 *
 * Run: node bot/test/builder-publish-product-name.test.js
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

check('no builder/index.html surface says platforma Hidook (product is Hidook Site Builder)', () => {
    assert.ok(
        !/platforma\s+Hidook/i.test(src),
        'builder/index.html must not say \"platforma Hidook\"'
    );
});

check('S35 chrome: document <title> still names Hidook Site Builder', () => {
    const m = src.match(/<title>([^<]*)<\/title>/i);
    assert.ok(m, 'builder/index.html must have a <title>');
    assert.ok(
        m[1].includes('Hidook Site Builder'),
        'title must contain \"Hidook Site Builder\", got: ' + m[1]
    );
});

check('S35 chrome: logo span still exactly Hidook Site Builder', () => {
    const logoMatch = src.match(
        /<span class=\"logo-word\">([^<]*)<span class=\"logo-word-full\">([^<]*)<\/span><\/span>/i
    );
    assert.ok(logoMatch, 'builder/index.html must have logo-word span text');
    assert.strictEqual(
        (logoMatch[1] + logoMatch[2]).trim(),
        'Hidook Site Builder',
        'logo <span> must remain exactly \"Hidook Site Builder\"'
    );
});

check('builder/index.html must not introduce DESSERD / desserdina', () => {
    assert.ok(
        !/\bDESSERD\b/i.test(src) && !/desserdina/i.test(src),
        'builder must not name DESSERD/desserdina'
    );
});

check('builder/index.html states card 14-day trial (not pay-once / keep-site)', () => {
    assert.ok(/14[\s-]*day\s+trial|trial(?:ul)?\s+de\s+14\s+zile|14\s*zile/i.test(src), 'builder must state trial 14 zile');
    assert.ok(!/pay\s+once/i.test(src), 'builder must not say pay once');
    assert.ok(
        !/keep-site|keep site/i.test(src),
        'builder must not introduce keep-site copy'
    );
    assert.ok(
        !/\bid\s*=\s*["']trial-countdown["']/.test(src),
        'builder must not reintroduce unpaid trial-countdown chrome'
    );
});

if (failed) {
    console.error('\nbuilder-publish-product-name: FAILED');
    process.exit(1);
}
console.log('\nbuilder-publish-product-name: OK');
process.exit(0);
