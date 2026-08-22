'use strict';
/**
 * bot/test/no-trial-sweep.test.js — S24 bot interval must not run unpaid-trial sweeper.
 *
 * Pay-before-publish: bot.js must not import trials.js or call sweepTrials.
 * reconcilePending may remain on the start/setInterval path.
 *
 * Run: node bot/test/no-trial-sweep.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const botPath = path.join(__dirname, '..', 'bot.js');
const botSrc = fs.readFileSync(botPath, 'utf8');

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

check('bot.js must not require("./trials.js")', () => {
    assert.ok(
        !/require\s*\(\s*['"]\.\/trials\.js['"]\s*\)/.test(botSrc),
        'bot.js must not require("./trials.js") — unpaid trial sweeper is not product'
    );
});

check('bot.js must not call sweepTrials', () => {
    assert.ok(
        !/\bsweepTrials\b/.test(botSrc),
        'bot.js must not reference sweepTrials (import or call)'
    );
});

check('bot.js start/setInterval path still calls reconcilePending', () => {
    assert.ok(
        /\breconcilePending\s*\(/.test(botSrc),
        'bot.js must still call reconcilePending() for pending payments'
    );
    assert.ok(
        /\bsetInterval\b/.test(botSrc),
        'bot.js must keep a setInterval reconciliation path'
    );
});

check('bot.js must not embed trial-reminder / păstra permanent copy', () => {
    assert.ok(
        !/p[ăa]stra\s+permanent/i.test(botSrc),
        'bot.js must not promise permanent hosting from one payment (păstra permanent)'
    );
    assert.ok(
        !/Trial model:\s*reminder\s*\+\s*expire/i.test(botSrc),
        'bot.js must not document/run the trial reminder+expire model on the interval'
    );
});

if (failed) {
    console.error('\nno-trial-sweep: FAILED');
    process.exit(1);
}
console.log('\nno-trial-sweep: OK');
process.exit(0);
