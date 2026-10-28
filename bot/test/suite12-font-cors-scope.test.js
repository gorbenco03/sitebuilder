'use strict';
/**
 * bot/test/suite12-font-cors-scope.test.js
 *
 * Server half of suite12-preview-fonts-load, kept when the form editor was
 * removed (2026-10-28): template font assets carry a wildcard ACAO (sandboxed
 * srcdoc frames have an opaque origin), and no other /app/ route does.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-font-cors-scope.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-font-cors-'));
process.env.DATA_DIR = dataDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.SERVER_SECRET = 'suite12-font-cors-test-secret';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.HIDOOK_FAKE_DEPLOY;

// The fix lives partly in scripts/build-builder.js's font-copying/CSS-rewrite
// step — make sure builder/generated/* reflects the current source before the
// server serves it, the same way npm run build:app does in dev/CI.
execFileSync('node', [path.join(ROOT, 'scripts', 'build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
});

const { startServer } = require('../server.js');

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

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('desserdirina font-asset responses carry ACAO, correct type, no credentials flag', async () => {
    const fontDir = path.join(ROOT, 'templates', 'desserdirina', 'fonts');
    const names = fs.readdirSync(fontDir).filter((n) => /\.(?:woff2?|ttf|otf)$/i.test(n));
    assert.ok(names.length > 0, 'expected real font files under templates/desserdirina/fonts/');

    for (const name of names) {
        const url = base + '/app/generated/template-assets/desserdirina/fonts/' + name;
        const r = await fetch(url, { headers: { Origin: 'null' } });
        assert.equal(r.status, 200, url + ' must 200 (the real asset, not the SPA-fallback index.html)');
        assert.equal(
            r.headers.get('access-control-allow-origin'), '*',
            url + ' must carry ACAO so the opaque srcdoc preview origin can use it'
        );
        assert.equal(
            r.headers.get('access-control-allow-credentials'), null,
            url + ' must never pair a wildcard ACAO with a credentials flag'
        );
        assert.match(r.headers.get('content-type') || '', /^font\//i, url + ' content-type');
    }
});


test('non-font /app/ routes carry no Access-Control-Allow-Origin (scoped, not blanket, CORS)', async () => {
    const routes = ['/app/', '/app/app.js', '/app/app.css', '/app/blocks/blocks.js', '/app/generated/templates-data.js'];
    for (const route of routes) {
        const r = await fetch(base + route, { headers: { Origin: 'null' } });
        assert.equal(
            r.headers.get('access-control-allow-origin'), null,
            route + ' must not carry the font-only CORS header'
        );
    }
});
