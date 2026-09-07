'use strict';
/**
 * bot/test/wave13-native-calendar-cross-origin-e2e.test.js
 *
 * End-to-end proof that a statically-exported site on a DIFFERENT origin can
 * actually book — the situation the owner is in with
 * https://profesionals.pages.dev while the API lives on lp.hidook.agency.
 *
 * The unit test beside this one (wave13-native-calendar-static-export) pins the
 * URLs in the exported HTML. This one refuses to trust that: it publishes a
 * real professionals site with the calendar switched on, serves the exported
 * directory from a SECOND http server on a second port — a genuinely different
 * origin, exactly like Cloudflare Pages — and drives Chromium against it. The
 * widget has to fetch its own bundle cross-origin, get CORS right, and paint
 * the services the owner configured.
 *
 * Before the fix this page rendered the booking heading and the privacy notice
 * and nothing else, because every widget URL resolved against the static host,
 * which answers with its own index.html.
 *
 * Run: node --experimental-sqlite --test bot/test/wave13-native-calendar-cross-origin-e2e.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-xorigin-'));
process.env.SERVER_SECRET = 'xorigin-' + crypto.randomBytes(8).toString('hex');
delete process.env.CALENDAR_PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

let botServer;
let staticServer;
let staticBase;
let publishedDir;

/**
 * Stand-in for Cloudflare Pages: serves the exported files and, like Pages,
 * answers anything it does not have with index.html at 200 text/html. That
 * fallback is the whole reason the original failure was silent.
 */
function startStaticHost(dir) {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let file = path.join(dir, urlPath);
        if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
        let body;
        let ext = path.extname(file).toLowerCase();
        try {
            const st = fs.statSync(file);
            body = st.isDirectory() ? null : fs.readFileSync(file);
        } catch { body = null; }
        if (body == null) {
            body = fs.readFileSync(path.join(dir, 'index.html'));
            ext = '.html';
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length });
        res.end(body);
    });
    return server;
}

test.before(async () => {
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    botServer = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        botServer.once('listening', resolve);
        botServer.once('error', reject);
    });
    // Production sets PUBLIC_URL and nothing else — that is the point of the test.
    process.env.PUBLIC_URL = 'http://127.0.0.1:' + botServer.address().port;

    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

    const user = registry.getOrCreateUserByEmail('xorigin-' + Date.now().toString(36) + '@example.com');
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;
    cfg.appointment = Object.assign({}, cfg.appointment, { nativeBooking: 'da' });

    const slug = 'xorigin-' + Date.now().toString(36);
    const site = registry.createSite({
        userId: user.id, templateId: 'professionals', templateVersion: 1, slug, platform: 'web',
    });
    registry.updateSite(site.id, { paid: true, status: 'live' });

    const siteDir = path.join(process.env.DATA_DIR, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    // publishSite runs the cutover and rewrites the config it renders from.
    await webpublish.publishSite({
        site: registry.getSite(site.id),
        config: cfg,
        images: [],
        buildStaticSiteTree: siteExport.buildStaticSiteTree,
    });
    publishedDir = path.join(process.env.DATA_DIR, 'published', slug);
    assert.ok(fs.existsSync(path.join(publishedDir, 'index.html')),
        'publish did not produce an index.html at ' + publishedDir);

    staticServer = startStaticHost(publishedDir);
    await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
    staticBase = 'http://127.0.0.1:' + staticServer.address().port;
});

test.after(() => {
    if (botServer) botServer.close();
    if (staticServer) staticServer.close();
});

test('the exported HTML addresses the bot host, not the static host', () => {
    const html = fs.readFileSync(path.join(publishedDir, 'index.html'), 'utf8');
    assert.match(html, /data-hidook-cal-native/, 'the calendar was switched on but no widget was mounted');
    const bad = [...html.matchAll(/(?:src|href|data-api-base)="([^"]*)"/g)]
        .map((m) => ({ attr: m[0], url: m[1] }))
        .filter(({ attr, url }) =>
            (/calendar-native/.test(url) || attr.startsWith('data-api-base')) && !/^https?:\/\//i.test(url));
    assert.deepEqual(bad.map((b) => b.attr), [],
        'these resolve against the static host, which answers with its own index.html');
});

test('the widget boots cross-origin and paints the services the owner configured', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        const failures = [];
        page.on('requestfailed', (r) => failures.push(r.url() + ' — ' + (r.failure() || {}).errorText));
        page.on('console', (m) => { if (m.type() === 'error') failures.push('console: ' + m.text()); });

        await page.goto(staticBase + '/', { waitUntil: 'networkidle' });

        // The widget must have replaced its own mount point with real content.
        const state = await page.evaluate(async () => {
            const root = document.querySelector('[data-hidook-cal-native]');
            if (!root) return { mounted: false };
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline && root.children.length === 0) {
                await new Promise((r) => setTimeout(r, 200));
            }
            const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
            const styled = getComputedStyle(root).getPropertyValue('display');
            return {
                mounted: true,
                childCount: root.children.length,
                apiBase: root.getAttribute('data-api-base'),
                text: text.slice(0, 400),
                display: styled,
                // Proof the cross-origin stylesheet actually applied. Reading
                // .cssRules on it throws (it is cross-origin, by design), so
                // measure the effect instead: .hnb__steps is a <ul>, which the
                // UA renders `display: block`. Only the widget's own stylesheet
                // makes it a flex row.
                stepsDisplay: (() => {
                    const el = root.querySelector('.hnb__steps') || root.querySelector('.hnb__layout');
                    return el ? getComputedStyle(el).display : null;
                })(),
            };
        });

        assert.ok(state.mounted, 'no widget mount point in the published page');
        assert.match(state.apiBase || '', /^https?:\/\//,
            'data-api-base is "' + state.apiBase + '" — the widget will ask the static host');
        assert.ok(state.childCount > 0,
            'the widget mount is still empty after 15s — its bundle never ran.\n' +
            'failed requests / console errors:\n' + failures.join('\n'));
        assert.ok(state.stepsDisplay && ['flex', 'grid'].includes(state.stepsDisplay),
            'the widget stylesheet never applied — its layout element computes to "' +
            state.stepsDisplay + '", the browser default, so the cross-origin <link> ' +
            'resolved to the static host instead of the bot host');

        // The three seeded services must actually be offered.
        for (const name of ['Consultație inițială', 'Revizuire contract', 'Discuție de urmărire']) {
            assert.ok(state.text.includes(name),
                'service "' + name + '" is configured and seeded but the visitor is not offered it.\n' +
                'widget text was: ' + state.text);
        }
        await page.close();
    } finally {
        await browser.close();
    }
});
