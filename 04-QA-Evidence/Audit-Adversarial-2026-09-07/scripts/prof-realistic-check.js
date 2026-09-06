'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profreal-'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT,'templates','professionals','presets.json'),'utf8')).presets[0].config;
  siteExport.buildStaticSiteTree({ templateId: 'professionals', config: cfg, images: [], siteDir: dir });
  const browser = await chromium.launch({ headless: true });
  // realistic sizes: 1366x768 (most common laptop), 1280x720, 1024x768 (ipad landscape), 768x1024 (ipad portrait), 1440x900 (desktop baseline), 390x844(mobile baseline)
  for (const vp of [
    {w:1366,h:768,label:'1366x768 (common laptop)'},
    {w:1280,h:720,label:'1280x720 (laptop)'},
    {w:1024,h:768,label:'1024x768 (tablet landscape)'},
    {w:768,h:1024,label:'768x1024 (tablet portrait)'},
    {w:1440,h:900,label:'1440x900 (baseline desktop)'},
    {w:390,h:844,label:'390x844 (baseline mobile)'},
  ]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto('file://'+path.join(dir,'index.html'), { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      function box(el){ if(!el) return null; const r = el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}; }
      const meta = document.querySelector('.pr-hero__meta');
      const banner = document.getElementById('hb-cookie-banner');
      return { metaBox: box(meta), bannerBox: box(banner) };
    });
    function overlap(a,b){ if(!a||!b) return null; return Math.max(a.left,b.left)<Math.min(a.right,b.right) && Math.max(a.top,b.top)<Math.min(a.bottom,b.bottom); }
    console.log(vp.label, 'overlap:', overlap(info.metaBox, info.bannerBox), JSON.stringify(info));
    await page.close();
  }
  await browser.close();
  fs.rmSync(dir,{recursive:true,force:true});
})();
