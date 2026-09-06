import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB } = await newBrowser();
page.setDefaultTimeout(30000);

await page.goto(base + '/app/', { waitUntil: 'networkidle' });
await page.locator('#hb-cookie-accept').click().catch(() => {});
await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
await page.waitForURL(/#edit$/);
await page.locator('#preview-iframe').waitFor({ state: 'visible' });
await page.waitForTimeout(1200);
if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
  await page.locator('#btn-close-drawer').click().catch(() => {});
  await page.waitForTimeout(400);
}

const iframeHandle = await page.$('#preview-iframe');
const ctx = await iframeHandle.contentFrame();

const roots = ['services', 'trust', 'categories', 'certifications'];
for (const r of roots) {
  const info = await ctx.evaluate((root) => {
    const els = Array.from(document.querySelectorAll('[data-hb-edit^="' + root + '."]'));
    return { count: els.length, paths: els.slice(0, 6).map(e => e.getAttribute('data-hb-edit')) };
  }, r);
  console.log(r, JSON.stringify(info));
}

const addBtns = await ctx.evaluate(() => Array.from(document.querySelectorAll('.hb-add-btn')).map(b => b.textContent));
console.log('add buttons found:', addBtns);

const listItemContainers = await ctx.evaluate(() => Array.from(document.querySelectorAll('.hb-list-item')).map(el => el.className));
console.log('hb-list-item containers:', listItemContainers);

await closeB();
await close();
