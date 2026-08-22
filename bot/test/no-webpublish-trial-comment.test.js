'use strict';
/**
 * bot/test/no-webpublish-trial-comment.test.js — S33 webpublish.js must not name
 * leftover unpaid-trial expiry wording.
 *
 * PRODUCT: payment before first public publish; no public unpaid trial.
 * Yearly hosting status === 'expired' / deployPlaceholder may remain; comments
 * must not call that path an unpaid trial.
 *
 * Run: node bot/test/no-webpublish-trial-comment.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WEBPUBLISH = path.join(ROOT, 'bot', 'webpublish.js');

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

const src = fs.readFileSync(WEBPUBLISH, 'utf8');

check('bot/webpublish.js must not contain unpaid-trial (comment or code)', () => {
    assert.ok(
        !/unpaid-trial/i.test(src),
        'bot/webpublish.js must not mention unpaid-trial (leftover unpaid-trial jargon)'
    );
});

check('bot/webpublish.js must not contain "trial expiry" (comment or code)', () => {
    assert.ok(
        !/trial\s+expiry/i.test(src),
        'bot/webpublish.js must not mention trial expiry (leftover unpaid-trial jargon)'
    );
});

check('bot/webpublish.js must not contain trial-expired (comment or code)', () => {
    assert.ok(
        !/trial-expired/i.test(src),
        'bot/webpublish.js must not mention trial-expired (leftover unpaid-trial jargon)'
    );
});

check('bot/webpublish.js must not contain "expired trial" (comment or code)', () => {
    assert.ok(
        !/expired\s+trial/i.test(src),
        'bot/webpublish.js must not mention expired trial (leftover unpaid-trial jargon)'
    );
});

if (failed) {
    console.error('\nno-webpublish-trial-comment: FAILED');
    process.exit(1);
}
console.log('\nno-webpublish-trial-comment: OK');
process.exit(0);
