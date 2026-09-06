'use strict';
/**
 * Test: scripts/ops-secret-scan.js — zero-dependency static secret scanner.
 * Wave 6 ops audit (2026-09-06), item 4: "a scanner in CI is how that class
 * of thing gets caught early" (referring to the CAL/auth-fallback token leak
 * from the round-1 audit).
 *
 * Proves:
 *   - each real-secret-shaped pattern the scanner claims to catch is
 *     actually caught (AWS key, Stripe live key, private key block, Slack
 *     token, GitHub token, JWT-looking string);
 *   - obviously-fake/placeholder values that happen to match a pattern's
 *     shape are NOT flagged (this codebase's own tests use fake secrets
 *     like `sk_test_...` on purpose — a scanner that flags those trains
 *     people to ignore it);
 *   - scanning this repository's actual tracked files right now reports
 *     clean (regression guard: if this ever goes red, a real-secret-shaped
 *     string was committed);
 *   - the CLI itself exits 0 on a clean target and 1 (loudly, with the
 *     finding printed) on a dirty one — this is the exact contract
 *     .github/workflows/ci.yml's "security" job depends on, with no
 *     `|| true` after it.
 *
 * Run:  node bot/test/wave6-ops-secret-scan.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const { scanContent, scanFiles, isPlaceholder } = require('../../scripts/ops-secret-scan');

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

// ---------------------------------------------------------------------------
// Real-secret-shaped patterns are caught
// ---------------------------------------------------------------------------

// NOTE ON HOW THESE FIXTURES ARE WRITTEN: every "real-shaped" secret below is
// built via string concatenation (`'...' + '...'`) instead of one literal.
// This test file is itself git-tracked, and the "scans clean" check further
// down runs the real scanner over every tracked file including this one — a
// single contiguous literal here would make this file its own false
// positive (and, worse, would make CI's secret-scan step fail on this
// harmless fixture forever). Splitting the literal so the raw *source text*
// never contains the contiguous secret-shaped run of characters — while the
// runtime-concatenated `content` string handed to scanContent() very much
// does — sidesteps that without weakening what's actually being tested.
const REAL_SHAPED_CASES = [
    ['aws-access-key-id', 'const key = "AKIA' + '1234567890ABCDEF";'],
    ['stripe-live-secret-key', 'const s = "sk_live_' + '51H8abcdefghijklmnopqrst";'],
    ['stripe-live-restricted-key', 'const s = "rk_live_' + '51H8abcdefghijklmnopqrst";'],
    ['private-key-block', '-----BEGIN RSA PRIVATE KEY' + '-----\nMIIB...\n-----END RSA PRIVATE KEY-----'],
    ['slack-token', 'const t = "xoxb-' + '1234567890-abcdefghijklmnopqrst";'],
    ['github-token', 'const t = "ghp_' + 'abcdefghijklmnopqrstuvwxyzABCDEFGH12";'],
    ['generic-jwt', 'const t = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'dQw4w9WgXcQ_abcdefgh";'],
];

for (const [id, content] of REAL_SHAPED_CASES) {
    check(`scanContent flags a real-shaped "${id}"`, () => {
        const findings = scanContent('fixture.js', content);
        assert.ok(findings.some((f) => f.id === id), `expected a "${id}" finding in: ${JSON.stringify(findings)}`);
    });
}

// ---------------------------------------------------------------------------
// Placeholders / obviously-fake values are NOT flagged
// ---------------------------------------------------------------------------

const PLACEHOLDER_CASES = [
    'const key = "AKIAEXAMPLEFAKEKEY01";', // AWS-shaped but contains "EXAMPLE"
    'const s = "sk_test_51H8abcdefghijklmnopqrst";', // this codebase's own test-mode Stripe key shape
    'const w = "whsec_test_secret_123";', // literally used in bot/test/webhook.test.js
];

for (const content of PLACEHOLDER_CASES) {
    check(`scanContent does not flag placeholder value: ${JSON.stringify(content)}`, () => {
        const findings = scanContent('fixture.js', content);
        assert.deepStrictEqual(findings, [], `expected no findings, got ${JSON.stringify(findings)}`);
    });
}

check('isPlaceholder() recognizes common fake-secret hints case-insensitively', () => {
    assert.strictEqual(isPlaceholder('AKIA-EXAMPLE-KEY'), true);
    assert.strictEqual(isPlaceholder('sk_live_' + 'TOTALLYREALLOOKINGVALUE1234567890'), false);
});

check('this test file\'s own on-disk source contains no contiguous real-shaped secret (guards the concatenation trick above against a future careless edit, independent of git-tracked timing)', () => {
    const selfSource = fs.readFileSync(__filename, 'utf8');
    const findings = scanContent(path.relative(REPO_ROOT, __filename), selfSource);
    assert.deepStrictEqual(findings, [], `this file itself would fail CI's secret scan: ${JSON.stringify(findings, null, 2)}`);
});

// ---------------------------------------------------------------------------
// This repository, right now, scans clean (regression guard)
// ---------------------------------------------------------------------------

check('scanFiles() over every git-tracked file in this repo reports zero findings', () => {
    const findings = scanFiles();
    assert.deepStrictEqual(findings, [], `unexpected secret-shaped finding(s) in the repo: ${JSON.stringify(findings, null, 2)}`);
});

// ---------------------------------------------------------------------------
// CLI contract: exit 0 clean, exit 1 + printed finding dirty, no `|| true`
// escape hatch anywhere that matters (that part is a CI-file review, not
// testable here, but the exit code contract the workflow depends on is).
// ---------------------------------------------------------------------------

const scannerPath = path.join(REPO_ROOT, 'scripts', 'ops-secret-scan.js');

check('CLI exits 0 on a known-clean file', () => {
    const res = spawnSync(process.execPath, [scannerPath, '--files', 'package.json'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `stdout=${res.stdout}\nstderr=${res.stderr}`);
    assert.match(res.stdout, /clean/);
});

const fixtureRelPath = path.join('bot', 'test', `.tmp-wave6-secret-fixture-${process.pid}.js`);
const fixtureFullPath = path.join(REPO_ROOT, fixtureRelPath);
try {
    fs.writeFileSync(fixtureFullPath, 'const key = "AKIA' + '1234567890ABCDEF"; // deliberately planted for this test\n');
    check('CLI exits 1 and prints the finding on a file with a real-shaped secret', () => {
        const res = spawnSync(process.execPath, [scannerPath, '--files', fixtureRelPath], { cwd: REPO_ROOT, encoding: 'utf8' });
        assert.strictEqual(res.status, 1, `expected exit 1, stdout=${res.stdout}\nstderr=${res.stderr}`);
        assert.match(res.stderr, /aws-access-key-id/);
        assert.match(res.stderr, new RegExp(fixtureRelPath.replace(/\\/g, '\\\\')));
    });
} finally {
    try { fs.unlinkSync(fixtureFullPath); } catch (_) { /* best effort cleanup */ }
}

if (failed) {
    console.error('wave6-ops-secret-scan.test.js: FAILED');
    process.exit(1);
}
console.log('wave6-ops-secret-scan.test.js: toate testele au trecut');
