import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><body><div id="a" style="background-image: #E85D8C"></div></body></html>`);
const r = await page.$eval('#a', el => ({ style: el.getAttribute('style'), computed: getComputedStyle(el).backgroundImage }));
console.log(JSON.stringify(r));
await browser.close();
