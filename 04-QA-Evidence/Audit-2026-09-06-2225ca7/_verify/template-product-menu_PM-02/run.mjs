#!/usr/bin/env node
// Verification script for finding PM-02: "+ Adaugă" on services list creates an
// unreachable empty card that survives to the live published site.
import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const EV_DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/template-product-menu_PM-02';

const srv = await bootServer();
const ev = makeEvidence(EV_DIR, 'verify-PM-02');
const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

try {
  await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
  await ev.shot(page, 'app-loaded', { action: 'goto /app/' });

  // Accept cookie banner if present
  const cookieBtn = page.locator('#hb-cookie-accept');
  if (await cookieBtn.isVisible().catch(() => false)) {
    await cookieBtn.click();
  }

  // Start product-menu template
  const startSel = '.template-card[data-template-id="product-menu"] .btn-start-tpl';
  await page.locator(startSel).waitFor({ state: 'visible', timeout: 15000 });
  await page.locator(startSel).click();
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(1500);
  await ev.shot(page, 'editor-opened-product-menu', { action: 'click .btn-start-tpl[product-menu]' });

  // The Details drawer auto-opens and its scrim (#drawer-overlay, z-index 450)
  // covers the whole viewport, blocking clicks on the canvas/iframe underneath.
  // A real user must close it first to interact with the preview.
  const closeDrawerBtn = page.locator('#btn-close-drawer');
  if (await closeDrawerBtn.isVisible().catch(() => false)) {
    await closeDrawerBtn.click();
    await page.waitForTimeout(400);
  }
  await ev.shot(page, 'drawer-closed', { action: 'click #btn-close-drawer' });

  const frame = page.frameLocator('#preview-iframe');

  // Locate the services list add button. There may be multiple .hb-add-btn
  // (services, menu sections, menu items) so scope by proximity to services list.
  const addBtns = frame.locator('.hb-add-btn');
  const addCount = await addBtns.count();
  console.log('hb-add-btn count:', addCount);

  // Find the one whose text is exactly "+ Adaugă" (services uses generic label,
  // menu ones use "+ Adaugă secțiune" / "+ Adaugă articol").
  let servicesAddBtn = null;
  for (let i = 0; i < addCount; i++) {
    const t = (await addBtns.nth(i).textContent() || '').trim();
    console.log('addBtn', i, JSON.stringify(t));
    if (t === '+ Adaugă') { servicesAddBtn = addBtns.nth(i); break; }
  }
  if (!servicesAddBtn) throw new Error('Could not find services "+ Adaugă" button');

  // Count service-card items before
  const beforeCount = await frame.locator('li.service-card, li.pm-ticket').count();
  console.log('service cards before:', beforeCount);

  await servicesAddBtn.scrollIntoViewIfNeeded();
  await ev.shot(page, 'before-click-add-specialitate', { action: 'scroll to +Adaugă (services)', selector: '.hb-add-btn' });
  await servicesAddBtn.click();
  await page.waitForTimeout(800);

  const afterCount = await frame.locator('li.service-card, li.pm-ticket').count();
  console.log('service cards after:', afterCount);
  await ev.shot(page, 'after-click-add-specialitate', { action: 'click +Adaugă (services)', detail: 'before=' + beforeCount + ' after=' + afterCount });

  if (afterCount <= beforeCount) {
    ev.note('List did not grow after clicking +Adaugă — cannot reproduce list-add at all.');
  }

  // Inspect DOM structure of the new item inside the iframe
  const frameHandle = await page.$('#preview-iframe');
  const contentFrame = await frameHandle.contentFrame();

  const inspection = await contentFrame.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-hb-edit^="services."]'));
    // group by index
    const byIdx = {};
    items.forEach(el => {
      const m = el.getAttribute('data-hb-edit').match(/^services\.(\d+)\./) || el.getAttribute('data-hb-edit').match(/^services\.(\d+)$/);
      if (!m) return;
      const idx = m[1];
      byIdx[idx] = byIdx[idx] || [];
      byIdx[idx].push(el.getAttribute('data-hb-edit'));
    });
    const maxIdx = Math.max(...Object.keys(byIdx).map(Number));
    const lastEl = document.querySelector('[data-hb-edit="services.' + maxIdx + '.label"]');
    const result = { byIdx, maxIdx, found: !!lastEl };
    if (lastEl) {
      const container = lastEl.closest('.hb-list-item');
      const li = lastEl.closest('li');
      const removeBtn = container ? container.querySelector('.hb-remove-btn') : null;
      const cRect = container ? container.getBoundingClientRect() : null;
      const liRect = li ? li.getBoundingClientRect() : null;
      const btnRect = removeBtn ? removeBtn.getBoundingClientRect() : null;
      const cs = container ? getComputedStyle(container) : null;
      result.containerTag = container ? container.tagName + '.' + container.className : null;
      result.containerRect = cRect ? { x: cRect.x, y: cRect.y, w: cRect.width, h: cRect.height } : null;
      result.containerDisplay = cs ? cs.display : null;
      result.containerPosition = cs ? cs.position : null;
      result.liTag = li ? li.tagName + '.' + li.className : null;
      result.liRect = liRect ? { x: liRect.x, y: liRect.y, w: liRect.width, h: liRect.height } : null;
      result.removeBtnFound = !!removeBtn;
      result.removeBtnRect = btnRect ? { x: btnRect.x, y: btnRect.y, w: btnRect.width, h: btnRect.height } : null;
      // Is the remove button actually the topmost element at its own center point?
      if (btnRect && btnRect.width > 0 && btnRect.height > 0) {
        const cx = btnRect.x + btnRect.width / 2;
        const cy = btnRect.y + btnRect.height / 2;
        const topEl = document.elementFromPoint(cx, cy);
        result.topElementAtBtnCenter = topEl ? (topEl.tagName + '.' + topEl.className) : null;
        result.btnIsTopElement = topEl === removeBtn;
      } else {
        result.topElementAtBtnCenter = 'N/A (btn has zero size)';
        result.btnIsTopElement = false;
      }
      // outerHTML of the li for record
      result.liOuterHTML = li ? li.outerHTML : null;
      result.labelText = lastEl.textContent;
    }
    return result;
  });

  console.log('INSPECTION:', JSON.stringify(inspection, null, 2));
  ev.note('Inspection of newly-added services item: ' + JSON.stringify(inspection));

  // Try to actually click the remove button via Playwright at its real screen position,
  // simulating what a real user would do (hover then click), without forcing.
  const lastIdx = inspection.maxIdx;
  const newLabelSel = '[data-hb-edit="services.' + lastIdx + '.label"]';
  const newLabelLoc = frame.locator(newLabelSel);
  await newLabelLoc.scrollIntoViewIfNeeded();
  await ev.shot(page, 'new-empty-card-visible', { action: 'scrollIntoView new services.' + lastIdx + '.label', detail: 'empty card at index ' + lastIdx });

  // Try hovering over the li (the visible card) — does the remove button appear?
  const liLoc = frame.locator('li.service-card, li.pm-ticket').nth(lastIdx);
  await liLoc.hover();
  await page.waitForTimeout(300);
  await ev.shot(page, 'hover-on-new-card', { action: 'hover li.service-card[' + lastIdx + ']', detail: 'checking whether remove (x) button becomes visible' });

  // Try clicking where the remove button's rect says it is, without force, using mouse click.
  let clickOutcome = 'not-attempted';
  if (inspection.removeBtnRect && inspection.removeBtnRect.w > 0 && inspection.removeBtnRect.h > 0) {
    const cx = inspection.removeBtnRect.x + inspection.removeBtnRect.w / 2;
    const cy = inspection.removeBtnRect.y + inspection.removeBtnRect.h / 2;
    try {
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(500);
      const afterRemoveClickCount = await contentFrame.evaluate(() => document.querySelectorAll('li.service-card, li.pm-ticket').length);
      clickOutcome = 'clicked at (' + cx.toFixed(1) + ',' + cy.toFixed(1) + '); cards now=' + afterRemoveClickCount;
    } catch (e) {
      clickOutcome = 'click threw: ' + e.message;
    }
  } else {
    clickOutcome = 'remove button rect is zero-size or not found — cannot click a real target';
  }
  console.log('CLICK OUTCOME:', clickOutcome);
  ev.note('Attempt to click remove button by real geometry: ' + clickOutcome);
  await ev.shot(page, 'after-attempt-remove-click', { action: 'attempt click remove-btn at reported geometry', detail: clickOutcome });

  // Try clicking the Playwright locator for hb-remove-btn scoped to this li (force:false, real click)
  const removeBtnLoc = liLoc.locator('.hb-remove-btn');
  const removeBtnCount = await removeBtnLoc.count();
  let pwClickResult = 'no .hb-remove-btn found in this li';
  if (removeBtnCount > 0) {
    try {
      await removeBtnLoc.first().click({ timeout: 3000 });
      pwClickResult = 'click succeeded (no timeout)';
    } catch (e) {
      pwClickResult = 'click FAILED/timed out: ' + e.message.split('\n')[0];
    }
  }
  console.log('PW CLICK RESULT:', pwClickResult);
  ev.note('Playwright real .click() on scoped .hb-remove-btn: ' + pwClickResult);

  const afterPwClickCount = await contentFrame.evaluate(() => document.querySelectorAll('li.service-card, li.pm-ticket').length);
  ev.note('Card count after attempted remove click: ' + afterPwClickCount + ' (was ' + afterCount + ' after add)');
  await ev.shot(page, 'card-count-after-remove-attempt', { action: 'count cards post remove-attempt', detail: 'count=' + afterPwClickCount });

  // ---- Now publish and check whether the empty card reaches the live site ----
  let liveHasEmptyCard = null;
  let liveCardCount = null;
  try {
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 10000 });
    const runSlug = 'verify-pm02-' + Date.now();
    await page.locator('#input-slug').fill(runSlug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#input-email').fill('verify-pm02@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
    const href = await page.locator('#success-url-link').getAttribute('href');
    console.log('LIVE URL:', href);
    await ev.shot(page, 'publish-success-modal', { action: 'complete test-pay publish', detail: 'href=' + href });

    const liveResp = await page.request.get(new URL(href, srv.base).toString());
    const liveHtml = await liveResp.text();
    const liveCards = (liveHtml.match(/class="service-card pm-ticket"/g) || []).length;
    const emptyLabelMatches = liveHtml.match(/<span class="pm-ticket__label"><\/span>/g) || [];
    liveCardCount = liveCards;
    liveHasEmptyCard = emptyLabelMatches.length > 0;
    console.log('LIVE service-card count:', liveCards, 'empty pm-ticket__label spans:', emptyLabelMatches.length);
    ev.note('Live page (' + href + ') service-card count=' + liveCards + ', empty-label spans=' + emptyLabelMatches.length);

    // Also open the live page visually and screenshot the specialties rail
    const livePage2 = await b.context.newPage();
    await livePage2.goto(new URL(href, srv.base).toString(), { waitUntil: 'networkidle' });
    const railLoc = livePage2.locator('#pm-menu-rail, .pm-rail').first();
    await railLoc.scrollIntoViewIfNeeded().catch(() => {});
    await livePage2.waitForTimeout(300);
    const liveShotPath = EV_DIR + '/10-live-site-specialties-rail.png';
    await livePage2.screenshot({ path: liveShotPath });
    console.log('Saved live screenshot:', liveShotPath);
    await livePage2.close();
  } catch (pubErr) {
    console.error('PUBLISH FLOW ERROR:', pubErr.message);
    ev.note('Publish flow error: ' + pubErr.message);
    await ev.shot(page, 'publish-flow-error', { action: 'publish flow', ok: false, detail: pubErr.message }).catch(() => {});
  }

  // Can the user at least type a label into the empty card afterward, as a
  // workaround for the unreachable delete button? (Run after publish so it
  // cannot contaminate the live-site-empty-card evidence above.)
  let typeWorkaround = 'not-attempted';
  try {
    const liBox = await liLoc.boundingBox();
    if (liBox) {
      await page.mouse.click(liBox.x + liBox.width / 2, liBox.y + liBox.height / 2);
      await page.waitForTimeout(200);
      await page.keyboard.type('Test label');
      await page.waitForTimeout(200);
      const labelNow = await contentFrame.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent : null;
      }, newLabelSel);
      typeWorkaround = 'after click+type, services.' + lastIdx + '.label textContent = ' + JSON.stringify(labelNow);
    } else {
      typeWorkaround = 'li boundingBox not available';
    }
  } catch (e) {
    typeWorkaround = 'threw: ' + e.message.split('\n')[0];
  }
  console.log('TYPE WORKAROUND:', typeWorkaround);
  ev.note('Attempt (post-publish) to click into LI center and type a label as a workaround: ' + typeWorkaround);
  await ev.shot(page, 'after-type-workaround-attempt', { action: 'click LI center + type "Test label"', detail: typeWorkaround });

  ev.log.result = {
    beforeCount, afterCount, afterPwClickCount,
    inspection,
    clickOutcome,
    pwClickResult,
    liveCardCount,
    liveHasEmptyCard,
    typeWorkaround,
  };
  ev.finish();
  console.log('DONE. Evidence at', EV_DIR);
} catch (err) {
  console.error('SCRIPT ERROR:', err);
  await ev.shot(page, 'error-state', { action: 'error', ok: false, detail: String(err) }).catch(() => {});
  ev.note('ERROR: ' + err.stack);
  ev.finish();
  process.exitCode = 1;
} finally {
  await b.close();
  await srv.close();
}
