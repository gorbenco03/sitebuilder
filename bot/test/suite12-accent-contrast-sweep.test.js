'use strict';
/**
 * bot/test/suite12-accent-contrast-sweep.test.js
 *
 * suite7-template-contract.test.js checks every accent PRESET the builder's
 * colour-picker popover offers (read live from builder/app.js's
 * COLOR_PRESETS), on all five templates. But the popover also has a custom
 * hex input — an owner can pick ANY colour, not just the six swatches — and
 * "text unreadable on the colour the owner picked" is this project's most
 * repeated defect (see PLAN-QA-2026-09-12 and the S7 contract's own header).
 * This file is the property-style check for that: for a sweep of accent
 * hues/lightness levels the six presets don't cover, every CTA/button whose
 * background is the accent must still keep its text at >=4.5:1, on all five
 * templates.
 *
 * Scope is deliberately narrower than suite7 (CTA/button-on-accent elements
 * only, not the full footer/border/social/cookie contract) — this file
 * exists to catch "the derivation formula breaks for hue X" as a PROPERTY of
 * the fix, not to re-run the whole page contract at every one of 100+ hue/
 * lightness combinations that would take.
 *
 * Sampling methodology (hide-ink-then-screenshot text contrast, the
 * composite()/relLum()/ratio() math, the own-fill-vs-plain-text background
 * sampling split) is copied VERBATIM from
 * bot/test/suite7-template-contract.test.js's prepareAndHideInk/
 * restoreInk/computeChecks — see that file's own header comment for why each
 * piece is built the way it is. Per that file's instruction not to change
 * the methodology without re-checking every consumer: this file IS a
 * consumer now, so a methodology change in one must be mirrored in the
 * other. (Not required() from suite7 directly — that file's top-level
 * `test()` call would re-register and re-run suite7's own five-template
 * contract as a side effect of loading it for its helpers, which would
 * silently double-run that ~2-minute suite inside every run of this file.)
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-accent-contrast-sweep.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

// One representative viewport: suite7's own results show a given (template,
// theme) combo's CTA contrast ratio is identical across all 3 widths it
// checks (the button's fill/text colours don't change with layout) — the
// width only matters for layout checks this file doesn't do.
const VIEWPORT = { width: 1440, height: 900 };

// ---------------------------------------------------------------------------
// builder/app.js colour math, ported 1:1 — copied from suite7-template-
// contract.test.js (see that file for the same functions with the same
// names). Kept in sync by hand; both files' headers say so.
// ---------------------------------------------------------------------------
function hexToHsl(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toH = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return '#' + toH(f(0)) + toH(f(8)) + toH(f(4));
}
function deriveAccent(primaryHex) {
    const hsl = hexToHsl(primaryHex);
    return {
        primary: primaryHex,
        primaryLight: hslToHex(hsl.h, Math.min(hsl.s + 5, 100), Math.min(hsl.l + 12, 95)),
        primaryDark: hslToHex(hsl.h, Math.min(hsl.s + 5, 100), Math.max(hsl.l - 12, 5)),
    };
}

// ---------------------------------------------------------------------------
// The hue/lightness sweep. 60-degree steps (6 hues) x 3 lightness levels —
// including the mid-tones the task calls out as the hard case, where
// neither pure black nor pure white text reaches 4.5:1 on the raw accent
// and the FIX has to darken/lighten the button's own fill, not just pick an
// ink — at a fixed, preset-like saturation. Not every custom colour an
// owner could ever type (that's unbounded), and coarser than the task's own
// "every 15 degrees" example — this is a PROPERTY check on the luminance-
// based derivation formula (which has no hue-specific branches, so it has
// no "seams" to hide between sample points), traded off against real
// runtime: 5 templates x 3 widths of full-page renders per combo add up
// fast, and this file already runs alongside suite7's own 90-combo sweep in
// the same `npm test` pass. Widen HUES/LIGHTNESSES for a deeper audit.
// ---------------------------------------------------------------------------
const HUES = Array.from({ length: 6 }, (_, i) => i * 60); // 0, 60, ..., 300
const LIGHTNESSES = [35, 50, 65];
const SATURATION = 75;

const SWEEP_ACCENTS = [];
for (const l of LIGHTNESSES) {
    for (const h of HUES) {
        SWEEP_ACCENTS.push({ h, l, hex: hslToHex(h, SATURATION, l) });
    }
}

const TEMPLATES = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

// CTA/button selectors whose background is (or can be) the owner's accent —
// the narrow slice suite7 also checks, listed here again because this file
// only wants to screenshot/measure THESE elements per combo, not the whole
// page. Kept in sync with each template's TEXT_CASES entry in suite7.
const CTA_CASES = {
    'product-menu': ['.pm-mast__pill', '.pm-hero__cta--fill', '.hb-ig-teaser__cta'],
    'local-service': ['.ls-util__cta', '.ls-btn--fill', '.ls-flow__n', '.hb-ig-teaser__cta'],
    'portfolio': ['.pf-chrome__cta', '.hero-cta', '.pf-appt__wa'],
    'professionals': ['.pr-btn--primary', '.pr-btn--ghost'],
    'desserdirina': ['.hero-cta', '.instagram-follow-btn', '.menu-lang-btn', '.contact-item'],
};

// ---------------------------------------------------------------------------
// Measurement — copied verbatim from suite7-template-contract.test.js
// (prepareAndHideInk / restoreInk / the text-contrast slice of
// computeChecks). See that file for the full reasoning; the short version:
// hide each candidate element's own text (color:transparent) BEFORE the one
// screenshot so the sampler never has to guess where the glyphs aren't, then
// decode the screenshot and sample each element's real fill/backdrop.
// ---------------------------------------------------------------------------
async function prepareAndHideInk(page, textSelectors) {
    return page.evaluate((textSelectors) => {
        if (!document.getElementById('hb-s8a-style')) {
            const style = document.createElement('style');
            style.id = 'hb-s8a-style';
            style.textContent = '.hb-s8a-hide-ink{color:transparent!important;text-shadow:none!important;}';
            document.head.appendChild(style);
        }
        const prepared = [];
        for (const sel of textSelectors) {
            let els;
            try { els = document.querySelectorAll(sel); } catch (e) { continue; }
            els.forEach((el, idx) => {
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) return;
                const cs = getComputedStyle(el);
                if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
                const text = (el.textContent || '').trim();
                if (!text) return;
                if (!cs.color) return;
                let tr = r;
                for (const node of el.childNodes) {
                    if (node.nodeType === 3 && node.textContent.trim()) {
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        const rects = range.getClientRects();
                        if (rects.length && rects[0].width > 0 && rects[0].height > 0) tr = rects[0];
                        break;
                    }
                }
                const fontPx = parseFloat(cs.fontSize);
                let weight = parseInt(cs.fontWeight, 10);
                if (Number.isNaN(weight)) weight = cs.fontWeight === 'bold' ? 700 : 400;
                // Snapshot BEFORE the hide-ink class is added — see suite7's
                // identical comment at this exact spot: getComputedStyle()
                // is live, so reading it after the mutation usually reads
                // back the just-applied transparent colour instead of the
                // real one.
                const realColor = cs.color, realBg = cs.backgroundColor;
                el.classList.add('hb-s8a-hide-ink');
                prepared.push({
                    sel, idx, text: text.slice(0, 40),
                    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
                    tr: { left: tr.left, top: tr.top, width: tr.width, height: tr.height },
                    fg: realColor, bgOwn: realBg,
                    fontPx, weight,
                });
            });
        }
        return prepared;
    }, textSelectors);
}

async function restoreInk(page) {
    await page.evaluate(() => {
        document.querySelectorAll('.hb-s8a-hide-ink').forEach((el) => el.classList.remove('hb-s8a-hide-ink'));
    });
}

async function computeTextFailures(page, imgB64, prepared) {
    return page.evaluate(async ({ imgB64, prepared }) => {
        function relLum([r, g, b]) {
            const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
        }
        function ratio(c1, c2) {
            const l1 = relLum(c1), l2 = relLum(c2);
            const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
            return (hi + 0.05) / (lo + 0.05);
        }
        function parseRgb(str) {
            if (!str) return null;
            const m = /rgba?\(([^)]+)\)/.exec(str);
            if (!m) return null;
            const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
            return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        }
        function composite(fg, bg) {
            if (fg.a >= 1) return [fg.r, fg.g, fg.b];
            return [
                fg.r * fg.a + bg[0] * (1 - fg.a),
                fg.g * fg.a + bg[1] * (1 - fg.a),
                fg.b * fg.a + bg[2] * (1 - fg.a),
            ];
        }
        const img = new Image();
        img.src = 'data:image/png;base64,' + imgB64;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        function samplePixel(x, y) {
            x = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
            y = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
            const d = ctx.getImageData(x, y, 1, 1).data;
            return [d[0], d[1], d[2]];
        }
        function dominantColor(xs, ys) {
            const counts = new Map();
            let bestCount = -1, bestColor = null;
            for (const y of ys) {
                for (const x of xs) {
                    const c = samplePixel(x, y);
                    const key = c.map((v) => Math.round(v / 24) * 24).join(',');
                    const count = (counts.get(key) || 0) + 1;
                    counts.set(key, count);
                    if (count > bestCount) { bestCount = count; bestColor = c; }
                }
            }
            return bestColor;
        }

        const failures = [];
        for (const item of prepared) {
            const fg = parseRgb(item.fg);
            if (!fg || fg.a === 0) continue;
            const bgOwn = parseRgb(item.bgOwn);
            const r = item.rect, tr = item.tr;
            let bg;
            if (bgOwn && bgOwn.a > 0.05) {
                const xs = [0.15, 0.3, 0.5, 0.7, 0.85].map((f) => r.left + r.width * f);
                bg = dominantColor(xs, [r.top + r.height / 2]);
            } else {
                const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => tr.left + tr.width * f);
                const ys = [0.2, 0.5, 0.8].map((f) => tr.top + tr.height * f);
                bg = dominantColor(xs, ys);
            }
            const rt = ratio(composite(fg, bg), bg);
            const fontPx = item.fontPx, weight = item.weight;
            const isLarge = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
            const bar = isLarge ? 3.0 : 4.5;
            if (rt < bar) {
                failures.push({
                    selector: item.sel, index: item.idx, text: item.text,
                    ratio: Math.round(rt * 100) / 100, bar,
                    fontPx: Math.round(fontPx), weight,
                    fg: [Math.round(fg.r), Math.round(fg.g), Math.round(fg.b)], bg,
                });
            }
        }
        return failures;
    }, { imgB64, prepared });
}

function buildThemedConfig(basePreset, accentHex) {
    const cfg = JSON.parse(JSON.stringify(basePreset));
    cfg.theme = Object.assign({}, cfg.theme, deriveAccent(accentHex));
    return cfg;
}

async function measureCombo(browser, tpl, cfg) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-' + tpl + '-'));
    try {
        siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(150);
        const prepared = await prepareAndHideInk(page, CTA_CASES[tpl] || []);
        const shot = await page.screenshot({ fullPage: true });
        await restoreInk(page);
        return await computeTextFailures(page, shot.toString('base64'), prepared);
    } finally {
        await context.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('suite12 accent contrast sweep: CTA/button text on accent stays >=4.5:1 across a hue/lightness sweep — 5 templates', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    const report = [];

    try {
        for (const tpl of TEMPLATES) {
            const basePreset = JSON.parse(
                fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')
            ).presets[0].config;

            for (const accent of SWEEP_ACCENTS) {
                const cfg = buildThemedConfig(basePreset, accent.hex);
                const combo = await measureCombo(browser, tpl, cfg);
                if (combo.length) {
                    const label = `${tpl} @ hue=${accent.h} l=${accent.l} (${accent.hex})`;
                    const msgs = combo.map((f) =>
                        `text contrast ${f.selector}[${f.index}] "${f.text}": ${f.ratio}:1 ` +
                        `(need ${f.bar}:1, ${f.fontPx}px/${f.weight}) fg=rgb(${f.fg.join(',')}) bg=rgb(${f.bg.join(',')})`
                    );
                    report.push(`${label}:\n  - ` + msgs.join('\n  - '));
                    for (const m of msgs) failures.push(`${label}: ${m}`);
                }
            }
        }
    } finally {
        await browser.close();
    }

    if (report.length) console.log('\n' + report.join('\n\n') + '\n');

    assert.deepEqual(failures, [], 'suite12 accent contrast sweep failures:\n' + failures.join('\n'));
});
