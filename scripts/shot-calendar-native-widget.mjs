/**
 * Screenshot oracle for native public booking widget (desktop + 390).
 * Run with server already on PORT (default 8791):
 *   node scripts/shot-calendar-native-widget.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || '8791';
const BASE = process.env.CAL_PREVIEW_URL || `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '..', '04-QA-Evidence', 'Calendar-Native-Widget');

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
        const desk = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        await desk.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'networkidle', timeout: 20000 });
        await desk.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
        await desk.waitForTimeout(600);
        const deskPath = path.join(OUT, 'public-widget-desktop.png');
        await desk.screenshot({ path: deskPath, fullPage: true });
        console.log('WROTE', deskPath);

        const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await mob.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'networkidle', timeout: 20000 });
        await mob.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
        await mob.waitForTimeout(600);
        const mobPath = path.join(OUT, 'public-widget-390.png');
        await mob.screenshot({ path: mobPath, fullPage: true });
        console.log('WROTE', mobPath);

        const text = await desk.locator('body').innerText();
        console.log('BODY_SNIP', text.slice(0, 500).replace(/\n/g, ' | '));
        if (!/Consulta|Confirmă|Serviciu/i.test(text)) {
            console.error('Widget missing expected RO chrome');
            process.exit(2);
        }
    } finally {
        await browser.close();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
