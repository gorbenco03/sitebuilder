#!/usr/bin/env node
'use strict';
/**
 * scripts/ops-secret-scan.js — zero-dependency static secret scanner.
 *
 * Audit context (DI, 2026-09-06): a critical bug let an auth fallback leak
 * login tokens. A scanner in CI is how that class of bug gets caught before
 * it merges, not after a customer reports it. This repo ships zero runtime
 * dependencies on purpose (see README/package.json); rather than add a
 * third-party GitHub Action as a CI-only dependency, this is a small,
 * auditable, in-repo scanner that can also be run and verified locally with
 * nothing but Node — no network access, no installed tool, required.
 *
 * Scope: every file `git ls-files` reports (i.e. tracked, respects
 * .gitignore) minus a small binary/generated-asset exclude list, checked
 * against a set of precise, high-confidence patterns for real secret
 * formats (cloud provider keys, live payment keys, private key blocks,
 * platform tokens). Generic "password = ..." style patterns are
 * deliberately NOT included as unqualified rules — this codebase's own test
 * suite is full of intentionally-fake secrets (`whsec_test_secret_123`,
 * `sk_test_...`, etc.) and a scanner that cries wolf on its own fixtures
 * trains everyone to ignore it. The PLACEHOLDER_HINTS list below still
 * exempts the handful of obviously-fake values that slip through a precise
 * pattern (e.g. a live-shaped key made of repeated "x" for a table in the
 * docs) so the true-positive patterns can stay strict without false drops.
 *
 * Exit code: 0 if clean, 1 if any finding — this is meant to run in CI with
 * NO `|| true` after it (see .github/workflows/ci.yml).
 *
 * Usage:
 *   node scripts/ops-secret-scan.js            # scan tracked files
 *   node scripts/ops-secret-scan.js --files a.js b.js   # scan specific files (tests)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

// Extensions that are never worth regex-scanning (binary or generated).
const BINARY_EXT = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.zip', '.gz',
    '.sqlite', '.sqlite3', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mov',
    '.svg', // some SVGs are huge/binary-ish exports; text patterns below don't apply
]);

// Precise, high-confidence real-secret patterns. Each has a short id used in
// findings output and a `redactGroup` telling us how much of the match is
// safe to print (never print the actual secret material to logs/CI output).
const PATTERNS = [
    { id: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { id: 'aws-secret-access-key', re: /\baws(?:_|\s)?(?:secret|access)?(?:_|\s)?key\b\s*[:=]\s*['"][0-9a-zA-Z/+]{40}['"]/gi },
    { id: 'stripe-live-secret-key', re: /\bsk_live_[0-9a-zA-Z]{16,}\b/g },
    { id: 'stripe-live-restricted-key', re: /\brk_live_[0-9a-zA-Z]{16,}\b/g },
    { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
    { id: 'slack-token', re: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/g },
    { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
    { id: 'telegram-bot-token', re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
    { id: 'generic-jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

// Values that match a pattern shape but are known-fake / documentation
// placeholders. Matched case-insensitively as a substring of the finding.
const PLACEHOLDER_HINTS = [
    'test', 'example', 'placeholder', 'fake', 'dummy', 'changeme', 'xxxxxxxx',
    'your-', 'sample', 'redacted', '000000', '111111',
];

function isPlaceholder(matchText) {
    const lower = matchText.toLowerCase();
    return PLACEHOLDER_HINTS.some((hint) => lower.includes(hint));
}

function listTrackedFiles() {
    try {
        const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
        return out.split('\n').filter(Boolean);
    } catch (e) {
        throw new Error(`ops-secret-scan: could not list git-tracked files: ${e.message}`);
    }
}

/**
 * Scan one file's content for all patterns.
 * @param {string} relPath  path relative to repo root (used only for reporting)
 * @param {string} content
 * @returns {Array<{id:string, file:string, line:number}>}
 */
function scanContent(relPath, content) {
    const findings = [];
    const lines = content.split('\n');
    for (const { id, re } of PATTERNS) {
        for (const line of lines) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(line))) {
                if (!isPlaceholder(m[0])) {
                    findings.push({ id, file: relPath, line: lines.indexOf(line) + 1 });
                }
                if (!re.global) break;
            }
        }
    }
    return findings;
}

/**
 * @param {string[]} [fileList]  relative paths to scan; defaults to every
 *                                git-tracked file (minus binary extensions)
 * @returns {Array<{id:string, file:string, line:number}>}
 */
function scanFiles(fileList) {
    const files = fileList || listTrackedFiles();
    const findings = [];
    for (const rel of files) {
        const ext = path.extname(rel).toLowerCase();
        if (BINARY_EXT.has(ext)) continue;
        const full = path.join(REPO_ROOT, rel);
        let content;
        try {
            content = fs.readFileSync(full, 'utf8');
        } catch (_) {
            continue; // deleted/unreadable/binary-that-throws-on-utf8 — skip
        }
        findings.push(...scanContent(rel, content));
    }
    return findings;
}

function parseArgs(argv) {
    const idx = argv.indexOf('--files');
    if (idx === -1) return {};
    return { files: argv.slice(idx + 1) };
}

function main() {
    const { files } = parseArgs(process.argv.slice(2));
    const findings = scanFiles(files);
    if (findings.length === 0) {
        console.log('ops-secret-scan: clean — no secret-shaped strings found in tracked files.');
        process.exit(0);
    }
    console.error(`ops-secret-scan: FAILED — ${findings.length} finding(s):`);
    for (const f of findings) {
        console.error(`  [${f.id}] ${f.file}:${f.line}`);
    }
    console.error('ops-secret-scan: rotate the real secret immediately, remove it from history, and add a PLACEHOLDER_HINTS-style exemption only if this is genuinely fake.');
    process.exit(1);
}

if (require.main === module) main();

module.exports = { scanFiles, scanContent, PATTERNS, isPlaceholder };
