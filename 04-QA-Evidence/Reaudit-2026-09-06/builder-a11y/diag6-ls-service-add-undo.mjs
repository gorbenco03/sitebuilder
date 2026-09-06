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

const frame = () => page.frameLocator('#preview-iframe');
const undoBtn = page.locator('#btn-undo');
const beforeCount = await frame().locator('.service-card').count();
console.log('services before:', beforeCount);

const addBtn = frame().locator('.hb-ls-add', { hasText: 'serviciu' }).first();
await addBtn.scrollIntoViewIfNeeded();
await addBtn.click();
await page.waitForTimeout(1000);
const afterCount = await frame().locator('.service-card').count();
console.log('services after add:', afterCount, '(expect', beforeCount + 1, ')');

await undoBtn.click();
await page.waitForTimeout(1200);
const afterUndo = await frame().locator('.service-card').count();
console.log('services after ONE undo:', afterUndo, '(expect', beforeCount, ')');

const redoBtn = page.locator('#btn-redo');
await redoBtn.click();
await page.waitForTimeout(1200);
const afterRedo = await frame().locator('.service-card').count();
console.log('services after redo:', afterRedo, '(expect', beforeCount + 1, ')');

await closeB();
await close();
