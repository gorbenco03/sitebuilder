'use strict';
/**
 * Full-page before/after screenshots per template at 1440x900 and 390x844.
 * Usage: node screenshot.js <before|after>
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

const tag = process.argv[2] || 'before';
const OUT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

function firstPresetConfig(tpl) {
    const p = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8'));
    return p.presets[0].config;
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const tpl of TEMPLATES) {
            const cfg = firstPresetConfig(tpl);
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
            siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
            const indexPath = path.join(dir, 'index.html');
            for (const vp of VIEWPORTS) {
                const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
                await page.goto('file://' + indexPath, { waitUntil: 'networkidle' });
                await page.evaluate(() => {
                    document.documentElement.classList.remove('hb-cookie-open');
                    const dock = document.querySelector('[data-consent-dock], .consent-dock, #cookie-consent');
                    if (dock) dock.remove();
                });
                await page.waitForTimeout(150);
                const file = path.join(OUT_DIR, `${tag}-${tpl}-${vp.label}.png`);
                await page.screenshot({ path: file, fullPage: true });
                await page.close();
                console.log('wrote', file);
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } finally {
        await browser.close();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
