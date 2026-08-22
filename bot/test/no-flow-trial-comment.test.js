'use strict';
/**
 * bot/test/no-flow-trial-comment.test.js — S34 flow.js must not name
 * leftover trial-expired placeholder wording.
 *
 * PRODUCT: payment before first public publish; no public unpaid trial.
 * GDPR delete marks sites deleted; comments must not describe swapping the
 * live URL for a trial-expired placeholder page.
 * Yearly hosting status === 'expired' elsewhere may remain.
 *
 * Run: node bot/test/no-flow-trial-comment.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FLOW = path.join(ROOT, 'bot', 'flow.js');

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

const src = fs.readFileSync(FLOW, 'utf8');

check('bot/flow.js must not contain trial-expired (comment or code)', () => {
    assert.ok(
        !/trial-expired/i.test(src),
        'bot/flow.js must not mention trial-expired (leftover unpaid-trial jargon)'
    );
});

check('bot/flow.js must not contain unpaid-trial (comment or code)', () => {
    assert.ok(
        !/unpaid-trial/i.test(src),
        'bot/flow.js must not mention unpaid-trial (leftover unpaid-trial jargon)'
    );
});

check('bot/flow.js must not contain "trial expiry" (comment or code)', () => {
    assert.ok(
        !/trial\s+expiry/i.test(src),
        'bot/flow.js must not mention trial expiry (leftover unpaid-trial jargon)'
    );
});

check('bot/flow.js must not contain "expired trial" (comment or code)', () => {
    assert.ok(
        !/expired\s+trial/i.test(src),
        'bot/flow.js must not mention expired trial (leftover unpaid-trial jargon)'
    );
});

if (failed) {
    console.error('\nno-flow-trial-comment: FAILED');
    process.exit(1);
}
console.log('\nno-flow-trial-comment: OK');
process.exit(0);
