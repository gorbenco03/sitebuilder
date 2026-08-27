'use strict';
/**
 * Test: root README.md and LAUNCH.md describe Hidook Site Builder
 * commercial product — not DESSERD / $29 Telegram publish.
 * Run:  node bot/test/root-docs-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const readmePath = path.join(rootDir, 'README.md');
const launchPath = path.join(rootDir, 'LAUNCH.md');

const readme = fs.readFileSync(readmePath, 'utf8');
const launch = fs.readFileSync(launchPath, 'utf8');
const both = readme + '\n' + launch;

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

/** True if the line is clearly a prohibition / quoted “do not” callout about the old name. */
function isProhibitionOrQuotedCallout(line) {
    return (
        /\b(do\s+not|don't|never|not|must\s+not|should\s+not|obsolete|legacy|prohibited|forbidden)\b/i.test(
            line
        ) ||
        /[“"][^”"]*\b(DESSERD|desserd|desserdina)\b[^”"]*[”"]/i.test(line) ||
        /`[^`]*\b(DESSERD|desserd|desserdina)\b[^`]*`/i.test(line)
    );
}

async function run() {
    await check('root docs files exist', () => {
        assert.ok(fs.existsSync(readmePath), 'README.md must exist');
        assert.ok(fs.existsSync(launchPath), 'LAUNCH.md must exist');
    });

    await check('README.md and LAUNCH.md must not name DESSERD / desserd / desserdina as the product', () => {
        // Word-boundary DESSERD and desserdina / desserd case-insensitive except prohibition callouts
        for (const [label, text] of [
            ['README.md', readme],
            ['LAUNCH.md', launch],
        ]) {
            const lines = text.split('\n');
            for (const line of lines) {
                if (/\bDESSERD\b/.test(line) || /desserdina/i.test(line) || /desserd/i.test(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        label +
                            ' must not use DESSERD/desserd/desserdina as product name (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
        }
    });

    await check('root docs must not teach $29 / BUILD_FEE_USD / BUILD_FEE_EUR 49 as commercial price', () => {
        // Affirmative $29 as product price (old Telegram bot package)
        const dollar29Lines = both.split('\n').filter((l) => /\$\s*29\b/.test(l) || /\$29\b/.test(l));
        for (const line of dollar29Lines) {
            const isProhibition =
                /\b(do\s+not|don't|never|not|must\s+not|should\s+not|obsolete|legacy|prohibited)\b/i.test(
                    line
                );
            assert.ok(
                isProhibition,
                '$29 must only appear as prohibition/legacy, got: ' + line.trim()
            );
        }

        // BUILD_FEE_USD taught as the commercial fee
        const usdLines = both.split('\n').filter((l) => /BUILD_FEE_USD/i.test(l));
        for (const line of usdLines) {
            const isProhibition =
                /\b(do\s+not|don't|never|not|must\s+not|should\s+not|obsolete|legacy|prohibited)\b/i.test(
                    line
                );
            assert.ok(
                isProhibition,
                'BUILD_FEE_USD must only appear as prohibition/legacy, got: ' + line.trim()
            );
        }

        // BUILD_FEE_EUR … 49 as commercial price
        const eurLines = both.split('\n').filter((l) => /BUILD_FEE_EUR/i.test(l));
        for (const line of eurLines) {
            const isProhibition =
                /\b(do\s+not|don't|never|not|must\s+not|should\s+not|obsolete|legacy|prohibited)\b/i.test(
                    line
                );
            if (/\b49\b/.test(line)) {
                assert.ok(
                    isProhibition,
                    'BUILD_FEE_EUR … 49 must only appear as prohibition/legacy, got: ' + line.trim()
                );
            }
        }

        // Table/package selling "$29 one-time" style
        assert.ok(
            !/\$29\s+one-time/i.test(both) && !/\*\*\$29\b/.test(both),
            'must not sell **$29** / $29 one-time as the package price'
        );
    });

    await check('root docs must not present Telegram as the product that publishes a live site', () => {
        // Old LAUNCH promise: site live in a few minutes via the bot
        assert.ok(
            !/site live in (a )?few minutes/i.test(both) &&
                !/primește un site live în câteva minute/i.test(both),
            'must not promise site live in a few minutes via the bot'
        );
        assert.ok(
            !/generate automat printr-un bot Telegram/i.test(both),
            'must not sell auto-generated sites primarily via Telegram bot'
        );
        // Affirmative “via the bot” live publish teaching
        const liveViaBot = both.split('\n').filter(
            (l) =>
                /live/i.test(l) &&
                /bot/i.test(l) &&
                /(minutes|minute|via the bot|prin bot)/i.test(l)
        );
        for (const line of liveViaBot) {
            const isProhibition =
                /\b(do\s+not|don't|never|not|must\s+not|should\s+not|no longer|not the)\b/i.test(line);
            assert.ok(
                isProhibition,
                'live-via-bot lines must be prohibitions, got: ' + line.trim()
            );
        }
    });

    await check('root docs name Hidook Site Builder; browser builder commercial; Telegram same-draft intake', () => {
        assert.ok(
            /Hidook Site Builder/i.test(both),
            'docs must name Hidook Site Builder'
        );
        assert.ok(
            /browser builder|web builder|\/app\//i.test(both),
            'docs must describe the browser/web builder as commercial product'
        );
        assert.ok(
            /Telegram/i.test(both),
            'docs should still mention Telegram as intake'
        );
        assert.ok(
            /draft/i.test(both) &&
                (/same\s+(draft|browser|editor)/i.test(both) ||
                    /opens?\s+the\s+same/i.test(both) ||
                    /draft-?intake/i.test(both) ||
                    /intake that (creates|opens)/i.test(both)),
            'docs must describe Telegram as draft-intake into the same editor'
        );
    });

    await check('root docs state pay-before-publish and commercial price 99 / renewal 29', () => {
        assert.ok(
            /pay\s+before\s+(public\s+)?publish|payment\s+before\s+(first\s+)?(public\s+)?publish|pay-before-publish/i.test(
                both
            ),
            'docs must state pay before public publish'
        );
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
            /pricing\.js/i.test(both) || /PRODUCT\.md/i.test(both),
            'docs should point at bot/pricing.js and/or PRODUCT.md'
        );
    });

    await check('LAUNCH.md must not instruct live production Stripe/Revolut keys, live Railway, or live DNS as this slice', () => {
        // Old checklist: put live Revolut keys / deploy Railway as if this slice
        const liveKeyTeaching =
            /cheie\s+\*\*Revolut live\*\*|REVOLUT_ENV\s*=\s*production|pune cheia \*\*Revolut live\*\*/i.test(
                launch
            );
        assert.ok(
            !liveKeyTeaching,
            'LAUNCH must not instruct putting Revolut live / REVOLUT_ENV=production as in-scope team steps'
        );

        // Affirmative “Deploy bot pe Railway” as the money path for this slice without owner-gate framing
        const railwayLines = launch.split('\n').filter((l) => /Railway/i.test(l));
        for (const line of railwayLines) {
            const isOwnerGateOrLocal =
                /\b(owner|owner-only|do\s+not|don't|never|not|local|staging|test|fake|isolated|must\s+not)\b/i.test(
                    line
                ) ||
                /launch gate/i.test(line);
            if (/deploy.*Railway|Railway.*deploy|Deploy bot pe Railway/i.test(line)) {
                assert.ok(
                    isOwnerGateOrLocal,
                    'Railway deploy mentions must be owner-gate or local/staging, got: ' + line.trim()
                );
            }
        }

        // Live DNS as this-slice instruction
        assert.ok(
            !/card pe Vercel\s*\+\s*datele\s*`?REGISTRANT_/i.test(launch),
            'LAUNCH must not instruct live Vercel registrant DNS setup as team checklist'
        );
    });

    if (failed) {
        console.error('\nroot-docs-commercial.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nroot-docs-commercial.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
