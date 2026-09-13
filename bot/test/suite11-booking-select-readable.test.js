'use strict';
/**
 * bot/test/suite11-booking-select-readable.test.js — Suite F
 * (PLAN-FEEDBACK-2026-09-13.md, punct 7).
 *
 * Owner report (with screenshot): on a professionals site with a dark
 * "book" section (cabinet-marin preset, near-black background), the
 * "Data"/"Ora" `<select>` controls read fine closed (light text on the dark
 * backdrop), but opening the native dropdown shows the option list as very
 * faint light-grey text on a white/light popup — almost invisible ("lun.,
 * 14 sept.", "mar., 15 sept." …), only the browser-highlighted option was
 * readable.
 *
 * Root cause: `<option>` elements were never styled of their own accord —
 * they simply inherited the CLOSED `<select>`'s `color` (light, set by
 * `.pr-sec--book .pr-input` for the dark backdrop) onto whatever surface
 * the browser paints the popup with, which several engines paint light by
 * default regardless of the page's own theme (see the fix's comment block
 * in templates/professionals/styles.css, right after `.pr-input:focus`).
 *
 * The only `<select>` in any published template's booking form is
 * `#pr-appt-date`/`#pr-appt-slot` in templates/professionals/template.html
 * (rendered when `appointment.nativeBooking` is falsy — the default for
 * every shipped preset). The other four templates never render a native
 * `<select>` for booking: portfolio's own fallback (when native booking is
 * off) is a plain WhatsApp link, and the native calendar widget itself
 * (bot/calendar-native/widget/public-booking-widget.js, used by portfolio
 * and professionals when native booking IS on) builds its day/slot chooser
 * out of `<button>` chips (`.hnb__day`/`.hnb__slot`), never a `<select>` —
 * confirmed by grepping every template.html and script.js under templates/
 * for `<select`/`createElement('select')`. So this suite exercises the one real
 * instance (professionals) plus, defensively, the owner dashboard's filter
 * selects (bot/calendar-native/owner/owner-dashboard.css), which share the
 * same shape of risk (a popup that can ignore the page's own light theme
 * under an OS dark-mode preference) even though today they always sit on an
 * explicit white background.
 *
 * NOTE on what this can and cannot prove: a native `<select>` popup is
 * drawn by the OS/browser outside the page's own paint pipeline — Playwright
 * (and every other automation driver) cannot open it and screenshot it
 * reliably across engines. This suite therefore checks the actual COMPUTED
 * STYLE of the `<option>` elements and the `<select>` itself (color,
 * background, color-scheme) rather than faking a popup capture. That is an
 * honest, if indirect, proxy: it is exactly the set of CSS values each
 * engine's popup renderer consults when it decides how to paint the option
 * text/surface it doesn't otherwise own.
 *
 * Run: node --experimental-sqlite --test bot/test/suite11-booking-select-readable.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '../..');
const { build } = require(path.join(ROOT, 'build.js'));

function loadPlaywright() {
    const candidates = ['playwright', path.join(ROOT, 'node_modules/playwright')];
    for (const cand of candidates) {
        try { return require(cand); } catch (_) {}
    }
    throw new Error('playwright not found — install devDependency (npm install in the repo root)');
}

// ---------------------------------------------------------------------------
// Colour math (WCAG contrast) — same technique as
// bot/test/suite7-portfolio-m9-pricelist-contrast.test.js: walk composited
// backgrounds and compare relative luminance, rather than trusting any one
// browser's own "is this readable" heuristics.
// ---------------------------------------------------------------------------
function relLum([r, g, b]) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastOf(a, b) {
    const l1 = relLum(a), l2 = relLum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}
function parseColor(str) {
    const m = /rgba?\(([^)]+)\)/.exec(String(str));
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
function composite(fg, bg) {
    const a = fg.a;
    return [fg.r * a + bg.r * (1 - a), fg.g * a + bg.g * (1 - a), fg.b * a + bg.b * (1 - a)];
}
async function bgLayersOf(locator) {
    return locator.evaluate((el) => {
        let node = el; const layers = [];
        while (node) { layers.push(getComputedStyle(node).backgroundColor); node = node.parentElement; }
        return layers;
    });
}
/** Contrast of `prop` (e.g. 'color') on `selector` against its real composited background. */
async function measure(page, selector, prop) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'attached', timeout: 5000 });
    const fgStr = await el.evaluate((n, p) => getComputedStyle(n)[p], prop);
    const bgLayers = (await bgLayersOf(el)).slice().reverse();
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const layerStr of bgLayers) {
        const c = parseColor(layerStr);
        if (c && c.a > 0) bg = { r: composite(c, bg)[0], g: composite(c, bg)[1], b: composite(c, bg)[2], a: 1 };
    }
    const fg = parseColor(fgStr);
    if (!fg) return null;
    const fgOpaque = composite(fg, bg);
    return contrastOf(fgOpaque, [bg.r, bg.g, bg.b]);
}

