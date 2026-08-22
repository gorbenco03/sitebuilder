'use strict';
/**
 * bot/test/telegram-checkout-product-name.test.js — S39 leftover Telegram
 * checkout names Hidook Site Builder.
 *
 * PRODUCT: public name is Hidook Site Builder. The legacy _initiatePayment
 * helper in bot/flow.js still builds a Stripe checkout productName if ever
 * reached. That literal must use the full product name, not "Site web hidook".
 *
 * Telegram remains draft-intake only — this test does not revive commerce
 * from /start; it only guards the leftover string.
 *
 * Run: node bot/test/telegram-checkout-product-name.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const flowSrcPath = path.join(__dirname, '..', 'flow.js');
const flowSrc = fs.readFileSync(flowSrcPath, 'utf8');

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

/**
 * Extract productName string literal from leftover _initiatePayment in flow.js.
 * Matches: const productName = '...';
 * Prefer the assignment inside _initiatePayment when present.
 */
function extractTelegramCheckoutProductName(src) {
    const fnMatch = src.match(
        /async function _initiatePayment\s*\([\s\S]*?\n\}/
    );
    const scope = fnMatch ? fnMatch[0] : src;
    const m = scope.match(/const\s+productName\s*=\s*'([^']*)'/);
    assert.ok(
        m,
        'flow.js _initiatePayment must assign const productName = \'...\''
    );
    return m[1];
}

check('leftover _initiatePayment productName contains exact phrase Hidook Site Builder', () => {
    const name = extractTelegramCheckoutProductName(flowSrc);
    assert.ok(
        name.includes('Hidook Site Builder'),
        'productName must contain exact phrase "Hidook Site Builder", got: ' + name
    );
});

check('leftover productName is not Site web hidook or bare Hidook without Site Builder', () => {
    const name = extractTelegramCheckoutProductName(flowSrc);
    assert.ok(
        name !== 'Site web hidook',
        'must not remain "Site web hidook"'
    );
    assert.ok(
        /Hidook Site Builder/.test(name),
        'productName must not say only generic Hidook without Site Builder, got: ' + name
    );
});

check('leftover productName must not introduce DESSERD / desserdina / trial / keep-site', () => {
    const name = extractTelegramCheckoutProductName(flowSrc);
    assert.ok(!/\bDESSERD\b/i.test(name), 'must not contain DESSERD');
    assert.ok(!/desserdina/i.test(name), 'must not contain desserdina');
    assert.ok(!/\btrial\b/i.test(name), 'must not introduce trial copy');
    assert.ok(!/keep-site|keep site/i.test(name), 'must not introduce keep-site copy');
});

check('_initiatePayment remains a legacy helper (not new Telegram commerce path)', () => {
    assert.ok(
        /async function _initiatePayment\s*\(/.test(flowSrc),
        'legacy _initiatePayment helper must still exist'
    );
    // Comment marker from pay-before-publish era
    assert.ok(
        /LEGACY/i.test(flowSrc) || /before pay-before-publish/i.test(flowSrc),
        'helper should remain marked as legacy'
    );
});

if (failed) {
    console.error('\ntelegram-checkout-product-name.test.js: FAILED');
    process.exit(1);
}
console.log('\ntelegram-checkout-product-name.test.js: all passed');
process.exit(0);
