#!/usr/bin/env node
/**
 * Proof-of-flow at 3099ebb / 5508863.
 * Continuous Playwright recording + stills named from the action just performed.
 * Isolated /app/ only. No product patches.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '04-Deliverables/Advocate-5508863');
const STILLS = path.join(OUT, 'stills');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

fs.mkdirSync(STILLS, { recursive: true });
for (const name of fs.readdirSync(STILLS)) {
  if (/\.(png|webm|mp4)$/.test(name)) fs.rmSync(path.join(STILLS, name), { force: true });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-5508863-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'proof-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'test';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PUBLIC_URL;

const require = createRequire(import.meta.url);
function loadPW() {
  for (const c of [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ]) {
    try { return require(c); } catch (_) {}
  }
  throw new Error('playwright not found');
}

const gitHead = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const log = { gitHead, startedAt: new Date().toISOString(), stills: [] };

(async () => {
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = 'http://127.0.0.1:' + server.address().port;

  const { chromium } = loadPW();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  let n = 0;
  async function still(step) {
    n += 1;
    const file = String(n).padStart(2, '0') + '-' + step + '.png';
    await page.screenshot({ path: path.join(STILLS, file) });
    log.stills.push(file);
    console.log('STILL', file);
    return file;
  }

  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await still('open-app-cookie-banner');
  await page.locator('#hb-cookie-accept').click();
  await page.waitForTimeout(400);
  await still('click-cookie-accept-catalog');

  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(900);
  await still('start-professionals-details-auto-open');

  await page.locator('#btn-close-drawer').click().catch(() => {});
  await page.locator('#details-drawer').waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  await still('close-drawer-desktop-preview');

  await page.locator('#btn-preview-mobile').click();
  await page.waitForTimeout(700);
  await still('click-mobile-preview-390');
  await page.locator('#btn-preview-desktop').click();
  await page.waitForTimeout(400);

  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await still('click-publish-trial-copy');

  const slug = 'proof550-' + Date.now().toString(36);
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await still('fill-publish-slug');
  await page.locator('#input-email').fill('proof@example.com');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await still('click-send-magic');
  await page.locator('#dev-link').click();
  await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await still('authenticated-unpaid-cta');
  await page.locator('#btn-pay-publish').click();
  await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ timeout: 25000 });
  await page.waitForTimeout(500);
  await still('click-test-pay-success');

  const liveHref = await page.locator('#success-url-link').getAttribute('href');
  log.liveHref = liveHref;
  await page.goto(new URL(liveHref, base).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await still('open-live-site');

  await page.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(800);
  await still('return-to-editor-canvas');

  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.locator('#btn-download-html').click();
  const htmlDl = await dl;
  await page.waitForTimeout(500);
  await still('click-paid-export-html');
  log.exportFile = htmlDl ? htmlDl.suggestedFilename() : null;

  await page.locator('#btn-back-templates').click();
  await page.waitForTimeout(700);
  await still('click-inapoi-catalog');
  await page.locator('a:has-text("Proiectele mele"), button:has-text("Proiectele mele")').first().click();
  await page.waitForTimeout(800);
  await still('click-proiectele-mele');

  page.once('dialog', (d) => d.accept().catch(() => {}));
  await page.locator('button:has-text("Anulează")').first().click();
  await page.waitForTimeout(1000);
  await still('click-anuleaza-ciorna');

  log.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'proof-log.json'), JSON.stringify(log, null, 2));

  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));

  const videos = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
  if (videos.length) {
    const src = path.join(OUT, videos[0]);
    const dest = path.join(OUT, 'flow.webm');
    if (src !== dest) fs.renameSync(src, dest);
    try {
      execFileSync('ffmpeg', ['-y', '-i', dest, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(OUT, 'flow.mp4')], {
        stdio: 'ignore',
      });
    } catch (_) {}
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PROOF stills=' + log.stills.length + ' video=' + fs.existsSync(path.join(OUT, 'flow.webm')));
})().catch((e) => { console.error(e); process.exit(1); });
