'use strict';
/**
 * Fallback-font metric comparison for the serif stack used by
 * professionals + portfolio: `Iowan Old Style, Palatino Linotype, Palatino,
 * Georgia, serif`.
 *
 * Iowan Old Style ships only on macOS. Palatino Linotype ships only on
 * Windows. Palatino (no "Linotype") ships on macOS. Georgia ships on macOS
 * and Windows but not stock Android/Linux. So depending on OS, a visitor
 * actually lands on a DIFFERENT one of these five names:
 *   macOS visitor    -> Iowan Old Style (1st, installed)
 *   Windows visitor  -> Palatino Linotype (2nd; Iowan Old Style absent)
 *   Android/Linux    -> generic `serif` (none of the 4 named faces exist)
 *
 * This machine is a Mac, so we can only actually RENDER Iowan Old Style,
 * Palatino (proxy for "Palatino Linotype" - same Zapf design, Linotype's own
 * digitization is metrically near-identical) and Georgia. We measure real
 * rendered width/line-count differences between those three directly, and
 * report the generic `serif` case by inspecting which face the browser
 * resolves it to on this system (informational only - it is not what an
 * Android/Linux visitor would see).
 *
 * Run: node 04-QA-Evidence/Typography-Pass-2026-09-07/fallback-metrics.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');
const FONTS = ['Iowan Old Style', 'Palatino', 'Georgia', 'serif'];

const CASES = [
    { tpl: 'portfolio', selector: '.pf-copy', width: 576 },
    { tpl: 'professionals', selector: '.pr-copy', width: 608 },
];

function firstPresetConfig(tpl) {
    const p = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8'));
    return p.presets[0].config;
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const { tpl, selector, width } of CASES) {
            const cfg = firstPresetConfig(tpl);
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-'));
            siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
            const indexPath = path.join(dir, 'index.html');
            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            await page.goto('file://' + indexPath, { waitUntil: 'networkidle' });
            console.log('\n===', tpl, selector, '===');
            for (const font of FONTS) {
                const result = await page.evaluate(({ selector, font }) => {
                    const els = Array.from(document.querySelectorAll(selector))
                        .filter((el) => el.textContent.trim().length > 60);
                    if (!els.length) return null;
                    const el = els[0];
                    const prevFamily = el.style.fontFamily;
                    el.style.fontFamily = font;
                    const cs = getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    const resolvedFamily = cs.fontFamily;
                    // canvas measureText to get exact resolved-font glyph metrics
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${font}`;
                    const sample = 'Atelier Ivoire este un studio mic din București';
                    const m = ctx.measureText(sample);
                    el.style.fontFamily = prevFamily;
                    const lineHeightPx = parseFloat(cs.lineHeight);
                    const lines = Math.round(rect.height / lineHeightPx);
                    return {
                        requestedFont: font,
                        resolvedFamilyCss: resolvedFamily,
                        sampleWidthPx: Math.round(m.width * 10) / 10,
                        elementHeightPx: Math.round(rect.height),
                        lines,
                        textLength: el.textContent.trim().length,
                        cpl: Math.round((el.textContent.trim().length / lines) * 10) / 10,
                    };
                }, { selector, font });
                console.log(JSON.stringify(result));
            }
            await page.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } finally {
        await browser.close();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
