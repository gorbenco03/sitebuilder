'use strict';
/**
 * bot/test/waveC-no-fake-canonical.test.js
 *
 * A published site must never claim a canonical URL on a domain that does not
 * exist.
 *
 * webpublish builds SEO files before the deploy call, using a placeholder
 * origin — https://pending-deploy.hidook.invalid — when the final host is only
 * knowable afterwards, and rewrites it once the provider returns a real URL.
 * That works for Cloudflare Pages and Vercel, which return an absolute https
 * URL. It did not work for isolated deploy without PUBLIC_URL, for two reasons
 * at once: that path's "url" is the RELATIVE /live/<slug>/, so no origin ever
 * arrives to substitute, and the correction rewrites the build directory after
 * _isolatedDeploy() has already copied it to $DATA_DIR/published/<slug>/ —
 * which is the copy serveLive() serves.
 *
 * Reproduced before the fix, in the SERVED files:
 *   index.html   2 occurrences (rel=canonical, og:url)
 *   robots.txt   1 (the Sitemap: line)
 *   sitemap.xml  4
 *
 * A canonical is authoritative to a crawler. This did not weaken the page's
 * ranking — it pointed the ranking at a domain that does not resolve, on every
 * site a self-hosted install published, permanently, with no self-healing on
 * republish.
 *
 * The rule this locks: assert an origin only when there is one. An absent
 * canonical is correct — a crawler uses the URL it fetched. A wrong one is not.
 *
 * Run: node --experimental-sqlite --test bot/test/waveC-no-fake-canonical.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function freshEnv() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-origin-'));
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    process.env.DATA_DIR = dir;
    process.env.SERVER_SECRET = 'seo-' + crypto.randomBytes(8).toString('hex');
    delete process.env.BRAND_DOMAIN;
    return dir;
}

async function publishOnce(slug) {
    // Fresh module instances so DATA_DIR/PUBLIC_URL are read as set above.
    for (const m of ['webpublish.js', 'registry.js', 'registry-sqlite.js', 'registry-json.js']) {
        delete require.cache[require.resolve(path.join(ROOT, 'bot', m))];
    }
    const wp = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;
    const site = registry.createSite({
        userId: 'u-seo', templateId: 'professionals', projectName: slug, slug, config: cfg, paid: true,
    });
    const res = await wp.publishSite({ site, config: cfg, templateId: 'professionals' });
    return res && res.url;
}

function servedFiles(dataDir, slug) {
    const dir = path.join(dataDir, 'published', slug);
    const out = {};
    for (const f of ['index.html', 'robots.txt', 'sitemap.xml']) {
        const p = path.join(dir, f);
        out[f] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    }
    return out;
}

test('an unresolvable placeholder origin never reaches a served file', async () => {
    const dataDir = freshEnv();
    delete process.env.PUBLIC_URL;
    try {
        await publishOnce('no-public-url');
        const files = servedFiles(dataDir, 'no-public-url');
        assert.ok(files['index.html'], 'the site must have been published');
        for (const [name, body] of Object.entries(files)) {
            if (body == null) continue;
            assert.doesNotMatch(
                body, /pending-deploy\.hidook\.invalid/,
                `${name} carries the placeholder origin. Isolated deploy never receives an absolute ` +
                `URL to replace it with, and the post-deploy correction rewrites the build directory ` +
                `after the served copy was already made.`
            );
        }
        // And it must not have invented some other unreachable absolute origin
        // for its own pages: no canonical at all is the correct answer here.
        assert.doesNotMatch(files['index.html'], /rel=["']canonical["']/i,
            'with no knowable public origin, index.html must not assert a canonical at all');
        assert.strictEqual(files['sitemap.xml'], null,
            'a sitemap requires absolute <loc> URLs, so with no origin it must be omitted rather than faked');
        assert.ok(files['robots.txt'], 'robots.txt is still useful without a Sitemap line and must be written');
        assert.doesNotMatch(files['robots.txt'], /Sitemap:/i,
            'robots.txt must not point at a sitemap that does not exist');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('a configured self-hosted install still gets real canonical, robots and sitemap', async () => {
    const dataDir = freshEnv();
    process.env.PUBLIC_URL = 'https://sitedelmeu.example';
    try {
        await publishOnce('with-public-url');
        const files = servedFiles(dataDir, 'with-public-url');
        assert.ok(files['index.html'], 'the site must have been published');
        assert.match(files['index.html'], /sitedelmeu\.example/,
            'the configured origin must appear in the served page');
        assert.doesNotMatch(files['index.html'], /pending-deploy\.hidook\.invalid/, 'no placeholder');
        assert.ok(files['sitemap.xml'], 'a known origin must still produce a sitemap');
        assert.match(files['sitemap.xml'], /sitedelmeu\.example/, 'the sitemap must use the real origin');
        assert.match(files['robots.txt'], /Sitemap:\s*https:\/\/sitedelmeu\.example/,
            'robots.txt must point at the real sitemap');
    } finally {
        delete process.env.PUBLIC_URL;
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('a re-exported site keeps its own path in robots.txt and sitemap.xml', () => {
    // A site published on a self-hosted install lives at https://host/live/<slug>/.
    // originFromCanonical()'s `new URL(c).origin` threw that path away, so a
    // re-exported ZIP listed the SITE ROOT's pages instead of this customer's —
    // four <loc> entries that 404 or belong to somebody else, while the page's
    // own rel=canonical was correct. Identical for a site at a domain root,
    // which is why it went unnoticed.
    const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;
    cfg.seo = Object.assign({}, cfg.seo, { canonical: 'https://exemplu.test/live/cabinet/' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reexport-'));
    try {
        siteExport.buildStaticSiteTree({ templateId: 'professionals', config: cfg, images: [], siteDir: dir });
        const robots = fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8');
        const sitemap = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8');
        assert.match(robots, /Sitemap:\s*https:\/\/exemplu\.test\/live\/cabinet\/sitemap\.xml/,
            'robots.txt must point at THIS site\'s sitemap, not the host root\'s');
        assert.match(sitemap, /<loc>https:\/\/exemplu\.test\/live\/cabinet\/<\/loc>/,
            'the sitemap must list this site\'s home page');
        assert.doesNotMatch(sitemap, /<loc>https:\/\/exemplu\.test\/(privacy|terms|cookies)\.html<\/loc>/,
            'the sitemap must not list pages at the host root — those belong to a different site');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
