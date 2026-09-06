import { chromium } from '/Users/Work/Desktop/sitebuilder/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const html = fs.readFileSync('/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/static-renderer-export/icon-bypass-portfolio-out.html', 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let alertFired = null;
page.on('dialog', async (d) => { alertFired = d.message(); await d.dismiss(); });

await page.setContent(html, { waitUntil: 'load' });

// payload3 (@import javascript: in <style> inside SVG) executes passively on load — check now.
await page.waitForTimeout(500);
console.log('After load (checks passive @import/animate execution): alertFired =', alertFired);

// Now click payload1's <a href="jav\tascript:alert(1)"> link explicitly.
const link1 = page.locator('.pf-chip__icon a[href*="ascript:alert(1)"]').first();
const count1 = await link1.count();
console.log('payload1 link found:', count1);
if (count1) {
  await link1.click({ force: true }).catch(e => console.log('click1 error', e.message));
  await page.waitForTimeout(300);
  console.log('After clicking payload1 link: alertFired =', alertFired);
}

const link4 = page.locator('.pf-chip__icon a[xlink\\:href*="ascript:alert(4)"]').first();
const count4 = await page.locator('a').evaluateAll(as => as.filter(a => (a.getAttribute('xlink:href')||'').includes('ascript:alert(4)')).length);
console.log('payload4 xlink link found:', count4);

await browser.close();
