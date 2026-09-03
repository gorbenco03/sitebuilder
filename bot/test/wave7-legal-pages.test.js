'use strict';
/**
 * bot/test/wave7-legal-pages.test.js — Wave 7 stranger-facing Hidook legal
 * Terms / Privacy / Cookies on the opened builder landing footer.
 *
 * VISION owner-list: footer must link Hidook legal pages (not Instafidget).
 * Pages ship as labelled product placeholders (not empty stubs, not counsel
 * final). Same origin as the web builder (/app/*).
 *
 * Causal RED on parent Wave 6 SHA (trial chrome, no Hidook legal links).
 * HEAD GREEN: footer links + three pages name Hidook Site Builder.
 *
 * Run: node bot/test/wave7-legal-pages.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '0b996e252ef177204f206e2b873ed20bf96d6e7f';
const BUILDER_HTML = 'builder/index.html';

/** Same-origin paths strangers open from the builder footer. */
const LEGAL_PAGES = [
    // Footer chrome still uses English link labels (Terms/Privacy/Cookies);
    // document <title> + <h1> are Romanian product language (advocate-eed3ca0).
    { label: 'Terms', topicRe: /Termeni|Terms/i, file: 'builder/terms.html', path: '/app/terms.html', hrefRe: /\/app\/terms\.html/i },
    { label: 'Privacy', topicRe: /Confidențialitate|Privacy/i, file: 'builder/privacy.html', path: '/app/privacy.html', hrefRe: /\/app\/privacy\.html/i },
    { label: 'Cookies', topicRe: /Cookie-uri|Cookies/i, file: 'builder/cookies.html', path: '/app/cookies.html', hrefRe: /\/app\/cookies\.html/i },
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-legal-'));
process.env.DATA_DIR = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.SERVER_SECRET = 'w7-legal-' + crypto.randomBytes(8).toString('hex');
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
delete process.env.NODE_ENV;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

let failed = 0;
function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret
                .then(() => console.log('PASS', name))
                .catch((e) => {
                    failed++;
                    console.error('FAIL', name, '-', e.message);
                });
        }
        console.log('PASS', name);
        return Promise.resolve();
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
        return Promise.resolve();
    }
}

function parentBlob(rel) {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
}

