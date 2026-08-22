import { chromium } from '/Users/Work/.hermes/hermes-agent/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/template-research';
const sites = [
  { cat: '01-restaurants', slug: 'atelier-crenn', url: 'https://www.ateliercrenn.com/' },
  { cat: '01-restaurants', slug: 'noma', url: 'https://noma.dk/' },
  { cat: '01-restaurants', slug: 'dishoom', url: 'https://www.dishoom.com/' },
  { cat: '01-restaurants', slug: 'rules', url: 'https://rules.co.uk/' },
  { cat: '01-restaurants', slug: 'cora-pearl', url: 'https://www.corapearl.co.uk/' },
  { cat: '02-beauty', slug: 'exhale-spa', url: 'https://exhalespa.com/' },
  { cat: '02-beauty', slug: 'minimale-skin', url: 'https://minimaleskin.com/' },
  { cat: '02-beauty', slug: 'bluemercury', url: 'https://www.bluemercury.com/' },
  { cat: '02-beauty', slug: 'blow-ltd', url: 'https://www.blowltd.com/' },
  { cat: '02-beauty', slug: 'sally-hershberger', url: 'https://www.sallyhershberger.com/' },
  { cat: '03-construction', slug: 'turner', url: 'https://www.turnerconstruction.com/' },
  { cat: '03-construction', slug: 'matheson', url: 'https://mathesonconstructors.com/' },
  { cat: '03-construction', slug: 'woodhull', url: 'https://www.woodhull.com/' },
  { cat: '03-construction', slug: 'mortenson', url: 'https://www.mortenson.com/' },
  { cat: '03-construction', slug: 'clark', url: 'https://www.clarkconstruction.com/' },
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
      locale: 'en-GB',
    });
    const page = await context.newPage();
    let status = 'ok';
    try {
      const res = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      const title = await page.title();
      const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
      if (/just a moment|access denied|attention required|captcha/i.test(title + bodyText)) {
        status = 'blocked';
      }
      const dest = path.join(dir, `${vp.name}.png`);
      await page.screenshot({ path: dest, fullPage: false });
      log.push({ ...site, vp: vp.name, status, title, http: res && res.status() });
      console.log(status, vp.name, site.slug, title);
    } catch (e) {
      status = 'error';
      log.push({ ...site, vp: vp.name, status, error: e.message });
      console.log('ERR', vp.name, site.slug, e.message);
    }
    await context.close();
  }
}

fs.writeFileSync(path.join(ROOT, 'capture-log.json'), JSON.stringify(log, null, 2));
await browser.close();
console.log('DONE', log.length);
