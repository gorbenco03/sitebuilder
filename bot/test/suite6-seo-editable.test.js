'use strict';
/**
 * bot/test/suite6-seo-editable.test.js
 *
 * Oracle for PLAN-QA-2026-09-12 suite 6, S6-1/S6-2 (D1/D2 in
 * 04-QA-Evidence/QA-Explorare-2026-09-12/reports/04-sections-schema.md):
 *
 *   D1 — `business.title` (the browser tab title) and `business.metaDescription`
 *   (the Google search snippet) are `required: true` in every one of the 5
 *   template schemas, but had NO editable surface anywhere in the builder:
 *   not inline in the preview (a <title>/<meta> tag renders no visible text
 *   to click), and not in Detalii either — `isDrawerField()` (builder/app.js)
 *   excludes them because their type is plain text/textarea and their key
 *   matches none of DRAWER_KEYS_PARTIAL's substrings. A `seoFields` filter
 *   existed (builder/app.js, "SEO section: always add as collapsible at the
 *   bottom") but was computed and never rendered anywhere — dead code, and a
 *   dead promise in its own comment.
 *
 *   D2 — the checklist pill listed "Titlu pagină pentru browser" among the
 *   missing required fields, but clicking it did nothing: no drawer, no
 *   scroll, no focus change (goToChecklistField-shaped dead click).
 *
 * Fix under test: buildDrawer() now renders an explicit "Google și browser"
 * group for exactly these two fields (SEO_FIELD_KEYS), each with a character
 * counter and a live Google-result mock; and the checklist pill is now a
 * real control (role=button) that opens Detalii and focuses the first
 * missing field that actually has a representation there.
 *
 * This oracle drives the real builder in real Chromium (server on port 0,
 * HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1, same pattern as
 * bot/test/wave8-templates-professionals-whatsapp-hittable.test.js) across
 * ALL FIVE templates: opens Detalii, finds the "Google și browser" group,
 * types a distinctive title + description, publishes for real, and asserts
 * the published /live/<slug>/index.html has EXACTLY that <title> and
 * <meta name="description">. A second test covers the checklist pill
 * actually landing on the missing field instead of doing nothing.
 *
 * Run: node --experimental-sqlite --test bot/test/suite6-seo-editable.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  const candidates = [
    'playwright',
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

const SYSTEMS = ['local-service', 'product-menu', 'portfolio', 'professionals', 'desserdirina'];

async function bootServer(tag) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite6-seo-' + tag + '-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'suite6-seo-' + tag + '-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.NODE_ENV = 'test';
  delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.VERCEL_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;

  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });

  delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  return { server, base: 'http://127.0.0.1:' + server.address().port, tmpDir };
}

async function openTemplateEditor(page, base, system) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="' + system + '"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(700);
}

async function publishAndGetLiveUrl(page, slug, email) {
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#input-email').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  const devLink = page.locator('#dev-link');
  await devLink.waitFor({ state: 'visible', timeout: 10000 });
  await devLink.click();
  const payBtn = page.locator('#btn-pay-publish');
  await payBtn.waitFor({ state: 'visible', timeout: 15000 });
  await payBtn.click();
  const successLink = page.locator('#success-url-link');
  await successLink.waitFor({ state: 'visible', timeout: 20000 });
  return successLink.getAttribute('href');
}

test('suite6: business.title/metaDescription are editable in a visible "Google și browser" Detalii group, save, and publish exactly — all 5 templates', async () => {
  // server/browser/tmpDir are created INSIDE the try so that a throw at any
  // point (including before the browser even launches) still reaches the
  // finally below — a boot-time throw outside try/finally previously leaked
  // the HTTP server and hung the whole `node --test` process indefinitely
  // (an open server keeps Node's event loop alive forever).
  let server = null;
  let browser = null;
  let tmpDir = null;
  try {
    const booted = await bootServer('editable');
    server = booted.server;
    tmpDir = booted.tmpDir;
    const base = booted.base;
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true });

    for (const system of SYSTEMS) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(30000);

      await openTemplateEditor(page, base, system);

      // Open Detalii if not already open (fresh drafts auto-open it, but do
      // not rely on that — close/reopen explicitly for a deterministic state).
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click();
        await page.locator('#details-drawer').waitFor({ state: 'hidden' });
      }
      await page.locator('#btn-open-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'visible' });

      // The group must be visible and easy to find — not buried behind a
      // generic "Despre afacere" heading, and not the dead `seoFields` that
      // was computed and discarded before this fix.
      const seoGroup = page.locator('.drawer-section--seo');
      await seoGroup.waitFor({ state: 'visible', timeout: 10000 });
      const groupText = (await seoGroup.innerText()).toLowerCase();
      assert.match(groupText, /google/i, system + ': "Google și browser" group must be visible in Detalii');
      assert.match(groupText, /titlu pagin/i, system + ': title field label present in the group');
      assert.match(groupText, /descriere.*google/i, system + ': description field label present in the group');

      const titleInput = page.locator('[data-field-key="business.title"] input');
      const descInput = page.locator('[data-field-key="business.metaDescription"] textarea');
      await titleInput.waitFor({ state: 'visible' });
      await descInput.waitFor({ state: 'visible' });

      const distinctiveTitle = 'S6 SEO Test Title for ' + system;
      const distinctiveDesc = 'S6 SEO test description for ' + system + ', written from Detalii, under one sixty chars total.';
      assert.ok(distinctiveDesc.length <= 160, 'fixture description must respect the 160 char practical budget');

      await titleInput.fill('');
      await titleInput.fill(distinctiveTitle);
      await descInput.fill('');
      await descInput.fill(distinctiveDesc);
      // Trigger the 'input' handler's synchronous config write for a
      // textarea/input pair that may not fire it on fill() alone in every
      // Playwright/Chromium combination.
      await titleInput.dispatchEvent('input');
      await descInput.dispatchEvent('input');
      await page.waitForTimeout(150);

      // Character counters must reflect what was typed (S6-2: "contor de
      // caractere cu praguri utile").
      const titleCounter = await page.locator('[data-field-key="business.title"] .field-counter').innerText();
      const descCounter = await page.locator('[data-field-key="business.metaDescription"] .field-counter').innerText();
      assert.match(titleCounter, new RegExp('^' + distinctiveTitle.length + ' / 60'), system + ': title counter reflects length');
      assert.match(descCounter, new RegExp('^' + distinctiveDesc.length + ' / 160'), system + ': description counter reflects length');

      // The "așa arată pe Google" preview must live-update too.
      const previewTitle = await page.locator('.seo-google-preview__title').innerText();
      const previewDesc = await page.locator('.seo-google-preview__desc').innerText();
      assert.equal(previewTitle, distinctiveTitle, system + ': Google preview title mirrors the input');
      assert.equal(previewDesc, distinctiveDesc, system + ': Google preview description mirrors the input');

      await page.locator('#btn-close-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'hidden' });

      // Publish for real and check the actual exported HTML — the only
      // acceptance that matters ("ajung în <title> și <meta> la publicare").
      const slug = 's6-seo-' + system.replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
      const liveHref = await publishAndGetLiveUrl(page, slug, 's6-seo-' + system + '@example.com');
      assert.ok(liveHref && liveHref.includes('/live/' + slug + '/'), system + ': live href must contain the isolated slug');

      const liveResp = await page.request.get(new URL(liveHref, base).href);
      assert.equal(liveResp.status(), 200, system + ': live page must be fetchable');
      const html = await liveResp.text();

      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(html);
      assert.ok(titleMatch, system + ': live HTML must contain a <title> tag');
      assert.equal(titleMatch[1], distinctiveTitle, system + ': live <title> must be exactly what was typed in Detalii');

      const metaMatch = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html);
      assert.ok(metaMatch, system + ': live HTML must contain <meta name="description">');
      assert.equal(metaMatch[1], distinctiveDesc, system + ': live meta description must be exactly what was typed in Detalii');

      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('suite6: the checklist pill jumps to the missing SEO field instead of a dead click (D2)', async () => {
  // Same boot-inside-try structure as the test above — see its comment.
  let server = null;
  let browser = null;
  let tmpDir = null;
  try {
    const booted = await bootServer('checklist');
    server = booted.server;
    tmpDir = booted.tmpDir;
    const base = booted.base;
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    await openTemplateEditor(page, base, 'local-service');

    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    }
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });

    // Empty the title field so it becomes a genuinely MISSING required field.
    const titleInput = page.locator('[data-field-key="business.title"] input');
    await titleInput.waitFor({ state: 'visible' });
    await titleInput.fill('');
    await titleInput.dispatchEvent('input');
    await page.waitForTimeout(150);

    // The pill must reflect the now-incomplete state and be actionable.
    await page.locator('#checklist-indicator.checklist-warn').waitFor({ state: 'visible', timeout: 5000 });
    const ariaBefore = await page.locator('#checklist-indicator').getAttribute('aria-label');
    assert.match(ariaBefore, /completa/i, 'warn-state aria-label mentions the missing field');

    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    // The dead click, per D2: nothing should be focused inside the app
    // document and the drawer must be hidden before the click.
    assert.equal(await page.locator('#details-drawer').isVisible(), false, 'drawer closed before the checklist click');

    // The pill opens the "what's missing" menu (wave12), and the menu item is
    // what lands you on the field. This oracle was first written against a
    // base that predated that menu, and asserted the pill opened Detalii
    // directly — which would only pass by disabling the menu.
    await page.locator('#checklist-indicator').click();
    await page.locator('#checklist-menu').waitFor({ state: 'visible', timeout: 5000 });
    const seoItem = page.locator('#checklist-menu .checklist-menu-field', {
      hasText: /titlu|browser|google/i,
    }).first();
    await seoItem.waitFor({ state: 'visible', timeout: 5000 });
    await seoItem.click();
    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 5000 });

    // openDrawer() focuses inside a requestAnimationFrame after the body is
    // rebuilt, so "drawer visible" is not yet "field focused".
    await page.waitForTimeout(400);
    const focusedKey = await page.evaluate(() => {
      const el = document.activeElement;
      const wrap = el && el.closest ? el.closest('[data-field-key]') : null;
      return wrap ? wrap.getAttribute('data-field-key') : null;
    });
    assert.equal(focusedKey, 'business.title', 'checklist click opens Detalii with focus on the missing business.title field, not a dead click');

    await page.close();
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
