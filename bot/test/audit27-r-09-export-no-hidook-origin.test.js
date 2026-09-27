'use strict';
/**
 * bot/test/audit27-r-09-export-no-hidook-origin.test.js
 *
 * R-09 (audit 2026-09-27, export#1): a ZIP/HTML export of a Professional site
 * with appointment.nativeBooking active must not depend on the Hidook origin
 * to work (VISION §6). Before the fix, the exported index.html carried
 * `<link>`/`<script src>`/`data-api-base` pointed at whatever origin
 * bot/calendar-native/cutover.js#applyCutoverToConfig had injected into the
 * saved config at publish time (production sets PUBLIC_URL to the bot's own
 * origin) — an export reads that same saved config, so the widget kept
 * asking that origin for its CSS/JS/booking API forever, even after the
 * customer unzips the site on a totally unrelated static host.
 *
 * This oracle builds the ZIP + standalone HTML export through the real
 * bot/site-export.js functions with a config carrying that publish-time
 * shape, unzips the ZIP with the system `unzip` binary, serves it from a
 * bare static HTTP server (no Hidook code anywhere) and drives it with real
 * Chromium against a second local server standing in for "the Hidook
 * origin" — asserting that server never receives a single request, and that
 * an honest local fallback (request form + WhatsApp CTA) is what the visitor
 * gets instead.
 *
 * Causal: fails on the pre-fix bot/site-export.js (buildStaticSiteTree
 * rendered the config's nativeBooking/nativeApiBase verbatim); passes once
 * disableNativeBookingForExport() forces the offline export back to the
 * local request-form branch.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-09-export-no-hidook-origin.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

function loadPlaywright() {
    for (const candidate of [
        path.join(ROOT, 'node_modules', 'playwright'),
        '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    ]) {
        try { return require(candidate); } catch (_) {}
    }
    throw new Error('playwright not found');
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
};

function serveDir(dir) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
            if (urlPath === '/') urlPath = '/index.html';
            const filePath = path.join(dir, urlPath);
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('not found'); return; }
                res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

/** Stand-in for the Hidook bot origin. Records every request it receives. */
function startFakeHidookOrigin() {
    const hits = [];
    const server = http.createServer((req, res) => {
        hits.push(req.url);
        if (/\.css(?:\?|$)/.test(req.url)) {
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end('/* fake hidook widget css, should never be requested by an export */');
        } else if (/\.js(?:\?|$)/.test(req.url)) {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end('/* fake hidook widget js, should never be requested by an export */');
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
        }
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, hits }));
    });
}

/**
 * A professionals config exactly as bot/calendar-native/cutover.js's
 * applyCutoverToConfig() leaves it in the saved site version after a real
 * publish with native booking opted in — which is the config an export
 * reads (bot/server.js#resolveExportDraft, not owned by this task).
 */
function loadProfessionalsConfigWithNativeBooking(hidookOrigin) {
    const presets = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets;
    const config = JSON.parse(JSON.stringify(presets[0].config));
    config.appointment.nativeBooking = 'da';
    config.appointment.nativeApiBase = hidookOrigin;
    config.appointment.nativeCustomerId = 'cust_audit27_r09';
    config.appointment.nativeSiteId = 'site_audit27_r09';
    assert.ok(config.contact && config.contact.waHref, 'preset must carry a WhatsApp link for the fallback assertion');
    return config;
}

test('audit27-R-09: exported ZIP with native booking on makes zero requests to the Hidook origin', async (t) => {
    const { chromium } = loadPlaywright();
    const { server: hidookServer, hits } = await startFakeHidookOrigin();
    t.after(() => hidookServer.close());
    const hidookOrigin = 'http://127.0.0.1:' + hidookServer.address().port;

    const config = loadProfessionalsConfigWithNativeBooking(hidookOrigin);
    const result = siteExport.exportSiteZip({ templateId: 'professionals', config, images: [] });

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r09-zip-'));
    const zipPath = path.join(workDir, 'export.zip');
    fs.writeFileSync(zipPath, result.zip);
    const unzippedDir = path.join(workDir, 'unzipped');
    fs.mkdirSync(unzippedDir, { recursive: true });
    execFileSync('unzip', ['-q', zipPath, '-d', unzippedDir]);
    assert.ok(fs.existsSync(path.join(unzippedDir, 'index.html')), 'unzip did not produce index.html');

    const staticServer = await serveDir(unzippedDir);
    t.after(() => staticServer.close());
    const staticOrigin = 'http://127.0.0.1:' + staticServer.address().port;

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const requestedUrls = [];
    page.on('request', (r) => requestedUrls.push(r.url()));

    await page.goto(staticOrigin + '/', { waitUntil: 'networkidle' });
    // Give any async widget boot a moment to fire its fetches, if it were
    // ever going to.
    await page.waitForTimeout(1500);
    await page.close();

    const toHidook = requestedUrls.filter((u) => u.startsWith(hidookOrigin));
    assert.deepEqual(toHidook, [],
        'the exported ZIP, served from a completely different static host, made requests to ' +
        'the Hidook origin: ' + JSON.stringify(toHidook));
    assert.strictEqual(hits.length, 0,
        'the fake Hidook origin server received ' + hits.length + ' request(s): ' + JSON.stringify(hits));

    // Honest fallback: VISION §6's "self-hosted" promise is only real if the
    // visitor can still ask for an appointment some other way.
    const html = fs.readFileSync(path.join(unzippedDir, 'index.html'), 'utf8');
    assert.match(html, /id="pr-appt-form"/, 'no local appointment-request form rendered as the fallback');
    assert.match(html, /wa\.me/, 'no WhatsApp fallback link rendered alongside the local form');
    assert.doesNotMatch(html, new RegExp(hidookOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'the exported index.html still names the Hidook origin literally');
});

test('audit27-R-09: standalone HTML export with native booking on makes zero requests to the Hidook origin (file://)', async (t) => {
    const { chromium } = loadPlaywright();
    const { server: hidookServer, hits } = await startFakeHidookOrigin();
    t.after(() => hidookServer.close());
    const hidookOrigin = 'http://127.0.0.1:' + hidookServer.address().port;

    const config = loadProfessionalsConfigWithNativeBooking(hidookOrigin);
    const { html } = siteExport.exportSiteHtml({ templateId: 'professionals', config, images: [] });

    assert.doesNotMatch(html, new RegExp(hidookOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'the standalone HTML export still names the Hidook origin literally');

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r09-html-'));
    const htmlPath = path.join(workDir, 'export-standalone.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const requestedUrls = [];
    page.on('request', (r) => requestedUrls.push(r.url()));

    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.close();

    const toHidook = requestedUrls.filter((u) => u.startsWith(hidookOrigin));
    assert.deepEqual(toHidook, [],
        'the standalone HTML export, opened directly as a file, made requests to the Hidook ' +
        'origin: ' + JSON.stringify(toHidook));
    assert.strictEqual(hits.length, 0,
        'the fake Hidook origin server received ' + hits.length + ' request(s): ' + JSON.stringify(hits));
});
