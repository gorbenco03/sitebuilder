'use strict';
/**
 * bot/test/builder-pay-ui.test.js — S7 browser builder pay-to-publish UI.
 *
 * Invariant: stranger in /app/ sees unpaid = draft, live = after pay.
 *   - Unpaid dashboard checkout CTA is not trial "Păstrează"
 *   - Unpaid cards do not show trialEndsAt-driven "expiră în" / .trial-time
 *   - showSuccessScreen does not start/reveal a live-trial countdown
 *   - No free-trial / GRATUIT publish promises
 *
 * Run: node bot/test/builder-pay-ui.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');

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
const html = fs.existsSync(INDEX_HTML) ? fs.readFileSync(INDEX_HTML, 'utf8') : '';
const combined = app + '\n' + html;

// Extract buildSiteCard body for precise unpaid-path checks
function extractFunction(src, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i++];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
    }
    return src.slice(m.index, i);
}

const buildSiteCardSrc = extractFunction(app, 'buildSiteCard') || '';
const showSuccessSrc = extractFunction(app, 'showSuccessScreen') || '';

check('buildSiteCard exists', () => {
    assert.ok(buildSiteCardSrc.length > 50, 'buildSiteCard function must exist in builder/app.js');
});

check('unpaid dashboard checkout CTA is not labeled Păstrează', () => {
    // Trial "keep the site" language is forbidden on unpaid checkout button
    assert.ok(
        !/textContent\s*=\s*[^;]*Păstrează/.test(buildSiteCardSrc) &&
            !/['"]Păstrează['"]/.test(buildSiteCardSrc),
        'buildSiteCard must not label unpaid checkout as Păstrează'
    );
    // Trial card CTA (VISION 2026-08-26) — not pay-once Pay and publish
    assert.ok(
        /Add a card — start 7-day trial/.test(buildSiteCardSrc),
        'buildSiteCard unpaid CTA must use trial card verb (Add a card — start 7-day trial)'
    );
    assert.ok(
        !/Pay and publish/.test(buildSiteCardSrc),
        'buildSiteCard must not keep pay-once Pay and publish'
    );
});

check('unpaid draft cards do not show trialEndsAt countdown (.trial-time / expiră în)', () => {
    assert.ok(
        !/\.trial-time/.test(buildSiteCardSrc) && !/trial-time/.test(buildSiteCardSrc),
        'buildSiteCard must not append .trial-time countdown on unpaid cards'
    );
    assert.ok(
        !/expiră în/.test(buildSiteCardSrc),
        'buildSiteCard must not show "expiră în" trial countdown'
    );
    // Must not drive UI from site.trialEndsAt for unpaid draft chrome
    assert.ok(
        !/site\.trialEndsAt/.test(buildSiteCardSrc),
        'buildSiteCard must not read site.trialEndsAt for unpaid card chrome'
    );
});

check('showSuccessScreen does not start or reveal a live-trial countdown', () => {
    assert.ok(showSuccessSrc.length > 50, 'showSuccessScreen must exist');
    // Must not start interval timers or assign countdown text for trial
    assert.ok(
        !/setInterval\s*\(/.test(showSuccessSrc),
        'showSuccessScreen must not start a countdown interval'
    );
    assert.ok(
        !/trial-countdown-text/.test(showSuccessSrc) ||
            !/textContent\s*=/.test(
                (showSuccessSrc.match(/trial-countdown[\s\S]{0,200}/) || [''])[0]
            ),
        'showSuccessScreen must not populate trial countdown text'
    );
    // If trial-countdown element is touched, it must only be hidden — never shown
    if (/trial-countdown/.test(showSuccessSrc)) {
        assert.ok(
            !/\bshow\s*\(\s*countdownEl\s*\)/.test(showSuccessSrc) &&
                !/\bshow\s*\(\s*\$\(\s*['"]trial-countdown['"]\s*\)\s*\)/.test(showSuccessSrc),
            'showSuccessScreen must not reveal #trial-countdown'
        );
    }
    // Unpaid success stays draft + pay CTA when paymentUrl exists — do not claim live before pay
    // (title "Site-ul tău e live!" only when url is http live is OK; must not force live on unpaid)
    assert.ok(
        /Ciorna e salvată|ciornă/i.test(showSuccessSrc) || /draftNote|success-draft-note/.test(showSuccessSrc),
        'showSuccessScreen must keep unpaid path as draft/ciornă'
    );
});

check('builder copy: no free trial / GRATUIT publish / permanent hosting promises', () => {
    assert.ok(!/3 zile gratuite/i.test(combined), 'no "3 zile gratuite"');
    assert.ok(!/publici GRATUIT/i.test(combined), 'no "publici GRATUIT"');
    assert.ok(!/Publicăm site-ul tău GRATUIT/i.test(combined), 'no free publish modal title');
    assert.ok(
        !/păstrează permanent/i.test(combined) && !/păstrezi permanent/i.test(combined),
        'must not promise permanent hosting from one payment'
    );
});

check('success modal pay CTA uses Add a card trial verb (not Păstrează / Pay and publish)', () => {
    const payLabelOk =
        /Add a card — start 7-day trial/.test(html) ||
        /Add a card — start 7-day trial/.test(app);
    assert.ok(payLabelOk, 'success/pay CTA must say Add a card — start 7-day trial');
    assert.ok(!/>\s*Păstrează\s*</.test(html), 'index.html must not label pay button Păstrează');
    assert.ok(!/Pay and publish/.test(html + app), 'no pay-once Pay and publish leftover');
});

process.exit(failed ? 1 : 0);
