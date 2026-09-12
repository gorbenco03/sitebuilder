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
 * REAL REVEAL, NOT A SIMULATION: the veil starts `hidden`, and revealing it
 * (blurring the grid via `.hb-ig-teaser.is-revealed`, un-hiding
 * `.hb-ig-teaser__veil`) is real behaviour owned by
 * `builder/edit-overlay.js`'s click handler (see `revealIgTeaser()` there),
 * not something this file's markup contract spells out byte-for-byte. So
 * this measures against the REAL bundle — `builder/generated/engine.js`'s
 * `renderPreview()`, the exact function `builder/app.js`'s `buildSrcdoc()`
 * calls for the real iframe srcdoc — via
 * `bot/test/lib/suite10-real-preview.js`, and reveals the section with an
 * actual Playwright click on `.hb-ig-teaser__badge` (inside the section,
 * not the CTA), the same interaction a customer's browser performs.
 * Reimplementing the reveal by hand (e.g. just removing the `hidden`
 * attribute) would silently drift from whatever edit-overlay.js actually
 * does — this way it can't.
 *
 * STATUS: the Instagram-teaser feature landed on main at commit 5bf43f6
 * (merged into this branch). Earlier revisions of this file ran against a
 * worktree where it hadn't landed yet and used `t.skip(...)` rather than
 * fabricate a pass — that skip path is left in place (now dead in
 * practice, harmless) so a future regression that removes the section
 * entirely is reported the same honest way instead of as an empty pass.
 *
 * Run: node --test bot/test/suite10-instagram-teaser-a11y-contrast.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));
const { materializePreviewSite } = require('./lib/suite10-real-preview.js');

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

// The real, landed markup (confirmed identical across all five templates —
// see templates/*/template.html): `.hb-ig-teaser__lead` is the veil's lead
// <p>, `.hb-ig-teaser__cta` / `[data-hb-ig-connect]` is the CTA <button>.
// The broader fallback tags are kept too (harmless — querySelectorAll on a
// selector that matches nothing is a no-op) as a defense against a future
// per-template variant this file hasn't seen.
const VEIL_TEXT_SELECTORS = [
    '.hb-ig-teaser__lead',
    '.hb-ig-teaser__veil p',
    '.hb-ig-teaser__veil h1', '.hb-ig-teaser__veil h2', '.hb-ig-teaser__veil h3',
    '.hb-ig-teaser__veil span:not([data-hb-ig-connect])',
    '.hb-ig-teaser__veil strong',
];
const VEIL_CTA_SELECTORS = ['.hb-ig-teaser__cta', '[data-hb-ig-connect]'];

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
                    const dir = materializePreviewSite(tpl, cfg);
                    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
                    const page = await context.newPage();
                    try {
                        await page.emulateMedia({ reducedMotion: 'reduce' });
                        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                        await page.waitForTimeout(200);

                        // Real reveal: click inside the section (the badge —
                        // definitely not the CTA) exactly like a visitor would,
                        // and let builder/edit-overlay.js's own click handler do
                        // the rest (adds .is-revealed to blur the grid, unhides
                        // .hb-ig-teaser__veil). See this file's header for why
                        // this is not reimplemented by hand.
                        const label0 = `${tpl} @ ${vp.width}px / ${theme.name}`;
                        const badge = page.locator('.hb-ig-teaser__badge').first();
                        if (await badge.count() === 0) {
                            report.push(`${label0}: no .hb-ig-teaser__badge to click — cannot reveal, skipping this combo`);
                            continue;
                        }
                        await badge.click();
                        const revealedOk = await page.evaluate(
                            () => !!document.querySelector('.hb-ig-teaser.is-revealed .hb-ig-teaser__veil:not([hidden])')
                        );
                        if (!revealedOk) {
                            failures.push(`${label0}: clicking .hb-ig-teaser__badge did not reveal the veil (no .is-revealed + un-hidden .hb-ig-teaser__veil found) — real customer interaction is broken, not just a contrast issue`);
                            continue;
                        }

                        // Re-validate the sibling "connect button under the blur
                        // could not actually be clicked" fix (blur made the grid
                        // a stacking context that painted over the veil; fixed
                        // with position:relative;z-index:1 on the veil). A trial
                        // click checks real Playwright actionability — visible,
                        // not covered by another element, receives pointer
                        // events — without actually triggering the postMessage.
                        // Done BEFORE the scroll-reset below since trial clicks also
                        // auto-scroll their target into view.
                        const ctaLocator = page.locator('[data-hb-ig-connect]').first();
                        if (await ctaLocator.count() > 0) {
                            try {
                                await ctaLocator.click({ trial: true, timeout: 2000 });
                            } catch (e) {
                                failures.push(`${label0}: [data-hb-ig-connect] CTA is not actually clickable once revealed (${e.message.split('\n')[0]}) — the blur/veil stacking-context bug may have regressed`);
                            }
                        }

                        // Both actions above (Playwright's click() and trial click())
                        // auto-scroll their target into view for actionability — on
                        // templates where the teaser sits mid-page this moves scrollY
                        // well away from 0. getBoundingClientRect() below (via
                        // prepareAndHideInk) is viewport-relative, but
                        // page.screenshot({fullPage:true}) always captures from the
                        // TOP of the document — sampling rect coordinates directly
                        // against that image after a scroll lands on whatever else is
                        // at that y-offset in the document, not the veil (this bit a
                        // first draft of this file: it measured a wildly wrong
                        // background — e.g. a pure, undiluted theme accent colour with
                        // no scrim blended in at all — that turned out to be an
                        // unrelated part of the page, not the veil). Reset scroll to
                        // the top so the two coordinate systems agree again; nothing
                        // above depends on scroll position to stay revealed.
                        await page.evaluate(() => window.scrollTo(0, 0));

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
