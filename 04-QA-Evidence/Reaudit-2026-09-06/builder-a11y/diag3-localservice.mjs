import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB, consoleErrors } = await newBrowser();
page.setDefaultTimeout(30000);

const iframeConsole = [];
page.on('frameattached', (frame) => {
  // no-op; console listening set up via context 'page' event in harness only for pages,
  // but frames inside srcdoc iframe share the page's console. Use page.on('console') directly.
});
page.on('console', (msg) => {
  iframeConsole.push(msg.type() + ': ' + msg.text());
});

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

console.log('console messages mentioning hb-overlay or warn/error:');
iframeConsole.filter(m => /hb-overlay|warn|error/i.test(m)).forEach(m => console.log('  ', m));

const iframeHandle = await page.$('#preview-iframe');
const ctx = await iframeHandle.contentFrame();

// Check remove buttons exist
const removeBtnCount = await ctx.evaluate(() => document.querySelectorAll('.hb-remove-btn').length);
console.log('remove buttons found:', removeBtnCount);

// Dump last service-card outerHTML (truncated)
const lastCardHtml = await ctx.evaluate(() => {
  const cards = document.querySelectorAll('.service-card');
  const last = cards[cards.length - 1];
  return last ? last.outerHTML.slice(0, 500) : null;
});
console.log('last service-card html:', lastCardHtml);

// Try to manually reproduce findListItemContainer logic outcome: what is lastContainer.parentNode?
const parentInfo = await ctx.evaluate(() => {
  const cards = document.querySelectorAll('.service-card');
  const last = cards[cards.length - 1];
  if (!last) return null;
  return { tag: last.tagName, parentTag: last.parentElement && last.parentElement.tagName, nextSiblingTag: last.nextElementSibling && last.nextElementSibling.tagName };
});
console.log('parentInfo:', parentInfo);

await closeB();
await close();
