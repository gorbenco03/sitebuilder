'use strict';
/**
 * bot/test/wave5-template-asset-dirs.test.js
 *
 * A template's asset directories must reach the published site and the ZIP
 * export, not just `images/`.
 *
 * Both copy loops (bot/site-export.js#copyTemplateTree and the inline one in
 * bot/webpublish.js#publishSite) used to special-case the literal directory
 * name `images`, so every other directory a template shipped was skipped in
 * silence. That became a real defect the moment desserdirina self-hosted its
 * typefaces to close a GDPR finding: the published site kept the @font-face
 * rules in styles.css and lost the woff2 files they point at, so the browser
 * silently fell back to a default font on the one template whose whole value
 * proposition is its look.
 *
 * The failure mode is why this oracle exists: nothing errors, nothing logs,
 * the site just quietly stops looking like the design.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-template-asset-dirs.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

/** Every non-`images` asset directory shipped by any template. */
function shippedAssetDirs() {
    const out = [];
    for (const tpl of fs.readdirSync(TEMPLATES_DIR)) {
        const dir = path.join(TEMPLATES_DIR, tpl);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const entry of fs.readdirSync(dir)) {
            const p = path.join(dir, entry);
            if (!fs.statSync(p).isDirectory()) continue;
            if (entry === 'images') continue;
            out.push({ tpl, entry, dir: p });
        }
    }
    return out;
}

test('desserdirina ships self-hosted fonts (the GDPR fix is still in place)', () => {
    const fontsDir = path.join(TEMPLATES_DIR, 'desserdirina', 'fonts');
    assert.ok(fs.existsSync(fontsDir), 'templates/desserdirina/fonts/ must exist');
    const woff2 = fs.readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));
    assert.ok(woff2.length > 0, 'fonts/ must contain woff2 files');

    const css = fs.readFileSync(path.join(TEMPLATES_DIR, 'desserdirina', 'styles.css'), 'utf8');
    assert.match(css, /@font-face/, 'styles.css must declare @font-face');

    // Strip HTML comments first: the template documents the self-hosting
    // decision in prose that names those hosts, and a naive substring match
    // would fail on the explanation of the very fix it is checking.
    const html = fs.readFileSync(path.join(TEMPLATES_DIR, 'desserdirina', 'template.html'), 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(html, /(?:href|src)\s*=\s*["'][^"']*fonts\.(?:googleapis|gstatic)\.com/i,
        'template.html must not load anything from Google Fonts');
    assert.doesNotMatch(html, /rel\s*=\s*["']preconnect["'][^>]*fonts\.(?:googleapis|gstatic)\.com/i,
        'template.html must not preconnect to Google Fonts either -- a preconnect alone already discloses the visitor IP');
});

test('every @font-face src in a template resolves to a file that template ships', () => {
    for (const tpl of fs.readdirSync(TEMPLATES_DIR)) {
        const cssPath = path.join(TEMPLATES_DIR, tpl, 'styles.css');
        if (!fs.existsSync(cssPath)) continue;
        // Strip comments first. A comment is not a declaration, and a stylesheet
        // that documents the shape of a rule — "the markup sets it with
        // style=\"background: url(…)\"" — is not referencing a file called "…".
        // The Google Fonts check just above already strips HTML comments for the
        // same reason; this one did not, and read prose as a broken asset path.
        const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const refs = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)]
            .map((m) => m[2].trim())
            .filter((u) => !/^(data:|https?:|\/\/)/i.test(u));
        for (const ref of refs) {
            const target = path.join(TEMPLATES_DIR, tpl, ref);
            assert.ok(fs.existsSync(target),
                `${tpl}/styles.css references ${ref}, which does not exist`);
        }
    }
});

test('copyTemplateTree carries non-images asset directories into the site', () => {
    const siteExport = require('../site-export.js');
    const dirs = shippedAssetDirs();
    assert.ok(dirs.length > 0, 'expected at least one non-images asset directory to exist');

    for (const { tpl, entry, dir } of dirs) {
        const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assetdirs-'));
        try {
            siteExport.copyTemplateTree(tpl, siteDir);
            const dest = path.join(siteDir, entry);
            assert.ok(fs.existsSync(dest),
                `${tpl}/${entry}/ was dropped -- the published site would keep the CSS and lose the files`);

            const expected = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
            const got = fs.readdirSync(dest);
            for (const f of expected) {
                assert.ok(got.includes(f), `${tpl}/${entry}/${f} missing from the copied site`);
                assert.strictEqual(
                    fs.statSync(path.join(dest, f)).size,
                    fs.statSync(path.join(dir, f)).size,
                    `${tpl}/${entry}/${f} copied with a different size`
                );
            }
        } finally {
            fs.rmSync(siteDir, { recursive: true, force: true });
        }
    }
});

test('webpublish and site-export share the same copy rule, so live and ZIP cannot drift', () => {
    // The two loops are separate code. If one is generalised and the other is
    // not, a font would reach the ZIP but not the live site (or the reverse),
    // which is exactly the kind of divergence that goes unnoticed for months.
    const wp = fs.readFileSync(path.join(ROOT, 'bot', 'webpublish.js'), 'utf8');
    const se = fs.readFileSync(path.join(ROOT, 'bot', 'site-export.js'), 'utf8');
    for (const [name, src] of [['webpublish.js', wp], ['site-export.js', se]]) {
        assert.doesNotMatch(src, /isDirectory\(\)\s*&&\s*entry\s*===\s*'images'/,
            `${name} still special-cases only images/ -- other asset directories are dropped`);
    }
});
