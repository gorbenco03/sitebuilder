#!/usr/bin/env node
// Independent adversarial reproduction of DSD-02:
// "Add + remove a gallery category corrupts the ORIGINAL category's photos array"
//
// Run: node run.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootServer, makeEvidence, newBrowser } from
  '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const srv = await bootServer();
const ev = makeEvidence(__dirname, 'verify-DSD-02');
const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

function log(...a) { console.log(...a); }

try {
  await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click({ timeout: 5000 }).catch(() => {});
  await ev.shot(page, 'catalog-open', { action: 'goto /app/' });

  await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(800);

  // Close details drawer if it auto-opened, to see the canvas clearly.
  await page.locator('#btn-close-drawer').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await ev.shot(page, 'editor-open', { action: 'template start desserdirina' });

  const frame = page.frameLocator('#preview-iframe');

  // --- BEFORE state: read draft.config.categories straight from the app.js global (ground truth) ---
  const before = await page.evaluate(() => {
    try {
      // draft is a top-level const in /app/app.js (classic script) -> reachable as bare identifier
      // eslint-disable-next-line no-undef
      return JSON.parse(JSON.stringify(draft.config.categories));
    } catch (e) {
      return { __error: String(e) };
    }
  });
  log('BEFORE draft.config.categories =', JSON.stringify(before));

  const beforeBlocks = await frame.locator('.category-block').count();
  const beforePhotosCat0 = await frame.locator('.category-block').nth(0).locator('.collage-photo img').count();
  const beforePhotosTotal = await frame.locator('.collage-photo img').count();
  log('BEFORE .category-block count=', beforeBlocks, 'photos in category[0]=', beforePhotosCat0, 'photos total=', beforePhotosTotal);
  await ev.shot(page, 'gallery-before', { action: 'inspect gallery before add', detail: 'blocks=' + beforeBlocks + ' photosCat0=' + beforePhotosCat0 });

  // --- ADD a gallery category via the in-canvas "+ Adaugă" control, scoped to gallery-section ---
  const addBtn = frame.locator('.gallery-section .hb-add-btn').first();
  await addBtn.scrollIntoViewIfNeeded().catch(() => {});
  const addCount = await addBtn.count();
  log('gallery .hb-add-btn count=', addCount);
  if (addCount === 0) {
    ev.defect('info', 'REFUTATION: nu exista .hb-add-btn in .gallery-section', 'addCount=0', null);
    throw new Error('cannot find gallery add button; aborting repro');
  }
  await addBtn.click();
  await page.waitForTimeout(500);

  const afterAdd = await page.evaluate(() => {
    try { return JSON.parse(JSON.stringify(draft.config.categories)); } catch (e) { return { __error: String(e) }; }
  });
  log('AFTER-ADD draft.config.categories =', JSON.stringify(afterAdd));

  const afterAddBlocks = await frame.locator('.category-block').count();
  const afterAddPhotosCat0 = await frame.locator('.category-block').nth(0).locator('.collage-photo img').count();
  const afterAddPhotosTotal = await frame.locator('.collage-photo img').count();
  log('AFTER-ADD .category-block count=', afterAddBlocks, 'photos in category[0]=', afterAddPhotosCat0, 'photos total=', afterAddPhotosTotal);
  await ev.shot(page, 'gallery-category-added', { action: 'click .gallery-section .hb-add-btn', detail: 'blocks=' + afterAddBlocks });

  // --- REMOVE the newly added category via the last "×" control, scoped to gallery-section ---
  const removeBtn = frame.locator('.gallery-section .hb-remove-btn').last();
  const removeCount = await removeBtn.count();
  log('gallery .hb-remove-btn count=', removeCount);
  if (removeCount === 0) {
    ev.defect('info', 'REFUTATION: nu exista .hb-remove-btn dupa adaugare', 'removeCount=0', null);
    throw new Error('cannot find gallery remove button; aborting repro');
  }
  await removeBtn.click();
  await page.waitForTimeout(500);

  const afterRemove = await page.evaluate(() => {
    try { return JSON.parse(JSON.stringify(draft.config.categories)); } catch (e) { return { __error: String(e) }; }
  });
  log('AFTER-REMOVE draft.config.categories =', JSON.stringify(afterRemove));

  const afterRemoveBlocks = await frame.locator('.category-block').count();
  const afterRemovePhotosCat0 = await frame.locator('.category-block').nth(0).locator('.collage-photo img').count();
  const afterRemovePhotosTotal = await frame.locator('.collage-photo img').count();
  log('AFTER-REMOVE .category-block count=', afterRemoveBlocks, 'photos in category[0]=', afterRemovePhotosCat0, 'photos total=', afterRemovePhotosTotal);
  await ev.shot(page, 'gallery-category-removed', { action: 'click .gallery-section .hb-remove-btn (last)', detail: 'blocks=' + afterRemoveBlocks + ' photosCat0=' + afterRemovePhotosCat0 });

  ev.note('before=' + JSON.stringify(before));
  ev.note('afterAdd=' + JSON.stringify(afterAdd));
  ev.note('afterRemove=' + JSON.stringify(afterRemove));
  ev.note('counts: beforeBlocks=' + beforeBlocks + ' beforePhotosCat0=' + beforePhotosCat0 +
    ' afterAddBlocks=' + afterAddBlocks + ' afterAddPhotosCat0=' + afterAddPhotosCat0 +
    ' afterRemoveBlocks=' + afterRemoveBlocks + ' afterRemovePhotosCat0=' + afterRemovePhotosCat0);

  const origPhotosLostInEditor = beforePhotosCat0 > 0 && afterRemovePhotosCat0 === 0;
  if (origPhotosLostInEditor) {
    ev.defect('critical', 'CONFIRMAT (editor): add+remove categorie goleste photos[] al categoriei originale', JSON.stringify({ before, afterAdd, afterRemove }), 'gallery-category-removed');
  } else {
    ev.note('NU s-a reprodus in editor: photosCat0 dupa remove = ' + afterRemovePhotosCat0 + ' (asteptat 0 daca bug real)');
  }

  // If corruption reproduced in-editor, proceed to publish+pay to confirm live-site impact.
  if (origPhotosLostInEditor) {
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'verify-dsd02-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-slug-continue', { action: 'fill slug + continue', detail: slug });

    await page.locator('#input-email').fill('verify-dsd02@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible', timeout: 10000 });
    await ev.shot(page, 'auth-verified-unpaid', { action: 'dev-link verify' });

    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    log('LIVE URL =', liveHref);
    await ev.shot(page, 'publish-success-live', { action: 'test-pay complete', detail: liveHref });

    const live = await b.context.newPage();
    await live.goto(new URL(liveHref, srv.base).toString(), { waitUntil: 'networkidle' });
    const liveCollageCount = await live.locator('.collage-photo img').count();
    const liveCategoryBlocks = await live.locator('.category-block').count();
    log('LIVE .category-block count=', liveCategoryBlocks, '.collage-photo img count=', liveCollageCount);
    await ev.shot(live, 'live-gallery-check', { action: 'goto live url, inspect gallery', detail: 'blocks=' + liveCategoryBlocks + ' photos=' + liveCollageCount, fullPage: true });

    if (liveCollageCount === 0) {
      ev.defect('critical', 'CONFIRMAT (live, platit): galeria e complet goala pe site-ul live dupa add+remove categorie', 'liveCollageCount=0, liveCategoryBlocks=' + liveCategoryBlocks, 'live-gallery-check');
    } else {
      ev.note('Pe live, collage photos count=' + liveCollageCount + ' (nu e zero -> impactul pe live nu s-a confirmat integral)');
    }
    await live.close();
  }

  ev.finish();
  log('DONE. Evidence dir:', ev.dir);
} catch (e) {
  console.error('SCRIPT ERROR:', e);
  ev.note('script error: ' + (e && e.stack || e));
  ev.finish();
} finally {
  await b.close();
  await srv.close();
}
