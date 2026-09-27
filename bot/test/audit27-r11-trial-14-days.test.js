'use strict';
/**
 * Oracle: audit 2026-09-27, task R-11 — commercial docs must say 14-day
 * trial / charge on day 14 everywhere, and must never again say "7-day
 * trial" / "day 7" / "7 zile" / "ziua 7" next to trial/subscription wording.
 *
 * Findings fixed:
 *   docs-consistency#2            flow4's own REQUIRED_CURRENT regex asked
 *                                  for the stale "7-day trial" text instead
 *                                  of rejecting it (git show 2f1bb95 changed
 *                                  only the test's `name:` label, not `re:`).
 *   legal-cookies-attribution#2    VISION.md lines 19/32/35 still said
 *                                  "7 zile" / "ziua 7" though the product
 *                                  moved to 14 days six commits earlier.
 *
 * Run:  node --experimental-sqlite --test bot/test/audit27-r11-trial-14-days.test.js
 * Must FAIL on the pre-fix docs and PASS after the fix — do not weaken these
 * assertions to make them pass; fix the docs instead.
 */

const { test } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

// The full set of commercial docs this task owns (matches flow4's DOC_RELS).
const DOC_RELS = [
    'GO-LIVE.md',
    'README.md',
    'LAUNCH.md',
    path.join('bot', 'README.md'),
    path.join('bot', 'DEPLOY.md'),
    'CLOUDFLARE-DEPLOY.md',
    'VISION.md',
    'ARCHITECTURE.md',
    'PROJECT_STATUS.md',
];

function readDocs() {
    return DOC_RELS.map((rel) => {
        const abs = path.join(rootDir, rel);
        assert.ok(fs.existsSync(abs), rel + ' must exist');
        return { rel, text: fs.readFileSync(abs, 'utf8') };
    });
}

test('R-11: no doc says "7-day trial" / "7 day trial" near trial or subscription', () => {
    const docs = readDocs();
    const re = /\b7[-\s]?days?\s+trial\b/i;
    const hits = docs.filter((d) => re.test(d.text)).map((d) => d.rel);
    assert.strictEqual(
        hits.length,
        0,
        'stale "7-day trial" wording still present in: ' + hits.join(', ')
    );
});

test('R-11: no doc says "day 7" (the old auto-charge day)', () => {
    const docs = readDocs();
    const re = /\bday\s+7\b/i;
    const hits = docs.filter((d) => re.test(d.text)).map((d) => d.rel);
    assert.strictEqual(
        hits.length,
        0,
        '"day 7" still present in: ' + hits.join(', ')
    );
});

test('R-11 (RO): no doc says "7 zile" or "ziua 7"', () => {
    const docs = readDocs();
    const re7zile = /\b7\s+zile\b/i;
    const reziua7 = /\bziua\s+7\b/i;
    const hits = docs
        .filter((d) => re7zile.test(d.text) || reziua7.test(d.text))
        .map((d) => d.rel);
    assert.strictEqual(
        hits.length,
        0,
        '"7 zile" / "ziua 7" still present in: ' + hits.join(', ')
    );
});

test('R-11: every doc that mentions a trial length says 14 days / day 14', () => {
    const docs = readDocs();
    const mentionsTrial = docs.filter((d) => /\btrial\b/i.test(d.text));
    assert.ok(mentionsTrial.length > 0, 'at least one doc must discuss the trial');
    for (const d of mentionsTrial) {
        assert.ok(
            /\b14[-\s]?days?\b[\s\S]{0,20}\btrial\b|\btrial\b[\s\S]{0,20}\b14[-\s]?days?\b|\btrial(?:ul)?\s+de\s+14\s+zile\b|\btrial\b[\s\S]{0,10}\b14\s+zile\b/i.test(
                d.text
            ),
            d.rel + ' discusses the trial but never states "14-day (...) trial" / "trial de 14 zile"'
        );
    }
});

test('R-11: VISION.md records the owner GDPR self-service target (download + full deletion)', () => {
    const text = fs.readFileSync(path.join(rootDir, 'VISION.md'), 'utf8');
    assert.ok(
        /descarc[ăa].{0,20}date/i.test(text),
        'VISION.md must record the data-download GDPR target'
    );
    assert.ok(
        /[șs]terge.{0,20}cont/i.test(text),
        'VISION.md must record the full account-deletion GDPR target'
    );
});

test('R-11: VISION.md records the 29/year renewal + currency symbol owner decision', () => {
    const text = fs.readFileSync(path.join(rootDir, 'VISION.md'), 'utf8');
    assert.ok(/29\s*\/\s*an/i.test(text), 'VISION.md must state the 29/an renewal');
    assert.ok(
        /simbol.{0,20}(?:de\s+)?monedă|monedă.{0,20}simbol/i.test(text),
        'VISION.md must record the currency-symbol decision'
    );
});
