'use strict';
/**
 * bot/test/wave5-product-menu-fixes.test.js — Wave 5 product-menu remediation gates.
 *
 * Covers the fixes made to templates/product-menu/{template.html,styles.css,script.js,
 * schema.json,presets.json} for the round-3 audit (04-QA-Evidence/Audit-2026-09-06-2225ca7):
 *
 *   1. CLS: the cookie-consent banner's hero-clearance padding (cookie-banner.css,
 *      `body:has(#hb-cookie-banner:not([hidden]))`) used to apply late (linked near
 *      the end of <body>) and after cookie-banner.js had already revealed the banner,
 *      causing a large layout shift once that stylesheet finally arrived. Fixed by
 *      moving the stylesheet into <head> and adding a synchronous pre-paint inline
 *      script that sets the same `hb-cookie-open` class before first render.
 *   2. Gallery lightbox had zero CSS (collage.js created `.lightbox` elements with
 *      no matching rules) — clicking a photo broke the page layout instead of
 *      opening a viewer.
 *   3. Hero CTA ("Rezervă o masă") carried both `.hero-cta` and `.pm-hero__cta--fill`;
 *      a later CSS rule targeting `.hero-cta` (shared with the ghost button) always
 *      won the cascade, making the primary CTA permanently transparent.
 *   4. No mobile navigation — header links were simply `display:none` under the
 *      834px breakpoint with no hamburger fallback.
 *   5. Duplicate, unsynchronized Instagram URL fields in the schema (`instagram.url`,
 *      driving the feed follow-button + IG grid, vs `contact.instagram.url`, driving
 *      the contact card + footer icon — edited independently, easy to drift apart).
 *      A true single-field merge was tried and reverted: bot/test/s107-s106-advocate.test.js
 *      (pre-existing, not owned by this wave) hardcodes both fields' exact schema
 *      labels and their separate existence, so removing either breaks that oracle.
 *      Given that constraint, the fields are kept SEPARATE but wired to stay in sync
 *      by convention: each now carries a `hint` telling the editor to mirror the
 *      other field's value, and both still resolve to the same profile in the two
 *      shipped presets. A real fix — either updating s107-s106-advocate to match a
 *      genuine merge, or adding builder-side auto-mirroring — needs bot/test/** or
 *      builder/** changes outside this wave's file ownership (see HANDOFF-product-menu.md).
 *   6. WCAG AA contrast: `--ink-mute` (eyebrow/meta text on the cream body) and the
 *      scroll-indicator label (on the dark hero) were both under the 4.5:1 minimum
 *      for normal text.
 *   7. Footer Instagram/Facebook icon links were ~13-16px wide — under the 24x24
 *      minimum interactive-target size.
 *   8. At an emulated 200% zoom on a mobile viewport (390px halved to 195px CSS
 *      px), the mast bar (brand + hamburger + persistent CTA pill) forced
 *      horizontal scroll.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-product-menu-fixes.test.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TPL_DIR = path.join(ROOT, 'templates/product-menu');

let failed = false;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log('PASS', name))
    .catch((e) => {
      failed = true;
      console.error('FAIL', name, '-', e.message);
    });
}

function loadPlaywright() {
  // Playwright's own Chromium build, resolved from node_modules — never a
  // hardcoded browser binary path (an earlier wave removed exactly that
  // mistake from other oracles in this suite).
  return require('playwright');
}

function relLuminance(r, g, b) {
  const f = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function contrastRatio(a, b) {
  const L1 = relLuminance(...a);
  const L2 = relLuminance(...b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}
function compositeOver(fgRgba, bgRgb) {
  const a = fgRgba[3];
  return [
    fgRgba[0] * a + bgRgb[0] * (1 - a),
    fgRgba[1] * a + bgRgb[1] * (1 - a),
    fgRgba[2] * a + bgRgb[2] * (1 - a),
  ];
}
function parseRgba(str) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(str);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
}

/** Build a throwaway static site from the casa-nord preset into `dir`. */
function buildSite(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['template.html', 'styles.css', 'script.js', 'collage.js']) {
    fs.copyFileSync(path.join(TPL_DIR, f), path.join(dir, f));
  }
  fs.cpSync(path.join(TPL_DIR, 'images'), path.join(dir, 'images'), { recursive: true });
  const presets = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'presets.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presets.presets[0].config));
  const { build } = require(path.join(ROOT, 'build.js'));
  build(dir);
}

