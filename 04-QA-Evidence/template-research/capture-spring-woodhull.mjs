import { chromium } from '/Users/Work/.hermes/hermes-agent/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/template-research';
const sites = [
  { cat: '01-restaurants', slug: 'spring', url: 'https://www.springrestaurant.co.uk/' },
  // woodhull.com resolved to personal archive — swap to a live design-build GC
  { cat: '03-construction', slug: 'layton', url: 'https://www.laytonconstruction.com/' },
];

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
});

const log = [];
for (const site of sites) {
  const dir = path.join(ROOT, site.cat, site.slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      const res = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      for (const sel of [
        'button:has-text("Accept all")',
        'button:has-text("Accept All")',
        'button:has-text("Accept")',
        '#onetrust-accept-btn-handler',
        '[id*="accept" i]',
      ]) {
        try {
          const b = page.locator(sel).first();
          if (await b.isVisible({ timeout: 600 })) await b.click({ timeout: 1500 });
        } catch {}
      }
      await page.waitForTimeout(2000);
      const title = await page.title();
      const out = path.join(dir, `${vp.name}.png`);
      await page.screenshot({ path: out, fullPage: false });
      const bytes = fs.statSync(out).size;
      const row = {
        cat: site.cat,
        slug: site.slug,
        url: site.url,
        vp: vp.name,
        status: 'ok',
        title,
        http: res ? res.status() : null,
        bytes,
      };
      log.push(row);
      console.log(JSON.stringify(row));
    } catch (e) {
      const row = { cat: site.cat, slug: site.slug, url: site.url, vp: vp.name, status: 'err', error: e.message };
      log.push(row);
      console.log(JSON.stringify(row));
    }
    await context.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(ROOT, 'capture-spring-woodhull-log.json'), JSON.stringify(log, null, 2));
