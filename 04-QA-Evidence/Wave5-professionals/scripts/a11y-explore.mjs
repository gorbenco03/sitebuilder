import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a21dfa8b0715457a4';
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg' };
function serveDir(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      fs.readFile(path.join(dir, p), (err, data) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const config = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config));
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-a11y-explore-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'templates/professionals/styles.css'), path.join(tmpDir, 'styles.css'));
  fs.copyFileSync(path.join(ROOT, 'templates/professionals/script.js'), path.join(tmpDir, 'script.js'));
  fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'templates/professionals/images/hero.jpg'), path.join(tmpDir, 'images/hero.jpg'));

  const server = await serveDir(tmpDir);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(base + '/');
    await page.waitForTimeout(200);
    // expand faq + open mobile menu if present so hidden targets aren't missed
    if (viewport.width < 820) {
      const toggle = await page.$('#pr-nav-toggle');
      if (toggle) await toggle.click();
    }

    const results = await page.evaluate(() => {
      function isInFlowingText(el) {
        // WCAG 2.5.8 exception: target is inline within a sentence/paragraph
        const p = el.closest('p, .pr-appt__fallback, .hb-cookie-banner p, li > span');
        return !!p && el.tagName === 'A' && !el.className.includes('pr-contact__row');
      }
      const nodes = Array.from(document.querySelectorAll('a[href], button, summary, input[type="radio"]'));
      return nodes
        .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
        .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
        .map((el) => {
          const box = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            cls: el.className && el.className.toString().slice(0, 60),
            id: el.id,
            text: (el.textContent || '').trim().slice(0, 30),
            w: Math.round(box.width),
            h: Math.round(box.height),
            inlineExempt: isInFlowingText(el),
          };
        })
        .filter((r) => r.w > 0 && r.h > 0);
    });

    console.log('=== viewport', viewport.width, '===');
    for (const r of results) {
      const fail = (r.w < 24 || r.h < 24) && !r.inlineExempt;
      if (fail) console.log('FAIL', JSON.stringify(r));
    }
    await page.close();
  }

  // ---- contrast pass (desktop only, sections differ little by viewport) ----
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base + '/');
  await page.waitForTimeout(200);
  const contrast = await page.evaluate(() => {
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
    const selectors = [
      '.pr-nav__links a', '.pr-nav__cta', '.pr-kicker', '.pr-lede', '.pr-copy',
      '.pr-svc__title', '.pr-btn--primary', '.pr-btn--ghost', '.pr-steps__title',
      '.pr-cred__list li', '.pr-faq__q', '.pr-contact__row', '.pr-foot__name',
      '.pr-copy--sm', '.pr-label', '.pr-type__meta', '.pr-hero__meta', '.pr-strip__item',
      '.pr-sec--book .pr-copy', '.pr-sec--book .pr-btn--primary', '.pr-sec--book .pr-btn--ghost',
      '.pr-appt-done__title', '.pr-appt__fail-title', '.pr-scroll', '.hb-legal-links a', '.hb-built-by',
    ];
    const out = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) { out.push({ sel, missing: true }); continue; }
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      const bg = effectiveBg(el);
      const fgEffective = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) } : fg;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = isLarge ? 3 : 4.5;
      out.push({ sel, fg: fgEffective, bg, ratio: Math.round(ratio(fgEffective, bg) * 100) / 100, required, size: Math.round(size * 100) / 100, weight, pass: ratio(fgEffective, bg) >= required });
    }
    return out;
  });
  console.log('=== contrast ===');
  for (const c of contrast) console.log(c.pass === false ? 'FAIL' : 'ok  ', JSON.stringify(c));

  // ---- 200%-zoom-equivalent reflow check ----
  for (const width of [640, 320]) {
    const p2 = await browser.newPage({ viewport: { width, height: 900 } });
    await p2.goto(base + '/');
    await p2.waitForTimeout(300);
    const overflow = await p2.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log('=== reflow width', width, JSON.stringify(overflow));
    await p2.close();
  }

  await browser.close();
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
