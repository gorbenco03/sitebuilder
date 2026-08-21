'use strict';
/**
 * Test: bot/domains.js examples name a generic Hidook-style base — not DESSERD.
 * Operator-facing JSDoc must not teach desserd as a domain base name example.
 * Run:  node bot/test/domains-identity-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const domainsPath = path.join(rootDir, 'bot', 'domains.js');

const src = fs.readFileSync(domainsPath, 'utf8');

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
    await check('bot/domains.js exists', () => {
        assert.ok(fs.existsSync(domainsPath), 'bot/domains.js must exist');
    });

    await check(
        'domains.js must not present desserdina / DESSERD / desserd as product or example domain base name',
        () => {
            const lines = src.split('\n');
            for (const line of lines) {
                if (hasDesserdToken(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        'domains.js must not use DESSERD/desserd/desserdina as product/example name (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
        }
    );

    await check(
        'domains.js must not teach legacy example base name desserd in suggestDomains JSDoc',
        () => {
            // Affirmative JSDoc example from pre-Hidook identity: e.g. 'myshop' or 'desserd'
            assert.ok(
                !/e\.g\.\s*'[^']*desserd[^']*'/i.test(src) &&
                    !/e\.g\.\s*"[^"]*desserd[^"]*"/i.test(src),
                "must not use 'desserd' as suggestDomains base name example"
            );
            assert.ok(!/'desserd'/i.test(src) && !/"desserd"/i.test(src), "must not quote 'desserd' as an example base");
        }
    );

    await check('domains.js uses a generic Hidook-style example domain base name', () => {
        // Prefer myshop / example-shop (or similar URL-safe generic examples)
        const hasGenericStyle =
            /'myshop'|"myshop"|'example-shop'|"example-shop"|'example'|"example"/i.test(src) ||
            /my-hidook|hidook[-_]?shop/i.test(src);
        assert.ok(
            hasGenericStyle,
            "JSDoc should show a generic Hidook-style example base (e.g. 'myshop' / 'example-shop')"
        );
    });
}

run().then(() => {
    if (failed) process.exit(1);
});
