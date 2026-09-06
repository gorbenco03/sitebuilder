'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..'); // pass a throwaway worktree path here to check historical commits (see FINDINGS.md)
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfoverlap-'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT,'templates','portfolio','presets.json'),'utf8')).presets[0].config;
  siteExport.buildStaticSiteTree({ templateId: 'portfolio', config: cfg, images: [], siteDir: dir });
  const browser = await chromium.launch({ headless: true });
  for (const vp of [{w:1440,h:900,label:'desktop'},{w:390,h:844,label:'mobile'}]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto('file://'+path.join(dir,'index.html'), { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      function box(el){ if(!el) return null; const r = el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}; }
      const hint = document.querySelector('.scroll-hint');
      const label = document.querySelector('.scroll-hint__label');
      const banner = document.getElementById('hb-cookie-banner');
      return { hintBox: box(hint), labelBox: box(label), bannerBox: box(banner) };
    });
    function overlap(a,b) {
      if (!a || !b) return null;
      const x = Math.max(a.left,b.left) < Math.min(a.right,b.right);
      const y = Math.max(a.top,b.top) < Math.min(a.bottom,b.bottom);
      return x && y;
    }
    console.log(vp.label, JSON.stringify(info), 'label-banner overlap:', overlap(info.labelBox, info.bannerBox), 'hint-banner overlap:', overlap(info.hintBox, info.bannerBox));
    await page.close();
  }
  await browser.close();
  fs.rmSync(dir,{recursive:true,force:true});
})();
