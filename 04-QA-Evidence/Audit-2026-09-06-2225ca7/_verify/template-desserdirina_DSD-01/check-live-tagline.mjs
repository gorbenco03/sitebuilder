import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2];
if (!url) { console.error('usage: node check-live-tagline.mjs <url>'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000); // let all CSS animations (delay up to 1.8s) finish

const info = await page.evaluate(() => {
  const bg = document.querySelector('.hero-background');
  const tagline = document.querySelector('.hero-tagline');
  const cta = document.querySelector('.hero-cta');
  const cs = (n) => n ? { opacity: getComputedStyle(n).opacity, transform: getComputedStyle(n).transform, display: getComputedStyle(n).display, text: n.textContent?.trim().slice(0,50) } : 'MISSING';
  return {
    bgInline: bg?.getAttribute('style'),
    bgComputed: bg ? getComputedStyle(bg).backgroundImage : 'MISSING',
    tagline: cs(tagline),
    cta: cs(cta),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: process.argv[3] || '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/template-desserdirina_DSD-01/08-live-after-3s-wait.png', fullPage: false });
await browser.close();
