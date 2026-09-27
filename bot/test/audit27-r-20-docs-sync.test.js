'use strict';
/**
 * Audit 2026-09-27, task R-20 (docs-consistency#3, #4, #5): technical docs
 * kept current without touching product code.
 *
 * Verified against code, not asserted from memory:
 *   - docs-consistency#3: bot/server.js:4124-4137 (grep "invoicesMatch"/"domainMatch")
 *     implements GET /api/sites/:id/invoices and the custom-domain routes,
 *     wired from builder/app.js's "Facturi"/"Domeniu" buttons, but neither
 *     ARCHITECTURE.md's route summary nor its Payments section named them.
 *   - docs-consistency#4: PROJECT_STATUS.md's header was frozen at
 *     "Actualizat: 2026-09-05", 22 days and 100+ commits behind HEAD.
 *   - docs-consistency#5: CHANGELOG.md's newest entry was 2026-09-12 and
 *     never recorded the 7->14 day trial change (2f1bb95, 2026-09-21) the
 *     audit itself was verifying.
 *
 * This test only checks what is mechanically checkable (file content,
 * dates, SHA citations) — it cannot verify prose accuracy, and it does not
 * touch bot/server.js (read-only per the task's HARD RULES).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-20-docs-sync.test.js
 * Must FAIL against the pre-fix docs (commit 958726f) and PASS after.
 */

const { test } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

function read(rel) {
    return fs.readFileSync(path.join(rootDir, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// docs-consistency#3 — ARCHITECTURE.md must name the custom-domain and
// invoice routes that bot/server.js actually implements (read-only check;
// server.js itself is out of scope for this task).
// ---------------------------------------------------------------------------

test('R-20: ARCHITECTURE.md documents the invoice-history route', () => {
    const text = read('ARCHITECTURE.md');
    assert.ok(
        /\/api\/sites\/:id\/invoices/.test(text),
        'ARCHITECTURE.md must mention GET /api/sites/:id/invoices'
    );
});

test('R-20: ARCHITECTURE.md documents the self-serve custom-domain routes', () => {
    const text = read('ARCHITECTURE.md');
    assert.ok(
        /\/api\/sites\/:id\/domain/.test(text),
        'ARCHITECTURE.md must mention the /api/sites/:id/domain* routes'
    );
    assert.ok(
        /bot\/domains\.js/.test(text),
        'ARCHITECTURE.md must name bot/domains.js as the module behind the custom-domain routes'
    );
});

test('R-20: ARCHITECTURE.md ties both features to how a customer reaches them', () => {
    const text = read('ARCHITECTURE.md');
    assert.ok(
        /Facturi|Invoice history/i.test(text),
        'ARCHITECTURE.md must reference the dashboard "Facturi" entry point for invoice history'
    );
    assert.ok(
        /Domeniu|openDomainModal/i.test(text),
        'ARCHITECTURE.md must reference the dashboard "Domeniu" entry point for custom domains'
    );
});

// ---------------------------------------------------------------------------
// docs-consistency#4 — PROJECT_STATUS.md must not be frozen at 2026-09-05.
// ---------------------------------------------------------------------------

test('R-20: PROJECT_STATUS.md header is no longer dated 2026-09-05', () => {
    const text = read('PROJECT_STATUS.md');
    const headerLine = text.split('\n').find((l) => l.startsWith('Actualizat:'));
    assert.ok(headerLine, 'PROJECT_STATUS.md must have an "Actualizat:" header line');
    assert.ok(
        !/Actualizat:\s*2026-09-05\b/.test(headerLine),
        'PROJECT_STATUS.md header must move past the stale 2026-09-05 date, got: ' + headerLine
    );
});

test('R-20: PROJECT_STATUS.md records the 2026-09-27 audit and its round-1 remediation', () => {
    const text = read('PROJECT_STATUS.md');
    assert.ok(
        /PLAN-AUDIT-2026-09-27\.md/.test(text),
        'PROJECT_STATUS.md must cite PLAN-AUDIT-2026-09-27.md'
    );
    assert.ok(
        /wf_f7ec38f0-c31/.test(text),
        'PROJECT_STATUS.md must cite the round-1 remediation merge (wf_f7ec38f0-c31-* worktrees)'
    );
});

// ---------------------------------------------------------------------------
// docs-consistency#5 — CHANGELOG.md must record the 7->14 day trial change
// and the 2026-09-27 audit, not stop at 2026-09-12.
// ---------------------------------------------------------------------------

test('R-20: CHANGELOG.md records the 7-day to 14-day trial change (2f1bb95)', () => {
    const text = read('CHANGELOG.md');
    assert.ok(/2f1bb95/.test(text), 'CHANGELOG.md must cite the 2f1bb95 commit');
    assert.ok(
        /\b7\b[\s\S]{0,40}\b14\b|\b14\b[\s\S]{0,40}\b7\b/.test(text),
        'CHANGELOG.md must describe the trial moving from 7 to 14 days'
    );
});

test('R-20: CHANGELOG.md has a 2026-09-27 entry newer than its old 2026-09-12 ceiling', () => {
    const text = read('CHANGELOG.md');
    assert.ok(/^## 2026-09-27/m.test(text), 'CHANGELOG.md must have a 2026-09-27 heading');
    const firstHeadingIdx = text.search(/^## \d{4}-\d{2}-\d{2}/m);
    assert.ok(firstHeadingIdx >= 0, 'CHANGELOG.md must have at least one dated heading');
    const firstHeading = text.slice(firstHeadingIdx, firstHeadingIdx + 20);
    assert.ok(
        firstHeading.startsWith('## 2026-09-27'),
        'the newest (topmost) CHANGELOG.md entry must be 2026-09-27, got: ' + firstHeading.split('\n')[0]
    );
});
