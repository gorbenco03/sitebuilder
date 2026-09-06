#!/usr/bin/env node
import { bootServer, newBrowser } from
  '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const srv = await bootServer();
const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await page.locator('#hb-cookie-accept').click({ timeout: 5000 }).catch(() => {});
await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(800);
await page.locator('#btn-close-drawer').click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(300);

const frame = page.frameLocator('#preview-iframe');
const addBtn = frame.locator('.gallery-section .hb-add-btn').first();
await addBtn.click();
await page.waitForTimeout(500);

const html = await frame.locator('.gallery-section').evaluate(el => el.outerHTML);
console.log('=== gallery-section outerHTML after ADD ===');
console.log(html);

const removeBtnCount = await frame.locator('.gallery-section .hb-remove-btn').count();
console.log('removeBtnCount=', removeBtnCount);
for (let i = 0; i < removeBtnCount; i++) {
  const info = await frame.locator('.gallery-section .hb-remove-btn').nth(i).evaluate(b => {
    const cb = b.closest('.category-block');
    return {
      hasCB: !!cb,
      cbIndex: cb ? Array.prototype.indexOf.call(cb.parentElement.children, cb) : -1,
      paths: cb ? Array.from(cb.querySelectorAll('[data-hb-edit]')).map(e => e.getAttribute('data-hb-edit')) : []
    };
  });
  console.log('removeBtn[' + i + ']', JSON.stringify(info));
}

await b.close();
await srv.close();
