'use strict';
/**
 * bot/test/audit27-v2-cookie-banner-parity.test.js — oracle for task V-2
 * (PLAN-UX-2026-09-27.md, "Unificarea celor 3 implementări ale bannerului de cookie").
 *
 * The builder (/app/), a published /live/<slug>/ page and an unzipped export
 * each carried their own cookie banner and had drifted apart (different
 * Romanian copy, role="dialog" on the published one, no Esc handling there).
 * The SAME assertions run against all three surfaces:
 *   - copy: one notice sentence + exactly "Acceptă" and "Află mai mult"
 *   - role="region" (non-modal), no aria-modal
 *   - Tab leaves the banner (never a trap)
 *   - Esc hides it, does NOT persist, focus is not stranded on the hidden node
 *   - Acceptă persists (localStorage + cookie) and the banner stays hidden after reload
 *   - at 390px, scrolled to the bottom, the footer legal links are clickable
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-v2-cookie-banner-parity.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-v2-'));
const COPY = 'Folosim stocare esențială în browser, fără urmărire sau reclame.';
const KEY = 'hb-cookie-consent';

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-v2-data-'));
process.env.SERVER_SECRET = 'audit27-v2-' + crypto.randomBytes(6).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'HIDOOK_FAKE_DEPLOY']) delete process.env[k];

const pricing = require(path.join(ROOT, 'bot/pricing.js'));
const registry = require(path.join(ROOT, 'bot/registry.js'));
const webpublish = require(path.join(ROOT, 'bot/webpublish.js'));
const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
const { startServer } = require(path.join(ROOT, 'bot/server.js'));
const { exportSiteZip } = require(path.join(ROOT, 'bot/site-export.js'));

async function publishLive(base) {
    const templateId = 'product-menu';
    const { presets } = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8'));
    const config = JSON.parse(JSON.stringify(presets[0].config));
    const user = registry.getOrCreateUserByEmail(`v2-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id, templateId, templateVersion: 1,
        slug: 'v2-' + crypto.randomUUID().slice(0, 8), platform: 'web',
    });
    const sessionId = 'cs_test_v2_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id, userId: user.id, amountCents: pricing.PRICE_CENTS,
        currency: 'eur', stripeSessionId: sessionId, kind: 'publish',
    });
    registry.saveVersion(site.id, config);
    webpublish.savePendingDraft(order.id, { config, images: [], siteId: site.id, savedAt: new Date().toISOString() });
    await onStripeEvent({
        id: 'evt_v2_paid_' + crypto.randomUUID().slice(0, 10),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId, payment_status: 'no_payment_required',
                customer: 'cus_test_v2_' + crypto.randomBytes(5).toString('hex'),
                subscription: 'sub_test_v2_' + crypto.randomBytes(5).toString('hex'),
                metadata: {
                    platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id,
                    billing_contract: 'first_then_renewal',
                    first_period_cents: String(pricing.PRICE_CENTS),
                    renewal_cents: String(pricing.RENEWAL_CENTS),
                },
            },
        },
    });
    const live = registry.getSite(site.id);
    assert.ok(live.status === 'live' || live.status === 'active', 'site must publish: ' + live.status);
    return { slug: live.slug, config, templateId };
}

function staticServer(dir) {
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript' };
    const srv = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p.endsWith('/')) p += 'index.html';
        const f = path.join(dir, path.normalize(p));
        if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
        res.end(fs.readFileSync(f));
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, name + '.png') }).catch(() => {});
const state = (page) => page.evaluate((K) => {
    const el = document.getElementById('hb-cookie-banner');
    const cs = el && getComputedStyle(el);
    const r = el && el.getBoundingClientRect();
    return {
        visible: !!(el && !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 4 && r.height > 4),
        inBanner: !!(el && el.contains(document.activeElement)),
        ls: (() => { try { return localStorage.getItem(K); } catch (e) { return 'ERR'; } })(),
        cookie: document.cookie.indexOf(K + '=accepted') !== -1,
    };
}, KEY);

async function checkSurface(browser, name, url, footerSel) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(500);
        assert.strictEqual((await state(page)).visible, true, `${name}: banner must show on first visit`);
        await shot(page, `${name}-01-first-visit-banner-visible`);

        // Copy and controls
        const dom = await page.evaluate(() => {
            const el = document.getElementById('hb-cookie-banner');
            return {
                role: el.getAttribute('role'),
                modal: el.getAttribute('aria-modal'),
                p: el.querySelector('p').textContent.trim(),
                ptext: el.innerText.replace(/\s+/g, ' ').trim(),
                controls: Array.from(el.querySelectorAll('a,button,input,select,textarea'))
                    .map((n) => n.tagName + ':' + n.textContent.trim() + ':' + (n.getAttribute('href') || '')),
            };
        });
        assert.strictEqual(dom.role, 'region', `${name}: banner must be role=region (non-modal)`);
        assert.ok(!dom.modal, `${name}: banner must not be aria-modal`);
        assert.strictEqual(dom.p, COPY, `${name}: identical Romanian notice copy`);
        assert.strictEqual(dom.controls.length, 2, `${name}: exactly Acceptă + Află mai mult, got ${dom.controls}`);
        assert.strictEqual(dom.controls[0], 'BUTTON:Acceptă:', `${name}: accept button`);
        assert.match(dom.controls[1], /^A:Află mai mult:.*cookies\.html$/, `${name}: learn-more link`);

        // Tab never traps: from the last control in the banner, Tab leaves it.
        await page.evaluate(() => document.getElementById('hb-cookie-accept').focus());
        await page.keyboard.press('Tab');
        assert.strictEqual((await state(page)).inBanner, true, `${name}: Tab from Acceptă reaches Află mai mult`);
        await page.keyboard.press('Tab');
        assert.strictEqual((await state(page)).inBanner, false, `${name}: Tab from the last banner control must leave the banner`);
        let outside = 0;
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            if (!(await state(page)).inBanner) outside++;
        }
        assert.ok(outside >= 10, `${name}: 12 more Tab presses must keep moving through the page, not the banner (${outside})`);

        // Esc: hides, never persists, focus not stranded; banner returns next load.
        await page.evaluate(() => document.getElementById('hb-cookie-accept').focus());
        await page.keyboard.press('Escape');
        const afterEsc = await state(page);
        await shot(page, `${name}-02-after-escape`);
        assert.strictEqual(afterEsc.visible, false, `${name}: Esc hides the banner`);
        assert.strictEqual(afterEsc.inBanner, false, `${name}: focus must not stay on the hidden banner after Esc`);
        assert.strictEqual(afterEsc.ls, null, `${name}: Esc must not persist consent (localStorage)`);
        assert.strictEqual(afterEsc.cookie, false, `${name}: Esc must not persist consent (cookie)`);
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(400);
        assert.strictEqual((await state(page)).visible, true, `${name}: after Esc-without-persist the banner is back on reload`);

        // Footer legal links stay clickable at 390px while the banner is up.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        await shot(page, `${name}-03-scrolled-to-bottom-banner-visible`);
        const links = page.locator(footerSel);
        const n = await links.count();
        assert.ok(n >= 3, `${name}: expected the 3 footer legal links, found ${n}`);
        for (let i = 0; i < n; i++) {
            const href = await links.nth(i).getAttribute('href');
            await links.nth(i).click({ trial: true, timeout: 2000 }).catch((e) => {
                assert.fail(`${name}: footer link ${href} is covered by the banner (${String(e.message).split('\n')[0]})`);
            });
        }

        // Accept persists (localStorage + cookie) and stays hidden after reload,
        // also when only the cookie survives.
        await page.locator('#hb-cookie-accept').click();
        const afterAccept = await state(page);
        await shot(page, `${name}-04-after-accept`);
        assert.strictEqual(afterAccept.visible, false, `${name}: Acceptă hides the banner`);
        assert.strictEqual(afterAccept.inBanner, false, `${name}: focus not stranded after Acceptă`);
        assert.strictEqual(afterAccept.ls, 'accepted', `${name}: Acceptă writes localStorage`);
        assert.strictEqual(afterAccept.cookie, true, `${name}: Acceptă writes the cookie`);
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(400);
        assert.strictEqual((await state(page)).visible, false, `${name}: stays hidden after reload`);
        await page.evaluate((K) => localStorage.removeItem(K), KEY);
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(400);
        const cookieOnly = await state(page);
        assert.strictEqual(cookieOnly.visible, false, `${name}: cookie alone keeps it hidden`);
        assert.strictEqual(cookieOnly.ls, 'accepted', `${name}: cookie rehydrates localStorage`);
    } finally {
        await ctx.close();
    }
}

test('every template ships the banner markup defined in bot/site-legal.js, and the root files are its output', () => {
    const legal = require(path.join(ROOT, 'bot/site-legal.js'));
    const block = (html) => {
        const m = /<div id="hb-cookie-banner"[\s\S]*?<\/div>\s*<\/div>/.exec(html);
        // Attribute order on the button differs by file; the inline onclick is the same everywhere.
        return m ? m[0].replace(/ onclick="[^"]*"/g, '').replace(/\s+/g, ' ').trim() : null;
    };
    const canon = block(legal.COOKIE_BANNER_HTML);
    assert.ok(canon, 'COOKIE_BANNER_HTML must contain the banner block');
    for (const t of fs.readdirSync(path.join(ROOT, 'templates'))) {
        const f = path.join(ROOT, 'templates', t, 'template.html');
        if (!fs.existsSync(f)) continue;
        assert.strictEqual(block(fs.readFileSync(f, 'utf8')), canon, `${t}/template.html banner markup drifted from site-legal.js`);
    }
    assert.strictEqual(fs.readFileSync(path.join(ROOT, 'cookie-banner.js'), 'utf8'), legal.COOKIE_BANNER_JS, 'root cookie-banner.js is stale');
    assert.strictEqual(fs.readFileSync(path.join(ROOT, 'cookie-banner.css'), 'utf8'), legal.COOKIE_BANNER_CSS, 'root cookie-banner.css is stale');
});

test('builder, published page and unzipped export share one cookie banner contract', async () => {
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;
    process.env.PUBLIC_URL = base;
    const browser = await chromium.launch({ headless: true });
    let exportSrv;
    try {
        const { slug, config, templateId } = await publishLive(base);

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-v2-export-'));
        const { zip } = exportSiteZip({ templateId, config, images: [], slug });
        fs.writeFileSync(path.join(tmp, 'site.zip'), zip);
        const out = path.join(tmp, 'unzipped');
        fs.mkdirSync(out);
        execFileSync('unzip', ['-q', path.join(tmp, 'site.zip'), '-d', out]);
        exportSrv = await staticServer(out);

        await checkSurface(browser, 'builder', base + '/app/', '.landing-footer-legal a');
        await checkSurface(browser, 'live', `${base}/live/${slug}/`, 'footer a[href$="privacy.html"], footer a[href$="terms.html"], footer a[href$="cookies.html"]');
        await checkSurface(browser, 'export', `http://127.0.0.1:${exportSrv.address().port}/`, 'footer a[href$="privacy.html"], footer a[href$="terms.html"], footer a[href$="cookies.html"]');
    } finally {
        await browser.close();
        if (exportSrv) exportSrv.close();
        await new Promise((r) => server.close(() => r()));
    }
});
