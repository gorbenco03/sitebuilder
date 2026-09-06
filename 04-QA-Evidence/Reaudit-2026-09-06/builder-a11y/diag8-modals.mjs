import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB } = await newBrowser();
page.setDefaultTimeout(30000);

async function focusInsideModal(modalId) {
  return page.evaluate((id) => {
    const modal = document.getElementById(id);
    return !!(modal && document.activeElement && modal.contains(document.activeElement));
  }, modalId);
}

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

// ---- modal-publish ----
console.log('=== modal-publish ===');
await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
console.log('focus inside modal-publish on open:', await focusInsideModal('modal-publish'));
let escaped = false;
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('Tab');
  const inside = await focusInsideModal('modal-publish');
  if (!inside) { console.log('Tab #' + (i + 1) + ' ESCAPED modal-publish!'); escaped = true; break; }
}
if (!escaped) console.log('Tab stayed inside modal-publish for 20 tabs: OK');

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log('modal-publish closed after Escape:', !(await page.locator('#modal-publish').isVisible().catch(() => false)));
const focusReturnedToPublishBtn = await page.evaluate(() => document.activeElement && document.activeElement.id === 'btn-publish');
console.log('focus returned to #btn-publish:', focusReturnedToPublishBtn);

// ---- modal-publish step 2 (auth form) Tab trap ----
console.log('=== modal-publish step 2 (auth) ===');
await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
const slugInput = page.locator('#input-slug');
if (await slugInput.isVisible().catch(() => false)) {
  await slugInput.fill('qa-modal-tab-test');
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
}
let escaped2 = false;
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('Tab');
  const inside = await focusInsideModal('modal-publish');
  if (!inside) { console.log('Tab #' + (i + 1) + ' ESCAPED modal-publish (auth step)!'); escaped2 = true; break; }
}
if (!escaped2) console.log('Tab stayed inside modal-publish auth step for 20 tabs: OK');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log('modal-publish (auth step) closed after Escape:', !(await page.locator('#modal-publish').isVisible().catch(() => false)));

await closeB();
await close();
