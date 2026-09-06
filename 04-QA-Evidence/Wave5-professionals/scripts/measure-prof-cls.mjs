// Measures CLS/LCP for the professionals template rendered via the real
// renderHtml() pipeline, served as a static export would be, at 1440 and 390.
// Usage: node measure-prof-cls.mjs <label> <templateHtmlPath> <stylesCssPath> <scriptJsPath> <outJsonPath>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a21dfa8b0715457a4';
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const [, , label, templateHtmlPath, stylesCssPath, scriptJsPath, outJsonPath] = process.argv;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png' };

function serveDir(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(dir, p);
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function measure(browser, base, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__perf = { lcp: null, cls: 0, shifts: [] };
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__perf.lcp = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) {
            window.__perf.cls += e.value;
            window.__perf.shifts.push({
              value: e.value,
              time: e.startTime,
              sources: (e.sources || []).map((s) => s.node ? s.node.tagName + (s.node.className ? '.' + String(s.node.className).split(' ').join('.') : '') : null),
            });
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  });
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150,
    downloadThroughput: 1.6 * 1024 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(base + '/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(4000);
  const perf = await page.evaluate(() => window.__perf);
  await context.close();
  return perf;
}

async function main() {
  const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config));
  const templateHtml = fs.readFileSync(templateHtmlPath, 'utf8');
  const html = renderHtml(templateHtml, config);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-cls-' + label + '-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  fs.copyFileSync(stylesCssPath, path.join(tmpDir, 'styles.css'));
  fs.copyFileSync(scriptJsPath, path.join(tmpDir, 'script.js'));
  fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(tmpDir, 'images/hero.jpg'));

  const server = await serveDir(tmpDir);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });

  const desktop = await measure(browser, base, { width: 1440, height: 1000 });
  const mobile = await measure(browser, base, { width: 390, height: 844 });

  await browser.close();
  server.close();

  const result = { label, generatedAt: new Date().toISOString(), desktop, mobile };
  console.log(JSON.stringify(result, null, 2));
  if (outJsonPath) fs.writeFileSync(outJsonPath, JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
