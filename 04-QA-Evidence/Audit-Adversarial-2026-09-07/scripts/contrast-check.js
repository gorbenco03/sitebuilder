'use strict';
const path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

function lin(c){ c=c/255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
function lum(r,g,b){ return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); }
function contrast(c1,c2){ let l1=lum(...c1), l2=lum(...c2); if(l1<l2)[l1,l2]=[l2,l1]; return (l1+0.05)/(l2+0.05); }

async function main(){
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  await page.setContent(`<div id="card" style="background:#111;color:#f5f5f5">card text</div>
  <button id="btn" style="background:#f5f5f5;color:#111">Accept</button>`);
  const cardBg = await page.$eval('#card', el => getComputedStyle(el).backgroundColor);
  const cardFg = await page.$eval('#card', el => getComputedStyle(el).color);
  const btnBg = await page.$eval('#btn', el => getComputedStyle(el).backgroundColor);
  const btnFg = await page.$eval('#btn', el => getComputedStyle(el).color);
  console.log({cardBg, cardFg, btnBg, btnFg});
  const parse = (s) => s.match(/\d+/g).slice(0,3).map(Number);
  console.log('card contrast:', contrast(parse(cardBg), parse(cardFg)).toFixed(2));
  console.log('btn contrast:', contrast(parse(btnBg), parse(btnFg)).toFixed(2));
  await browser.close();
}
main();
