'use strict';
/**
 * bot/test/s72-professionals-suite7-fixes.test.js
 *
 * Oracle for the templates/professionals findings assigned to S7-2
 * (PLAN-QA-2026-09-12.md, Suite 7), all confirmed by
 * 04-QA-Evidence/QA-Explorare-2026-09-12/reports/{04-sections-schema,
 * 06-published-sites-quality}.md:
 *
 *   M7 / m7 / X4 — the Contact section's rows (.pr-contact__row) were
 *     rendered with a 1px border + a near-white (--snow) background + input
 *     padding, on every one of the 4 rows, with no icon on any of them —
 *     measured to read exactly like an empty form field the visitor is
 *     expected to fill in (D6), and confirmed to have zero social icons at
 *     all (D7's professionals half). This escaped every existing contrast/
 *     touch-target oracle because both are still satisfied by an empty
 *     bordered box — nothing here previously measured "does this look like
 *     a form".
 *   m13 — the footer's legal-links nav sat 10.4px lower than the business
 *     name / copyright on the same visual row (D5), because
 *     .pr-foot__inner's flex items were never given an explicit
 *     align-items, so each item's default (stretch) box grew independently
 *     without lining up first-line text baselines. No prior oracle measured
 *     cross-item footer alignment, only 24px touch-target floors.
 *   m6 — business.profession / .languages / .modes render in TWO places
 *     (.pr-hero__meta in the hero card, .pr-strip below it) sharing the
 *     same config path. builder/app.js's inline-text-edit path patches only
 *     the one DOM node the owner actually typed into (see app.js's
 *     onInlineTextEdit → sendSetToIframe, which does not re-query every
 *     [data-hb-edit="<path>"] element) so clearing the fields in the hero
 *     card left the strip showing stale text. The static " · " separator
 *     between modes/languages in the hero card is plain text, not
 *     conditioned on live content, so clearing both fields left a dangling
 *     "· " behind. Fix: delete the duplicate .pr-strip band outright (the
 *     plan's stated default) and make the separator a CSS ::before keyed
 *     off :not(:empty)/:has() on the [data-hb-edit] spans the *editor's*
 *     own edit-mode render wraps text tokens in — reactive to live edits
 *     with no app.js change, a no-op on the plain published HTML that never
 *     carries those attributes at all.
 *   D1 — border-radius measured 4px on the primary CTA, the most
 *     square-cornered of all 5 templates (client asked for rounder
 *     buttons).
 *
 * All four measured against the real rendered/published output (renderHtml,
 * a bare static file server, a real Chromium page), not against source CSS
 * text.
 *
 * Run: node --test bot/test/s72-professionals-suite7-fixes.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

function loadPlaywright() {
    const candidates = [
        path.join(ROOT, 'node_modules', 'playwright'),
        '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    ];
    for (const c of candidates) {
        try { return require(c); } catch (_) { /* try next */ }
    }
    throw new Error('playwright not found in any candidate location: ' + candidates.join(', '));
}
const { chromium } = loadPlaywright();

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

function baseConfig() {
    return JSON.parse(JSON.stringify(
        JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config
    ));
}

function writeExport(dir, html) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/styles.css'), path.join(dir, 'styles.css'));
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/script.js'), path.join(dir, 'script.js'));
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(dir, 'images/hero.jpg'));
}

async function buildExportDir(config, opts) {
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
    const html = renderHtml(templateHtml, config, opts);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's72-professionals-'));
    writeExport(tmpDir, html);
    return tmpDir;
}

test('s72 professionals: contact rows look like contact info, not an empty form', async (t) => {
    const config = baseConfig();
    // Exercise every icon type the client asked for (phone, email, WhatsApp,
    // map) plus the two social rows (m7/X4), all in one page.
    config.contact.addressHref = 'https://maps.google.com/?q=test';
    config.contact.instagram.url = 'https://instagram.com/example';
    config.contact.facebook.url = 'https://facebook.com/example';

    const tmpDir = await buildExportDir(config);
    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/');
    await page.waitForTimeout(150);

    const rows = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.pr-contact__row')).map((row) => {
            const cs = getComputedStyle(row);
            const icon = row.querySelector('svg');
            return {
                ld: row.getAttribute('data-ld') || '',
                borderTopWidth: cs.borderTopWidth,
                borderStyle: cs.borderTopStyle,
                background: cs.backgroundColor,
                hasSvgIcon: !!icon,
            };
        });
    });

    assert.ok(rows.length >= 5, 'expected at least 5 contact rows (phone/email/whatsapp/address/instagram/facebook), got ' + rows.length);

    for (const row of rows) {
        assert.ok(
            row.borderTopWidth === '0px' || row.borderStyle === 'none',
            'row ' + row.ld + ' still has a visible border (' + row.borderTopWidth + ' ' + row.borderStyle + ') — reads as an empty input'
        );
        assert.ok(row.hasSvgIcon, 'row ' + row.ld + ' has no SVG icon (measured hasSvgIcon:false, same as the confirmed D6/D7 findings)');
    }

    // The section background itself (--paper) so a bordered/near-white panel
    // no longer reads as a distinct form-field surface floating on the page.
    const bg = await page.evaluate(() => {
        const sectionBg = getComputedStyle(document.querySelector('#contact')).backgroundColor;
        const rowBg = getComputedStyle(document.querySelector('.pr-contact__row')).backgroundColor;
        return { sectionBg, rowBg };
    });
    await page.close();
    assert.equal(bg.rowBg, bg.sectionBg, 'contact row background (' + bg.rowBg + ') still differs from the section background (' + bg.sectionBg + ') — still reads as a separate panel/input');
});

