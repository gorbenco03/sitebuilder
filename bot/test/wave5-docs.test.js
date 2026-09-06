'use strict';
/**
 * bot/test/wave5-docs.test.js — mechanical checks for the docs/repo-hygiene
 * wave that closed audit report `04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md`
 * §4 medium findings #17 (template count varies), #18 (bot/web.js undocumented),
 * #19 (missing ARCHITECTURE.md/CHANGELOG/LICENSE/backup runbook), #20 (VISION.md
 * self-contradiction §8 vs §11 Flow 4).
 *
 * This only checks what is mechanically checkable: files exist, counts match,
 * commands documented match commands that actually work, no known-bad phrases
 * regressed. It cannot verify prose accuracy — that was done by hand against
 * the code at commit 8a13c19 when these docs were written.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-docs.test.js
 * (Must FAIL on the pre-fix repo and PASS after — do not weaken assertions to
 * make them pass; fix the docs instead.)
 */

const { test } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

function read(rel) {
    return fs.readFileSync(path.join(rootDir, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(rootDir, rel));
}

// ---------------------------------------------------------------------------
// #19 — baseline documents exist and are not stubs
// ---------------------------------------------------------------------------

test('WAVE5-19: ARCHITECTURE.md, CHANGELOG.md, LICENSE, BACKUP-RESTORE.md all exist and are non-trivial', () => {
    for (const rel of ['ARCHITECTURE.md', 'CHANGELOG.md', 'LICENSE', 'BACKUP-RESTORE.md']) {
        assert.ok(exists(rel), rel + ' must exist at the repo root');
        const text = read(rel);
        assert.ok(
            text.length > 500,
            rel + ' must be a real document, not a stub (got ' + text.length + ' bytes)'
        );
    }
});

test('WAVE5-19: ARCHITECTURE.md names the real entry points and data layer', () => {
    const text = read('ARCHITECTURE.md');
    for (const needle of [
        'bot/web.js',
        'bot/bot.js',
        'bot/server.js',
        'registry-sqlite.js',
        'registry-db.js',
        'calendar-native',
        'build.js',
    ]) {
        assert.ok(text.includes(needle), 'ARCHITECTURE.md must mention ' + needle);
    }
});

test('WAVE5-19: every bot/ file ARCHITECTURE.md names by path actually exists', () => {
    const text = read('ARCHITECTURE.md');
    const re = /`(bot\/[A-Za-z0-9_\-./]+\.js)`/g;
    let m;
    const checked = new Set();
    while ((m = re.exec(text))) {
        const rel = m[1];
        if (checked.has(rel)) continue;
        checked.add(rel);
        assert.ok(exists(rel), 'ARCHITECTURE.md references ' + rel + ' which does not exist');
    }
    assert.ok(checked.size >= 8, 'expected ARCHITECTURE.md to name at least 8 distinct bot/*.js files, got ' + checked.size);
});

test('WAVE5-19: BACKUP-RESTORE.md documents both SQLite stores under DATA_DIR', () => {
    const text = read('BACKUP-RESTORE.md');
    assert.ok(/registry\.sqlite/.test(text), 'must document registry.sqlite');
    assert.ok(/calendar-native\.sqlite/.test(text), 'must document calendar-native.sqlite');
    assert.ok(/WAL/i.test(text), 'must explain WAL-mode backup safety, not just "copy the file"');
    assert.ok(/\.backup/.test(text), 'must document the sqlite3 .backup command (or equivalent online-safe method)');
});

test('WAVE5-19: LICENSE names its own scope/status honestly (not a bare stub)', () => {
    const text = read('LICENSE');
    assert.ok(/Hidook/.test(text), 'LICENSE should identify the product/holder');
    assert.ok(
        /owner|confirm/i.test(text),
        'LICENSE must acknowledge this is a default pending explicit owner confirmation, not silently assert authority it does not have'
    );
});

// ---------------------------------------------------------------------------
// #18 — bot/web.js is the real production entry point and must appear in docs
// ---------------------------------------------------------------------------

test('WAVE5-18: bot/web.js exists and is documented in README.md', () => {
    assert.ok(exists('bot/web.js'), 'bot/web.js must exist');
    const readme = read('README.md');
    assert.ok(/bot\/web\.js/.test(readme) || /\bweb\.js\b/.test(readme), 'README.md must mention bot/web.js');
});

test('WAVE5-18: bot/README.md and bot/DEPLOY.md document web.js as the production entry point', () => {
    for (const rel of ['bot/README.md', 'bot/DEPLOY.md']) {
        const text = read(rel);
        assert.ok(/web\.js/.test(text), rel + ' must mention web.js');
    }
});

// ---------------------------------------------------------------------------
// #17 — template count must agree everywhere: there are five
// ---------------------------------------------------------------------------

test('WAVE5-17: templates/registry.json lists exactly five templates', () => {
    const registry = JSON.parse(read(path.join('templates', 'registry.json')));
    assert.strictEqual(registry.templates.length, 5, 'templates/registry.json must list exactly five templates');
});

test('WAVE5-17: no owned doc affirmatively claims "four" templates/design systems', () => {
    const docs = [
        'README.md', 'AGENTS.md', 'VISION.md', 'PRODUCT.md', 'LAUNCH.md',
        'GO-LIVE.md', 'CLOUDFLARE-DEPLOY.md', 'OWNER-STRIPE-TRIAL.md',
        'OWNER-CALENDAR-CAL-DIY.md', path.join('bot', 'README.md'),
        path.join('bot', 'DEPLOY.md'), path.join('templates', 'README.md'),
    ];
    const badPatterns = [
        /\bfour\s+(commercial\s+systems|design\s+systems|designs|templates|șabloane|sisteme)\b/i,
        /\bpatru\s+(sisteme|șabloane)\b/i,
    ];
    for (const rel of docs) {
        if (!exists(rel)) continue; // this oracle only checks docs that exist
        const text = read(rel);
        for (const re of badPatterns) {
            assert.ok(
                !re.test(text),
                rel + ' must not affirmatively count "four" templates/systems — there are five (templates/registry.json)'
            );
        }
    }
});

test('WAVE5-17: five-count docs (GO-LIVE, LAUNCH, templates/README) still say five and name the fifth template', () => {
    for (const rel of ['GO-LIVE.md', 'LAUNCH.md', path.join('templates', 'README.md')]) {
        const text = read(rel);
        assert.ok(/five/i.test(text), rel + ' must count five design systems');
        // The fifth template is named "Desserdirina" in most docs, but LAUNCH.md
        // names it descriptively ("bakery/patisserie remake") — either is a
        // legitimate reference to the same, real fifth template; what matters is
        // that it is not silently dropped to a count of four.
        assert.ok(
            /[Dd]esserdirina/.test(text) || /bakery|patisserie/i.test(text),
            rel + ' must name or describe the fifth template (Desserdirina) among the five'
        );
    }
});

// ---------------------------------------------------------------------------
// #20 — VISION.md must not contradict itself: §8 native calendar vs §11 Flow 4
// ---------------------------------------------------------------------------

test('WAVE5-20: VISION.md §8 still locks the native Hidook calendar decision', () => {
    const text = read('VISION.md');
    assert.ok(/LOCKED/.test(text), 'VISION.md §8 must carry the LOCKED marker');
    assert.ok(/nativ Hidook/.test(text), 'VISION.md §8 must name the native Hidook calendar');
});

test('WAVE5-20: VISION.md Flow 4 no longer treats Cal.com as a co-equal calendar architecture without a superseded marker', () => {
    const text = read('VISION.md');
    const flow4Idx = text.indexOf('Flow 4');
    assert.ok(flow4Idx >= 0, 'VISION.md must still have a Flow 4 section');
    const flow4Section = text.slice(flow4Idx, flow4Idx + 4000);
    assert.ok(
        /SUPERSEDAT/.test(flow4Section),
        'the Flow 4 section must carry an explicit SUPERSEDAT marker on the old Cal.com-as-architecture wording (audit medium #20)'
    );
    assert.ok(
        /arhitectura de calendar a produsului/.test(flow4Section),
        'Flow 4 must explicitly say the native calendar (not Cal.com) is the product calendar architecture, per §8'
    );
    // The superseded marker must appear before the literal old sentence, not after —
    // same ordering contract as the OWNER-CALENDAR-CAL-DIY.md banner check in
    // audit-docs-round2.test.js.
    const supersededIdx = flow4Section.search(/SUPERSEDAT/);
    const oldSentenceIdx = flow4Section.indexOf('poate lipi un link Cal.com valid');
    if (oldSentenceIdx >= 0) {
        assert.ok(
            supersededIdx < oldSentenceIdx,
            'the SUPERSEDAT marker must appear before the preserved old sentence, not after'
        );
    }
});

// ---------------------------------------------------------------------------
// Test command must be documented correctly — extends DOC-02 from
// audit-docs-round2.test.js with the --experimental-sqlite flag that the
// SQLite registry backend requires on Node < 22.5.
// ---------------------------------------------------------------------------

test('WAVE5-DOC: package.json "test" script includes --experimental-sqlite, --test, and the right glob', () => {
    const pkg = JSON.parse(read('package.json'));
    const testScript = String((pkg.scripts && pkg.scripts.test) || '');
    assert.ok(testScript.length > 0, 'package.json must define a "test" script');
    assert.ok(/--experimental-sqlite\b/.test(testScript), 'the "test" script must pass --experimental-sqlite, got: ' + testScript);
    assert.ok(/--test\b/.test(testScript), 'the "test" script must use `node --test`, got: ' + testScript);
    assert.ok(/bot\/test\/\*\.test\.js/.test(testScript), 'the "test" script must target bot/test/*.test.js, got: ' + testScript);
});

test('WAVE5-DOC: README.md, AGENTS.md and LAUNCH.md document the --experimental-sqlite flag', () => {
    for (const rel of ['README.md', 'AGENTS.md', 'LAUNCH.md']) {
        const text = read(rel);
        assert.ok(
            /--experimental-sqlite/.test(text),
            rel + ' must mention --experimental-sqlite next to the test command'
        );
    }
});

test('WAVE5-DOC: the documented `node build.js` / build(dir) recipe actually runs and resolves every token', () => {
    // Exercises the exact recipe templates/README.md teaches ("Build and test
    // command"), just against the root sample config instead of a template
    // preset, since the root config.json/template.html are always present.
    const { build } = require(path.join(rootDir, 'build.js'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-docs-build-'));
    fs.copyFileSync(path.join(rootDir, 'config.json'), path.join(tmp, 'config.json'));
    fs.copyFileSync(path.join(rootDir, 'template.html'), path.join(tmp, 'template.html'));
    assert.doesNotThrow(() => build(tmp), 'build(dir) must not throw against a valid config.json + template.html');
    const outPath = path.join(tmp, 'index.html');
    assert.ok(fs.existsSync(outPath), 'build() must write index.html');
    const html = fs.readFileSync(outPath, 'utf8');
    const unresolved = (html.match(/\{\{/g) || []).length;
    assert.strictEqual(unresolved, 0, 'generated index.html must have zero unresolved {{ tokens, found ' + unresolved);
    fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Repository-weight forward policy — mechanical parts only (the policy prose
// itself lives in AGENTS.md; this just checks the guardrails are wired).
// ---------------------------------------------------------------------------

test('WAVE5-WEIGHT: .gitignore and .gitattributes carry the QA-evidence / sqlite forward-hygiene patterns', () => {
    assert.ok(exists('.gitattributes'), '.gitattributes must exist');
    const gitignore = read('.gitignore');
    const gitattributes = read('.gitattributes');
    assert.ok(/\*\.sqlite\b/.test(gitignore), '.gitignore must ignore *.sqlite going forward');
    assert.ok(/04-QA-Evidence/.test(gitignore), '.gitignore must reference 04-QA-Evidence patterns');
    assert.ok(/04-QA-Evidence/.test(gitattributes), '.gitattributes must mark 04-QA-Evidence binary types');
});

test('WAVE5-WEIGHT: AGENTS.md documents the QA-evidence forward policy and the git-stash hazard', () => {
    const text = read('AGENTS.md');
    assert.ok(/QA evidence policy|Repository weight/i.test(text), 'AGENTS.md must document the QA evidence forward policy');
    assert.ok(/git stash/.test(text), 'AGENTS.md must document the git stash hazard rule');
    assert.ok(/refs\/stash/.test(text), 'AGENTS.md must explain that refs/stash is shared across worktrees');
    assert.ok(/git stash list/.test(text), 'AGENTS.md must reference the residual stash inventory');
});

test('WAVE5-WEIGHT: HANDOFF-docs.md exists and names the untracked-sqlite handoff', () => {
    assert.ok(exists('HANDOFF-docs.md'), 'HANDOFF-docs.md must exist');
    const text = read('HANDOFF-docs.md');
    assert.ok(/registry\.sqlite/.test(text), 'HANDOFF-docs.md must describe the bot/registry.sqlite tracking issue');
});
