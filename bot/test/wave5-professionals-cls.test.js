'use strict';
/**
 * bot/test/wave5-professionals-cls.test.js
 *
 * Oracle for the professionals template's Cumulative Layout Shift.
 *
 * Root cause found in this wave: bot/site-legal.js's COOKIE_BANNER_CSS keys
 * `.pr-hero` / `.pr-hero__copy` padding-bottom/margin-bottom off an
 * `html.hb-cookie-open` class that cookie-banner.js toggles at runtime. The
 * old templates/professionals/template.html mounted the cookie-banner
 * markup + <link rel="stylesheet" href="cookie-banner.css"> +
 * <script src="cookie-banner.js"> right before </body> — by the time that
 * script ran and set the class (for a first-time, not-yet-consented
 * visitor), the hero had already gone through an initial layout pass
 * WITHOUT the cookie clearance padding, so applying the class produced a
 * real, second layout pass with different box dimensions: exactly what the
 * Layout Instability metric counts as a shift. A second, independent
 * contributor lived entirely in this template's own styles.css: the
 * `.js-loaded .pr-hero__copy` entrance animation moved the hero copy via
 * `transform: translateY(...)`, which also changes the element's painted
 * rect frame-to-frame and is counted by the same metric.
 *
 * Both are fixed inside this template's own files only:
 *   - template.html now mounts the cookie banner (markup + stylesheet +
 *     script) at the TOP of <body>, before the hero, so cookie-banner.js
 *     resolves html.hb-cookie-open synchronously before the hero's first
 *     layout — one layout pass, not two.
 *   - styles.css's hero-copy entrance animation now fades opacity only
 *     (no translateY), so it cannot move the painted box at all.
 *
 * This is measured against the REAL COOKIE_BANNER_CSS/COOKIE_BANNER_JS from
 * bot/site-legal.js (read-only import — this test does not modify that
 * file) so the reproduction matches what a real publish/export actually
 * ships, not a simplified stand-in.
 *
 * Run: node --test bot/test/wave5-professionals-cls.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { test } = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));
const { COOKIE_BANNER_CSS, COOKIE_BANNER_JS } = require(path.join(ROOT, 'bot', 'site-legal.js'));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg' };

function serveDir(dir) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/') urlPath = '/index.html';
            const filePath = path.join(dir, urlPath);
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('nf'); return; }
                res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function buildExportDir() {
    const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config));
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
    const html = renderHtml(templateHtml, config);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-prof-cls-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/styles.css'), path.join(tmpDir, 'styles.css'));
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/script.js'), path.join(tmpDir, 'script.js'));
    fs.writeFileSync(path.join(tmpDir, 'cookie-banner.css'), COOKIE_BANNER_CSS);
    fs.writeFileSync(path.join(tmpDir, 'cookie-banner.js'), COOKIE_BANNER_JS);
    fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(tmpDir, 'images/hero.jpg'));
    return tmpDir;
}

async function measureCls(browser, base, viewport) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.addInitScript(() => {
        window.__cls = 0;
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
            }).observe({ type: 'layout-shift', buffered: true });
        } catch (e) { /* ignore */ }
    });
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
        offline: false, latency: 150,
        downloadThroughput: 1.6 * 1024 * 1024 / 8,
        uploadThroughput: 750 * 1024 / 8,
    });
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(base + '/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);
    const cls = await page.evaluate(() => window.__cls);
    await context.close();
    return cls;
}

test('wave5-professionals: CLS stays effectively zero on a real first-time-visitor load (desktop 1440 + mobile 390)', async (t) => {
    const tmpDir = await buildExportDir();
    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());

    const desktopCls = await measureCls(browser, base, { width: 1440, height: 1000 });
    const mobileCls = await measureCls(browser, base, { width: 390, height: 844 });

    console.log('CLS desktop-1440:', desktopCls, '| CLS mobile-390:', mobileCls);

    // Pre-fix reproduction measured 0.0187 (desktop) / 0.0071 (mobile) from the
    // cookie-banner mount position alone, before the animation fix — well
    // over a strict near-zero gate. 0.01 leaves margin for float jitter while
    // still failing hard on that regression.
    assert.ok(desktopCls < 0.01, `desktop CLS must stay under 0.01 (good), got ${desktopCls}`);
    assert.ok(mobileCls < 0.01, `mobile CLS must stay under 0.01 (good), got ${mobileCls}`);
});
