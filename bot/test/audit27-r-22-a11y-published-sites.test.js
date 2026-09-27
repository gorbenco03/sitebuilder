'use strict';
/**
 * bot/test/audit27-r-22-a11y-published-sites.test.js
 *
 * Oracle for R-22 (PLAN-AUDIT-2026-09-27.md §4), covering three findings from
 * 04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json, all five
 * published templates (product-menu, local-service, portfolio, professionals,
 * desserdirina):
 *
 *   - a11y#3: no template shipped a "skip to content" link, so a keyboard
 *     visitor had no WCAG 2.4.1 bypass mechanism over repeated nav.
 *   - whatsapp-contact#3: opening the WhatsApp QR modal (aria-modal="true")
 *     never moved keyboard focus inside it and never trapped Tab, so a
 *     keyboard/screen-reader user had to tab through the rest of the
 *     (visually covered) page to reach its controls; Escape closed it but
 *     never returned focus to the trigger.
 *   - images-media#6: no <img> on any published site had a fallback for a
 *     failed load — a visitor would see the browser's raw broken-image icon.
 *
 * Renders each template through the real build() pipeline (publish + ZIP
 * export path — same precedent as audit27-r12) into a temp dir, drives it
 * with a real Chromium page, and asserts the fixed behaviour. Each assertion
 * fails against the pre-fix script.js/template.html (no skip-link markup, no
 * focus movement/trap in initWhatsAppQR, no error listener) and passes with
 * this task's change.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-22-a11y-published-sites.test.js
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const { build } = require(path.join(ROOT, 'build.js'));

const TEMPLATES = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

function loadPreset(id) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', id, 'presets.json'), 'utf8'));
  return JSON.parse(JSON.stringify(raw.presets[0].config));
}

/** Writes template.html + config.json + the real script.js/styles.css/
 * qrcode.js (+ collage.js when the template ships one) into a fresh tmp dir
 * and runs the production build() pipeline, then returns the file:// URL of
 * the resulting index.html. The images/ directory is deliberately NOT
 * copied — every images/*.jpg reference then 404s under file://, which is
 * exactly the "source becomes invalid" repro images-media#6 describes. */
function buildSite(id, cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r-22-' + id + '-'));
  const tplDir = path.join(ROOT, 'templates', id);
  fs.writeFileSync(path.join(dir, 'template.html'), fs.readFileSync(path.join(tplDir, 'template.html'), 'utf8'), 'utf8');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg), 'utf8');
  for (const asset of ['styles.css', 'script.js', 'qrcode.js', 'collage.js']) {
    const src = path.join(tplDir, asset);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, asset));
  }
  build(dir);
  return 'file://' + path.join(dir, 'index.html');
}

