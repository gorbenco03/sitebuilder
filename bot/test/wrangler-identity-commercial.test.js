'use strict';
/**
 * Test: wrangler.toml names Hidook Site Builder Pages project — not desserdina bakery sample.
 * Run:  node bot/test/wrangler-identity-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const wranglerPath = path.join(rootDir, 'wrangler.toml');

const src = fs.readFileSync(wranglerPath, 'utf8');

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

/** Parse simple top-level TOML key = "value" assignments (wrangler.toml shape). */
function parseTomlString(key) {
    const re = new RegExp('^\\s*' + key + '\\s*=\\s*"([^"]*)"', 'm');
    const m = src.match(re);
    return m ? m[1] : null;
}

async function run() {
    await check('wrangler.toml exists', () => {
        assert.ok(fs.existsSync(wranglerPath), 'wrangler.toml must exist');
    });

    await check(
        'wrangler.toml must not present desserdina / DESSERD / desserd as product or Pages project name',
        () => {
            const lines = src.split('\n');
            for (const line of lines) {
                if (hasDesserdToken(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        'must not use DESSERD/desserd/desserdina as product/Pages name (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
            const nameVal = parseTomlString('name');
            assert.ok(nameVal != null, 'name = "…" must be present');
            assert.ok(
                !hasDesserdToken(nameVal),
                'name must not be desserdina/DESSERD/desserd, got: ' + nameVal
            );
        }
    );

    await check('wrangler.toml name is a Hidook-style Pages project slug', () => {
        const nameVal = parseTomlString('name');
        assert.ok(nameVal != null, 'name must be set');
        assert.ok(
            /hidook/i.test(nameVal) && /site|builder/i.test(nameVal),
            'name should be a Hidook-style slug (e.g. hidook-site-builder), got: ' + nameVal
        );
        assert.ok(
            /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(nameVal),
            'name must be a URL-safe slug, got: ' + nameVal
        );
    });

    await check('wrangler.toml comments name Hidook Site Builder identity', () => {
        assert.ok(
            /Hidook Site Builder/i.test(src),
            'comments must name Hidook Site Builder'
        );
    });

    await check(
        'comments must not teach bakery sample deploy as the commercial product',
        () => {
            // Old framing: "desserdina static site" as the thing being deployed
            assert.ok(
                !/desserdina\s+static\s+site/i.test(src) ||
                    isProhibitionOrQuotedCallout(
                        src.split('\n').find((l) => /desserdina\s+static\s+site/i.test(l)) || ''
                    ),
                'must not frame desserdina static site as the deploy target'
            );
            // Affirmative “deploy the bakery / sample as product”
            const deployLines = src.split('\n').filter(
                (l) =>
                    /deploy/i.test(l) &&
                    /(bakery|sample|desserdina|commercial product)/i.test(l)
            );
            for (const line of deployLines) {
                if (hasDesserdToken(line) || /bakery|sample/i.test(line)) {
                    const ok =
                        isProhibitionOrQuotedCallout(line) ||
                        /\b(local|dev|sample assemble|not the commercial|not commercial|browser builder)\b/i.test(
                            line
                        );
                    assert.ok(
                        ok,
                        'deploy lines must not teach bakery/sample as commercial product, got: ' +
                            line.trim()
                    );
                }
            }
            // Prefer framing: commercial product is browser builder; npm run build → dist is local/dev
            const hasBrowserOrCommercial =
                /browser builder|commercial product/i.test(src);
            const hasLocalDevSample =
                /\b(local|dev)\b/i.test(src) &&
                /(sample|assemble|npm run build|dist)/i.test(src);
            assert.ok(
                hasBrowserOrCommercial || hasLocalDevSample,
                'comments should frame browser builder as commercial and/or npm run build→dist as local/dev sample assemble'
            );
        }
    );

    await check(
        'pages_build_output_dir stays "dist" and compatibility_date is preserved',
        () => {
            const outDir = parseTomlString('pages_build_output_dir');
            assert.strictEqual(
                outDir,
                'dist',
                'pages_build_output_dir must remain "dist", got: ' + outDir
            );
            const compat = parseTomlString('compatibility_date');
            assert.ok(compat, 'compatibility_date must remain set');
            assert.strictEqual(
                compat,
                '2024-06-01',
                'compatibility_date must stay 2024-06-01, got: ' + compat
            );
        }
    );

    await check(
        'wrangler.toml must not instruct live hidook.agency DNS / production cutover',
        () => {
            const lines = src.split('\n');
            const liveDns = lines.filter(
                (l) =>
                    /hidook\.agency/i.test(l) &&
                    /(DNS|custom domain|cutover|production|live Pages|live deploy)/i.test(l)
            );
            for (const line of liveDns) {
                const isOwnerGateOrLocal =
                    /\b(owner|owner-only|do\s+not|don't|never|not|local|staging|test|fake|isolated|must\s+not|launch gate|out of scope|not this slice)\b/i.test(
                        line
                    ) || /PRODUCT\.md/i.test(line);
                assert.ok(
                    isOwnerGateOrLocal,
                    'hidook.agency DNS/production mentions must be owner-gate or local/test framing, got: ' +
                        line.trim()
                );
            }
        }
    );
}

run().then(() => {
    if (failed) process.exit(1);
});
