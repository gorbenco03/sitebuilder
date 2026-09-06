'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prof720-'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT,'templates','professionals','presets.json'),'utf8')).presets[0].config;
  siteExport.buildStaticSiteTree({ templateId: 'professionals', config: cfg, images: [], siteDir: dir });
  const browser = await chromium.launch({ headless: true });
  for (const vp of [{w:720,h:450,label:'720x450'}, {w:900,h:560,label:'900x560'}, {w:600,h:375,label:'600x375'}]) {
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
    console.log(vp.label, JSON.stringify(info), 'overlap:', overlap(info.metaBox, info.bannerBox));
    await page.close();
  }
  await browser.close();
  fs.rmSync(dir,{recursive:true,force:true});
})();
