'use strict';
/**
 * bot/test/no-trial-telegram-comment.test.js — S32 bot.js must not name trial-telegram.
 *
 * Pay-before-publish: Telegram is acquisition/intake into the same editor, not a
 * leftover "trial-telegram" commerce platform (comment or code).
 *
 * Run: node bot/test/no-trial-telegram-comment.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BOT_JS = path.join(ROOT, 'bot', 'bot.js');

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

const bot = fs.readFileSync(BOT_JS, 'utf8');

check('bot/bot.js must not contain trial-telegram (comment or code)', () => {
    assert.ok(
        !/trial-telegram/i.test(bot),
        'bot/bot.js must not mention trial-telegram (leftover trial platform jargon)'
    );
});

check('bot/bot.js must not contain trialTelegram (comment or code)', () => {
    assert.ok(
        !/trialTelegram/.test(bot),
        'bot/bot.js must not mention trialTelegram (leftover trial platform jargon)'
    );
});

if (failed) {
    console.error('\nno-trial-telegram-comment: FAILED');
    process.exit(1);
}
console.log('\nno-trial-telegram-comment: OK');
process.exit(0);
