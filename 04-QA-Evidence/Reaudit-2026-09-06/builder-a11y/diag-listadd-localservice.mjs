import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

// Replicate the earlier steps: text edit + color change, THEN look for .hb-add-btn
const frame = () => page.frameLocator('#preview-iframe');
const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();
await nameField().click({ clickCount: 3 });
await page.keyboard.type('Atelier Nou SRL', { delay: 15 });
await page.locator('#editor-template-name').click();
await page.waitForTimeout(500);

await page.locator('#btn-color-picker').click();
await page.locator('#color-popover').waitFor({ state: 'visible' });
const dots = page.locator('#color-presets .color-preset-dot');
if (await dots.count() > 0) { await dots.nth(1).click(); await page.waitForTimeout(150); }
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

const addBtnCount = await frame().locator('.hb-add-btn').count();
console.log('hb-add-btn count after text+color:', addBtnCount);

const iframeHandle = await page.$('#preview-iframe');
const ctx = await iframeHandle.contentFrame();
const html = await ctx.evaluate(() => document.body.innerHTML.length);
console.log('iframe body html length:', html);
const listEls = await ctx.evaluate(() => Array.from(document.querySelectorAll('[data-hb-list], .hb-list-item')).length);
console.log('hb-list-item/data-hb-list count:', listEls);
const allClasses = await ctx.evaluate(() => {
  const set = new Set();
  document.querySelectorAll('*').forEach(el => { if (el.className && typeof el.className === 'string' && /svc|list|card|chip/i.test(el.className)) set.add(el.className); });
  return Array.from(set).slice(0, 40);
});
console.log('candidate classes:', allClasses);

await page.screenshot({ path: '04-QA-Evidence/Reaudit-2026-09-06/builder-a11y/diag-localservice.png', fullPage: true });

await closeB();
await close();
