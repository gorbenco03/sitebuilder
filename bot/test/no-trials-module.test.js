'use strict';
/**
 * bot/test/no-trials-module.test.js — S29 production must not ship bot/trials.js.
 *
 * Pay-before-publish: leftover trials module (even no-op sweepTrials) is not product.
 * Module must be absent; no production bot file may require it.
 *
 * Run: node bot/test/no-trials-module.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const botDir = path.join(__dirname, '..');
const trialsPath = path.join(botDir, 'trials.js');

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

check('bot/trials.js must not exist', () => {
    assert.ok(
        !fs.existsSync(trialsPath),
        'bot/trials.js must not exist in the tree (remove leftover trial factory surface)'
    );
});

check('no production bot file may require trials.js', () => {
    const offenders = [];
    function walk(dir) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                // Exclude bot/test/ from production require scan
                if (ent.name === 'test' && path.resolve(dir) === path.resolve(botDir)) continue;
                walk(full);
                continue;
            }
            if (!ent.name.endsWith('.js')) continue;
            const src = fs.readFileSync(full, 'utf8');
            if (
                /require\s*\(\s*['"]\.\/trials\.js['"]\s*\)/.test(src) ||
                /require\s*\(\s*['"]\.\.\/trials\.js['"]\s*\)/.test(src)
            ) {
                offenders.push(path.relative(botDir, full));
            }
        }
    }
    walk(botDir);
    assert.deepStrictEqual(
        offenders,
        [],
        'production bot files must not require trials.js: ' + offenders.join(', ')
    );
});

if (failed) {
    console.error('\nno-trials-module: FAILED');
    process.exit(1);
}
console.log('\nno-trials-module: OK');
process.exit(0);
