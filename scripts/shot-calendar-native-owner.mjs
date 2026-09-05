/**
 * Capture owner dashboard screenshots (390 + desktop) for QA evidence.
 * Requires server on PORT (default 8791).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || '8791';
const BASE = process.env.CAL_PREVIEW_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.resolve('04-QA-Evidence/calendar-native-owner-dashboard');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${BASE}/calendar-native/owner/`, { waitUntil: 'networkidle', timeout: 25000 });
await mobile.waitForSelector('.hod-tab, [data-hod-shell]', { timeout: 20000 });
await mobile.waitForTimeout(800);
await mobile.screenshot({
  path: path.join(outDir, '01-owner-dashboard-390-bookings.png'),
  fullPage: true,
});
const tabs = await mobile.locator('.hod-tab').allTextContents();
const avail = mobile.getByRole('button', { name: 'Disponibilitate' });
if ((await avail.count()) > 0) {
  await avail.click();
  await mobile.waitForTimeout(600);
  await mobile.screenshot({
    path: path.join(outDir, '02-owner-dashboard-390-availability.png'),
    fullPage: true,
  });
}
const svcTab = mobile.getByRole('button', { name: 'Servicii' });
if ((await svcTab.count()) > 0) {
  await svcTab.click();
  await mobile.waitForTimeout(500);
  await mobile.screenshot({
    path: path.join(outDir, '04-owner-dashboard-390-services.png'),
    fullPage: true,
  });
}
const text = await mobile.evaluate(() => document.body.innerText.slice(0, 600));

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desktop.goto(`${BASE}/calendar-native/owner/`, { waitUntil: 'networkidle', timeout: 25000 });
await desktop.waitForSelector('.hod-tab, [data-hod-shell]', { timeout: 20000 });
await desktop.waitForTimeout(600);
await desktop.screenshot({
  path: path.join(outDir, '03-owner-dashboard-desktop.png'),
  fullPage: true,
});

console.log(JSON.stringify({ ok: true, tabs, textPreview: text.slice(0, 300), outDir }, null, 2));
await browser.close();
