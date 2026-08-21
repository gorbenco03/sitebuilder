'use strict';
/**
 * Test: root package.json + scripts/build-site.js name Hidook Site Builder
 * — not desserdina / DESSERD bakery sample as product identity.
 * Run:  node bot/test/package-identity-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const pkgPath = path.join(rootDir, 'package.json');
const buildSitePath = path.join(rootDir, 'scripts', 'build-site.js');

const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);
const buildSite = fs.readFileSync(buildSitePath, 'utf8');

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
    await check('package.json and scripts/build-site.js exist', () => {
        assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
        assert.ok(fs.existsSync(buildSitePath), 'scripts/build-site.js must exist');
    });

    await check(
        'package.json name and description must not contain desserdina / DESSERD / desserd',
        () => {
            const name = String(pkg.name || '');
            const description = String(pkg.description || '');
            assert.ok(
                !hasDesserdToken(name),
                'package.json name must not contain desserdina/DESSERD/desserd, got: ' + name
            );
            assert.ok(
                !hasDesserdToken(description),
                'package.json description must not contain desserdina/DESSERD/desserd, got: ' +
                    description
            );
        }
    );

    await check('package.json names Hidook Site Builder as commercial product', () => {
        const name = String(pkg.name || '');
        const description = String(pkg.description || '');
        const combined = name + ' ' + description;
        assert.ok(
            /Hidook Site Builder/i.test(combined) || /hidook-site-builder/i.test(name),
            'package.json name or description must identify Hidook Site Builder'
        );
        assert.ok(
            /Hidook Site Builder/i.test(description) || /browser builder/i.test(description),
            'description should name Hidook Site Builder and/or browser builder'
        );
    });

    await check(
        'scripts/build-site.js must not present desserdina / DESSERD / desserd as the product',
        () => {
            const lines = buildSite.split('\n');
            for (const line of lines) {
                if (/\bDESSERD\b/i.test(line) || /desserdina/i.test(line) || /desserd/i.test(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        'build-site.js must not use DESSERD/desserd/desserdina as product name (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
        }
    );

    await check(
        'scripts/build-site.js must not print wrangler deploy with --project-name desserdina',
        () => {
            const lines = buildSite.split('\n');
            const projectNameLines = lines.filter((l) =>
                /--project-name\s+desserdina|project-name\s+desserdina|pages deploy.*desserdina/i.test(
                    l
                )
            );
            for (const line of projectNameLines) {
                assert.ok(
                    isProhibitionOrQuotedCallout(line),
                    'wrangler --project-name desserdina must only appear as prohibition/legacy, got: ' +
                        line.trim()
                );
            }
            // console.log affirmative deploy teaching desserdina
            const consoleDeploy = lines.filter(
                (l) =>
                    /console\.(log|info|warn)/.test(l) &&
                    /wrangler|pages deploy|project-name/i.test(l) &&
                    /desserdina/i.test(l)
            );
            for (const line of consoleDeploy) {
                assert.ok(
                    isProhibitionOrQuotedCallout(line),
                    'console deploy line must not teach project-name desserdina, got: ' + line.trim()
                );
            }
        }
    );
}

run().then(() => {
    if (failed) process.exit(1);
});
