'use strict';
/**
 * wave5-portfolio-cls — oracle for the portfolio template's Cumulative Layout
 * Shift (CLS), audit 2026-09-06 (04-QA-Evidence/Audit-2026-09-06-2225ca7).
 *
 * The audit measured CLS 0.20 desktop / 0.17 mobile on a published site and
 * blamed unsized images. By the time this wave started, an earlier perf wave
 * had already reserved space for every content image via CSS aspect-ratio
 * boxes (see templates/portfolio/styles.css: .pf-frame img, .pf-person__pic
 * img, .pf-ig__cell img all set `aspect-ratio`). Measuring the actual
 * published output under the audit's own throttling methodology (150ms RTT,
 * 1.6Mbps down, CPU x4) still showed real CLS: ~0.09 desktop / ~0.13 mobile,
 * with `hero-content`/`scroll-hint` as the reported shift sources.
 *
 * Root cause (found by bisecting which of the site's four scripts caused it):
 * `cookie-banner.css` is a shared, render-blocking stylesheet whose rules gate
 * extra hero-copy clearance padding on `html.hb-cookie-open` /
 * `body:has(#hb-cookie-banner:not([hidden]))` (so the fixed consent card never
 * overlaps the hero CTA). templates/portfolio/template.html linked that
 * stylesheet at the END of body, so on a throttled connection it arrived and
 * applied well AFTER the hero had already painted with its smaller base
 * padding — the clearance snapped in late and shoved hero-content/scroll-hint
 * down, registering as a real layout shift.
 *
 * Fix (both required — verified independently, see the fix commit for detail):
 *   1. Moved the `<link rel="stylesheet" href="cookie-banner.css">` into
 *      <head> next to styles.css, so it is part of the initial
 *      render-blocking stylesheet set instead of arriving late.
 *   2. Added a synchronous inline <head> script that mirrors cookie-banner.js's
 *      own `accepted()` check (same localStorage/cookie key) and sets
 *      `html.hb-cookie-open` BEFORE first paint when consent hasn't been
 *      given — so the correct clearance variant is chosen on the very first
 *      layout instead of being toggled on after cookie-banner.js runs later.
 *   cookie-banner.css / cookie-banner.js content itself is untouched (shared,
 *   out of this template's ownership) — only where/when template.html
 *   references it, and a read-only mirror of its own published logic.
 *
 * This oracle builds the REAL production output (via build.js's `build()`,
 * which also generates cookie-banner.css/js exactly like a real publish),
 * once from the git HEAD (pre-fix) sources and once from the current working
 * tree, and measures CLS with Playwright's Chromium (node_modules) at 1440
 * and 390 wide under the audit's throttling profile.
 *
 * Run: node bot/test/wave5-portfolio-cls.test.js
 * Evidence: 04-QA-Evidence/Wave5-portfolio/performance/
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');


// The pre-fix baseline is pinned to the commit this wave branched from, not
// to HEAD. Using HEAD meant the oracle asserted "the bug is present at HEAD",
// which stops being true the moment the fix is merged -- the check would then
// fail forever, for the wrong reason. Override with HIDOOK_BEFORE_REF.
const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || '8a13c19';
const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave5-portfolio', 'performance');
const TPL_DIR = path.join(ROOT, 'templates', 'portfolio');
const PRESET_ID = 'atelier-ivoire-ro';
const TEMPLATE_FILES = ['template.html', 'styles.css', 'script.js', 'collage.js', 'qrcode.js'];

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

function loadPlaywright() {
  // Bare specifier: Node's CJS resolver walks up parent directories on its
  // own, so this finds node_modules/playwright whether it lives at ROOT or
  // (as in a git worktree checkout, which has no node_modules of its own) in
  // an ancestor directory. Never fall back to a hardcoded browser path.
  return require('playwright');
}

/** Read a template file's content at a given git ref ("HEAD" = before this wave's edits). */
function readAtRef(ref, relFile) {
  return execSync(`git show ${ref}:templates/portfolio/${relFile}`, { cwd: ROOT, encoding: 'utf8' });
}

function readWorkingTree(relFile) {
  return fs.readFileSync(path.join(TPL_DIR, relFile), 'utf8');
}