function headRead(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function headExists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

function extractFooter(html) {
    const m = html.match(/<footer\b[^>]*class=["'][^"']*landing-footer[^"']*["'][^>]*>[\s\S]*?<\/footer>/i)
        || html.match(/class=["'][^"']*landing-footer[^"']*["'][\s\S]*?<\/footer>/i);
    assert.ok(m, 'landing-footer present');
    return m[0];
}

function assertLegalPageBody(src, label) {
    assert.ok(/Hidook Site Builder/.test(src), `${label}: must name Hidook Site Builder`);
    assert.ok(!/\bDESSERD\b/i.test(src) && !/desserdina/i.test(src), `${label}: no DESSERD`);
    assert.ok(!/\bKanban\b/i.test(src), `${label}: no Kanban jargon`);
    assert.ok(!/instafidget\.hidook\.agency/i.test(src), `${label}: must not point at Instafidget`);
    // Placeholder honesty — not invented law-firm counsel copy
    assert.ok(
        /placeholder|not\s+legal\s+advice|product\s+placeholder|draft\s+placeholder|studio\s+placeholder/i.test(src),
        `${label}: must be clearly labelled as a product placeholder`
    );
    // Not an empty stub a stranger would read as a broken site
    const textish = src
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    assert.ok(textish.length >= 280, `${label}: body too short for a real page (${textish.length} chars)`);
    assert.ok(
        /terms|privacy|cookie|data|service|site/i.test(textish),
        `${label}: must discuss the legal topic in plain language`
    );
}

function httpGet(port, urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            { hostname: '127.0.0.1', port, path: urlPath, headers: { Accept: 'text/html' } },
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
    });
}

(async () => {
    // ── Causal RED on parent Wave 6 ──────────────────────────────────────────
    await check(`parent ${PARENT_SHA.slice(0, 7)} landing footer has no Hidook Terms/Privacy/Cookies links`, () => {
        const html = parentBlob(BUILDER_HTML);
        const footer = extractFooter(html);
        assert.ok(/Hidook Site Builder/.test(footer), 'parent footer still brands Hidook');
        for (const p of LEGAL_PAGES) {
            assert.ok(
                !p.hrefRe.test(footer),
                `parent footer must not already link ${p.label} at ${p.hrefRe}`
            );
        }
        assert.ok(
            !/\/app\/(terms|privacy|cookies)\.html/i.test(html),
            'parent builder HTML must not already ship /app legal hrefs'
        );
    });

    await check(`parent ${PARENT_SHA.slice(0, 7)} has no builder Terms/Privacy/Cookies pages`, () => {
        for (const p of LEGAL_PAGES) {
            let present = true;
            try {
                execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${PARENT_SHA}:${p.file}`], {
                    encoding: 'utf8',
                    stdio: ['ignore', 'ignore', 'ignore'],
                });
            } catch {
                present = false;
            }
            assert.ok(!present, `parent must not already have ${p.file}`);
        }
    });

    // ── HEAD GREEN ───────────────────────────────────────────────────────────
    await check('HEAD landing footer links Hidook Terms, Privacy, and Cookies on /app origin', () => {
        const html = headRead(BUILDER_HTML);
        const footer = extractFooter(html);
        assert.ok(/Hidook Site Builder/.test(footer), 'footer brands Hidook Site Builder');
        assert.ok(!/pay\s+once/i.test(footer), 'footer keeps Wave 6 trial chrome (no pay-once)');
        assert.ok(!/instafidget\.hidook\.agency/i.test(footer), 'footer must not use Instafidget legal URLs');

        for (const p of LEGAL_PAGES) {
            assert.ok(p.hrefRe.test(footer), `footer must link ${p.label} via ${p.hrefRe}`);
            assert.ok(new RegExp(p.label, 'i').test(footer), `footer shows ${p.label} label`);
        }

        assert.ok(
            /7[\s-]*day\s+trial|Card\s*→\s*7-day\s+trial|\bcard\b/i.test(footer),
            'footer still mentions trial/card flow'
        );
    });

    await check('HEAD three legal pages exist, name Hidook Site Builder, are not empty stubs', () => {
        for (const p of LEGAL_PAGES) {
            assert.ok(headExists(p.file), `missing ${p.file}`);
            const src = headRead(p.file);
            assertLegalPageBody(src, p.label);
            assert.ok(
                new RegExp(`<title>[^<]*(?:${p.topicRe.source})`, 'i').test(src) ||
                    new RegExp(`<h1[^>]*>[^<]*(?:${p.topicRe.source})`, 'i').test(src),
                `${p.label}: title or h1 should name the page topic`
            );
        }
    });

    await check('HEAD legal pages are served under builder/ (same /app static root strangers already use)', () => {
        for (const p of LEGAL_PAGES) {
            assert.ok(p.file.startsWith('builder/'), `${p.file} must live under builder/ for /app/*`);
            assert.ok(headExists(p.file), p.file);
        }
        const server = headRead('bot/server.js');
        assert.ok(/serveStatic/.test(server) && /BUILDER_DIR/.test(server), 'server still serves builder via /app');
    });

    await check('HEAD keeps product identity and pricing modules untouched by this card', () => {
        const html = headRead(BUILDER_HTML);
        assert.ok(/Hidook Site Builder/.test(html), 'product name');
        assert.ok(!/\bDESSERD\b/i.test(html), 'no DESSERD');
        assert.ok(!/\bKanban\b/i.test(html), 'no Kanban in builder chrome');
        const pricing = headRead('bot/pricing.js');
        assert.ok(/PRICE_CENTS\s*=\s*9900/.test(pricing) || /9900/.test(pricing), 'PRICE_CENTS stays 9900');
    });

    // Live /app static smoke (same origin strangers already use)
    delete require.cache[require.resolve('../server.js')];
    const { startServer } = require('../server.js');
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const { port } = srv.address();

    await check('HEAD GET /app/terms|privacy|cookies.html returns real Hidook pages (not SPA fallback empty)', async () => {
        for (const p of LEGAL_PAGES) {
            const res = await httpGet(port, p.path);
            assert.strictEqual(res.status, 200, `${p.path} status`);
            const ct = String(res.headers['content-type'] || '');
            assert.ok(/text\/html/i.test(ct), `${p.path} content-type html`);
            assert.ok(/Hidook Site Builder/.test(res.body), `${p.path} names product`);
            assert.ok(/placeholder|not\s+legal\s+advice/i.test(res.body), `${p.path} placeholder label`);
            // Must not be the SPA landing (which has screen-edit / templates-grid)
            assert.ok(!/id=["']screen-edit["']/.test(res.body), `${p.path} must not be SPA index fallback`);
            assert.ok(!/instafidget\.hidook\.agency/i.test(res.body), `${p.path} no Instafidget`);
        }
        // Footer on landing still reachable
        const landing = await httpGet(port, '/app/');
        assert.strictEqual(landing.status, 200);
        const footer = extractFooter(landing.body);
        for (const p of LEGAL_PAGES) {
            assert.ok(p.hrefRe.test(footer), `live landing footer links ${p.label}`);
        }
    });

    await new Promise((r) => srv.close(r));

    if (failed) {
        console.error('\nwave7-legal-pages.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave7-legal-pages.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
