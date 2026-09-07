'use strict';
/**
 * bot/test/wave13-site-card-layout.test.js
 *
 * The dashboard site card must not starve its own text column.
 *
 * `.site-card` is a wrapping flex row: thumb | info | actions. `.site-card-info`
 * was `flex: 1` while `.site-card-actions` was `flex-shrink: 0`, so the buttons
 * always claimed their full max-content width and the name/URL column took
 * whatever was left. With the full action set on a paid, live site
 * (Editează · Anulează · Istoric · Domeniu · Facturi · Programări · Șterge)
 * that left was 101px at 1440 and 41px at 700. `.site-card-name` is deliberately
 * `overflow: visible` so a long project name is never clipped — which meant the
 * name painted straight across the button row, and the live URL wrapped into a
 * four-line ribbon. The owner's own screenshot showed "Editează" sitting on top
 * of the project name.
 *
 * This measures the rendered boxes in a real browser rather than asserting on
 * CSS declarations, because every declaration involved was already present and
 * doing exactly what it said.
 *
 * Run: node --experimental-sqlite --test bot/test/wave13-site-card-layout.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-card-layout-'));
process.env.SERVER_SECRET = 'card-layout-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const registry = require(path.join(ROOT, 'bot', 'registry.js'));
const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

// A name column narrower than this cannot show a slug plus a status badge, and
// is where the overflow starts painting over the buttons.
const MIN_INFO_WIDTH = 240;

let server;
let base;
let email;

test.before(async () => {
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;

    email = 'card-layout-' + Date.now().toString(36) + '@example.com';
    const user = registry.getOrCreateUserByEmail(email);
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
    ).presets[0].config;
    cfg.appointment = Object.assign({}, cfg.appointment, { nativeBooking: true });

    // professionals + paid + live is the card that carries the most buttons.
    const slug = 'card-layout-' + Date.now().toString(36);
    const site = registry.createSite({
        userId: user.id, templateId: 'professionals', templateVersion: 1, slug, platform: 'web',
    });
    registry.updateSite(site.id, { paid: true, status: 'live' });
    const siteDir = path.join(process.env.DATA_DIR, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>' + slug + '</h1>');
    await webpublish.publishSite({
        site: registry.getSite(site.id), config: cfg, images: [], siteDirAlreadyBuilt: true,
    });
    registry.updateSite(site.id, { paid: true, status: 'live' });
});

test.after(() => {
    if (server) server.close();
});

async function openDashboard(browser, width, height) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-banner').waitFor({ state: 'visible' });
    await page.locator('#hb-cookie-accept').click();
    await page.locator('#hb-cookie-banner').waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.waitForTimeout(400);
    const authBtn = page.locator('#btn-dashboard-auth');
    if (await authBtn.isVisible().catch(() => false)) await authBtn.click();
    const emailInput = page.locator('#input-email');
    if (await emailInput.isVisible().catch(() => false)) {
        await emailInput.fill(email);
        await page.locator('#btn-send-magic').click();
        await page.locator('#dev-link').waitFor({ state: 'visible' });
        await page.locator('#dev-link').click();
        await page.waitForTimeout(400);
    }
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.locator('.site-card').first().waitFor({ state: 'visible' });
    // The Programări / Configurează calendarul button lands after a fetch.
    await page.waitForTimeout(1200);
    return { context, page };
}

function measure(page) {
    return page.evaluate(() => {
        const card = document.querySelector('.site-card');
        const info = card.querySelector('.site-card-info');
        const name = card.querySelector('.site-card-name');
        const actions = card.querySelector('.site-card-actions');
        const box = (el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        };
        const nameBox = box(name);
        // The name is overflow:visible — measure the ink, not the box.
        const range = document.createRange();
        range.selectNodeContents(name);
        const ink = range.getBoundingClientRect();
        const overlaps = (a, b) =>
            a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const hits = [];
        for (const btn of actions.querySelectorAll('button, a')) {
            const b = box(btn);
            if (overlaps({ left: ink.left, right: ink.right, top: ink.top, bottom: ink.bottom }, b)) {
                hits.push(btn.textContent.trim());
            }
        }
        return {
            infoWidth: Math.round(box(info).width),
            nameWidth: Math.round(nameBox.width),
            inkWidth: Math.round(ink.width),
            buttons: [...actions.querySelectorAll('button, a')].map((b) => b.textContent.trim()),
            paintedOver: hits,
            cardOverflowsX: card.scrollWidth > card.clientWidth + 1,
        };
    });
}

test('the site card keeps a readable name column and never paints the name over its buttons', async () => {
    const browser = await chromium.launch({ headless: true });
    const problems = [];
    try {
        for (const vp of [{ w: 1440, h: 900 }, { w: 1100, h: 900 }, { w: 900, h: 900 }, { w: 700, h: 900 }, { w: 390, h: 844 }]) {
            const { context, page } = await openDashboard(browser, vp.w, vp.h);
            const m = await measure(page);
            await context.close();

            if (m.paintedOver.length) {
                problems.push(
                    `${vp.w}px: the project name paints over ${m.paintedOver.join(', ')} — ` +
                    `the info column is ${m.infoWidth}px while the name needs ${m.inkWidth}px`
                );
            }
            if (m.infoWidth < MIN_INFO_WIDTH) {
                problems.push(
                    `${vp.w}px: .site-card-info is ${m.infoWidth}px wide (floor ${MIN_INFO_WIDTH}px) ` +
                    `with ${m.buttons.length} buttons — the actions row is starving the name/URL column`
                );
            }
            if (m.cardOverflowsX) {
                problems.push(`${vp.w}px: .site-card overflows horizontally`);
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepEqual(problems, [], 'dashboard site-card layout:\n' + problems.join('\n'));
});