/** Build a full site directory (index.html + cookie-banner.css/js + legal pages) for one variant. */
function buildVariant(label, fileReader) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-portfolio-cls-' + label + '-'));
  for (const name of TEMPLATE_FILES) {
    fs.writeFileSync(path.join(dir, name), fileReader(name), 'utf8');
  }
  const imagesDir = path.join(TPL_DIR, 'images');
  fs.cpSync(imagesDir, path.join(dir, 'images'), { recursive: true });

  const presets = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'presets.json'), 'utf8')).presets;
  const preset = presets.find((p) => p.id === PRESET_ID);
  assert.ok(preset, 'preset "' + PRESET_ID + '" must exist in presets.json');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(preset.config, null, 2), 'utf8');

  // Use build.js exactly like a real publish would (also writes cookie-banner
  // .css/.js + privacy/terms/cookies.html via bot/site-legal.js).
  const { build } = require(path.join(ROOT, 'build.js'));
  build(dir);
  assert.ok(fs.existsSync(path.join(dir, 'index.html')), 'build() must produce index.html');
  assert.ok(fs.existsSync(path.join(dir, 'cookie-banner.css')), 'build() must produce cookie-banner.css');
  return dir;
}

function serveDir(dir) {
  const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json',
  };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(dir, p);
    if (!fp.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const CLS_INIT = () => {
  window.__perf = { cls: 0, lcp: null };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__perf.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
};

async function measureCls(browser, base, viewport, screenshotPath) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(CLS_INIT);
  // Reproduce the audit's own throttling methodology so numbers are comparable.
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const perf = await page.evaluate(() => window.__perf);
  if (screenshotPath) await page.screenshot({ path: screenshotPath });
  await context.close();
  return perf;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = loadPlaywright();

  const beforeDir = buildVariant('before', (name) => readAtRef(BEFORE_REF, name));
  const afterDir = buildVariant('after', (name) => readWorkingTree(name));

  const beforeServer = await serveDir(beforeDir);
  const afterServer = await serveDir(afterDir);
  const beforeBase = 'http://127.0.0.1:' + beforeServer.address().port;
  const afterBase = 'http://127.0.0.1:' + afterServer.address().port;

  const results = { before: {}, after: {} };

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const viewports = [
        { key: 'desktop1440', viewport: { width: 1440, height: 900 } },
        { key: 'mobile390', viewport: { width: 390, height: 844 } },
      ];

      for (const { key, viewport } of viewports) {
        results.before[key] = await measureCls(
          browser, beforeBase, viewport,
          path.join(EVIDENCE, 'before-' + key + '.png')
        );
        results.after[key] = await measureCls(
          browser, afterBase, viewport,
          path.join(EVIDENCE, 'after-' + key + '.png')
        );
        console.log('CLS', key, 'before=' + results.before[key].cls.toFixed(4), 'after=' + results.after[key].cls.toFixed(4));
      }
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((r) => beforeServer.close(r));
    await new Promise((r) => afterServer.close(r));
    fs.rmSync(beforeDir, { recursive: true, force: true });
    fs.rmSync(afterDir, { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(EVIDENCE, 'summary.json'), JSON.stringify(results, null, 2));

  await check('before (git HEAD): desktop CLS reproduces the real regression (> 0.05)', () => {
    assert.ok(results.before.desktop1440.cls > 0.05,
      'expected a real pre-fix shift on desktop, got CLS=' + results.before.desktop1440.cls);
  });
  await check('before (git HEAD): mobile CLS reproduces the real regression (> 0.05)', () => {
    assert.ok(results.before.mobile390.cls > 0.05,
      'expected a real pre-fix shift on mobile, got CLS=' + results.before.mobile390.cls);
  });
  await check('after (working tree): desktop CLS is at/near zero (< 0.02, "good" threshold is 0.1)', () => {
    assert.ok(results.after.desktop1440.cls < 0.02,
      'expected the fix to eliminate the shift on desktop, got CLS=' + results.after.desktop1440.cls);
  });
  await check('after (working tree): mobile CLS is at/near zero (< 0.02, "good" threshold is 0.1)', () => {
    assert.ok(results.after.mobile390.cls < 0.02,
      'expected the fix to eliminate the shift on mobile, got CLS=' + results.after.mobile390.cls);
  });

  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('OK wave5-portfolio-cls (hero clearance CLS regression fixed)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
