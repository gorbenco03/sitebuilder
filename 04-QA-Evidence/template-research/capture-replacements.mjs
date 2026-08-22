import { chromium } from '/Users/Work/.hermes/hermes-agent/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/template-research';
const sites = [
  { cat: '01-restaurants', slug: 'sessions-arts-club', url: 'https://sessionsartsclub.com/' },
  { cat: '01-restaurants', slug: 'the-ivy', url: 'https://www.theivy.co.uk/' },
];
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
});
for (const site of sites) {
  const dir = path.join(ROOT, site.cat, site.slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      const res = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      const title = await page.title();
      await page.screenshot({ path: path.join(dir, `${vp.name}.png`), fullPage: false });
      console.log(res && res.status(), vp.name, site.slug, title);
    } catch (e) {
      console.log('ERR', site.slug, e.message);
    }
    await context.close();
  }
}
await browser.close();
