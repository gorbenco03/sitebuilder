'use strict';
// Customer-visible landing contract; optional evidence is named by the action performed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const data = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'landing-demonstration-'));
Object.assign(process.env, { DATA_DIR: data, NODE_ENV: 'test', SERVER_SECRET: crypto.randomBytes(32).toString('hex'), CALENDAR_EMAIL_TRANSPORT: 'memory' });
for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) delete process.env[key];
const { startServer } = require('../server');
const packs = require('../../builder/blocks/blocks').packs();
const out = process.env.LANDING_EVIDENCE_DIR;
const report = { checks: [], screenshots: [], editorHandoffs: [], localOnly: true, dataDir: data };
if (out) fs.mkdirSync(out, { recursive: true });
function persist() { if (out) fs.writeFileSync(path.join(out, 'browser-manifest.json'), JSON.stringify(report, null, 2)); }
async function step(page, action, perform) {
  await perform();
  await page.waitForTimeout(300);
  if (out) {
    const file = action + '.png';
    await page.screenshot({ path: path.join(out, file) });
    report.screenshots.push({ action, file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(out, file))).digest('hex') });
  }
  report.checks.push({ action, passed: true }); persist();
}
async function fits(page) {
  const extent = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(extent.content <= extent.viewport + 1, JSON.stringify(extent));
}

async function visibleCatalogControl(page, selector) {
  const bounds = await page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect();
    const header = document.querySelector('.app-header').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, headerBottom: header.bottom, height: innerHeight, focused: document.activeElement === el };
  });
  assert.ok(bounds.top >= bounds.headerBottom && bounds.bottom <= bounds.height, JSON.stringify(bounds));
  assert.equal(bounds.focused, true, JSON.stringify(bounds));
  return bounds;
}

