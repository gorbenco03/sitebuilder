import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB, consoleErrors } = await newBrowser();
page.setDefaultTimeout(30000);

await page.goto(base + '/app/', { waitUntil: 'networkidle' });
await page.locator('#hb-cookie-accept').click().catch(() => {});
await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
await page.waitForURL(/#edit$/);
await page.locator('#preview-iframe').waitFor({ state: 'visible' });
await page.waitForTimeout(1000);
if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
  await page.locator('#btn-close-drawer').click().catch(() => {});
  await page.waitForTimeout(300);
}

const frame = () => page.frameLocator('#preview-iframe');
const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();

// ---- 1. Business name with quotes, backslashes, emoji ----
console.log('=== Adversarial business name ===');
const weirdName = 'O\'Brien "Deluxe" \\Salon\\ 🎉💅 <b>test</b>';
await nameField().click({ clickCount: 3 });
await page.keyboard.type(weirdName);
await page.locator('#editor-template-name').click();
await page.waitForTimeout(500);
const gotName = (await nameField().innerText()).trim();
console.log('typed :', JSON.stringify(weirdName));
console.log('landed:', JSON.stringify(gotName));
console.log('match:', gotName === weirdName);
// check it did NOT get interpreted as HTML (no actual <b> element created)
const boldChildren = await nameField().locator('b').count();
console.log('accidental <b> child elements created:', boldChildren);

// ---- 2. Paste raw HTML into a text field ----
console.log('=== Paste raw HTML ===');
const htmlPayload = '<img src=x onerror="window.__xss=1">HACKED<script>window.__xss2=1<' + '/script>';
await nameField().click({ clickCount: 3 });
const iframeHandle = await page.$('#preview-iframe');
const ctx = await iframeHandle.contentFrame();
await ctx.evaluate((html) => {
  const el = document.querySelector('[data-hb-edit="business.name"]');
  el.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  dt.setData('text/plain', html);
  const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  el.dispatchEvent(evt);
}, htmlPayload);
await page.waitForTimeout(300);
// Whatever happened, check no script executed
const xssRan = await ctx.evaluate(() => !!(window.__xss || window.__xss2));
console.log('XSS payload executed inside iframe:', xssRan);
const afterPasteText = (await nameField().innerText()).trim();
console.log('field text after paste attempt:', JSON.stringify(afterPasteText.slice(0, 150)));
const dangerousEls = await ctx.evaluate(() => document.querySelectorAll('img[onerror], script').length);
console.log('dangerous elements (img[onerror], script) in iframe DOM:', dangerousEls);

console.log('console errors so far:', consoleErrors.length);

const withinFieldDangerous = await ctx.evaluate(() => {
  const el = document.querySelector('[data-hb-edit="business.name"]');
  if (!el) return 'no-field';
  return el.querySelectorAll('img, script').length;
});
console.log('dangerous elements INSIDE the edited field itself:', withinFieldDangerous);

await closeB();
await close();
