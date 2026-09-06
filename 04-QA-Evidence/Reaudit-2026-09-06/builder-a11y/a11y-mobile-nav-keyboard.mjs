// Keyboard-only mobile nav check (scope #9): can the hamburger toggle be
// reached and activated with Tab+Enter (not just a pointer click), does it
// reveal the nav links, and can Escape or a repeat Enter close it again
// without trapping focus forever?
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a61ab6ab06e1bd9f0';
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));
import http from 'node:http';
import os from 'node:os';

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-nav-' + templateId + '-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'templates', templateId, 'styles.css'), path.join(tmpDir, 'styles.css'));
  const scriptPath = path.join(ROOT, 'templates', templateId, 'script.js');
  if (fs.existsSync(scriptPath)) fs.copyFileSync(scriptPath, path.join(tmpDir, 'script.js'));
  fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
  const imgDir = path.join(ROOT, 'templates', templateId, 'images');
  if (fs.existsSync(imgDir)) for (const f of fs.readdirSync(imgDir)) { const st = fs.statSync(path.join(imgDir, f)); if (st.isFile()) fs.copyFileSync(path.join(imgDir, f), path.join(tmpDir, 'images', f)); }
  return tmpDir;
}

const browser = await chromium.launch({ headless: true });

for (const tpl of ['professionals', 'portfolio', 'product-menu']) {
  console.log('\n=== ' + tpl + ' mobile nav, keyboard-only ===');
  const dir = buildExportDir(tpl);
  const server = await serveDir(dir);
  const base = 'http://127.0.0.1:' + server.address().port;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/');
  await page.waitForTimeout(300);

  // Tab through the page until we find a nav-toggle-looking button
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return { tag: el.tagName, id: el.id, cls: String(el.className || ''), aria: el.getAttribute('aria-label') || el.getAttribute('aria-expanded') };
    });
    if (info && (/toggle|hamburger|menu/i.test(info.id + info.cls + (info.aria || '')))) {
      found = true;
      console.log('  found nav toggle via Tab at press #' + (i + 1) + ':', JSON.stringify(info));
    }
  }
  if (!found) { console.log('  COULD NOT find a nav-toggle button via Tab in 15 presses'); await page.close(); server.close(); continue; }

  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const navVisibleAfterEnter = await page.evaluate(() => {
    const links = document.querySelectorAll('nav a, .pr-nav__links a, [class*="nav"] a');
    return Array.from(links).some((a) => a.offsetWidth > 0 && a.offsetHeight > 0);
  });
  console.log('  nav links visible after Enter on toggle:', navVisibleAfterEnter);

  // Tab again - should move into the now-visible nav links, not be trapped or skip
  await page.keyboard.press('Tab');
  const afterTabInfo = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 30), visible: el.offsetWidth > 0 } : null;
  });
  console.log('  focus after one more Tab:', JSON.stringify(afterTabInfo));

  // Escape should close it
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const navVisibleAfterEscape = await page.evaluate(() => {
    const links = document.querySelectorAll('nav a, .pr-nav__links a, [class*="nav"] a');
    return Array.from(links).some((a) => a.offsetWidth > 0 && a.offsetHeight > 0);
  });
  console.log('  nav links still visible after Escape:', navVisibleAfterEscape, navVisibleAfterEscape ? '(Escape does NOT close it - not necessarily a bug if there is a visible close button instead)' : '(Escape closes it)');

  await page.close();
  server.close();
}

await browser.close();
