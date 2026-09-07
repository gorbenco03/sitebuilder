'use strict';
/**
 * bot/test/wave13-shell-cache-busting.test.js
 *
 * A deploy must reach the owner's browser.
 *
 * The origin serves /app/app.js with `public, max-age=0, must-revalidate`,
 * which is right. It is not what the browser gets: the CDN in front of
 * production rewrites it to `max-age=14400`, so for four hours after a deploy
 * a returning owner is served the PREVIOUS build off their own disk without a
 * single request leaving the machine. That is how a merged, pushed, deployed
 * feature ("Șterge" on a site card) can be provably present on the origin and
 * still absent from the owner's screen.
 *
 * The shells therefore stamp every same-origin .js/.css reference with that
 * file's size+mtime, so a changed asset gets a changed URL that no cache can
 * answer from an old entry.
 *
 * Run: node --experimental-sqlite --test bot/test/wave13-shell-cache-busting.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-cachebust-'));
process.env.SERVER_SECRET = 'cachebust-' + crypto.randomBytes(8).toString('hex');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;

test.before(async () => {
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => { if (server) server.close(); });

function refsOf(html) {
    const out = [];
    const re = /\s(?:src|href)="(\/app\/[^"]+\.(?:js|css)[^"]*)"/g;
    let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
}

test('the builder shell stamps its own js/css so a new build cannot be served from cache', async () => {
    const html = await (await fetch(base + '/app/')).text();
    const refs = refsOf(html);
    assert.ok(refs.length >= 3, 'expected the shell to reference several local assets, got ' + refs.length);

    const unstamped = refs.filter((r) => !/\?v=[a-z0-9-]+$/.test(r));
    assert.deepEqual(unstamped, [],
        'these shell assets carry no cache-busting stamp, so a stale CDN/browser copy wins after a deploy:\n' +
        unstamped.join('\n'));

    // Every stamped URL must still resolve.
    for (const ref of refs) {
        const res = await fetch(base + ref);
        assert.equal(res.status, 200, ref + ' did not resolve (' + res.status + ')');
    }
});

test('the HTML shell itself is never cached, or the new stamps would never arrive', async () => {
    const res = await fetch(base + '/app/');
    const cc = res.headers.get('cache-control') || '';
    assert.match(cc, /no-cache|no-store|max-age=0/,
        'the shell is served with "' + cc + '" — a cached shell keeps handing out the old asset URLs');
});

test('changing an asset changes its stamp and the shell ETag', async () => {
    const appJs = path.join(ROOT, 'builder', 'app.js');
    const before = await (await fetch(base + '/app/')).text();
    const beforeEtag = (await fetch(base + '/app/')).headers.get('etag');
    const beforeRef = refsOf(before).find((r) => r.startsWith('/app/app.js'));
    assert.ok(beforeRef, 'shell does not reference /app/app.js');

    const original = fs.statSync(appJs);
    const bumped = new Date(original.mtimeMs + 60000);
    fs.utimesSync(appJs, bumped, bumped);
    try {
        const after = await (await fetch(base + '/app/')).text();
        const afterEtag = (await fetch(base + '/app/')).headers.get('etag');
        const afterRef = refsOf(after).find((r) => r.startsWith('/app/app.js'));
        assert.notEqual(afterRef, beforeRef,
            'app.js changed but its URL did not — a cached copy would still be used');
        assert.notEqual(afterEtag, beforeEtag,
            'the shell ETag did not change, so a conditional request would 304 the old asset URLs back');
    } finally {
        const t = new Date(original.mtimeMs);
        fs.utimesSync(appJs, t, t);
    }
});

test('the calendar owner shell stamps its bundle too, including the inline-script one', async () => {
    const html = await (await fetch(base + '/calendar-native/owner/')).text();
    const found = [...html.matchAll(/['"](\/calendar-native\/owner\/[^'"\s]*\.(?:js|css)(?:\?v=[a-z0-9-]+)?)['"]/g)]
        .map((m) => m[1]);
    assert.ok(found.some((r) => r.startsWith('/calendar-native/owner/owner-dashboard.js')),
        'the owner shell no longer references owner-dashboard.js — update this test');
    const unstamped = found.filter((r) => !/\?v=[a-z0-9-]+$/.test(r));
    assert.deepEqual(unstamped, [],
        'unstamped owner-dashboard assets — the back button and the auto-dismissing save banner\n' +
        'would sit behind a stale cached bundle after a deploy:\n' + unstamped.join('\n'));
    for (const ref of found) {
        assert.equal((await fetch(base + ref)).status, 200, ref + ' did not resolve');
    }
});

test('published customer sites are left alone — their HTML is the owner\'s deliverable', async () => {
    const exportPath = path.join(ROOT, 'bot', 'site-export.js');
    const src = fs.readFileSync(exportPath, 'utf8');
    assert.ok(!src.includes('?v=' ), 'site-export.js should not be stamping exported HTML');
});
