'use strict';
/**
 * bot/test/suite5-portfolio-native-booking.test.js
 *
 * PLAN-QA-2026-09-12, Suite 5, S5-6 (X1) — online booking on the "portfolio"
 * (salon) template, the single most-requested feature from the external QA
 * feedback: "a dropdown: pick service -> stylist -> time/date -> email
 * confirmation."
 *
 * The exploration report (04-QA-Evidence/QA-Explorare-2026-09-12/reports/
 * 07-calendar-native.md, verification V2) found that flow already exists,
 * complete, in the native calendar engine — and that it is NOT tied to the
 * "professionals" templateId anywhere in bot/webpublish.js,
 * bot/calendar-native/cutover.js, engine.js, owner-api.js or public-api.js.
 * The only thing missing was presentation wiring: the mount markup
 * (`data-hidook-cal-native` + `#hnb-root` + the widget's `<link>`/`<script>`)
 * existed only in templates/professionals/template.html, and portfolio's
 * schema.json had no `appointment.*` fields at all to switch it on.
 *
 * This is the cross-origin oracle from wave13-native-calendar-cross-origin-
 * e2e.test.js (professionals), parametrized onto portfolio: publish a real
 * portfolio site with native booking on, serve the static export from a
 * SECOND http server on a second port (a genuinely different origin, like
 * Cloudflare Pages), and drive Chromium against it. Also covers the
 * resource-picker chips (S5-6 point 6): hidden with one resource, shown with
 * two.
 *
 * RED before the fix (no mount markup on portfolio): "the calendar was
 * switched on but no widget was mounted" — see the implementation report for
 * the verbatim failure.
 *
 * Run: node --experimental-sqlite --test bot/test/suite5-portfolio-native-booking.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-pf-native-'));
process.env.SERVER_SECRET = 'pf-native-' + crypto.randomBytes(8).toString('hex');
delete process.env.CALENDAR_PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

let botServer;
let staticServer;
let staticBase;
let publishedDir;
let calDb;
let tenant;

/** Stand-in for Cloudflare Pages, same as the professionals oracle. */
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
    process.env.PUBLIC_URL = 'http://127.0.0.1:' + botServer.address().port;

    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

    const user = registry.getOrCreateUserByEmail('pf-native-' + Date.now().toString(36) + '@example.com');
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'portfolio', 'presets.json'), 'utf8')
    ).presets[0].config;
    cfg.appointment = Object.assign({}, cfg.appointment, { nativeBooking: 'da' });

    const slug = 'pf-native-' + Date.now().toString(36);
    const site = registry.createSite({
        userId: user.id, templateId: 'portfolio', templateVersion: 1, slug, platform: 'web',
    });
    registry.updateSite(site.id, { paid: true, status: 'live' });

    const siteDir = path.join(process.env.DATA_DIR, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
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

    // Tenant keys the cutover injected — needed below to add a second staff
    // resource directly through owner-api.js (same pattern as
    // wave7-calendar-resources-owner-api.test.js), the same layer the owner
    // dashboard's "Personal" tab calls.
    tenant = { customerId: user.id, siteId: site.id };
    const { openCalendarDb } = require(path.join(ROOT, 'bot', 'calendar-native', 'db.js'));
    calDb = openCalendarDb({});
});

test.after(() => {
    if (botServer) botServer.close();
    if (staticServer) staticServer.close();
});

