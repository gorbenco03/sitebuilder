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

async function getServicesLen() {
  return await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('hidook_draft_v1') || localStorage.getItem('hb_draft') || null;
      // Find the right key heuristically
      const keys = Object.keys(localStorage);
      const draftKey = keys.find(k => /draft/i.test(k));
      const val = draftKey ? JSON.parse(localStorage.getItem(draftKey)) : null;
      const cfg = val && (val.config || val);
      return { draftKey, servicesLen: cfg && cfg.services ? cfg.services.length : null, keys };
    } catch (e) { return { error: e.message }; }
  });
}

console.log('before:', JSON.stringify(await getServicesLen()));

const frame = () => page.frameLocator('#preview-iframe');
const addBtn = frame().locator('.hb-ls-add').first();
const addBtnText = await addBtn.textContent();
console.log('clicking add button with text:', addBtnText);
await addBtn.scrollIntoViewIfNeeded();
await addBtn.click();
await page.waitForTimeout(1500);

console.log('after:', JSON.stringify(await getServicesLen()));

const cardCount = await frame().locator('.service-card').count();
console.log('service-card count after add (post-wait):', cardCount);

await page.screenshot({ path: '04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag5-after-add.png', fullPage: true });

await closeB();
await close();