// ---------------------------------------------------------------------------
// Mirrors builder/app.js ~698-733 (hexToHsl / hslToHex / deriveColors) and
// ~3161 (COLOR_PRESETS) — the exact formula the builder's colour popover
// uses to turn one accent hex into theme.primaryLight/theme.primaryDark, so
// this suite can reproduce "every accent the builder actually offers"
// instead of only the 3 canned demo presets in presets.json.
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
function deriveColors(primaryHex) {
    const hsl = hexToHsl(primaryHex);
    return {
        primaryLight: hslToHex(hsl.h, Math.min(hsl.s + 5, 100), Math.min(hsl.l + 12, 95)),
        primaryDark: hslToHex(hsl.h, Math.min(hsl.s + 5, 100), Math.max(hsl.l - 12, 5)),
    };
}
// builder/app.js COLOR_PRESETS (~line 3161) — the 6 accents offered in the
// colour popover's preset row.
const COLOR_PRESETS = [
    { label: 'Indigo', hex: '#5B5BD6' },
    { label: 'Turcoaz', hex: '#0D9488' },
    { label: 'Violet', hex: '#7C3AED' },
    { label: 'Portocaliu', hex: '#EA580C' },
    { label: 'Roz', hex: '#DB2777' },
    { label: 'Verde', hex: '#16A34A' },
];

// ---------------------------------------------------------------------------
// Site materialization — same shape as bot/test/wave10-portfolio-helpers.js,
// inlined here (single-file deliverable) since this suite only ever builds
// the CURRENT working tree (no before/after git-ref harness needed — the
// red/green proof for this fix is a plain CSS-only revert, reported
// alongside the test run rather than baked into the oracle).
// ---------------------------------------------------------------------------
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'professionals');
const STATIC_FILES = ['template.html', 'styles.css', 'script.js', 'qrcode.js'];

function buildProfessionalsSite(configOverrides) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite11-professionals-'));
    for (const name of STATIC_FILES) {
        fs.copyFileSync(path.join(TEMPLATE_DIR, name), path.join(dir, name));
    }
    const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'presets.json'), 'utf8')).presets;
    const config = JSON.parse(JSON.stringify(presets[0].config)); // cabinet-marin — the owner's own preset
    for (const [key, val] of Object.entries(configOverrides || {})) {
        config.theme = config.theme || {};
        config.theme[key] = val;
    }
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
    build(dir);
    return dir;
}

