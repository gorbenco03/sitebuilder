'use strict';
/**
 * bot/test/builder-no-trial-ids.test.js — S14 builder must not keep trial-* / keep-site ids.
 *
 * Invariant: commercial builder DOM/CSS/JS selectors use pay/publish vocabulary.
 * Forbidden: trial-bullet*, btn-keep-site, status-trial (id, class, or $('…')).
 * Allowed renames: publish-plan, publish-price, publish-renewal, btn-pay-publish, status-unpaid.
 * Visible copy: trial-card CTA (VISION 2026-08-26), not pay-once Pay and publish.
 *
 * Form editor removed 2026-10-28: the publish-modal plan block (publish-price /
 * publish-renewal ids, .publish-plan, #btn-pay-publish) is gone; the pay CTA now
 * lives only on the dashboard site card, so those hooks are no longer required.
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

check('pay vocabulary is wired on the dashboard site card', () => {
    assert.ok(
        /status-unpaid/.test(app) && /\.status-unpaid\b/.test(css),
        'status-unpaid class required for unpaid badge (used by buildSiteCard, styled in app.css)'
    );
    assert.ok(/Neplătit/.test(app), 'unpaid badge label Neplătit required');
});

check('visible trial-card publish copy preserved', () => {
    assert.ok(
        /12 months hosting|first publish|14-day trial|trial de 14 zile|14 zile|primul an/i.test(html),
        'publish plan must keep hosting or trial copy'
    );
    assert.ok(
        /renewal|\/year/i.test(html),
        'renewal /year copy must remain on publish plan'
    );
    assert.ok(
        /Adaugă un card — începe trialul de 14 zile/.test(html) ||
            /Adaugă un card — începe trialul de 14 zile/.test(app),
        'pay CTA must say Adaugă un card — începe trialul de 14 zile'
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
