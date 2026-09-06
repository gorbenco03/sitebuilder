#!/usr/bin/env node
// Full E2E walk for the "professionals" template — stranger audit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bootServer, makeEvidence, newBrowser, ROOT, chromium } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const execFileP = promisify(execFile);
const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/template-professionals';
const ev = makeEvidence(DIR, 'template-professionals');

const BUSINESS_NAME = 'Șt. Țăndărică & Fiii';
const ACCENT = '#1D5B79';
const BG = '#E7F1F7';
const PHOTO = path.join(ROOT, 'templates/product-menu/images/cn-hero.jpg');
const WA_NUMBER = '40745123456';
const WA_MESSAGE = 'Bună ziua! Aș dori să programez o consultație și să întreb despre disponibilitate.';

function timeIt() { const t0 = Date.now(); return () => Date.now() - t0; }

async function main() {
  const srv = await bootServer();
  ev.note('Server izolat pornit la ' + srv.base + ' (DATA_DIR=' + srv.dataDir + ')');
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;

  // 1. Landing -> cookie -> template pick, measure iframe readiness
  await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click();
  await page.locator('#hb-cookie-accept').waitFor({ state: 'hidden' });
  await ev.shot(page, 'landing-cookie-accepted', { action: 'click #hb-cookie-accept', detail: 'cookie banner acceptat' });

  const stopClock = timeIt();
  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  const previewFrame = page.frameLocator('#preview-iframe');
  await previewFrame.locator('body').waitFor({ state: 'attached', timeout: 20000 });
  {
    const deadline = Date.now() + 20000;
    let len = 0;
    while (Date.now() < deadline) {
      len = await previewFrame.locator('body').innerText().then(t => t.trim().length).catch(() => 0);
      if (len > 20) break;
      await page.waitForTimeout(150);
    }
  }
  const iframeMs = stopClock();
  await page.locator('#details-drawer').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await ev.shot(page, 'editor-open-drawer-auto', { action: 'select professionals template', detail: 'iframe cu continut gata in ' + iframeMs + 'ms; Details drawer deschis automat' });
  ev.note('Timp pana la continut iframe: ' + iframeMs + 'ms');
  if (iframeMs > 4000) ev.defect('medium', 'Timp de incarcare iframe editor lent', 'A durat ' + iframeMs + 'ms pana iframe-ul preview a avut continut vizibil (>4s ar putea simti lent pentru un client).', '02-editor-open-drawer-auto.png');

  // 2. Inventory ALL drawer fields
  const fieldsInfo = await page.evaluate(() => {
    const body = document.getElementById('drawer-body');
    if (!body) return [];
    const out = [];
    const groups = body.querySelectorAll('.field-group, fieldset, [data-field-key]');
    const seen = new Set();
    body.querySelectorAll('[data-field-key]').forEach(el => {
      const key = el.getAttribute('data-field-key');
      if (seen.has(key)) return;
      seen.add(key);
      const label = el.querySelector('label, .field-label')?.textContent?.trim() || '';
      const input = el.querySelector('input, textarea, select');
      const type = input ? input.tagName.toLowerCase() + (input.type ? ':' + input.type : '') : (el.querySelector('button') ? 'button/custom' : 'unknown');
      let value = '';
      if (input && 'value' in input) value = input.value;
      out.push({ key, label, type, value: String(value).slice(0, 120) });
    });
    return out;
  });
  fs.writeFileSync(path.join(DIR, 'drawer-fields-inventory.json'), JSON.stringify(fieldsInfo, null, 2));
  await ev.shot(page, 'drawer-fields-full', { fullPage: true, action: 'inventory #drawer-body', detail: fieldsInfo.length + ' campuri gasite cu data-field-key' });

  // Check RO diacritics / jargon in labels
  const nonRoOrJargon = fieldsInfo.filter(f => /^[a-zA-Z0-9 ,.'"()/-]*$/.test(f.label) && /[a-z]{4,}/i.test(f.label) && !/[ăâîșțĂÂÎȘȚ]/.test(f.label) && f.label.length > 0)
    .filter(f => !/^(URL|QR|SEO|CTA|Instagram|Facebook|WhatsApp|Cal\.com|Google)/i.test(f.label));
  ev.note('Campuri fara diacritice RO (posibil ok pt cuvinte scurte/engleza tehnica): ' + JSON.stringify(nonRoOrJargon.map(f => f.key)));

  // 3. Inline text edit (must close drawer first — overlay intercepts pointer events on iframe)
  await page.locator('#btn-close-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'hidden' });
  const nameInput = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
  await nameInput.click();
  await nameInput.fill(BUSINESS_NAME);
  await nameInput.blur();
  await page.waitForTimeout(400);
  await ev.shot(page, 'inline-edit-business-name', { action: 'click+fill+blur [data-hb-edit="business.name"]', detail: 'nume introdus: ' + BUSINESS_NAME });
  const iframeNameText = await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first().textContent();
  assert.ok(iframeNameText && iframeNameText.trim() === BUSINESS_NAME, 'iframe business.name nu s-a actualizat corect: ' + iframeNameText);
  ev.note('Nota design: business.name NU are camp in Details drawer (drawer contine doar campuri structurate: telefon/URL/culoare/fundal/WhatsApp/limba); tot continutul text (nume, tagline, servicii, FAQ, etc. — 93 noduri [data-hb-edit] gasite) se editeaza inline direct in iframe, cu butoane "+ Adaugă" inline pt liste. Pattern valid (similar Squarespace inline-edit), dar merita verificat daca e suficient de descoperibil pentru un client nefamiliarizat (vezi sectiunea critica de design).');

  // 4. Photo edit via drawer hero.background
  await page.locator('#btn-open-drawer').click().catch(() => {});
  await page.locator('#details-drawer').waitFor({ state: 'visible' });
  const beforeBg = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => {
    const hero = document.querySelector('.pr-hero__bg') || document.querySelector('[class*="hero__bg"]') || document.querySelector('[class*=hero]');
    return hero ? getComputedStyle(hero).background : null;
  });
  const photoBtn = page.locator('[data-field-key="hero.background"] button').first();
  const chooserPromise = page.waitForEvent('filechooser');
  await photoBtn.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(PHOTO);
  await page.waitForFunction(() => document.querySelector('#dr_hero_background_img')?.value === 'Poză adăugată', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await ev.shot(page, 'drawer-photo-uploaded', { action: 'setInputFiles hero.background', detail: 'poza incarcata: ' + path.basename(PHOTO) });
  const afterBg = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => {
    const hero = document.querySelector('.pr-hero__bg') || document.querySelector('[class*="hero__bg"]') || document.querySelector('[class*=hero]');
    return hero ? getComputedStyle(hero).background : null;
  });
  if (afterBg === beforeBg || !afterBg || !/url\(/.test(afterBg)) ev.defect('high', 'Fundalul hero nu s-a schimbat vizual dupa upload poza', 'computed background inainte: ' + beforeBg + ' dupa: ' + afterBg, '05-drawer-photo-uploaded.png');
  else ev.note('Hero background dupa upload: ' + afterBg.slice(0, 120) + '...');

  // 5. Colors
  await page.locator('#btn-close-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'hidden' });
  await ev.shot(page, 'before-color-change', { action: 'close drawer', detail: 'inainte de schimbare culori' });
  await page.locator('#btn-color-picker').click();
  await page.locator('#color-popover').waitFor({ state: 'visible' });
  await page.locator('#color-custom-text').fill(ACCENT);
  await page.locator('#color-bg-text').fill(BG);
  await page.waitForTimeout(400);
  await ev.shot(page, 'color-popover-filled', { action: 'fill #color-custom-text/#color-bg-text', detail: 'accent=' + ACCENT + ' bg=' + BG });
  await page.locator('#btn-color-picker').click();
  await page.locator('#color-popover').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  await ev.shot(page, 'after-color-change', { action: 'close color popover', detail: 'culori aplicate' });
  const pixelCheck = await page.frameLocator('#preview-iframe').locator('body').evaluate((bodyEl, accent) => {
    function toRgb(hex) { const n = parseInt(hex.slice(1), 16); return `rgb(${(n>>16)&255}, ${(n>>8)&255}, ${n&255})`; }
    const cta = document.querySelector('.pr-btn--primary');
    const ctaStyle = cta ? getComputedStyle(cta) : null;
    return {
      ctaBg: ctaStyle ? ctaStyle.backgroundColor : null,
      ctaBorder: ctaStyle ? ctaStyle.borderColor : null,
      expectRgb: toRgb(accent),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  }, ACCENT);
  fs.writeFileSync(path.join(DIR, 'pixel-color-check.json'), JSON.stringify(pixelCheck, null, 2));
  const accentApplied = pixelCheck.ctaBg === pixelCheck.expectRgb || pixelCheck.ctaBorder === pixelCheck.expectRgb;
  if (!accentApplied) ev.defect('high', 'Culoarea accent aleasa nu se reflecta pe CTA', 'Asteptat ' + pixelCheck.expectRgb + ', gasit ctaBg=' + pixelCheck.ctaBg + ' ctaBorder=' + pixelCheck.ctaBorder, '08-after-color-change.png');
  else ev.note('Culoare accent confirmata pe CTA: ' + pixelCheck.ctaBg);

  // 6. WhatsApp: fill number + message, verify badge href, open QR panel
  await page.locator('#btn-open-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'visible' });
  const waFieldsExist = await page.evaluate(() => !!document.querySelector('[data-field-key="contact.whatsapp"] input'));
  if (waFieldsExist) {
    const waInput = page.locator('[data-field-key="contact.whatsapp"] input').first();
    await waInput.fill(WA_NUMBER);
    await waInput.blur();
    const waMsgInput = page.locator('[data-field-key="contact.waMessage"] textarea, [data-field-key="contact.waMessage"] input').first();
    if (await waMsgInput.count()) { await waMsgInput.fill(WA_MESSAGE); await waMsgInput.blur(); }
    await page.waitForTimeout(500);
  } else {
    ev.note('Camp contact.whatsapp negasit direct in drawer prin data-field-key (poate fi in alta sectiune) — verificat manual: ' + JSON.stringify(fieldsInfo.filter(f => /whatsapp|waMessage/i.test(f.key))));
  }
  await ev.shot(page, 'whatsapp-fields-filled', { action: 'fill contact.whatsapp + contact.waMessage', detail: 'numar=' + WA_NUMBER + ' mesaj cu diacritice' });
  const waHrefInIframe = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => {
    const a = document.querySelector('a[href*="wa.me"]');
    return a ? a.getAttribute('href') : null;
  });
  fs.writeFileSync(path.join(DIR, 'wa-href.txt'), String(waHrefInIframe));
  if (!waHrefInIframe || !waHrefInIframe.includes(WA_NUMBER)) {
    ev.defect('high', 'Badge WhatsApp din iframe nu contine numarul introdus', 'href gasit: ' + waHrefInIframe, '10-whatsapp-fields-filled.png');
  } else {
    const decoded = decodeURIComponent(waHrefInIframe.split('text=')[1] || '');
    if (!decoded.includes('programez') && !decoded.includes('ă')) {
      ev.defect('medium', 'Mesajul WhatsApp precompletat pare sa piarda diacriticele sau textul', 'decoded: ' + decoded, '10-whatsapp-fields-filled.png');
    } else ev.note('wa.me href decodat OK cu diacritice: ' + decoded.slice(0, 80));
  }
  await page.locator('#btn-close-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'hidden' });
  ev.note('Panoul QR WhatsApp (wa-qr) traieste in template.html/script.js pe site-ul LIVE (desktop), nu in builder — #btn-share-wa din builder e alt buton ("Trimite pe WhatsApp" din modalul de succes, share al linkului site-ului). Verificarea panoului QR e mutata la pasul site live.');

  // 7. Mobile preview
  await page.locator('#btn-preview-mobile').click();
  await page.waitForTimeout(500);
  await ev.shot(page, 'mobile-preview-390', { action: 'click #btn-preview-mobile', detail: 'previzualizare mobil in editor' });
  const mobileOverflow = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  fs.writeFileSync(path.join(DIR, 'mobile-overflow-check.json'), JSON.stringify(mobileOverflow, null, 2));
  if (mobileOverflow.scrollWidth > mobileOverflow.clientWidth + 2) {
    ev.defect('high', 'Overflow orizontal in preview mobil al editorului', 'scrollWidth=' + mobileOverflow.scrollWidth + ' clientWidth=' + mobileOverflow.clientWidth, '12-mobile-preview-390.png');
  } else ev.note('Fara overflow orizontal detectat in preview mobil editor.');

  // back to desktop preview for the rest
  await page.locator('#btn-preview-desktop').click().catch(() => {});
  await page.waitForTimeout(300);

  // 8. Add + remove a repeatable item (services list) — repeatable lists are edited INLINE
  // in the iframe (ul.pr-svc > li, with a trailing button.hb-add-btn), not in the drawer.
  const svcFrame = page.frameLocator('#preview-iframe');
  const svcList = svcFrame.locator('.pr-svc');
  const addServiceBtn = svcFrame.locator('.pr-svc .hb-add-btn').first();
  let addedOk = false;
  const beforeCount = await svcList.locator('> li').count();
  if (await addServiceBtn.count()) {
    await addServiceBtn.scrollIntoViewIfNeeded();
    await addServiceBtn.click();
    await page.waitForTimeout(500);
    const afterCount = await svcList.locator('> li').count();
    addedOk = afterCount > beforeCount;
    await ev.shot(page, 'service-item-added', { action: 'click .hb-add-btn dupa lista de servicii (inline in iframe)', detail: 'inainte=' + beforeCount + ' dupa=' + afterCount });
    if (!addedOk) ev.defect('high', 'Butonul "+ Adaugă" nu adauga un element nou in lista de servicii', 'inainte=' + beforeCount + ' dupa=' + afterCount, '13-service-item-added.png');
    const lastItem = svcList.locator('> li').last();
    const lastItemHtml = await lastItem.evaluate(el => el.outerHTML);
    fs.writeFileSync(path.join(DIR, 'new-service-item.html'), lastItemHtml);
    const lastItemLabelText = await lastItem.locator('[data-hb-edit$=".label"]').first().evaluate(el => el.textContent?.trim()).catch(() => null);
    if (!lastItemLabelText || lastItemLabelText.length < 1) ev.defect('high', 'Elementul de serviciu nou adaugat e complet gol (fara text default RO in titlu)', 'span data-hb-edit al noului serviciu are text gol: "' + lastItemLabelText + '" — clientul vede un card gol pana scrie el insusi ceva, spre deosebire de un placeholder gen "Serviciu nou"', '13-service-item-added.png');
    else ev.note('Text default al noului serviciu: "' + lastItemLabelText + '"');
    const addBtnEndedUpNested = /class="hb-add-btn"/.test(lastItemHtml);
    if (addBtnEndedUpNested) ev.defect('high', 'Dupa "+ Adaugă", butonul de adaugare ajunge grefat/nested GRESIT in interiorul noului <li>, nu ca frate dupa <ul>', 'outerHTML noul <li>: ' + lastItemHtml.slice(0, 400) + ' — structura DOM se degradeaza progresiv la adaugari repetate.', '13-service-item-added.png');
    // remove it — dispatch a real DOM click on the button matching this item's own data-hb-edit index
    // (querySelectorAll order was found unreliable across nested hb-list-item markers during manual repro).
    const svcIndex = await lastItem.locator('[data-hb-edit$=".label"]').first().getAttribute('data-hb-edit').then(k => k?.match(/services\.(\d+)\.label/)?.[1]).catch(() => null);
    const removeResult = await svcFrame.locator('body').evaluate((body, idx) => {
      const span = body.querySelector('[data-hb-edit="services.' + idx + '.label"]');
      const li = span ? span.closest('li') : null;
      const btn = li ? li.querySelector('.hb-remove-btn') : null;
      if (!btn) return 'NO_BUTTON_FOUND_FOR_INDEX_' + idx;
      btn.click();
      return 'CLICKED_OK';
    }, svcIndex);
    await page.waitForTimeout(500);
    const finalCount = await svcList.locator('> li').count();
    await ev.shot(page, 'service-item-removed', { action: 'JS click pe .hb-remove-btn al elementului services.' + svcIndex, detail: removeResult + ' | count dupa stergere=' + finalCount + ' (inainte de adaugare=' + beforeCount + ')' });
    if (finalCount !== beforeCount) ev.defect('high', 'Stergerea elementului de serviciu nou adaugat NU functioneaza — numarul de servicii nu revine la valoarea initiala', 'inainte=' + beforeCount + ' dupa adaugare=' + afterCount + ' dupa click stergere=' + finalCount + ' (rezultat click: ' + removeResult + ')', '14-service-item-removed.png');
    else ev.note('Stergere confirmata: count a revenit la ' + finalCount);
  } else {
    ev.defect('high', 'Butonul inline "+ Adaugă" pentru servicii negasit langa lista .pr-svc', '', null);
    await ev.shot(page, 'services-field-inspect', { fullPage: true, action: 'inspect inline services add control', detail: 'nu s-a gasit .hb-add-btn dupa .pr-svc' });
  }

  // 9. Publish flow
  await page.locator('#btn-close-drawer').click().catch(() => {});
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await ev.shot(page, 'publish-modal-open', { action: 'click #btn-publish', detail: 'dialog publish deschis' });
  const runSlug = 'qa-professionals-audit-' + Date.now();
  await page.locator('#input-slug').fill(runSlug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await ev.shot(page, 'publish-slug-set', { action: 'fill #input-slug + click continue', detail: 'slug=' + runSlug });
  await page.locator('#input-email').fill('qa-professionals@example.com');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await ev.shot(page, 'magic-link-issued', { action: 'fill email + send magic link', detail: 'dev-link vizibil' });
  await page.locator('#dev-link').click();
  await page.locator('#modal-success').waitFor({ state: 'visible' });
  await ev.shot(page, 'unpaid-success-modal', { action: 'click #dev-link', detail: 'draft publicat nefiscalizat; CTA plata vizibil' });
  await page.locator('#btn-pay-publish').click();
  await page.locator('#modal-success-title').filter({ hasText: 'live' }).waitFor({ state: 'visible', timeout: 20000 });
  await ev.shot(page, 'publish-success-paid', { action: 'click #btn-pay-publish', detail: 'Site-ul tau e live' });
  const successTitle = await page.locator('#modal-success-title').textContent();
  const successBodyText = await page.locator('.modal-content, #modal-success').first().evaluate(el => el.innerText);
  fs.writeFileSync(path.join(DIR, 'success-modal-text.txt'), successBodyText);
  if (!/99|29/.test(successBodyText)) ev.note('Textul modalului succes nu mentioneaza explicit pretul 99/29 (poate fi normal daca nu e cazul aici).');
  const liveHref = await page.locator('#success-url-link').getAttribute('href');
  ev.note('Live URL: ' + liveHref);

  // 11. Open live site (new tab) while success modal is still open, THEN close modal to use topbar export buttons
  const opened = b.context.waitForEvent('page');
  await page.locator('#success-url-link').click();
  const livePage = await opened;
  await livePage.waitForLoadState('networkidle');

  await page.locator('#btn-success-close').click().catch(() => {});
  await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {});

  // 10. Export HTML + ZIP
  const [downloadHtml] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-download-html').click(),
  ]);
  const htmlPath = path.join(DIR, 'export-' + runSlug + '.html');
  await downloadHtml.saveAs(htmlPath);
  await ev.shot(page, 'export-html-downloaded', { action: 'click #btn-download-html', detail: 'salvat: ' + path.basename(htmlPath) });

  const [downloadZip] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-download-zip').click(),
  ]);
  const zipPath = path.join(DIR, 'export-' + runSlug + '.zip');
  await downloadZip.saveAs(zipPath);
  await ev.shot(page, 'export-zip-downloaded', { action: 'click #btn-download-zip', detail: 'salvat: ' + path.basename(zipPath) });
  await livePage.setViewportSize({ width: 1440, height: 1000 });
  await ev.shot(livePage, 'live-site-desktop', { action: 'open #success-url-link (desktop)', detail: 'site live la 1440px' });
  await ev.shot(livePage, 'live-site-desktop-fullpage', { fullPage: true, action: 'fullPage screenshot live desktop', detail: 'site live complet 1440px' });

  // WhatsApp QR panel (desktop, live site): clicking any wa.me link opens a QR modal instead of navigating away.
  const waLink = livePage.locator('a[href*="wa.me"]').first();
  if (await waLink.count()) {
    await waLink.scrollIntoViewIfNeeded();
    await waLink.click();
    await livePage.waitForTimeout(500);
    await ev.shot(livePage, 'whatsapp-qr-panel-live', { action: 'click a[href*=wa.me] pe site live desktop', detail: 'panou QR WhatsApp (#wa-qr) ar trebui sa apara in loc de navigare' });
    const qrVisible = await livePage.locator('#wa-qr').isVisible().catch(() => false);
    const qrImgSrc = await livePage.locator('#wa-qr-img').getAttribute('src').catch(() => null);
    if (!qrVisible) ev.defect('high', 'Panoul QR WhatsApp nu apare la click pe link wa.me in desktop live', 'a[href*=wa.me] click nu a deschis #wa-qr', 'whatsapp-qr-panel-live.png');
    else if (!qrImgSrc || !qrImgSrc.startsWith('data:image/svg')) ev.defect('medium', 'Imaginea QR nu s-a generat (src lipsa/gol)', 'src=' + qrImgSrc, 'whatsapp-qr-panel-live.png');
    else ev.note('Panou QR WhatsApp OK pe desktop live, qr img src generat.');
    await livePage.locator('[data-wa-close]').first().click().catch(() => {});
    await livePage.waitForTimeout(300);
  } else {
    ev.defect('high', 'Niciun link wa.me gasit pe site-ul live (WhatsApp nu apare deloc)', '', 'live-site-desktop-fullpage.png');
  }

  const bodyText = await livePage.evaluate(() => document.body.innerText);
  const htmlContent = await livePage.content();
  fs.writeFileSync(path.join(DIR, 'live-page-content.html'), htmlContent);
  const checks = {
    hasBusinessName: bodyText.includes(BUSINESS_NAME),
    hasAttribution: /hidook\.tech|hidook\.agency/i.test(htmlContent),
    langAttr: await livePage.evaluate(() => document.documentElement.lang),
    ogImage: await livePage.evaluate(() => document.querySelector('meta[property="og:image"]')?.content || null),
    jsonLd: await livePage.evaluate(() => Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent)),
    factorySmells: (() => {
      const smells = [];
      ['Lorem ipsum', 'TODO', 'undefined', '[object Object]', 'DESSERD', 'Desserdirina'].forEach(s => { if (htmlContent.includes(s)) smells.push(s); });
      return smells;
    })(),
  };
  fs.writeFileSync(path.join(DIR, 'live-page-checks.json'), JSON.stringify(checks, null, 2));
  if (!checks.hasBusinessName) ev.defect('critical', 'Numele de afacere editat nu apare pe site-ul live', 'BUSINESS_NAME=' + BUSINESS_NAME + ' negasit in body text al site-ului live', '17-live-site-desktop.png');
  if (!checks.hasAttribution) ev.defect('medium', 'Atribuirea hidook lipseste din footer pe site-ul live', 'nu s-a gasit text hidook.tech / hidook.agency in HTML', '17-live-site-desktop.png');
  if (checks.langAttr !== 'ro') ev.defect('low', 'lang atribut HTML nu este "ro"', 'gasit: ' + checks.langAttr, '17-live-site-desktop.png');
  if (checks.factorySmells.length) ev.defect('high', 'Texte "factory" gasite pe site-ul live', JSON.stringify(checks.factorySmells), '17-live-site-desktop.png');
  if (!checks.jsonLd.length) ev.defect('medium', 'Lipseste JSON-LD structured data (LocalBusiness) pe pagina live', 'template.html are bloc <!-- @if seo.jsonLd --> dar seo.jsonLd e gol la publish prin builder-ul web (bot/flow.js buildSeo() populeaza jsonLd doar in fluxul Telegram, build.js/normalizeConfigForRender nu calculeaza seo.jsonLd deloc — doar seo.ogImage via deriveSocialImage). Deja notat ca gol cunoscut in VISION.md §4.6 ("SEO insuficient expus").', '17-live-site-desktop.png');
  ev.note('JSON-LD gasit: ' + checks.jsonLd.length + ' bloc(uri)');
  ev.note('og:image (raw meta content): ' + checks.ogImage);
  const canonicalTag = await livePage.evaluate(() => document.querySelector('link[rel="canonical"]')?.href || null);
  const ogUrlTag = await livePage.evaluate(() => document.querySelector('meta[property="og:url"]')?.content || null);
  ev.note('canonical link: ' + canonicalTag + ' | og:url: ' + ogUrlTag);
  if (!canonicalTag && !ogUrlTag) ev.defect('medium', 'Lipsesc complet <link rel=canonical> si <meta property=og:url> pe orice site publicat', 'seo.canonical apare doar ca token in build.js linia ~109 dar nu e populat NICAIERI in cod (grep confirmat) — blocul <!-- @if seo.canonical --> e mereu fals, deci ambele tag-uri lipsesc din <head> pe toate site-urile publicate prin builder-ul web, nu doar professionals.', '17-live-site-desktop.png');

  if (checks.ogImage) {
    const isAbsolute = /^https?:\/\//i.test(checks.ogImage);
    if (!isAbsolute) {
      ev.defect('medium', 'og:image / twitter:image sunt cai RELATIVE, nu absolute (incalca spec Open Graph)', 'continut meta: "' + checks.ogImage + '" — Open Graph/Twitter Card cer URL absolut; Facebook/WhatsApp/LinkedIn/iMessage de regula NU rezolva un og:image relativ, deci preview-ul de share ar putea sa nu arate poza. Cauza: build.js deriveSocialImage() intoarce orice string brut gasit in config care se potriveste /image|photo|logo|src/i, fara sa-l rezolve fata de PUBLIC_URL.', '17-live-site-desktop.png');
    }
    const absoluteOgImage = isAbsolute ? checks.ogImage : new URL(checks.ogImage, livePage.url()).href;
    const ogResp = await b.context.request.get(absoluteOgImage).catch(e => ({ status: () => 'ERR:' + e.message }));
    const status = typeof ogResp.status === 'function' ? ogResp.status() : ogResp.status;
    ev.note('og:image (rezolvat absolut ' + absoluteOgImage + ') status: ' + status);
    if (status !== 200) ev.defect('high', 'Fisierul din spatele og:image nu raspunde 200 nici macar rezolvat absolut', 'status=' + status + ' url=' + absoluteOgImage, '17-live-site-desktop.png');
  } else {
    ev.defect('high', 'og:image complet gol pe site-ul live', '', '17-live-site-desktop.png');
  }

  // check all images loaded
  const imgCheck = await livePage.evaluate(() => Array.from(document.querySelectorAll('img')).map(img => ({ src: img.currentSrc || img.src, naturalWidth: img.naturalWidth })));
  const brokenImgs = imgCheck.filter(i => i.naturalWidth === 0);
  fs.writeFileSync(path.join(DIR, 'live-images-check.json'), JSON.stringify(imgCheck, null, 2));
  if (brokenImgs.length) ev.defect('high', 'Imagini rupte (naturalWidth=0) pe site-ul live', JSON.stringify(brokenImgs), '17-live-site-desktop.png');

  // check console errors / failed requests up to now
  // /api/me 401 before login is expected (auth probe) — filter that specific benign case out.
  const realConsoleErrors = b.consoleErrors.filter(e => !/\/api\/me/.test(e.url) && !/401 \(Unauthorized\)/.test(e.text));
  const realFailedRequests = b.failedRequests.filter(r => !(r.status === 401 && /\/api\/me$/.test(r.url)));
  ev.note('Erori console filtrate (doar /api/me 401 pre-login, asteptat): ' + (b.consoleErrors.length - realConsoleErrors.length));
  if (realConsoleErrors.length) ev.defect('medium', 'Erori console neasteptate pe parcursul fluxului', JSON.stringify(realConsoleErrors.slice(0, 10)), null);
  else ev.note('Fara erori console neasteptate (in afara de /api/me 401 pre-login, care e normal).');
  if (realFailedRequests.length) ev.defect('medium', 'Request-uri 4xx/5xx neasteptate pe parcursul fluxului', JSON.stringify(realFailedRequests.slice(0, 10)), null);
  else ev.note('Fara request-uri 4xx/5xx neasteptate (in afara de /api/me 401 pre-login).');

  // legal footer links
  const legalLinks = await livePage.evaluate(() => Array.from(document.querySelectorAll('a')).filter(a => /privacy|cookie|terms|confiden|termeni/i.test(a.textContent + a.href)).map(a => ({ text: a.textContent.trim(), href: a.href })));
  fs.writeFileSync(path.join(DIR, 'live-legal-links.json'), JSON.stringify(legalLinks, null, 2));
  for (const l of legalLinks) {
    const r = await b.context.request.get(l.href).catch(e => null);
    const st = r ? r.status() : 'ERR';
    ev.note('Link legal "' + l.text + '" -> ' + l.href + ' status=' + st);
    if (st !== 200) ev.defect('high', 'Link legal nu raspunde 200', l.text + ' -> ' + l.href + ' status=' + st, null);
  }

  // mobile live
  await livePage.setViewportSize({ width: 390, height: 844 });
  await livePage.reload({ waitUntil: 'networkidle' });
  await ev.shot(livePage, 'live-site-mobile-390', { action: 'resize to 390px + reload', detail: 'site live mobil' });
  const mobileLiveOverflow = await livePage.evaluate(() => ({ scrollWidth: document.scrollingElement.scrollWidth, clientWidth: document.scrollingElement.clientWidth }));
  fs.writeFileSync(path.join(DIR, 'live-mobile-overflow.json'), JSON.stringify(mobileLiveOverflow, null, 2));
  if (mobileLiveOverflow.scrollWidth > mobileLiveOverflow.clientWidth + 2) ev.defect('high', 'Overflow orizontal pe site-ul live la 390px', JSON.stringify(mobileLiveOverflow), '20-live-site-mobile-390.png');

  // 12. interactions on live mobile: hamburger menu
  const hamburger = livePage.locator('[class*=hamburger], [aria-label*="meniu" i], .pr-nav-toggle, button[class*=menu]').first();
  const navLinksVisible = await livePage.locator('.pr-nav__links').isVisible().catch(() => false);
  if (await hamburger.count()) {
    await hamburger.click();
    await livePage.waitForTimeout(400);
    await ev.shot(livePage, 'mobile-menu-open', { action: 'click hamburger menu', detail: 'meniu mobil deschis' });
  } else if (!navLinksVisible) {
    await ev.shot(livePage, 'mobile-nav-links-hidden', { action: 'verify .pr-nav__links vizibilitate la 390px', detail: 'CONFIRMAT: .pr-nav__links are display:none sub 820px (styles.css) SI nu exista niciun buton hamburger/meniu alternativ in template.html — pe mobil doar butonul "Programare" (.pr-nav__cta) ramane vizibil in header' });
    ev.defect('high', 'Fara meniu de navigare pe mobil — linkurile Servicii/Despre/Întrebări/Contact dispar complet sub 820px', '.pr-nav__links { display:none } sub 820px (templates/professionals/styles.css:109-119) si templates/professionals/template.html nu are niciun toggle/hamburger care sa le arate din nou. Pe telefon (majoritatea vizitatorilor reali) singura navigare din header e butonul CTA "Programare" — Servicii, Despre, Întrebări si Contact sunt accesibile DOAR prin scroll manual, fara ancore rapide.', 'mobile-nav-links-hidden.png');
  } else {
    ev.note('Nav links vizibile pe mobil neasteptat (posibil viewport nu s-a aplicat corect).');
  }

  await livePage.setViewportSize({ width: 1440, height: 1000 });
  await livePage.reload({ waitUntil: 'networkidle' });

  // appointment form (local, not native calendar) on live desktop
  const apptForm = livePage.locator('#pr-appt-form');
  if (await apptForm.count()) {
    await apptForm.scrollIntoViewIfNeeded();
    await ev.shot(livePage, 'appointment-form-visible', { action: 'scroll to #pr-appt-form', detail: 'formular local de programare vizibil' });
    const dateSel = livePage.locator('#pr-appt-date');
    const slotSel = livePage.locator('#pr-appt-slot');
    await livePage.waitForTimeout(500);
    const dateOptions = await dateSel.locator('option').count().catch(() => 0);
    if (dateOptions > 1) await dateSel.selectOption({ index: 1 });
    await livePage.waitForTimeout(400);
    const slotOptions = await slotSel.locator('option').count().catch(() => 0);
    if (slotOptions > 1) await slotSel.selectOption({ index: 1 });
    const nameField = livePage.locator('[name="name"], #pr-appt-name').first();
    const emailField = livePage.locator('[name="email"], #pr-appt-email').first();
    if (await nameField.count()) await nameField.fill('Ana Popescu');
    if (await emailField.count()) await emailField.fill('ana.popescu@example.com');
    await ev.shot(livePage, 'appointment-form-filled', { action: 'fill nume+email+data+ora', detail: 'formular completat' });
    const submitBtn = livePage.locator('#pr-appt-submit');
    if (await submitBtn.count()) {
      await submitBtn.click();
      await livePage.waitForTimeout(1200);
      await ev.shot(livePage, 'appointment-form-submitted', { action: 'click #pr-appt-submit', detail: 'stare dupa trimitere POST /api/appointments' });
      const doneVisible = await livePage.locator('#pr-appt-done').isVisible().catch(() => false);
      if (!doneVisible) ev.defect('high', 'Fara stare de succes vizibila dupa trimiterea programarii', 'div #pr-appt-done nu e vizibil dupa click submit', 'appointment-form-submitted.png');
      else ev.note('Stare succes programare vizibila dupa submit.');
    }
  } else {
    ev.note('Formular #pr-appt-form negasit pe site-ul live (poate fi calendar nativ in loc de formular local).');
  }

  await ev.shot(livePage, 'live-final-state', { fullPage: true, action: 'final fullPage state', detail: 'stare finala site live' });

  // 13. Export zip check
  let zipOk = false, zipHasIndex = false, zipHasLegal = false, zipEntries = [];
  try {
    const extractDir = path.join(DIR, 'zip-extracted');
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    const listRes = await execFileP('unzip', ['-Z1', zipPath]);
    zipEntries = listRes.stdout.split('\n').filter(Boolean);
    fs.writeFileSync(path.join(DIR, 'zip-entries.json'), JSON.stringify(zipEntries, null, 2));
    zipHasIndex = zipEntries.some(e => /index\.html$/.test(e));
    zipHasLegal = zipEntries.some(e => /privacy|cookies|terms/i.test(e));
    await execFileP('unzip', ['-o', zipPath, '-d', extractDir]);
    zipOk = true;
    // serve statically
    const serveDir = fs.existsSync(path.join(extractDir, 'index.html')) ? extractDir : extractDir;
    const server2 = http.createServer((req, res) => {
      let p = path.join(serveDir, decodeURIComponent(req.url.split('?')[0]));
      if (req.url === '/' || req.url === '') p = path.join(serveDir, 'index.html');
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(p);
        const ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
      });
    });
    await new Promise((res) => server2.listen(0, res));
    const port2 = server2.address().port;
    const zipPage = await b.context.newPage();
    await zipPage.goto('http://127.0.0.1:' + port2 + '/', { waitUntil: 'networkidle' });
    await ev.shot(zipPage, 'zip-standalone-served', { action: 'serve extracted zip statically + open', detail: 'index.html din zip servit pe port ' + port2 });
    const zipBodyText = await zipPage.evaluate(() => document.body.innerText);
    if (!zipBodyText.includes(BUSINESS_NAME)) ev.defect('high', 'ZIP exportat nu contine numele editat cand e servit standalone', 'text negasit: ' + BUSINESS_NAME, 'zip-standalone-served.png');
    await zipPage.close();
    await new Promise((res) => server2.close(res));
  } catch (e) {
    ev.defect('high', 'Eroare la dezarhivare/verificare ZIP export', String(e.message || e), null);
  }
  if (!zipHasIndex) ev.defect('high', 'ZIP exportat nu are index.html', 'entries: ' + JSON.stringify(zipEntries), null);
  if (!zipHasLegal) ev.defect('medium', 'ZIP exportat pare sa nu includa pagini legale (privacy/cookies/terms)', '', null);

  ev.note('=== Test-run existing automated tests relevant to this template (results captured separately in shell, not in this script) ===');

  ev.finish();
  await b.close();
  await srv.close();
  console.log('DONE. Live slug:', runSlug, 'liveHref:', liveHref);
}

main().catch((e) => {
  console.error('FATAL', e);
  ev.defect('critical', 'Scriptul de audit a esuat cu eroare neasteptata', String(e.stack || e), null);
  ev.finish();
  process.exit(1);
});
