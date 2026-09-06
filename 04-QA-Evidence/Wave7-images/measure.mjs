#!/usr/bin/env node
/**
 * Wave7 (responsive images) before/after measurement.
 *
 * Reproduces the AUDIT-2026-09-06 throttling profile (150ms RTT, 1.6Mbps
 * down / 750kbps up, CPU x4 — see 04-QA-Evidence/Audit-Fixes-2026-09-06/
 * performance/measure.mjs, which this borrows its throttle()/paint-timing
 * helpers from) so the numbers here are mechanically comparable to that
 * wave's own before/after.
 *
 * "before" = the pre-Wave7 build.js (git HEAD, read via `git show`, since
 *            Wave7's build.js changes are uncommitted on this branch) run
 *            against the ORIGINAL JPEGs only (no *.webp, no variants.json —
 *            reconstructs exactly what shipped previously: one fixed-size
 *            photo for every viewport, no width/height, no srcset).
 * "after"  = the current build.js (adds width/height + <picture>/srcset)
 *            run against the full images/ dir including the Wave7 WebP
 *            variants + manifest.
 *
 * Usage: node 04-QA-Evidence/Wave7-images/measure.mjs [templateId]
 *   (default templateId = local-service)
 * Writes 04-QA-Evidence/Wave7-images/<templateId>-{before,after}.json
 * and screenshots …-{before,after}-{390,1440}.png
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const EVDIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(EVDIR, '../..');
const templateId = process.argv[2] || 'local-service';

const THROTTLE = { latency: 150, download: 1.6 * 1024 * 1024 / 8, upload: 750 * 1024 / 8, cpu: 4 };

function mkScratch(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wave7-measure-${label}-`));
  return dir;
}

function buildScenario(label, { buildJsSource, includeWebp }) {
  const dir = mkScratch(label);
  const tplDir = path.join(ROOT, 'templates', templateId);

  fs.copyFileSync(path.join(tplDir, 'template.html'), path.join(dir, 'template.html'));
  fs.copyFileSync(path.join(tplDir, 'styles.css'), path.join(dir, 'styles.css'));
  for (const js of fs.readdirSync(tplDir).filter((f) => f.endsWith('.js'))) {
    fs.copyFileSync(path.join(tplDir, js), path.join(dir, js));
  }

  const imagesOut = path.join(dir, 'images');
  fs.mkdirSync(imagesOut, { recursive: true });
  for (const name of fs.readdirSync(path.join(tplDir, 'images'))) {
    if (!includeWebp && (name.endsWith('.webp') || name === 'variants.json')) continue;
    fs.copyFileSync(path.join(tplDir, 'images', name), path.join(imagesOut, name));
  }

  const presets = JSON.parse(fs.readFileSync(path.join(tplDir, 'presets.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presets.presets[0].config, null, 2));

  const buildJsPath = path.join(dir, '_build.js');
  fs.writeFileSync(buildJsPath, buildJsSource);
  // build.js require()s ./bot/site-legal.js by relative path from itself —
  // point it back at the real repo so that still resolves from the scratch dir.
  const patched = fs.readFileSync(buildJsPath, 'utf8').replace(
    "require('./bot/site-legal.js')",
    `require(${JSON.stringify(path.join(ROOT, 'bot', 'site-legal.js'))})`
  );
  fs.writeFileSync(buildJsPath, patched);
  execFileSync(process.execPath, [buildJsPath, dir], { cwd: ROOT, stdio: 'pipe' });

  return dir;
}

function serveStatic(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const abs = path.join(dir, p);
    if (!abs.startsWith(dir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(abs).toLowerCase();
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
      '.json': 'application/json', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(abs).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function throttle(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false, latency: THROTTLE.latency, downloadThroughput: THROTTLE.download, uploadThroughput: THROTTLE.upload,
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE.cpu });
}

const INIT_SCRIPT = () => {
  window.__perf = { lcp: null, cls: 0 };
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__perf.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
};

async function measureViewport(base, viewport, screenshotPath, deviceScaleFactor) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  await page.addInitScript(INIT_SCRIPT);
  const responses = [];
  page.on('requestfinished', async (req) => {
    try {
      const r = await req.response();
      if (!r) return;
      const headers = r.headers();
      let bytes = headers['content-length'] ? parseInt(headers['content-length'], 10) : null;
      if (bytes == null) { try { bytes = (await r.body()).length; } catch { bytes = 0; } }
      responses.push({ url: req.url(), bytes: bytes || 0, type: req.resourceType() });
    } catch (e) {}
  });
  await throttle(page);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(500);
  const initialImageBytes = responses.filter((r) => r.type === 'image').reduce((s, r) => s + r.bytes, 0);
  const initialTotalBytes = responses.reduce((s, r) => s + r.bytes, 0);

  await page.screenshot({ path: screenshotPath, fullPage: false });

  // Scroll to the bottom in several steps (each paused long enough for the
  // IntersectionObserver behind loading="lazy" to fire before the next jump)
  // to trigger every lazy gallery/Instagram image, for a "full page weight"
  // figure alongside the above-the-fold one. Then wait, under heavy
  // throttling, until the in-flight request count actually stops growing
  // (fixed short waits under 1.6Mbps/CPUx4 were observed to cut off slow
  // image downloads that had only just started).
  const steps = await page.evaluate(() => Math.max(1, Math.ceil(document.body.scrollHeight / 500)));
  for (let i = 0; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 500);
    await page.waitForTimeout(250);
  }
  let lastCount = -1;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(600);
    if (responses.length === lastCount) break;
    lastCount = responses.length;
  }
  const fullImageBytes = responses.filter((r) => r.type === 'image').reduce((s, r) => s + r.bytes, 0);
  const fullTotalBytes = responses.reduce((s, r) => s + r.bytes, 0);

  const perf = await page.evaluate(() => window.__perf);

  await browser.close();
  return {
    viewport, lcpMs: perf.lcp, cls: perf.cls,
    aboveFold: { imageBytes: initialImageBytes, totalBytes: initialTotalBytes },
    fullPage: { imageBytes: fullImageBytes, totalBytes: fullTotalBytes },
    requestCount: responses.length,
  };
}

async function runScenario(label, dir) {
  const server = await serveStatic(dir);
  const base = `http://127.0.0.1:${server.address().port}`;
  const results = {};
  // deviceScaleFactor picked to match the real-world device each viewport
  // stands in for — 390 CSS px is the iPhone 12/13/14 width (DPR 3), 1440 is
  // a common MacBook/retina-external-display width (DPR 2) — rather than
  // Playwright's DPR-1 default, which would understate what a srcset
  // actually serves a real phone/desktop at these sizes.
  const scenarios = [
    ['390', { width: 390, height: 844 }, 3],
    ['1440', { width: 1440, height: 900 }, 2],
  ];
  for (const [name, viewport, dsf] of scenarios) {
    const shot = path.join(EVDIR, `${templateId}-${label}-${name}.png`);
    results[name] = await measureViewport(base, viewport, shot, dsf);
    console.log(label, name, `(DPR ${dsf})`, JSON.stringify(results[name]));
  }
  server.close();
  return results;
}

const oldBuildJsSource = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:build.js'], { maxBuffer: 5 * 1024 * 1024 }).toString('utf8');
const newBuildJsSource = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');

const beforeDir = buildScenario('before', { buildJsSource: oldBuildJsSource, includeWebp: false });
const afterDir = buildScenario('after', { buildJsSource: newBuildJsSource, includeWebp: true });

const before = await runScenario('before', beforeDir);
const after = await runScenario('after', afterDir);

const summary = { templateId, throttle: THROTTLE, generatedAt: new Date().toISOString(), before, after };
fs.writeFileSync(path.join(EVDIR, `${templateId}-summary.json`), JSON.stringify(summary, null, 2));
console.log('\nWrote', path.join(EVDIR, `${templateId}-summary.json`));
