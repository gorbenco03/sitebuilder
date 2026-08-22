'use strict';
/**
 * bot/test/no-permanent-trial.test.js — S25 trials.js must not promise permanent hosting.
 *
 * Pay-before-publish: leftover trial sweeper must be a no-op and must not embed
 * commercial copy that promises permanent hosting or a public unpaid trial.
 *
 * Run: node bot/test/no-permanent-trial.test.js
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

check('trials.js must not contain "păstra permanent" / permanent-hosting promise', () => {
    assert.ok(
        !/p[ăa]stra\s+permanent/i.test(trialsSrc),
        'trials.js must not promise permanent hosting (păstra permanent)'
    );
    assert.ok(
        !/p[ăa]stra\s+permanent/i.test(trialsSrc.normalize('NFC')),
        'trials.js must not promise permanent hosting (NFC normalized)'
    );
});

check('trials.js must not contain "Perioada de probă" trial-expired copy', () => {
    assert.ok(
        !/Perioada\s+de\s+prob[ăa]/i.test(trialsSrc),
        'trials.js must not embed trial-expired owner copy (Perioada de probă)'
    );
});

check('trials.js must not call deployPlaceholder from sweep path', () => {
    assert.ok(
        !/\.deployPlaceholder\s*\(/.test(trialsSrc) &&
            !/require\s*\(\s*['\"]\.\/webpublish(?:\.js)?['\"]\s*\)/.test(trialsSrc),
        'trials.js must not require webpublish or call deployPlaceholder (sweep is no-op)'
    );
});

check('trials.js must not set status expired or reminded in source', () => {
    assert.ok(
        !/status:\s*['"]expired['"]/.test(trialsSrc),
        'trials.js must not set status: expired'
    );
    assert.ok(
        !/reminded:\s*true/.test(trialsSrc),
        'trials.js must not set reminded: true'
    );
});

check('trials.js exports sweepTrials as async no-op returning zero counts', () => {
    // Structural: function body should return { reminders: 0, expired: 0 } without I/O loops
    assert.ok(/\bfunction\s+sweepTrials\b|\bsweepTrials\s*=/.test(trialsSrc),
        'must define sweepTrials');
    assert.ok(
        /reminders:\s*0/.test(trialsSrc) && /expired:\s*0/.test(trialsSrc),
        'sweepTrials source must return reminders:0 and expired:0'
    );
});

// Runtime: require and call
const { sweepTrials } = require('../trials.js');

(async () => {
    await check('sweepTrials() runtime returns { reminders: 0, expired: 0 } with no deps', async () => {
        const result = await sweepTrials({
            messenger: () => { throw new Error('messenger must not be called'); },
            notifyAdmin: () => { throw new Error('notifyAdmin must not be called'); },
        });
        assert.deepStrictEqual(result, { reminders: 0, expired: 0 });
    });

    if (failed) {
        console.error('\nno-permanent-trial: FAILED');
        process.exit(1);
    }
    console.log('\nno-permanent-trial: OK');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
