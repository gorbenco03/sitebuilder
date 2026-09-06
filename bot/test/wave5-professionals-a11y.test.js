'use strict';
/**
 * bot/test/wave5-professionals-a11y.test.js
 *
 * Oracle for three accessibility checks on the professionals template's real
 * rendered output (not source inspection):
 *
 *   1. Colour contrast (WCAG AA — 4.5:1 normal text, 3:1 large text) across
 *      every distinct text style used in the template, computed from the
 *      ACTUAL composited colours (getComputedStyle, alpha-blended against
 *      the real ancestor background chain), not the raw CSS source values.
 *      Found and fixed: --mute (used by .pr-kicker, .pr-hero__meta,
 *      .pr-scroll, .pr-copy--sm/.pr-ig-handle in light sections) measured
 *      3.21:1 at its old alpha of 0.48 — raised to 0.62 (styles.css).
 *   2. Interactive target size (WCAG 2.5.8 AA minimum: 24x24 CSS px) for
 *      every visible link/button/summary, excluding controls that are
 *      inline within flowing paragraph text (exempted by the SC) and
 *      visually-hidden radio inputs whose real target is the label that
 *      wraps them. Found and fixed: desktop nav links (~19px tall), the
 *      hero scroll indicator (~17px wide — vertical-rl text), and the
 *      footer legal links (privacy/terms/cookies — previously unstyled,
 *      ~20px tall) — all now >=24px in both dimensions.
 *   3. No horizontal scrolling at 200%-zoom-equivalent widths. A 1280px
 *      baseline desktop at 200% zoom reflows to a 640 CSS px viewport;
 *      320px is WCAG 1.4.10's own reflow reference width. Checked at both.
 *
 * Run: node --test bot/test/wave5-professionals-a11y.test.js
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

async function buildExportDir() {
    const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config));
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
    const html = renderHtml(templateHtml, config);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-prof-a11y-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/styles.css'), path.join(tmpDir, 'styles.css'));
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/script.js'), path.join(tmpDir, 'script.js'));
    fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(tmpDir, 'images/hero.jpg'));
    return tmpDir;
}

/* eslint-disable */
function browserContrastCheck(selectors) {
    function parseColor(str) {
        const m = str.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const parts = m[1].split(',').map((s) => parseFloat(s));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    function effectiveBg(el) {
        let node = el;
        const layers = [];
        while (node) {
            const bg = parseColor(getComputedStyle(node).backgroundColor);
            if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 0.999) break; }
            node = node.parentElement;
        }
        let result = { r: 255, g: 255, b: 255 };
        for (let i = layers.length - 1; i >= 0; i--) {
            const c = layers[i];
            result = { r: c.r * c.a + result.r * (1 - c.a), g: c.g * c.a + result.g * (1 - c.a), b: c.b * c.a + result.b * (1 - c.a) };
        }
        return result;
    }
    function relLum({ r, g, b }) {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(c1, c2) {
        const L1 = relLum(c1), L2 = relLum(c2);
        const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
        return (a + 0.05) / (b + 0.05);
    }
    const out = [];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        const fg = parseColor(cs.color);
        const bg = effectiveBg(el);
        const fgEffective = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) } : fg;
        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
        const required = isLarge ? 3 : 4.5;
        const r = ratio(fgEffective, bg);
        out.push({ sel, ratio: Math.round(r * 100) / 100, required, pass: r >= required });
    }
    return out;
}
/* eslint-enable */

test('wave5-professionals: WCAG AA contrast, 24x24 target size, and 200%-zoom reflow on real rendered output', async (t) => {
    const tmpDir = await buildExportDir();
    const server = await serveDir(tmpDir);
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());

    await t.test('colour contrast >= WCAG AA on every distinct text style, both viewports', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(base + '/');
        await page.waitForTimeout(150);
        const selectors = [
            '.pr-nav__links a', '.pr-nav__cta', '.pr-kicker', '.pr-lede', '.pr-copy',
            '.pr-svc__title', '.pr-btn--primary', '.pr-btn--ghost', '.pr-steps__title',
            '.pr-cred__list li', '.pr-faq__q', '.pr-contact__row', '.pr-foot__name',
            '.pr-copy--sm', '.pr-label', '.pr-type__meta', '.pr-hero__meta', '.pr-strip__item',
            '.pr-sec--book .pr-copy', '.pr-sec--book .pr-btn--primary', '.pr-sec--book .pr-btn--ghost',
            '.pr-appt-done__title', '.pr-appt__fail-title', '.pr-scroll', '.hb-legal-links a', '.hb-built-by',
        ];
        const results = await page.evaluate(browserContrastCheck, selectors);
        const failures = results.filter((r) => r.pass === false);
        assert.deepStrictEqual(failures, [], 'contrast failures: ' + JSON.stringify(failures, null, 2));
        await page.close();
    });

    await t.test('every non-exempt interactive target is >= 24x24 CSS px, desktop', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(base + '/');
        await page.waitForTimeout(150);
        const fails = await page.evaluate(() => {
            function inlineExempt(el) {
                return el.tagName === 'A' && !!el.closest('p, .pr-appt__fallback');
            }
            return Array.from(document.querySelectorAll('a[href], button, summary, input[type="radio"]'))
                .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
                .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
                .filter((el) => !inlineExempt(el))
                .map((el) => {
                    const box = el.getBoundingClientRect();
                    return { tag: el.tagName, cls: String(el.className).slice(0, 40), text: (el.textContent || '').trim().slice(0, 24), w: Math.round(box.width), h: Math.round(box.height) };
                })
                .filter((r) => r.w > 0 && r.h > 0 && (r.w < 24 || r.h < 24));
        });
        assert.deepStrictEqual(fails, [], 'targets under 24x24: ' + JSON.stringify(fails, null, 2));
        await page.close();
    });

    await t.test('every non-exempt interactive target is >= 24x24 CSS px, mobile (menu open)', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(base + '/');
        await page.waitForTimeout(150);
        const toggle = page.locator('#pr-nav-toggle');
        if (await toggle.count()) await toggle.click();
        await page.waitForTimeout(150);
        const fails = await page.evaluate(() => {
            function inlineExempt(el) {
                return el.tagName === 'A' && !!el.closest('p, .pr-appt__fallback');
            }
            return Array.from(document.querySelectorAll('a[href], button, summary, input[type="radio"]'))
                .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
                .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
                .filter((el) => !inlineExempt(el))
                .map((el) => {
                    const box = el.getBoundingClientRect();
                    return { tag: el.tagName, cls: String(el.className).slice(0, 40), text: (el.textContent || '').trim().slice(0, 24), w: Math.round(box.width), h: Math.round(box.height) };
                })
                .filter((r) => r.w > 0 && r.h > 0 && (r.w < 24 || r.h < 24));
        });
        assert.deepStrictEqual(fails, [], 'targets under 24x24: ' + JSON.stringify(fails, null, 2));
        await page.close();
    });

    await t.test('no horizontal scroll at 200%-zoom-equivalent widths (640px) or the WCAG 1.4.10 reference width (320px)', async () => {
        for (const width of [640, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            await page.goto(base + '/');
            await page.waitForTimeout(200);
            const overflow = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }));
            assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, `horizontal overflow at ${width}px: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`);
            await page.close();
        }
    });
});
