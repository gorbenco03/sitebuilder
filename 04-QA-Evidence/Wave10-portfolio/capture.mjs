// 04-QA-Evidence/Wave10-portfolio/capture.mjs
//
// Evidence capture for the Wave10 portfolio (Salon) polish pass: full-page
// screenshots of portfolio BEFORE (git ref 20a3a2b, this wave's starting
// commit) and AFTER (current working tree) at 1440px and 390px, plus the
// same captures of local-service (unchanged, for side-by-side comparison —
// this is the template the task brief named as the 9/10 bar) — not part of
// the product, scratch evidence only. Uses the real build.js render + the
// same wave10-portfolio-helpers.js buildSite() harness the automated oracles
// use, so what's captured here is exactly what the CLS/contrast/grid tests
// measured, not a hand-rolled approximation.
//
// Run: node --experimental-sqlite 04-QA-Evidence/Wave10-portfolio/capture.mjs
'use strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = __dirname;

const { buildSite, serveDir } = require(path.join(ROOT, 'bot/test/wave10-portfolio-helpers.js'));

function buildOtherTemplateSite(templateName, presetIndex = 0) {
  const TEMPLATE_DIR = path.join(ROOT, 'templates', templateName);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wave10-cmp-${templateName}-`));
  for (const name of fs.readdirSync(TEMPLATE_DIR)) {
    const src = path.join(TEMPLATE_DIR, name);
    if (fs.statSync(src).isDirectory()) {
      const dst = path.join(dir, name);
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s2 = path.join(src, f);
        if (fs.statSync(s2).isFile()) fs.copyFileSync(s2, path.join(dst, f));
      }
    } else if (name !== 'presets.json' && name !== 'schema.json') {
      fs.copyFileSync(src, path.join(dir, name));
    }
  }
  const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'presets.json'), 'utf8')).presets;
  const presetConfig = JSON.parse(JSON.stringify(presets[presetIndex].config));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presetConfig, null, 2));
  const { build } = require(path.join(ROOT, 'build.js'));
  build(dir);
  return dir;
}

async function shoot(browser, dir, outPrefix) {
  const { base, close } = await serveDir(dir);
  try {
    for (const vp of [{ w: 1440, h: 1000, name: '1440' }, { w: 390, h: 844, name: '390' }]) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.goto(base + '/index.html', { waitUntil: 'networkidle', timeout: 30000 });
      const total = await page.evaluate(() => document.body.scrollHeight);
      for (let y = 0; y < total; y += 600) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${outPrefix}-${vp.name}.png`), fullPage: true });
      await page.close();
      console.log('  wrote', `${outPrefix}-${vp.name}.png`);
    }
  } finally {
    await close();
  }
}

async function main() {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
  const browser = await chromium.launch({ headless: true });

  console.log('portfolio BEFORE (20a3a2b)...');
  const before = buildSite({ state: 'before', presetIndex: 0 });
  await shoot(browser, before.dir, 'portfolio-before');

  console.log('portfolio AFTER (working tree)...');
  const after = buildSite({ state: 'after', presetIndex: 0 });
  await shoot(browser, after.dir, 'portfolio-after');

  console.log('local-service (comparison, unchanged)...');
  const ls = buildOtherTemplateSite('local-service', 0);
  await shoot(browser, ls, 'local-service-comparison');

  await browser.close();
  console.log('done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
