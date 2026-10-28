'use strict';
/**
 * audit-portfolio-fixes — oracle for PORT-01 and PORT-03 (audit 2026-09-06, HEAD 2225ca7).
 *
 * PORT-01 [critical]: templates/portfolio/collage.js opens a `.lightbox` on photo
 *   click, but templates/portfolio/styles.css shipped zero CSS for it, so it fell
 *   back to browser defaults (display:block, position:static) and rendered as a
 *   raw, undersized image thousands of pixels below the fold — invisible on click.
 *
 * PORT-03 [high]: templates/portfolio/styles.css hides .pf-chrome__nav below 720px
 *   with no hamburger/alternative, so mobile visitors (majority of traffic for a
 *   salon) have no way to jump to Galerie/Servicii/Programare.
 *
 * Asserts, against a real published site rendered in Chromium:
 *  (1) static: styles.css ships .lightbox / .lightbox-img / .lightbox-close /
 *      .lightbox-nav rules (position:fixed, background, z-index) and a mobile
 *      nav toggle + drawer.
 *  (2) browser @ desktop width: clicking a gallery photo opens a lightbox that is
 *      position:fixed, covers the full viewport (top/left ~0, size == viewport),
 *      has a non-transparent background, and Escape closes it and restores
 *      document.body.style.overflow.
 *  (3) browser @ 390px: a hamburger button exists, is >=44x44, toggles
 *      aria-expanded, opens a nav drawer that itself covers the full viewport
 *      (this specifically catches the drawer being nested inside a
 *      backdrop-filter ancestor, which would silently clip position:fixed to
 *      the header's own box instead of the viewport), and Escape closes it and
 *      returns focus to the toggle.
 *
 * The site under test is published through the API (the form editor that used to
 * publish it was removed 2026-10-28).
 *
 * Run: node bot/test/audit-portfolio-fixes.test.js
 * Evidence: 04-QA-Evidence/audit-portfolio-fixes/
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startHarness, publishConfig } = require('./lib/old-template-live.js');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'audit-portfolio-fixes');
const PW_PATH = '/Users/Work/.hermes/hermes-agent/node_modules/playwright';

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
  const candidates = [path.join(ROOT, 'node_modules/playwright'), PW_PATH];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  // ---------------------------------------------------------------------
  // (1) Static: the CSS the fix is supposed to ship.
  // ---------------------------------------------------------------------
  await check('static: styles.css ships .lightbox rules (fixed, full-bleed, dark, above chrome)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'templates/portfolio/styles.css'), 'utf8');
    assert.match(css, /\.lightbox\s*\{[^}]*position:\s*fixed/, '.lightbox must be position:fixed');
    assert.match(css, /\.lightbox\s*\{[^}]*inset:\s*0/, '.lightbox must cover the viewport (inset:0)');
    assert.match(css, /\.lightbox\[hidden\]\s*\{[^}]*display:\s*none/, '.lightbox[hidden] must hide it');
    assert.match(css, /\.lightbox-img\s*\{[^}]*(max-width|object-fit)/, '.lightbox-img must be sized/contained');
    assert.match(css, /\.lightbox-close/, '.lightbox-close must be styled');
    assert.match(css, /\.lightbox-nav/, '.lightbox-nav must be styled');
    // z-index must clear the sticky chrome (40) and the WhatsApp QR modal (50).
    const zMatch = css.match(/\.lightbox\s*\{[^}]*z-index:\s*(\d+)/);
    assert.ok(zMatch, '.lightbox must set a z-index');
    assert.ok(Number(zMatch[1]) >= 60, '.lightbox z-index (' + zMatch[1] + ') must clear .pf-chrome (40) and .wa-qr (50)');
  });

  await check('static: styles.css ships a mobile nav toggle + drawer', () => {
    const css = fs.readFileSync(path.join(ROOT, 'templates/portfolio/styles.css'), 'utf8');
    assert.match(css, /\.pf-chrome__toggle/, 'a toggle button class must exist');
    assert.match(css, /max-width:\s*719\.98px|max-width:\s*719px|max-width:\s*720px/, 'a mobile breakpoint rule must exist');
  });

  await check('static: template.html ships an accessible hamburger button', () => {
    const html = fs.readFileSync(path.join(ROOT, 'templates/portfolio/template.html'), 'utf8');
    assert.match(html, /aria-expanded="false"/, 'toggle must start collapsed (aria-expanded=false)');
    const ctrlMatch = html.match(/aria-controls="([^"]+)"/);
    assert.ok(ctrlMatch, 'toggle must declare aria-controls');
    const targetId = ctrlMatch[1];
    assert.match(html, new RegExp('id="' + targetId + '"'), 'aria-controls must point to an element that exists (id="' + targetId + '")');
  });

  // ---------------------------------------------------------------------
  // Serve + publish a real portfolio site, then drive it with Chromium.
  // ---------------------------------------------------------------------
  const H = await startHarness('audit-portfolio-fixes');

  const report = {};

  try {
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
      // ---- Publish a real portfolio site (API publish + test checkout) ----
      const published = await H.publish('portfolio', publishConfig('portfolio'), { slug: 'audit-portfolio-fixes-' + Date.now() });
      const liveUrl = published.liveUrl;
      report.liveUrl = liveUrl;

      // ---- (2) Desktop: lightbox opens correctly over the live site ----
      await check('browser @ desktop: lightbox opens full-screen, fixed, dark, above chrome; Escape closes it', async () => {
        const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        try {
          await live.goto(liveUrl, { waitUntil: 'domcontentloaded' });
          if (await live.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
            await live.locator('#hb-cookie-accept').click().catch(() => {});
          }
          const photo = live.locator('.collage-photo').first();
          await photo.scrollIntoViewIfNeeded();
          await live.waitForTimeout(900); // let the scatter/settle animation finish
          await photo.click();
          await live.waitForTimeout(400);

          await live.screenshot({ path: path.join(EVIDENCE, 'desktop-lightbox-open.png') });

          const box = await live.evaluate(() => {
            const lb = document.querySelector('.lightbox');
            if (!lb || lb.hasAttribute('hidden')) return null;
            const r = lb.getBoundingClientRect();
            const cs = getComputedStyle(lb);
            const img = lb.querySelector('.lightbox-img');
            const ir = img && img.getBoundingClientRect();
            return {
              top: r.top, left: r.left, width: r.width, height: r.height,
              position: cs.position, display: cs.display, background: cs.backgroundColor,
              zIndex: Number(cs.zIndex) || 0,
              vw: window.innerWidth, vh: window.innerHeight,
              bodyOverflow: getComputedStyle(document.body).overflow,
              imgVisible: !!(ir && ir.width > 40 && ir.height > 40),
            };
          });
          assert.ok(box, 'lightbox must be visible (not [hidden]) after clicking a photo');
          assert.strictEqual(box.position, 'fixed', 'lightbox must be position:fixed, got ' + box.position);
          assert.ok(Math.abs(box.top) < 2 && Math.abs(box.left) < 2, 'lightbox must sit at the viewport origin, got top=' + box.top + ' left=' + box.left);
          assert.ok(box.width >= box.vw - 2 && box.height >= box.vh - 2, 'lightbox must cover the full viewport, got ' + box.width + 'x' + box.height + ' vs ' + box.vw + 'x' + box.vh);
          assert.notStrictEqual(box.background, 'rgba(0, 0, 0, 0)', 'lightbox background must not be transparent');
          assert.ok(box.zIndex >= 60, 'lightbox z-index (' + box.zIndex + ') must clear the sticky chrome/QR modal');
          assert.ok(box.imgVisible, 'lightbox image must render at a visible size');
          assert.strictEqual(box.bodyOverflow, 'hidden', 'body scroll must be locked while the lightbox is open');

          await live.keyboard.press('Escape');
          await live.waitForTimeout(300);
          const closed = await live.evaluate(() => {
            const lb = document.querySelector('.lightbox');
            return { hidden: lb ? lb.hasAttribute('hidden') : true, bodyOverflow: getComputedStyle(document.body).overflow };
          });
          assert.ok(closed.hidden, 'Escape must close the lightbox');
          assert.notStrictEqual(closed.bodyOverflow, 'hidden', 'Escape must restore body scroll');
          await live.screenshot({ path: path.join(EVIDENCE, 'desktop-lightbox-escape-closed.png') });
        } finally {
          await live.close();
        }
      });

      // ---- (3) Mobile 390px: hamburger + full-viewport drawer ----
      await check('browser @ 390px: hamburger opens a full-viewport nav drawer; Escape closes and returns focus', async () => {
        const live = await browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
          await live.goto(liveUrl, { waitUntil: 'domcontentloaded' });
          if (await live.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
            await live.locator('#hb-cookie-accept').click().catch(() => {});
          }
          await live.screenshot({ path: path.join(EVIDENCE, 'mobile-390-header-closed.png') });

          const navLinksHidden = await live.evaluate(() => {
            const nav = document.querySelector('.pf-chrome__nav');
            if (!nav) return true;
            const cs = getComputedStyle(nav);
            return cs.display === 'none' || cs.visibility === 'hidden';
          });
          assert.ok(navLinksHidden, 'the desktop inline nav must still be hidden below 720px (no duplicate visible nav)');

          const toggle = live.locator('.pf-chrome__toggle, [aria-controls]');
          await toggle.first().waitFor({ state: 'visible', timeout: 8000 });
          const toggleBox = await toggle.first().boundingBox();
          assert.ok(toggleBox, 'hamburger toggle must have a bounding box');
          assert.ok(toggleBox.width >= 44 && toggleBox.height >= 44, 'hamburger toggle must be >=44x44, got ' + toggleBox.width + 'x' + toggleBox.height);

          const beforeExpanded = await toggle.first().getAttribute('aria-expanded');
          assert.strictEqual(beforeExpanded, 'false', 'toggle must start collapsed');

          await toggle.first().click();
          await live.waitForTimeout(400);
          await live.screenshot({ path: path.join(EVIDENCE, 'mobile-390-nav-open.png') });

          const afterExpanded = await toggle.first().getAttribute('aria-expanded');
          assert.strictEqual(afterExpanded, 'true', 'toggle must flip to aria-expanded=true when opened');

          const controlsId = await toggle.first().getAttribute('aria-controls');
          assert.ok(controlsId, 'toggle must declare aria-controls');

          const drawerState = await live.evaluate((id) => {
            const nav = document.getElementById(id);
            if (!nav) return null;
            const r = nav.getBoundingClientRect();
            const cs = getComputedStyle(nav);
            const links = Array.from(nav.querySelectorAll('a')).map((a) => (a.textContent || '').trim());
            return {
              top: r.top, left: r.left, width: r.width, height: r.height,
              visibility: cs.visibility, position: cs.position,
              vw: window.innerWidth, vh: window.innerHeight,
              links,
            };
          }, controlsId);
          assert.ok(drawerState, 'aria-controls target (#' + controlsId + ') must exist in the DOM');
          assert.strictEqual(drawerState.visibility, 'visible', 'nav drawer must be visibility:visible when open');
          assert.strictEqual(drawerState.position, 'fixed', 'nav drawer must be position:fixed');
          // This is the exact regression a backdrop-filter ancestor would cause:
          // the fixed drawer gets contained to the header's own box instead of
          // the viewport, so it renders as a short strip instead of full-screen.
          assert.ok(Math.abs(drawerState.top) < 2 && Math.abs(drawerState.left) < 2, 'nav drawer must sit at the viewport origin, got top=' + drawerState.top + ' left=' + drawerState.left);
          assert.ok(
            drawerState.width >= drawerState.vw - 2 && drawerState.height >= drawerState.vh - 2,
            'nav drawer must cover the FULL viewport (not just the header strip), got ' +
              drawerState.width + 'x' + drawerState.height + ' vs viewport ' + drawerState.vw + 'x' + drawerState.vh
          );
          assert.ok(drawerState.links.length >= 3, 'nav drawer must carry the same nav links (Galerie/Servicii/Programare)');
          assert.ok(drawerState.links.some((t) => /galer/i.test(t)), 'drawer must include a Galerie-like link');
          assert.ok(drawerState.links.some((t) => /program/i.test(t)), 'drawer must include a Programare-like link');

          await live.keyboard.press('Escape');
          await live.waitForTimeout(350);
          await live.screenshot({ path: path.join(EVIDENCE, 'mobile-390-nav-escape-closed.png') });

          const afterEscape = await live.evaluate((id) => {
            const nav = document.getElementById(id);
            const toggleEl = document.activeElement;
            return {
              navVisibility: nav ? getComputedStyle(nav).visibility : null,
              focusedIsToggle: !!(toggleEl && (toggleEl.matches('.pf-chrome__toggle') || toggleEl.getAttribute('aria-controls') === id)),
            };
          }, controlsId);
          assert.strictEqual(afterEscape.navVisibility, 'hidden', 'Escape must close the nav drawer (visibility:hidden)');
          const escExpanded = await toggle.first().getAttribute('aria-expanded');
          assert.strictEqual(escExpanded, 'false', 'Escape must flip aria-expanded back to false');
          assert.ok(afterEscape.focusedIsToggle, 'Escape must return keyboard focus to the toggle button');
        } finally {
          await live.close();
        }
      });
    } finally {
      await browser.close();
    }
  } finally {
    await H.close();
  }

  fs.writeFileSync(path.join(EVIDENCE, 'oracle-report.json'), JSON.stringify(report, null, 2));

  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('OK audit-portfolio-fixes (PORT-01 lightbox + PORT-03 mobile nav locked)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
