'use strict';
/**
 * Diacritic-clipping check: for every element whose text contains a Romanian
 * diacritic (ă â î ș ț and caps), does the box actually clip it? A clip only
 * happens when the element's rendered content overflows its box AND the box
 * hides overflow (overflow != visible) - line-height alone never clips
 * unless something also constrains the box height.
 *
 * Run: node 04-QA-Evidence/Typography-Pass-2026-09-07/clip-check.js
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
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
];

function firstPresetConfig(tpl) {
    const p = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8'));
    return p.presets[0].config;
}

const CHECK_SCRIPT = () => {
    const diacritics = /[ăâîșțĂÂÎȘȚ]/;
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
        const tag = el.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) continue;
        const text = el.textContent || '';
        if (!diacritics.test(text)) continue;
        // only leaf-ish: has direct text of its own
        let own = '';
        for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) own += n.textContent;
        if (!diacritics.test(own)) continue;
        const cs = getComputedStyle(el);
        const clips = cs.overflow !== 'visible' || cs.overflowY !== 'visible';
        const overflowing = el.scrollHeight > el.clientHeight + 1;
        if (clips && overflowing) {
            out.push({
                tag, className: el.className, text: own.trim().slice(0, 60),
                overflow: cs.overflow, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
            });
        }
    }
    return out;
};

async function main() {
    const browser = await chromium.launch({ headless: true });
    let anyClip = false;
    try {
        for (const tpl of TEMPLATES) {
            const cfg = firstPresetConfig(tpl);
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
            siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
            const indexPath = path.join(dir, 'index.html');
            for (const vp of VIEWPORTS) {
                const page = await browser.newPage({ viewport: vp });
                await page.goto('file://' + indexPath, { waitUntil: 'networkidle' });
                const clips = await page.evaluate(CHECK_SCRIPT);
                if (clips.length) {
                    anyClip = true;
                    console.log(tpl, vp.width + 'x' + vp.height, JSON.stringify(clips, null, 2));
                }
                await page.close();
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } finally {
        await browser.close();
    }
    console.log(anyClip ? 'CLIPPING FOUND' : 'no diacritic clipping found on any template/viewport');
}

main().catch((e) => { console.error(e); process.exit(1); });
