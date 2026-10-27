'use strict';
/**
 * bot/test/blocks-site.test.js — block-editor sites (templateId 'blocks')
 * through draft save, publish, test-pay, isolated deploy and export.
 *
 * Run: node --experimental-sqlite --test bot/test/blocks-site.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocks-site-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-blocks-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.BRAND_DOMAIN;
delete process.env.RESEND_API_KEY;
delete process.env.NODE_ENV;

const SB         = require('../../builder/blocks/blocks.js');
const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');
const { startServer } = require('../server.js');

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_URL = 'data:image/png;base64,' + PNG_B64;

let srv;
let base;

before(async () => {
    srv = startServer({
        port: 0,
        onStripeEvent: async (event) => {
            await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });
        },
    });
    await new Promise((r) => srv.once('listening', r));
    base = `http://127.0.0.1:${srv.address().port}`;
    process.env.PUBLIC_URL = base;
});

after(() => {
    try { srv.close(); } catch (_) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

async function login(label) {
    const jar = {};
    const email = `blocks-${label}-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const res = await fetch(`${base}/api/auth/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
    assert.strictEqual(res.status, 200);
    const { devLink } = await res.json();
    const token = new URL(devLink, base).searchParams.get('token');
    const v = await fetch(`${base}/auth/verify?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
    assert.strictEqual(v.status, 302);
    for (const sc of v.headers.getSetCookie()) {
        const first = sc.split(';')[0];
        const eq = first.indexOf('=');
        if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
    }
    return (urlPath, opts = {}) => fetch(base + urlPath, {
        redirect: 'manual',
        ...opts,
        headers: {
            ...(opts.headers || {}),
            Cookie: Object.entries(jar).map(([k, val]) => `${k}=${val}`).join('; '),
        },
    });
}

const post = (c, urlPath, body) => c(urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-IPCountry': 'DE' },
    body: JSON.stringify(body),
});

function dirty(config) {
    const c = JSON.parse(JSON.stringify(config));
    c.pages[0].blocks[0].data.text =
        'Salut <b>tare</b> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">click</a>';
    c.pages[0].blocks[0].data.image = PNG_URL;
    return c;
}

async function payAndWait(c, publishBody, slug) {
    const orders = registry.listOrdersBySite(publishBody.site.id);
    const pending = orders.find((o) => o.status === 'pending') || orders[0];
    assert.ok(pending && pending.stripeSessionId && pending.stripeSessionId !== 'pending');
    const done = await post(c, '/api/test-pay/complete', { sessionId: pending.stripeSessionId });
    assert.strictEqual(done.status, 200, await done.clone().text());
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const r = await fetch(`${base}/live/${slug}/`, { redirect: 'manual' });
        if (r.status === 200) return;
        await new Promise((r2) => setTimeout(r2, 50));
    }
    throw new Error('site never went live');
}

test('draft save with a blocks config returns a site; GET /api/sites/:id returns the config', async () => {
    const c = await login('draft');
    const cfg = SB.defaultSite('salon');
    const res = await post(c, '/api/draft', { templateId: 'blocks', config: cfg });
    assert.strictEqual(res.status, 200, await res.clone().text());
    const { site } = await res.json();
    assert.strictEqual(site.templateId, 'blocks');
    assert.ok(/^atelier-ivoire/.test(site.slug), 'slug from brand, got ' + site.slug);
    const got = await c(`/api/sites/${site.id}`);
    assert.strictEqual(got.status, 200);
    const body = await got.json();
    assert.strictEqual(body.config.v, 2);
    assert.strictEqual(body.config.pages.length, cfg.pages.length);
});

test('invalid blocks config is rejected with 422 and a Romanian message', async () => {
    const c = await login('invalid');
    for (const bad of [{ v: 2, pages: [] }, { v: 1, pages: [{ name: 'x', blocks: [] }] }]) {
        const d = await post(c, '/api/draft', { templateId: 'blocks', config: bad });
        assert.strictEqual(d.status, 422);
        assert.ok((await d.json()).error.length > 10);
        const p = await post(c, '/api/publish', { templateId: 'blocks', config: bad, images: [] });
        assert.strictEqual(p.status, 422);
    }
    const unknown = await post(c, '/api/draft', { templateId: 'nope', config: { a: 1 } });
    assert.strictEqual(unknown.status, 422);
});

test('publish + test-pay + isolated deploy: all pages, legal pages, attribution, assets, sanitized rich text', async () => {
    const c = await login('publish');
    const slug = 'blocks-' + crypto.randomUUID().slice(0, 8);
    const cfg = dirty(SB.defaultSite('salon'));
    const pub = await post(c, '/api/publish', { templateId: 'blocks', slug, config: cfg, images: [] });
    assert.strictEqual(pub.status, 200, await pub.clone().text());
    const pubBody = await pub.json();
    assert.strictEqual(pubBody.site.paid, false);
    assert.ok(pubBody.paymentUrl, 'checkout url');
    assert.strictEqual((await fetch(`${base}/live/${slug}/`)).status, 404, 'unpaid must not be live');

    await payAndWait(c, pubBody, slug);

    const home = await fetch(`${base}/live/${slug}/index.html`);
    assert.strictEqual(home.status, 200);
    const html = await home.text();
    assert.ok(html.includes('Build by hidook.tech powered by hidook.agency') ||
        /Build by\s*<a[^>]*>hidook\.tech<\/a>\s*powered by\s*<a[^>]*>hidook\.agency/.test(html), 'attribution');
    assert.ok(html.includes('privacy.html'), 'links privacy');
    assert.ok(html.includes('cookie-banner.js'), 'cookie banner');
    assert.ok(html.includes('<strong>tare</strong>'), 'allowed formatting kept');
    assert.ok(!/onerror/i.test(html), 'onerror must not survive');
    assert.ok(!/javascript:/i.test(html), 'javascript: must not survive');
    assert.ok(!/<img[^>]*src=x/i.test(html), 'injected <img> must not survive');

    for (const page of cfg.pages.slice(1)) {
        const file = SB.pageFile(cfg, page);
        assert.strictEqual((await fetch(`${base}/live/${slug}/${file}`)).status, 200, file);
    }
    for (const legal of ['privacy.html', 'terms.html', 'cookies.html', 'cookie-banner.css']) {
        assert.strictEqual((await fetch(`${base}/live/${slug}/${legal}`)).status, 200, legal);
    }
    const privacy = await (await fetch(`${base}/live/${slug}/privacy.html`)).text();
    assert.ok(privacy.includes('Atelier Ivoire'), 'legal page names the business');

    const asset = 'assets/portfolio/images/iv-par1.jpg';
    const allHtml = await Promise.all(cfg.pages.map(async (p) =>
        (await fetch(`${base}/live/${slug}/${SB.pageFile(cfg, p)}`)).text()));
    assert.ok(allHtml.some((h) => h.includes(asset)), 'a page references ' + asset);
    assert.strictEqual((await fetch(`${base}/live/${slug}/${asset}`)).status, 200, 'copied template photo');

    const uploaded = /src="(images\/[^"]+\.png)"|url\(['"]?(images\/[^'")]+\.png)/.exec(html);
    assert.ok(uploaded, 'uploaded photo rewritten to images/…');
    const rel = uploaded[1] || uploaded[2];
    assert.ok(!html.includes('data:image/png'), 'no data: URL left in the page');
    assert.strictEqual((await fetch(`${base}/live/${slug}/${rel}`)).status, 200);
    const onDisk = path.join(tmpDir, 'published', slug, rel);
    assert.ok(fs.existsSync(onDisk), 'uploaded photo on disk');
    assert.deepStrictEqual(fs.readFileSync(onDisk), Buffer.from(PNG_B64, 'base64'));

    const sitemap = await (await fetch(`${base}/live/${slug}/sitemap.xml`)).text();
    for (const page of cfg.pages) {
        const file = SB.pageFile(cfg, page);
        assert.ok(sitemap.includes(file === 'index.html' ? `/live/${slug}/</loc>` : `/live/${slug}/${file}</loc>`), 'sitemap lists ' + file);
    }
    assert.ok(sitemap.includes('privacy.html'), 'sitemap lists legal pages');
    assert.ok(html.includes(`rel="canonical" href="${base}/live/${slug}/"`), 'canonical on home');

    // Export: ZIP works, multi-page HTML is refused.
    const siteId = pubBody.site.id;
    const zip = await c(`/api/export-zip?siteId=${siteId}`);
    assert.strictEqual(zip.status, 200);
    const zipBuf = Buffer.from(await zip.arrayBuffer());
    assert.ok(zipBuf.length > 1000 && zipBuf.toString('latin1').includes('preturi.html'));
    const exportHtml = await c(`/api/export-html?siteId=${siteId}`);
    assert.strictEqual(exportHtml.status, 409);
    assert.ok((await exportHtml.json()).error.includes('ZIP'));

    // Republish with one page: removed page files disappear, single-page HTML export works.
    const one = JSON.parse(JSON.stringify(cfg));
    one.pages = [one.pages[0]];
    const rep = await post(c, '/api/publish', { siteId, templateId: 'blocks', config: one, images: [] });
    assert.strictEqual(rep.status, 200, await rep.clone().text());
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && (await fetch(`${base}/live/${slug}/preturi.html`)).status === 200) {
        await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual((await fetch(`${base}/live/${slug}/preturi.html`)).status, 404, 'deleted page is gone');
    assert.strictEqual((await fetch(`${base}/live/${slug}/index.html`)).status, 200);
    const exp1 = await c(`/api/export-html?siteId=${siteId}`);
    assert.strictEqual(exp1.status, 200);
    const exp1Html = await exp1.text();
    assert.ok(exp1Html.includes('Build by'));
    assert.ok(!/onerror/i.test(exp1Html));
});

test('one unpaid site per user still applies to blocks', async () => {
    const c = await login('unpaid');
    const slugA = 'blocks-' + crypto.randomUUID().slice(0, 8);
    const slugB = 'blocks-' + crypto.randomUUID().slice(0, 8);
    const first = await post(c, '/api/publish', { templateId: 'blocks', slug: slugA, config: SB.defaultSite('salon'), images: [] });
    assert.strictEqual(first.status, 200, await first.clone().text());
    const second = await post(c, '/api/publish', { templateId: 'blocks', slug: slugB, config: SB.defaultSite('salon'), images: [] });
    assert.strictEqual(second.status, 409);
});
