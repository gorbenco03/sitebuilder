#!/usr/bin/env node
/**
 * Binding Flow 2 browser oracle.
 *
 * Every interaction is followed immediately by its deterministically named
 * screenshot and an append-only-in-order JSON log update. The final verifier
 * checks the declared step sequence, filename, file digest, and content check.
 *
 * Run one system:
 *   HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 \
 *     node bot/test/flow2-template-e2e.mjs professionals
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);

export const FIXTURES = Object.freeze({
  professionals: {
    businessName: 'OF7 Cabinet Delta — Profesioniști',
    color: '#2F6B5F',
    background: '#E8F2EE',
    photo: 'templates/product-menu/images/cn-d1.jpg',
  },
  'local-service': {
    businessName: 'OF7 Atelier Delta — Servicii Locale',
    color: '#1D5B79',
    background: '#E7F1F7',
    photo: 'templates/portfolio/images/iv-mani1.jpg',
  },
  portfolio: {
    businessName: 'OF7 Studio Delta — Portofoliu',
    color: '#7A3E65',
    background: '#F5EAF1',
    photo: 'templates/local-service/images/ct-ac1.jpg',
  },
  'product-menu': {
    businessName: 'OF7 Bistro Delta — Meniu',
    color: '#A44721',
    background: '#F8EDE6',
    photo: 'templates/desserdirina/images/cupcakes-1.jpg',
  },
  desserdirina: {
    businessName: 'OF7 Desserdirina Delta',
    color: '#8D3159',
    background: '#FAEAF1',
    photo: 'templates/product-menu/images/tv-a1.jpg',
  },
});

export const ORACLE_STEPS = Object.freeze([
  { name: 'accept-cookie', selector: '#hb-cookie-accept', action: 'click' },
  { name: 'pick-template', selector: '.template-card[data-template-id="{system}"] .btn-start-tpl', action: 'click' },
  { name: 'close-details-for-inline-edit', selector: '#btn-close-drawer', action: 'click' },
  { name: 'edit-distinctive-text', selector: '#preview-iframe [data-hb-edit="business.name"]', action: 'click + fill + blur' },
  { name: 'open-details-for-photo', selector: '#btn-open-drawer', action: 'click' },
  { name: 'edit-distinctive-photo', selector: '[data-field-key="hero.background"] button', action: 'click + setInputFiles' },
  { name: 'close-details', selector: '#btn-close-drawer', action: 'click' },
  { name: 'edit-distinctive-colors', selector: '#btn-color-picker, #color-custom-text, #color-bg-text', action: 'click + fill' },
  { name: 'close-colors', selector: '#btn-color-picker', action: 'click' },
  { name: 'preview-mobile', selector: '#btn-preview-mobile', action: 'click' },
  { name: 'open-publish', selector: '#btn-publish', action: 'click' },
  { name: 'continue-publish-address', selector: '#input-slug, #btn-publish-continue', action: 'fill + click' },
  { name: 'send-magic-link', selector: '#input-email, #btn-send-magic', action: 'fill + click' },
  { name: 'open-magic-link', selector: '#dev-link', action: 'click' },
  { name: 'test-pay-publish', selector: '#btn-pay-publish', action: 'click' },
  { name: 'open-live-site', selector: '#success-url-link', action: 'click' },
]);

function slugifyStep(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function expectedScreenshotName(index, stepName) {
  return String(index + 1).padStart(2, '0') + '-' + slugifyStep(stepName) + '.png';
}

export function expectedSelector(step, system) {
  return step.selector.replaceAll('{system}', system);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function verifyEvidence({ system, entries, evidenceDir }) {
  assert.ok(FIXTURES[system], 'unknown system: ' + system);
  assert.equal(entries.length, ORACLE_STEPS.length, 'step count must match the declared oracle journey');
  ORACLE_STEPS.forEach((step, index) => {
    const entry = entries[index];
    assert.ok(entry, 'missing step sequence entry ' + index);
    assert.equal(entry.index, index, 'step sequence index mismatch at ' + step.name);
    assert.equal(entry.step, step.name, 'step sequence mismatch at index ' + index);
    assert.equal(entry.selector, expectedSelector(step, system), 'selector mismatch at ' + step.name);
    assert.equal(entry.action, step.action, 'action mismatch at ' + step.name);
    const expectedName = expectedScreenshotName(index, step.name);
    assert.equal(entry.screenshot, expectedName, 'screenshot filename mismatch at ' + step.name);
    const screenshotPath = path.join(evidenceDir, expectedName);
    assert.ok(fs.existsSync(screenshotPath), 'screenshot missing at ' + step.name);
    assert.equal(sha256File(screenshotPath), entry.screenshotSha256, 'screenshot digest mismatch at ' + step.name);
    assert.ok(entry.timestamp && !Number.isNaN(Date.parse(entry.timestamp)), 'timestamp missing at ' + step.name);
    assert.equal(entry.contentCheck?.ok, true, 'content check failed at ' + step.name);
    assert.ok(entry.contentCheck?.detail, 'content check detail missing at ' + step.name);
  });
  return true;
}

async function waitForEditorText(page, text) {
  await page
    .frameLocator('#preview-iframe')
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
}

async function run(system) {
  const fixture = FIXTURES[system];
  assert.ok(fixture, 'Usage: node bot/test/flow2-template-e2e.mjs <' + Object.keys(FIXTURES).join('|') + '>');
  assert.equal(process.env.HIDOOK_TEST_PAY, '1', 'boot requires HIDOOK_TEST_PAY=1');
  assert.equal(process.env.HIDOOK_ISOLATED_DEPLOY, '1', 'boot requires HIDOOK_ISOLATED_DEPLOY=1');

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow2-e2e-' + system + '-'));
  process.env.SERVER_SECRET = 'flow2-e2e-' + crypto.randomBytes(12).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.VERCEL_TOKEN;
  delete process.env.NETLIFY_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;

  const evidenceDir = path.join(ROOT, '04-QA-Evidence', 'Flow2', 'e2e-real', system);
  const logPath = path.join(evidenceDir, 'oracle-log.json');
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const log = {
    oracle: 'flow2-template-e2e',
    version: 1,
    system,
    boot: {
      HIDOOK_TEST_PAY: '1',
      HIDOOK_ISOLATED_DEPLOY: '1',
      PUBLIC_URL: null,
      HIDOOK_FAKE_DEPLOY: null,
      liveStripeKeys: false,
    },
    startedAt: new Date().toISOString(),
    verified: false,
    entries: [],
  };
  const writeLog = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
  writeLog();

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let livePage = null;

  async function perform(stepName, action) {
    const index = log.entries.length;
    const spec = ORACLE_STEPS[index];
    assert.equal(spec?.name, stepName, 'driver attempted out-of-order step ' + stepName);
    const result = (await action()) || {};
    const targetPage = result.page || page;
    const screenshot = expectedScreenshotName(index, stepName);
    const screenshotPath = path.join(evidenceDir, screenshot);
    await targetPage.screenshot({ path: screenshotPath, fullPage: false });
    const entry = {
      index,
      step: spec.name,
      selector: expectedSelector(spec, system),
      action: spec.action,
      screenshot,
      screenshotSha256: sha256File(screenshotPath),
      timestamp: new Date().toISOString(),
      contentCheck: { ok: true, detail: result.detail || 'interaction completed' },
    };
    log.entries.push(entry);
    writeLog();
    console.log('STEP', String(index + 1).padStart(2, '0'), stepName, '->', screenshot);
  }

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });

    await perform('accept-cookie', async () => {
      const button = page.locator('#hb-cookie-accept');
      await button.waitFor({ state: 'visible' });
      await button.click();
      await button.waitFor({ state: 'hidden' });
      return { detail: 'builder cookie notice accepted and hidden' };
    });

    await perform('pick-template', async () => {
      const selector = expectedSelector(ORACLE_STEPS[1], system);
      await page.locator(selector).click();
      await page.waitForURL(/#edit$/);
      await page.locator('#details-drawer').waitFor({ state: 'visible' });
      assert.ok((await page.locator('#editor-template-name').textContent())?.trim(), 'selected template name must be visible');
      return { detail: system + ' selected; editor and auto-open Details visible' };
    });

    await perform('close-details-for-inline-edit', async () => {
      await page.locator('#btn-close-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'hidden' });
      return { detail: 'auto-open Details closed to expose inline preview editing' };
    });

    await perform('edit-distinctive-text', async () => {
      const input = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
      await input.click();
      await input.fill(fixture.businessName);
      await input.blur();
      await waitForEditorText(page, fixture.businessName);
      assert.equal((await input.textContent())?.trim(), fixture.businessName);
      return { detail: 'editor preview contains distinctive text: ' + fixture.businessName };
    });

    await perform('open-details-for-photo', async () => {
      await page.locator('#btn-open-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'visible' });
      return { detail: 'Details reopened for structured hero photo control' };
    });

    await perform('edit-distinctive-photo', async () => {
      const button = page.locator('[data-field-key="hero.background"] button');
      const chooserPromise = page.waitForEvent('filechooser');
      await button.click();
      const chooser = await chooserPromise;
      await chooser.setFiles(path.join(ROOT, fixture.photo));
      await page.locator('#dr_hero_background_img').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#dr_hero_background_img')?.value === 'Poză adăugată');
      return { detail: 'hero photo replaced through file chooser with ' + fixture.photo };
    });

    await perform('close-details', async () => {
      await page.locator('#btn-close-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'hidden' });
      return { detail: 'Details closed after text and photo edits' };
    });

    await perform('edit-distinctive-colors', async () => {
      await page.locator('#btn-color-picker').click();
      await page.locator('#color-custom-text').fill(fixture.color);
      await page.locator('#color-bg-text').fill(fixture.background);
      assert.equal((await page.locator('#color-custom-text').inputValue()).toUpperCase(), fixture.color.toUpperCase());
      assert.equal((await page.locator('#color-bg-text').inputValue()).toUpperCase(), fixture.background.toUpperCase());
      return { detail: 'accent ' + fixture.color + ' and background ' + fixture.background + ' applied' };
    });

    await perform('close-colors', async () => {
      await page.locator('#btn-color-picker').click();
      await page.locator('#color-popover').waitFor({ state: 'hidden' });
      return { detail: 'color controls closed after committed edits' };
    });

    await perform('preview-mobile', async () => {
      await page.locator('#btn-preview-mobile').click();
      assert.equal(await page.locator('#btn-preview-mobile').getAttribute('aria-pressed'), 'true');
      await waitForEditorText(page, fixture.businessName);
      return { detail: 'mobile preview selected and still contains distinctive text' };
    });

    await perform('open-publish', async () => {
      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      return { detail: 'publish dialog visible after preview' };
    });

    const runSlug = 'of7-' + system.replace(/[^a-z0-9]+/g, '-') + '-binding';
    await perform('continue-publish-address', async () => {
      await page.locator('#input-slug').fill(runSlug);
      await page.locator('#btn-publish-continue').click();
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });
      return { detail: 'isolated slug accepted: ' + runSlug };
    });

    await perform('send-magic-link', async () => {
      await page.locator('#input-email').fill('of7-' + system + '@example.com');
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      return { detail: 'local magic link issued for isolated test account' };
    });

    await perform('open-magic-link', async () => {
      await page.locator('#dev-link').click();
      await page.locator('#modal-success').waitFor({ state: 'visible' });
      await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
      assert.match(await page.locator('#modal-success-title').textContent(), /Adaugă un card/);
      return { detail: 'authenticated draft published unpaid; test-card CTA visible' };
    });

    await perform('test-pay-publish', async () => {
      await page.locator('#btn-pay-publish').click();
      await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
      const href = await page.locator('#success-url-link').getAttribute('href');
      assert.ok(href && href.includes('/live/' + runSlug + '/'), 'live href must contain isolated slug');
      return { detail: 'HIDOOK_TEST_PAY completed; isolated live URL: ' + href };
    });

    await perform('open-live-site', async () => {
      const opened = context.waitForEvent('page');
      await page.locator('#success-url-link').click();
      livePage = await opened;
      await livePage.waitForLoadState('networkidle');
      await livePage.getByText(fixture.businessName, { exact: false }).first().waitFor({ state: 'visible' });
      const html = await livePage.content();
      assert.ok(html.includes(fixture.businessName), 'live HTML missing distinctive text');
      assert.ok(html.toUpperCase().includes(fixture.color.toUpperCase()), 'live HTML missing distinctive accent color');
      assert.match(html, /images\/hero\.jpg/, 'live HTML missing replaced hero photo asset');
      const livePhoto = await context.request.get(new URL('images/hero.jpg', livePage.url()).href);
      assert.equal(livePhoto.status(), 200, 'uploaded live hero photo must be fetchable');
      const livePhotoDigest = crypto.createHash('sha256').update(await livePhoto.body()).digest('hex');
      assert.equal(livePhotoDigest, sha256File(path.join(ROOT, fixture.photo)), 'live hero photo bytes must match selected file');
      return { page: livePage, detail: 'live site shows distinctive text, color, and byte-identical uploaded hero photo' };
    });

    verifyEvidence({ system, entries: log.entries, evidenceDir });
    log.verified = true;
    log.completedAt = new Date().toISOString();
    log.liveUrl = livePage?.url() || null;
    writeLog();
    console.log('PASS binding Flow 2 E2E:', system);
  } catch (error) {
    log.failure = { message: error.message, timestamp: new Date().toISOString() };
    writeLog();
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  run(process.argv[2] || '').catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