test('the exported HTML addresses the bot host, not the static host', () => {
    const html = fs.readFileSync(path.join(publishedDir, 'index.html'), 'utf8');
    assert.match(html, /data-hidook-cal-native/, 'the calendar was switched on but no widget was mounted on portfolio');
    const bad = [...html.matchAll(/(?:src|href|data-api-base)="([^"]*)"/g)]
        .map((m) => ({ attr: m[0], url: m[1] }))
        .filter(({ attr, url }) =>
            (/calendar-native/.test(url) || attr.startsWith('data-api-base')) && !/^https?:\/\//i.test(url));
    assert.deepEqual(bad.map((b) => b.attr), [],
        'these resolve against the static host, which answers with its own index.html');
});

test('the widget boots cross-origin on portfolio and paints the 3 configured salon services', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        const failures = [];
        page.on('requestfailed', (r) => failures.push(r.url() + ' — ' + (r.failure() || {}).errorText));
        page.on('console', (m) => { if (m.type() === 'error') failures.push('console: ' + m.text()); });

        await page.goto(staticBase + '/', { waitUntil: 'networkidle' });

        const state = await page.evaluate(async () => {
            const root = document.querySelector('[data-hidook-cal-native]');
            if (!root) return { mounted: false };
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline && root.children.length === 0) {
                await new Promise((r) => setTimeout(r, 200));
            }
            const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
            return {
                mounted: true,
                childCount: root.children.length,
                apiBase: root.getAttribute('data-api-base'),
                text: text.slice(0, 400),
                stepsDisplay: (() => {
                    const el = root.querySelector('.hnb__steps') || root.querySelector('.hnb__layout');
                    return el ? getComputedStyle(el).display : null;
                })(),
                hasResourceRow: !!root.querySelector('.hnb__resources'),
            };
        });

        assert.ok(state.mounted, 'no widget mount point in the published portfolio page');
        assert.match(state.apiBase || '', /^https?:\/\//,
            'data-api-base is "' + state.apiBase + '" — the widget will ask the static host');
        assert.ok(state.childCount > 0,
            'the widget mount is still empty after 15s — its bundle never ran.\n' +
            'failed requests / console errors:\n' + failures.join('\n'));
        assert.ok(state.stepsDisplay && ['flex', 'grid'].includes(state.stepsDisplay),
            'the widget stylesheet never applied on portfolio — its layout element computes to "' +
            state.stepsDisplay + '", the browser default, so the cross-origin <link> resolved to ' +
            'the static host instead of the bot host');

        for (const name of ['Tuns și styling', 'Manichiură cu ojă gel', 'Machiaj de zi']) {
            assert.ok(state.text.includes(name),
                'service "' + name + '" is configured on the salon preset but the visitor is not offered it.\n' +
                'widget text was: ' + state.text);
        }

        assert.equal(state.hasResourceRow, false,
            'with a single (or no) staff resource the "who with" picker must stay hidden, not show a ' +
            'meaningless single-option chip row');

        await page.close();
    } finally {
        await browser.close();
    }
});

test('resource picker chips appear once a second stylist is added, and stay hidden with only one', async () => {
    const ownerApi = require(path.join(ROOT, 'bot', 'calendar-native', 'owner-api.js'));

    // The earlier test already loaded the widget's availability once, which
    // lazily materializes the tenant's implicit "Personal implicit" resource
    // (engine.js's getOrCreateDefaultResourceId — any availability/slot call
    // without an explicit resourceId creates it on first use). Deactivate
    // whatever exists so this test starts from a known, controlled count
    // instead of an incidental one left by a previous test.
    const before = ownerApi.listOwnerResources(calDb, tenant.customerId, tenant.siteId);
    assert.ok(before.ok, 'listing existing resources must succeed: ' + JSON.stringify(before));
    for (const r of before.resources) {
        if (r.active) {
            const off = ownerApi.putOwnerResource(calDb, tenant.customerId, tenant.siteId, r.id, { active: false });
            assert.ok(off.ok, 'deactivating pre-existing resource "' + r.name + '" must succeed: ' + JSON.stringify(off));
        }
    }

    // Exactly one active resource: still "solo", chips must stay hidden —
    // this is the common case for a portfolio site that never touched the
    // dashboard's "Personal" tab.
    const ana = ownerApi.putOwnerResource(calDb, tenant.customerId, tenant.siteId, null, { name: 'Ana' });
    assert.ok(ana.ok, 'creating the first staff resource must succeed: ' + JSON.stringify(ana));

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        await page.goto(staticBase + '/', { waitUntil: 'networkidle' });
        const oneResource = await page.evaluate(async () => {
            const root = document.querySelector('[data-hidook-cal-native]');
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline && root.children.length === 0) {
                await new Promise((r) => setTimeout(r, 200));
            }
            return !!root.querySelector('.hnb__resources');
        });
        assert.equal(oneResource, false, 'a single named resource ("Ana") must not surface a "who with" picker');
        await page.close();

        // A second resource makes the picker meaningful.
        const bianca = ownerApi.putOwnerResource(calDb, tenant.customerId, tenant.siteId, null, { name: 'Bianca' });
        assert.ok(bianca.ok, 'creating the second staff resource must succeed: ' + JSON.stringify(bianca));

        const page2 = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        await page2.goto(staticBase + '/', { waitUntil: 'networkidle' });
        const twoResources = await page2.evaluate(async () => {
            const root = document.querySelector('[data-hidook-cal-native]');
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline && root.children.length === 0) {
                await new Promise((r) => setTimeout(r, 200));
            }
            const row = root.querySelector('.hnb__resources');
            if (!row) return { hasRow: false };
            return { hasRow: true, text: (row.textContent || '').replace(/\s+/g, ' ').trim() };
        });
        assert.ok(twoResources.hasRow, 'with two staff resources the "who with" picker must appear');
        assert.match(twoResources.text, /Oricine disponibil/, 'the "anyone available" option must be offered');
        assert.match(twoResources.text, /Ana/, 'the first stylist must be offered as a chip');
        assert.match(twoResources.text, /Bianca/, 'the second stylist must be offered as a chip');
        await page2.close();
    } finally {
        await browser.close();
    }
});
