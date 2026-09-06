'use strict';
/**
 * bot/test/audit-professionals-fixes.test.js
 *
 * Oracle for two audit findings on templates/professionals (Audit 2026-09-06,
 * 04-QA-Evidence/Audit-2026-09-06-2225ca7/):
 *
 *   prof-03 [high]     — .pr-nav__links is display:none below 820px with no
 *                        hamburger fallback, so Servicii/Despre/Întrebări/
 *                        Contact are unreachable on any phone.
 *   F2      [critical] — script.js only attempted POST /api/appointments when
 *                        payload.slug matched /live/<slug>/, so a self-hosted
 *                        export (real http(s) origin, no such path, no Hidook
 *                        backend) fell into the "localOnly" branch and showed
 *                        the exact same success chrome as a real submission,
 *                        with zero network requests ever leaving the browser.
 *
 * This renders templates/professionals via the real renderHtml() pipeline
 * (same one used for live publish/export), serves the rendered page + the
 * template's own styles.css/script.js from a bare static HTTP server that has
 * no /api/appointments route at all — i.e. exactly what a self-hosted ZIP/
 * HTML export looks like once deployed to any plain static host — then drives
 * it with a real Chromium page (Playwright) to assert on real DOM/network
 * behavior, not just source text.
 *
 * RED on the pre-fix template.html/styles.css/script.js (verify with
 * `git stash` — checked out during the fix itself): no hamburger exists, and
 * the appointment form shows fake success with 0 requests.
 * GREEN after the fix: hamburger opens/closes/traps Escape correctly, and the
 * static export shows an honest failure panel (with real tel:/wa.me contact
 * links) after really attempting and really failing the POST — the form is
 * never hidden.
 *
 * Run: node bot/test/audit-professionals-fixes.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createRequire } = require('module');
const require2 = createRequire(__filename);
const { chromium } = require2('playwright');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

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

function loadPreset(tid, idx = 0) {
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tid, 'presets.json'), 'utf8')).presets;
    return JSON.parse(JSON.stringify(presets[idx].config));
}

const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function serveDir(dir) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/') urlPath = '/index.html';
            const filePath = path.join(dir, urlPath);
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    // No /api/appointments route, no SPA fallback — this is the
                    // exact shape of a self-hosted static export with no Hidook
                    // backend behind it.
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found: ' + urlPath);
                    return;
                }
                res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function main() {
    // ---- Render the professionals template exactly like a real export would ----
    const config = loadPreset('professionals', 0);
    assert.ok(config.contact && config.contact.phone, 'preset 0 must carry a phone for the honest-failure CTA');
    assert.ok(config.contact.waHref, 'preset 0 must carry a WhatsApp link for the honest-failure CTA');

    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
    const html = renderHtml(templateHtml, config);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-prof-fixes-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html, 'utf8');
    fs.copyFileSync(path.join(ROOT, 'templates', 'professionals', 'styles.css'), path.join(tmpDir, 'styles.css'));
    fs.copyFileSync(path.join(ROOT, 'templates', 'professionals', 'script.js'), path.join(tmpDir, 'script.js'));

    const server = await serveDir(tmpDir);
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const requests = [];
    page.on('request', (req) => requests.push(req.url()));

    await page.goto(base + '/');
    await page.waitForSelector('.pr-nav');

    // ---- prof-03: mobile hamburger nav ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);

    await check('prof-03: .pr-nav__links is hidden below 820px (unchanged desktop/mobile split)', async () => {
        assert.strictEqual(await page.locator('.pr-nav__links').isVisible(), false);
    });

    await check('prof-03: a hamburger toggle exists, is visible, and is >=44x44px', async () => {
        const toggle = page.locator('#pr-nav-toggle');
        assert.strictEqual(await toggle.count(), 1, 'no #pr-nav-toggle element — no mobile menu fallback exists');
        assert.strictEqual(await toggle.isVisible(), true);
        const box = await toggle.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44, 'toggle target must be >= 44x44px, got ' + JSON.stringify(box));
        assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'false');
        assert.strictEqual(await toggle.getAttribute('aria-controls'), 'pr-nav-mobile');
    });

    await check('prof-03: activating the toggle reveals all 5 nav links and moves focus in', async () => {
        await page.click('#pr-nav-toggle');
        await page.waitForTimeout(150);
        const menu = page.locator('#pr-nav-mobile');
        assert.strictEqual(await menu.isVisible(), true);
        assert.strictEqual(await page.getAttribute('#pr-nav-toggle', 'aria-expanded'), 'true');
        const linkHrefs = await menu.locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
        for (const href of ['#services', '#about', '#faq', '#contact', '#appointment']) {
            assert.ok(linkHrefs.includes(href), 'mobile menu missing link ' + href);
        }
        const focusedHref = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('href'));
        assert.strictEqual(focusedHref, '#services', 'opening the menu should focus its first link');
    });

    await check('prof-03: Escape closes the menu and returns focus to the toggle', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        assert.strictEqual(await page.locator('#pr-nav-mobile').isVisible(), false);
        assert.strictEqual(await page.getAttribute('#pr-nav-toggle', 'aria-expanded'), 'false');
        const focusedId = await page.evaluate(() => document.activeElement && document.activeElement.id);
        assert.strictEqual(focusedId, 'pr-nav-toggle');
    });

    // ---- F2: honest appointment-form failure on a backend-less static export ----
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#appointment').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const typeRadio = page.locator('input[name="appt-type"]').first();
    if (await typeRadio.count()) await typeRadio.check({ force: true });
    await page.fill('#pr-name', 'Ana Popescu');
    await page.fill('#pr-email', 'ana.popescu@example.com');

    const reqCountBeforeSubmit = requests.length;
    await page.click('#pr-appt-submit');
    await page.waitForTimeout(1000);

    await check('F2: the export really attempts POST /api/appointments (no path/slug shortcut)', async () => {
        const apiReqs = requests.slice(reqCountBeforeSubmit).filter((u) => u.includes('/api/appointments'));
        assert.strictEqual(apiReqs.length, 1, 'expected exactly one real attempt at /api/appointments, saw: ' + JSON.stringify(apiReqs));
    });

    await check('F2: fake success is never shown once that attempt 404s', async () => {
        assert.strictEqual(await page.locator('#pr-appt-done').isVisible(), false, '#pr-appt-done (success chrome) must stay hidden on a real, failed submission');
    });

    await check('F2: an honest failure state is shown instead, with real phone + WhatsApp contact', async () => {
        const fail = page.locator('#pr-appt-fail');
        assert.strictEqual(await fail.count(), 1, 'no honest failure panel exists (#pr-appt-fail)');
        assert.strictEqual(await fail.isVisible(), true);
        const text = await fail.innerText();
        assert.ok(/nu a (fost trimisă|ajuns)/i.test(text), 'failure panel must clearly say the request was NOT sent, got: ' + JSON.stringify(text));
        const telHref = await fail.locator('a[href^="tel:"]').getAttribute('href');
        const waHref = await fail.locator('a[href*="wa.me"]').getAttribute('href');
        assert.strictEqual(telHref, 'tel:' + config.contact.phone, 'phone CTA must use the real configured business phone, not an invented one');
        assert.strictEqual(waHref, config.contact.waHref, 'WhatsApp CTA must use the real configured business WhatsApp link, not an invented one');
    });

    await check('F2: the appointment form itself is never hidden on failure', async () => {
        assert.strictEqual(await page.locator('#pr-appt-form').isVisible(), true, 'form must remain visible/usable so the visitor can retry — it must not be silently swapped out');
    });

    await browser.close();
    server.close();

    if (failed) {
        console.error('audit-professionals-fixes: FAILED', failed);
        process.exit(1);
    }
    console.log('audit-professionals-fixes: ok');
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
