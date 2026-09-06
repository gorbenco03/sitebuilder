// Re-check WCAG AA contrast, 24x24 touch targets, and 200%-zoom reflow on
// REAL RENDERED PIXELS for desserdirina and product-menu — the two templates
// that lack a dedicated wave5-*-a11y.test.js oracle in this repo (professionals,
// portfolio and local-service each have one; these two don't). Also specifically
// re-checks the exact desserdirina elements named in the original audit's
// A11Y-05 finding (04-QA-Evidence/Audit-2026-09-06-2225ca7/a11y/findings.json):
// eyebrow text, EN/RO language toggle, category titles ("Torturi" etc.) — all
// were using a too-light brand pink (~#D14477-ish) at the time of that audit.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a61ab6ab06e1bd9f0/node_modules/playwright');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a61ab6ab06e1bd9f0';
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' };

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

function buildExportDir(templateId, extraCopy) {
  const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')).presets[0].config));
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-' + templateId + '-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'templates', templateId, 'styles.css'), path.join(tmpDir, 'styles.css'));
  const scriptPath = path.join(ROOT, 'templates', templateId, 'script.js');
  if (fs.existsSync(scriptPath)) fs.copyFileSync(scriptPath, path.join(tmpDir, 'script.js'));
  fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
  const imgDir = path.join(ROOT, 'templates', templateId, 'images');
  if (fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir)) {
      const stat = fs.statSync(path.join(imgDir, f));
      if (stat.isFile()) fs.copyFileSync(path.join(imgDir, f), path.join(tmpDir, 'images', f));
    }
  }
  return tmpDir;
}

/* eslint-disable */
function browserContrastCheck(selectors) {
  function parseColor(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function effectiveBg(el) {
    let node = el;
    const layers = [];
    while (node) {
      const bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 0.999) break; }
      node = node.parentElement;
    }
    let result = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const c = layers[i];
      result = { r: c.r * c.a + result.r * (1 - c.a), g: c.g * c.a + result.g * (1 - c.a), b: c.b * c.a + result.b * (1 - c.a) };
    }
    return result;
  }
  function relLum({ r, g, b }) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(c1, c2) {
    const L1 = relLum(c1), L2 = relLum(c2);
    const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (a + 0.05) / (b + 0.05);
  }
  const out = [];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (!els.length) { out.push({ sel, missing: true }); continue; }
    els.forEach((el, idx) => {
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      const bg = effectiveBg(el);
      const fgEffective = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) } : fg;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = isLarge ? 3 : 4.5;
      const r = ratio(fgEffective, bg);
      out.push({ sel: sel + (els.length > 1 ? '[' + idx + ']' : ''), ratio: Math.round(r * 100) / 100, required, pass: r >= required, text: (el.textContent || '').trim().slice(0, 40) });
    });
  }
  return out;
}
/* eslint-enable */

async function checkTemplate(browser, templateId, selectors, mobileToggleSelector) {
  console.log('\n########## ' + templateId + ' ##########');
  const tmpDir = buildExportDir(templateId);
  const server = await serveDir(tmpDir);
  const base = 'http://127.0.0.1:' + server.address().port;

  // Contrast
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base + '/');
  await page.waitForTimeout(200);
  const results = await page.evaluate(browserContrastCheck, selectors);
  const failures = results.filter((r) => r.pass === false);
  const missing = results.filter((r) => r.missing);
  console.log('CONTRAST failures:', failures.length);
  failures.forEach((f) => console.log('  FAIL', f.sel, f.ratio + ':1 (need ' + f.required + ':1)', JSON.stringify(f.text)));
  if (missing.length) console.log('  (selectors not found on page:', missing.map((m) => m.sel).join(', '), ')');

  // Touch targets desktop
  const failsDesktop = await page.evaluate(() => {
    function inlineExempt(el) { return el.tagName === 'A' && !!el.closest('p'); }
    return Array.from(document.querySelectorAll('a[href], button, summary, input[type="radio"]'))
      .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .filter((el) => !inlineExempt(el))
      .map((el) => {
        const box = el.getBoundingClientRect();
        return { tag: el.tagName, cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 30), w: Math.round(box.width), h: Math.round(box.height) };
      })
      .filter((r) => r.w > 0 && r.h > 0 && (r.w < 24 || r.h < 24));
  });
  console.log('TOUCH TARGET <24x24 (desktop):', failsDesktop.length);
  failsDesktop.forEach((f) => console.log('  FAIL', f.tag, f.cls, JSON.stringify(f.text), f.w + 'x' + f.h));
  await page.close();

  // Touch targets mobile (menu open if toggle given)
  const pageM = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pageM.goto(base + '/');
  await pageM.waitForTimeout(200);
  if (mobileToggleSelector) {
    const toggle = pageM.locator(mobileToggleSelector);
    if (await toggle.count().catch(() => 0)) await toggle.click().catch(() => {});
    await pageM.waitForTimeout(200);
  }
  const failsMobile = await pageM.evaluate(() => {
    function inlineExempt(el) { return el.tagName === 'A' && !!el.closest('p'); }
    return Array.from(document.querySelectorAll('a[href], button, summary, input[type="radio"]'))
      .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .filter((el) => !inlineExempt(el))
      .map((el) => {
        const box = el.getBoundingClientRect();
        return { tag: el.tagName, cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 30), w: Math.round(box.width), h: Math.round(box.height) };
      })
      .filter((r) => r.w > 0 && r.h > 0 && (r.w < 24 || r.h < 24));
  });
  console.log('TOUCH TARGET <24x24 (mobile, menu open):', failsMobile.length);
  failsMobile.forEach((f) => console.log('  FAIL', f.tag, f.cls, JSON.stringify(f.text), f.w + 'x' + f.h));
  await pageM.close();

  // Zoom reflow
  for (const width of [640, 320]) {
    const pageZ = await browser.newPage({ viewport: { width, height: 900 } });
    await pageZ.goto(base + '/');
    await pageZ.waitForTimeout(200);
    const overflow = await pageZ.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    const ok = overflow.scrollWidth <= overflow.clientWidth + 1;
    console.log('ZOOM REFLOW @' + width + 'px:', ok ? 'OK' : ('HORIZONTAL SCROLL scrollWidth=' + overflow.scrollWidth + ' clientWidth=' + overflow.clientWidth));
    await pageZ.close();
  }

  server.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  await checkTemplate(browser, 'desserdirina', [
    '.section-eyebrow', '.hero-tagline', '.menu-lang-btn', '.menu-lang-btn.is-active',
    '.category-title', '.category-blurb', '.section-title', '.service-label',
    '.contact-item', '.footer-info', '.hb-legal-links a', '.hb-built-by', '.menu-cat',
  ], null);

  await checkTemplate(browser, 'product-menu', [
    '.section-eyebrow', '.hero-tagline', '.category-title', '.section-title',
    '.service-label', '.contact-item', '.footer-info', '.hb-legal-links a', '.hb-built-by',
    'nav a', '.menu-cat', '.pm-tickets .service-card',
  ], null);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
