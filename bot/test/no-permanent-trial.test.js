'use strict';
/**
 * bot/test/no-permanent-trial.test.js — S25/S29: no permanent-hosting trial module.
 *
 * Pay-before-publish: leftover trial sweeper/module is removed (S29). Assert
 * bot/trials.js is absent so permanent-hosting / trial-expired copy and
 * sweepTrials cannot ship from that path.
 *
 * Run: node bot/test/no-permanent-trial.test.js
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

check('bot/trials.js must not exist (no permanent-hosting / sweep surface)', () => {
    assert.ok(
        !fs.existsSync(trialsPath),
        'bot/trials.js must not exist — no trial sweeper or permanent-hosting copy path'
    );
});

check('require(trials.js) / sweepTrials must be unavailable', () => {
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
    console.error('\nno-permanent-trial: FAILED');
    process.exit(1);
}
console.log('\nno-permanent-trial: OK');
process.exit(0);
