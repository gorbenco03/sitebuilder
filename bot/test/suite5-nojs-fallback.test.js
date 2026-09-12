'use strict';
/**
 * bot/test/suite5-nojs-fallback.test.js
 *
 * PLAN-QA-2026-09-12 Suite 5, S5-4 — M16 (minor→major).
 *
 * `templates/professionals/template.html`'s `#hnb-root` (the native booking
 * widget mount point) used to render as a totally empty `<div>`. Two real
 * visitors hit that emptiness:
 *   1. JavaScript fully disabled (corporate lockdown, some accessibility
 *      tooling, a handful of real browsers) — the widget's script never runs,
 *      so the div stays empty forever. No phone, no WhatsApp, nothing — even
 *      though both already exist elsewhere on the same page.
 *   2. JavaScript enabled but the widget bundle is slow to arrive (weak
 *      connection, third-party script blocker throttling `defer` scripts) —
 *      same empty gap for however long the download takes.
 *
 * Fix: `#hnb-root` now ships an inline loading skeleton ("Se încarcă
 * programările…") that the widget's own `mount()` clears the instant it runs
 * (it already does `root.innerHTML = ''` first — see
 * bot/calendar-native/widget/public-booking-widget.js), plus a `<noscript>`
 * block (hidden from JS-enabled browsers entirely) with a real phone/WhatsApp
 * alternative for the no-JS case.
 *
 * This oracle drives a REAL published professionals site with native booking
 * on through actual Chromium, once with JavaScript disabled and once with the
 * widget script artificially delayed, and checks what a visitor actually sees.
 *
 * Run: node --experimental-sqlite --test bot/test/suite5-nojs-fallback.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite5-nojs-'));
process.env.SERVER_SECRET = 'suite5-nojs-' + crypto.randomBytes(8).toString('hex');
delete process.env.CALENDAR_PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

let server;
let base;
let liveUrl;

test.before(async () => {
    require(path.join(ROOT, 'scripts', 'build-builder.js'));
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
    process.env.PUBLIC_URL = base;

    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

    const user = registry.getOrCreateUserByEmail('suite5-nojs-' + Date.now().toString(36) + '@example.com');
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;
    cfg.appointment = Object.assign({}, cfg.appointment, { nativeBooking: 'da' });

    const slug = 'suite5-nojs-' + Date.now().toString(36);
    const site = registry.createSite({
        userId: user.id, templateId: 'professionals', templateVersion: 1, slug, platform: 'web',
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
    liveUrl = base + '/live/' + slug + '/';
});

test.after(() => {
    if (server) server.close();
});

test('JavaScript fully disabled: visitor gets a real phone/WhatsApp alternative, not an empty box', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        await page.goto(liveUrl, { waitUntil: 'load' });

        const root = page.locator('#hnb-root');
        await root.waitFor({ state: 'attached' });

        // The JS-boot loading skeleton lives inside #hnb-root and is only
        // meaningful for the brief window before the widget script runs.
        // With JS permanently off that script never runs, so the fix must
        // hide #hnb-root outright (via the <noscript> block's own <style>)
        // rather than leave a "loading…" message stuck on screen forever.
        // (Not testing this through .innerText() — headless Chromium with
        // javaScriptEnabled:false does not reliably exclude a display:none
        // element's own text from its own .innerText(), even though real
        // browsers do; computed style is the direct, reliable check.)
        const rootDisplay = await page.evaluate(
            () => getComputedStyle(document.getElementById('hnb-root')).display
        );
        assert.equal(rootDisplay, 'none',
            'DEFECT M16: with JavaScript disabled, #hnb-root (the "Se încarcă programările…" ' +
            'skeleton, meant only for the JS-boot gap) is still shown — computed display was "' +
            rootDisplay + '", expected "none" so the <noscript> alternative takes over instead');

        const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
        assert.ok(/JavaScript/i.test(bodyText),
            'no-JS visitor is never told WHY the booking area does not work');
        assert.ok(/\+40\s?721\s?555\s?014/.test(bodyText) || bodyText.includes('WhatsApp'),
            'DEFECT M16: no phone number or WhatsApp mention offered as an alternative when JS is off ' +
            '— body text was: ' + bodyText.slice(0, 500));

        await context.close();
    } finally {
        await browser.close();
    }
});

test('JavaScript enabled but the widget bundle is slow: visitor sees a loading skeleton, not a blank gap', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        // Delay only the widget's own script so the page finishes loading
        // (and any inline scripts run) well before the bundle arrives —
        // reproducing a slow connection / throttled `defer` script.
        await page.route('**/calendar-native/widget/public-booking-widget.js', async (route) => {
            await new Promise((r) => setTimeout(r, 4000));
            await route.continue();
        });

        // NOT 'domcontentloaded': a deferred script must finish running
        // before that event fires, so waiting for it would wait out our
        // artificial delay too. 'commit' returns as soon as the response for
        // the navigation itself starts, before the deferred script has even
        // been requested.
        await page.goto(liveUrl, { waitUntil: 'commit' });

        // Sampled shortly after load, well before the 4s-delayed script can
        // have run — this is the exact window M16 found completely empty.
        await page.waitForTimeout(800);
        const rootText = (await page.locator('#hnb-root').innerText()).trim();
        assert.notEqual(rootText, '',
            'DEFECT M16: #hnb-root is empty while the widget bundle is still loading — no skeleton, ' +
            'no "se încarcă" message, nothing to tell the visitor booking is on its way');
        assert.match(rootText, /încarc/i,
            'expected a loading message (e.g. "Se încarcă programările…") while the bundle is in flight, ' +
            'got: "' + rootText + '"');

        // Once the (delayed) bundle actually runs, it must replace the
        // skeleton with the real widget — the skeleton is not a dead end.
        await page.waitForFunction(() => {
            const el = document.querySelector('[data-hnb-ready]');
            return !!el && el.children.length > 0 && !el.textContent.includes('Se încarcă');
        }, { timeout: 15000 });

        await context.close();
    } finally {
        await browser.close();
    }
});
