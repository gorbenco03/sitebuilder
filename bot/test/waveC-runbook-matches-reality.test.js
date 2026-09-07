'use strict';
/**
 * bot/test/waveC-runbook-matches-reality.test.js
 *
 * Operational documentation that contradicts the code is worse than none: it is
 * read at the moment someone can least afford to be misled.
 *
 * BACKUP-RESTORE.md stated, verbatim, "This repo does not currently ship a
 * wrapper script for this" and "An automated backup script or cron job — none
 * exists in this repo yet", while scripts/ops-backup.js and
 * scripts/ops-restore.js had been in the tree — and deliberately kept in the
 * production Docker image — for some time. An operator restoring a corrupted
 * database at 3am would have concluded they had to improvise. The doc also
 * mentioned neither script by name, so searching would not have found them
 * either, and ops-backup.js pointed readers at a HANDOFF-ops.md that no longer
 * exists.
 *
 * GO-LIVE.md said "Custom domains are concierge, not self-service... it is
 * manual work per customer — price it in", while bot/domains.js implements the
 * connect/verify/disconnect flow and the editor exposes it. A pricing decision
 * was resting on a fact that had stopped being true.
 *
 * This checks the claims, not the prose: every operational script the runbook
 * exists to describe must be named in it, and no document may assert the
 * absence of something the repository ships.
 *
 * Run: node --test bot/test/waveC-runbook-matches-reality.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the backup runbook names the tooling the repository actually ships', () => {
    const scripts = ['scripts/ops-backup.js', 'scripts/ops-restore.js'];
    for (const s of scripts) {
        assert.ok(fs.existsSync(path.join(ROOT, s)), `${s} is expected to exist`);
    }
    const doc = read('BACKUP-RESTORE.md');
    for (const s of scripts) {
        const name = path.basename(s);
        assert.ok(
            doc.includes(name),
            `BACKUP-RESTORE.md never mentions ${name}. An operator reading the runbook during an ` +
            `incident would not learn it exists, and searching the doc would not find it.`
        );
    }
});

test('no operational document claims a shipped capability is missing', () => {
    const claims = [
        ['BACKUP-RESTORE.md', /does not currently ship a wrapper script/i,
            'scripts/ops-backup.js is that wrapper script'],
        ['BACKUP-RESTORE.md', /none exists in this repo yet/i,
            'scripts/ops-backup.js exists; only the schedule that runs it does not'],
        ['GO-LIVE.md', /custom domains are concierge\*{0,2},? not self-service/i,
            'bot/domains.js implements the self-serve flow and the editor exposes it'],
    ];
    const failures = [];
    for (const [file, pattern, why] of claims) {
        const body = read(file);
        const m = body.match(pattern);
        if (m) {
            const line = body.slice(0, m.index).split('\n').length;
            failures.push(`${file}:${line} claims "${m[0]}" — ${why}`);
        }
    }
    assert.deepStrictEqual(failures, [], 'documents contradicting the code:\n' + failures.join('\n'));
});

test('operational scripts do not cross-reference files that were deleted', () => {
    const failures = [];
    for (const rel of ['scripts/ops-backup.js', 'scripts/ops-restore.js']) {
        const body = read(rel);
        for (const m of body.matchAll(/\b([A-Z][A-Z0-9-]+\.md)\b/g)) {
            if (!fs.existsSync(path.join(ROOT, m[1]))) {
                failures.push(`${rel} points at ${m[1]}, which is not in the repository`);
            }
        }
    }
    assert.deepStrictEqual(failures, [], 'dangling documentation references:\n' + failures.join('\n'));
});
