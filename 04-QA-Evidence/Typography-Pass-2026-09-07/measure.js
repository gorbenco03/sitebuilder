'use strict';
/**
 * Typography measurement harness for the typography pass (2026-09-07).
 *
 * Builds each template's static export via bot/site-export.js
 * buildStaticSiteTree (same path the CLS/touch-target oracles use), loads
 * index.html in Playwright Chromium at 1440x900 and 390x844, and for every
 * text-bearing element records computed font-family, font-size, line-height,
 * letter-spacing, container max-width/width, and observed characters-per-line
 * (derived from actual rendered box height / line-height, i.e. real wrap
 * count, not an estimate from font metrics).
 *
 * Run: node 04-QA-Evidence/Typography-Pass-2026-09-07/measure.mjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TEMPLATES = ['portfolio', 'local-service', 'product-menu', 'professionals', 'desserdirina'];
const VIEWPORTS = [
    { width: 1440, height: 900, label: 'desktop-1440' },
    { width: 390, height: 844, label: 'mobile-390' },
];

const OUT_DIR = __dirname;

function firstPresetConfig(tpl) {
    const p = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8'));
    return p.presets[0].config;
}

// In-page collector: walk the DOM, find elements whose OWN direct text
// (ignoring descendant elements) is non-trivial, and record computed style +
// geometry. Skips <script>/<style>/<noscript> and invisible elements.
const COLLECT_SCRIPT = () => {
    function directText(el) {
        let s = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) s += node.textContent;
        }
        return s.replace(/\s+/g, ' ').trim();
    }
    const results = [];
    const all = document.body.querySelectorAll('*');
    for (const el of all) {
        const tag = el.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'svg', 'path', 'template'].includes(tag)) continue;
        const text = directText(el);
        if (!text || text.length < 3) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (parseFloat(cs.opacity || '1') === 0) continue;
        const lineHeightPx = (() => {
            const lh = cs.lineHeight;
            if (lh === 'normal') return parseFloat(cs.fontSize) * 1.2;
            return parseFloat(lh);
        })();
        const lines = Math.max(1, Math.round(rect.height / lineHeightPx));
        const parent = el.parentElement;
        const parentCs = parent ? getComputedStyle(parent) : null;
        results.push({
            tag,
            className: (el.className && typeof el.className === 'string') ? el.className : '',
            text: text.slice(0, 80),
            textLength: text.length,
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontSizePx: parseFloat(cs.fontSize),
            lineHeight: cs.lineHeight,
            lineHeightPx,
            letterSpacing: cs.letterSpacing,
            maxWidth: cs.maxWidth,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            lines,
            charsPerLine: Math.round((text.length / lines) * 10) / 10,
            fontWeight: cs.fontWeight,
        });
    }
    return results;
};

async function main() {
    const browser = await chromium.launch({ headless: true });
    const allResults = {};
    try {
        for (const tpl of TEMPLATES) {
            allResults[tpl] = {};
            const cfg = firstPresetConfig(tpl);
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typo-'));
            try {
                siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
                const indexPath = path.join(dir, 'index.html');
                for (const vp of VIEWPORTS) {
                    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
                    await page.goto('file://' + indexPath, { waitUntil: 'networkidle' });
                    // dismiss consent so hero text below the fold measures naturally
                    try {
                        await page.evaluate(() => {
                            document.documentElement.classList.remove('hb-cookie-open');
                            const dock = document.querySelector('[data-consent-dock], .consent-dock, #cookie-consent');
                            if (dock) dock.remove();
                        });
                    } catch (_) {}
                    await page.waitForTimeout(200);
                    const rows = await page.evaluate(COLLECT_SCRIPT);
                    allResults[tpl][vp.label] = rows;
                    await page.close();
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
            console.error('measured', tpl);
        }
    } finally {
        await browser.close();
    }
    fs.writeFileSync(path.join(OUT_DIR, 'raw-measurements.json'), JSON.stringify(allResults, null, 2));
    console.error('wrote raw-measurements.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