test('published-site a11y fixes (R-22): skip link, WhatsApp modal focus trap, broken-image fallback', async (t) => {
  const browser = await chromium.launch();
  try {
    await t.test('a11y#3: every template ships a skip link that targets a real, focusable landmark', async () => {
      for (const id of TEMPLATES) {
        const html = fs.readFileSync(path.join(ROOT, 'templates', id, 'template.html'), 'utf8');
        const linkMatch = /<a href="#([\w-]+)" class="skip-link">([^<]+)<\/a>/.exec(html);
        assert.ok(linkMatch, `${id}: template.html must ship <a class="skip-link"> right after <body>`);
        assert.equal(linkMatch[2], 'Sari la conținut', `${id}: skip link text must read "Sari la conținut"`);
        const targetId = linkMatch[1];
        const targetRe = new RegExp('<main[^>]*\\bid="' + targetId + '"[^>]*\\btabindex="-1"');
        assert.match(html, targetRe, `${id}: #${targetId} must exist on a focusable (<main tabindex="-1">) landmark`);

        const css = fs.readFileSync(path.join(ROOT, 'templates', id, 'styles.css'), 'utf8');
        assert.match(css, /\.skip-link\s*\{[^}]*position:\s*absolute/, `${id}: .skip-link must be positioned off-canvas, not display:none (must stay in the a11y/tab tree)`);
        assert.match(css, /\.skip-link:focus\s*\{/, `${id}: .skip-link must define a :focus state that brings it on screen`);
      }
    });

    for (const id of TEMPLATES) {
      await t.test(`${id}: skip link is the first Tab stop and moves focus to <main>`, async () => {
        const url = buildSite(id, loadPreset(id));
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: 'load' });
          await page.keyboard.press('Tab');
          const first = await page.evaluate(() => ({
            isSkipLink: document.activeElement ? document.activeElement.classList.contains('skip-link') : false,
            href: document.activeElement ? document.activeElement.getAttribute('href') : null,
          }));
          assert.ok(first.isSkipLink, `${id}: the very first Tab stop must be the skip link, got ${first.href}`);

          // A real click (not a raw keyboard Enter dispatch, which some of
          // these templates' own click-driven anchor handlers don't react
          // to identically under Chromium/file://) activates the link.
          await page.locator('.skip-link').click();
          const landed = await page.evaluate(() => {
            const el = document.activeElement;
            return el ? { tag: el.tagName, id: el.id } : null;
          });
          assert.equal(landed && landed.tag, 'MAIN', `${id}: activating the skip link must move focus onto <main>, got ${landed && landed.tag}`);
        } finally {
          await page.close();
        }
      });

      await t.test(`${id}: WhatsApp QR modal moves focus in, traps Tab, and restores focus on Escape`, async () => {
        const url = buildSite(id, loadPreset(id));
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: 'load' });

          // local-service also renders a second wa.me link (.ls-dock__wa) that
          // sits visually in front of .whatsapp-float at desktop widths — pick
          // whichever of the two known trigger classes comes first in DOM
          // order (the one that's actually reachable), and mark it so the
          // post-Escape focus check doesn't need to guess its class name.
          const trigger = page.locator('a.whatsapp-float, a.ls-dock__wa').first();
          await trigger.waitFor({ state: 'visible' });
          await trigger.evaluate((el) => el.setAttribute('data-r22-trigger', '1'));
          await trigger.focus();
          await trigger.click();

          await page.waitForFunction(() => {
            const m = document.getElementById('wa-qr');
            return m && !m.hidden;
          });

          const afterOpen = await page.evaluate(() => {
            const active = document.activeElement;
            const modal = document.getElementById('wa-qr');
            return {
              insideModal: !!(active && modal && modal.contains(active)),
              isCloseBtn: !!(active && active.classList.contains('wa-qr__close')),
            };
          });
          assert.ok(afterOpen.insideModal, `${id}: opening the WhatsApp modal must move focus inside it`);
          assert.ok(afterOpen.isCloseBtn, `${id}: focus should land on the modal's close button first`);

          // Tab from the last focusable (the "open in WhatsApp" link) must wrap to the first (close button).
          await page.locator('#wa-qr-open').focus();
          await page.keyboard.press('Tab');
          const wrappedForward = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('wa-qr__close'));
          assert.ok(wrappedForward, `${id}: Tab on the last focusable inside the modal must wrap to the close button, not escape the dialog`);

          // Shift+Tab from the first focusable (close button) must wrap to the last (open link).
          await page.locator('.wa-qr__close').focus();
          await page.keyboard.press('Shift+Tab');
          const wrappedBack = await page.evaluate(() => document.activeElement && document.activeElement.id === 'wa-qr-open');
          assert.ok(wrappedBack, `${id}: Shift+Tab on the close button must wrap to the last focusable (#wa-qr-open)`);

          await page.keyboard.press('Escape');
          await page.waitForFunction(() => {
            const m = document.getElementById('wa-qr');
            return m && m.hidden;
          });
          const afterClose = await page.evaluate(() => {
            const active = document.activeElement;
            return { isTrigger: !!(active && active.getAttribute && active.getAttribute('data-r22-trigger') === '1') };
          });
          assert.ok(afterClose.isTrigger, `${id}: Escape must return focus to the element that opened the modal`);
        } finally {
          await page.close();
        }
      });

      await t.test(`${id}: a broken <img> gets a neutral fallback instead of the browser's broken-image icon`, async () => {
        const url = buildSite(id, loadPreset(id));
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: 'load' });
          // Not every preset ships a real content photo (professionals'
          // default config has none), so the generic delegated-listener
          // mechanism is exercised directly with a deliberately-broken <img>
          // rather than relying on preset photos happening to 404.
          await page.evaluate(() => {
            const img = document.createElement('img');
            img.setAttribute('data-r22-broken', '1');
            img.alt = 'r22 broken image probe';
            img.src = 'images/does-not-exist-r22.png';
            document.body.appendChild(img);
          });
          await page.waitForFunction(() => {
            const img = document.querySelector('img[data-r22-broken="1"]');
            return !!img && img.classList.contains('img-fallback');
          }, null, { timeout: 5000 });
          const result = await page.evaluate(() => {
            const img = document.querySelector('img[data-r22-broken="1"]');
            return { src: img.src };
          });
          assert.equal(result.src.indexOf('data:image/svg+xml'), 0, `${id}: a caught broken <img> must have its src swapped for the inline neutral placeholder, got ${result.src.slice(0, 40)}`);
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});
