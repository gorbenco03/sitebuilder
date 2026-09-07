'use strict';
/**
 * bot/test/wave5-professionals-jsonld.test.js
 *
 * Oracle for prof-06 (medium): "JSON-LD LocalBusiness nu se generează la
 * publicare prin builder-ul web (doar fluxul Telegram îl populează)."
 * The root cause (bot/flow.js's buildSeo() is wired into the Telegram flow
 * only, not build.js/webpublish.js) lives outside this template's owned
 * files (build.js, webpublish.js, bot/** are off-limits here) — see
 * HANDOFF-professionals.md for the precise server-side ask.
 *
 * What this wave adds INSIDE templates/professionals: a client-side
 * fallback (initLocalBusinessJsonLd() in script.js) that builds a real
 * schema.org LocalBusiness JSON-LD block from data already present in the
 * rendered DOM (business name, phone/email/address, socials, opening hours,
 * hero photo) using JSON.stringify (so escaping is always correct — no
 * hand-rolled string concatenation into a JSON literal), and only when no
 * server-populated <script type="application/ld+json"> already exists (so
 * a Telegram-published site's real buildSeo() output is never overridden).
 *
 * This test renders the template exactly like the web-builder publish path
 * does (renderHtml() with no seo.jsonLd in config — reproducing the exact
 * gap prof-06 describes), serves it, loads it in real Chromium, and asserts
 * the injected JSON-LD parses and carries the REAL configured values, not
 * placeholders.
 *
 * Run: node --test bot/test/wave5-professionals-jsonld.test.js
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

test('wave5-professionals: client-side LocalBusiness JSON-LD carries real config values on a web-builder publish (no server seo.jsonLd)', async (t) => {
    const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config));
    // The preset now ships a server-side ProfessionalService block, so this
    // fixture strips it: the contract under test is the CLIENT-SIDE fallback,
    // which by design stands down whenever a server block exists. The gap it
    // covers is still real — a draft whose seo.jsonLd was cleared, or a publish
    // path that never sets one — it is just no longer the default preset.
    //
    // Reading the preset and deleting the key, rather than hand-writing a
    // fixture, keeps this test measuring the real template's real fields.
    if (config.seo) delete config.seo.jsonLd;
    assert.ok(!config.seo || !config.seo.jsonLd, 'fixture must not carry seo.jsonLd — the client-side fallback is what is under test');

    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
    const html = renderHtml(templateHtml, config);
    assert.ok(!/application\/ld\+json/.test(html), 'renderHtml output must not already contain a server-side JSON-LD block for this fixture');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-prof-jsonld-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/styles.css'), path.join(tmpDir, 'styles.css'));
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/script.js'), path.join(tmpDir, 'script.js'));
    fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(tmpDir, 'images/hero.jpg'));

    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(base + '/');
    await page.waitForTimeout(300);

    const jsonLdText = await page.evaluate(() => {
        const el = document.querySelector('script[type="application/ld+json"]');
        return el ? el.textContent : null;
    });

    await t.test('a JSON-LD block is injected', () => {
        assert.ok(jsonLdText, 'no <script type="application/ld+json"> was injected into <head>');
    });

    let data;
    await t.test('it parses as valid JSON', () => {
        data = JSON.parse(jsonLdText);
    });

    await t.test('it is a schema.org LocalBusiness with the real business name (not a placeholder)', () => {
        assert.strictEqual(data['@context'], 'https://schema.org');
        assert.strictEqual(data['@type'], 'LocalBusiness');
        assert.strictEqual(data.name, config.business.name);
        assert.notStrictEqual(data.name, '', 'name must not be empty');
        assert.ok(!/lorem|placeholder|example/i.test(data.name), 'name must not look like a placeholder');
    });

    await t.test('it carries the real configured phone, email and address', () => {
        assert.strictEqual(data.telephone, config.contact.phone);
        assert.strictEqual(data.email, config.contact.email);
        assert.ok(data.address && data.address.streetAddress, 'address.streetAddress must be present');
        // The source address has a <br> — confirm both physical lines survived
        // (not html-entity-mangled, not truncated to just the first line).
        assert.ok(data.address.streetAddress.includes('Strada Academiei 12'), 'first address line missing: ' + data.address.streetAddress);
        assert.ok(data.address.streetAddress.includes('București'), 'second address line missing: ' + data.address.streetAddress);
    });

    await t.test('it carries opening hours derived from the real weekly appointment schedule', () => {
        assert.ok(Array.isArray(data.openingHoursSpecification) && data.openingHoursSpecification.length > 0, 'openingHoursSpecification missing');
        const monday = data.openingHoursSpecification.find((s) => s.dayOfWeek === 'https://schema.org/Monday');
        assert.ok(monday, 'Monday hours missing');
        assert.strictEqual(monday.opens, config.appointment.weekly[0].start);
        assert.strictEqual(monday.closes, config.appointment.weekly[0].end);
    });

    await t.test('it resolves url/description from the page itself', () => {
        assert.strictEqual(data.description, config.business.metaDescription);
        assert.ok(data.url && data.url.startsWith('http'), 'url must be an absolute http(s) URL, got: ' + data.url);
    });

    await t.test('a server-populated seo.jsonLd (Telegram flow) is never overridden', async () => {
        const configWithServerLd = JSON.parse(JSON.stringify(config));
        configWithServerLd.seo = { jsonLd: JSON.stringify({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'SERVER-PROVIDED NAME' }) };
        const html2 = renderHtml(templateHtml, configWithServerLd);
        const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-prof-jsonld-server-'));
        fs.writeFileSync(path.join(tmpDir2, 'index.html'), html2);
        fs.copyFileSync(path.join(ROOT, 'templates/professionals/styles.css'), path.join(tmpDir2, 'styles.css'));
        fs.copyFileSync(path.join(ROOT, 'templates/professionals/script.js'), path.join(tmpDir2, 'script.js'));
        fs.mkdirSync(path.join(tmpDir2, 'images'), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(tmpDir2, 'images/hero.jpg'));
        const server2 = await serveDir(tmpDir2);
        const base2 = 'http://127.0.0.1:' + server2.address().port;
        const page2 = await browser.newPage();
        await page2.goto(base2 + '/');
        await page2.waitForTimeout(300);
        const scripts = await page2.evaluate(() => Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent));
        assert.strictEqual(scripts.length, 1, 'exactly one JSON-LD block must exist — no duplicate injected alongside the server one');
        assert.ok(scripts[0].includes('SERVER-PROVIDED NAME'), 'the server-provided JSON-LD must win, unmodified');
        await page2.close();
        server2.close();
    });
});