function serveDir(dir) {
    const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    const server = http.createServer((req, res) => {
        try {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            const rel = urlPath === '/' ? '/index.html' : urlPath;
            const full = path.join(dir, rel);
            if (!full.startsWith(dir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
                res.writeHead(404); res.end('not found: ' + rel); return;
            }
            const ext = path.extname(full).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            fs.createReadStream(full).pipe(res);
        } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({ server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const THEMES = [
    { label: 'cabinet-marin shipped preset (the owner\'s own site)', theme: null },
    ...COLOR_PRESETS.map((p) => ({
        label: `builder accent preset — ${p.label}`,
        theme: { primary: p.hex, ...deriveColors(p.hex) },
    })),
];

test('professionals booking form: Data/Ora <select> options are dark-on-light on every accent', async () => {
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    try {
        for (const { label, theme } of THEMES) {
            const dir = buildProfessionalsSite(theme);
            const { base, close } = await serveDir(dir);
            try {
                const page = await browser.newPage();
                await page.goto(base + '/');
                // script.js populates #pr-appt-date/#pr-appt-slot on load from the
                // real weekly-hours config (cabinet-marin: Mon-Fri 09:00-17:00ish),
                // same as a real visitor's browser.
                await page.waitForFunction(() => {
                    const d = document.getElementById('pr-appt-date');
                    return d && d.options.length > 0 && d.options[0].value;
                }, { timeout: 5000 });

                for (const sel of ['#pr-appt-date', '#pr-appt-slot']) {
                    const optionText = await page.locator(sel + ' option').first().textContent();
                    assert.ok(optionText && optionText.trim() && optionText.trim() !== '—',
                        `${label} / ${sel}: expected a real populated option (e.g. "lun., 14 sept."), got ${JSON.stringify(optionText)}`);

                    // 1) The opened popup: <option> colour vs its own (opaque) background.
                    const optionContrast = await measure(page, sel + ' option', 'color');
                    assert.ok(optionContrast >= 4.5,
                        `${label} / ${sel} option: contrast ${optionContrast} < 4.5:1 (option text vs option background)`);

                    // 2) The closed control itself must still read correctly on the
                    //    dark "book" backdrop (rule: don't regress the closed look).
                    const closedContrast = await measure(page, sel, 'color');
                    assert.ok(closedContrast >= 4.5,
                        `${label} / ${sel}: closed-select contrast ${closedContrast} < 4.5:1`);

                    // 3) color-scheme must be pinned to light, so the popup itself
                    //    (surface/scrollbar/highlight the author doesn't otherwise
                    //    style) doesn't fall back to a dark OS/browser default.
                    const colorScheme = await page.locator(sel).first().evaluate((n) => getComputedStyle(n).colorScheme);
                    assert.equal(colorScheme, 'light',
                        `${label} / ${sel}: color-scheme should be "light", got ${JSON.stringify(colorScheme)}`);
                }

                // 4) Disabled options: no real flow produces one today (script.js
                //    never sets `.disabled`), so inject one directly to test the
                //    CSS rule honestly rather than skip it.
                const disabledResult = await page.evaluate(() => {
                    const sel = document.getElementById('pr-appt-date');
                    const opt = document.createElement('option');
                    opt.value = 'x'; opt.textContent = 'indisponibil'; opt.disabled = true;
                    sel.appendChild(opt);
                    const cs = getComputedStyle(opt);
                    return { color: cs.color, background: cs.backgroundColor };
                });
                const dFg = parseColor(disabledResult.color);
                // A bare option's own backgroundColor can resolve as fully
                // transparent (browsers often report `rgba(0,0,0,0)` for
                // `<option>` even when an ancestor/UA supplies the actual
                // paint surface) — composite over white (the popup surface
                // `color-scheme: light` asks for) rather than assume the
                // parsed value is already opaque.
                const dBgRaw = parseColor(disabledResult.background) || { r: 255, g: 255, b: 255, a: 0 };
                const dBg = composite(dBgRaw, { r: 255, g: 255, b: 255 });
                assert.ok(dFg, `${label}: could not read disabled option colour`);
                const dContrast = contrastOf(composite(dFg, { r: dBg[0], g: dBg[1], b: dBg[2] }), dBg);
                assert.ok(dContrast >= 4.5,
                    `${label}: disabled option contrast ${dContrast} < 4.5:1 (must still be legible)`);
                // And visibly distinct from a regular (enabled) option, so it still
                // reads as "disabled" rather than identical to every other row.
                const enabledColor = await page.locator('#pr-appt-date option:not([disabled])').first()
                    .evaluate((n) => getComputedStyle(n).color);
                assert.notEqual(disabledResult.color, enabledColor,
                    `${label}: disabled option must look visibly different from an enabled one`);
            } finally {
                await close();
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    } finally {
        await browser.close();
    }
});

test('owner dashboard filter <select>s: options are dark-on-light and color-scheme is pinned', async () => {
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite11-owner-dashboard-'));
    try {
        const OWNER_DIR = path.join(ROOT, 'bot', 'calendar-native', 'owner');
        for (const name of fs.readdirSync(OWNER_DIR)) {
            const from = path.join(OWNER_DIR, name);
            if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, name));
        }
        // Minimal host page: exercises the same CSS the real dashboard loads,
        // without needing the full owner-api backend running.
        fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head>
<link rel="stylesheet" href="owner-dashboard.css"></head>
<body class="hod">
<div class="hod-filters">
  <select data-hod-status aria-label="Status">
    <option value="">Toate</option>
    <option value="confirmed">Confirmată</option>
    <option value="x" disabled>Indisponibil</option>
  </select>
</div>
</body></html>`);
        const { base, close } = await serveDir(dir);
        try {
            const page = await browser.newPage();
            await page.goto(base + '/');
            const optionContrast = await measure(page, 'select option:not([disabled])', 'color');
            assert.ok(optionContrast >= 4.5, `owner dashboard select option: contrast ${optionContrast} < 4.5:1`);
            const colorScheme = await page.locator('select').first().evaluate((n) => getComputedStyle(n).colorScheme);
            assert.equal(colorScheme, 'light', `owner dashboard select: color-scheme should be "light", got ${JSON.stringify(colorScheme)}`);
        } finally {
            await close();
        }
    } finally {
        await browser.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
