'use strict';
/**
 * bot/test/audit27-r-14-og-image-export.test.js — R-14 (PLAN-AUDIT-2026-09-27.md,
 * findings-all.json images-media#1/#2): the downloadable/self-hosted export must
 * never put a base64 data: URI in og:image/twitter:image (Open Graph rejects it),
 * and must not embed the same photo a second, purely wasted time inside those
 * meta tags. Fix lives entirely in bot/site-export.js.
 *
 * Contract:
 *   1. Never published (no real seo.canonical yet): og:image/twitter:image are
 *      omitted from the built site tree AND the standalone HTML export — never a
 *      relative path (useless once downloaded) and never a data: URI.
 *   2. Previously published (real seo.canonical known): og:image/twitter:image
 *      are an absolute http(s) URL under that origin, in both the built site
 *      tree (what the ZIP ships) and the standalone HTML export — and the
 *      standalone export's own data: URI inlining of every other image on the
 *      page must not corrupt that absolute URL (it contains the bare filename
 *      as a substring, e.g. ".../images/hero.jpg").
 *   3. Parent commit (this worktree's base, before this task's fix) had none of
 *      this: a blind inlineTreeAssets() substitution with no og:image/twitter:image
 *      handling at all (causal RED archive).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-14-og-image-export.test.js
 */

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'b45a3e4ea6b972e361067c468bd8858d38e5c841';

const { buildStaticSiteTree, exportSiteHtml } = require('../site-export.js');

// A real, tiny, decodable 1x1 JPEG (not a renamed text file) — mirrors the
// audit's own approach of using real image fixtures, not invented bytes.
const TINY_JPEG_BASE64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
const TINY_JPEG_DATA_URL = 'data:image/jpeg;base64,' + TINY_JPEG_BASE64;

function makeConfig() {
    return {
        business: { name: 'R14 Export Cafe', title: 'R14 Export Cafe' },
        hero: { background: TINY_JPEG_DATA_URL },
        sections: { hero: { title: 'R14 Export Cafe' } },
    };
}

function makeImages() {
    return [{ name: 'hero', dataUrl: TINY_JPEG_DATA_URL }];
}

function readMeta(html, attr, value) {
    const re = new RegExp(
        '<meta\\s+' + attr + '=(["\'])' + value + '\\1\\s+content=(["\'])([^"\']*)\\2\\s*/?>',
        'i'
    );
    const m = re.exec(html);
    return m ? m[3] : null;
}

test('parent commit had no og:image/twitter:image handling in the export path (causal RED archive)', () => {
    const parentSrc = execFileSync(
        'git',
        ['-C', ROOT, 'show', PARENT_SHA + ':bot/site-export.js'],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    assert.ok(
        !/finalizeSocialImageMeta|shieldSocialImageMeta/.test(parentSrc),
        'parent must not yet have the R-14 fix functions'
    );
    // The parent's inlineTreeAssets substituted every "images/<name>" occurrence
    // across the WHOLE html blindly, with nothing excluding meta tag content.
    const inlineFn = parentSrc.match(/function inlineTreeAssets\([\s\S]*?\n}\n/);
    assert.ok(inlineFn, 'parent inlineTreeAssets found');
    assert.ok(
        !/og:image|twitter:image/i.test(inlineFn[0]),
        'parent inlineTreeAssets had no og:image/twitter:image awareness at all'
    );
});

test('never-published export: og:image/twitter:image are omitted, not a relative path or data URI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r14-export-unpublished-'));
    try {
        const built = buildStaticSiteTree({
            templateId: 'product-menu',
            config: makeConfig(),
            images: makeImages(),
            siteDir: dir,
        });
        const treeHtml = fs.readFileSync(path.join(built.siteDir, 'index.html'), 'utf8');
        assert.strictEqual(readMeta(treeHtml, 'property', 'og:image'), null, 'ZIP-shipped tree has no og:image meta');
        assert.strictEqual(readMeta(treeHtml, 'name', 'twitter:image'), null, 'ZIP-shipped tree has no twitter:image meta');

        const { html } = exportSiteHtml({
            templateId: 'product-menu',
            config: makeConfig(),
            images: makeImages(),
        });
        assert.strictEqual(readMeta(html, 'property', 'og:image'), null, 'standalone HTML has no og:image meta');
        assert.strictEqual(readMeta(html, 'name', 'twitter:image'), null, 'standalone HTML has no twitter:image meta');
        // The bug this replaces: a ~147KB data: URI sitting in that meta tag.
        assert.ok(!/<meta[^>]*(?:og:image|twitter:image)[^>]*base64/i.test(html), 'no base64 og:image/twitter:image anywhere');
        // The rest of the page still embeds the real photo normally.
        assert.ok(/data:image\/jpeg;base64,/.test(html), 'the actual hero photo is still inlined in the page body');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('previously-published export: og:image/twitter:image are an absolute URL, never a data URI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r14-export-published-'));
    try {
        const config = makeConfig();
        config.seo = { canonical: 'https://client-real-domain.example.com/' };

        const built = buildStaticSiteTree({
            templateId: 'product-menu',
            config,
            images: makeImages(),
            siteDir: dir,
        });
        const treeHtml = fs.readFileSync(path.join(built.siteDir, 'index.html'), 'utf8');
        const treeOg = readMeta(treeHtml, 'property', 'og:image');
        const treeTwitter = readMeta(treeHtml, 'name', 'twitter:image');
        assert.ok(treeOg, 'ZIP-shipped tree has an og:image meta');
        assert.ok(/^https:\/\/client-real-domain\.example\.com\/images\//.test(treeOg), 'og:image is absolute under the real origin, got: ' + treeOg);
        assert.ok(/^https:\/\/client-real-domain\.example\.com\/images\//.test(treeTwitter), 'twitter:image is absolute under the real origin, got: ' + treeTwitter);

        const { html } = exportSiteHtml({
            templateId: 'product-menu',
            config,
            images: makeImages(),
        });
        const htmlOg = readMeta(html, 'property', 'og:image');
        const htmlTwitter = readMeta(html, 'name', 'twitter:image');
        assert.ok(htmlOg, 'standalone HTML has an og:image meta');
        assert.ok(
            /^https:\/\/client-real-domain\.example\.com\/images\/[a-z0-9.-]+$/i.test(htmlOg),
            'standalone HTML og:image stayed a clean absolute URL, not corrupted into a data URI, got: ' + htmlOg
        );
        assert.ok(
            /^https:\/\/client-real-domain\.example\.com\/images\/[a-z0-9.-]+$/i.test(htmlTwitter),
            'standalone HTML twitter:image stayed a clean absolute URL, got: ' + htmlTwitter
        );
        assert.ok(!/base64/.test(htmlOg) && !/base64/.test(htmlTwitter), 'neither meta tag ever became a data URI');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
