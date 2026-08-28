'use strict';
/**
 * Flow2 browser evidence — headless Chromium screenshots of /app/ catalog + editor.
 * Local only. Writes under 04-QA-Evidence/Flow2/.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/Users/Work/.hermes/hermes-agent/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '04-QA-Evidence', 'Flow2');
const BASE = process.env.FLOW2_BASE || 'http://127.0.0.1:54710';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(brave) ? brave : undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // 1) Catalog chips RO + Desserdirina card
  await page.goto(BASE + '/app/#templates', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const chips = await page.locator('#catalog-chips .catalog-chip').allTextContents();
  fs.writeFileSync(path.join(OUT, 'catalog-chips.txt'), chips.join('\n') + '\n');
  await page.screenshot({ path: path.join(OUT, '01-catalog-ro-chips.png'), fullPage: false });

  // Filter cofetărie
  const cof = page.locator('#catalog-chips .catalog-chip[data-filter="desserdirina"]');
  if (await cof.count()) {
    await cof.click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(OUT, '02-catalog-cofetarie-filter.png'), fullPage: false });

  // Start Desserdirina
  const startBtn = page.locator('.btn-start-tpl[data-id="desserdirina"]').first();
  if (!(await startBtn.count())) {
    // clear filter all then find
    await page.locator('#catalog-chips .catalog-chip[data-filter="all"]').click();
    await page.waitForTimeout(300);
  }
  const start2 = page.locator('.btn-start-tpl[data-id="desserdirina"]').first();
  await start2.click();
  await page.waitForTimeout(1800);

  // 3) Editor — Details drawer should auto-open
  const drawer = page.locator('#details-drawer');
  const drawerVisible = await drawer.isVisible().catch(() => false);
  const drawerTitle = await page.locator('.drawer-title').textContent().catch(() => '');
  fs.writeFileSync(
    path.join(OUT, 'details-auto-open.txt'),
    `drawerVisible=${drawerVisible}\ndrawerTitle=${drawerTitle}\nurl=${page.url()}\n`
  );
  await page.screenshot({ path: path.join(OUT, '03-editor-details-auto-open.png'), fullPage: false });

  // 4) Preview / iframe attribution + WA
  const frame = page.frameLocator('#preview-frame, iframe#site-preview, .preview-frame iframe, iframe').first();
  let badge = '';
  let wa = '';
  try {
    await page.waitForTimeout(800);
    badge = await frame.locator('.hb-built-by').textContent({ timeout: 4000 });
    wa = await frame.locator('.whatsapp-float').count();
  } catch (e) {
    // try main document if not iframe
    badge = await page.locator('.hb-built-by').textContent().catch(() => String(e.message));
    wa = await page.locator('.whatsapp-float').count().catch(() => 0);
  }
  fs.writeFileSync(
    path.join(OUT, 'preview-badge-wa.txt'),
    `badge=${JSON.stringify(badge)}\nwaCount=${wa}\n`
  );
  await page.screenshot({ path: path.join(OUT, '04-editor-preview-badge-wa.png'), fullPage: false });

  // Close drawer, reload, confirm stays closed
  if (drawerVisible) {
    await page.locator('#btn-close-drawer, .drawer-close, [aria-label*="Închide"], [aria-label*="Close"]').first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // After reload may go to landing; navigate back via hash if needed
  if (!page.url().includes('edit')) {
    // preference is stored; re-enter via localStorage check
  }
  const pref = await page.evaluate(() => localStorage.getItem('hb-details-drawer-pref'));
  fs.writeFileSync(path.join(OUT, 'drawer-pref.txt'), `pref=${pref}\n`);

  // README summary
  const summary = [
    '# Flow 2 browser evidence',
    '',
    `- Base: ${BASE}`,
    `- Catalog chips: ${chips.join(' | ')}`,
    `- Details auto-open visible: ${drawerVisible}`,
    `- Drawer title: ${drawerTitle}`,
    `- Attribution plain: ${String(badge).replace(/\s+/g, ' ').trim()}`,
    `- WA float count: ${wa}`,
    `- Drawer pref after close: ${pref}`,
    '',
    'Screenshots: 01–04 PNG in this folder.',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), summary + '\n');
  console.log(summary);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
