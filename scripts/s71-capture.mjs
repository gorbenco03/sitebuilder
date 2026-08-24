#!/usr/bin/env node
/**
 * Headless capture for S71 landing evidence.
 * Prefers playwright if installed; falls back to puppeteer-core + system chrome.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../04-QA-Evidence/S71-remake');
fs.mkdirSync(outDir, { recursive: true });
const url = process.env.S71_URL || 'http://127.0.0.1:8765/app/';

async function withPlaywright() {
  const require = createRequire(import.meta.url);
  let pw;
  try {
    pw = require('playwright');
  } catch {
    try {
      pw = require('playwright-core');
    } catch {
      return null;
    }
  }
  const launchOpts = { headless: true };
  if (process.env.S71_CHROME_PATH) {
    launchOpts.executablePath = process.env.S71_CHROME_PATH;
  } else if (process.env.S71_CHROME_CHANNEL) {
    launchOpts.channel = process.env.S71_CHROME_CHANNEL;
  } else {
    // Prefer installed Brave / Chrome on this host
    const candidates = [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    const hit = candidates.find((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    if (hit) launchOpts.executablePath = hit;
    else launchOpts.channel = 'chrome';
  }
  const browser = await pw.chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  // Allow catalog iframes / stage paint
  await page.waitForTimeout(3500);
  try {
    await page.waitForSelector('#templates-grid .template-card', { timeout: 15000 });
  } catch { /* continue */ }

  const headerCtaDisplay1440 = await page.evaluate(() => {
    const el = document.querySelector('#header-cta');
    return el ? getComputedStyle(el).display : null;
  });

  const metricsBase = await page.evaluate(() => ({
    title: document.title,
    bg: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontFamily,
    h1: document.querySelector('.hero-title')?.textContent?.trim(),
    badge: !!document.querySelector('.hero-badge'),
    techBadgeText: document.body.innerText.includes('Builder + hosting'),
    indigoCss: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    paper: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    chips: document.querySelectorAll('.catalog-chip').length,
    cards: document.querySelectorAll('.template-card').length,
    stage: !!document.querySelector('.hero-stage-stack'),
    how: !!document.querySelector('#cum-e'),
  }));

  await page.screenshot({ path: path.join(outDir, 'landing-desktop-1440.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  // Longer wait after resize so layout + catalog iframes settle
  await page.waitForTimeout(2500);
  const headerCtaDisplay390 = await page.evaluate(() => {
    const el = document.querySelector('#header-cta');
    return el ? getComputedStyle(el).display : null;
  });
  await page.screenshot({ path: path.join(outDir, 'landing-mobile-390.png'), fullPage: true });

  // Catalog crop at desktop after another settle
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2000);
  const grid = await page.$('#templates-grid');
  if (grid) await grid.screenshot({ path: path.join(outDir, 'catalog-grid.png') });
  await browser.close();

  return {
    ...metricsBase,
    headerCtaDisplay390,
    headerCtaDisplay1440,
  };
}

async function main() {
  let metrics = await withPlaywright();
  if (!metrics) {
    console.error('playwright not available locally');
    process.exit(2);
  }
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  const fails = [];
  if (metrics.badge) fails.push('hero-badge still present');
  if (metrics.techBadgeText) fails.push('tech badge text present');
  if (String(metrics.indigoCss).toUpperCase().includes('5B5BD6')) fails.push('accent still indigo');
  if (metrics.headerCtaDisplay390 !== 'none') {
    fails.push(`header-cta @390 expected none got ${metrics.headerCtaDisplay390}`);
  }
  if (!metrics.headerCtaDisplay1440 || metrics.headerCtaDisplay1440 === 'none') {
    fails.push(`header-cta @1440 expected visible got ${metrics.headerCtaDisplay1440}`);
  }
  if (fails.length) {
    console.error('VERIFY FAIL', fails);
    process.exit(1);
  }
  console.log('S71 capture OK →', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
