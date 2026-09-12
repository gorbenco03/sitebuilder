'use strict';
/**
 * bot/test/suite1-maxlen-and-list-max.test.js
 *
 * PLAN-QA-2026-09-12 §3 Suite 1, step S1-6 — oracle for m3 and m21:
 * schema.json already declares `maxLen` on text fields and `max` on lists,
 * but neither was enforced anywhere in the editor canvas.
 *
 *   - m3  (02-editor-core.md D6): local-service's `business.name` declares
 *     `maxLen: 60`, but typing ~500 characters into the hero h1 grew it to
 *     857px tall and covered the whole hero — no truncation, no warning.
 *   - m21 (A-09-S1): professionals' `process.steps` declares `max: 5`
 *     (starts at 3 items in the preset), but "+ Adaugă" kept adding items
 *     past that with zero feedback (the report saw 34 services added to an
 *     8-item list on a different template — same missing guard).
 *
 * Fix lives in three places (see their own doc comments):
 *   - builder/app.js's computeSchemaLimits() reads maxLen/max from schema
 *     (build.js/renderHtml never sees schema) and buildSrcdoc() passes them
 *     to renderPreview() as opts.fieldLimits / opts.listLimits.
 *   - scripts/build-builder.js's renderPreview() injects those as
 *     window.__hbFieldLimits / window.__hbListLimits inside the srcdoc.
 *   - builder/edit-overlay.js reads those globals: setupTextFields()
 *     truncates on input past maxLen (+ a discreet "N/max" counter past
 *     80%), setupListControls() disables "+ Adaugă" once a list is at max.
 *
 * Run: node --experimental-sqlite --test bot/test/suite1-maxlen-and-list-max.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'playwright'),
    '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s1-maxlen-'));
process.env.SERVER_SECRET = 's1-maxlen-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;
let browser;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function openTemplateEditor(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
    await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

test('suite1-maxlen-and-list-max: m3 — business.name (maxLen 60) is truncated at typing time', async () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'local-service', 'schema.json'), 'utf8'));
  const maxLen = (schema.sections || [])
    .flatMap((s) => s.fields || [])
    .find((f) => f.key === 'business.name').maxLen;
  assert.equal(maxLen, 60, 'sanity: schema.json must still declare business.name maxLen:60');

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'local-service');
    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();
    const visibleIndex = await iframeCtx.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-hb-edit="business.name"]'));
      return els.findIndex((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    });
    assert.ok(visibleIndex >= 0, 'no visible business.name occurrence found');

    const frame = page.frameLocator('#preview-iframe');
    const target = frame.locator('[data-hb-edit="business.name"]').nth(visibleIndex);
    await target.click();
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.press('Delete');

    const longText = 'A'.repeat(500);
    await page.keyboard.insertText(longText);
    await page.waitForTimeout(300);

    const info = await target.evaluate((el) => ({ text: el.textContent, h: el.getBoundingClientRect().height }));
    assert.equal(
      info.text.length,
      60,
      `typed 500 chars but field holds ${info.text.length} — maxLen:60 from schema.json was not enforced at typing time`
    );
    assert.ok(
      info.h < 200,
      `field is ${info.h}px tall after typing 500 chars — the m3 hero-overflow bug (857px) is still reproducible`
    );

    // Discreet counter, checked on a DIFFERENT field (business.tagline,
    // maxLen 80): business.name is special-cased in app.js's
    // onInlineTextEdit() to cascade its new value into business.about/
    // social handles and trigger a full re-render on commit (it appears
    // more than once on the page and every copy must stay in sync) — that
    // full re-render lands right around the same 300ms debounce the counter
    // itself relies on, racing this check for no reason related to the
    // counter feature. business.tagline has no such cascade.
    const tagMaxLen = schema.sections.flatMap((s) => s.fields || []).find((f) => f.key === 'business.tagline').maxLen;
    const tagVisibleIndex = await iframeCtx.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-hb-edit="business.tagline"]'));
      return els.findIndex((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    });
    assert.ok(tagVisibleIndex >= 0, 'no visible business.tagline occurrence found');
    const tagTarget = frame.locator('[data-hb-edit="business.tagline"]').nth(tagVisibleIndex);
    await tagTarget.click();
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('B'.repeat(tagMaxLen));
    await page.waitForTimeout(150);

    const counterVisible = await iframeCtx.evaluate((tagMaxLen) => {
      const c = document.querySelector('.hb-charcount');
      return !!(c && c.textContent && new RegExp('\\d+\\s*/\\s*' + tagMaxLen).test(c.textContent));
    }, tagMaxLen);
    assert.ok(counterVisible, `no discreet "N/${tagMaxLen}" character counter found near business.tagline at its limit`);
  } finally {
    await page.close();
  }
});

