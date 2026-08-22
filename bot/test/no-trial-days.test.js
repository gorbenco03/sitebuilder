'use strict';
/**
 * bot/test/no-trial-days.test.js — S28 trials.js must not export TRIAL_DAYS.
 *
 * Pay-before-publish: no public unpaid trial length constant. The legacy
 * trials module must not define/export TRIAL_DAYS, read process.env.TRIAL_DAYS,
 * or default any trial length to 3 days.
 *
 * Run: node bot/test/no-trial-days.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const trialsPath = path.join(__dirname, '..', 'trials.js');
const trialsSrc = fs.readFileSync(trialsPath, 'utf8');

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

check('trials.js source must not define TRIAL_DAYS', () => {
    assert.ok(
        !/\bTRIAL_DAYS\b/.test(trialsSrc),
        'trials.js must not contain TRIAL_DAYS identifier'
    );
});

check('trials.js must not read process.env.TRIAL_DAYS', () => {
    assert.ok(
        !/process\.env\.TRIAL_DAYS/.test(trialsSrc),
        'trials.js must not read process.env.TRIAL_DAYS'
    );
});

check('trials.js must not default a trial length to 3 days', () => {
    // Catch `|| 3`, `?? 3`, or `= 3` near trial-day wording without banning unrelated 3s in comments
    assert.ok(
        !/(?:TRIAL_DAYS|trial\s*days?)\s*[=:].{0,40}\|\|\s*3\b/i.test(trialsSrc) &&
            !/\|\|\s*3\b/.test(trialsSrc) &&
            !/\?\?\s*3\b/.test(trialsSrc),
        'trials.js must not default trial length with || 3 or ?? 3'
    );
});

check('trials.js exports must not include TRIAL_DAYS', () => {
    // Fresh require so we assert the live export surface
    const exp = require('../trials.js');
    assert.ok(
        !Object.prototype.hasOwnProperty.call(exp, 'TRIAL_DAYS'),
        'module.exports must not include TRIAL_DAYS'
    );
    assert.strictEqual(
        exp.TRIAL_DAYS,
        undefined,
        'require(\"../trials.js\").TRIAL_DAYS must be undefined'
    );
    assert.strictEqual(
        typeof exp.sweepTrials,
        'function',
        'sweepTrials must remain exported'
    );
});

if (failed) {
    console.error('\nno-trial-days: FAILED');
    process.exit(1);
}
console.log('\nno-trial-days: OK');
process.exit(0);
