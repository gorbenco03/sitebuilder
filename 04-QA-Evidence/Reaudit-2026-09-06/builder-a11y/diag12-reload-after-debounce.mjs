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

// ---- Reload after debounce elapses but WITHOUT blur ----
console.log('=== Reload 500ms after typing (debounce=300ms), no blur ===');
const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();
await nameField().click({ clickCount: 3 });
await page.keyboard.type('Mid Edit Business Name', { delay: 15 });
// Wait PAST the 300ms debounce window, but never blur the field
await page.waitForTimeout(500);
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
