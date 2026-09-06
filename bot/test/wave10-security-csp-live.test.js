'use strict';
/**
 * bot/test/wave10-security-csp-live.test.js — Wave 10 security, L2
 * (2026-09-06 re-audit, backend-security/FINDINGS.md).
 *
 * L2: published customer sites (`/live/<slug>/*` and every non-/app/ route)
 * shipped `default-src * data: blob: 'unsafe-inline'` — a wildcard
 * default-src mitigates nothing: it lets an injected `<script src=
 * "https://attacker.example/x.js">` load, lets a compromised page
 * exfiltrate to any endpoint via fetch/XHR, and adds zero friction beyond
 * what the browser would already do with no CSP at all.
 *
 * Fix: DEFAULT_CSP in bot/server.js is now an explicit per-directive
 * allowlist (see its docblock for exactly which template feature drove
 * each directive). This oracle proves two separate things:
 *
 *   PART A — the tightening is real and blocks what the old policy let
 *   through. Two static pages (served by tiny local HTTP servers, no
 *   product code involved) are loaded in a real Chromium: one with the
 *   OLD CSP header, one with the NEW one, both embedding a cross-origin
 *   `<script src="http://.../evil.js">` from a genuinely different origin.
 *   Under the OLD policy the script must run; under the NEW policy it must
 *   be blocked (and a CSP violation must appear in the console).
 *
 *   PART B — the tightened policy does not break a real published site.
 *   Publishes an actual desserdirina site (richest feature set: inline
 *   template <script>/<style>, the hardcoded `www.instagram.com/embed.js`
 *   external script behind instagram.embedUrl, a base64 data-URI photo,
 *   self-hosted @font-face woff2, and a WhatsApp link) through the real
 *   product code (webpublish.publishSite — build.js is untouched/frozen
 *   for this fix), loads it in a real Chromium, and asserts zero CSP
 *   violation console messages while the page visibly renders (business
 *   name, WhatsApp link, category photo).
 *
 * Screenshots + console logs saved under 04-QA-Evidence/Wave10-security/csp/.
 *
 * Run: node --experimental-sqlite bot/test/wave10-security-csp-live.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave10-security', 'csp');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const require2 = createRequire(__filename);
let chromium;
try {
    ({ chromium } = require2('playwright'));
} catch (e) {
    console.error('playwright not found in node_modules — cannot run this oracle:', e.message);
    process.exit(1);
}

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

// ---------------------------------------------------------------------------
// PART A helpers — synthetic old-vs-new CSP proof, no product code involved.
// ---------------------------------------------------------------------------

const OLD_CSP = "default-src * data: blob: 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
// Mirrors bot/server.js's DEFAULT_CSP exactly (kept in sync manually — this
// file intentionally does not import the live constant, so a future edit to
// DEFAULT_CSP that silently regresses is caught by PART B's live-header
// assertion instead, not by this synthetic constant matching itself).
const NEW_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.instagram.com; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self' https:; frame-src https:; object-src 'none'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'self'";

function startStaticServer({ cspHeader, scriptOrigin }) {
    const server = http.createServer((req, res) => {
        if (req.url === '/evil.js') {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end("window.__wave10_external_script_ran = true;");
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': cspHeader,
        });
        res.end(`<!DOCTYPE html><html><head><title>csp-probe</title></head><body>
<h1>csp probe</h1>
<script src="${scriptOrigin}/evil.js"></script>
</body></html>`);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function loadAndCheckExternalScript(browser, { cspHeader, label }) {
    // Two distinct origins (different ports on 127.0.0.1 are cross-origin
    // for CSP purposes) so the embedded <script src> is genuinely
    // cross-origin, exactly like an attacker's payload would be.
    const scriptHost = await startStaticServer({ cspHeader: 'default-src *', scriptOrigin: '' }); // just serves /evil.js
    const scriptOrigin = `http://127.0.0.1:${scriptHost.address().port}`;
    const pageHost = await startStaticServer({ cspHeader, scriptOrigin });

    const page = await browser.newPage();
    const consoleMessages = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));
    try {
        await page.goto(`http://127.0.0.1:${pageHost.address().port}/`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
        const ran = await page.evaluate(() => window.__wave10_external_script_ran === true);
        const cspViolation = consoleMessages.some((m) => /content security policy|refused to load/i.test(m));
        return { ran, cspViolation, consoleMessages };
    } finally {
        await page.close();
        await new Promise((r) => scriptHost.close(r));
        await new Promise((r) => pageHost.close(r));
    }
}

// ---------------------------------------------------------------------------
// PART B helpers — real published site.
// ---------------------------------------------------------------------------

function loadPreset(tid, idx = 0) {
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tid, 'presets.json'), 'utf8')).presets;
    return JSON.parse(JSON.stringify(presets[idx].config));
}

(async () => {
    const browser = await chromium.launch();

    try {
        // ---- PART A: synthetic old-vs-new proof ----
        await check('PART A (RED): the OLD wildcard CSP lets a cross-origin injected <script> execute', async () => {
            const { ran } = await loadAndCheckExternalScript(browser, { cspHeader: OLD_CSP, label: 'old' });
            assert.strictEqual(ran, true, 'old policy must NOT have blocked the cross-origin script (proves the old policy mitigated nothing)');
        });

        await check('PART A (GREEN): the NEW tightened CSP blocks the same cross-origin injected <script>', async () => {
            const { ran, cspViolation, consoleMessages } = await loadAndCheckExternalScript(browser, { cspHeader: NEW_CSP, label: 'new' });
            assert.strictEqual(ran, false, 'new policy must block the cross-origin script: console=' + JSON.stringify(consoleMessages));
            assert.ok(cspViolation, 'browser must report a CSP violation for the blocked script: ' + JSON.stringify(consoleMessages));
        });

        // ---- PART B: real published site, unbroken ----
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-csp-live-'));
        process.env.DATA_DIR               = tmpDir;
        process.env.SERVER_SECRET          = 'wave10-csp-live-' + crypto.randomBytes(8).toString('hex');
        process.env.HIDOOK_TEST_PAY        = '1';
        process.env.HIDOOK_ISOLATED_DEPLOY = '1';
        process.env.NODE_ENV               = 'test';
        process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
        delete process.env.STRIPE_SECRET_KEY;
        delete process.env.BRAND_DOMAIN;
        delete process.env.RESEND_API_KEY;
        delete process.env.DEPLOY_PROVIDER;
        delete process.env.HIDOOK_FAKE_DEPLOY;

        const registry   = require('../registry.js');
        const webpublish = require('../webpublish.js');
        const { startServer } = require('../server.js');

        const server = startServer({ port: 0 });
        await new Promise((r) => server.once('listening', r));
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;
        process.env.PUBLIC_URL = base;

        try {
            await check('header sanity: DEFAULT_CSP no longer contains a wildcard default-src', async () => {
                const res = await fetch(`${base}/live/does-not-exist-wave10/`);
                const csp = res.headers.get('content-security-policy') || '';
                assert.ok(csp, 'CSP header must be present');
                assert.ok(!/default-src\s+\*/.test(csp), 'must not contain default-src *: ' + csp);
                assert.ok(/script-src[^;]*'self'/.test(csp), 'script-src must be scoped to self (+allowlist): ' + csp);
                assert.ok(/object-src\s+'none'/.test(csp), 'object-src none unchanged: ' + csp);
                assert.ok(/frame-ancestors\s+'self'/.test(csp), 'frame-ancestors self unchanged: ' + csp);
            });

            const distinctive = 'Cofetăria Wave10 ' + crypto.randomBytes(3).toString('hex');
            const cfg = loadPreset('desserdirina', 0);
            cfg.business.name = distinctive;
            cfg.business.title = distinctive;
            // Exercise the one hardcoded external script + iframe embed.
            cfg.instagram.embedUrl = 'https://www.instagram.com/desserdirina/embed/';
            // NOTE on img-src data:: webpublish.js's materializeImages() walks
            // the ENTIRE config recursively at publish time and writes every
            // data:image/... URI it finds to a real images/*.{jpg,png} file,
            // rewriting the reference to that same-origin path (verified by
            // inspecting a real publish's output directory — no data: URI
            // survives into a live page's HTML). So img-src data: has no
            // live-page image to prove against here; it exists in DEFAULT_CSP
            // for the builder-adjacent export/draft paths, not `/live/*`
            // itself. What DOES need proving for `/live/*` is the normal
            // same-origin images/*.jpg path (img-src 'self') — the preset's
            // own category photos already exercise that below.
            // WhatsApp link is already in the preset (contact.waHref) — untouched.

            const user = registry.getOrCreateUserByEmail(`wave10-csp-${crypto.randomUUID()}@example.com`);
            const paidUntil = new Date(Date.now() + 365 * 864e5).toISOString();
            const slug = 'wave10-csp-' + crypto.randomBytes(3).toString('hex');
            let site = registry.createSite({
                userId: user.id, templateId: 'desserdirina', templateVersion: 1,
                slug, platform: 'web',
            });
            registry.updateSite(site.id, { paid: true, paidUntil, slug });
            site = registry.getSite(site.id);

            const live = await webpublish.publishSite({ site, config: cfg, images: [] });
            assert.ok(live && live.url, 'publishSite must return a live url');

            await check('the published page loads with no CSP violations and renders real content', async () => {
                const page = await browser.newPage();
                const consoleMessages = [];
                const cspViolations = [];
                page.on('console', (msg) => {
                    consoleMessages.push(msg.text());
                    if (/content security policy|refused to (load|execute|connect|frame)/i.test(msg.text())) {
                        cspViolations.push(msg.text());
                    }
                });
                const failedRequests = [];
                page.on('requestfailed', (req) => failedRequests.push(req.url() + ' :: ' + (req.failure() && req.failure().errorText)));

                try {
                    const url = `${base}/live/${site.slug}/`;
                    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
                    assert.ok(resp && resp.ok(), 'live page must load 200, got ' + (resp && resp.status()));

                    const bodyText = await page.textContent('body');
                    assert.ok(bodyText.includes(distinctive), 'live page must show the business name');

                    const waHref = await page.evaluate(() => {
                        const a = document.querySelector('a[href^="https://wa.me/"]');
                        return a ? a.getAttribute('href') : null;
                    });
                    assert.ok(waHref, 'WhatsApp link must be present and unbroken by the new CSP');

                    // Same-origin category photo (images/*.jpg, materialized
                    // at publish time — see the NOTE above) must actually
                    // decode under img-src 'self': a real <img> with nonzero
                    // natural dimensions, not a broken-image icon CSP would
                    // produce if img-src were wrongly scoped.
                    const photoOk = await page.evaluate(() => {
                        const img = Array.from(document.images).find((i) => /\/images\//.test(i.currentSrc || i.src));
                        return !!img && img.naturalWidth > 0 && img.naturalHeight > 0;
                    });
                    assert.ok(photoOk, 'a same-origin images/*.jpg category photo must render under img-src \'self\'');

                    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'published-desserdirina-after-csp.png'), fullPage: true });
                    fs.writeFileSync(
                        path.join(EVIDENCE_DIR, 'console-log-after-csp.json'),
                        JSON.stringify({ consoleMessages, failedRequests, cspViolations }, null, 2)
                    );

                    assert.strictEqual(cspViolations.length, 0,
                        'no CSP violations should be logged on a legitimate published site: ' + JSON.stringify(cspViolations, null, 2));
                } finally {
                    await page.close();
                }
            });

            // Lighter sweep across the other four templates: each has its own
            // inline <script>/<style> blocks and asset layout — confirm the
            // tightened CSP doesn't single out desserdirina as a lucky case.
            for (const tid of ['portfolio', 'professionals', 'local-service', 'product-menu']) {
                await check(`published ${tid} site (preset 0) loads with zero CSP violations`, async () => {
                    const tCfg = loadPreset(tid, 0);
                    const tName = 'Wave10 ' + tid + ' ' + crypto.randomBytes(2).toString('hex');
                    if (tCfg.business) { tCfg.business.name = tName; tCfg.business.title = tName; }
                    const tUser = registry.getOrCreateUserByEmail(`wave10-csp-${tid}-${crypto.randomUUID()}@example.com`);
                    const tSlug = 'wave10-csp-' + tid + '-' + crypto.randomBytes(3).toString('hex');
                    let tSite = registry.createSite({
                        userId: tUser.id, templateId: tid, templateVersion: 1, slug: tSlug, platform: 'web',
                    });
                    registry.updateSite(tSite.id, { paid: true, paidUntil, slug: tSlug });
                    tSite = registry.getSite(tSite.id);
                    const tLive = await webpublish.publishSite({ site: tSite, config: tCfg, images: [] });
                    assert.ok(tLive && tLive.url, tid + ': publishSite must return a live url');

                    const page = await browser.newPage();
                    const cspViolations = [];
                    page.on('console', (msg) => {
                        if (/content security policy|refused to (load|execute|connect|frame)/i.test(msg.text())) {
                            cspViolations.push(msg.text());
                        }
                    });
                    try {
                        const resp = await page.goto(`${base}/live/${tSite.slug}/`, { waitUntil: 'networkidle', timeout: 20000 });
                        assert.ok(resp && resp.ok(), tid + ': live page must load 200, got ' + (resp && resp.status()));
                        const bodyText = await page.textContent('body');
                        assert.ok(bodyText.includes(tName), tid + ': live page must show the business name');
                        await page.screenshot({ path: path.join(EVIDENCE_DIR, `published-${tid}-after-csp.png`), fullPage: true });
                        assert.strictEqual(cspViolations.length, 0,
                            tid + ': no CSP violations should be logged: ' + JSON.stringify(cspViolations, null, 2));
                    } finally {
                        await page.close();
                    }
                });
            }
        } finally {
            await new Promise((r) => server.close(() => r()));
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    } finally {
        await browser.close();
    }

    if (failed) {
        console.error('\nwave10-security-csp-live.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave10-security-csp-live.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
