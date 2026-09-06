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

await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
const slugInput = page.locator('#input-slug');
if (await slugInput.isVisible().catch(() => false)) {
  await slugInput.fill('qa-offline-test');
  await page.locator('#btn-publish-continue').click();
}
await page.locator('#form-auth-email').waitFor({ state: 'visible' });

// Simulate offline: abort the auth endpoint at the network level (like airplane mode / DNS failure)
await page.route('**/api/auth/email', (route) => route.abort('internetdisconnected'));

await page.locator('#input-email').fill('qa-offline@example.com');
await page.locator('#btn-send-magic').click();
await page.waitForTimeout(1500);

const errorVisible = await page.locator('#auth-error').isVisible().catch(() => false);
const errorText = errorVisible ? (await page.locator('#auth-error').textContent()).trim() : null;
console.log('offline auth error visible:', errorVisible);
console.log('offline auth error text:', JSON.stringify(errorText));

await page.screenshot({ path: '04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag7-offline-auth.png' });

await closeB();
await close();
