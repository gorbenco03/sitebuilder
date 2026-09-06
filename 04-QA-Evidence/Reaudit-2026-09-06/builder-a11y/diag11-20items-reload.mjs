import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB } = await newBrowser();
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

// ---- 20 list items ----
console.log('=== Adding 20 list items ===');
const before = await frame().locator('.pr-svc__card').count().catch(() => 0);
console.log('items before:', before);
let lastErr = null;
for (let i = 0; i < 20; i++) {
  try {
    const addBtn = frame().locator('.hb-add-btn').first();
    await addBtn.scrollIntoViewIfNeeded({ timeout: 5000 });
    await addBtn.click({ timeout: 5000 });
    await page.waitForTimeout(250);
  } catch (e) {
    lastErr = 'iteration ' + i + ': ' + e.message;
    break;
  }
}
const after = await frame().locator('.pr-svc__card').count().catch(() => -1);
console.log('items after 20x add attempts:', after, '(expected', before + 20, ')');
if (lastErr) console.log('error during loop:', lastErr);
const jsErrors = await page.evaluate(() => window.__jsErrorCount || 0).catch(() => 'n/a');
console.log('undo button state after burst:', await page.locator('#btn-undo').isDisabled());

// ---- Reload mid-edit ----
console.log('=== Reload mid-edit ===');
const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();
await nameField().click({ clickCount: 3 });
await page.keyboard.type('Mid Edit Business Name', { delay: 15 });
// Do NOT blur - reload immediately while debounce may still be pending
await page.waitForTimeout(100);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const hashAfterReload = new URL(page.url()).hash;
console.log('hash after reload:', hashAfterReload);
const drawerVisible = await page.locator('#details-drawer').isVisible().catch(() => false);
if (drawerVisible) await page.locator('#btn-close-drawer').click().catch(() => {});
await page.waitForTimeout(500);
const nameAfterReload = await frame().locator('[data-hb-edit="business.name"]').first().innerText().catch((e) => 'ERROR: ' + e.message);
console.log('business name after reload:', JSON.stringify(nameAfterReload));

await closeB();
await close();
