'use strict';
/**
 * bot/test/no-trialendsat-comment.test.js — S31 shipped builder JS must not mention trialEndsAt.
 *
 * Pay-before-publish: leftover trial-clock field names must not ship in commercial
 * builder source the browser downloads (comment or code).
 *
 * Run: node bot/test/no-trialendsat-comment.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');

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

const app = fs.readFileSync(APP_JS, 'utf8');

check('builder/app.js must not contain trialEndsAt (comment or code)', () => {
    assert.ok(
        !/\btrialEndsAt\b/.test(app),
        'builder/app.js must not mention trialEndsAt (leftover trial-clock jargon)'
    );
});

if (failed) {
    console.error('\nno-trialendsat-comment: FAILED');
    process.exit(1);
}
console.log('\nno-trialendsat-comment: OK');
process.exit(0);
