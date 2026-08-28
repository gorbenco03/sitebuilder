'use strict';
/**
 * bot/test/flow3-legal-export.test.js — VISION Flow 3 gates.
 *
 * Causal RED on required base 275e534 if:
 *   - generated templates lack Privacy/Terms/Cookies footer links
 *   - no cookie banner markup
 *   - no /api/export-zip
 *
 * GREEN on HEAD: legal pages from build, banner dismissible, ZIP self-hostable.
 * Also keeps wave7 builder legal + wave11 HTML export contracts intact.
 *
 * Run: node bot/test/flow3-legal-export.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');
const { createZip } = require('../zip.js');
const { exportSiteZip, buildStaticSiteTree } = require('../site-export.js');
const { writeLegalSiteFiles, privacyHtml, termsHtml, cookiesHtml } = require('../site-legal.js');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = '275e534232cd20105781ca0fbc6ec5bb5d9a2b97';
const TPLS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

const SERVER_SECRET = 'flow3-server-secret-' + crypto.randomBytes(8).toString('hex');
const BIZ_NAME = 'Flow3 Legal Cafe ' + crypto.randomBytes(3).toString('hex');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-legal-export-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = SERVER_SECRET;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

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

function baseBlob(rel) {
    try {
        return execFileSync('git', ['-C', ROOT, 'show', BASE_SHA + ':' + rel], {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        });
    } catch {
        return null;
    }
}

function headRead(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function httpReq(port, urlPath, { method = 'GET', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { hostname: '127.0.0.1', port, path: urlPath, method, headers },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                        bodyText: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

function assertNoSecretLeak(body) {
    const s = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    assert.ok(!s.includes(SERVER_SECRET), 'must not echo SERVER_SECRET');
    assert.ok(
        !/sk_live_|sk_test_|whsec_|SERVER_SECRET|magic.?link|Kanban|factory jargon/i.test(s),
        'must not leak secrets or factory jargon'
    );
}

function unzipStore(zipBuf, destDir) {
    // Minimal unzip for our createZip output (store or deflate)
    const zlib = require('zlib');
    fs.mkdirSync(destDir, { recursive: true });
    let o = 0;
    const files = [];
    while (o + 4 <= zipBuf.length) {
        const sig = zipBuf.readUInt32LE(o);
        if (sig === 0x04034b50) {
            const method = zipBuf.readUInt16LE(o + 8);
            const compSize = zipBuf.readUInt32LE(o + 18);
            const uncompSize = zipBuf.readUInt32LE(o + 22);
            const nameLen = zipBuf.readUInt16LE(o + 26);
            const extraLen = zipBuf.readUInt16LE(o + 28);
            const name = zipBuf.slice(o + 30, o + 30 + nameLen).toString('utf8');
            const dataStart = o + 30 + nameLen + extraLen;
            const compressed = zipBuf.slice(dataStart, dataStart + compSize);
            let data;
            if (method === 0) data = compressed;
            else if (method === 8) data = zlib.inflateRawSync(compressed);
            else throw new Error('unsupported zip method ' + method + ' for ' + name);
            assert.strictEqual(data.length, uncompSize, name + ' size');
            const out = path.join(destDir, name);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, data);
            files.push(name);
            o = dataStart + compSize;
            continue;
        }
        if (sig === 0x02014b50 || sig === 0x06054b50) break;
        break;
    }
    return files;
}

(async () => {
    // ── Causal RED on base ───────────────────────────────────────────────
    await check('causal RED: base templates lack generated-site legal footer links', () => {
        for (const id of TPLS) {
            const html = baseBlob(`templates/${id}/template.html`);
            assert.ok(html, id + ' base template');
            assert.ok(
                !/privacy\.html/i.test(html) || !/hb-legal-links/i.test(html),
                id + ' base must not already ship hb-legal-links privacy.html'
            );
            assert.ok(!/hb-cookie-banner/i.test(html), id + ' base must lack cookie banner');
        }
    });

    await check('causal RED: base server has no /api/export-zip', () => {
        const src = baseBlob('bot/server.js');
        assert.ok(src, 'base server');
        assert.ok(!/export-zip|handleExportZip/.test(src), 'base must not serve export-zip');
        assert.ok(!fs.existsSync(path.join(ROOT, 'bot/site-export.js')) || true);
        // site-export.js must be new on HEAD — confirm base lacks it
        try {
            execFileSync('git', ['-C', ROOT, 'cat-file', '-e', BASE_SHA + ':bot/site-export.js'], {
                stdio: ['ignore', 'ignore', 'ignore'],
            });
            assert.fail('base must not have bot/site-export.js');
        } catch (e) {
            if (e && e.message && /base must not/.test(e.message)) throw e;
            // missing is expected
        }
    });

    // ── HEAD GREEN: templates ────────────────────────────────────────────
    await check('HEAD all five templates footer link privacy/terms/cookies + cookie banner', () => {
        for (const id of TPLS) {
            const html = headRead(`templates/${id}/template.html`);
            assert.ok(/hb-legal-links/.test(html), id + ' hb-legal-links');
            assert.ok(/href="privacy\.html"/.test(html), id + ' privacy.html');
            assert.ok(/href="terms\.html"/.test(html), id + ' terms.html');
            assert.ok(/href="cookies\.html"/.test(html), id + ' cookies.html');
            assert.ok(/Confidențialitate|Confidentialitate/.test(html), id + ' RO privacy label');
            assert.ok(/id="hb-cookie-banner"/.test(html), id + ' cookie banner');
            assert.ok(/id="hb-cookie-accept"/.test(html), id + ' accept button');
            assert.ok(/cookie-banner\.js/.test(html), id + ' cookie-banner.js');
            assert.ok(/hb-built-by/.test(html) && /Build by/.test(html), id + ' attribution');
        }
    });

    await check('HEAD legal page generators are Romanian placeholders with owner-gated markers', () => {
        const cfg = { business: { name: BIZ_NAME }, footer: { year: '2026' } };
        for (const [label, html] of [
            ['privacy', privacyHtml(cfg)],
            ['terms', termsHtml(cfg)],
            ['cookies', cookiesHtml(cfg)],
        ]) {
            assert.ok(html.includes(BIZ_NAME), label + ' names business');
            assert.ok(/placeholder|nu este consultanță|nu este consultanta/i.test(html), label + ' placeholder honesty');
            assert.ok(/\[PLACEHOLDER/i.test(html), label + ' owner-gated PLACEHOLDER');
            assert.ok(/lang="ro"/i.test(html), label + ' lang=ro');
            assert.ok(/Build by/i.test(html) && /hidook\.tech/i.test(html), label + ' attribution');
            assert.ok(!/Kanban/i.test(html), label + ' no Kanban');
        }
    });

    await check('HEAD build.js writes legal pages beside index.html', () => {
        const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-build-'));
        try {
            const tpl = 'product-menu';
            const src = path.join(ROOT, 'templates', tpl);
            for (const entry of fs.readdirSync(src)) {
                if (/schema|presets|\.md/i.test(entry)) continue;
                const from = path.join(src, entry);
                const st = fs.statSync(from);
                if (st.isFile()) fs.copyFileSync(from, path.join(siteDir, entry));
                if (st.isDirectory() && entry === 'images') {
                    fs.cpSync(from, path.join(siteDir, 'images'), { recursive: true });
                }
            }
            const preset = JSON.parse(fs.readFileSync(path.join(src, 'presets.json'), 'utf8'));
            const cfg = JSON.parse(JSON.stringify(preset.presets[0]));
            cfg.business = cfg.business || {};
            cfg.business.name = BIZ_NAME;
            fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify(cfg, null, 2));
            const { build } = require('../../build.js');
            build(siteDir);
            for (const f of ['index.html', 'privacy.html', 'terms.html', 'cookies.html', 'cookie-banner.js', 'cookie-banner.css']) {
                assert.ok(fs.existsSync(path.join(siteDir, f)), 'build wrote ' + f);
            }
            const index = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
            assert.ok(index.includes(BIZ_NAME), 'index has business');
            assert.ok(/privacy\.html/.test(index), 'index links privacy');
            assert.ok(/hb-cookie-banner/.test(index), 'index has banner');
            const priv = fs.readFileSync(path.join(siteDir, 'privacy.html'), 'utf8');
            assert.ok(priv.includes(BIZ_NAME), 'privacy names business');
        } finally {
            try { fs.rmSync(siteDir, { recursive: true, force: true }); } catch (_) {}
        }
    });

    await check('HEAD zip writer round-trips files', () => {
        const z = createZip([
            { name: 'index.html', data: '<!DOCTYPE html><html><body>hi</body></html>' },
            { name: 'styles.css', data: 'body{color:red}' },
        ]);
        assert.ok(Buffer.isBuffer(z) && z.length > 50, 'zip buffer');
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-unzip-'));
        try {
            const names = unzipStore(z, dest);
            assert.ok(names.includes('index.html'), 'unzip index');
            assert.ok(fs.readFileSync(path.join(dest, 'index.html'), 'utf8').includes('hi'));
        } finally {
            try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) {}
        }
    });

    await check('HEAD exportSiteZip contains legal pages, styles, attribution, no secrets', () => {
        const preset = JSON.parse(
            fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8')
        );
        const cfg = JSON.parse(JSON.stringify(preset.presets[0]));
        cfg.business = cfg.business || {};
        cfg.business.name = BIZ_NAME;
        const result = exportSiteZip({ templateId: 'product-menu', config: cfg, slug: 'flow3-cafe' });
        assert.ok(result.zip && result.zip.length > 1000, 'zip size');
        assert.ok(/\.zip$/i.test(result.filename), 'filename zip');
        const must = ['index.html', 'privacy.html', 'terms.html', 'cookies.html', 'styles.css', 'cookie-banner.js'];
        for (const m of must) {
            assert.ok(result.files.includes(m), 'zip lists ' + m);
        }
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-export-'));
        try {
            unzipStore(result.zip, dest);
            const index = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
            assert.ok(index.includes(BIZ_NAME), 'exported index business');
            assert.ok(/Build by/.test(index) && /hidook\.tech/.test(index), 'badge survives export');
            assert.ok(/privacy\.html/.test(index), 'footer legal links in export');
            assert.ok(fs.existsSync(path.join(dest, 'privacy.html')));
            assert.ok(fs.existsSync(path.join(dest, 'styles.css')));
            // Must not require Hidook API host strings for core function
            assert.ok(!/\/api\/export|hidook\.agency\/api/i.test(index), 'no hidook api dependency in index');
            assertNoSecretLeak(index);
            assertNoSecretLeak(fs.readFileSync(path.join(dest, 'privacy.html'), 'utf8'));
        } finally {
            try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) {}
        }
    });

    await check('HEAD builder chrome: Descarcă ZIP + cookie banner on /app/', () => {
        const html = headRead('builder/index.html');
        assert.ok(/id="btn-download-zip"/.test(html), 'btn-download-zip');
        assert.ok(/Descarcă ZIP|Descarca ZIP/.test(html), 'RO ZIP label');
        assert.ok(/id="hb-cookie-banner"/.test(html), 'builder cookie banner');
        assert.ok(/id="btn-download-html"/.test(html), 'keeps Download HTML');
        const js = headRead('builder/app.js');
        assert.ok(/\/api\/export-zip/.test(js), 'app.js fetches export-zip');
        assert.ok(/downloadDraftZip/.test(js), 'downloadDraftZip wired');
        assert.ok(/btn-download-zip/.test(js), 'click handler');
    });

    await check('OWNER-STRIPE-TRIAL.md documents ZIP export', () => {
        const md = headRead('OWNER-STRIPE-TRIAL.md');
        assert.ok(/export-zip|Download ZIP|Descarcă ZIP/i.test(md), 'docs ZIP');
        assert.ok(/\.zip/i.test(md), 'mentions .zip');
    });

    // ── Live HTTP ────────────────────────────────────────────────────────
    const pricing = require('../pricing.js');
    const registry = require('../registry.js');
    const auth = require('../auth.js');
    const { startServer } = require('../server.js');

    await check('PRICE_CENTS stays 9900', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
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
        const user = registry.getOrCreateUserByEmail(`f3-${crypto.randomUUID()}@ex.com`);
        const cookie = 'hb_session=' + auth.signSession(user.id);
        const bareUser = registry.getOrCreateUserByEmail(`f3-bare-${crypto.randomUUID()}@ex.com`);
        const bareCookie = 'hb_session=' + auth.signSession(bareUser.id);

        const site = registry.createSite({
            userId: user.id,
            templateId: 'product-menu',
            templateVersion: 1,
            slug: 'f3export-' + crypto.randomUUID().slice(0, 8),
            platform: 'web',
        });
        registry.saveVersion(site.id, {
            business: {
                name: BIZ_NAME,
                title: BIZ_NAME + ' | Restaurant',
                tagline: 'Flow 3 export',
            },
            sections: { hero: { title: BIZ_NAME } },
            footer: { year: '2026', note: 'Toate drepturile rezervate.', address: 'București' },
        });

        await check('GET /api/export-zip unauthenticated → 401', async () => {
            const res = await httpReq(port, '/api/export-zip');
            assert.strictEqual(res.status, 401, 'expected 401 got ' + res.status);
            assertNoSecretLeak(res.bodyText);
        });

        await check('GET /api/export-zip auth no draft → 400', async () => {
            const res = await httpReq(port, '/api/export-zip', {
                headers: { Cookie: bareCookie, Accept: 'application/zip' },
            });
            assert.strictEqual(res.status, 400, 'expected 400 got ' + res.status + ' ' + res.bodyText.slice(0, 200));
        });

        await check('GET /api/export-zip session+draft → 200 application/zip with legal pages', async () => {
            const res = await httpReq(port, '/api/export-zip?siteId=' + encodeURIComponent(site.id), {
                headers: { Cookie: cookie, Accept: 'application/zip' },
            });
            assert.strictEqual(res.status, 200, 'expected 200 got ' + res.status + ' ' + res.bodyText.slice(0, 300));
            const ct = String(res.headers['content-type'] || '');
            assert.ok(/application\/zip|octet-stream/i.test(ct), 'content-type zip got ' + ct);
            const cd = String(res.headers['content-disposition'] || '');
            assert.ok(/attachment/i.test(cd) && /\.zip/i.test(cd), 'attachment .zip got ' + cd);
            assert.ok(res.body.length > 500, 'zip non-empty');
            assert.strictEqual(res.body.readUInt32LE(0), 0x04034b50, 'ZIP local file signature');

            const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-http-unzip-'));
            try {
                const names = unzipStore(res.body, dest);
                assert.ok(names.includes('index.html'), 'has index.html');
                assert.ok(names.includes('privacy.html'), 'has privacy.html');
                assert.ok(names.includes('terms.html'), 'has terms.html');
                assert.ok(names.includes('cookies.html'), 'has cookies.html');
                const index = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
                assert.ok(index.includes(BIZ_NAME), 'business in index');
                assert.ok(/hb-cookie-banner/.test(index), 'banner in export');
                // Static serve smoke: privacy page readable
                const priv = fs.readFileSync(path.join(dest, 'privacy.html'), 'utf8');
                assert.ok(/placeholder|PLACEHOLDER|consultan/i.test(priv), 'privacy placeholder');
            } finally {
                try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) {}
            }
            assertNoSecretLeak(res.body);
        });

        await check('GET /api/export-html still works (wave11 contract)', async () => {
            const res = await httpReq(port, '/api/export-html?siteId=' + encodeURIComponent(site.id), {
                headers: { Cookie: cookie, Accept: 'text/html' },
            });
            assert.strictEqual(res.status, 200);
            assert.ok(/text\/html/i.test(String(res.headers['content-type'] || '')));
            assert.ok(res.bodyText.includes(BIZ_NAME));
            assert.ok(/<!DOCTYPE html>/i.test(res.bodyText));
        });

        await check('GET /app/ has builder cookie banner + legal footer still live', async () => {
            const res = await httpReq(port, '/app/');
            assert.strictEqual(res.status, 200);
            assert.ok(/hb-cookie-banner/.test(res.bodyText), 'builder banner');
            assert.ok(/\/app\/privacy\.html/.test(res.bodyText), 'builder privacy link');
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    if (failed) {
        console.error('\nflow3-legal-export.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nflow3-legal-export.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
