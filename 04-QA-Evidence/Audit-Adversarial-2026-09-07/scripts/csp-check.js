'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const ROOT = require('path').resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const DEFAULT_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.instagram.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "frame-src https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
].join('; ');

const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.ico':'image/x-icon' };

async function main() {
  const templatesDir = path.join(ROOT, 'templates');
  const templates = fs.readdirSync(templatesDir).filter(t =>
    fs.existsSync(path.join(templatesDir, t, 'presets.json')) &&
    fs.existsSync(path.join(templatesDir, t, 'template.html')));

  const results = [];
  for (const tpl of templates) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-live-'));
    const cfg = JSON.parse(fs.readFileSync(path.join(templatesDir, tpl, 'presets.json'), 'utf8')).presets[0].config;
    siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

    const server = http.createServer((req, res) => {
      let fp = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (fp.endsWith('/')) fp = path.join(fp, 'index.html');
      if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
      if (!fs.existsSync(fp)) { res.writeHead(404); res.end('not found: ' + fp); return; }
      const ext = path.extname(fp);
      res.writeHead(200, {
        'Content-Type': (MIME[ext] || 'application/octet-stream'),
        'Content-Security-Policy': DEFAULT_CSP,
      });
      fs.createReadStream(fp).pipe(res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const consoleMsgs = [];
    page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', e => consoleMsgs.push({ type: 'pageerror', text: String(e) }));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    // Check hb-cookie-open class was applied pre-paint (i.e. inline script ran)
    const hasClass = await page.evaluate(() => document.documentElement.classList.contains('hb-cookie-open'));
    const cspViolations = consoleMsgs.filter(m => /content security policy|csp/i.test(m.text));

    results.push({ tpl, hasClass, cspViolations, allConsole: consoleMsgs });
    await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const r of results) {
    console.log('===', r.tpl, '===');
    console.log('  hb-cookie-open class present (script executed):', r.hasClass);
    console.log('  CSP violations:', r.cspViolations.length);
    r.cspViolations.forEach(v => console.log('    -', v.text));
    if (r.allConsole.length) {
      console.log('  all console/page messages:');
      r.allConsole.forEach(v => console.log('    [' + v.type + ']', v.text));
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
