// One-off evidence script: screenshots the owner dashboard "Setări" tab at
// 1440 (desktop) and 390 (mobile) widths against a locally running server.
// Usage: node 04-QA-Evidence/Wave6-calendar/screenshot-settings.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://localhost:8793';
const outDir = process.argv[3] || '.';

const browser = await chromium.launch();
try {
    for (const [label, width] of [['desktop-1440', 1440], ['mobile-390', 390]]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(baseUrl + '/calendar-native/owner/', { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: 'Setări' }).click();
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${outDir}/owner-settings-${label}.png`, fullPage: true });
        await page.close();
        console.log('saved', `${outDir}/owner-settings-${label}.png`);
    }
} finally {
    await browser.close();
}
