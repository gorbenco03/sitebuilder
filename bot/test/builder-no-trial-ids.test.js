'use strict';
/**
 * bot/test/builder-no-trial-ids.test.js — S14 builder must not keep trial-* / keep-site ids.
 *
 * Invariant: commercial builder DOM/CSS/JS selectors use pay/publish vocabulary.
 * Forbidden: trial-bullet*, btn-keep-site, status-trial (id, class, or $('…')).
 * Allowed renames: publish-plan, publish-price, publish-renewal, btn-pay-publish, status-unpaid.
 * Visible copy: trial-card CTA (VISION 2026-08-26), not pay-once Pay and publish.
 *
 * Run: node bot/test/builder-no-trial-ids.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const APP_CSS = path.join(ROOT, 'builder', 'app.css');

let failed = false;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

const app = fs.readFileSync(APP_JS, 'utf8');
const html = fs.readFileSync(INDEX_HTML, 'utf8');
const css = fs.existsSync(APP_CSS) ? fs.readFileSync(APP_CSS, 'utf8') : '';
const combined = app + '\n' + html + '\n' + css;

const FORBIDDEN = [
    'trial-bullet',
    'trial-bullets',
    'btn-keep-site',
    'status-trial',
];

check('builder sources exist', () => {
    assert.ok(app.length > 100, 'builder/app.js must exist');
    assert.ok(html.length > 100, 'builder/index.html must exist');
});

check('no trial-bullet / trial-bullets / btn-keep-site / status-trial identifiers', () => {
    for (const token of FORBIDDEN) {
        assert.ok(
            !combined.includes(token),
            'builder must not contain identifier token: ' + token
        );
    }
});

check('no $(' + "'…'" + ') selectors for forbidden trial/keep-site ids', () => {
    const forbiddenSelectors = [
        /\$\(\s*['"]trial-bullet-price['"]\s*\)/,
        /\$\(\s*['"]trial-bullet-renewal['"]\s*\)/,
        /\$\(\s*['"]btn-keep-site['"]\s*\)/,
        /\$\(\s*['"]trial-bullets['"]\s*\)/,
    ];
    for (const re of forbiddenSelectors) {
        assert.ok(!re.test(app), 'app.js must not look up via $(): ' + re);
    }
});

check('pay/publish vocabulary is wired (renamed hooks present)', () => {
    assert.ok(
        /\bid\s*=\s*["']publish-price["']/.test(html) || /\$\(\s*['"]publish-price['"]\s*\)/.test(app),
        'publish-price id/selector required'
    );
    assert.ok(
        /\bid\s*=\s*["']publish-renewal["']/.test(html) || /\$\(\s*['"]publish-renewal['"]\s*\)/.test(app),
        'publish-renewal id/selector required'
    );
    assert.ok(
        /class\s*=\s*["'][^"']*\bpublish-plan\b/.test(html) || /\.publish-plan\b/.test(css),
        'publish-plan class required'
    );
    assert.ok(
        /\bid\s*=\s*["']btn-pay-publish["']/.test(html) || /\$\(\s*['"]btn-pay-publish['"]\s*\)/.test(app),
        'btn-pay-publish id/selector required'
    );
    assert.ok(
        /status-unpaid/.test(app) || /\.status-unpaid\b/.test(css),
        'status-unpaid class required for unpaid badge'
    );
});

check('visible trial-card publish copy preserved', () => {
    assert.ok(/Unpaid/.test(app) || /Unpaid/.test(html), 'unpaid badge label Unpaid required');
    assert.ok(
        /12 months hosting|first publish|7-day trial/i.test(html),
        'publish plan must keep hosting or trial copy'
    );
    assert.ok(
        /renewal|\/year/i.test(html),
        'renewal /year copy must remain on publish plan'
    );
    assert.ok(
        /Add a card — start 7-day trial/.test(html) ||
            /Add a card — start 7-day trial/.test(app),
        'pay CTA must say Add a card — start 7-day trial'
    );
    assert.ok(
        !/Pay and publish/.test(html) && !/Pay and publish/.test(app),
        'must not keep pay-once Pay and publish'
    );
});

check('do not reintroduce trial countdown / free-trial / Păstrează unpaid CTA', () => {
    assert.ok(!/\bid\s*=\s*["']trial-countdown["']/.test(html), 'no #trial-countdown');
    assert.ok(!/expiră în/i.test(combined), 'no expiră în countdown copy');
    assert.ok(!/3 zile gratuite/i.test(combined), 'no 3 zile gratuite');
    assert.ok(!/>\s*Păstrează\s*</.test(html), 'no Păstrează unpaid CTA label');
});

process.exit(failed ? 1 : 0);
