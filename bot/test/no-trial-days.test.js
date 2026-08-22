'use strict';
/**
 * bot/test/no-trial-days.test.js — S28/S29: no TRIAL_DAYS surface; trials module gone.
 *
 * Pay-before-publish: no public unpaid trial length constant. After S29 the
 * leftover trials.js module is removed entirely — assert absence (no TRIAL_DAYS
 * export path remains).
 *
 * Run: node bot/test/no-trial-days.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const trialsPath = path.join(__dirname, '..', 'trials.js');

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

check('bot/trials.js must not exist (no TRIAL_DAYS export surface)', () => {
    assert.ok(
        !fs.existsSync(trialsPath),
        'bot/trials.js must not exist — TRIAL_DAYS and trial-length exports are not product'
    );
});

check('require(trials.js) must fail (module absent)', () => {
    let err = null;
    try {
        require('../trials.js');
    } catch (e) {
        err = e;
    }
    assert.ok(err, 'require(\"../trials.js\") must throw when module is removed');
    assert.ok(
        err.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(err.message)),
        'expected MODULE_NOT_FOUND, got: ' + (err && err.message)
    );
});

if (failed) {
    console.error('\nno-trial-days: FAILED');
    process.exit(1);
}
console.log('\nno-trial-days: OK');
process.exit(0);
