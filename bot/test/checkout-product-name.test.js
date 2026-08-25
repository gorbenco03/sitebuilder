'use strict';
/**
 * bot/test/checkout-product-name.test.js — S38 web checkout names
 * Hidook Site Builder.
 *
 * PRODUCT: public name is Hidook Site Builder. Strangers who pay on the
 * web path see Stripe checkout productName on the pay page. Every
 * productName string literal in bot/server.js must use the full product
 * name, not bare "Hidook".
 *
 * Run: node bot/test/checkout-product-name.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSrcPath = path.join(__dirname, '..', 'server.js');
const serverSrc = fs.readFileSync(serverSrcPath, 'utf8');

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
 * Collect checkout productName string literals from server.js.
 * Matches:
 *   productName = isRenewal ? '...' : '...'
 *   productName: '...'
 */
function extractCheckoutProductNames(src) {
    const names = [];
    // Ternary assignment in handleSiteCheckout
    const tern = src.match(
        /const\s+productName\s*=\s*isRenewal\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/
    );
    assert.ok(
        tern,
        'server.js must assign productName via isRenewal ? \'...\' : \'...\''
    );
    names.push(tern[1], tern[2]);

    // Inline object property productName: '...'
    const propRe = /productName\s*:\s*'([^']*)'/g;
    let m;
    while ((m = propRe.exec(src)) !== null) {
        names.push(m[1]);
    }

    assert.ok(
        names.length >= 3,
        'expected at least 3 checkout productName literals, got ' + names.length
    );
    return names;
}

check('every checkout productName contains exact phrase Hidook Site Builder', () => {
    const names = extractCheckoutProductNames(serverSrc);
    for (const name of names) {
        assert.ok(
            name.includes('Hidook Site Builder'),
            'productName must contain exact phrase "Hidook Site Builder", got: ' + name
        );
    }
});

check('checkout productNames are not bare Hidook without Site Builder', () => {
    const names = extractCheckoutProductNames(serverSrc);
    for (const name of names) {
        assert.ok(
            /Hidook Site Builder/.test(name),
            'productName must not say only generic Hidook without Site Builder, got: ' + name
        );
        // Reject legacy bare titles used before S38
        assert.ok(
            name !== 'Activare site Hidook',
            'must not use bare Activare site Hidook'
        );
        assert.ok(
            name !== 'Reînnoire hosting Hidook (12 luni)',
            'must not use bare Reînnoire hosting Hidook (12 luni)'
        );
    }
});

check('server.js checkout productNames must not introduce DESSERD / desserdina / trial / keep-site', () => {
    const names = extractCheckoutProductNames(serverSrc);
    const blob = names.join('\n');
    assert.ok(!/\bDESSERD\b/i.test(blob), 'must not contain DESSERD');
    assert.ok(!/desserdina/i.test(blob), 'must not contain desserdina');
    assert.ok(!/\btrial\b/i.test(blob), 'must not introduce trial copy');
    assert.ok(!/keep-site|keep site/i.test(blob), 'must not introduce keep-site copy');
});

check('renewal productName still indicates 12-month hosting renewal', () => {
    const names = extractCheckoutProductNames(serverSrc);
    const renewal = names.find((n) => /renewal/i.test(n) || /12\s*months/i.test(n));
    assert.ok(renewal, 'must still have a renewal productName');
    assert.ok(
        /Hidook Site Builder/.test(renewal),
        'renewal productName must name Hidook Site Builder, got: ' + renewal
    );
    assert.ok(
        /12\s*months/i.test(renewal),
        'renewal productName must still mention 12 months, got: ' + renewal
    );
});

check('publish/activation productName still indicates site activation', () => {
    const names = extractCheckoutProductNames(serverSrc);
    const publish = names.filter((n) => /activation/i.test(n));
    assert.ok(publish.length >= 1, 'must still have activation productName(s)');
    for (const name of publish) {
        assert.ok(
            /Hidook Site Builder/.test(name),
            'activation productName must name Hidook Site Builder, got: ' + name
        );
    }
});

if (failed) {
    console.error('\ncheckout-product-name.test.js: FAILED');
    process.exit(1);
}
console.log('\ncheckout-product-name.test.js: all passed');
process.exit(0);
