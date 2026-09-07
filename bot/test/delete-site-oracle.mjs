#!/usr/bin/env node
/**
 * Failing-first oracle: DELETE /api/sites/:id driven through the REAL
 * dashboard with Playwright (not a direct API call) — the "Șterge" button
 * on a site card, the type-the-name confirmation modal, and the dashboard
 * actually losing the card after a successful delete.
 *
 * Pass 1 (desktop, 1440x900): full happy path — pick a template, publish a
 * real site (HIDOOK_TEST_PAY + HIDOOK_ISOLATED_DEPLOY, same pattern as
 * bot/test/fullpass-63230d2.mjs), open the delete modal, try a WRONG
 * confirmation name (button must stay disabled, nothing deleted), then the
 * CORRECT name, confirm, and assert: gone from #sites-list AND the registry
 * row AND the isolated published directory are both gone on disk.
 *
 * Pass 2 (mobile, 390x844): same signed-in session, a second site (seeded
 * directly through the publish pipeline to keep this pass fast), same
 * confirm-by-typing-the-name modal, screenshotted at 390x844.
 *
 * Run:
 *   HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 node bot/test/delete-site-oracle.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);

const pwCandidates = [
  path.join(ROOT, 'node_modules/playwright'),
  path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
];
let chromium;
for (const cand of pwCandidates) {
  try {
    ({ chromium } = require(cand));
    break;
  } catch (_) {}
}
if (!chromium) {
  throw new Error('playwright not found; install or link node_modules/playwright');
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function run() {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-site-oracle-'));
  process.env.SERVER_SECRET = 'delete-site-oracle-' + crypto.randomBytes(12).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.VERCEL_TOKEN;

  const evidenceDir = path.join(ROOT, '04-QA-Evidence', 'Delete-Site-Oracle');
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const name of fs.readdirSync(evidenceDir)) {
    fs.rmSync(path.join(evidenceDir, name), { force: true });
  }

  const log = { oracle: 'delete-site-oracle', startedAt: new Date().toISOString(), entries: [], defects: [] };
  const logPath = path.join(evidenceDir, 'oracle-log.json');
  const writeLog = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
  writeLog();

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const registry = require(path.join(ROOT, 'bot', 'registry.js'));
  const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const dataDir = process.env.DATA_DIR;

  function publishedDir(slug) {
    return path.join(dataDir, 'published', slug);
  }

  const browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
  let failed = false;

  function defect(title, detail) {
    failed = true;
    log.defects.push({ title, detail, timestamp: new Date().toISOString() });
    writeLog();
    console.error('DEFECT', title, '-', detail);
  }

  function assertOracle(cond, title, detail) {
    if (!cond) defect(title, detail || '');
    else console.log('OK  ', title);
  }

  async function shot(page, name) {
    const index = log.entries.length;
    const file = String(index + 1).padStart(2, '0') + '-' + slugify(name) + '.png';
    await page.screenshot({ path: path.join(evidenceDir, file) });
    log.entries.push({ index, name, file, timestamp: new Date().toISOString() });
    writeLog();
    console.log('SHOT', file, name);
  }

  // ---------------------------------------------------------------------
  // Pass 1 — desktop 1440x900: full happy path through the real UI
  // ---------------------------------------------------------------------
  const context1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page1 = await context1.newPage();
  page1.setDefaultTimeout(20000);

  const email = 'delete-oracle@example.com';
  let siteId1 = null;
  let slug1 = null;

  try {
    await page1.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page1.locator('#hb-cookie-banner').waitFor({ state: 'visible' });
    await page1.locator('#hb-cookie-accept').click();
    await page1.locator('#hb-cookie-banner').waitFor({ state: 'hidden' });

    await page1.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
    await page1.waitForURL(/#edit$/, { timeout: 25000 });
    await page1.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
    await page1.waitForTimeout(600);

    // The details drawer auto-opens on a fresh template pick and its overlay
    // intercepts clicks outside it — close it first (same as fullpass-63230d2).
    const drawer = page1.locator('#details-drawer');
    if (await drawer.isVisible().catch(() => false)) {
      await page1.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
        await page1.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
      });
      await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
      await page1.locator('#drawer-overlay').waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    }

    await page1.locator('#btn-publish').click();
    await page1.locator('#modal-publish').waitFor({ state: 'visible' });
    slug1 = 'del-oracle-' + Date.now().toString(36);
    await page1.locator('#input-slug').fill(slug1);
    await page1.locator('#btn-publish-continue').click();
    await page1.locator('#form-auth-email').waitFor({ state: 'visible' });

    await page1.locator('#input-email').fill(email);
    await page1.locator('#btn-send-magic').click();
    await page1.locator('#dev-link').waitFor({ state: 'visible' });
    await page1.locator('#dev-link').click();
    await page1.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page1.locator('#btn-pay-publish').click();
    await page1.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({
      state: 'visible', timeout: 25000,
    });
    await shot(page1, 'site-published-success');

    siteId1 = await page1.evaluate(() => window.currentSiteId ?? currentSiteId);
    assertOracle(!!siteId1, 'publish sets currentSiteId', 'siteId1=' + siteId1);

    const regSite = registry.getSite(siteId1);
    assertOracle(!!regSite, 'registry row exists right after publish');
    assertOracle(fs.existsSync(publishedDir(slug1)), 'published dir exists right after publish', publishedDir(slug1));

    // Close the success modal before leaving — it stays on top of the
    // dashboard (and intercepts clicks) if left open across a hash change.
    await page1.locator('#btn-close-success').click();
    await page1.locator('#modal-success').waitFor({ state: 'hidden', timeout: 5000 });

    // Navigate to the dashboard (SPA route change, not a full reload).
    await page1.evaluate(() => { window.location.hash = '#dashboard'; });
    await page1.waitForTimeout(600);
    const card = page1.locator('.site-card', { hasText: slug1.replace(/-/g, '‑') });
    await card.first().waitFor({ state: 'visible', timeout: 10000 });
    await shot(page1, 'dashboard-with-site');

    // A freshly test-paid site has an active subscription — the "Șterge"
    // button must still open the modal, but the server must REFUSE the
    // delete (409 ACTIVE_SUBSCRIPTION) rather than silently succeed. Prove
    // that live, through the real UI, before cancelling and deleting for real.
    await card.first().locator('button', { hasText: 'Șterge' }).click();
    await page1.locator('#modal-delete-site').waitFor({ state: 'visible' });
    await page1.locator('#input-delete-confirm').fill(slug1);
    await page1.waitForTimeout(150);
    await shot(page1, 'delete-modal-active-subscription-before-refusal');
    await page1.locator('#btn-confirm-delete-site').click();
    const refusalError = page1.locator('#delete-site-error');
    await refusalError.waitFor({ state: 'visible', timeout: 10000 });
    const refusalText = await refusalError.innerText();
    assertOracle(/abonament activ/i.test(refusalText), 'active-subscription refusal shown in the modal', refusalText);
    await shot(page1, 'delete-modal-active-subscription-refused');
    assertOracle(!!registry.getSite(siteId1), 'site NOT deleted while its subscription is active');
    await page1.locator('#btn-close-delete-site').click();
    await page1.locator('#modal-delete-site').waitFor({ state: 'hidden', timeout: 5000 });

    // Cancel first (the existing "Anulează" → billing-portal flow), same as
    // a real owner would have to before the site becomes deletable.
    page1.once('dialog', (d) => d.accept());
    await card.first().locator('button', { hasText: 'Anulează' }).click();
    await page1.waitForURL(/#(test-billing-portal|dashboard)/, { timeout: 10000 });
    await page1.waitForTimeout(500);
    const cancelledSite = registry.getSite(siteId1);
    assertOracle(cancelledSite && cancelledSite.status === 'unpublished', 'cancel unpublished the site before delete', JSON.stringify(cancelledSite));
    await page1.evaluate(() => { window.location.hash = '#dashboard'; });
    await page1.waitForTimeout(500);

    // Now the real delete: open the modal on the now-cancelled card.
    const cardAfterCancel = page1.locator('.site-card', { hasText: slug1.replace(/-/g, '‑') });
    await cardAfterCancel.first().waitFor({ state: 'visible', timeout: 10000 });
    await cardAfterCancel.first().locator('button', { hasText: 'Șterge' }).click();
    await page1.locator('#modal-delete-site').waitFor({ state: 'visible' });
    await shot(page1, 'delete-modal-open');

    // WRONG confirmation text: button must stay disabled, nothing deleted.
    await page1.locator('#input-delete-confirm').fill('nu este numele corect');
    await page1.waitForTimeout(150);
    const disabledWrong = await page1.locator('#btn-confirm-delete-site').isDisabled();
    assertOracle(disabledWrong, 'confirm button disabled on wrong name');
    await shot(page1, 'delete-modal-wrong-name');
    assertOracle(!!registry.getSite(siteId1), 'site NOT deleted after wrong confirmation name');

    // CORRECT confirmation text.
    await page1.locator('#input-delete-confirm').fill('');
    await page1.locator('#input-delete-confirm').fill(slug1);
    await page1.waitForTimeout(150);
    const enabledCorrect = await page1.locator('#btn-confirm-delete-site').isEnabled();
    assertOracle(enabledCorrect, 'confirm button enabled on exact name match');
    await shot(page1, 'delete-modal-correct-name');

    await page1.locator('#btn-confirm-delete-site').click();
    await page1.locator('#modal-delete-site').waitFor({ state: 'hidden', timeout: 10000 });
    await page1.waitForTimeout(400);
    await shot(page1, 'after-delete-dashboard');

    const cardGoneCount = await page1.locator('.site-card', { hasText: slug1.replace(/-/g, '‑') }).count();
    assertOracle(cardGoneCount === 0, 'site card gone from #sites-list after delete', 'count=' + cardGoneCount);
    assertOracle(registry.getSite(siteId1) === null, 'registry row gone after delete');
    assertOracle(!fs.existsSync(publishedDir(slug1)), 'published dir gone after delete', publishedDir(slug1));
  } catch (e) {
    defect('desktop pass threw', e.stack || e.message);
  }
  await context1.close();

  // ---------------------------------------------------------------------
  // Pass 2 — mobile 390x844: same signed-in user, a second (seeded) site,
  // confirmation modal screenshotted at mobile size.
  // ---------------------------------------------------------------------
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await context2.newPage();
  page2.setDefaultTimeout(20000);

  try {
    const user = registry.getOrCreateUserByEmail(email);
    const slug2 = 'del-oracle-m-' + Date.now().toString(36);
    const site2 = registry.createSite({
      userId: user.id, templateId: 'portfolio', templateVersion: 1, slug: slug2, platform: 'web',
    });
    registry.updateSite(site2.id, { paid: true });
    const siteDir = path.join(dataDir, 'sites', site2.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>' + slug2 + '</h1>');
    await webpublish.publishSite({
      site: registry.getSite(site2.id), config: {}, images: [], siteDirAlreadyBuilt: true,
    });
    assertOracle(fs.existsSync(publishedDir(slug2)), 'mobile-pass site published before delete');

    await page2.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page2.locator('#hb-cookie-banner').waitFor({ state: 'visible' });
    await page2.locator('#hb-cookie-accept').click();
    await page2.locator('#hb-cookie-banner').waitFor({ state: 'hidden' });

    // Sign in as the same user (magic link + dev-link) to get a session cookie.
    // The dashboard-auth panel appears once we route to #dashboard unauthenticated.
    await page2.evaluate(() => { window.location.hash = '#dashboard'; });
    await page2.waitForTimeout(400);
    const authBtn = page2.locator('#btn-dashboard-auth');
    if (await authBtn.isVisible().catch(() => false)) {
      await authBtn.click();
    }
    const emailInput = page2.locator('#input-email');
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(email);
      await page2.locator('#btn-send-magic').click();
      await page2.locator('#dev-link').waitFor({ state: 'visible' });
      await page2.locator('#dev-link').click();
      await page2.waitForTimeout(400);
    }
    await page2.evaluate(() => { window.location.hash = '#dashboard'; });
    await page2.waitForTimeout(600);

    const card2 = page2.locator('.site-card', { hasText: slug2.replace(/-/g, '‑') });
    await card2.first().waitFor({ state: 'visible', timeout: 10000 });
    await shot(page2, 'mobile-dashboard-with-site');

    await card2.first().locator('button', { hasText: 'Șterge' }).click();
    await page2.locator('#modal-delete-site').waitFor({ state: 'visible' });
    await shot(page2, 'mobile-delete-modal-open');

    await page2.locator('#input-delete-confirm').fill('gresit');
    await page2.waitForTimeout(150);
    assertOracle(await page2.locator('#btn-confirm-delete-site').isDisabled(), 'mobile: confirm disabled on wrong name');
    await shot(page2, 'mobile-delete-modal-wrong-name');

    await page2.locator('#input-delete-confirm').fill('');
    await page2.locator('#input-delete-confirm').fill(slug2);
    await page2.waitForTimeout(150);
    assertOracle(await page2.locator('#btn-confirm-delete-site').isEnabled(), 'mobile: confirm enabled on exact match');
    await shot(page2, 'mobile-delete-modal-correct-name');

    await page2.locator('#btn-confirm-delete-site').click();
    await page2.locator('#modal-delete-site').waitFor({ state: 'hidden', timeout: 10000 });
    await page2.waitForTimeout(400);
    await shot(page2, 'mobile-after-delete-dashboard');

    const gone2 = await page2.locator('.site-card', { hasText: slug2.replace(/-/g, '‑') }).count();
    assertOracle(gone2 === 0, 'mobile: site card gone from list after delete');
    assertOracle(registry.getSite(site2.id) === null, 'mobile: registry row gone after delete');
    assertOracle(!fs.existsSync(publishedDir(slug2)), 'mobile: published dir gone after delete');
  } catch (e) {
    defect('mobile pass threw', e.stack || e.message);
  }
  await context2.close();

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  log.finishedAt = new Date().toISOString();
  log.result = failed ? 'FAIL' : 'PASS';
  writeLog();
  console.log('\n=== delete-site-oracle:', log.result, '===');
  if (failed) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
