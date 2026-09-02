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
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = '275e534232cd20105781ca0fbc6ec5bb5d9a2b97';
const PARENT_SHA = '27ad51f4e115f3ae05e46c8401a2297e53e18434';
const REJECTED_SHA = 'f1cda5f66c297ecea358c68629223e49cce51a2e'; // data:text/html legal hrefs — Chromium dead clicks
const R3_PARENT_SHA = '924547eb05ad51f4a94d703dace609a22fbb8da2'; // overlapping consent + no current-draft UI ZIP
const PW_PATH = '/Users/Work/.hermes/hermes-agent/node_modules/playwright';
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
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

    await check('causal RED: parent legal pages still ship English owner-gated jargon', () => {
        let parentLegal;
        try {
            parentLegal = execFileSync('git', ['-C', ROOT, 'show', PARENT_SHA + ':bot/site-legal.js'], {
                encoding: 'utf8',
                maxBuffer: 2 * 1024 * 1024,
            });
        } catch (e) {
            assert.fail('parent site-legal missing: ' + e.message);
        }
        assert.ok(/owner-gated/i.test(parentLegal), 'parent must still contain owner-gated for causal RED');
    });

    await check('causal RED: parent renderPreview does not isolate cookie banner or legal links', () => {
        let parentBuild;
        try {
            parentBuild = execFileSync('git', ['-C', ROOT, 'show', PARENT_SHA + ':scripts/build-builder.js'], {
                encoding: 'utf8',
                maxBuffer: 2 * 1024 * 1024,
            });
        } catch (e) {
            assert.fail('parent build-builder missing: ' + e.message);
        }
        assert.ok(
            !/cookie-banner\.css|COOKIE_BANNER_CSS|data-hb-preview-legal|data-hb-cookie-banner/i.test(parentBuild),
            'parent renderPreview must lack cookie/legal preview isolation'
        );
    });

    await check('causal RED: rejected f1cda5f still ships data:text/html legal hrefs', () => {
        let rejectedBuild;
        try {
            rejectedBuild = execFileSync('git', ['-C', ROOT, 'show', REJECTED_SHA + ':scripts/build-builder.js'], {
                encoding: 'utf8',
                maxBuffer: 2 * 1024 * 1024,
            });
        } catch (e) {
            assert.fail('rejected build-builder missing: ' + e.message);
        }
        assert.ok(
            /data:text\/html;charset=utf-8/.test(rejectedBuild),
            'rejected candidate must still use data:text/html legal hrefs for causal RED'
        );
        assert.ok(
            !/#hb-preview-legal-|PREVIEW_LEGAL_NAV_SRC|hb-preview-legal-docs/.test(rejectedBuild),
            'rejected candidate must lack hash/interceptor legal navigation'
        );
    });

    await check('causal RED: R3 parent overlaps builder consent and cannot save the browser draft for ZIP', () => {
        const parentApp = execFileSync('git', ['-C', ROOT, 'show', R3_PARENT_SHA + ':builder/app.js'], {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
        });
        const parentHtml = execFileSync('git', ['-C', ROOT, 'show', R3_PARENT_SHA + ':builder/index.html'], {
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
        });
        const parentServer = execFileSync('git', ['-C', ROOT, 'show', R3_PARENT_SHA + ':bot/server.js'], {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
        });
        assert.ok(/id="hb-cookie-banner"/.test(parentHtml), 'parent has builder-origin notice');
        assert.ok(!/preview-cookie-isolated/.test(parentApp + parentHtml), 'parent does not isolate builder notice during preview');
        assert.ok(/const valid = !value \|\| isPlausibleHttpUrl\(value\)/.test(parentApp), 'parent rejects relative preset assets');
        assert.ok(!/\/api\/draft/.test(parentApp), 'parent ZIP click cannot persist the current browser draft');
        assert.ok(!/handleSaveDraft|url === '\/api\/draft'/.test(parentServer), 'parent has no current-draft save route');
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

    await check('HEAD legal page generators are Romanian placeholders without factory English jargon', () => {
        const cfg = { business: { name: BIZ_NAME }, footer: { year: '2026' } };
        for (const [label, html] of [
            ['privacy', privacyHtml(cfg)],
            ['terms', termsHtml(cfg)],
            ['cookies', cookiesHtml(cfg)],
        ]) {
            assert.ok(html.includes(BIZ_NAME), label + ' names business');
            assert.ok(/placeholder|nu este consultanță|nu este consultanta/i.test(html), label + ' placeholder honesty');
            assert.ok(/\[PLACEHOLDER/i.test(html), label + ' unfinished PLACEHOLDER markers');
            assert.ok(/lang="ro"/i.test(html), label + ' lang=ro');
            assert.ok(/Build by/i.test(html) && /hidook\.tech/i.test(html), label + ' attribution');
            assert.ok(!/Kanban/i.test(html), label + ' no Kanban');
            assert.ok(
                !/owner-gated|owner-ului|\bfactory\b|studio process/i.test(html),
                label + ' no owner-gated / factory-English process words'
            );
            assert.ok(
                /titularul afacerii|de completat/i.test(html) || /PLACEHOLDER/i.test(html),
                label + ' honest Romanian unfinished wording'
            );
        }
    });

    await check('HEAD builder legal pages are customer placeholders without studio process copy', () => {
        const processCopy = /necunoscut|această pagină există|pagina de mai jos este un text de orientare|builderul deschis|configurația comercială live|pricing-ul produsului|originea builderului|livrare comercială|proprietarul produsului|\/app\b/i;
        for (const [label, rel] of [
            ['privacy', 'builder/privacy.html'],
            ['terms', 'builder/terms.html'],
            ['cookies', 'builder/cookies.html'],
        ]) {
            const html = headRead(rel);
            const visibleText = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
            assert.ok(/Hidook Site Builder/.test(html), label + ' keeps product identity');
            assert.ok(/placeholder/i.test(html), label + ' clearly labels unfinished content');
            assert.ok(
                /nu (?:este|reprezintă) (?:o |un )?(?:politică|notificare|contract|text juridic|consultanță juridică)[^<.]*final/i.test(html),
                label + ' says the legal text is not final'
            );
            assert.ok(!processCopy.test(visibleText), label + ' has no tester, route, origin, live-config, or product-owner copy');
        }
    });

    await check('HEAD catalog/editor renderPreview isolates cookie banner + business legal pages', () => {
        // Ensure engine matches this worktree (generated/ is gitignored).
        execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
            cwd: ROOT,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        const engineSrc = fs.readFileSync(path.join(ROOT, 'builder/generated/engine.js'), 'utf8');
        assert.ok(/data-hb-cookie-banner/.test(engineSrc), 'engine inlines cookie banner assets');
        assert.ok(/data-hb-preview-legal/.test(engineSrc), 'engine marks preview legal links');
        assert.ok(/hb-preview-legal-docs|PREVIEW_LEGAL_NAV_SRC|data-hb-preview-legal-nav/.test(engineSrc), 'engine ships legal click interceptor');
        assert.ok(!/owner-gated/i.test(engineSrc), 'engine legal copy has no owner-gated');
        // Must NOT treat data:text/html as the navigable legal mechanism (Chromium dead-click).
        assert.ok(
            !/href\s*=\s*['"]data:text\/html|var href = 'data:text\/html/.test(engineSrc),
            'engine must not assign data:text/html as legal href'
        );

        const sandbox = { window: {}, console };
        vm.runInNewContext(engineSrc, sandbox);
        const engine = sandbox.window.HidookEngine;
        assert.ok(engine && typeof engine.renderPreview === 'function', 'HidookEngine.renderPreview');

        for (const id of TPLS) {
            const dir = path.join(ROOT, 'templates', id);
            const files = {
                templateHtml: fs.readFileSync(path.join(dir, 'template.html'), 'utf8'),
                stylesCss: fs.readFileSync(path.join(dir, 'styles.css'), 'utf8'),
                scriptJs: fs.readFileSync(path.join(dir, 'script.js'), 'utf8'),
            };
            const collage = path.join(dir, 'collage.js');
            if (fs.existsSync(collage)) files.collageJs = fs.readFileSync(collage, 'utf8');
            const presets = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets;
            const config = JSON.parse(JSON.stringify(presets[0].config || presets[0]));
            config.business = config.business || {};
            if (!config.business.name) config.business.name = BIZ_NAME + ' ' + id;

            const html = engine.renderPreview(files, config);
            assert.ok(/id="hb-cookie-banner"/.test(html), id + ' preview banner present');
            assert.ok(/id="hb-cookie-accept"/.test(html), id + ' preview Accept present');
            assert.ok(/data-hb-cookie-banner/.test(html), id + ' cookie assets inlined');
            assert.ok(!/href=["']cookie-banner\.css["']/.test(html), id + ' no external cookie css');
            assert.ok(!/src=["']cookie-banner\.js["']/.test(html), id + ' no external cookie js');
            assert.ok(/hb-cookie-banner[\s\S]*?\bhidden\b/.test(html), id + ' banner has hidden attr');
            assert.ok(/el\.hidden\s*=\s*false/.test(html), id + ' accept/show path sets hidden=false');
            assert.ok(/el\.hidden\s*=\s*true/.test(html), id + ' accept path can hide banner');

            assert.ok(!/href=["']privacy\.html["']/.test(html), id + ' no raw privacy.html (would hit /app/)');
            assert.ok(!/href=["']terms\.html["']/.test(html), id + ' no raw terms.html');
            assert.ok(!/href=["']cookies\.html["']/.test(html), id + ' no raw cookies.html');
            assert.ok(/data-hb-preview-legal="privacy\.html"/.test(html), id + ' privacy isolated');
            assert.ok(/data-hb-preview-legal="terms\.html"/.test(html), id + ' terms isolated');
            assert.ok(/data-hb-preview-legal="cookies\.html"/.test(html), id + ' cookies isolated');
            assert.ok(/href="#hb-preview-legal-privacy\.html"/.test(html), id + ' privacy hash href');
            assert.ok(/href="#hb-preview-legal-terms\.html"/.test(html), id + ' terms hash href');
            assert.ok(/href="#hb-preview-legal-cookies\.html"/.test(html), id + ' cookies hash href');
            assert.ok(/id="hb-preview-legal-docs"/.test(html), id + ' embedded legal docs JSON');
            assert.ok(/data-hb-preview-legal-nav/.test(html), id + ' legal nav interceptor');
            assert.ok(!/href=["']data:text\/html/i.test(html), id + ' no data:text/html legal href');
            assert.ok(!/\/app\/(?:privacy|terms|cookies)\.html/.test(html), id + ' no builder /app legal paths');
            assert.ok(!/owner-gated|owner-ului/i.test(html), id + ' no owner jargon in preview');

            // Pull privacy payload from the embedded JSON (not a data: URL).
            const docsMatch = html.match(/id="hb-preview-legal-docs"[^>]*>([\s\S]*?)<\/script>/);
            assert.ok(docsMatch, id + ' legal docs script body');
            const docs = JSON.parse(docsMatch[1]);
            const raw = String(docs['privacy.html'] || '');
            assert.ok(/Politica de confidențialitate/i.test(raw), id + ' privacy RO title');
            assert.ok(raw.includes(config.business.name), id + ' privacy names business');
            assert.ok(/\[PLACEHOLDER/i.test(raw), id + ' privacy PLACEHOLDER');
            assert.ok(!/owner-gated|Hidook Site Builder/i.test(raw), id + ' privacy not builder chrome / jargon');
            assert.ok(/titularul afacerii|de completat|PLACEHOLDER/i.test(raw), id + ' privacy honest RO unfinished');
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

    await check('HEAD exportSiteZip contains legal pages, styles, attribution, favicon, no secrets', async () => {
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
            const privacy = fs.readFileSync(path.join(dest, 'privacy.html'), 'utf8');
            assertNoSecretLeak(privacy);
            assert.ok(
                /<link\s+rel=["']icon["']\s+href=["']data:image\/svg\+xml/i.test(privacy),
                'exported legal page declares an inline favicon instead of requesting /favicon.ico'
            );

            const staticServer = http.createServer((req, res) => {
                const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
                const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
                const file = path.resolve(dest, rel);
                if (!file.startsWith(path.resolve(dest) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                    res.statusCode = 404;
                    res.end('not found');
                    return;
                }
                res.statusCode = 200;
                res.end(fs.readFileSync(file));
            });
            await new Promise((resolve, reject) => {
                staticServer.once('error', reject);
                staticServer.listen(0, '127.0.0.1', resolve);
            });
            try {
                const staticPort = staticServer.address().port;
                await withBrave(async (browser) => {
                    const page = await browser.newPage();
                    const requests = [];
                    const notFound = [];
                    page.on('request', (request) => requests.push(request.url()));
                    page.on('response', (response) => {
                        if (response.status() === 404) notFound.push(response.url());
                    });
                    await page.goto(`http://127.0.0.1:${staticPort}/privacy.html`, { waitUntil: 'load' });
                    await sleep(300);
                    assert.ok(!requests.some((url) => /\/favicon\.ico(?:$|[?#])/.test(url)), 'legal page does not request /favicon.ico');
                    assert.deepStrictEqual(notFound, [], 'plain static legal page has no 404 responses');
                    await page.close();
                });
            } finally {
                await new Promise((resolve) => staticServer.close(resolve));
            }
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
                assert.ok(!/owner-gated|owner-ului/i.test(priv), 'export privacy has no owner-gated jargon');
                assert.ok(!/Hidook Site Builder/i.test(priv), 'export privacy is business page not builder chrome');
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

        await check('HEAD Brave: Salon first trusted Accept works after Mobile → Desktop once generated controls report ready', async () => {
            await withBrave(async (browser) => {
                const context = await browser.newContext();
                try {
                    const page = await context.newPage();
                    await page.goto(`http://127.0.0.1:${port}/app/#templates`, { waitUntil: 'domcontentloaded' });
                    await page.waitForSelector('.btn-preview-tpl[data-id="portfolio"]', { timeout: 20000 });
                    await page.click('.btn-preview-tpl[data-id="portfolio"]');
                    await page.waitForSelector('#modal-preview', { state: 'visible' });
                    const frame = page.frameLocator('#preview-modal-iframe');
                    const accept = frame.locator('#hb-cookie-accept');
                    await accept.waitFor({ state: 'visible', timeout: 20000 });
                    await page.waitForFunction(
                        () => document.getElementById('preview-modal-iframe').dataset.previewReady === 'true',
                        null,
                        { timeout: 5000 }
                    );
                    assert.strictEqual(
                        await page.locator('#preview-modal-iframe').getAttribute('aria-busy'),
                        'false',
                        'Salon generated controls report interactive readiness'
                    );
                    await page.click('#modal-preview-mobile');
                    await page.click('#modal-preview-desktop');
                    const box = await accept.boundingBox();
                    assert.ok(box, 'Salon Accept has trusted-click coordinates');
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    await frame.locator('#hb-cookie-banner').waitFor({ state: 'hidden', timeout: 5000 });
                    assert.ok(
                        await frame.locator('#hb-cookie-banner').evaluate((el) => el.hidden),
                        'Salon first trusted Accept hides notice after viewport switch'
                    );
                    await page.close();
                } finally {
                    await context.close();
                }
            });
        });

        await check('HEAD Brave: catalog and editor previews isolate consent; dashboard-auth ZIP saves and downloads current Restaurant draft', async () => {
            await withBrave(async (browser) => {
                const context = await browser.newContext({ acceptDownloads: true });
                const page = await context.newPage();
                await page.goto(`http://127.0.0.1:${port}/app/#templates`, { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('.btn-preview-tpl[data-id="product-menu"]', { timeout: 20000 });

                for (const id of TPLS) {
                    await page.click('.btn-preview-tpl[data-id="' + id + '"]');
                    await page.waitForSelector('#modal-preview', { state: 'visible' });
                    await page.waitForSelector('#preview-modal-iframe[aria-busy="true"]', { timeout: 5000 });
                    await page.waitForSelector('#preview-modal-iframe[aria-busy="false"]', { timeout: 20000 });
                    await page.waitForFunction(
                        () => document.getElementById('preview-modal-iframe').dataset.previewReady === 'true',
                        null,
                        { timeout: 5000 }
                    );
                    const outerDisplay = await page.$eval('#hb-cookie-banner', (el) => getComputedStyle(el).display);
                    assert.strictEqual(outerDisplay, 'none', id + ' hides builder-origin notice while preview is open');

                    const frame = page.frameLocator('#preview-modal-iframe');
                    const accept = frame.locator('#hb-cookie-accept');
                    await accept.waitFor({ state: 'visible', timeout: 20000 });
                    await page.click('#modal-preview-mobile');
                    await page.click('#modal-preview-desktop');
                    await accept.click();
                    await frame.locator('#hb-cookie-banner').waitFor({ state: 'hidden', timeout: 5000 });
                    assert.ok(
                        await frame.locator('#hb-cookie-banner').evaluate((el) => el.hidden),
                        id + ' first generated Accept after Mobile → Desktop hides notice'
                    );

                    // Use Playwright's trusted pointer input as soon as the visible
                    // catalog controls are available. A DOM el.click() after waiting
                    // for document.complete missed Desserdirina's provisional srcdoc.
                    const privacy = frame.locator('[data-hb-preview-legal="privacy.html"]');
                    await privacy.click({ timeout: 20000 });
                    await frame.locator('.hb-legal').waitFor({ state: 'visible', timeout: 15000 });
                    assert.ok(
                        /Politica de confidențialitate/i.test(await frame.locator('body').innerText()),
                        id + ' first trusted catalog legal click opens the generated page'
                    );

                    await page.click('#btn-close-preview');
                    await page.waitForSelector('#modal-preview', { state: 'hidden' });
                    const restored = await page.$eval('#hb-cookie-banner', (el) => getComputedStyle(el).display);
                    assert.notStrictEqual(restored, 'none', id + ' restores builder notice after preview closes');
                }

                for (const id of TPLS) {
                    await page.click('.btn-start-tpl[data-id="' + id + '"]');
                    await page.waitForURL(/#edit$/, { timeout: 20000 });
                    await page.waitForSelector('#preview-iframe');
                    const closeDrawer = page.locator('#btn-close-drawer');
                    if (await closeDrawer.isVisible()) await closeDrawer.click();

                    const outerDisplay = await page.$eval('#hb-cookie-banner', (el) => getComputedStyle(el).display);
                    assert.strictEqual(outerDisplay, 'none', id + ' editor hides builder-origin notice');

                    const frame = page.frameLocator('#preview-iframe');
                    const accept = frame.locator('#hb-cookie-accept');
                    await accept.waitFor({ state: 'visible', timeout: 20000 });
                    await accept.click();
                    await frame.locator('#hb-cookie-banner').waitFor({ state: 'hidden', timeout: 5000 });
                    assert.ok(await frame.locator('#hb-cookie-banner').evaluate((el) => el.hidden), id + ' editor generated Accept hides notice');

                    await page.goto(`http://127.0.0.1:${port}/app/#templates`);
                    await page.waitForSelector('.btn-start-tpl[data-id="' + id + '"]');
                }

                await page.click('.btn-start-tpl[data-id="product-menu"]');
                await page.waitForURL(/#edit$/, { timeout: 20000 });
                await page.waitForSelector('#btn-publish');
                const ogImageInput = page.locator('[name="seo.ogImage"]');
                if (!(await ogImageInput.isVisible())) await page.click('#btn-open-drawer');
                const ogImage = await ogImageInput.inputValue();
                assert.ok(/^images\//.test(ogImage), 'Restaurant starts with a relative site-local og:image');
                assert.notStrictEqual(await ogImageInput.getAttribute('aria-invalid'), 'true', 'relative og:image is valid');
                await ogImageInput.fill('nu este o imagine');
                assert.strictEqual(await ogImageInput.getAttribute('aria-invalid'), 'true', 'garbage asset text stays invalid');
                assert.ok(/images\/|link complet/i.test(await ogImageInput.evaluate((el) => el.validationMessage)), 'invalid asset explains accepted URL/path formats in Romanian');
                await ogImageInput.fill(ogImage);
                await page.click('#btn-close-drawer');

                await page.click('#btn-publish');
                await page.waitForSelector('#modal-publish', { state: 'visible' });
                assert.ok(!/Introdu un link complet/.test(await page.locator('#toast').textContent()), 'publish is not blocked by relative og:image');
                await page.click('#btn-close-publish');

                const generatedNotice = page.frameLocator('#preview-iframe').locator('#hb-cookie-banner');
                await generatedNotice.waitFor({ state: 'visible', timeout: 10000 });
                await page.click('#btn-download-zip');
                await page.waitForFunction(() => /Autentifică-te ca să descarci ZIP-ul/.test(document.getElementById('toast').textContent));
                const errorToastBox = await page.locator('#toast').boundingBox();
                const noticeBox = await generatedNotice.boundingBox();
                assert.ok(errorToastBox && noticeBox, 'ZIP sign-in toast and generated notice are measurable');
                const errorToastStack = await page.evaluate(() => {
                    const toast = document.getElementById('toast');
                    const preview = document.getElementById('preview-iframe');
                    return {
                        toastZ: getComputedStyle(toast).zIndex,
                        previewZ: getComputedStyle(preview).zIndex,
                        opacity: getComputedStyle(toast).opacity,
                    };
                });
                assert.ok(
                    Number.isFinite(Number(errorToastStack.previewZ)) &&
                        Number(errorToastStack.toastZ) > Number(errorToastStack.previewZ),
                    'ZIP sign-in toast computed stack must be above #preview-iframe: ' + JSON.stringify(errorToastStack)
                );
                assert.ok(Number(errorToastStack.opacity) >= 0.99, 'ZIP sign-in toast must be fully opaque immediately');
                assert.ok(
                    errorToastBox.y + errorToastBox.height <= noticeBox.y || noticeBox.y + noticeBox.height <= errorToastBox.y,
                    'ZIP sign-in toast must not overlap the generated cookie notice'
                );

                await page.goto(`http://127.0.0.1:${port}/app/#dashboard`);
                await page.waitForSelector('#btn-dashboard-auth', { timeout: 10000 });
                await page.click('#btn-dashboard-auth');
                await page.fill('#input-email', `flow3-ui-${crypto.randomUUID()}@example.com`);
                await page.click('#btn-send-magic');
                await page.waitForSelector('#dev-link', { state: 'visible' });
                await page.click('#dev-link');
                await page.waitForURL(/#edit$/, { timeout: 20000 });

                const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
                await page.click('#btn-download-zip');
                const download = await downloadPromise;
                await page.waitForFunction(() => /ZIP descărcat/.test(document.getElementById('toast').textContent));
                const successNotice = page.frameLocator('#preview-iframe').locator('#hb-cookie-banner');
                await successNotice.waitFor({ state: 'visible', timeout: 10000 });
                const successToastBox = await page.locator('#toast').boundingBox();
                const successNoticeBox = await successNotice.boundingBox();
                assert.ok(successToastBox && successNoticeBox, 'ZIP success toast and generated notice are measurable');
                const successToastStack = await page.evaluate(() => {
                    const toast = document.getElementById('toast');
                    const preview = document.getElementById('preview-iframe');
                    return {
                        toastZ: getComputedStyle(toast).zIndex,
                        previewZ: getComputedStyle(preview).zIndex,
                        opacity: getComputedStyle(toast).opacity,
                    };
                });
                assert.ok(
                    Number.isFinite(Number(successToastStack.previewZ)) &&
                        Number(successToastStack.toastZ) > Number(successToastStack.previewZ),
                    'ZIP success toast computed stack must be above #preview-iframe: ' + JSON.stringify(successToastStack)
                );
                assert.ok(Number(successToastStack.opacity) >= 0.99, 'ZIP success toast must be fully opaque immediately');
                assert.ok(
                    successToastBox.y + successToastBox.height <= successNoticeBox.y ||
                        successNoticeBox.y + successNoticeBox.height <= successToastBox.y,
                    'ZIP success toast must not overlap the generated cookie notice'
                );
                assert.ok(/\.zip$/i.test(download.suggestedFilename()), 'UI download filename is .zip');
                const zipPath = await download.path();
                assert.ok(zipPath && fs.existsSync(zipPath), 'browser produced a real downloaded file');
                const zip = fs.readFileSync(zipPath);
                assert.strictEqual(zip.readUInt32LE(0), 0x04034b50, 'UI download has ZIP signature');

                const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-ui-zip-'));
                try {
                    const names = unzipStore(zip, dest);
                    for (const name of ['index.html', 'styles.css', 'script.js', 'privacy.html', 'terms.html', 'cookies.html', 'cookie-banner.js']) {
                        assert.ok(names.includes(name), 'UI ZIP contains ' + name);
                    }
                    assert.ok(names.some((name) => /^images\//.test(name)), 'UI ZIP contains images');
                    const index = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
                    assert.ok(/Build by hidook\.tech powered by hidook\.agency/.test(index.replace(/<[^>]+>/g, '')), 'UI ZIP keeps attribution');
                    assert.ok(/hb-cookie-banner/.test(index), 'UI ZIP keeps generated cookie banner');
                    assert.ok(!/\/api\/|HIDOOK_TEMPLATES|HidookEngine/.test(index), 'UI ZIP has no Hidook runtime dependency');
                } finally {
                    fs.rmSync(dest, { recursive: true, force: true });
                }
                await context.close();
            });
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }


    // ── Brave/Playwright causal click probes ─────────────────────────────
    // Sandboxed srcdoc iframes without allow-same-origin block parent
    // contentDocument access. Drive clicks via Playwright frame handles (CDP).
    function loadPlaywright() {
        return require(PW_PATH);
    }

    async function withBrave(fn) {
        assert.ok(fs.existsSync(BRAVE), 'Brave binary missing at ' + BRAVE);
        const { chromium } = loadPlaywright();
        const browser = await chromium.launch({
            headless: true,
            executablePath: BRAVE,
        });
        try {
            return await fn(browser);
        } finally {
            await browser.close();
        }
    }

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    async function attachSrcdoc(page, sandbox, html) {
        await page.setContent(
            '<!DOCTYPE html><html><body style="margin:0">' +
                '<iframe id="preview" title="preview" sandbox="' +
                sandbox +
                '" style="width:100%;height:100vh;border:0"></iframe>' +
                '</body></html>',
            { waitUntil: 'domcontentloaded' }
        );
        await page.evaluate((docHtml) => {
            const f = document.getElementById('preview');
            f.srcdoc = docHtml;
        }, html);
        // Wait until Playwright sees a child frame with a body
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            const fr = await previewFrame(page);
            if (fr) {
                try {
                    const ready = await fr.evaluate(() => !!(document && document.body));
                    if (ready) return fr;
                } catch (_) {
                    // frame may be mid-navigation
                }
            }
            await sleep(50);
        }
        throw new Error('preview frame did not become ready');
    }

    async function previewFrame(page) {
        const handle = await page.$('#preview');
        if (!handle) return null;
        return handle.contentFrame();
    }

    async function waitFrameSelector(page, selector, timeoutMs) {
        const deadline = Date.now() + (timeoutMs || 15000);
        while (Date.now() < deadline) {
            const fr = await previewFrame(page);
            if (fr) {
                try {
                    const el = await fr.$(selector);
                    if (el) return fr;
                } catch (_) {}
            }
            await sleep(50);
        }
        throw new Error('timeout waiting for ' + selector + ' in preview frame');
    }

    async function waitFrameText(page, predicate, timeoutMs, label) {
        const deadline = Date.now() + (timeoutMs || 8000);
        let last = '';
        while (Date.now() < deadline) {
            const fr = await previewFrame(page);
            if (fr) {
                try {
                    last = await fr.evaluate(() => (document.body && document.body.innerText) || '');
                    if (predicate(last)) return last;
                } catch (_) {}
            }
            await sleep(50);
        }
        throw new Error('timeout waiting for frame text (' + label + '): ' + last.slice(0, 200));
    }

    async function clickInFrame(fr, selector) {
        const ok = await fr.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            try {
                el.scrollIntoView({ block: 'center', inline: 'nearest' });
            } catch (_) {}
            if (typeof el.click === 'function') el.click();
            else {
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
            return true;
        }, selector);
        assert.ok(ok, 'clickInFrame missing ' + selector);
    }

    function assertVisibleLegal(bodyText, bizName, which) {
        const t = String(bodyText || '');
        assert.ok(t.length > 40, which + ' legal body non-empty');
        assert.ok(!/\/app\/(?:privacy|terms|cookies)/i.test(t), which + ' must not be builder /app chrome');
        assert.ok(!/Hidook Site Builder/i.test(t), which + ' must not be builder product chrome title');
        assert.ok(/\[PLACEHOLDER/i.test(t), which + ' shows PLACEHOLDER');
        assert.ok(
            /confiden|termen|cookie|Politica|Termeni/i.test(t),
            which + ' shows Romanian legal wording'
        );
        if (bizName) {
            assert.ok(t.includes(bizName), which + ' names business ' + bizName);
        }
        assert.ok(!/owner-gated|owner-ului/i.test(t), which + ' no owner-gated jargon');
    }

    await check('causal RED: data:text/html target=_blank legal click does not open a page in Brave', async () => {
        await withBrave(async (browser) => {
            const page = await browser.newPage();
            const legalHtml =
                '<!DOCTYPE html><html lang="ro"><body><main class="hb-legal"><h1>Politica de confidențialitate</h1><p>' +
                BIZ_NAME +
                '</p><p>[PLACEHOLDER: denumire legală]</p></main></body></html>';
            const dataHref = 'data:text/html;charset=utf-8,' + encodeURIComponent(legalHtml);
            const srcdoc =
                '<!DOCTYPE html><html><body style="font-family:system-ui">' +
                '<p id="home-marker">HOME_PREVIEW</p>' +
                '<a id="legal" href="' +
                dataHref +
                '" target="_blank" rel="noopener" data-hb-preview-legal="privacy.html">Confidențialitate</a>' +
                '</body></html>';
            await attachSrcdoc(page, 'allow-scripts allow-popups allow-popups-to-escape-sandbox', srcdoc);
            await waitFrameSelector(page, '#legal', 8000);
            const beforePages = browser.contexts()[0].pages().length;
            const fr = await previewFrame(page);
            await clickInFrame(fr, '#legal');
            await sleep(700);
            const afterPages = browser.contexts()[0].pages().length;
            let frameText = '';
            try {
                const fr2 = await previewFrame(page);
                if (fr2) frameText = await fr2.evaluate(() => (document.body && document.body.innerText) || '');
            } catch (_) {}
            const openedLegal =
                afterPages > beforePages ||
                (/Politica de confiden/i.test(frameText) && /PLACEHOLDER: denumire/i.test(frameText));
            assert.ok(
                !openedLegal,
                'data:text/html click must NOT open legal page (pages ' +
                    beforePages +
                    '→' +
                    afterPages +
                    ', frame=' +
                    frameText.slice(0, 160) +
                    ')'
            );
            assert.ok(/HOME_PREVIEW/.test(frameText), 'iframe should remain on home after dead data: click');
            await page.close();
        });
    });

    await check('HEAD Brave: catalog + editor preview legal clicks open generated RO pages for all five templates', async () => {
        execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
            cwd: ROOT,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        const engineSrc = fs.readFileSync(path.join(ROOT, 'builder/generated/engine.js'), 'utf8');
        const sandbox = { window: {}, console };
        vm.runInNewContext(engineSrc, sandbox);
        const engine = sandbox.window.HidookEngine;

        await withBrave(async (browser) => {
            for (const id of TPLS) {
                const dir = path.join(ROOT, 'templates', id);
                const files = {
                    templateHtml: fs.readFileSync(path.join(dir, 'template.html'), 'utf8'),
                    stylesCss: fs.readFileSync(path.join(dir, 'styles.css'), 'utf8'),
                    scriptJs: fs.readFileSync(path.join(dir, 'script.js'), 'utf8'),
                };
                const collage = path.join(dir, 'collage.js');
                if (fs.existsSync(collage)) files.collageJs = fs.readFileSync(collage, 'utf8');
                const presets = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets;
                const config = JSON.parse(JSON.stringify(presets[0].config || presets[0]));
                config.business = config.business || {};
                const biz = (config.business.name || BIZ_NAME + ' ' + id).trim();
                config.business.name = biz;

                const previewHtml = engine.renderPreview(files, config);
                assert.ok(!/href=["']data:text\/html/i.test(previewHtml), id + ' catalog html has no data: legal href');
                assert.ok(/data-hb-preview-legal-nav/.test(previewHtml), id + ' ships interceptor');

                // Fresh context per template avoids Chromium srcdoc flakiness on large 5th payload.
                const context = await browser.newContext();
                try {
                    const page = await context.newPage();
                    await attachSrcdoc(page, 'allow-scripts', previewHtml);
                    let fr = await waitFrameSelector(page, '[data-hb-preview-legal="privacy.html"]', 20000);
                    // Wait until document complete so late template scripts don't race the interceptor.
                    await fr.evaluate(async () => {
                        if (document.readyState === 'complete') return;
                        await new Promise((r) => window.addEventListener('load', r, { once: true }));
                    });

                    const banner = await fr.evaluate(() => {
                        const el = document.getElementById('hb-cookie-banner');
                        const btn = document.getElementById('hb-cookie-accept');
                        if (!el || !btn) return { ok: false };
                        try { el.hidden = false; } catch (_) {}
                        btn.click();
                        return { ok: true, hiddenAfter: !!el.hidden };
                    });
                    assert.ok(banner.ok, id + ' catalog cookie banner/accept present');

                    const kinds = [
                        { key: 'privacy.html', re: /Politica de confiden/i },
                        { key: 'terms.html', re: /Termeni/i },
                        { key: 'cookies.html', re: /Cookie/i },
                    ];
                    for (const kind of kinds) {
                        await page.evaluate((docHtml) => {
                            document.getElementById('preview').srcdoc = docHtml;
                        }, previewHtml);
                        fr = await waitFrameSelector(page, '[data-hb-preview-legal="' + kind.key + '"]', 20000);
                        await fr.evaluate(async () => {
                            if (document.readyState === 'complete') return;
                            await new Promise((r) => window.addEventListener('load', r, { once: true }));
                        });
                        await clickInFrame(fr, '[data-hb-preview-legal="' + kind.key + '"]');
                        const bodyText = await waitFrameText(
                            page,
                            (t) => kind.re.test(t) && /PLACEHOLDER/i.test(t),
                            15000,
                            id + ' ' + kind.key
                        );
                        assertVisibleLegal(bodyText, biz, id + ' catalog ' + kind.key);
                        assert.ok(!/Se încarcă previzualizarea/i.test(bodyText), id + ' catalog not stuck on loading');
                    }
                    await page.close();

                    // Editor-style preview (editMode) — Privacy click
                    const editHtml = engine.renderPreview(files, config, { editMode: true });
                    assert.ok(!/href=["']data:text\/html/i.test(editHtml), id + ' editor html has no data: legal href');
                    const editPage = await context.newPage();
                    await attachSrcdoc(
                        editPage,
                        'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
                        editHtml
                    );
                    fr = await waitFrameSelector(editPage, '[data-hb-preview-legal="privacy.html"]', 20000);
                    await fr.evaluate(async () => {
                        if (document.readyState === 'complete') return;
                        await new Promise((r) => window.addEventListener('load', r, { once: true }));
                    });
                    await clickInFrame(fr, '[data-hb-preview-legal="privacy.html"]');
                    const editText = await waitFrameText(
                        editPage,
                        (t) => /Politica de confiden/i.test(t) && /PLACEHOLDER/i.test(t),
                        15000,
                        id + ' editor privacy'
                    );
                    assertVisibleLegal(editText, biz, id + ' editor privacy');
                    await editPage.close();
                } finally {
                    await context.close();
                }
            }
        });
    });

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
