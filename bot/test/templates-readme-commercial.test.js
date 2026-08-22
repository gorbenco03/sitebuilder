'use strict';
/**
 * Test: templates/README.md is Hidook Site Builder operator docs —
 * not desserdina / absolute Downloads path / Telegram-as-publisher.
 * Run:  node bot/test/templates-readme-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const readmePath = path.join(rootDir, 'templates', 'README.md');

const readme = fs.readFileSync(readmePath, 'utf8');

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
    await check('templates/README.md exists', () => {
        assert.ok(fs.existsSync(readmePath), 'templates/README.md must exist');
    });

    await check(
        'templates/README.md must not present desserdina / DESSERD / desserd as product or sample site',
        () => {
            const lines = readme.split('\n');
            for (const line of lines) {
                if (hasDesserdToken(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        'must not use DESSERD/desserd/desserdina as product/sample (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
        }
    );

    await check(
        'templates/README.md must not teach absolute Downloads/desserdirina build path',
        () => {
            assert.ok(
                !/\/Users\/kirill\/Downloads\/desserdirina/i.test(readme),
                'must not use /Users/kirill/Downloads/desserdirina as build path'
            );
            assert.ok(
                !/Downloads\/desserdirina/i.test(readme),
                'must not teach Downloads/desserdirina path'
            );
            // Affirmative “site-ul principal (desserdina)” style
            assert.ok(
                !/site-ul principal\s*\(\s*desserdina\s*\)/i.test(readme),
                'must not label principal site as desserdina'
            );
        }
    );

    await check('templates/README.md names Hidook Site Builder and uses repo-relative build.js', () => {
        assert.ok(/Hidook Site Builder/i.test(readme), 'README must name Hidook Site Builder');
        // Repo-relative build: node build.js or ./build.js — not absolute machine path
        const hasRepoRelativeBuild =
            /node\s+build\.js/i.test(readme) ||
            /node\s+\.\/build\.js/i.test(readme) ||
            /`build\.js`/i.test(readme);
        assert.ok(hasRepoRelativeBuild, 'README must teach repo-relative node build.js');
    });

    await check(
        'templates/README.md describes three Hidook design systems (product-menu, local-service, portfolio)',
        () => {
            assert.ok(/product-menu/i.test(readme), 'must mention product-menu');
            assert.ok(/local-service/i.test(readme), 'must mention local-service');
            assert.ok(/portfolio/i.test(readme), 'must mention portfolio');
            assert.ok(
                /design system/i.test(readme),
                'must frame the three verticals as Hidook design systems'
            );
        }
    );

    await check(
        'templates/README.md: browser builder is commercial; Telegram is draft-intake (not live publisher)',
        () => {
            assert.ok(
                /browser builder|web builder/i.test(readme),
                'must describe browser/web builder as commercial surface'
            );
            assert.ok(
                /draft/i.test(readme) &&
                    (/same\s+(draft|browser|editor)/i.test(readme) ||
                        /opens?\s+the\s+same/i.test(readme) ||
                        /draft-?intake/i.test(readme) ||
                        /intake/i.test(readme)),
                'must describe Telegram as draft-intake into the same editor'
            );
            // Affirmative “bot publishes live” style teaching
            const liveViaBot = readme.split('\n').filter(
                (l) =>
                    /Telegram/i.test(l) &&
                    /(publish|public|live site|site live|deploys?|pune live|publică)/i.test(l)
            );
            for (const line of liveViaBot) {
                const isProhibitionOrDraft =
                    /\b(do\s+not|don't|never|not|must\s+not|should\s+not|no longer|not the|draft|intake|same\s+(draft|editor|browser)|opens?\s+the\s+same)\b/i.test(
                        line
                    ) || /browser builder/i.test(line);
                assert.ok(
                    isProhibitionOrDraft,
                    'Telegram+live/publish lines must be draft-intake or prohibition, got: ' +
                        line.trim()
                );
            }
        }
    );

    await check(
        'templates/README.md keeps template contract usable (schema, presets, registry, config keys)',
        () => {
            assert.ok(/schema\.json/i.test(readme), 'must document schema.json');
            assert.ok(/presets\.json/i.test(readme), 'must document presets.json');
            assert.ok(/registry\.json/i.test(readme), 'must document registry.json');
            assert.ok(/config\.json/i.test(readme), 'must document config.json');
            assert.ok(/business\{/i.test(readme) || /business\s*\{/i.test(readme), 'must show business{} contract');
            assert.ok(/@each/i.test(readme) && /@if/i.test(readme), 'must document @each and @if');
        }
    );

    await check(
        'templates/README.md must not instruct live hidook.agency DNS / production deploy as this slice',
        () => {
            const liveDnsLines = readme.split('\n').filter(
                (l) =>
                    /hidook\.agency/i.test(l) &&
                    /(DNS|custom domain|cutover|production|live deploy|wrangler pages deploy)/i.test(l)
            );
            for (const line of liveDnsLines) {
                const isOwnerGateOrLocal =
                    /\b(owner|owner-only|do\s+not|don't|never|not|local|staging|test|fake|isolated|must\s+not|launch gate|out of scope|not this slice)\b/i.test(
                        line
                    ) || /PRODUCT\.md/i.test(line);
                assert.ok(
                    isOwnerGateOrLocal,
                    'hidook.agency DNS/production mentions must be owner-gate or local framing, got: ' +
                        line.trim()
                );
            }
        }
    );

    if (failed) {
        console.error('\ntemplates-readme-commercial.test.js: FAILED');
        process.exit(1);
    }
    console.log('\ntemplates-readme-commercial.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