test('suite1-maxlen-and-list-max: m21 — process.steps (max 5) disables "+ Adaugă" at the cap', async () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'schema.json'), 'utf8'));
  const listField = (schema.sections || []).flatMap((s) => s.fields || []).find((f) => f.key === 'process.steps');
  assert.ok(listField && typeof listField.max === 'number', 'sanity: schema.json must declare process.steps max');
  const max = listField.max;

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');

    async function clickAddAndCount(listPath) {
      const iframeHandle = await page.$('#preview-iframe');
      const iframeCtx = await iframeHandle.contentFrame();
      return iframeCtx.evaluate((listPath) => {
        const all = Array.from(document.querySelectorAll('[data-hb-edit]'));
        const prefix = listPath + '.';
        let maxIdx = -1;
        all.forEach((el) => {
          const p = el.getAttribute('data-hb-edit');
          if (p === listPath || p.indexOf(prefix) === 0) {
            const rest = p.length > listPath.length ? p.slice(listPath.length + 1) : '';
            const idx = parseInt(rest.split('.')[0], 10);
            if (!Number.isNaN(idx) && idx > maxIdx) maxIdx = idx;
          }
        });
        const count = maxIdx + 1;
        let container = null;
        if (maxIdx >= 0) {
          const itemPath = listPath + '.' + maxIdx;
          const itemEls = all.filter((el) => {
            const p = el.getAttribute('data-hb-edit');
            return p === itemPath || p.indexOf(itemPath + '.') === 0;
          });
          for (const el of itemEls) {
            let cur = el;
            while (cur && cur !== document.body) {
              if (cur.classList && cur.classList.contains('hb-list-item')) { container = cur; break; }
              cur = cur.parentElement;
            }
            if (container) break;
          }
        }
        let addBtn = null;
        if (container) {
          let sib = container.nextElementSibling;
          let hops = 0;
          while (sib && hops < 5) {
            if (sib.classList && sib.classList.contains('hb-add-btn')) { addBtn = sib; break; }
            sib = sib.nextElementSibling;
            hops++;
          }
        }
        const disabled = !!(addBtn && addBtn.disabled);
        if (addBtn && !disabled) addBtn.click();
        return { count: count, disabled: disabled, addBtnFound: !!addBtn };
      }, listPath);
    }

    let state = await clickAddAndCount('process.steps');
    assert.ok(state.addBtnFound, 'process.steps has no "+ Adaugă" button to test against');
    const startCount = state.count;
    assert.ok(startCount < max, `test assumes the preset starts below max (${max}) — starts at ${startCount}`);

    // Click until (and one click past) the cap.
    for (let i = 0; i < (max - startCount) + 2; i++) {
      await page.waitForTimeout(800); // fullRerender settle
      state = await clickAddAndCount('process.steps');
    }

    assert.ok(
      state.count <= max,
      `process.steps grew to ${state.count} items past its schema max of ${max} — "+ Adaugă" was never disabled`
    );
    assert.ok(
      state.disabled,
      `process.steps is at ${state.count}/${max} items but "+ Adaugă" is not disabled`
    );
  } finally {
    await page.close();
  }
});
