'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');

function relLum(c) {
  const f = c.map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
  return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];
}

async function measure(page, textSel) {
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    el.style.visibility = 'hidden';
    return { rect:{x:r.x,y:r.y,w:r.width,h:r.height}, fg: cs.color, fontPx: parseFloat(cs.fontSize) };
  }, textSel);
  if (!info) return null;
  const vp = page.viewportSize();
  const clip = {
    x: Math.max(0, info.rect.x), y: Math.max(0, info.rect.y),
    width: Math.max(8, Math.min(vp.width - Math.max(0, info.rect.x), info.rect.w)),
    height: Math.max(8, Math.min(vp.height - Math.max(0, info.rect.y), info.rect.h)),
  };
  const shot = await page.screenshot({ clip });
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.style.visibility = ''; }, textSel);
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,'+b64; await img.decode();
    const c = document.createElement('canvas'); c.width=img.width; c.height=img.height;
    c.getContext('2d').drawImage(img,0,0);
    const d = c.getContext('2d').getImageData(0,0,img.width,img.height).data;
    const out = []; for (let i=0;i<d.length;i+=4) out.push([d[i],d[i+1],d[i+2]]);
    return out;
  }, shot.toString('base64'));
  const fg = info.fg.match(/[\d.]+/g).map(Number).slice(0,3);
  const lf = relLum(fg);
  const ratios = pixels.map(c => { const lb = relLum(c); return (Math.max(lf,lb)+0.05)/(Math.min(lf,lb)+0.05); }).sort((a,b)=>a-b);
  return { worst: ratios[0], p10: ratios[Math.floor(ratios.length*0.10)], fontPx: info.fontPx };
}

async function run(ROOT, tpl, textSels, bgSel) {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heroI2-'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT,'templates',tpl,'presets.json'),'utf8')).presets[0].config;
  siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('file://'+path.join(dir,'index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const c = document.getElementById('hb-cookie-banner'); if (c) c.style.display='none'; });
  for (const condition of ['seed photo', 'light photo']) {
    if (condition === 'light photo') {
      await page.evaluate((sel) => {
        document.querySelectorAll(sel).forEach(e => { e.style.setProperty('background', '#ffffff', 'important'); e.style.setProperty('background-image','none','important'); });
      }, bgSel);
      await page.waitForTimeout(250);
    }
    for (const sel of textSels) {
      const m = await measure(page, sel);
      if (!m) { console.log(ROOT, tpl, condition, sel, 'NOT FOUND'); continue; }
      console.log(path.basename(ROOT), tpl, condition, sel, `p10=${m.p10.toFixed(2)} worst=${m.worst.toFixed(2)} font=${Math.round(m.fontPx)}px`);
    }
  }
  await page.close();
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  await run('/tmp/at-6df5387', 'portfolio', ['.pf-hero__word','.pf-hero__tag'], '.pf-hero__bg');
  await run('/tmp/at-6df5387', 'local-service', ['.ls-hero__name','.ls-hero__tag'], '.ls-hero__media');
  await run('/tmp/at-c6b7277', 'portfolio', ['.pf-hero__word','.pf-hero__tag'], '.pf-hero__bg');
})();