function serveStatic(dir) {
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const full = path.join(dir, p);
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-pm-'));
  buildSite(tmpDir);
  const { server, port } = await serveStatic(tmpDir);
  const base = `http://127.0.0.1:${port}`;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();

  try {
    await check('schema: the two Instagram URL fields each point the editor at the other, to stay in sync', () => {
      const schema = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'schema.json'), 'utf8'));
      const fields = schema.sections.flatMap((s) => s.fields);
      const byKey = (k) => fields.find((f) => f.key === k);
      const igUrl = byKey('instagram.url');
      const contactIgUrl = byKey('contact.instagram.url');
      assert.ok(igUrl, 'instagram.url field must exist (feed follow-button / IG grid source)');
      assert.ok(contactIgUrl, 'contact.instagram.url field must exist (contact card / footer source)');
      // Exact labels are pinned by the pre-existing bot/test/s107-s106-advocate.test.js
      // oracle — this wave must not change either string.
      assert.strictEqual(igUrl.label, 'URL Instagram (https://www.instagram.com/...)');
      assert.strictEqual(contactIgUrl.label, 'Instagram (secțiune contact)');
      assert.ok(igUrl.hint && /același|identic/i.test(igUrl.hint), 'instagram.url hint must tell the editor to mirror the other field');
      assert.ok(contactIgUrl.hint && /același|identic/i.test(contactIgUrl.hint), 'contact.instagram.url hint must tell the editor to mirror the other field');
    });

    await check('presets: casa-nord and traista-verde keep both Instagram URL fields identical (no drift)', () => {
      const presets = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'presets.json'), 'utf8'));
      for (const p of presets.presets) {
        assert.ok(p.config.contact.instagram && p.config.contact.instagram.url, `${p.id}: contact.instagram.url present`);
        assert.ok(p.config.instagram && p.config.instagram.url, `${p.id}: instagram.url present`);
        assert.strictEqual(p.config.instagram.url, p.config.contact.instagram.url, `${p.id}: the two Instagram URLs must match`);
      }
    });

    await check('contrast: --ink-mute on --paper and .pm-scroll on --void both meet 4.5:1 (WCAG AA normal text)', () => {
      const css = fs.readFileSync(path.join(TPL_DIR, 'styles.css'), 'utf8');
      const inkMuteM = /--ink-mute:\s*rgba\(([^)]+)\)/.exec(css);
      assert.ok(inkMuteM, '--ink-mute declared as rgba(...)');
      const inkMute = inkMuteM[1].split(',').map((s) => parseFloat(s.trim()));
      const paper = [243, 238, 232]; // --color-cream default
      const ratio1 = contrastRatio(compositeOver(inkMute, paper), paper);
      assert.ok(ratio1 >= 4.5, `--ink-mute vs paper ratio ${ratio1.toFixed(2)} must be >= 4.5`);

      const scrollM = /\.pm-scroll,\s*\.scroll-indicator\s*\{[^}]*color:\s*rgba\(([^)]+)\)/.exec(css);
      assert.ok(scrollM, '.pm-scroll color declared as rgba(...)');
      const scrollFg = scrollM[1].split(',').map((s) => parseFloat(s.trim()));
      const voidBg = [10, 10, 10];
      const ratio2 = contrastRatio(compositeOver(scrollFg, voidBg), voidBg);
      assert.ok(ratio2 >= 4.5, `.pm-scroll vs void ratio ${ratio2.toFixed(2)} must be >= 4.5`);
    });

    await check('CLS: throttled load produces no significant layout shift (desktop 1440 + mobile 390)', async () => {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        const client = await page.context().newCDPSession(page);
        await client.send('Network.enable');
        await client.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 150,
          downloadThroughput: (1.6 * 1024 * 1024) / 8,
          uploadThroughput: (750 * 1024) / 8,
        });
        await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.addInitScript(() => {
          window.__cls = 0;
          try {
            new PerformanceObserver((list) => {
              for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
            }).observe({ type: 'layout-shift', buffered: true });
          } catch (_) {}
        });
        await page.goto(base + '/index.html', { waitUntil: 'load' });
        await page.waitForTimeout(1200);
        const cls = await page.evaluate(() => window.__cls);
        await page.close();
        assert.ok(cls < 0.1, `CLS at ${viewport.width}px must be < 0.1 (good), got ${cls.toFixed(4)}`);
      }
    });

    await check('lightbox: clicking a gallery photo opens a fully styled full-screen viewer', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      const photo = page.locator('.collage-photo').first();
      await photo.scrollIntoViewIfNeeded();
      await photo.click();
      const lb = page.locator('.lightbox');
      await lb.waitFor({ state: 'visible', timeout: 3000 });
      const style = await lb.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { position: cs.position, display: cs.display, zIndex: cs.zIndex };
      });
      assert.strictEqual(style.position, 'fixed', 'lightbox must be position:fixed (full-screen overlay)');
      assert.strictEqual(style.display, 'flex', 'lightbox must be display:flex when open');
      assert.ok(parseInt(style.zIndex, 10) >= 50, 'lightbox must sit above page content (z-index)');
      await page.close();
    });

    await check('hero CTA: primary "Rezervă o masă" button is opaque, not transparent', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      const bg = await page.locator('.pm-hero__cta--fill').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const rgba = parseRgba(bg);
      assert.ok(rgba, 'CTA background parses as a color');
      assert.ok(rgba[3] > 0.9, `CTA background must be opaque, got ${bg}`);
      assert.ok(!(rgba[0] === 0 && rgba[1] === 0 && rgba[2] === 0), 'CTA background must not be void/black (the ghost-button color leaking through)');
      await page.close();
    });

    await check('mobile nav: hamburger toggles the same anchors as an accessible dropdown', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      const burger = page.locator('#pm-mast-burger');
      await burger.waitFor({ state: 'visible' });
      const box = await burger.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `burger tap target must be >= 44x44, got ${box.width}x${box.height}`);
      assert.strictEqual(await burger.getAttribute('aria-expanded'), 'false');
      await burger.click();
      await assert.doesNotReject(page.locator('#pm-mast-nav.is-open').waitFor({ state: 'attached', timeout: 2000 }));
      assert.strictEqual(await burger.getAttribute('aria-expanded'), 'true');
      const navVisible = await page.locator('#pm-mast-nav').evaluate((el) => getComputedStyle(el).visibility === 'visible');
      assert.ok(navVisible, 'nav dropdown must become visible after opening');
      await page.keyboard.press('Escape');
      assert.strictEqual(await burger.getAttribute('aria-expanded'), 'false');
      await page.close();
    });

    await check('a11y: footer Instagram/Facebook icons are at least 24x24 (ideally 44x44)', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      const boxes = await page.locator('.pm-foot__soc a').evaluateAll((els) =>
        els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; })
      );
      assert.ok(boxes.length >= 2, 'expected Instagram + Facebook footer icons');
      for (const b of boxes) {
        assert.ok(b.w >= 24 && b.h >= 24, `footer social icon must be >= 24x24, got ${b.w}x${b.h}`);
      }
      await page.close();
    });

    await check('reflow: no horizontal scroll at an emulated 200% zoom on mobile (195px CSS width)', async () => {
      for (const width of [720, 195]) { // 200% of 1440 and of 390
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        await page.goto(base + '/index.html', { waitUntil: 'load' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await page.close();
        assert.ok(overflow <= 1, `horizontal overflow at ${width}px must be ~0, got ${overflow}px`);
      }
    });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failed) {
    console.error('\nwave5-product-menu-fixes.test.js: FAILED');
    process.exit(1);
  }
  console.log('\nwave5-product-menu-fixes.test.js: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
