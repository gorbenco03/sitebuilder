'use strict';
/**
 * Oracle: docs-consistency audit round 2 (2026-09-06) — mechanically verifies
 * the fragile claims fixed by that pass, so they can't silently regress.
 *
 * Covers:
 *   DOC-02  test command must use `--test` (root package.json script + docs)
 *   DOC-03  PRODUCT.md must describe the native Hidook calendar, not only Cal.com
 *   DOC-04  README.md must point at VISION.md as the source of truth
 *   DOC-05  OWNER-CALENDAR-CAL-DIY.md must carry an explicit deprecation banner
 *   DOC-06  GO-LIVE.md must count five designs, not four
 *   DOC-08  templates/README.md schema.json example must say Romanian, not English
 *
 * Run:  node --test bot/test/audit-docs-round2.test.js
 * (Must FAIL on the pre-fix docs and PASS after the fix — do not weaken these
 * assertions to make them pass; fix the docs instead.)
 */

const { test } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

function read(rel) {
    return fs.readFileSync(path.join(rootDir, rel), 'utf8');
}

test('DOC-02: package.json "test" script uses `node --test`, not a bare glob', () => {
    const pkg = JSON.parse(read('package.json'));
    const testScript = String((pkg.scripts && pkg.scripts.test) || '');
    assert.ok(testScript.length > 0, 'package.json must define a "test" script');
    assert.ok(
        /--test\b/.test(testScript),
        'the "test" script must use `node --test`, got: ' + testScript
    );
    assert.ok(
        /bot\/test\/\*\.test\.js/.test(testScript),
        'the "test" script must target bot/test/*.test.js, got: ' + testScript
    );
});

test('DOC-02: root docs teach the test command with --test (README, AGENTS, LAUNCH)', () => {
    for (const rel of ['README.md', 'AGENTS.md', 'LAUNCH.md']) {
        const text = read(rel);
        // Any literal "node bot/test/*.test.js" occurrence must either be
        // immediately preceded by `--test ` (the correct form) or sit in a
        // sentence/line that explicitly prohibits the bare form — never taught
        // as the affirmative, run-this command.
        const bareGlobRe = /node\s+bot\/test\/\*\.test\.js/g;
        let m;
        while ((m = bareGlobRe.exec(text))) {
            const before = text.slice(Math.max(0, m.index - 8), m.index);
            const context = text.slice(Math.max(0, m.index - 60), m.index + 60);
            const correctlyFlagged = /--test\s+$/.test(before);
            const isProhibition = /\b(do\s+not|don't|never|without|must\s+not|no longer|not\s+`?--test)\b/i.test(
                context
            );
            assert.ok(
                correctlyFlagged || isProhibition,
                rel + ' must not affirmatively document `node bot/test/*.test.js` without `--test` — ' +
                    'a bare glob only runs the first matched file. Context: "' + context.trim() + '"'
            );
        }
        assert.ok(
            /--test/.test(text) || /npm\s+test/.test(text),
            rel + ' must mention either `--test` or `npm test` for the test command'
        );
    }
});

test('DOC-03: PRODUCT.md describes the native Hidook calendar, not only Cal.com', () => {
    const text = read('PRODUCT.md');
    assert.ok(
        /nativeBooking|calendar-native|native.{0,20}Hidook|Hidook.{0,20}native/i.test(text),
        'PRODUCT.md must mention the native Hidook calendar module / appointment.nativeBooking flag'
    );
});

test('DOC-04: README.md points at VISION.md as the source of truth', () => {
    const text = read('README.md');
    assert.ok(/VISION\.md/.test(text), 'README.md must reference VISION.md');
    assert.ok(
        /source of truth/i.test(text),
        'README.md must frame VISION.md as the source of truth (not just a passing mention)'
    );
});

test('DOC-04: GO-LIVE.md and CLOUDFLARE-DEPLOY.md also reference VISION.md', () => {
    for (const rel of ['GO-LIVE.md', 'CLOUDFLARE-DEPLOY.md']) {
        assert.ok(/VISION\.md/.test(read(rel)), rel + ' must reference VISION.md');
    }
});

test('DOC-05: OWNER-CALENDAR-CAL-DIY.md carries an explicit deprecation banner', () => {
    const text = read('OWNER-CALENDAR-CAL-DIY.md');
    assert.ok(
        /SUPERSEDAT|SUPERSEDED|DEPRECATED/i.test(text),
        'OWNER-CALENDAR-CAL-DIY.md must carry an explicit SUPERSEDAT/DEPRECATED banner'
    );
    // Banner must appear before the old "Chosen path: option C" claim, not after.
    const bannerIdx = text.search(/SUPERSEDAT|SUPERSEDED|DEPRECATED/i);
    const chosenIdx = text.indexOf('Chosen path: option C');
    assert.ok(bannerIdx >= 0 && chosenIdx >= 0, 'both banner and original claim must exist');
    assert.ok(
        bannerIdx < chosenIdx,
        'the deprecation banner must appear before the superseded "Chosen path" claim'
    );
    assert.ok(
        /VISION\.md/.test(text),
        'the banner must point readers at VISION.md for the current architecture'
    );
});

test('DOC-06: GO-LIVE.md counts five designs (not four)', () => {
    const text = read('GO-LIVE.md');
    assert.ok(
        !/\bfour designs\b/i.test(text),
        'GO-LIVE.md must not say "four designs" — there are five shipped templates'
    );
    assert.ok(/\bfive designs\b/i.test(text), 'GO-LIVE.md must say "five designs"');
    assert.ok(
        /Desserdirina/.test(text),
        'GO-LIVE.md pre-launch checklist must name Desserdirina alongside the other four designs'
    );
});

test('DOC-08: templates/README.md schema.json example documents Romanian, not English', () => {
    const text = read(path.join('templates', 'README.md'));
    assert.ok(
        /"language":\s*"ro"/.test(text),
        'templates/README.md schema.json example must show "language": "ro"'
    );
});

test('templates/registry.json still has exactly five templates (sanity check for the "five designs" claims above)', () => {
    const registry = JSON.parse(read(path.join('templates', 'registry.json')));
    assert.strictEqual(
        registry.templates.length,
        5,
        'templates/registry.json must list exactly five templates — if this changes, ' +
            'the "five designs" docs fixed by this oracle need to change too'
    );
});
