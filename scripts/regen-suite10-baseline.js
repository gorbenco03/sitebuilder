#!/usr/bin/env node
'use strict';
/**
 * scripts/regen-suite10-baseline.js — regenerate the frozen public-render
 * baseline that bot/test/suite10-instagram-teaser-never-published.test.js
 * compares against byte-for-byte.
 *
 * READ bot/test/fixtures/suite10-baseline/README.md BEFORE RUNNING THIS.
 * In short: a byte diff in that test is legitimate to silence with a
 * refresh ONLY when it comes from an unrelated, intentional template
 * change (copy fix, new photo, markup tweak, …). It is NOT legitimate to
 * refresh — and this script will refuse — when the diff exists because
 * Instagram-teaser markup (or its connect-button/example-tile filenames)
 * reached the public render. That is the exact bug the guard exists to
 * catch; refreshing the fixture in that case does not fix anything, it
 * just stops the test from noticing.
 *
 * Usage:
 *   node scripts/regen-suite10-baseline.js            # dry run: prints a
 *                                                       diff summary only,
 *                                                       writes nothing.
 *   node scripts/regen-suite10-baseline.js --write     # after you have
 *                                                       read the dry-run
 *                                                       output and confirmed
 *                                                       every change is
 *                                                       teaser-unrelated,
 *                                                       writes the new
 *                                                       fixtures + manifest.
 *
 * Even with --write, this script hard-refuses (exit 1, nothing written) if
 * any newly-rendered preset contains the teaser markers
 * (hb-ig-teaser / data-hb-ig-teaser / data-hb-ig-connect) — so this tool
 * cannot itself be used, even by mistake, to launder a real leak into the
 * "trusted" baseline.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const TEMPLATES = ['product-menu', 'portfolio', 'local-service', 'professionals', 'desserdirina'];
const OUT = path.join(ROOT, 'bot', 'test', 'fixtures', 'suite10-baseline');

const WRITE = process.argv.includes('--write');

const TEASER_MARKERS = ['hb-ig-teaser', 'data-hb-ig-teaser', 'data-hb-ig-connect'];

function gitHead() {
    try {
        return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
    } catch (e) {
        return 'UNKNOWN (git rev-parse HEAD failed: ' + e.message + ')';
    }
}

function main() {
    const manifestPath = path.join(OUT, 'manifest.json');
    const oldManifest = fs.existsSync(manifestPath)
        ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        : { generatedAtCommit: null, templates: {} };

    const changes = [];
    const newFiles = new Map(); // absolute path -> content
    const newManifest = { generatedAtCommit: gitHead(), templates: {} };
    const leakDetected = [];

    for (const tpl of TEMPLATES) {
        const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', tpl, 'template.html'), 'utf8');
        const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')).presets;
        newManifest.templates[tpl] = [];

        for (const p of presets) {
            const html = renderHtml(templateHtml, p.config); // no opts => public path
            const relFile = tpl + '/' + p.id + '.html';
            const absFile = path.join(OUT, relFile);

            for (const marker of TEASER_MARKERS) {
                if (html.includes(marker)) {
                    leakDetected.push(`${tpl}/${p.id}: public render contains "${marker}"`);
                }
            }

            let oldHtml = null;
            try { oldHtml = fs.readFileSync(absFile, 'utf8'); } catch (e) { /* new preset */ }

            if (oldHtml === null) {
                changes.push(`NEW      ${relFile} (${html.length}B) — no prior fixture, this preset was added since baseline capture`);
            } else if (oldHtml !== html) {
                changes.push(`CHANGED  ${relFile} (${oldHtml.length}B -> ${html.length}B)`);
            }

            newFiles.set(absFile, html);
            newManifest.templates[tpl].push({ id: p.id, file: relFile, bytes: html.length });
        }
    }

    // Anything the old manifest had that no longer renders (preset removed).
    for (const [tpl, entries] of Object.entries(oldManifest.templates || {})) {
        for (const entry of entries) {
            const stillPresent = (newManifest.templates[tpl] || []).some((e) => e.id === entry.id);
            if (!stillPresent) changes.push(`REMOVED  ${entry.file} — preset no longer exists`);
        }
    }

    if (leakDetected.length) {
        console.error('\nREFUSING TO WRITE — teaser marker(s) found in the public render:\n  ' + leakDetected.join('\n  '));
        console.error(
            '\nThis is very likely the Instagram-teaser guard doing exactly what it is for: ' +
            'the teaser (or its connect button / example tiles) is reaching the PUBLIC render path. ' +
            'Refreshing the fixture would hide this, not fix it. See ' +
            'bot/test/fixtures/suite10-baseline/README.md ("when NOT to refresh") before doing anything else.'
        );
        process.exit(1);
    }

    if (!changes.length) {
        console.log('No differences from the current baseline — nothing to do.');
        return;
    }

    console.log('Baseline diff vs. bot/test/fixtures/suite10-baseline/ (commit ' + (oldManifest.generatedAtCommit || 'unknown') + '):\n');
    console.log('  ' + changes.join('\n  '));
    console.log('');

    if (!WRITE) {
        console.log(
            'Dry run only — nothing written. If (and only if) every change above is explained by an ' +
            'intentional, Instagram-teaser-UNRELATED template edit (re-read ' +
            'bot/test/fixtures/suite10-baseline/README.md if unsure), re-run with --write to update the ' +
            'fixtures and manifest.json.'
        );
        return;
    }

    for (const [absFile, html] of newFiles) {
        fs.mkdirSync(path.dirname(absFile), { recursive: true });
        fs.writeFileSync(absFile, html, 'utf8');
    }
    // Remove fixture files for presets that no longer exist.
    for (const [tpl, entries] of Object.entries(oldManifest.templates || {})) {
        for (const entry of entries) {
            const stillPresent = (newManifest.templates[tpl] || []).some((e) => e.id === entry.id);
            if (!stillPresent) {
                const stale = path.join(OUT, entry.file);
                if (fs.existsSync(stale)) fs.unlinkSync(stale);
            }
        }
    }
    fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2) + '\n', 'utf8');
    console.log('Wrote ' + newFiles.size + ' fixture file(s) and manifest.json at commit ' + newManifest.generatedAtCommit + '.');
}

main();
