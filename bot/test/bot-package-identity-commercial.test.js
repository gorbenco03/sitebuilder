'use strict';
/**
 * Test: Dockerfile + bot/package.json (+ lock name) name Hidook Site Builder
 * — not DESSERD / desserd-site-bot as product identity.
 * Run:  node bot/test/bot-package-identity-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const dockerfilePath = path.join(rootDir, 'Dockerfile');
const botPkgPath = path.join(rootDir, 'bot', 'package.json');
const botLockPath = path.join(rootDir, 'bot', 'package-lock.json');

const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
const botPkgRaw = fs.readFileSync(botPkgPath, 'utf8');
const botPkg = JSON.parse(botPkgRaw);
const botLockRaw = fs.readFileSync(botLockPath, 'utf8');
const botLock = JSON.parse(botLockRaw);

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
    await check('Dockerfile and bot/package.json (+ lock) exist', () => {
        assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist');
        assert.ok(fs.existsSync(botPkgPath), 'bot/package.json must exist');
        assert.ok(fs.existsSync(botLockPath), 'bot/package-lock.json must exist');
    });

    await check(
        'Dockerfile first comment / product framing must not present DESSERD/desserd/desserdina as the product',
        () => {
            const lines = dockerfile.split('\n');
            for (const line of lines) {
                if (hasDesserdToken(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        'Dockerfile must not use DESSERD/desserd/desserdina as product name (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
        }
    );

    await check('Dockerfile names Hidook Site Builder', () => {
        assert.ok(
            /Hidook Site Builder/i.test(dockerfile),
            'Dockerfile must name Hidook Site Builder'
        );
    });

    await check(
        'bot/package.json name and description must not contain desserdina / DESSERD / desserd',
        () => {
            const name = String(botPkg.name || '');
            const description = String(botPkg.description || '');
            assert.ok(
                !hasDesserdToken(name),
                'bot/package.json name must not contain desserdina/DESSERD/desserd, got: ' + name
            );
            assert.ok(
                !hasDesserdToken(description),
                'bot/package.json description must not contain desserdina/DESSERD/desserd, got: ' +
                    description
            );
        }
    );

    await check('bot/package.json names Hidook Site Builder as commercial product', () => {
        const name = String(botPkg.name || '');
        const description = String(botPkg.description || '');
        const combined = name + ' ' + description;
        assert.ok(
            /Hidook Site Builder/i.test(combined) || /hidook-site-builder/i.test(name),
            'bot/package.json name or description must identify Hidook Site Builder'
        );
        assert.ok(
            /Hidook Site Builder/i.test(description) || /browser builder/i.test(description),
            'description should name Hidook Site Builder and/or browser builder'
        );
    });

    await check(
        'bot/package.json description must not claim Telegram auto-publishes a live site',
        () => {
            const description = String(botPkg.description || '');
            // Old product loop: Telegram collects business info and auto-generates a landing page
            assert.ok(
                !/auto-generates?\s+a\s+landing\s+page/i.test(description),
                'description must not say Telegram auto-generates a landing page'
            );
            assert.ok(
                !/auto[- ]?publish/i.test(description),
                'description must not claim auto-publish'
            );
        }
    );

    await check(
        'bot/package-lock.json top-level and packages[""] name match bot/package.json name',
        () => {
            const expected = String(botPkg.name || '');
            assert.ok(expected.length > 0, 'bot/package.json name must be set');
            assert.strictEqual(
                String(botLock.name || ''),
                expected,
                'bot/package-lock.json top-level name must match bot/package.json'
            );
            const rootPkg = botLock.packages && botLock.packages[''];
            assert.ok(rootPkg, 'bot/package-lock.json packages[""] must exist');
            assert.strictEqual(
                String(rootPkg.name || ''),
                expected,
                'bot/package-lock.json packages[""].name must match bot/package.json'
            );
            assert.ok(
                !hasDesserdToken(expected),
                'lock-synced name must not contain desserdina/DESSERD/desserd'
            );
        }
    );
}

run().then(() => {
    if (failed) process.exit(1);
});
