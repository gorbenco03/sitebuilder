import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/product-strategy';

const srv = await bootServer();
const ev = makeEvidence(DIR, 'product-strategy');
const b = await newBrowser({ width: 1440, height: 1000 });

try {
  // 1. Catalog / landing
  await b.page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
  await b.page.waitForTimeout(500);
  await ev.shot(b.page, 'catalog-landing', { action: 'goto /app/', detail: 'Prima ecran: catalog de 5 șabloane' });

  // accept cookie banner if present
  const cookieBtn = b.page.locator('#hb-cookie-accept');
  if (await cookieBtn.count()) {
    await cookieBtn.click().catch(() => {});
    await b.page.waitForTimeout(200);
  }

  await ev.shot(b.page, 'catalog-full-scroll', { action: 'scroll to see full catalog', fullPage: true });

  // 2. Start a template (professionals)
  const startBtn = b.page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl');
  await startBtn.click();
  await b.page.waitForTimeout(1200);
  await ev.shot(b.page, 'editor-with-details-drawer', { action: 'click .btn-start-tpl professionals', selector: '.template-card[data-template-id="professionals"] .btn-start-tpl', detail: 'Editor deschis, Details drawer auto-open' });

  // 3. Drawer body — scroll to see field types
  const drawerBody = b.page.locator('#drawer-body');
  if (await drawerBody.count()) {
    await ev.shot(b.page, 'drawer-fields-detail', { action: 'inspect #drawer-body', detail: 'Câmpuri disponibile pentru editare per secțiune fixă' });
  }

  // 4. Color picker
  const colorBtn = b.page.locator('#btn-color-picker');
  if (await colorBtn.count()) {
    await colorBtn.click().catch(() => {});
    await b.page.waitForTimeout(400);
    await ev.shot(b.page, 'color-picker-popover', { action: 'click #btn-color-picker', selector: '#btn-color-picker', detail: 'Popover cu presets de culoare + custom hex' });
    await b.page.keyboard.press('Escape').catch(() => {});
  }

  // 5. Try clicking directly inside iframe to see inline edit affordance
  const iframeEl = b.page.locator('#preview-iframe');
  await ev.shot(b.page, 'preview-iframe-inline-edit-surface', { action: 'inspect #preview-iframe', detail: 'Suprafața de inline-edit (text/imagini) în iframe' });

  // 6. Mobile preview toggle
  const mobileBtn = b.page.locator('#btn-preview-mobile');
  if (await mobileBtn.count()) {
    await mobileBtn.click().catch(() => {});
    await b.page.waitForTimeout(500);
    await ev.shot(b.page, 'preview-mobile-toggle', { action: 'click #btn-preview-mobile', selector: '#btn-preview-mobile', detail: 'Toggle mobil/desktop pentru preview' });
    const desktopBtn = b.page.locator('#btn-preview-desktop');
    if (await desktopBtn.count()) await desktopBtn.click().catch(() => {});
  }

  // 7. Try to add a list item (services) to see the "empty tab" issue class mentioned in OWNER-FEEDBACK item 6
  const addBtns = b.page.locator('button:has-text("Adaugă")');
  const addCount = await addBtns.count();
  if (addCount > 0) {
    await addBtns.first().click().catch(() => {});
    await b.page.waitForTimeout(400);
    await ev.shot(b.page, 'list-add-item-result', { action: 'click primul buton "Adaugă" din drawer', detail: 'Verificare regressie item 6 owner-feedback (tab gol la add)' });
  }

  // 8. Publish modal
  const publishBtn = b.page.locator('#btn-publish');
  if (await publishBtn.count()) {
    await publishBtn.click().catch(() => {});
    await b.page.waitForTimeout(600);
    await ev.shot(b.page, 'publish-modal-slug', { action: 'click #btn-publish', selector: '#btn-publish', detail: 'Modal publish: alegere slug' });
  }

  ev.note('Verificat manual: nicio funcție de add/remove/reorder SECȚIUNI (doar add/remove ITEMI în liste ca services/menu). Nicio funcție undo/redo găsită în builder/app.js. Niciun control de tipografie/font. Fără suport multipage.');
  ev.note('injectDataHb() în builder/app.js (linia ~680) confirmă edit mapping fragil prin regex text-match pe HTML randat — exact ce descrie VISION §4.6.');

} catch (e) {
  ev.note('Eroare în timpul rulării: ' + e.message);
  await ev.shot(b.page, 'error-state', { action: 'exception', detail: String(e.message) }).catch(() => {});
} finally {
  ev.finish();
  await b.close();
  await srv.close();
}

console.log('DONE', DIR);
