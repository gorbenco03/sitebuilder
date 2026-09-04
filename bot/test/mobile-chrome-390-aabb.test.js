'use strict';
/**
 * mobile-chrome-390-aabb — pixel/bounding-box oracle for bottom chrome collisions.
 *
 * Locks the recurring cookie-banner vs WhatsApp/call-dock / credibility-strip
 * class of stranger defects at the 390 mobile-preview width across ALL 5
 * commercial systems. innerText presence is not enough (fullpass stayed green
 * while clips existed).
 *
 * Asserts at 390×844 with cookie forced open:
 *   (a) no AABB overlap between #hb-cookie-banner and any WA/FAB/call-dock
 *   (b) no AABB overlap between WA/FAB and credibility-strip / explore labels
 *   (c) exactly one visible WhatsApp affordance on local-service first screen
 *
 * Also static-locks the shared layout rule in bot/site-legal.js COOKIE_BANNER_CSS.
 *
 * Run: node bot/test/mobile-chrome-390-aabb.test.js
 * Evidence: 04-QA-Evidence/mobile-chrome-390-aabb/
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'mobile-chrome-390-aabb');
const PW_PATH = '/Users/Work/.hermes/hermes-agent/node_modules/playwright';
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const TPLS = ['professionals', 'local-service', 'portfolio', 'product-menu', 'desserdirina'];

const TEXT_SELECTORS = {
  professionals: '.pr-strip__item, .pr-hero__meta, .pr-scroll',
  'local-service': '.ls-scroll, .scroll-indicator__label, .ls-hero__tag, .hero-tagline',
  portfolio: '.pf-hint, .scroll-hint__label, .pf-hero__tag, .hero-tagline',
  'product-menu': '.pm-scroll, .scroll-indicator, .pm-hero__tag, .hero-tagline',
  desserdirina: '.scroll-indicator, .hero-tagline, .hero-wordmark',
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-chrome-390-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'mobile-chrome-390-' + crypto.randomBytes(8).toString('hex');
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
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

function aabbHit(a, b, pad = 2) {
  if (!a || !b) return false;
  return !(
    a.x + a.width - pad <= b.x ||
    b.x + b.width - pad <= a.x ||
    a.y + a.height - pad <= b.y ||
    b.y + b.height - pad <= a.y
  );
}

function extractCookieCss() {
  const legal = fs.readFileSync(path.join(ROOT, 'bot/site-legal.js'), 'utf8');
  const m = legal.match(/const COOKIE_BANNER_CSS = `([\s\S]*?)`;/);
  assert.ok(m, 'COOKIE_BANNER_CSS template string');
  return m[1];
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  await check('static: shared chrome layout rule ships single-WA + FAB safe tokens', () => {
    const css = extractCookieCss();
    assert.match(css, /--hb-fab-safe-right/, 'FAB safe-right token');
    assert.match(css, /--hb-dock-safe-bottom/, 'dock safe-bottom token');
    assert.match(
      css,
      /body:has\(\.ls-dock\)\s*\.whatsapp-float|html:has\(\.ls-dock\)\s*\.whatsapp-float/,
      'shared rule hides .whatsapp-float when .ls-dock present'
    );
    assert.match(css, /\.hb-cookie-banner\s*\{[\s\S]*?\bleft\s*:\s*0\.75rem/, 'cookie anchors bottom-left');
    assert.doesNotMatch(
      css,
      /\.hb-cookie-banner\s*\{[^}]*\bright\s*:\s*0\.75rem/,
      'cookie must not re-occupy bottom-right'
    );
    assert.match(css, /\.pr-strip/, 'credibility strip clearance in shared CSS');
    assert.match(css, /text-align:\s*left\s*!important/, 'explore labels stay left of FAB (not right under it)');
    assert.doesNotMatch(
      css,
      /html\.hb-cookie-open\s+\.pf-hint[\s\S]{0,280}text-align:\s*right\s*!important/,
      'must not right-align pf-hint under the FAB'
    );
  });

  // Engine must ship the current shared CSS into srcdoc previews.
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

  const report = [];

  try {
    await check('browser: 390 AABB chrome contract on all 5 templates', async () => {
      const { chromium } = loadPlaywright();
      const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
      });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(30000);
        await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
        if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
          await page.locator('#hb-cookie-accept').click().catch(() => {});
        }

        for (const system of TPLS) {
          if (system !== TPLS[0]) {
            const back = page.locator('#btn-back-templates');
            if (await back.isVisible().catch(() => false)) {
              await back.click().catch(() => {});
            } else {
              await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
            }
            await page.waitForTimeout(500);
          }

          await page.locator('.template-card[data-template-id="' + system + '"] .btn-start-tpl').click();
          await page.waitForURL(/#edit$/, { timeout: 25000 });
          await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
          await page.waitForTimeout(900);

          const drawer = page.locator('#details-drawer');
          if (await drawer.isVisible().catch(() => false)) {
            await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
            await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
          }

          // Binding action name: click mobile preview 390
          await page.locator('#btn-preview-mobile').click();
          await page.waitForTimeout(700);

          const frameHandle = await page.$('#preview-iframe');
          const frame = await frameHandle.contentFrame();
          assert.ok(frame, system + ' preview frame');

          // Force cookie open inside the site canvas (editor shell already accepted).
          await frame.evaluate(() => {
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
            }
            document.documentElement.classList.add('hb-cookie-open');
            if (document.body) document.body.classList.add('hb-cookie-open');
          });
          await frame.waitForSelector('#hb-cookie-banner:not([hidden])', { timeout: 10000 });
          await page.waitForTimeout(350);

          const shotName = 'click-mobile-preview-390-' + system + '-cookie-open.png';
          const shotPath = path.join(EVIDENCE, shotName);
          await page.locator('#preview-iframe').screenshot({ path: shotPath });

          const metrics = await frame.evaluate(
            ({ textSel, systemId }) => {
              const vh = window.innerHeight || 844;
              const vw = window.innerWidth || 390;

              function boxOf(el) {
                if (!el) return null;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
                  return null;
                }
                const r = el.getBoundingClientRect();
                if (r.width < 3 || r.height < 3) return null;
                if (r.bottom < -2 || r.top > vh + 2) return null;
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  text: String(el.innerText || el.getAttribute('aria-label') || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 96),
                };
              }

              function collect(sels) {
                const out = [];
                const seen = new Set();
                for (const sel of String(sels)
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)) {
                  let nodes = [];
                  try {
                    nodes = Array.from(document.querySelectorAll(sel));
                  } catch (_) {
                    continue;
                  }
                  for (const el of nodes) {
                    if (!el || seen.has(el)) continue;
                    const b = boxOf(el);
                    if (!b) continue;
                    seen.add(el);
                    out.push({ sel, ...b });
                  }
                }
                return out;
              }

              const cookieEl = document.getElementById('hb-cookie-banner');
              const cookie = boxOf(cookieEl);

              const actions = collect(
                [
                  '.ls-dock',
                  '.ls-dock__call',
                  '.ls-dock__wa',
                  '.whatsapp-float',
                  'a.whatsapp-float',
                  '.wa-float',
                ].join(',')
              );

              const texts = collect(textSel);

              // WhatsApp affordances: float OR dock WA tile (not the whole dock).
              const waAffordances = [];
              for (const el of document.querySelectorAll(
                '.whatsapp-float, a.whatsapp-float, .ls-dock__wa, a.ls-dock__wa, [aria-label*="WhatsApp" i], [aria-label*="whatsapp" i]'
              )) {
                const b = boxOf(el);
                if (!b) continue;
                // Skip generic dock container if it only matched aria on parent.
                const cls = String(el.className || '');
                if (cls.includes('ls-dock') && !cls.includes('ls-dock__wa') && el.matches('.ls-dock')) {
                  continue;
                }
                waAffordances.push({
                  tag: el.tagName,
                  cls,
                  aria: el.getAttribute('aria-label') || '',
                  href: el.getAttribute('href') || '',
                  box: b,
                });
              }

              // Deduplicate nested (e.g. svg inside anchor already counted).
              const waDedup = [];
              for (const w of waAffordances) {
                const overlapExisting = waDedup.some((o) => {
                  const a = o.box;
                  const b = w.box;
                  const x1 = Math.max(a.x, b.x);
                  const y1 = Math.max(a.y, b.y);
                  const x2 = Math.min(a.x + a.width, b.x + b.width);
                  const y2 = Math.min(a.y + a.height, b.y + b.height);
                  return x2 - x1 > 8 && y2 - y1 > 8;
                });
                if (!overlapExisting) waDedup.push(w);
              }

              return {
                systemId,
                vw,
                vh,
                cookie,
                actions,
                texts,
                waCount: waDedup.length,
                waAffordances: waDedup,
              };
            },
            { textSel: TEXT_SELECTORS[system], systemId: system }
          );

          assert.ok(metrics.cookie, system + ' cookie banner box present');
          assert.ok(metrics.cookie.x + metrics.cookie.width / 2 < metrics.vw / 2, system + ' cookie on left half');

          // (a) cookie vs any action chrome
          const cookieActionHits = [];
          for (const a of metrics.actions) {
            if (
              aabbHit(
                { x: metrics.cookie.x, y: metrics.cookie.y, width: metrics.cookie.width, height: metrics.cookie.height },
                { x: a.x, y: a.y, width: a.width, height: a.height },
                2
              )
            ) {
              cookieActionHits.push(a);
            }
          }
          assert.strictEqual(
            cookieActionHits.length,
            0,
            system + ' (a) cookie overlaps WA/dock: ' + JSON.stringify(cookieActionHits.slice(0, 3))
          );

          // (b) WA/FAB vs strip / explore labels (FAB only — not full dock bar)
          const fabLike = metrics.actions.filter(
            (a) => /whatsapp-float|wa-float|ls-dock__wa/.test(a.sel) || /whatsapp/i.test(a.text || '')
          );
          const textHits = [];
          for (const fab of fabLike) {
            for (const t of metrics.texts) {
              // Ignore huge containers that are mostly the hero photo frame.
              if (t.width > metrics.vw * 0.92 && t.height > metrics.vh * 0.35) continue;
              if (
                aabbHit(
                  { x: fab.x, y: fab.y, width: fab.width, height: fab.height },
                  { x: t.x, y: t.y, width: t.width, height: t.height },
                  2
                )
              ) {
                textHits.push({ fab, text: t });
              }
            }
          }
          assert.strictEqual(
            textHits.length,
            0,
            system + ' (b) FAB overlaps strip/label: ' + JSON.stringify(textHits.slice(0, 3))
          );

          // (b2) cookie vs strip / explore labels (same first-screen text targets)
          const cookieTextHits = [];
          for (const t of metrics.texts) {
            if (t.width > metrics.vw * 0.92 && t.height > metrics.vh * 0.35) continue;
            // Ignore pure hero headlines that clearance already covers via padding.
            if (/hero-tagline|pr-display|pf-hero__tag|ls-hero__tag|pm-hero__tag|hero-wordmark/.test(t.sel)) continue;
            if (
              aabbHit(
                {
                  x: metrics.cookie.x,
                  y: metrics.cookie.y,
                  width: metrics.cookie.width,
                  height: metrics.cookie.height,
                },
                { x: t.x, y: t.y, width: t.width, height: t.height },
                2
              )
            ) {
              cookieTextHits.push(t);
            }
          }
          assert.strictEqual(
            cookieTextHits.length,
            0,
            system + ' (b2) cookie overlaps strip/label: ' + JSON.stringify(cookieTextHits.slice(0, 3))
          );

          // Professionals: full "cabinet" must not be element-clipped on strip items.
          if (system === 'professionals') {
            const stripText = await frame.evaluate(() => {
              const row = document.querySelector('.pr-strip__row, .pr-strip');
              if (!row) return { missing: true };
              const items = Array.from(document.querySelectorAll('.pr-strip__item')).map((el) => {
                const r = el.getBoundingClientRect();
                return {
                  text: String(el.innerText || '').replace(/\s+/g, ' ').trim(),
                  clientW: el.clientWidth,
                  scrollW: el.scrollWidth,
                  clippedX: el.scrollWidth > el.clientWidth + 1,
                  box: { x: r.x, y: r.y, width: r.width, height: r.height },
                };
              });
              return {
                missing: false,
                rowText: String(row.innerText || '').replace(/\s+/g, ' ').trim(),
                items,
              };
            });
            assert.ok(!stripText.missing, 'professionals strip present');
            assert.match(stripText.rowText, /cabinet/i, 'strip keeps full cabinet word in DOM');
            const modes = stripText.items.find((i) => /cabinet/i.test(i.text));
            if (modes) {
              assert.ok(!modes.clippedX, 'modes item must not clip horizontally: ' + JSON.stringify(modes));
              // And modes box must not sit under FAB
              for (const fab of fabLike) {
                assert.ok(
                  !aabbHit(
                    { x: fab.x, y: fab.y, width: fab.width, height: fab.height },
                    modes.box,
                    2
                  ),
                  'modes item under FAB: ' + JSON.stringify({ fab, modes })
                );
              }
            }
          }

          // Portfolio: EXPLOREAZĂ label fully visible (not EXPLO)
          if (system === 'portfolio') {
            const hint = await frame.evaluate(() => {
              const el = document.querySelector('.pf-hint, .scroll-hint, .scroll-hint__label');
              if (!el) return { missing: true };
              const r = el.getBoundingClientRect();
              return {
                missing: false,
                text: String(el.innerText || '').replace(/\s+/g, ' ').trim(),
                clientW: el.clientWidth,
                scrollW: el.scrollWidth,
                clippedX: el.scrollWidth > el.clientWidth + 1,
                box: { x: r.x, y: r.y, width: r.width, height: r.height },
              };
            });
            assert.ok(!hint.missing, 'portfolio explore label present');
            assert.match(hint.text, /EXPLOREAZ/i, 'explore label text intact');
            assert.ok(!hint.clippedX, 'explore label not element-clipped: ' + JSON.stringify(hint));
            for (const fab of fabLike) {
              assert.ok(
                !aabbHit(
                  { x: fab.x, y: fab.y, width: fab.width, height: fab.height },
                  hint.box,
                  2
                ),
                'explore label under FAB: ' + JSON.stringify({ fab, hint })
              );
            }
          }

          // (c) local-service: exactly one WhatsApp affordance
          if (system === 'local-service') {
            assert.strictEqual(
              metrics.waCount,
              1,
              'local-service must show exactly one WA affordance, got ' +
                metrics.waCount +
                ': ' +
                JSON.stringify(metrics.waAffordances)
            );
          }

          report.push({
            system,
            shot: shotName,
            cookie: metrics.cookie,
            actionCount: metrics.actions.length,
            waCount: metrics.waCount,
            cookieActionHits: cookieActionHits.length,
            textHits: textHits.length,
          });
        }
        await page.close();
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

  fs.writeFileSync(path.join(EVIDENCE, 'oracle-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE, 'INVENTORY.md'),
    [
      '# mobile-chrome-390-aabb evidence',
      '',
      'Oracle: `bot/test/mobile-chrome-390-aabb.test.js`',
      'Viewport: editor mobile-preview toggle → site canvas 390×844, cookie forced open.',
      '',
      'Screenshots named from the action just performed:',
      ...TPLS.map((s) => `- \`click-mobile-preview-390-${s}-cookie-open.png\``),
      '',
      'Asserts: (a) cookie∩WA/dock empty (b) FAB∩strip/label empty (c) local-service WA count = 1.',
      '',
    ].join('\n')
  );

  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('OK mobile-chrome-390-aabb (5 systems locked)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
