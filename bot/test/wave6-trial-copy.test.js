'use strict';
/**
 * bot/test/wave6-trial-copy.test.js — Wave 6 opened builder chrome matches
 * card → 7-day trial → live now (not pay-once).
 *
 * VISION 2026-08-26: stranger adds a valid card → 7-day trial starts → site
 * goes live immediately → Stripe auto-charges on day 7 unless cancelled.
 *
 * Causal RED on parent Wave 5 SHA (pay-once leftover strings).
 * HEAD GREEN: no pay-once / live-only-after-payment; trial flow stated.
 *
 * Run: node bot/test/wave6-trial-copy.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'ffdde1fd141aa034f762a546474901c035c97653';
const BUILDER_HTML = path.join(ROOT, 'builder', 'index.html');

let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
    }
}

function parentBlob(rel) {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
}

function headRead(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Pay-once / live-only-after-payment leftovers strangers would notice. */
const PAY_ONCE_LEFTOVERS = [
    /pay\s+once/i,
    /goes\s+live\s+right\s+after\s+payment/i,
    /live\s+only\s+after\s+payment/i,
    /goes\s+live\s+once\s+you\s+pay/i,
    /Pay\s+first/i,
];

function assertNoPayOnce(src, label) {
    for (const re of PAY_ONCE_LEFTOVERS) {
        assert.ok(!re.test(src), `${label}: leftover pay-once chrome matched ${re}`);
    }
}

function assertTrialFlow(src, label) {
    // card → trial de 7 zile → live imediat → taxare ziua 7 dacă nu anulezi (VISION RO)
    assert.ok(/\bcard\b/i.test(src), `${label}: must mention card`);
    assert.ok(
        /7[\s-]*day\s+trial|trial(?:ul)?\s+de\s+7\s+zile|7\s*zile/i.test(src),
        `${label}: must state trial 7 zile`
    );
    assert.ok(
        /goes\s+live\s+(now|immediately)|live\s+now|live\s+imediat|site-ul e live imediat|e live imediat/i.test(src),
        `${label}: must state site goes live now/immediately`
    );
    assert.ok(
        (/day\s+7|on\s+day\s+7|ziua\s+7/i.test(src)) && /cancel|anulez/i.test(src),
        `${label}: must state charge on day 7 unless cancelled`
    );
    assert.ok(
        /charge|charged|auto-?charge|taxăm|taxat|taxare/i.test(src),
        `${label}: must state charge timing`
    );
}

// ── Causal RED on parent Wave 5 ──────────────────────────────────────────
check(`parent ${PARENT_SHA.slice(0, 7)} builder still sells pay-once / live-after-payment`, () => {
    const html = parentBlob('builder/index.html');
    assert.ok(/Pay once and your site goes live/i.test(html), 'parent hero pay-once');
    assert.ok(/goes live right after payment/i.test(html), 'parent proof live-after-payment');
    assert.ok(/Pay once, then publish/i.test(html), 'parent how-step / footer pay-once');
    assert.ok(!/7[\s-]*day\s+trial/i.test(html), 'parent must not already claim 7-day trial');
});

// ── HEAD GREEN ───────────────────────────────────────────────────────────
check('HEAD builder/index.html has no pay-once / live-only-after-payment leftovers', () => {
    const html = headRead('builder/index.html');
    assertNoPayOnce(html, 'HEAD builder');
});

check('HEAD builder landing states card → trial 7 zile → live imediat → taxare ziua 7 dacă nu anulezi', () => {
    const html = headRead('builder/index.html');
    assertTrialFlow(html, 'HEAD builder');
    // Hero / how-step / footer are the opened landing surface
    const hero = html.match(/id=["']hero-sub["'][\s\S]*?<\/p>/i);
    assert.ok(hero, 'hero-sub present');
    assert.ok(/7[\s-]*day\s+trial|trial(?:ul)?\s+de\s+7\s+zile|7\s*zile/i.test(hero[0]), 'hero states trial 7 zile');
    assert.ok(!/pay\s+once/i.test(hero[0]), 'hero must not say pay once');

    const how = html.match(/id=["']cum-e["'][\s\S]*?<\/section>/i) || html.match(/how-section[\s\S]*?<\/section>/i);
    assert.ok(how, 'how section');
    const step03 = how[0].match(/how-step-num">03[\s\S]*?<\/article>/i);
    assert.ok(step03, 'how-step 03');
    assert.ok(/7[\s-]*day\s+trial|trial|7\s*zile/i.test(step03[0]), 'step 03 trial');
    assert.ok(!/pay\s+once/i.test(step03[0]), 'step 03 no pay once');

    const footer = html.match(/landing-footer[\s\S]*?<\/footer>/i);
    assert.ok(footer, 'landing footer');
    assert.ok(!/pay\s+once/i.test(footer[0]), 'footer no pay once');
});

check('HEAD builder keeps Hidook Site Builder; no DESSERD / factory / free-trial countdown ids', () => {
    const html = headRead('builder/index.html');
    assert.ok(/Hidook Site Builder/.test(html), 'product name');
    assert.ok(!/\bDESSERD\b/i.test(html) && !/desserdina/i.test(html), 'no DESSERD');
    assert.ok(!/\bid\s*=\s*["']trial-countdown["']/.test(html), 'no trial-countdown id');
    assert.ok(!/keep-site|btn-keep-site/i.test(html), 'no keep-site');
    assert.ok(!/3 zile gratuite|publici GRATUIT/i.test(html), 'no free-trial RO promises');
});

check('HEAD Instagram pre-trial copy (not before you pay)', () => {
    const html = headRead('builder/index.html');
    assert.ok(
        /înainte\s+să\s+începi\s+trialul|before\s+you\s+start\s+the\s+trial/i.test(html),
        'Instagram may connect before trial starts'
    );
    assert.ok(!/before you pay/i.test(html), 'no leftover before you pay');
});

if (failed) {
    console.error('\nwave6-trial-copy.test.js: FAILED (' + failed + ')');
    process.exit(1);
}
console.log('\nwave6-trial-copy.test.js: all passed');
process.exit(0);
