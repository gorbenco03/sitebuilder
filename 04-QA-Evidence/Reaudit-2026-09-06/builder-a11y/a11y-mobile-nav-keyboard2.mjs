import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a61ab6ab06e1bd9f0';
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
function serveDir(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(dir, urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function buildExportDir(templateId) {
  const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')).presets[0].config));
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-nav2-' + templateId + '-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'templates', templateId, 'styles.css'), path.join(tmpDir, 'styles.css'));
  const scriptPath = path.join(ROOT, 'templates', templateId, 'script.js');
  if (fs.existsSync(scriptPath)) fs.copyFileSync(scriptPath, path.join(tmpDir, 'script.js'));
  fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
  const imgDir = path.join(ROOT, 'templates', templateId, 'images');
  if (fs.existsSync(imgDir)) for (const f of fs.readdirSync(imgDir)) { const st = fs.statSync(path.join(imgDir, f)); if (st.isFile()) fs.copyFileSync(path.join(imgDir, f), path.join(tmpDir, 'images', f)); }
  return tmpDir;
}

const CASES = {
  professionals: { toggleId: 'pr-nav-toggle', menuId: 'pr-nav-mobile' },
  portfolio: { toggleId: 'pf-nav-toggle', menuSel: null },
  'product-menu': { toggleId: 'pm-mast-burger', menuId: 'pm-mast-nav' },
};

const browser = await chromium.launch({ headless: true });
for (const [tpl, cfg] of Object.entries(CASES)) {
  console.log('\n=== ' + tpl + ' ===');
  const dir = buildExportDir(tpl);
  const server = await serveDir(dir);
  const base = 'http://127.0.0.1:' + server.address().port;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/');
  await page.waitForTimeout(300);

  const toggle = page.locator('#' + cfg.toggleId);
  const toggleExists = await toggle.count();
  console.log('toggle #' + cfg.toggleId + ' exists:', !!toggleExists);
  if (!toggleExists) { await page.close(); server.close(); continue; }

  await toggle.focus();
  const isFocused = await page.evaluate((id) => document.activeElement && document.activeElement.id === id, cfg.toggleId);
  console.log('toggle is focusable via .focus():', isFocused);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const expandedAfterEnter = await toggle.getAttribute('aria-expanded');
  console.log('aria-expanded after Enter:', expandedAfterEnter);

  await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(() => ({ tag: document.activeElement.tagName, text: (document.activeElement.textContent || '').trim().slice(0, 30) }));
  console.log('focus after Tab (should be first nav link):', JSON.stringify(afterTab));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const expandedAfterEscape = await toggle.getAttribute('aria-expanded');
  const focusAfterEscape = await page.evaluate((id) => document.activeElement && document.activeElement.id === id, cfg.toggleId);
  console.log('aria-expanded after Escape:', expandedAfterEscape, '| focus returned to toggle:', focusAfterEscape);

  await page.close();
  server.close();
}
await browser.close();
