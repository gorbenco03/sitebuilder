import { chromium } from '/Users/Work/Desktop/sitebuilder/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let alertFired = null;
page.on('dialog', async (d) => { alertFired = d.message(); await d.dismiss(); });

await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(300);
console.log('After load (passive check): alertFired =', alertFired);

const link = page.locator('.pf-chip__icon a').first();
const count = await link.count();
console.log('link found:', count);
if (count) {
  const hrefProp = await link.evaluate(a => a.href); // browser-normalized href
  console.log('browser-normalized .href property:', JSON.stringify(hrefProp));
  await link.click({ force: true }).catch(e => console.log('click error:', e.message));
  await page.waitForTimeout(300);
  console.log('After click: alertFired =', alertFired);
}

await page.screenshot({ path: process.argv[3] || (process.argv[2] + '.png'), fullPage: true });
await browser.close();
process.exit(0);