test('Landing: catalogul păstrează natural controlul vizibil la restrângere și filtrare', { timeout: 120000 }, async () => {
  let browser, server;
  const failures = [];
  try {
    server = startServer({ port: 0 });
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    for (const reducedMotion of ['reduce', 'no-preference']) for (const width of [1440, 390, 320]) for (const mode of ['keyboard', 'touch']) {
      if (width === 1440 && mode === 'touch') continue;
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion, hasTouch: width < 500, isMobile: width < 500 });
      await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      const page = await context.newPage();
      const suffix = mode + '-' + width + '-' + reducedMotion;
      try {
        await page.goto(base + '/app/');
        await page.locator('.template-card').first().waitFor();
        await page.locator('#hb-cookie-accept').click();
        async function activate(selector, key = 'Enter') {
          const control = page.locator(selector);
          // Setup may scroll BEFORE the action, never repair its natural result.
          await control.scrollIntoViewIfNeeded();
          if (mode === 'touch') await control.tap();
          else { await control.focus(); await page.keyboard.press(key); }
        }
        async function observe(action, selector, count) {
          let error;
          try {
            const bounds = await visibleCatalogControl(page, selector);
            report.checks.push({ action: action + '-immediate-bounds-' + suffix, bounds, passed: true });
            assert.equal(await page.locator('.template-card:visible').count(), count);
            assert.equal(await page.locator('.template-card[data-template-id="gol"]').isVisible(), true);
            await fits(page);
          } catch (e) { error = e; }
          // The capture is action-bound and precedes any next setup scroll.
          await step(page, action + '-' + suffix, async () => {});
          if (error) throw error;
          await visibleCatalogControl(page, selector);
        }
        await activate('#catalog-expand');
        assert.equal(await page.locator('.template-card:visible').count(), 13);
        assert.equal(await page.locator('#catalog-expand').getAttribute('aria-expanded'), 'true');
        await activate('#catalog-expand', 'Space');
        await observe('naturally-collapse-to-three', '#catalog-expand', 3);
        assert.equal(await page.locator('#catalog-expand').getAttribute('aria-expanded'), 'false');
        await activate('#catalog-expand');
        await activate('[data-filter="product-menu"]', 'Space');
        await observe('naturally-filter-expanded-catalog', '[data-filter="product-menu"]', 4);
        assert.equal(await page.locator('[data-filter="product-menu"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('#catalog-expand').getAttribute('aria-expanded'), 'false');
        await activate('[data-filter="all"]');
        await observe('naturally-return-from-filter-to-all13', '[data-filter="all"]', 13);
        await activate('#catalog-expand');
        await observe('naturally-collapse-after-filter', '#catalog-expand', 3);
      } catch (error) { failures.push({ width, mode, reducedMotion, error: error.message }); }
      finally { await context.close(); }
    }
    report.naturalContextFailures = failures; persist();
    assert.deepEqual(failures, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});

test('Landing: rescriere reală, toate 13 designuri, nume în editor, preț și acces de la tastatură', { timeout: 300000 }, async () => {
  let browser, server;
  try {
    server = startServer({ port: 0 });
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', hasTouch: width < 500, isMobile: width < 500 });
      await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await step(page, 'open-landing-with-storage-notice-' + width, async () => {
        await page.goto(base + '/app/');
        await page.locator('.template-card').first().waitFor();
        await fits(page);
        assert.equal(await page.locator('.template-card:visible').count(), 3);
        assert.equal(await page.locator('.template-card').count(), 13);
        const banner = await page.locator('#hb-cookie-banner').boundingBox();
        assert.ok(banner.height < 155, JSON.stringify(banner));
        for (const selector of ['#hb-cookie-accept', '.hb-cookie-link']) assert.ok((await page.locator(selector).boundingBox()).height >= 44);
      });
      await page.locator('#hb-cookie-accept').click();
      const config = await (await page.request.get(base + '/api/config')).json();
      await step(page, 'enter-business-name-and-show-real-preview-' + width, async () => {
        await page.locator('#hero-name').fill('Atelier Lumină');
        await page.waitForTimeout(500);
        await page.waitForFunction(() => document.querySelector('.hero-stage-card--center iframe').srcdoc.includes('Atelier Lumină'));
        assert.ok(await page.locator('#hero-price').innerText());
        report.config = config;
        assert.equal(config.trialDays, 14);
        assert.equal(config.amount, 99);
        assert.equal(config.renewal, 29);
        const money = value => config.currency === 'eur' ? value + '€' : (config.currency === 'gbp' ? '£' : '$') + value;
        assert.equal(await page.locator('#hero-price').innerText(), money(config.amount));
        assert.equal(await page.locator('#hero-renewal').innerText(), money(config.renewal));
        assert.match(await page.locator('#hero-sub').innerText(), /14 zile/);
        assert.match(await page.locator('#hero-sub').innerText(), /card/);
        assert.match(await page.locator('#hero-price').innerText(), /(?:[€£$]99|99[€£$])/);
        assert.match(await page.locator('#hero-renewal').innerText(), /(?:[€£$]29|29[€£$])/);
        await fits(page);
      });
      const beforeStorage = await page.evaluate(() => JSON.stringify(localStorage));
      await step(page, 'select-and-rewrite-demo-title-' + width, async () => {
        await page.locator('#demo-select').click();
        assert.equal(await page.locator('#demo-title-input').evaluate(el => document.activeElement === el), true);
        await page.keyboard.insertText('Frumusețe în ritmul tău');
        await page.frameLocator('#demo-preview').locator('h1').filter({ hasText: 'Frumusețe în ritmul tău' }).waitFor();
        assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), beforeStorage);
        assert.match(await page.locator('#demo-note').innerText(), /Nu îți modifică/);
        await fits(page);
        await page.locator('.demo-workspace').scrollIntoViewIfNeeded();
      });
      await step(page, 'view-rewritten-phone-result-' + width, async () => {
        await page.locator('.demo-phone').scrollIntoViewIfNeeded();
        assert.equal(await page.frameLocator('#demo-preview').locator('h1').innerText(), 'Frumusețe în ritmul tău');
        assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      });
      await step(page, 'submit-name-to-initial-catalog-' + width, async () => {
        await page.locator('#hero-cta').click();
        await page.locator('#templates-grid').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.template-card:visible').count(), 3);
      });
      await step(page, 'expand-all-13-designs-by-keyboard-' + width, async () => {
        await page.locator('#catalog-expand').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.template-card:visible').count(), 13);
        assert.equal(await page.locator('#catalog-expand').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#catalog-expand').evaluate(el => el === document.activeElement), true);
        const bounds = await visibleCatalogControl(page, '#catalog-expand');
        report.checks.push({ action: 'natural-expanded-toggle-' + width, bounds, passed: true });
        await fits(page);
      });
      await step(page, 'filter-restaurant-family-and-reveal-blank-' + width, async () => {
        await page.locator('[data-filter="product-menu"]').click();
        assert.deepEqual((await page.locator('.template-card:visible').evaluateAll(els => els.map(el => el.dataset.templateId))).sort(), ['cafenea', 'catering', 'gol', 'restaurant']);
        await page.locator('[data-filter="product-menu"]').press('Space');
        assert.equal(await page.locator('[data-filter="product-menu"]').getAttribute('aria-pressed'), 'true');
      });
      await page.locator('#catalog-expand').click();
      for (const [id, pack] of Object.entries(packs)) {
        // A fresh context for each design proves handoff without overwriting another draft.
        const editorContext = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', hasTouch: width < 500, isMobile: width < 500 });
        await editorContext.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        const editor = await editorContext.newPage();
        await editor.goto(base + '/app/');
        await editor.locator('#hb-cookie-accept').click();
        await editor.locator('#hero-name').fill('Atelier Lumină');
        await editor.locator('#catalog-expand').click();
        await step(editor, 'choose-' + id + '-and-open-correct-editor-' + width, async () => {
          const choose = editor.getByRole('button', { name: 'Începe cu designul ' + pack.label, exact: true });
          if (width < 500) await choose.tap(); else await choose.click();
          await editor.locator('#who-name').waitFor();
          assert.equal(await editor.locator('#who-name').inputValue(), 'Atelier Lumină');
          // F15 editor assembly is a separate lane: ordinary keyboard submit proves this handoff.
          await editor.locator('#who-name').press('Enter');
          await editor.locator('#who-form').waitFor({ state: 'hidden' });
          const draft = await editor.evaluate(() => JSON.parse(localStorage.getItem('hb.blocks.draft.v1')));
          assert.equal(draft.site.pack, id);
          assert.equal(draft.site.header.data.brand, 'Atelier Lumină');
          assert.equal(draft.site.pages.length, pack.pages.length);
          if (pack.blank) {
            assert.equal(draft.site.pages[0].name, 'Acasă');
            assert.deepEqual(draft.site.pages[0].blocks, []);
            const explicit = await editor.evaluate(() => {
              const b = SB.makeBlock('text', 'left', 'gol');
              return { type: b.type, title: b.data.title };
            });
            assert.equal(explicit.type, 'text');
            assert.equal(explicit.title, 'Titlul secțiunii');
          }
          report.editorHandoffs.push({ pack: id, width, brand: draft.site.header.data.brand, pages: draft.site.pages.length, keyboardOnboarding: true, extent: await editor.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })) });
        });
        if (id === 'gol') {
          await step(editor, 'rewrite-sample-with-existing-blank-draft-preserved-' + width, async () => {
            const saved = await editor.evaluate(() => localStorage.getItem('hb.blocks.draft.v1'));
            await editor.goto(base + '/app/');
            await editor.locator('#demo-select').click();
            await editor.locator('#demo-title-input').fill('Un titlu nou, doar în exemplu');
            await editor.frameLocator('#demo-preview').locator('h1').filter({ hasText: 'Un titlu nou, doar în exemplu' }).waitFor();
            assert.equal(await editor.evaluate(() => localStorage.getItem('hb.blocks.draft.v1')), saved);
          });
        }
        await editorContext.close();
      }
      await step(page, 'collapse-catalog-and-retain-keyboard-focus-' + width, async () => {
        await page.locator('#catalog-expand').focus();
        await page.keyboard.press('Space');
        assert.equal(await page.locator('.template-card:visible').count(), 3);
        assert.equal(await page.locator('#catalog-expand').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('#catalog-expand').evaluate(el => document.activeElement === el), true);
        await visibleCatalogControl(page, '#catalog-expand');
      });
      if (width < 500) await step(page, 'expand-and-collapse-all-designs-by-touch-' + width, async () => {
        await page.locator('#catalog-expand').tap();
        assert.equal(await page.locator('.template-card:visible').count(), 13);
        await page.locator('#catalog-expand').tap();
        assert.equal(await page.locator('.template-card:visible').count(), 3);
        await visibleCatalogControl(page, '#catalog-expand');
      });
      await step(page, 'open-price-without-traversing-catalog-' + width, async () => {
        await page.locator('.hero-shortcuts a[href="#pret"]').click();
        await page.waitForFunction(() => { const r = document.querySelector('#pret').getBoundingClientRect(); return r.top >= 0 && r.top < 300; });
        assert.match(await page.locator('#proof-price').innerText(), /(?:[€£$]99|99[€£$])/);
        assert.match(await page.locator('#proof-renewal').innerText(), /(?:[€£$]29|29[€£$])/);
      });
      await step(page, 'open-faq-without-traversing-catalog-' + width, async () => {
        await page.locator('.hero-shortcuts a[href="#intrebari"]').click();
        await page.locator('#intrebari').scrollIntoViewIfNeeded();
        await page.locator('.faq-item summary').nth(1).click();
        assert.equal(await page.locator('.faq-item').nth(1).getAttribute('open'), '');
        await fits(page);
      });
      await context.close();
    }
    const failureContext = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' });
    await failureContext.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await failureContext.route(/\/app\/blocks\/packs(?:-more)?\.js(?:\?.*)?$/, route => route.abort());
    const failedPage = await failureContext.newPage();
    await step(failedPage, 'open-unavailable-designs-and-honest-demo-error-390', async () => {
      await failedPage.goto(base + '/app/');
      await failedPage.locator('#hb-cookie-accept').click();
      await failedPage.locator('#btn-retry-templates').waitFor();
      await failedPage.locator('#demo-title-input').fill('Un exemplu indisponibil');
      await failedPage.waitForTimeout(250);
      assert.match(await failedPage.locator('#demo-status').innerText(), /nu este disponibil/);
      assert.equal(await failedPage.locator('#demo-preview').getAttribute('srcdoc'), null);
      await failedPage.locator('#demo-status').scrollIntoViewIfNeeded();
      await fits(failedPage);
    });
    await failureContext.unroute(/\/app\/blocks\/packs(?:-more)?\.js(?:\?.*)?$/);
    await step(failedPage, 'retry-design-loading-and-restore-real-sample-390', async () => {
      await failedPage.locator('#btn-retry-templates').click();
      await failedPage.locator('.template-card').first().waitFor();
      assert.equal(await failedPage.locator('.template-card:visible').count(), 3);
      await failedPage.frameLocator('#demo-preview').locator('h1').filter({ hasText: 'Un exemplu indisponibil' }).waitFor();
      assert.doesNotMatch(await failedPage.locator('#demo-status').innerText(), /nu este disponibil/);
      await failedPage.locator('.demo-phone').scrollIntoViewIfNeeded();
    });
    await failureContext.close();
  } catch (error) {
    report.checks.push({ passed: false, error: error.stack }); persist(); throw error;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    persist();
  }
});
