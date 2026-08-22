'use strict';
/**
 * bot/test/no-trial-time-css.test.js — S30 builder CSS must not ship .trial-time chrome.
 *
 * Pay-before-publish: leftover trial-clock styling must not ship in the commercial
 * builder. Renewal .status-expired badges are unrelated and must remain.
 *
 * Run: node bot/test/no-trial-time-css.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const APP_CSS = path.join(ROOT, 'builder', 'app.css');

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

const css = fs.readFileSync(APP_CSS, 'utf8');

check('builder/app.css must not define a .trial-time selector', () => {
    assert.ok(
        !/\.trial-time\b/.test(css),
        'builder/app.css must not contain a .trial-time class rule'
    );
    assert.ok(
        !/\btrial-time\b/.test(css),
        'builder/app.css must not mention trial-time at all'
    );
});

check('builder/app.css keeps non-trial .status-expired renewal badge', () => {
    assert.ok(
        /\.status-expired\b/.test(css),
        'builder/app.css must keep .status-expired (yearly hosting expiry, not unpaid trial)'
    );
});

if (failed) {
    console.error('\nno-trial-time-css: FAILED');
    process.exit(1);
}
console.log('\nno-trial-time-css: OK');
process.exit(0);
