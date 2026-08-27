'use strict';
/**
 * Test: operator docs (bot/README.md, bot/DEPLOY.md) describe Hidook Site Builder
 * commercial product — not DESSERD trial-Telegram publish.
 * Run:  node bot/test/ops-docs-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const botDir = path.join(__dirname, '..');
const readmePath = path.join(botDir, 'README.md');
const deployPath = path.join(botDir, 'DEPLOY.md');

const readme = fs.readFileSync(readmePath, 'utf8');
const deploy = fs.readFileSync(deployPath, 'utf8');
const both = readme + '\n' + deploy;

let failed = false;
function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                () => { console.log('PASS', name); },
                (e) => { failed = true; console.error('FAIL', name, '-', e.message); }
            );
        }
        console.log('PASS', name);
        return Promise.resolve();
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        return Promise.resolve();
    }
}

async function run() {
    await check('ops docs files exist', () => {
        assert.ok(fs.existsSync(readmePath), 'bot/README.md must exist');
        assert.ok(fs.existsSync(deployPath), 'bot/DEPLOY.md must exist');
    });

    await check('bot/README.md and bot/DEPLOY.md must not contain DESSERD / desserd / desserd-bot', () => {
        assert.ok(!/\bDESSERD\b/.test(both), 'docs must not contain DESSERD');
        assert.ok(!/desserd-bot/i.test(both), 'docs must not contain desserd-bot docker tag');
        assert.ok(!/desserd/i.test(both), 'docs must not contain desserd');
    });

    await check('ops docs must not document free live trial publish via TRIAL_DAYS', () => {
        // Affirmative old product teaching (not a "do not …" callout)
        assert.ok(
            !/Sites are published immediately for free;\s*payment activates/i.test(both),
            'must not teach "published immediately for free; payment activates permanently"'
        );
        assert.ok(
            !/Number of free trial days\s*\(default\s*`?3`?\)/i.test(both),
            'must not document TRIAL_DAYS as number of free trial days default 3'
        );
        assert.ok(
            !/\|\s*`TRIAL_DAYS`\s*\|[^|\n]*free trial/i.test(both),
            'must not list TRIAL_DAYS env row as free trial'
        );
        // Bare affirmative sentence without negation on the same line
        const freePubLines = both.split('\n').filter((l) =>
            /published immediately for free/i.test(l)
        );
        for (const line of freePubLines) {
            assert.ok(
                /\b(no|not|never|don'?t|do\s+not)\b/i.test(line) ||
                    /there is\s+\*\*no\*\*/i.test(line) ||
                    /“sites are published immediately for free”/i.test(line) ||
                    /"sites are published immediately for free"/i.test(line),
                'any mention of free immediate publish must be a prohibition, got: ' + line.trim()
            );
        }
    });

    await check('ops docs must not present BUILD_FEE_EUR default 49 as the commercial price', () => {
        // Affirmative operator examples / table defaults (legacy product price)
        const feeLines = both.split('\n').filter((l) => /BUILD_FEE_EUR/i.test(l));
        for (const line of feeLines) {
            const isProhibition =
                /\b(do\s+not|don't|never|not|legacy|obsolete|must\s+not|should\s+not)\b/i.test(line) ||
                /do not (set|hardcode|document|rely)/i.test(line);
            if (/\b49\b/.test(line)) {
                assert.ok(
                    isProhibition,
                    'BUILD_FEE_EUR … 49 must only appear as a prohibition/legacy callout, got: ' +
                        line.trim()
                );
            }
            // Table-style "default 49" / "default: `49`" as the fee description
            if (/default[^.\n]{0,30}\b49\b/i.test(line) || /\(default\s+49\)/i.test(line)) {
                assert.ok(
                    isProhibition,
                    'must not list BUILD_FEE_EUR default 49 as the live fee, got: ' + line.trim()
                );
            }
        }
        // Env export style teaching operators to run with 49
        assert.ok(
            !/^\s*BUILD_FEE_EUR\s*=\s*49\s*\\?\s*$/m.test(both),
            'must not show BUILD_FEE_EUR=49 as an operator start example'
        );
    });

    await check('ops docs point operators at single commercial pricing (99 / renewal 29)', () => {
        assert.ok(
            /99\s*(EUR|€)/i.test(both) ||
                /99\s*EUR\s*\/\s*99\s*GBP\s*\/\s*99\s*USD/i.test(both) ||
                (/99/.test(both) && /EUR/.test(both) && /GBP/.test(both) && /USD/.test(both)),
            'docs must state 99 EUR / GBP / USD commercial price'
        );
        assert.ok(
            /renewal/i.test(both) && /\b29\b/.test(both),
            'docs must mention renewal 29 / year'
        );
        assert.ok(
            /pricing\.js/i.test(both) || /single pricing source/i.test(both) || /bot\/pricing/i.test(both),
            'docs should point at pricing.js (or single pricing source) as authority'
        );
    });

    await check('ops docs name Hidook Site Builder and browser builder as commercial product', () => {
        assert.ok(
            /Hidook Site Builder/i.test(both),
            'docs must name Hidook Site Builder'
        );
        assert.ok(
            /browser builder|web builder|\/app\//i.test(both),
            'docs must describe the browser/web builder product surface'
        );
    });

    await check('Telegram is draft-intake into the same browser editor; pay-before-publish in builder', () => {
        assert.ok(
            /Telegram/i.test(readme),
            'README should still mention Telegram as intake'
        );
        assert.ok(
            /draft/i.test(readme) &&
                (/same\s+(draft|browser|editor)/i.test(readme) ||
                    /opens?\s+the\s+same/i.test(readme) ||
                    /browser\s+(builder|editor)/i.test(readme)),
            'README must describe Telegram as opening the same browser draft/editor'
        );
        assert.ok(
            /pay\s+before\s+(public\s+)?publish|payment\s+before\s+(first\s+)?(public\s+)?publish|pay-before-publish/i.test(
                both
            ),
            'docs must state pay before public publish'
        );
        // Happy path must not be Telegram checkout → deploy state machine
        assert.ok(
            !/După confirmare plată:\s*cumpără domeniul/i.test(readme),
            'README must not teach Telegram pay-then-domain-buy as happy path'
        );
        assert.ok(
            !/\*\*Plată\*\*[^\n]*Stripe[\s\S]{0,200}\*\*Deploy\*\*/i.test(readme),
            'README must not present Telegram Stripe → Deploy as the primary SaaS flow'
        );
    });

    if (failed) {
        console.error('\nops-docs-commercial.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nops-docs-commercial.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
