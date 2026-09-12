'use strict';
/**
 * bot/test/suite7-template-contract.test.js
 *
 * PLAN-QA-2026-09-12 §"Suita 7" — S7-0, the ONE oracle shared by all five
 * agents working the design-consistency wave (one agent per template). Every
 * property below is measured on the actually rendered, published page
 * (`buildStaticSiteTree`, the same function `bot/webpublish.js` calls for a
 * real `/live/<slug>/` site) — never deduced from reading the CSS source.
 *
 * Written by S7-1 (local-service). Per S7-CONTRACT.md: whoever gets here
 * first writes it; the other four use it as-is and only fix what is red on
 * their own template. If you are extending this file for your template,
 * only ADD to the per-template tables below (TEXT_CASES / BORDER_CASES) —
 * do not change the measurement methodology without re-checking every
 * template that already relies on it.
 *
 * Method notes (why each check is built the way it is):
 *
 *  - Contrast (#1) samples a REAL pixel from a full-page screenshot, not
 *    getComputedStyle() background — the only way to see through a photo,
 *    gradient, backdrop-filter, or a themed accent behind translucent text.
 *    S8-A (2026-09-12) found the "sample near the text but not on it" guess
 *    this used to rely on still landed ON the glyphs for a common, ordinary
 *    shape: a short pill CTA whose label fills most of the button (padding
 *    much smaller than the fraction-of-width the old sample points assumed),
 *    and for display headings whose glyph strokes are wide relative to their
 *    line box. That produced literal white-on-white/self-vs-self readings —
 *    `.hero-cta` and `.pm-hero__cta--fill` "failing" at 1:1 against their own
 *    label, `.pf-price__row` borders reading against themselves — which is
 *    not a threshold problem, it is sampling the wrong pixel. The fix is not
 *    a smarter guess about where the glyphs AREN'T, it's removing the glyphs
 *    from the question entirely: every matched text element gets a
 *    `color:transparent` (+ `text-shadow:none`) override applied BEFORE the
 *    one full-page screenshot is taken, then removed right after — same
 *    principle `waveB-hero-contrast-any-photo.test.js` already uses
 *    (`visibility:hidden` + re-screenshot), adapted to run once for every
 *    matched element instead of once per element, so the whole contract still
 *    costs one screenshot per page load. With the ink gone, sampling is no
 *    longer a guessing game:
 *      - An element with its OWN opaque fill (a button/pill) is sampled on a
 *        small grid across its VERTICAL-CENTER row, inset from the edges —
 *        the vertical-center row is flat for any border-radius (including a
 *        999px pill), so it can never land on the rounded-corner blend
 *        either. Since the label is invisible for this screenshot, every
 *        point on that row is the button's real fill.
 *      - An element with NO own fill (plain text on a section/photo/gradient
 *        background) is sampled on a grid INSIDE its own former glyph box —
 *        exactly where the letters were — which is strictly more accurate
 *        than sampling beside the text (a gradient or photo can vary within
 *        a few px) and needs no special-casing for what sits above/below.
 *  - Border/divider contrast (#2) has the same "expected pixel, wrong pixel"
 *    failure mode for a different reason: a border on a box with a
 *    non-integer height (common with rem/flex sizing) can paint one device
 *    pixel off from `getBoundingClientRect()`'s reported edge — confirmed by
 *    sampling a vertical window around `.pf-price__row`'s border, where the
 *    ink was consistently 1px above the naive `bottom - borderWidth/2`
 *    computation on some rows and exactly on it on others, an off-by-one that
 *    tracks the sub-pixel remainder, not anything about the border itself.
 *    The fix: search a small window of candidate rows (and a few x positions,
 *    in case a sibling element interrupts the line at one spot) around the
 *    expected edge and keep whichever candidate has the strongest contrast
 *    against a background sample taken safely inside the box (away from any
 *    edge) — that is the actual ink wherever the renderer put it, not a
 *    manufactured pass: a genuinely low-contrast border still measures low
 *    contrast, because none of the candidates near it would differ from the
 *    background either.
 *  - `prefers-reduced-motion: reduce` is emulated on every page load. All 5
 *    templates already ship a `@media (prefers-reduced-motion: reduce)` rule
 *    that forces `.fade-in-section` (and friends) to their final
 *    opacity:1/transform:none state — see e.g.
 *    `templates/local-service/styles.css`'s block of the same name. Without
 *    this, most of the page is still sitting at `opacity:0` at screenshot
 *    time (their IntersectionObserver only fires content into view on
 *    scroll), which is exactly the "don't measure mid-animation" trap the
 *    plan calls out.
 *  - The 2 "saturated palette" themes are NOT arbitrary hex picks. They are
 *    2 of the 6 swatches builder/app.js's `COLOR_PRESETS` actually offers in
 *    the colour-picker popover (Portocaliu / Roz), run through the exact
 *    same `hexToHsl`/`hslToHex`/`deriveColors` formula `applyThemeColor()`
 *    uses — so this reproduces exactly what an owner can produce by clicking
 *    a preset dot, not a hypothetical. `theme.cream` (the page BACKGROUND)
 *    is a separate control in that same popover (`applyThemeBackground`) —
 *    it is not part of the 6-swatch accent palette, so it is left at each
 *    template's own default here. (The portfolio orange-BACKGROUND
 *    regression from the QA explore report — D1/M9 — is a deliberately
 *    targeted scenario covered by that template's own oracle, not this
 *    generic contract; body text itself is already styled ink-on-paper
 *    everywhere, so a background chosen so dark/saturated that it broke would
 *    break far more than this suite's scope.)
 *
 * KNOWN_RED (below) lists, per contract instructions, every template this
 * file currently expects to still be failing, with the reason and the S7
 * sub-task that owns the fix. A template NOT in KNOWN_RED must be fully
 * green — this run enforces that today for local-service (S7-1). As each
 * teammate lands their fix, they delete their own entry; the day all five
 * are gone, S7 acceptance ("verde pe 5/5 x 3 lățimi x 3 teme") is met.
 *
 * Run: node --experimental-sqlite --test bot/test/suite7-template-contract.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const WIDTHS = [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
];

// ---------------------------------------------------------------------------
// Theme palette — ported 1:1 from builder/app.js (hexToHsl/hslToHex/
// deriveColors), so "2 saturated colours from the palette" means exactly
// what an owner sees in the colour-picker popover, not an invented pair.
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

const TEMPLATES = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

// Per contract §"Raportează pe fiecare eșec": templates NOT listed here must
// be fully green. A template listed here still RUNS every check and prints
// every failure (console.warn), it just does not fail this test — remove
// the entry once your sub-task lands. Every entry names what is broken and
// who owns it. An entry with no owner is just a failing test with the alarm
// switched off, so there must never be one.
//
// KNOWN_RED is per template + property, not per template: everything NOT
// listed here is enforced on all five today.
//
// This contract is deliberately stricter than the five per-template S7
// fixes: it re-renders each template under colours the OWNER can actually
// pick from the theme popover, not just the shipped preset. Doing that
// surfaced one systemic defect and one methodology gap, both since fixed —
// S8-A (2026-09-12) cleared every entry that used to live here:
//   - portfolio / product-menu were both measurement artifacts (the old
//     sampler landing on the label glyph of a short pill CTA and reading
//     white-on-white, and .pf-price__row's border sampled 1 device pixel
//     off its true edge) — see the method notes above. Fixed the sampler,
//     both templates are genuinely green, nothing was suppressed.
//   - professionals had two real defects: appointment-section copy read as
//     low as 2.4:1 on a saturated accent because .pr-sec--book's backdrop
//     aliased the owner-adjustable --color-primary-dark instead of a
//     guaranteed-dark neutral (fixed with --pr-book-bg, set pre-paint from
//     a fixed 40%-toward-black mix — template.html/styles.css), and the
//     footer's second unaligned pair was bot/site-legal.js's shared
//     `.hb-legal-links { margin-top: 0.65rem }` (meant for a stacked
//     context) leaking into this template's flex footer row (cancelled
//     locally with a more specific selector, shared file untouched).
// A template NOT listed here must be fully green — today that is 5/5.
const KNOWN_RED = {};

// ---------------------------------------------------------------------------
// Per-template selector tables.
//
// TEXT_CASES: one selector per distinct text style/surface the template
// uses (not literally "every DOM node" — this repo's existing contrast
// oracles, e.g. wave9/wave10, use the same curated-representative-selector
// approach; a full node-by-node scan would also flag countless
// zero-visible-text/icon-only elements this project doesn't intend to gate).
// local-service's table is complete (that is this task's job). The other
// four are a solid starting set built from each template's own class names,
// not exhaustive — extend them in your own S7-N task per the note at the
// top of this file.
// ---------------------------------------------------------------------------
const TEXT_CASES = {
    'local-service': [
        '.ls-util__phone', '.ls-util__zone', '.ls-util__cta',
        '.ls-hero__name', '.ls-hero__tag',
        '.ls-meter__n', '.ls-meter__l',
        '.ls-eyebrow', '.ls-h', '.ls-text',
        '.ls-badge', '.ls-badge strong', '.ls-zone', '.ls-cert',
        '.contact-item span',
        '.ls-punch__label',
        '.ls-flow__n', '.ls-flow__t',
        '.ls-trust__t',
        '.ls-work__t', '.ls-shot__cap',
        '.ls-ighead__h',
        '.ls-btn--phone', '.ls-btn--fill', '.ls-btn--ghost',
        '.ls-dock__call',
        '.hb-built-by', '.hb-built-by a', '.hb-legal-links a',
        '.ls-foot__inner p',
    ],
    'product-menu': [
        '.pm-kicker', '.pm-title', '.pm-meta',
        '.pm-hero__cta--fill', '.pm-hero__cta--ghost',
        '.pm-foot__addr', '.hb-built-by', '.hb-built-by a', '.hb-legal-links a',
    ],
    'portfolio': [
        '.pf-kicker', '.pf-display', '.pf-hero__word', '.pf-hero__tag',
        '.pf-copy', '.pf-price__name', '.pf-price__val', '.pf-chip__price',
        '.hero-cta', '.hb-built-by', '.hb-built-by a', '.hb-legal-links a',
    ],
    'professionals': [
        '.pr-kicker', '.pr-display', '.pr-lede', '.pr-copy',
        '.pr-cred__title', '.pr-svc__title', '.pr-steps__title', '.pr-type__meta',
        '.pr-foot__name', '.hb-built-by', '.hb-built-by a', '.hb-legal-links a',
    ],
    'desserdirina': [
        '.hero-wordmark', '.hero-tagline', '.section-eyebrow', '.section-title',
        '.services-title', '.category-title', '.footer-address',
        '.hb-built-by', '.hb-built-by a', '.hb-legal-links a',
    ],
};

// BORDER_CASES: selectors whose border/divider carries information (WCAG
// 1.4.11), not pure decoration — see the plan's example, the dotted divider
// between a service's name and its price in portfolio. Left empty for a
// template means "none of its cards/rows are decision-relevant dividers",
// a judgement call — see local-service's note in the impl report.
const BORDER_CASES = {
    'local-service': [],
    'product-menu': [],
    'portfolio': ['.pf-price__row'],
    'professionals': [],
    'desserdirina': [],
};

function buildThemedConfig(basePreset, theme) {
    const cfg = JSON.parse(JSON.stringify(basePreset));
    if (theme.accent) {
        cfg.theme = Object.assign({}, cfg.theme, theme.accent);
    }
    return cfg;
}

// ---------------------------------------------------------------------------
// In-page measurement — one screenshot + a handful of evaluate() calls per
// page load. Text contrast is measured in three passes so the glyphs
// themselves are never in the picture the sampler reads:
//   1. prepareAndHideInk  — BEFORE the screenshot: record each candidate
//      element's colour/rect/font metadata, then paint its own text
//      transparent (a scoped class, not inline style, so restoring is exact).
//   2. (page.screenshot)  — the one full-page capture, now ink-free.
//   3. restoreInk         — put the glyphs back immediately.
//   4. computeChecks      — decode the screenshot and do every measurement:
//      text contrast (against prepared metadata), border contrast, footer
//      alignment, social icons, cookie overlap.
// ---------------------------------------------------------------------------
async function prepareAndHideInk(page, textSelectors) {
    return page.evaluate((textSelectors) => {
        if (!document.getElementById('hb-s8a-style')) {
            const style = document.createElement('style');
            style.id = 'hb-s8a-style';
            // text-shadow:none too — a couple of hero headings use a soft
            // glow behind the glyphs (see e.g. desserdirina's .hero-wordmark)
            // which color:transparent alone would leave behind, painting a
            // faint halo where the ink used to be instead of pure backdrop.
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
                // A parent like `.hb-built-by` ("Build by <a>hidook.tech</a>
                // powered by <a>hidook.agency</a>") reports ITS OWN colour
                // via getComputedStyle, but its bounding box also contains
                // two child <a> runs with their own colour/underline. Prefer
                // the element's OWN first direct text node's rect (skips
                // element children entirely) when it has one; only fall
                // back to the whole element's box when there is no text
                // directly inside it (e.g. the element IS the link/button).
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

async function computeChecks(page, imgB64, prepared, borderSelectors) {
    return page.evaluate(async ({ imgB64, prepared, borderSelectors }) => {
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
        // A declared colour with alpha < 1 (e.g. this repo's very common
        // `rgba(ink, 0.5)` "muted text" convention) does NOT render as its
        // own raw RGB — it renders as itself blended OVER whatever is behind
        // it. Comparing the raw undiluted RGB against the sampled background
        // silently overstates contrast for every translucent colour (an
        // earlier version of this file did exactly that and produced false
        // negatives across the board — verified against the QA explore
        // report's own hand-measured 3.33:1 for local-service's footer
        // credit, which the raw-RGB version could not reproduce at all).
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
        // The glyphs are gone by the time this runs (prepareAndHideInk
        // painted them transparent before the screenshot), so this grid no
        // longer has to dodge ink — it only has to survive anti-aliasing at
        // a rounded corner or a translucent-panel seam. Kept as a grid+vote
        // (not a single point) for that residual edge-blend safety margin.
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

        const results = {
            scrollOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            textFailures: [],
            borderFailures: [],
            footerRowFailures: [],
            socialIconFailures: [],
            cookieOverlap: null,
        };

        // #1 text contrast — ink already hidden for this screenshot.
        for (const item of prepared) {
            const fg = parseRgb(item.fg);
            if (!fg || fg.a === 0) continue;
            const bgOwn = parseRgb(item.bgOwn);
            const r = item.rect, tr = item.tr;
            let bg;
            if (bgOwn && bgOwn.a > 0.05) {
                // Own opaque fill (button/pill/badge) — vertical-center row,
                // inset from the left/right edges, which for ANY
                // border-radius (including a full pill) is always outside
                // the curve.
                const xs = [0.15, 0.3, 0.5, 0.7, 0.85].map((f) => r.left + r.width * f);
                bg = dominantColor(xs, [r.top + r.height / 2]);
            } else {
                // Plain text with no fill of its own — sample INSIDE its own
                // former glyph box (a grid of x/y fractions across exactly
                // where the letters were), the real backdrop the reader sees
                // behind that text, not a nearby guess.
                const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => tr.left + tr.width * f);
                const ys = [0.2, 0.5, 0.8].map((f) => tr.top + tr.height * f);
                bg = dominantColor(xs, ys);
            }
            const rt = ratio(composite(fg, bg), bg);
            const fontPx = item.fontPx, weight = item.weight;
            const isLarge = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
            const bar = isLarge ? 3.0 : 4.5;
            if (rt < bar) {
                results.textFailures.push({
                    selector: item.sel, index: item.idx, text: item.text,
                    ratio: Math.round(rt * 100) / 100, bar,
                    fontPx: Math.round(fontPx), weight,
                    fg: [Math.round(fg.r), Math.round(fg.g), Math.round(fg.b)], bg,
                });
            }
        }

        // #2 informational border/divider contrast. A 1px border on a box
        // with a non-integer height/position can paint one device pixel off
        // from getBoundingClientRect()'s edge (confirmed on portfolio's
        // .pf-price__row: the ink sat consistently 1px above the naive
        // `bottom - borderWidth/2` pixel on some rows, exactly on it on
        // others — an off-by-one tracking the sub-pixel remainder, not the
        // border itself). Search a small window of candidate rows (and a
        // few x offsets, in case a sibling interrupts the line at one spot)
        // and keep whichever candidate contrasts most against a background
        // sample taken safely inside the box. A genuinely low-contrast
        // border still measures low: nothing in that window would differ
        // from the background either.
        for (const sel of borderSelectors) {
            let els;
            try { els = document.querySelectorAll(sel); } catch (e) { continue; }
            els.forEach((el, idx) => {
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) return;
                const cs = getComputedStyle(el);
                const bw = parseFloat(cs.borderBottomWidth) || 0;
                if (bw < 1) return;
                const borderColor = parseRgb(cs.borderBottomColor);
                if (!borderColor) return;
                const xs = [0.2, 0.5, 0.8].map((f) => r.left + r.width * f);
                const adjacentY = Math.min(r.bottom - 2, r.top + Math.max(4, r.height * 0.3));
                const adjacent = dominantColor(xs, [adjacentY]);
                let borderPixel = null, bestRatio = -1;
                for (let dy = -3; dy <= 1; dy++) {
                    const y = r.bottom - bw / 2 + dy;
                    for (const x of xs) {
                        const c = samplePixel(x, y);
                        const rt = ratio(c, adjacent);
                        if (rt > bestRatio) { bestRatio = rt; borderPixel = c; }
                    }
                }
                if (bestRatio < 3.0) {
                    results.borderFailures.push({
                        selector: sel, index: idx,
                        ratio: Math.round(bestRatio * 100) / 100,
                        border: borderPixel, adjacent,
                    });
                }
            });
        }

        // #3 same visual footer row aligned within ±2px
        const footerRoot = document.querySelector('footer');
        if (footerRoot) {
            const wrap = footerRoot.querySelector(':scope > div') || footerRoot;
            const children = [...wrap.children].filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
            });
            for (let i = 0; i < children.length; i++) {
                for (let j = i + 1; j < children.length; j++) {
                    const a = children[i].getBoundingClientRect();
                    const b = children[j].getBoundingClientRect();
                    const sameRow = a.top < b.bottom && b.top < a.bottom;
                    if (!sameRow) continue;
                    // A flex row legitimately uses align-items:center (or
                    // flex-end) to line up siblings of very different
                    // heights — e.g. a 4-line address/legal-links column
                    // next to a single row of round social icons — and
                    // "different top" there is centering working correctly,
                    // not a bug. Only hold near-equal-height siblings (this
                    // repo's real bug, professionals' D5: two single-line
                    // text nodes with a ~10px unwanted gap) to the ±2px bar.
                    if (Math.abs(a.height - b.height) > 8) continue;
                    // Compare where the TEXT sits, not where the box starts.
                    // A flex row with align-items:stretch grows a child's box
                    // without moving its glyphs, so box tops disagree by the
                    // padding while the reader sees one clean line — and the
                    // reverse hides a real 10px drop behind identical tops.
                    // That trap is why professionals' footer gap went unseen
                    // until someone measured with a Range (see s72's report).
                    const inkTop = (el) => {
                        const range = document.createRange();
                        range.selectNodeContents(el);
                        const ink = range.getBoundingClientRect();
                        range.detach && range.detach();
                        return ink.height > 0 ? ink.top : el.getBoundingClientRect().top;
                    };
                    const aInk = inkTop(children[i]);
                    const bInk = inkTop(children[j]);
                    const diff = Math.abs(aInk - bInk);
                    if (diff > 2) {
                        results.footerRowFailures.push({
                            a: children[i].className || children[i].tagName,
                            b: children[j].className || children[j].tagName,
                            aTop: Math.round(aInk * 100) / 100,
                            bTop: Math.round(bInk * 100) / 100,
                            diff: Math.round(diff * 100) / 100,
                        });
                    }
                }
            }
        }

        // #4 social links show an icon, not a text abbreviation like "IG"/"FB".
        // An icon counts whether it is an inline <svg> or an SVG delivered as a
        // background-image (data: URI or .svg file) — the latter is the pattern
        // already established in this codebase and the one the templates ported,
        // so demanding inline <svg> would fail working icons. What is actually
        // being rejected is a link whose visible content is a word.
        const socialLinks = document.querySelectorAll('a[aria-label="Instagram"], a[aria-label="Facebook"]');
        socialLinks.forEach((a) => {
            if (a.querySelector('svg')) return;
            const bgOf = (el) => {
                const b = getComputedStyle(el).backgroundImage || '';
                return /svg|data:image/i.test(b) && b !== 'none';
            };
            const beforeOf = (el) => {
                for (const pseudo of ['::before', '::after']) {
                    const cs = getComputedStyle(el, pseudo);
                    const b = cs.backgroundImage || '';
                    if (/svg|data:image/i.test(b) && b !== 'none') return true;
                    const m = cs.mask || cs.webkitMaskImage || '';
                    if (/svg|data:image/i.test(m)) return true;
                }
                return false;
            };
            let hasIcon = bgOf(a) || beforeOf(a);
            if (!hasIcon) {
                a.querySelectorAll('*').forEach((el) => {
                    if (hasIcon) return;
                    if (bgOf(el) || beforeOf(el)) hasIcon = true;
                });
            }
            if (hasIcon) return;
            results.socialIconFailures.push({
                label: a.getAttribute('aria-label'),
                text: (a.textContent || '').trim(),
            });
        });

        // #5 cookie banner (pre-accept) must not cover a footer link/button
        const banner = document.getElementById('hb-cookie-banner');
        if (banner && footerRoot) {
            const bcs = getComputedStyle(banner);
            const visible = !banner.hidden && bcs.display !== 'none' && bcs.visibility !== 'hidden';
            if (visible) {
                const br = banner.getBoundingClientRect();
                if (br.width > 0 && br.height > 0) {
                    const hits = [];
                    footerRoot.querySelectorAll('a, button').forEach((el) => {
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0) return;
                        const overlap = br.left < r.right && r.left < br.right && br.top < r.bottom && r.top < br.bottom;
                        if (overlap) hits.push((el.textContent || '').trim() || el.getAttribute('aria-label') || el.tagName);
                    });
                    if (hits.length) results.cookieOverlap = hits;
                }
            }
        }

        return results;
    }, { imgB64, prepared, borderSelectors });
}

async function testOneCombo(browser, tpl, cfg, vp) {
    const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const requestFailures = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
    page.on('requestfailed', (req) => {
        // file:// pages legitimately "fail" any request they never intend to
        // make (e.g. an empty Instagram embed src is guarded by @if and
        // never renders an iframe at all) — only flag failures for a real,
        // non-empty URL the page actually tried to load.
        const url = req.url();
        if (url && url !== 'about:blank' && !url.startsWith('file://' + '#')) {
            requestFailures.push(url + ' — ' + (req.failure() && req.failure().errorText));
        }
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite7-' + tpl + '-'));
    let result;
    try {
        siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(200);

        const prepared = await prepareAndHideInk(page, TEXT_CASES[tpl] || []);
        const shot = await page.screenshot({ fullPage: true });
        await restoreInk(page);
        const checks = await computeChecks(page, shot.toString('base64'), prepared, BORDER_CASES[tpl] || []);
        result = { checks, consoleErrors, pageErrors, requestFailures };
    } finally {
        await context.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return result;
}

test('suite7 template contract: contrast, footer alignment, social icons, cookie overlap, scroll, console — 5 templates x 3 widths x 3 themes', async () => {
    const browser = await chromium.launch({ headless: true });
    const hardFailures = [];
    const softFailures = [];
    const report = [];

    try {
        for (const tpl of TEMPLATES) {
            const basePreset = JSON.parse(
                fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')
            ).presets[0].config;

            for (const theme of THEMES) {
                const cfg = buildThemedConfig(basePreset, theme);
                for (const vp of WIDTHS) {
                    const { checks, consoleErrors, pageErrors, requestFailures } = await testOneCombo(browser, tpl, cfg, vp);
                    const label = `${tpl} @ ${vp.width}px / ${theme.name}`;
                    const msgs = [];

                    for (const f of checks.textFailures) {
                        msgs.push(
                            `text contrast ${f.selector}[${f.index}] "${f.text}": ${f.ratio}:1 ` +
                            `(need ${f.bar}:1, ${f.fontPx}px/${f.weight}) fg=rgb(${f.fg.join(',')}) bg=rgb(${f.bg.join(',')})`
                        );
                    }
                    for (const f of checks.borderFailures) {
                        msgs.push(
                            `border contrast ${f.selector}[${f.index}]: ${f.ratio}:1 (need 3:1) ` +
                            `border=rgb(${f.border.join(',')}) adjacent=rgb(${f.adjacent.join(',')})`
                        );
                    }
                    for (const f of checks.footerRowFailures) {
                        msgs.push(`footer row misaligned: "${f.a}" top=${f.aTop} vs "${f.b}" top=${f.bTop} (diff ${f.diff}px, >2px)`);
                    }
                    for (const f of checks.socialIconFailures) {
                        msgs.push(`social link "${f.label}" is not an SVG icon (text="${f.text}")`);
                    }
                    if (checks.cookieOverlap) {
                        msgs.push(`cookie banner overlaps footer element(s): ${checks.cookieOverlap.join(', ')}`);
                    }
                    if (checks.scrollOverflow) {
                        msgs.push('horizontal scroll: documentElement.scrollWidth > clientWidth');
                    }
                    if (consoleErrors.length) msgs.push('console errors: ' + consoleErrors.join(' | '));
                    if (pageErrors.length) msgs.push('page errors: ' + pageErrors.join(' | '));
                    if (requestFailures.length) msgs.push('request failures: ' + requestFailures.join(' | '));

                    if (msgs.length) {
                        report.push(`${label}:\n  - ` + msgs.join('\n  - '));
                        const bucket = KNOWN_RED[tpl] ? softFailures : hardFailures;
                        for (const m of msgs) bucket.push(`${label}: ${m}`);
                    }
                }
            }
        }
    } finally {
        await browser.close();
    }

    if (report.length) console.log('\n' + report.join('\n\n') + '\n');
    if (softFailures.length) {
        console.warn(
            `\n${softFailures.length} known-red failure(s) on templates not yet fixed by suite7 (non-fatal — see KNOWN_RED):`
        );
        for (const [tpl, reason] of Object.entries(KNOWN_RED)) {
            console.warn(`  - ${tpl}: ${reason}`);
        }
    }

    assert.deepEqual(hardFailures, [], 'suite7 template contract failures on a template expected to be green:\n' + hardFailures.join('\n'));
});
