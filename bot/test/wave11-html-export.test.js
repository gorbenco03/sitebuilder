'use strict';
/**
 * bot/test/wave11-html-export.test.js — Wave 11 Download HTML of the current draft.
 *
 * VISION/LAUNCH: stranger in the browser builder downloads the current draft as a
 * complete static HTML file (not a live publish). No Stripe, no deploy.
 *
 * Causal contracts:
 *   1. Authenticated GET /api/export-html (session cookie, draft in registry) →
 *      200 text/html; charset=utf-8, Content-Disposition: attachment; filename*.html,
 *      body is a complete HTML document including the draft business/title string.
 *   2. Unauthenticated → 401. Missing draft → 400. No Stripe secrets, SERVER_SECRET,
 *      magic-link tokens, or factory jargon in the response.
 *   3. builder/index.html topbar has id="btn-download-html" labeled Download HTML;
 *      builder/app.js wires fetch + blob / a[download] (no new publish).
 *   4. OWNER-STRIPE-TRIAL.md documents Download HTML (no secrets).
 *
 * Run: node bot/test/wave11-html-export.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = 'ede35fa85e8aaae9494e1e1e0b7804ba14b4105b';

const SERVER_SECRET = 'wave11-server-secret-' + crypto.randomBytes(8).toString('hex');
const BIZ_NAME = 'Wave11 Export Cafe ' + crypto.randomBytes(3).toString('hex');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-html-export-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = SERVER_SECRET;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.HIDOOK_ADMIN_TOKEN;

const pricing  = require('../pricing.js');
const registry = require('../registry.js');
const auth     = require('../auth.js');
const { startServer } = require('../server.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

function httpReq(port, urlPath, { method = 'GET', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: urlPath,
                method,
                headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

function assertNoSecretLeak(body) {
    assert.ok(!body.includes(SERVER_SECRET), 'must not echo SERVER_SECRET');
    assert.ok(
        !/sk_live_|sk_test_|whsec_|SERVER_SECRET|magic.?link|Kanban|DESSERD|factory jargon/i.test(body),
        'must not leak secrets or factory jargon'
    );
}

(async () => {
    await check('PRICE_CENTS stays 9900', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
    });

    await check(`parent blob ${PARENT_SHA.slice(0, 7)} had no /api/export-html (causal RED archive)`, () => {
        const parentSrc = require('child_process').execFileSync(
            'git',
            ['-C', ROOT, 'show', `${PARENT_SHA}:bot/server.js`],
            { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
        );
        assert.ok(
            !/export-html|handleExportHtml/.test(parentSrc),
            'parent ' + PARENT_SHA.slice(0, 7) + ' must not yet serve /api/export-html'
        );
        const parentIndex = require('child_process').execFileSync(
            'git',
            ['-C', ROOT, 'show', `${PARENT_SHA}:builder/index.html`],
            { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
        );
        assert.ok(
            !/btn-download-html|Download HTML/.test(parentIndex),
            'parent builder/index.html must not yet have Download HTML'
        );
    });

    const server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const port = server.address().port;
    process.env.PUBLIC_URL = `http://127.0.0.1:${port}`;

    try {
        const user = registry.getOrCreateUserByEmail(`w11-${crypto.randomUUID()}@ex.com`);
        const cookie = 'hb_session=' + auth.signSession(user.id);

        // User with no draft at all
        const bareUser = registry.getOrCreateUserByEmail(`w11-bare-${crypto.randomUUID()}@ex.com`);
        const bareCookie = 'hb_session=' + auth.signSession(bareUser.id);

        const site = registry.createSite({
            userId: user.id,
            templateId: 'product-menu',
            templateVersion: 1,
            slug: 'w11export-' + crypto.randomUUID().slice(0, 8),
            platform: 'web',
        });
        registry.saveVersion(site.id, {
            business: {
                name: BIZ_NAME,
                title: BIZ_NAME + ' | Restaurant',
                tagline: 'Wave 11 draft export',
            },
            sections: { hero: { title: BIZ_NAME } },
        });

        await check('GET /api/export-html unauthenticated → 401', async () => {
            const res = await httpReq(port, '/api/export-html');
            assert.strictEqual(res.status, 401, 'expected 401, got ' + res.status + ' body=' + res.body.slice(0, 200));
            assertNoSecretLeak(res.body);
        });

        await check('GET /api/export-html authenticated but no draft → 400', async () => {
            const res = await httpReq(port, '/api/export-html', {
                headers: { Cookie: bareCookie, Accept: 'text/html' },
            });
            assert.strictEqual(res.status, 400, 'expected 400 missing draft, got ' + res.status + ' body=' + res.body.slice(0, 200));
            assertNoSecretLeak(res.body);
        });

        await check('GET /api/export-html with session + draft → 200 HTML attachment', async () => {
            const res = await httpReq(port, '/api/export-html', {
                headers: { Cookie: cookie, Accept: 'text/html' },
            });
            assert.strictEqual(res.status, 200, 'expected 200, got ' + res.status + ' body=' + res.body.slice(0, 300));
            const ct = String(res.headers['content-type'] || '');
            assert.ok(/text\/html/i.test(ct), 'content-type text/html, got ' + ct);
            assert.ok(/charset=utf-8/i.test(ct), 'charset=utf-8, got ' + ct);
            const cd = String(res.headers['content-disposition'] || '');
            assert.ok(/attachment/i.test(cd), 'Content-Disposition attachment, got ' + cd);
            assert.ok(/\.html/i.test(cd), 'filename ends with .html, got ' + cd);
            assert.ok(/<!DOCTYPE html>/i.test(res.body), 'complete HTML document DOCTYPE');
            assert.ok(/<html[\s>]/i.test(res.body), 'complete HTML document <html');
            assert.ok(res.body.includes(BIZ_NAME), 'includes draft business name ' + BIZ_NAME);
            assertNoSecretLeak(res.body);
            // Must not be a live publish / redirect to checkout
            assert.ok(!/paymentUrl|checkout\.stripe/i.test(res.body), 'not a checkout response');
        });

        await check('GET /api/export-html?siteId= owned draft → 200 with business name', async () => {
            const res = await httpReq(port, '/api/export-html?siteId=' + encodeURIComponent(site.id), {
                headers: { Cookie: cookie, Accept: 'text/html' },
            });
            assert.strictEqual(res.status, 200, 'siteId export 200, got ' + res.status);
            assert.ok(res.body.includes(BIZ_NAME), 'siteId path includes business name');
            const cd = String(res.headers['content-disposition'] || '');
            assert.ok(/attachment/i.test(cd) && /\.html/i.test(cd), 'attachment .html');
            assertNoSecretLeak(res.body);
        });

        await check('builder/index.html has btn-download-html labeled Download HTML', () => {
            const html = fs.readFileSync(path.join(ROOT, 'builder/index.html'), 'utf8');
            assert.ok(/id=["']btn-download-html["']/.test(html), 'id=btn-download-html');
            // Label near the button
            const idx = html.indexOf('btn-download-html');
            assert.ok(idx >= 0);
            const window = html.slice(Math.max(0, idx - 80), idx + 400);
            assert.ok(/Download HTML/.test(window), 'label Download HTML near button');
            // Word boundaries: avoid false positive on catalog chip "desserdirina"
            assert.ok(
                !/Download HTML[\s\S]{0,200}\bKanban\b|\bDESSERD\b/i.test(html),
                'no factory jargon'
            );
        });

        await check('builder/app.js wires Download HTML (fetch + blob / a[download], no publish)', () => {
            const js = fs.readFileSync(path.join(ROOT, 'builder/app.js'), 'utf8');
            assert.ok(/btn-download-html/.test(js), 'app.js references btn-download-html');
            assert.ok(/\/api\/export-html/.test(js), 'app.js fetches /api/export-html');
            assert.ok(/download/i.test(js) && (/Blob|createObjectURL|a\.download|\.download\s*=/.test(js)),
                'uses blob or a[download] to save file');
            // Must not treat download as a new publish path
            const m = js.match(/btn-download-html[\s\S]{0,1200}/);
            assert.ok(m, 'handler region found');
            assert.ok(!/\/api\/publish/.test(m[0]), 'download handler must not call /api/publish');
        });

        await check('OWNER-STRIPE-TRIAL.md documents Download HTML (no secrets)', () => {
            const md = fs.readFileSync(path.join(ROOT, 'OWNER-STRIPE-TRIAL.md'), 'utf8');
            assert.ok(/Download HTML/i.test(md), 'mentions Download HTML');
            assert.ok(/\.html/i.test(md), 'mentions .html file');
            assert.ok(/draft/i.test(md), 'mentions draft');
            assert.ok(!/sk_live_[a-zA-Z0-9]{8,}|sk_test_[a-zA-Z0-9]{8,}|whsec_[a-zA-Z0-9]{8,}/.test(md),
                'no secrets printed');
            // Must not remain only as out-of-scope once Wave 11 ships
            assert.ok(
                !/## Out of this how-to[\s\S]*HTML export/i.test(md) ||
                    /Download HTML/i.test(md.split('## Out of this how-to')[0] || md),
                'Download HTML must be documented as shipped, not only parked out-of-scope'
            );
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    if (failed) {
        console.error('\nwave11-html-export.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave11-html-export.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
