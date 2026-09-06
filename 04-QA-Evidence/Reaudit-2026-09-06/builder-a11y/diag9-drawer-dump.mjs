import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB } = await newBrowser();
page.setDefaultTimeout(30000);

for (const tpl of ['portfolio', 'product-menu', 'desserdirina', 'professionals', 'local-service']) {
  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator('.template-card[data-template-id="' + tpl + '"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  if (!(await page.locator('#details-drawer').isVisible().catch(() => false))) {
    await page.locator('#btn-open-drawer').click().catch(() => {});
  }
  await page.locator('#details-drawer').waitFor({ state: 'visible' }).catch(() => {});
  await page.waitForTimeout(300);
  const hasGalleryBtn = await page.locator('#drawer-body button').allTextContents();
  console.log(tpl, '-> drawer buttons:', hasGalleryBtn.filter(t => /photo|galer|foto/i.test(t)));
}

await closeB();
await close();
