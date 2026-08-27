'use strict';
/**
 * bot/test/builder-publish-product-name.test.js — S36 publish plan names
 * Hidook Site Builder.
 *
 * PRODUCT: public name is Hidook Site Builder. The first publish-plan step
 * in builder/index.html must name that product — not generic "platforma
 * Hidook". S35 chrome (title + logo) must remain.
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

/** First visible text span inside .publish-plan > li (skip icon spans). */
function firstPublishPlanStepText(html) {
    const block = html.match(/class=\"publish-plan\"[^>]*>([\s\S]*?)<\/ul>/i);
    assert.ok(block, 'publish-plan <ul> required');
    const firstLi = block[1].match(/<li>([\s\S]*?)<\/li>/i);
    assert.ok(firstLi, 'publish-plan must have at least one <li>');
    const visible = [...firstLi[1].matchAll(/<span([^>]*)>([^<]*)<\/span>/gi)]
        .filter((m) => !/aria-hidden/i.test(m[1]) && !/publish-plan-icon/i.test(m[1]))
        .map((m) => m[2].trim())
        .filter(Boolean);
    assert.ok(visible.length >= 1, 'first publish-plan step must have visible text');
    return visible[0];
}

check('first publish-plan step contains exact phrase Hidook Site Builder', () => {
    const text = firstPublishPlanStepText(src);
    assert.ok(
        text.includes('Hidook Site Builder'),
        'first publish-plan step must contain \"Hidook Site Builder\", got: ' + text
    );
});

check('first publish-plan step must not say platforma Hidook', () => {
    const text = firstPublishPlanStepText(src);
    assert.ok(
        !/platforma\s+Hidook/i.test(text),
        'first publish-plan step must not say \"platforma Hidook\", got: ' + text
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

check('builder/index.html states card 7-day trial (not pay-once / keep-site)', () => {
    assert.ok(/7[\s-]*day\s+trial/i.test(src), 'builder must state 7-day trial');
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
