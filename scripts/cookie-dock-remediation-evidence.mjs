#!/usr/bin/env node
/**
 * Binding screenshots for cookie-vs-dock remediation.
 * Filenames are the action just performed (owner screenshot-claim rule).
 */
'use strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '04-QA-Evidence/cookie-dock-remediation/screenshots');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const TPLS = ['local-service', 'portfolio', 'product-menu', 'professionals', 'desserdirina'];

fs.mkdirSync(OUT, { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-dock-ev-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'cookie-dock-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'pipe'],
});

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

function boxesHit(a, b, pad = 2) {
  if (!a || !b) return false;
  return !(
    a.x + a.width - pad <= b.x ||
    b.x + b.width - pad <= a.x ||
    a.y + a.height - pad <= b.y ||
    b.y + b.height - pad <= a.y
  );
}

async function main() {
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
  });

  const inventory = [];
  const failures = [];

  try {
    for (const vp of [
      { width: 1440, height: 1000, label: 'desktop' },
      { width: 390, height: 844, label: 'mobile' },
    ]) {
      const page = await browser.newPage({ viewport: vp });
      page.setDefaultTimeout(30000);
      await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
      if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
        await page.locator('#hb-cookie-accept').click().catch(() => {});
      }

      for (const system of TPLS) {
        await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(250);
        await page.locator(`.template-card[data-template-id="${system}"] .btn-start-tpl`).click();
        await page.waitForURL(/#edit$/, { timeout: 30000 });
        await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(1100);
        const drawer = page.locator('#details-drawer');
        if (await drawer.isVisible().catch(() => false)) {
          await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
          await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
        }

        if (vp.label === 'mobile') {
          // Prefer in-editor 390 toggle on a wide outer chrome (stranger path).
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.waitForTimeout(200);
          const mobBtn = page.locator('#btn-preview-mobile').first();
          if (await mobBtn.count()) {
            await mobBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(500);
          } else {
            await page.setViewportSize({ width: 390, height: 844 });
          }
        }

        const frame = page.frameLocator('#preview-iframe');
        await frame.locator('body').waitFor({ state: 'attached', timeout: 20000 });
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
        await page.waitForTimeout(300);
        await frame.locator('#hb-cookie-banner').waitFor({ state: 'visible', timeout: 10000 });

        const metrics = await frame.locator('body').evaluate(() => {
          const banner = document.getElementById('hb-cookie-banner');
          const br = banner.getBoundingClientRect();
          const bannerBox = { x: br.x, y: br.y, width: br.width, height: br.height };
          const vw = window.innerWidth || 800;
          const sels = ['.ls-dock', '.ls-dock__call', '.ls-dock__wa', '.whatsapp-float', 'a.whatsapp-float'];
          const actions = [];
          for (const sel of sels) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              const r = el.getBoundingClientRect();
              if (r.width < 4 || r.height < 4) continue;
              actions.push({
                sel,
                text: String(el.innerText || el.getAttribute('aria-label') || '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 80),
                box: { x: r.x, y: r.y, width: r.width, height: r.height },
              });
            }
          }
          return {
            bannerBox,
            bannerCorner: bannerBox.x + bannerBox.width / 2 < vw / 2 ? 'left' : 'right',
            openClass: document.documentElement.classList.contains('hb-cookie-open'),
            actions,
          };
        });

        const overlaps = metrics.actions.filter((a) => boxesHit(metrics.bannerBox, a.box));
        const name = `${system}-cookie-open-${vp.label}.png`;
        const shotPath = path.join(OUT, name);
        // Capture the preview iframe region when possible; fall back to full page.
        const iframe = page.locator('#preview-iframe');
        if (await iframe.count()) {
          await iframe.screenshot({ path: shotPath });
        } else {
          await page.screenshot({ path: shotPath, fullPage: false });
        }

        const row = {
          file: name,
          system,
          viewport: vp.label,
          bannerCorner: metrics.bannerCorner,
          openClass: metrics.openClass,
          actionCount: metrics.actions.length,
          overlaps: overlaps.length,
          ok: metrics.bannerCorner === 'left' && overlaps.length === 0 && metrics.actions.length > 0,
        };
        inventory.push(row);
        if (!row.ok) failures.push(row);
        console.log(
          (row.ok ? 'OK' : 'FAIL'),
          name,
          'corner=' + row.bannerCorner,
          'actions=' + row.actionCount,
          'overlaps=' + row.overlaps
        );
      }
      await page.close();
    }

    // Legal titles regression spot-check
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    for (const [slug, expected] of [
      ['terms.html', 'Termeni de utilizare — Hidook Site Builder'],
      ['privacy.html', 'Confidențialitate — Hidook Site Builder'],
      ['cookies.html', 'Cookie-uri — Hidook Site Builder'],
    ]) {
      await page.goto(base + '/app/' + slug, { waitUntil: 'domcontentloaded' });
      const title = await page.title();
      const name = `legal-${slug.replace('.html', '')}-title-desktop.png`;
      await page.screenshot({ path: path.join(OUT, name), fullPage: false });
      const ok = title === expected;
      inventory.push({ file: name, title, expected, ok });
      if (!ok) failures.push({ file: name, title, expected });
      console.log(ok ? 'OK' : 'FAIL', name, title);
    }
    await page.close();
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  fs.writeFileSync(
    path.join(ROOT, '04-QA-Evidence/cookie-dock-remediation/INVENTORY.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), inventory, failures }, null, 2)
  );
  fs.writeFileSync(
    path.join(ROOT, '04-QA-Evidence/cookie-dock-remediation/README.md'),
    [
      '# Cookie-vs-dock remediation evidence',
      '',
      'Script: `scripts/cookie-dock-remediation-evidence.mjs`',
      'Each screenshot name is the action just performed.',
      '',
      failures.length
        ? 'RESULT: FAIL (' + failures.length + ' issues)'
        : 'RESULT: PASS — cookie bottom-left, no dock/WA overlap on 5 systems × desktop+mobile.',
      '',
    ].join('\n')
  );

  if (failures.length) {
    console.error('FAILURES', JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log('OK cookie-dock remediation evidence —', inventory.length, 'shots');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
