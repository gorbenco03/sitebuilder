// Focused check: is the hand-rolled WhatsApp QR encoder in templates/local-service/script.js
// producing a QR code that actually decodes back to the wa.me URL?
import fs from 'node:fs';
import path from 'node:path';
import { bootServer, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const EVID = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/template-local-service';

async function main() {
  const srv = await bootServer();
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;
  await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click();
  await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  const frame = page.frameLocator('#preview-iframe');
  await frame.locator('body').waitFor({ state: 'visible' });
  await page.locator('#btn-close-drawer').click();
  await page.locator('#btn-open-drawer').click();
  await page.locator('[data-field-key="contact.whatsapp"] input').first().fill('40745123456');
  const msgInput = page.locator('[data-field-key="contact.waMessage"] textarea, [data-field-key="contact.waMessage"] input').first();
  await msgInput.fill('Bună ziua! Aș dori o ofertă pentru renovare băie, mulțumesc.');
  await msgInput.blur();
  await page.waitForTimeout(400);
  await page.locator('#btn-close-drawer').click();

  const waHref = await frame.locator('a[href*="wa.me"]').first().getAttribute('href');
  console.log('Expected waHref:', waHref);

  await frame.locator('a[href*="wa.me"]').first().click();
  await page.waitForTimeout(300);
  const svgDataUri = await frame.locator('#wa-qr-img').getAttribute('src');
  const svgText = decodeURIComponent(svgDataUri.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  fs.writeFileSync(path.join(EVID, 'wa-qr-raw.svg'), svgText);
  console.log('SVG length:', svgText.length);
  const openBtnHref = await frame.locator('#wa-qr-open').getAttribute('href');
  console.log('QR open-in-whatsapp-web fallback href:', openBtnHref);
  fs.writeFileSync(path.join(EVID, 'wa-qr-expected-full.json'), JSON.stringify({ waHref, openBtnHref }, null, 2));

  // Rasterize the raw SVG crisply, at a clean 480x480 (2x) with no surrounding layout influence.
  const rasterPage = await b.context.newPage();
  await rasterPage.setViewportSize({ width: 480, height: 480 });
  await rasterPage.setContent('<!doctype html><html><body style="margin:0;padding:0;background:#fff">' + svgText.replace('width="240" height="240"', 'width="480" height="480"') + '</body></html>');
  await rasterPage.waitForTimeout(200);
  await rasterPage.screenshot({ path: path.join(EVID, 'wa-qr-crisp-480.png') });

  await b.close();
  await srv.close();
}

main().catch(e => { console.error(e); process.exit(1); });