test('s72 professionals: footer legal links share the same visual baseline as the business name / copyright (±2px)', async (t) => {
    const tmpDir = await buildExportDir(baseConfig());
    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/');
    await page.waitForTimeout(150);

    // Plain element.getBoundingClientRect().top is not enough here: the row
    // is a flex container, and the pre-fix bug (align-items defaulting to
    // stretch) grows every item's BOX to match the tallest sibling without
    // moving any box's top edge — so a naive box-top comparison reads 0px
    // diff even on the broken markup. What a visitor actually sees shift is
    // the TEXT inside .hb-legal-links a, which centers itself
    // (align-items:center, kept for the 24px touch-target floor)
    // vertically inside that now-oversized box. Range.getBoundingClientRect
    // over the text node reports the real glyph position instead of the
    // (stretched) container box.
    const tops = await page.evaluate(() => {
        function textTop(el) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const node = walker.nextNode();
            if (!node) return null;
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect().top;
        }
        return {
            name: textTop(document.querySelector('.pr-foot__name')),
            legal: textTop(document.querySelector('.hb-legal-links a')),
        };
    });
    await page.close();

    const diff = Math.abs(tops.name - tops.legal);
    assert.ok(diff <= 2, 'footer legal-links text top (' + tops.legal + ') vs business-name text top (' + tops.name + ') differ by ' + diff.toFixed(2) + 'px, must be <=2px (measured 10.4px before the fix)');
});

test('s72 professionals: profession/languages/modes chip renders in exactly one place, no duplicate strip band', async (t) => {
    const tmpDir = await buildExportDir(baseConfig());
    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/');
    await page.waitForTimeout(150);

    const count = await page.evaluate(() => document.querySelectorAll('.pr-strip').length);
    await page.close();

    assert.equal(count, 0, 'a second .pr-strip band still exists — profession/languages/modes remain duplicated (m6)');
});

test('s72 professionals: editor-mode chip separator does not go orphan when a field is cleared live', async (t) => {
    // The duplication bug (m6) only manifests in the BUILDER'S live editor
    // preview: renderHtml(..., {editMode:true}) is exactly what
    // builder/app.js's iframe srcdoc uses, wrapping each text token in
    // <span data-hb-edit="path">. On the plain published site (no editMode)
    // there is no live-editing session, so the separator's original
    // "@if business.languages" build-time guard is already correct and this
    // scenario cannot occur — this test targets the editor-mode render.
    const config = baseConfig();
    const tmpDir = await buildExportDir(config, { editMode: true });
    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/');
    await page.waitForTimeout(150);

    // Simulate the owner clearing both fields via the overlay's
    // contenteditable flow (a plain textContent mutation — no re-render).
    const before = await page.evaluate(() => {
        const el = document.querySelector('[data-hb-edit="business.languages"]');
        return el ? getComputedStyle(el, '::before').content : null;
    });
    assert.notEqual(before, null, 'no [data-hb-edit="business.languages"] span found in edit-mode render — cannot exercise the live-clear scenario');

    const after = await page.evaluate(() => {
        const modes = document.querySelector('[data-hb-edit="business.modes"]');
        const langs = document.querySelector('[data-hb-edit="business.languages"]');
        modes.textContent = '';
        langs.textContent = '';
        const meta = document.querySelector('.pr-hero__meta');
        const sepEl = meta.querySelector('.pr-hero__sep');
        return {
            sepContent: getComputedStyle(langs, '::before').content,
            // innerText, not textContent: the separator is real markup (it has
            // to be — a published page has no [data-hb-edit] for CSS to hang
            // off, see suite8-hero-chip-separator), and the editor hides it
            // rather than deleting it. textContent reads hidden text too, so
            // it would report an orphan dot that nobody can see.
            metaText: meta.innerText,
            sepDisplay: sepEl ? getComputedStyle(sepEl).display : '(no .pr-hero__sep)',
        };
    });
    await page.close();

    assert.ok(
        after.sepContent === 'none' || after.sepContent === '""' || !/·/.test(after.sepContent),
        'separator pseudo-element still renders "·" after both chips were cleared live: ' + after.sepContent
    );
    assert.ok(!/·/.test(after.metaText),
        'orphan "·" visible in .pr-hero__meta after clearing both fields live: ' + JSON.stringify(after.metaText));
    assert.equal(after.sepDisplay, 'none',
        'the separator span must be hidden once a neighbouring chip is empty: ' + after.sepDisplay);
});

test('s72 professionals: primary CTA corners are rounded (~10px), not the old sharp 4px', async (t) => {
    const tmpDir = await buildExportDir(baseConfig());
    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/');
    await page.waitForTimeout(150);

    const radius = await page.evaluate(() => {
        const btn = document.querySelector('.pr-hero__actions .pr-btn--primary');
        return parseFloat(getComputedStyle(btn).borderTopLeftRadius);
    });
    await page.close();

    assert.ok(radius >= 8, 'primary CTA border-radius measured ' + radius + 'px, expected ~10px (>=8px), was 4px before the fix');
});
