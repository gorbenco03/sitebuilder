'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

async function main() {
  const templatesDir = path.join(ROOT, 'templates');
  const templates = fs.readdirSync(templatesDir).filter(t =>
    fs.existsSync(path.join(templatesDir, t, 'presets.json')) &&
    fs.existsSync(path.join(templatesDir, t, 'template.html')));

  const browser = await chromium.launch({ headless: true });
  for (const tpl of templates) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geom-'));
    const cfg = JSON.parse(fs.readFileSync(path.join(templatesDir, tpl, 'presets.json'), 'utf8')).presets[0].config;
    siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

    for (const vp of [{w:1440,h:900,label:'desktop'},{w:390,h:844,label:'mobile'}]) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => {
        const btn = document.getElementById('hb-cookie-accept');
        const link = document.querySelector('.hb-cookie-actions .hb-cookie-link');
        const banner = document.getElementById('hb-cookie-banner');
        function box(el) { if (!el) return null; const r = el.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom)}; }
        return { btn: box(btn), link: box(link), banner: box(banner) };
      });
      console.log(tpl, vp.label, JSON.stringify(info));
      await page.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
