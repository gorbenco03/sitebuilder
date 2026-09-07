'use strict';
/**
 * bot/test/waveC-live-site-revalidates.test.js
 *
 * A republished site must reach the people who already visited it.
 *
 * serveLive() sent a published site with NO caching directives at all — no
 * Cache-Control, no ETag, no Last-Modified. A `Cache-Control: no-store` had
 * been written for exactly this in September and was dropped, apparently by
 * accident, during a later performance rewrite; `git log -S` finds that line
 * on one abandoned branch and nowhere in main's history.
 *
 * Measured: Chromium happens not to store a response with no freshness
 * information, so a republish did reach a returning visitor. But that is the
 * browser's choice, not the product's. Anything sitting in front of this
 * origin — a CDN, a corporate proxy, Cloudflare with "cache everything" — is
 * free to decide otherwise, and there was nothing in the response for it to
 * revalidate against. "I updated my site and it still shows the old one" is
 * the kind of failure a small business reports as the product being broken.
 *
 * The fix is `no-cache` rather than the original `no-store`: the copy may be
 * kept, it just may never be reused without asking. With an ETag that question
 * costs a 304 and no body, so repeat visits get cheaper — which is the
 * opposite of what no-store would have done.
 *
 * Run: node --experimental-sqlite --test bot/test/waveC-live-site-revalidates.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function page(version) {
    return '<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"><title>' + version +
        '</title></head><body><h1>' + version + '</h1>' + 'x'.repeat(2000) + '</body></html>';
}

test('a published site is revalidated, so a republish is never invisible', async () => {
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-cache-'));
    process.env.DATA_DIR = dataDir;
    process.env.SERVER_SECRET = 'livecache-' + crypto.randomBytes(8).toString('hex');
    delete process.env.PUBLIC_URL;

    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const server = startServer({ port: 0 });
    await new Promise((r) => { if (server.listening) return r(); server.once('listening', r); });
    const base = 'http://127.0.0.1:' + server.address().port;

    const slug = 'revalidate-probe';
    const siteDir = path.join(dataDir, 'published', slug);
    fs.mkdirSync(siteDir, { recursive: true });
    const indexPath = path.join(siteDir, 'index.html');
    // A stylesheet too: asset filenames are stable across republishes, so an
    // asset served with a max-age would leave a new page wearing an old skin.
    const cssPath = path.join(siteDir, 'styles.css');
    fs.writeFileSync(indexPath, page('V1'), 'utf8');
    fs.writeFileSync(cssPath, 'body{color:#111}', 'utf8');

    try {
        const url = base + '/live/' + slug + '/';
        const cssUrl = base + '/live/' + slug + '/styles.css';

        for (const [label, target] of [['HTML', url], ['stylesheet', cssUrl]]) {
            const res = await fetch(target);
            assert.strictEqual(res.status, 200, `${label}: expected 200`);
            const cc = res.headers.get('cache-control');
            const etag = res.headers.get('etag');
            assert.ok(cc, `${label}: no Cache-Control — a proxy in front of this origin is free to ` +
                `serve a customer's old site indefinitely, with nothing to revalidate against`);
            assert.doesNotMatch(cc, /max-age=[1-9]/,
                `${label}: Cache-Control is "${cc}" — a positive max-age lets a republish stay invisible ` +
                `for that long, and asset filenames are stable across republishes`);
            assert.ok(etag, `${label}: no ETag, so revalidation would have to transfer the whole body`);
        }

        // Revalidation is cheap: a conditional request gets 304 and no body.
        const first = await fetch(url);
        const tag = first.headers.get('etag');
        const fullBody = (await first.text()).length;
        assert.ok(fullBody > 100, 'the first response must carry the page');

        const conditional = await fetch(url, { headers: { 'If-None-Match': tag } });
        assert.strictEqual(conditional.status, 304,
            'an unchanged page must answer a conditional request with 304, not a fresh copy');
        assert.strictEqual((await conditional.text()).length, 0, '304 must carry no body');

        // And a republish invalidates it.
        await new Promise((r) => setTimeout(r, 1100)); // distinct mtime
        fs.writeFileSync(indexPath, page('V2'), 'utf8');
        const afterRepublish = await fetch(url, { headers: { 'If-None-Match': tag } });
        assert.strictEqual(afterRepublish.status, 200,
            'after a republish the old validator must NOT match — a visitor holding it would be ' +
            'told nothing had changed');
        const body = await afterRepublish.text();
        assert.match(body, /V2/, 'the republished content must be what is served');
        assert.doesNotMatch(body, /V1/, 'the previous version must be gone');
    } finally {
        await new Promise((r) => server.close(r));
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});
