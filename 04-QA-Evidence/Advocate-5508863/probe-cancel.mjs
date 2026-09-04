#!/usr/bin/env node
/** Probe: Proiectele mele → Anulează, and cookie Află mai mult. No product patches. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '04-QA-Evidence/Advocate-5508863');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const require = createRequire(import.meta.url);
function loadPW() {
  for (const c of [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ]) {
    try { return require(c); } catch (_) {}
  }
  throw new Error('pw');
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advocate-cancel-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'advocate-cancel-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'test';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PUBLIC_URL;

const log = { defects: [], notes: [] };
function defect(t, d) { log.defects.push({ t, d }); console.log('DEFECT', t, d); }

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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(25000);

  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click();
  }

  // Cookie Află mai mult on landing is already dismissed. Re-open via a fresh site preview.
  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.locator('#details-drawer').waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  }
  const frame = page.frameLocator('#preview-iframe');
  const more = frame.locator('a.hb-cookie-link', { hasText: 'Află mai mult' });
  const moreCount = await more.count();
  log.notes.push('afla-mai-mult-count=' + moreCount);
  if (moreCount) {
    const href = await more.first().getAttribute('href');
    log.notes.push('afla-href=' + href);
    await more.first().click({ timeout: 4000 }).catch((e) => defect('Află mai mult click failed', String(e.message || e)));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'probe-click-afla-mai-mult.png') });
    const iframeUrl = await page.evaluate(() => {
      const i = document.querySelector('#preview-iframe');
      try { return i && i.contentWindow && i.contentWindow.location.href; } catch { return 'opaque'; }
    });
    const iframeText = await frame.locator('body').innerText().catch(() => '');
    log.notes.push('after-afla iframeUrl=' + iframeUrl + ' text=' + iframeText.slice(0, 180));
    if (/404|Cannot GET|Not Found/i.test(iframeText)) {
      defect('Află mai mult 404 in preview iframe', iframeText.slice(0, 200));
    }
  }

  // Publish + test pay on this draft
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await page.locator('#input-slug').fill('advcancel-' + Date.now().toString(36));
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill('cancel@example.com');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
  await page.locator('#btn-pay-publish').click();
  await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ timeout: 25000 });
  await page.screenshot({ path: path.join(OUT, 'probe-trial-success-projects-behind.png') });

  const anuleazaOnSuccess = await page.locator('button:has-text("Anulează")').count();
  log.notes.push('anuleaza-visible-during-success=' + anuleazaOnSuccess);

  await page.locator('#btn-success-close').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'probe-return-editor.png') });

  // Stranger path: Înapoi → Proiectele mele
  const back = page.locator('#btn-back-templates');
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(700);
  } else {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  }
  await page.screenshot({ path: path.join(OUT, 'probe-click-inapoi-catalog.png') });

  const proj = page.locator('a:has-text("Proiectele mele"), button:has-text("Proiectele mele")').first();
  const projVisible = await proj.isVisible().catch(() => false);
  log.notes.push('proiectele-mele-visible=' + projVisible);
  if (!projVisible) {
    defect('Proiectele mele not visible after Înapoi', '');
  } else {
    await proj.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'probe-click-proiectele-mele.png') });
    const cancelBtn = page.locator('button:has-text("Anulează")').first();
    const cancelVis = await cancelBtn.isVisible().catch(() => false);
    log.notes.push('anuleaza-on-projects=' + cancelVis);
    if (!cancelVis) {
      defect('Anulează missing on Proiectele mele', await page.locator('body').innerText().then((t) => t.slice(0, 300)));
    } else {
      page.once('dialog', (d) => d.accept().catch(() => {}));
      await cancelBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, 'probe-click-anuleaza.png') });
      const after = await page.locator('body').innerText();
      log.notes.push('after-cancel=' + after.slice(0, 300));
      if (!/ciorn|anulat|draft/i.test(after) && !/Nu mai e live|anulat/i.test(after)) {
        // still ok if the live badge disappeared
        log.notes.push('cancel-copy-ambiguous');
      }
    }
  }

  fs.writeFileSync(path.join(OUT, 'probe-cancel.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(tmpDir, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
