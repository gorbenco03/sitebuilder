import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/Work/Desktop/sitebuilder/node_modules/playwright');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div id="d"></div>');
const result = await page.evaluate(() => {
  const d = document.getElementById('d');
  d.innerHTML = '<svg><a id="a1" xlink:href="javascript&colon;window.__xss=1">click</a></svg>';
  const a = document.getElementById('a1');
  return {
    rawAttr: a.getAttribute('xlink:href'),
    hrefBaseVal: a.href && a.href.baseVal,
  };
});
console.log('RESULT', JSON.stringify(result));

// Now actually click it and see if it navigates as javascript: (would set window.__xss)
await page.setContent('<svg xmlns="http://www.w3.org/2000/svg"><a id="a1" xlink:href="javascript&colon;window.__xss=1"><text x="10" y="20">click me</text></a></svg>');
try {
  await page.click('#a1', { timeout: 2000 });
} catch (e) { console.log('click error', e.message); }
const xss = await page.evaluate(() => window.__xss);
console.log('XSS FIRED:', xss === 1);

await browser.close();
