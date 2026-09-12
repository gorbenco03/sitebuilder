'use strict';
/**
 * bot/test/suite10-instagram-teaser-a11y-contrast.test.js
 *
 * The Instagram-teaser veil (`.hb-ig-teaser__veil`) sits its lead text and
 * `data-hb-ig-connect` CTA on top of blurred example photos — exactly the
 * situation where a contrast PROBE and a real DESIGN both commonly go
 * wrong (a blur can lighten/darken unpredictably depending on the source
 * photo, and a CSS-only guess at the resulting colour is not trustworthy).
 * So this measures REAL rendered pixels from an actual Playwright
 * screenshot, the same way bot/test/suite7-template-contract.test.js does
 * for the rest of each template — never getComputedStyle() as a proxy for
 * what the reader actually sees.
 *
 * REUSE, NOT REINVENTION: suite7-template-contract.test.js's own header
 * explains that an earlier round of this exact kind of check found 96 of
 * 108 "violations" were sampling artefacts (glyphs still in the screenshot,
 * borders sampled one device-pixel off) — see that file's "Method notes".
 * The ink-hide-then-screenshot-then-sample technique below (`hideInkAndShoot`
 * / the per-element grid sampling in `measureTextContrast`) is PORTED
 * VERBATIM from suite7's `prepareAndHideInk` / `restoreInk` / the text-
 * contrast portion of `computeChecks` (that file does not export its
 * helpers — it is a plain `test()` script, not a library module — so
 * `require()`-ing it here would re-execute its own expensive 5x3x3
 * Playwright contract as a side effect of loading this file; porting the
 * function bodies avoids that while keeping the exact measurement method).
 * Do not "improve" the sampling approach here independently of that file —
 * if the method needs to change, change it in both places for the same
 * reason, per suite7's own contract note about not doing that lightly.
 *
 * WCAG 1.4.3: contrast ratio >= 4.5:1 for normal text, >= 3:1 for large
 * text (>=24px, or >=18.66px at weight >=700) — same bar suite7 uses.
 *
 * SCOPE: all five templates, the three themes suite7 uses (preset default,
 * plus the "Portocaliu" and "Roz" saturated accents an owner can actually
 * pick from builder/app.js's colour-picker popover — ported here with the
 * same hexToHsl/hslToHex/deriveAccent formulas suite7 uses, for the same
 * reason: this reproduces what an owner can produce, not a hypothetical).
 * Measured at 390px (mobile) and 1280px (desktop), matching the two
 * viewports item 3's visual evidence uses.
 *
 * STATUS AT TIME OF WRITING: the Instagram-teaser section
 * (`data-hb-ig-teaser`) does not exist in any template yet in this
 * worktree — verified by rendering every template's every preset with
 * editMode:true and finding no `data-hb-ig-teaser` anywhere (also checked:
 * `grep -r hb-ig-teaser` across this worktree and every sibling
 * `.claude/worktrees/agent-*` worktree found nothing). This file does NOT
 * fabricate a pass for work that doesn't exist: it renders every
 * template/theme/viewport combination, and if the veil is genuinely absent
 * everywhere, it calls `t.skip(...)` with an explicit explanation rather
 * than reporting green. Once the section lands, re-running this file
 * (unchanged) starts measuring it for real — per template, whichever ones
 * already have the section get measured even if others don't yet, so this
 * self-activates incrementally as each of the two parallel agents lands
 * their work rather than needing an all-or-nothing flag flip.
 *
 * Run: node --test bot/test/suite10-instagram-teaser-a11y-contrast.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES = ['product-menu', 'portfolio', 'local-service', 'professionals', 'desserdirina'];
const VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
];

// ---------------------------------------------------------------------------
// Theme palette — ported 1:1 from suite7-template-contract.test.js (which
// itself ports it 1:1 from builder/app.js's hexToHsl/hslToHex/deriveColors),
// so "2 saturated colours from the palette" means exactly what an owner sees
// in the colour-picker popover.
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
const THEMES = [
    { name: 'preset (default)', accent: null },
    { name: 'Portocaliu (paletă)', accent: deriveAccent('#EA580C') },
    { name: 'Roz (paletă)', accent: deriveAccent('#DB2777') },
];
function buildThemedConfig(basePreset, theme) {
    const cfg = JSON.parse(JSON.stringify(basePreset));
    if (theme.accent) cfg.theme = Object.assign({}, cfg.theme, theme.accent);
    return cfg;
}

// ---------------------------------------------------------------------------
// Sampling helpers — ported verbatim (methodology + implementation) from
// suite7-template-contract.test.js's prepareAndHideInk / restoreInk / the
// text-contrast portion of computeChecks. See that file's header "Method
// notes" for the full rationale (glyphs hidden before the one screenshot so
// sampling never lands on ink; own-fill elements sampled on a vertical-
// center row, no-fill text sampled inside its own former glyph box).
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
                el.classList.add('hb-s8a-hide-ink');
                prepared.push({
                    sel, idx, text: text.slice(0, 40),
                    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
                    tr: { left: tr.left, top: tr.top, width: tr.width, height: tr.height },
                    fg: cs.color, bgOwn: cs.backgroundColor,
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

async function measureTextContrast(page, imgB64, prepared) {
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

// Broad, best-effort selectors for "the veil's lead text and CTA label" —
// the task's markup contract names the container (`.hb-ig-teaser__veil`)
// and the CTA marker (`[data-hb-ig-connect]`) but not a specific class for
// the lead paragraph, so this covers the common text-bearing tags inside
// the veil (excluding the button itself, measured separately) rather than
// guessing one exact class name. Refine/narrow once the real markup lands
// if it turns out to need it — this is deliberately generous, the same
// "solid starting set, not exhaustive" approach suite7's own TEXT_CASES
// tables use.
const VEIL_TEXT_SELECTORS = [
    '.hb-ig-teaser__veil p',
    '.hb-ig-teaser__veil h1', '.hb-ig-teaser__veil h2', '.hb-ig-teaser__veil h3',
    '.hb-ig-teaser__veil span:not([data-hb-ig-connect])',
    '.hb-ig-teaser__veil strong',
];
const VEIL_CTA_SELECTORS = ['[data-hb-ig-connect]'];

async function renderEditModeSite(tpl, cfg) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite10-a11y-' + tpl + '-'));
    // Reuse buildStaticSiteTree for the asset tree (images/css/js copied +
    // minified exactly like a real publish) — then overwrite index.html with
    // the editMode:true render, since buildStaticSiteTree/build() always
    // renders the public (non-edit) path (see build.js's build()).
    siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', tpl, 'template.html'), 'utf8');
    const editHtml = renderHtml(templateHtml, cfg, { editMode: true });
    fs.writeFileSync(path.join(dir, 'index.html'), editHtml, 'utf8');
    return dir;
}

test('suite10: Instagram-teaser veil text and CTA meet WCAG 1.4.3 contrast — 5 templates x 3 themes x 2 widths', async (t) => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    const report = [];
    let anyTeaserFound = false;
    const templatesWithoutTeaser = [];

    try {
        for (const tpl of TEMPLATES) {
            const basePreset = JSON.parse(
                fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')
            ).presets[0].config;

            // Fast, browser-free presence check before spending a Playwright
            // page load: does this template's editMode render even contain
            // the teaser section?
            const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', tpl, 'template.html'), 'utf8');
            const probe = renderHtml(templateHtml, basePreset, { editMode: true });
            if (!probe.includes('data-hb-ig-teaser')) {
                templatesWithoutTeaser.push(tpl);
                continue;
            }
            anyTeaserFound = true;

            for (const theme of THEMES) {
                const cfg = buildThemedConfig(basePreset, theme);
                for (const vp of VIEWPORTS) {
                    const dir = await renderEditModeSite(tpl, cfg);
                    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
                    const page = await context.newPage();
                    try {
                        await page.emulateMedia({ reducedMotion: 'reduce' });
                        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                        await page.waitForTimeout(200);

                        // Reveal the veil if it ships `hidden` by default — the
                        // task brief's contract shows `<div class="hb-ig-teaser__veil" hidden>`,
                        // and its text must still be checked once revealed (the
                        // state a visitor sees after the reveal interaction), not
                        // only whatever (if anything) is visible at rest.
                        await page.evaluate(() => {
                            document.querySelectorAll('.hb-ig-teaser__veil[hidden]')
                                .forEach((el) => el.removeAttribute('hidden'));
                        });

                        const selectors = [...VEIL_TEXT_SELECTORS, ...VEIL_CTA_SELECTORS];
                        const prepared = await prepareAndHideInk(page, selectors);
                        const shot = await page.screenshot({ fullPage: true });
                        await restoreInk(page);

                        if (prepared.length === 0) {
                            report.push(`${tpl} @ ${vp.width}px / ${theme.name}: data-hb-ig-teaser present but no matching veil text/CTA element found (selectors: ${selectors.join(', ')}) — markup may use different tags/classes than this file's best-effort selectors; see VEIL_TEXT_SELECTORS/VEIL_CTA_SELECTORS comment.`);
                            continue;
                        }

                        const textFailures = await measureTextContrast(page, shot.toString('base64'), prepared);
                        const label = `${tpl} @ ${vp.width}px / ${theme.name}`;
                        for (const f of textFailures) {
                            const msg = `${label}: "${f.text}" (${f.selector}[${f.index}]) ratio ${f.ratio}:1, need ${f.bar}:1 ` +
                                `(${f.fontPx}px/${f.weight}) fg=rgb(${f.fg.join(',')}) bg=rgb(${f.bg.join(',')})`;
                            failures.push(msg);
                            report.push(msg);
                        }
                    } finally {
                        await context.close();
                        fs.rmSync(dir, { recursive: true, force: true });
                    }
                }
            }
        }
    } finally {
        await browser.close();
    }

    if (report.length) console.log('\n' + report.join('\n') + '\n');

    if (!anyTeaserFound) {
        t.skip(
            'Instagram-teaser section (data-hb-ig-teaser) not found in ANY template\'s editMode render ' +
            '(checked: ' + templatesWithoutTeaser.join(', ') + '). The two parallel agents\' work has not ' +
            'landed in this worktree yet — this is not a pass, it is an honest skip. Re-run this file once ' +
            'the section exists; it self-activates per template (see file header).'
        );
        return;
    }

    if (templatesWithoutTeaser.length) {
        console.warn(
            `\nNote: ${templatesWithoutTeaser.length} of ${TEMPLATES.length} templates had no ` +
            `data-hb-ig-teaser yet and were skipped individually: ${templatesWithoutTeaser.join(', ')}`
        );
    }

    assert.deepEqual(failures, [], 'Instagram-teaser veil contrast failures:\n' + failures.join('\n'));
});
