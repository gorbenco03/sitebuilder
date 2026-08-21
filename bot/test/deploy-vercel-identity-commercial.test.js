'use strict';
/**
 * Test: bot/deploy-vercel.js examples name a Hidook site — not DESSERD.
 * Operator-facing JSDoc / self-test must not teach desserd project names.
 * Run:  node bot/test/deploy-vercel-identity-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const deployPath = path.join(rootDir, 'bot', 'deploy-vercel.js');

const src = fs.readFileSync(deployPath, 'utf8');

let failed = false;
function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                () => {
                    console.log('PASS', name);
                },
                (e) => {
                    failed = true;
                    console.error('FAIL', name, '-', e.message);
                }
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
        /\b(do\s+not|don't|never|not|must\s+not|should\s+not|obsolete|legacy|prohibited|forbidden|not the product|not operator)\b/i.test(
            line
        ) ||
        /[“"][^”"]*\b(DESSERD|desserd|desserdina)\b[^”"]*[”"]/i.test(line) ||
        /`[^`]*\b(DESSERD|desserd|desserdina)\b[^`]*`/i.test(line)
    );
}

function hasDesserdToken(text) {
    return /\bDESSERD\b/i.test(text) || /desserdina/i.test(text) || /desserd/i.test(text);
}

async function run() {
    await check('bot/deploy-vercel.js exists', () => {
        assert.ok(fs.existsSync(deployPath), 'bot/deploy-vercel.js must exist');
    });

    await check(
        'deploy-vercel.js must not present desserdina / DESSERD / desserd as product or example site name',
        () => {
            const lines = src.split('\n');
            for (const line of lines) {
                if (hasDesserdToken(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        'deploy-vercel.js must not use DESSERD/desserd/desserdina as product/example name (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
        }
    );

    await check(
        'deploy-vercel.js must not teach legacy example names desserd-by-irina or my-desserd-site',
        () => {
            // Affirmative JSDoc / CLI self-test examples from pre-Hidook identity
            assert.ok(
                !/desserd-by-irina/i.test(src),
                'must not use desserd-by-irina as deploySite name example'
            );
            assert.ok(
                !/my-desserd-site/i.test(src),
                'must not use my-desserd-site as deploySite self-test example'
            );
        }
    );

    await check(
        'deploy-vercel.js uses a generic Hidook-style example site name',
        () => {
            // Prefer my-hidook-site / example-site (or similar URL-safe Hidook examples)
            const hasHidookStyle =
                /my-hidook-site/i.test(src) ||
                /example-site/i.test(src) ||
                /hidook[-_]?site/i.test(src);
            assert.ok(
                hasHidookStyle,
                'JSDoc or self-test should show a generic Hidook-style example (e.g. my-hidook-site / example-site)'
            );
        }
    );
}

run().then(() => {
    if (failed) process.exit(1);
});
