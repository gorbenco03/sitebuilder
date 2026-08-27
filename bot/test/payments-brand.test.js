'use strict';
/**
 * Test: payments.js self-test/example copy is Hidook + current 99-unit price,
 * never DESSERD or stale 2999 example amounts.
 * Run:  node bot/test/payments-brand.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const paymentsSrcPath = path.join(__dirname, '..', 'payments.js');
const paymentsSrc = fs.readFileSync(paymentsSrcPath, 'utf8');

let failed = false;
function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                () => { console.log('PASS', name); },
                (e) => { failed = true; console.error('FAIL', name, '-', e.message); }
            );
        }
        console.log('PASS', name);
        return Promise.resolve();
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        return Promise.resolve();
    }
}

/** Extract the require.main self-test block for focused brand checks. */
function selfTestBlock(src) {
    const idx = src.indexOf('if (require.main === module)');
    assert.ok(idx >= 0, 'payments.js must have a require.main self-test block');
    return src.slice(idx);
}

async function run() {
    const selfTest = selfTestBlock(paymentsSrc);

    await check('payments.js self-test must not contain DESSERD / desserd', () => {
        assert.ok(
            !/\bDESSERD\b/i.test(selfTest),
            'self-test copy must not contain DESSERD'
        );
        assert.ok(
            !/desserd/i.test(selfTest),
            'self-test copy must not contain desserd'
        );
    });

    await check('payments.js self-test must not use stale example amount 2999', () => {
        assert.ok(
            !/\b2999\b/.test(selfTest),
            'self-test example must not use amountCents 2999'
        );
    });

    await check('payments.js self-test example uses Hidook product name', () => {
        assert.ok(
            /Hidook/.test(selfTest),
            'self-test example productName must name Hidook'
        );
        assert.ok(
            /productName:\s*["'][^"']*Hidook[^"']*["']/.test(selfTest) ||
                /productName:\s*["']Hidook[^"']*["']/.test(selfTest) ||
                /"Hidook[^"]*"/.test(selfTest) ||
                /'Hidook[^']*'/.test(selfTest),
            'self-test must show a Hidook productName string in the example'
        );
    });

    await check('payments.js self-test example uses current 99-unit amount (9900 cents)', () => {
        assert.ok(
            /\b9900\b/.test(selfTest),
            'self-test example must use amountCents 9900 (99 major units)'
        );
        assert.ok(
            /amountCents:\s*9900/.test(selfTest),
            'self-test createCheckout example must pass amountCents: 9900'
        );
    });

    await check('payments.js full source has no DESSERD brand in copy', () => {
        assert.ok(
            !/\bDESSERD\b/.test(paymentsSrc),
            'payments.js must not contain the word DESSERD anywhere'
        );
    });

    if (failed) {
        console.error('\npayments-brand.test.js: FAILED');
        process.exit(1);
    }
    console.log('\npayments-brand.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
