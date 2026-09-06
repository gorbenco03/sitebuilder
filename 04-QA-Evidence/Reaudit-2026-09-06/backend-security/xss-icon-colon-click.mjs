import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const { chromium } = require('/Users/Work/Desktop/sitebuilder/node_modules/playwright');

const html = fs.readFileSync('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a3a347f1a5502f4b2/04-QA-Evidence/Reaudit-2026-09-06/backend-security/xss-icon-colon-rendered.html', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });

// Find the poisoned chip icon link and click it, as a real visitor would.
const handle = await page.$('.pf-chip__icon a');
if (!handle) {
  console.log('NO LINK FOUND — selector mismatch');
} else {
  const hrefProp = await page.evaluate((el) => el.getAttribute('xlink:href'), handle);
  console.log('live DOM xlink:href attribute value:', hrefProp);
  await handle.click({ timeout: 3000 }).catch((e) => console.log('click err', e.message));
  const fired = await page.evaluate(() => window.__hb_xss);
  console.log('XSS PAYLOAD EXECUTED (window.__hb_xss set):', fired);
}
await browser.close();
