'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

async function measureAll(ROOT, templatesFilter) {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
  const templatesDir = path.join(ROOT, 'templates');
  const templates = (templatesFilter || fs.readdirSync(templatesDir).filter(t =>
    fs.existsSync(path.join(templatesDir, t, 'presets.json')) &&
    fs.existsSync(path.join(templatesDir, t, 'template.html'))));

  const browser = await chromium.launch({ headless: true });
  const results = {};
  for (const tpl of templates) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clsI-'));
    const cfg = JSON.parse(fs.readFileSync(path.join(templatesDir, tpl, 'presets.json'), 'utf8')).presets[0].config;
    siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
    results[tpl] = {};
    for (const vp of [{w:1440,h:900,label:'desktop'},{w:390,h:844,label:'mobile'}]) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.addInitScript(() => {
        window.__clsTotal = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__clsTotal += e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      await page.waitForTimeout(2000);
      const cls = await page.evaluate(() => window.__clsTotal);
      results[tpl][vp.label] = cls;
      await page.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await browser.close();
  return results;
}

(async () => {
  console.log('=== BEFORE (cca48c6~1) ===');
  const before = await measureAll('<checkout-of-cca48c6~1>', ['local-service','desserdirina','professionals','portfolio','product-menu']);
  for (const [t, v] of Object.entries(before)) console.log(t, JSON.stringify(v));

  console.log('=== AFTER (worktree HEAD) ===');
  const after = await measureAll(require('path').resolve(__dirname,'..','..'));
  for (const [t, v] of Object.entries(after)) console.log(t, JSON.stringify(v));
})();
