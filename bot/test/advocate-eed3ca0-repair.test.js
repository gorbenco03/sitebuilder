'use strict';
/**
 * Advocate eed3ca0 / a045208 repair oracle.
 *
 * Locks stranger findings the fullpass-63230d2 binding oracle could not see:
 *   (a) local-service seed hero tagline must not visually clip
 *   (b) SaaS legal <title> tags must be Romanian
 *   (c) generated-site cookie banner must not cover hero/section titles
 *   (d) cookie banner must not cover bottom-right call dock / WhatsApp float
 *
 * Causal RED on 70a67b0 / eed3ca0 before the repair. GREEN after a045208 + dock fix.
 *
 * Run: node bot/test/advocate-eed3ca0-repair.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PW_PATH = '/Users/Work/.hermes/hermes-agent/node_modules/playwright';
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const TPLS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

const EXPECTED_TITLES = {
  'builder/terms.html': 'Termeni de utilizare — Hidook Site Builder',
  'builder/privacy.html': 'Confidențialitate — Hidook Site Builder',
  'builder/cookies.html': 'Cookie-uri — Hidook Site Builder',
};

const HERO_SELECTORS = {
  'local-service': '.ls-hero__tag, .hero-tagline, .ls-hero__name',
  portfolio: '.pf-hero__tag, .hero-tagline, .pf-hero__word',
  'product-menu': '.pm-hero__tag, .hero-tagline, .pm-kicker',
  professionals: '.pr-display, .pr-lede, .pr-hero__meta',
  desserdirina: '.hero-tagline, .hero-wordmark, .scroll-indicator',
};

// First-screen section seeds the advocate saw covered by the site cookie card.
const SECTION_SELECTORS = {
  'local-service': '', // no first-screen section seed was in the advocate packet
  portfolio: '',
  'product-menu': '.pm-ticket__label, .pm-menublock__h',
  professionals: '.pr-hero__meta',
  desserdirina: '.scroll-indicator',
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advocate-eed3ca0-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'advocate-eed3ca0-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

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
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    PW_PATH,
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

function boxesIntersect(a, b, pad = 2) {
  if (!a || !b) return false;
  return !(
    a.x + a.width - pad <= b.x ||
    b.x + b.width - pad <= a.x ||
    a.y + a.height - pad <= b.y ||
    b.y + b.height - pad <= a.y
  );
}

function pickVisibleTextBoxes(doc, selectors) {
  const out = [];
  const seen = new Set();
  for (const sel of String(selectors).split(',').map((s) => s.trim()).filter(Boolean)) {
    let nodes = [];
    try {
      nodes = Array.from(doc.querySelectorAll(sel));
    } catch (_) {
      continue;
    }
    for (const el of nodes.slice(0, 8)) {
      if (!el || seen.has(el)) continue;
      const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      // Only first-screen targets (primary copy the stranger sees without scroll)
      if (r.bottom < 0 || r.top > (doc.defaultView.innerHeight || 800) + 8) continue;
      seen.add(el);
      out.push({
        sel,
        text: text.slice(0, 80),
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
        clientW: el.clientWidth,
        scrollW: el.scrollWidth,
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        clippedX: el.scrollWidth > el.clientWidth + 1,
        clippedY: el.scrollHeight > el.clientHeight + 2,
      });
    }
  }
  return out;
}

async function main() {
  await check('static: SaaS legal <title> tags are Romanian', () => {
    for (const [rel, expected] of Object.entries(EXPECTED_TITLES)) {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const m = html.match(/<title>([^<]*)<\/title>/i);
      assert.ok(m, rel + ' has <title>');
      assert.strictEqual(m[1].trim(), expected, rel + ' title must be Romanian product language');
      assert.doesNotMatch(m[1], /\b(Terms|Privacy|Cookies)\b/, rel + ' must not keep English tab title');
    }
  });

  await check('static: local-service hero tagline can wrap without clip geometry', () => {
    const css = fs.readFileSync(path.join(ROOT, 'templates/local-service/styles.css'), 'utf8');
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/local-service/presets.json'), 'utf8'));
    const tagline = (((presets.presets || [])[0] || {}).config || {}).business || {};
    assert.ok(
      /Renovări interioare și finisaje premium/.test(String(tagline.tagline || '')),
      'seed tagline stays the commercial Romanian line'
    );
    // Tagline must not share a single-line overflow trap with the name.
    // Require an explicit tag rule that allows wrap + visible overflow and a
    // bounded width so long seed lines reflow inside the canvas.
    assert.match(css, /\.ls-hero__tag[\s\S]{0,240}max-width\s*:/, 'ls-hero__tag sets max-width so long lines wrap');
    assert.match(
      css,
      /\.ls-hero__tag[\s\S]{0,320}(overflow-wrap|word-break|white-space\s*:\s*normal)/,
      'ls-hero__tag allows wrapping'
    );
    assert.doesNotMatch(
      css,
      /\.ls-hero__name\s*,\s*\.ls-hero__tag\s*,\s*\.hero-tagline\s*\{[^}]*line-height\s*:\s*1\.0[0-8]\b/,
      'shared name+tag rule must not keep ultra-tight line-height that clips glyphs'
    );
  });

  await check('static: generated cookie banner CSS keeps consent off primary bottom hero copy', () => {
    const legal = fs.readFileSync(path.join(ROOT, 'bot/site-legal.js'), 'utf8');
    assert.match(legal, /COOKIE_BANNER_CSS\s*=/, 'cookie CSS source of truth');
    const cssMatch = legal.match(/const COOKIE_BANNER_CSS = `([\s\S]*?)`;/);
    assert.ok(cssMatch, 'COOKIE_BANNER_CSS template string');
    const css = cssMatch[1];
    // Must reserve clearance for hero copy while the banner is open — a bare
    // bottom-left card without :has()/padding strategy is the rejected defect.
    const hasClearance =
      /:has\(#hb-cookie-banner:not\(\[hidden\]\)\)/.test(css) &&
      /--hb-cookie-clearance|padding-bottom/.test(css);
    assert.ok(hasClearance, 'cookie CSS must clear hero copy via :has() clearance while open');
    assert.match(css, /\.ls-hero__copy|\.pf-hero__copy|\.hero-content/, 'clearance targets hero copy blocks');
    // Advocate a045208: card must not sit on the bottom-right call dock / WA float.
    assert.match(css, /\.hb-cookie-banner\s*\{[\s\S]*?\bleft\s*:\s*0\.75rem/, 'cookie card anchors bottom-left');
    assert.doesNotMatch(
      css,
      /\.hb-cookie-banner\s*\{[^}]*\bright\s*:\s*0\.75rem/,
      'cookie card must not re-occupy bottom-right (dock/WA zone)'
    );
    assert.match(legal, /hb-cookie-open/, 'open-state class toggled for reliable clearance');
  });

  await check('static: cookie open-state class is toggled in banner JS', () => {
    const legal = fs.readFileSync(path.join(ROOT, 'bot/site-legal.js'), 'utf8');
    const jsMatch = legal.match(/const COOKIE_BANNER_JS = `([\s\S]*?)`;/);
    assert.ok(jsMatch, 'COOKIE_BANNER_JS template string');
    const js = jsMatch[1];
    assert.match(js, /classList\.add\('hb-cookie-open'\)/, 'show adds hb-cookie-open');
    assert.match(js, /classList\.remove\('hb-cookie-open'\)/, 'hide removes hb-cookie-open');
  });

  // Ensure engine ships current cookie CSS into srcdoc previews.
  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  try {
    await check('browser: legal document.title Romanian on all 3 pages', async () => {
      const { chromium } = loadPlaywright();
      const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
      });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        for (const [rel, expected] of Object.entries(EXPECTED_TITLES)) {
          const slug = path.basename(rel);
          await page.goto(base + '/app/' + slug, { waitUntil: 'domcontentloaded' });
          const title = await page.title();
          assert.strictEqual(title, expected, slug + ' document.title');
        }
        // Mobile viewport still keeps RO titles
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(base + '/app/terms.html', { waitUntil: 'domcontentloaded' });
        assert.strictEqual(await page.title(), EXPECTED_TITLES['builder/terms.html']);
      } finally {
        await browser.close();
      }
    });

    await check('browser: local-service hero tagline fully visible (desktop + mobile canvas)', async () => {
      const { chromium } = loadPlaywright();
      const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
      });
      try {
        for (const viewport of [
          { width: 1440, height: 1000, label: 'desktop' },
          { width: 390, height: 844, label: 'mobile' },
        ]) {
          const page = await browser.newPage({ viewport });
          page.setDefaultTimeout(25000);
          await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
          if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
            await page.locator('#hb-cookie-accept').click().catch(() => {});
          }
          await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
          await page.waitForURL(/#edit$/, { timeout: 25000 });
          await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
          await page.waitForTimeout(1100);
          // Close details so drawer does not cover canvas (measures the site itself).
          const drawer = page.locator('#details-drawer');
          if (await drawer.isVisible().catch(() => false)) {
            await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
            await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
          }
          await page.waitForTimeout(400);

          const frame = page.frameLocator('#preview-iframe');
          await frame.locator('body').waitFor({ state: 'attached', timeout: 20000 });
          await frame.locator('.ls-hero__tag, .hero-tagline, .ls-hero__name, h1').first().waitFor({
            state: 'visible',
            timeout: 20000,
          });
          const metrics = await frame.locator('body').evaluate(() => {
            const el =
              document.querySelector('.ls-hero__tag, .hero-tagline') ||
              document.querySelector('.ls-hero__name') ||
              document.querySelector('h1');
            if (!el) return { missing: true };
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
            return {
              text,
              fontSize: cs.fontSize,
              lineHeight: cs.lineHeight,
              whiteSpace: cs.whiteSpace,
              overflowX: cs.overflowX,
              overflowY: cs.overflowY,
              clientW: el.clientWidth,
              scrollW: el.scrollWidth,
              clientH: el.clientHeight,
              scrollH: el.scrollHeight,
              clippedX: el.scrollWidth > el.clientWidth + 1,
              clippedY: el.scrollHeight > el.clientHeight + 2,
              box: { x: r.x, y: r.y, width: r.width, height: r.height },
              viewW: window.innerWidth,
            };
          });
          assert.ok(!metrics.missing, viewport.label + ' preview hero present');
          assert.match(metrics.text, /finisaje premium/i, viewport.label + ' tagline text includes premium');
          assert.ok(!metrics.clippedX, viewport.label + ' tagline must not clip horizontally: ' + JSON.stringify(metrics));
          assert.ok(!metrics.clippedY, viewport.label + ' tagline must not clip vertically: ' + JSON.stringify(metrics));
          // Keep display scale in the same band as sibling templates (not shrunk to body copy).
          const px = parseFloat(metrics.fontSize);
          assert.ok(px >= 28, viewport.label + ' hero type must stay display-sized (>=28px), got ' + metrics.fontSize);
          await page.close();
        }
      } finally {
        await browser.close();
      }
    });

    await check('browser: cookie banner does not intersect hero/section titles on all 5 templates', async () => {
      const { chromium } = loadPlaywright();
      const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
      });
      try {
        for (const viewport of [
          { width: 1440, height: 1000, label: 'desktop' },
          { width: 390, height: 844, label: 'mobile' },
        ]) {
          const page = await browser.newPage({ viewport });
          page.setDefaultTimeout(25000);
          await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
          if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
            await page.locator('#hb-cookie-accept').click().catch(() => {});
          }

          for (const system of TPLS) {
            await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(300);
            await page.locator('.template-card[data-template-id="' + system + '"] .btn-start-tpl').click();
            await page.waitForURL(/#edit$/, { timeout: 25000 });
            await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
            await page.waitForTimeout(1000);
            const drawer = page.locator('#details-drawer');
            if (await drawer.isVisible().catch(() => false)) {
              await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
              await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
            }
            const frame = page.frameLocator('#preview-iframe');
            await frame.locator('body').waitFor({ state: 'attached', timeout: 20000 });
            // Clear any prior preview consent so the generated banner is visible.
            await frame.locator('body').evaluate(() => {
              try {
                localStorage.removeItem('hb-cookie-consent');
              } catch (_) {}
              try {
                document.cookie = 'hb-cookie-consent=; Path=/; Max-Age=0';
              } catch (_) {}
              const el = document.getElementById('hb-cookie-banner');
              if (el) {
                el.hidden = false;
                el.removeAttribute('hidden');
                el.style.removeProperty('display');
                el.removeAttribute('data-hb-consent-dismissed');
              }
              try {
                document.documentElement.classList.add('hb-cookie-open');
                if (document.body) document.body.classList.add('hb-cookie-open');
              } catch (_) {}
            });
            await page.waitForTimeout(250);
            await frame.locator('#hb-cookie-banner').waitFor({ state: 'visible', timeout: 10000 });

            const report = await frame.locator('body').evaluate(
              (_body, { heroSel, sectionSel }) => {
                const banner = document.getElementById('hb-cookie-banner');
                if (!banner || banner.hidden) return { noBanner: true };
                const br = banner.getBoundingClientRect();
                if (br.width < 4 || br.height < 4) return { noBannerBox: true };
                const bannerBox = { x: br.x, y: br.y, width: br.width, height: br.height };
                const vw = window.innerWidth || 800;
                const vh = window.innerHeight || 800;

                function collect(selList) {
                  const out = [];
                  const seen = new Set();
                  for (const sel of String(selList)
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)) {
                    let nodes = [];
                    try {
                      nodes = Array.from(document.querySelectorAll(sel));
                    } catch (_) {
                      continue;
                    }
                    for (const el of nodes.slice(0, 10)) {
                      if (!el || seen.has(el)) continue;
                      if (banner.contains(el)) continue;
                      // Skip assistive-only / chrome wordmarks in the sticky mast
                      if (el.classList && el.classList.contains('sr-only')) continue;
                      const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
                      if (text.length < 3) continue;
                      const r = el.getBoundingClientRect();
                      if (r.width < 4 || r.height < 4) continue;
                      if (r.bottom < 0 || r.top > vh + 4) continue;
                      seen.add(el);
                      out.push({
                        sel,
                        text: text.slice(0, 72),
                        box: { x: r.x, y: r.y, width: r.width, height: r.height },
                      });
                    }
                  }
                  return out;
                }

                function hits(a, b) {
                  const x1 = Math.max(a.x, b.x);
                  const y1 = Math.max(a.y, b.y);
                  const x2 = Math.min(a.x + a.width, b.x + b.width);
                  const y2 = Math.min(a.y + a.height, b.y + b.height);
                  const w = x2 - x1;
                  const h = y2 - y1;
                  if (w <= 4 || h <= 4) return false;
                  const area = w * h;
                  const textArea = Math.max(1, b.width * b.height);
                  // Corner chrome may graze a full-width line; fail only when
                  // the banner covers a meaningful share of primary copy.
                  return area >= 0.18 * textArea || (w >= 56 && h >= 12);
                }

                function collectActions() {
                  const sels = [
                    '.ls-dock',
                    '.ls-dock__call',
                    '.ls-dock__wa',
                    '.whatsapp-float',
                    'a.whatsapp-float',
                    '.wa-float',
                  ];
                  const out = [];
                  const seen = new Set();
                  for (const sel of sels) {
                    let nodes = [];
                    try {
                      nodes = Array.from(document.querySelectorAll(sel));
                    } catch (_) {
                      continue;
                    }
                    for (const el of nodes) {
                      if (!el || seen.has(el)) continue;
                      const cs = getComputedStyle(el);
                      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
                        continue;
                      }
                      const r = el.getBoundingClientRect();
                      if (r.width < 4 || r.height < 4) continue;
                      if (r.bottom < 0 || r.top > vh + 4) continue;
                      seen.add(el);
                      const text = String(el.innerText || el.getAttribute('aria-label') || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 72);
                      out.push({
                        sel,
                        text,
                        box: { x: r.x, y: r.y, width: r.width, height: r.height },
                      });
                    }
                  }
                  return out;
                }

                const heroes = collect(heroSel);
                const sections = collect(sectionSel);
                const actions = collectActions();
                const overlaps = [];
                for (const t of heroes.concat(sections)) {
                  if (hits(bannerBox, t.box)) overlaps.push(t);
                }
                const actionOverlaps = [];
                for (const t of actions) {
                  if (hits(bannerBox, t.box)) actionOverlaps.push(t);
                }
                return {
                  bannerBox,
                  bannerCorner: bannerBox.x + bannerBox.width / 2 < vw / 2 ? 'left' : 'right',
                  heroCount: heroes.length,
                  sectionCount: sections.length,
                  actionCount: actions.length,
                  overlaps,
                  actionOverlaps,
                  actions,
                };
              },
              { heroSel: HERO_SELECTORS[system], sectionSel: SECTION_SELECTORS[system] }
            );

            assert.ok(!report.noBanner && !report.noBannerBox, system + ' ' + viewport.label + ' cookie banner visible');
            assert.ok(
              report.heroCount + report.sectionCount > 0,
              system + ' ' + viewport.label + ' found hero/section targets'
            );
            assert.strictEqual(
              report.overlaps.length,
              0,
              system +
                ' ' +
                viewport.label +
                ' cookie banner overlaps primary copy: ' +
                JSON.stringify(report.overlaps.slice(0, 4))
            );
            assert.strictEqual(
              report.bannerCorner,
              'left',
              system + ' ' + viewport.label + ' cookie card must sit bottom-left, got ' + JSON.stringify(report.bannerBox)
            );
            // Every commercial system ships a bottom-right WA/dock control.
            assert.ok(
              report.actionCount > 0,
              system + ' ' + viewport.label + ' expected dock/WA action targets'
            );
            assert.strictEqual(
              report.actionOverlaps.length,
              0,
              system +
                ' ' +
                viewport.label +
                ' cookie banner overlaps call dock / WhatsApp: ' +
                JSON.stringify(report.actionOverlaps.slice(0, 4))
            );
          }
          await page.close();
        }
      } finally {
        await browser.close();
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('OK advocate-eed3ca0-repair (hero/legal/cookie-dock locked)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
