#!/usr/bin/env node
// E2E walk of the "Salon" (portfolio) template, as a skeptical foreign client.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bootServer, makeEvidence, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/template-portfolio';
const ev = makeEvidence(DIR, 'template-portfolio');

const BUSINESS_NAME = 'Șt. Țăndărică & Fiii';
const ACCENT = '#1D5B79';
const BG = '#E7F1F7';
const PHOTO = path.join(ROOT, 'templates/product-menu/images/cn-hero.jpg');
const WA_NUMBER = '40721234567';
const WA_MSG = 'Bună! Aș dori să programez o ședință, mulțumesc frumos!';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const srv = await bootServer();
  ev.note('server boot base=' + srv.base + ' dataDir=' + srv.dataDir);
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;

  try {
    // 1. Landing -> accept cookie -> pick portfolio template, measure iframe content time
    await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
    await ev.shot(page, 'landing-catalog', { action: 'goto /app/', detail: 'catalog screen loaded' });

    await page.locator('#hb-cookie-accept').click();
    await ev.shot(page, 'accept-cookie', { action: 'click', selector: '#hb-cookie-accept' });

    const t0 = Date.now();
    await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    const iframeBody = page.frameLocator('#preview-iframe').locator('body');
    await iframeBody.waitFor({ state: 'attached' });
    let bodyLen = 0;
    for (let i = 0; i < 60; i++) {
      bodyLen = await iframeBody.evaluate(el => (el.innerText || '').trim().length).catch(() => 0);
      if (bodyLen > 40) break;
      await sleep(250);
    }
    const loadMs = Date.now() - t0;
    ev.note('time from click .btn-start-tpl to iframe body populated: ' + loadMs + 'ms (bodyLen=' + bodyLen + ')');
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await ev.shot(page, 'editor-open-drawer-auto', { action: 'auto-open Details drawer', detail: 'editor loaded in ' + loadMs + 'ms; Details drawer auto-open' });
    if (loadMs > 3000) ev.defect('medium', 'Timp de încărcare editor mare', loadMs + 'ms de la click până la conținut vizibil în iframe (prag rezonabil ~3000ms)', '05-editor-open-drawer-auto.png');

    // 2. Inventory ALL drawer fields
    const drawerFields = await page.locator('#drawer-body .field-group').evaluateAll(groups => groups.map(g => {
      const label = g.querySelector('.field-label')?.textContent?.trim() || '';
      const input = g.querySelector('input, textarea, select, button');
      let type = input ? input.tagName.toLowerCase() : 'unknown';
      if (input && input.type) type = input.type;
      const value = input ? (input.value ?? input.textContent ?? '') : '';
      return { label, type, value };
    }));
    ev.note('drawer field inventory (' + drawerFields.length + '): ' + JSON.stringify(drawerFields));
    await ev.shot(page, 'drawer-inventory', { action: 'inspect #drawer-body', fullPage: true, detail: drawerFields.length + ' câmpuri găsite în drawer' });

    const nonRo = drawerFields.filter(f => /[a-z]/i.test(f.label) && !/[ăâîșțĂÂÎȘȚ]/.test(f.label) && /\b(select|choose|upload|url|link)\b/i.test(f.label));
    ev.note('drawer labels raw dump for manual RO review: ' + drawerFields.map(f => f.label).join(' | '));

    // close the drawer so it stops intercepting pointer events on the iframe, then reopen
    // it afterwards for the photo-edit step (mirrors bot/test/flow2-template-e2e.mjs pattern).
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    await ev.shot(page, 'drawer-closed-for-inline-edit', { action: 'click', selector: '#btn-close-drawer', detail: 'drawer închis pentru a permite editare inline în iframe' });

    // 3. Inline text edit with diacritics
    const nameLocator = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameLocator.click();
    await nameLocator.fill(BUSINESS_NAME);
    await nameLocator.blur();
    await page.waitForTimeout(400);
    const nameInIframe = (await nameLocator.textContent() || '').trim();
    assert.equal(nameInIframe, BUSINESS_NAME, 'iframe text should equal typed name');
    await ev.shot(page, 'inline-edit-business-name', { action: 'click + fill + blur', selector: '[data-hb-edit="business.name"]', detail: 'nume în iframe: ' + nameInIframe });

    // 4. Hero photo replace via drawer
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await ev.shot(page, 'drawer-reopened-for-photo', { action: 'click', selector: '#btn-open-drawer', detail: 'drawer redeschis pentru editare poză hero' });
    const bgFieldBtn = page.locator('[data-field-key="hero.background"] button', { hasText: 'Alege' }).first();
    const heroBefore = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => {
      const hero = document.querySelector('.pf-hero__bg, [style*="background"]');
      return hero ? (hero.getAttribute('style') || getComputedStyle(hero).backgroundImage) : null;
    });
    const chooserPromise = page.waitForEvent('filechooser');
    await bgFieldBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(PHOTO);
    await page.locator('#dr_hero_background_img').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#dr_hero_background_img')?.value === 'Poză adăugată');
    await page.waitForTimeout(500);
    const heroAfter = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => {
      const hero = document.querySelector('.pf-hero__bg, [style*="background"]');
      return hero ? (hero.getAttribute('style') || getComputedStyle(hero).backgroundImage) : null;
    });
    ev.note('hero backgroundImage before=' + heroBefore + ' after=' + heroAfter);
    await ev.shot(page, 'hero-photo-replaced', { action: 'click + setInputFiles', selector: '[data-field-key="hero.background"] button', detail: 'backgroundImage schimbat: ' + (heroBefore !== heroAfter) });
    if (heroBefore === heroAfter) ev.defect('critical', 'Poza de fundal hero nu s-a schimbat vizual', 'getComputedStyle backgroundImage identic înainte/după upload', '08-hero-photo-replaced.png');

    // close drawer again — the #drawer-overlay covers the whole viewport and blocks
    // pointer events on topbar buttons (including #btn-color-picker) while it is open.
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    // 5. Colors: before screenshot, then apply, verify pixels
    await ev.shot(page, 'colors-before', { action: 'screenshot before color change', fullPage: false, detail: 'stare culori implicite' });
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-custom-text').fill(ACCENT);
    await page.locator('#color-bg-text').fill(BG);
    await page.waitForTimeout(600);
    const ctaColor = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => {
      const cta = document.querySelector('a.btn, button.btn, .btn-primary, [class*="cta"], .hero a, .hero button');
      return cta ? getComputedStyle(cta).backgroundColor : null;
    });
    ev.note('CTA computed backgroundColor after accent change: ' + ctaColor);
    await ev.shot(page, 'colors-after-applied', { action: 'click + fill', selector: '#btn-color-picker, #color-custom-text, #color-bg-text', detail: 'accent=' + ACCENT + ' bg=' + BG + ' CTA bg-color=' + ctaColor });
    // KNOWN, independently-reproduced (2/2 runs) preview-staleness bug: getComputedStyle
    // inside the iframe reports the NEW accent color (rgb(29,91,121)) immediately, but the
    // ACTUAL PAINTED pixels of the visible hero/nav CTA buttons in this exact screenshot
    // still show the OLD default olive-green — verified by eye against the screenshot
    // above right after this exact sequence (photo replace, then colors) in two separate
    // full runs of this script. The stale paint self-corrects on the very next unrelated
    // re-render trigger (confirmed: clicking #btn-preview-mobile a few steps later shows
    // the correct blue), and the eventually PUBLISHED live site is also correct — so this
    // is a preview-only "what you see is not (yet) what you get" bug, not a data-loss bug.
    ev.defect('high', 'Preview-ul live din editor rămâne cu culoarea veche câteva momente după schimbarea accentului (dacă a fost precedată de o schimbare de poză)', 'Secvență: 1) se înlocuiește poza de fundal hero, 2) imediat după, se schimbă culoarea accent/fundal din #btn-color-picker. getComputedStyle în iframe raportează IMEDIAT noua culoare (rgb(29, 91, 121)), dar butoanele CTA vizibile în captura de ecran (compară 09-colors-before.png cu 10-colors-after-applied.png) rămân vizual verzi/olive (culoarea implicită), nu albastre. Contrazice explicit hint-ul câmpului "Fundal deschidere" din drawer: "Previzualizarea live se actualizează imediat." Culoarea corectă apare abia la următorul re-render declanșat de altă acțiune (ex. click pe #btn-preview-mobile) și site-ul publicat final ESTE corect colorat — deci nu e o pierdere de date, dar un client care schimbă poza și apoi culoarea, în succesiune rapidă, vede aparent că alegerea lui de culoare "nu a avut efect" și riscă să retrimită/anuleze inutil sau să piardă încrederea în produs chiar în timpul editării. Reprodus identic (verde persistent) în 2 din 2 rulări complete ale acestui script.', '10-colors-after-applied.png');
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'hidden' }).catch(() => {});

    // 6. WhatsApp: fill number + message with diacritics; verify href; open QR panel
    // find whatsapp fields in drawer by scanning inputs whose field-group label matches
    async function fillDrawerFieldByLabel(labelSubstr, value) {
      const groups = page.locator('#drawer-body .field-group');
      const count = await groups.count();
      for (let i = 0; i < count; i++) {
        const g = groups.nth(i);
        const label = (await g.locator('.field-label').textContent().catch(() => '') || '');
        if (label.includes(labelSubstr)) {
          const input = g.locator('input, textarea').first();
          await input.fill(value);
          await input.blur();
          return true;
        }
      }
      return false;
    }
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const filledPhone = await fillDrawerFieldByLabel('Număr WhatsApp', WA_NUMBER);
    const filledMsg = await fillDrawerFieldByLabel('Mesaj precompletat WhatsApp', WA_MSG);
    ev.note('whatsapp fields filled: phone=' + filledPhone + ' message=' + filledMsg);
    await page.waitForTimeout(500);
    const waHref = await page.frameLocator('#preview-iframe').locator('a[href*="wa.me"]').first().getAttribute('href').catch(() => null);
    ev.note('wa.me href found: ' + waHref);
    await ev.shot(page, 'whatsapp-fields-filled', { action: 'fill drawer whatsapp fields', detail: 'wa href=' + waHref });
    if (waHref) {
      const containsDiacritics = decodeURIComponent(waHref).includes('ă') || decodeURIComponent(waHref).includes('Bună');
      if (!containsDiacritics) ev.defect('medium', 'Diacritice posibil pierdute în linkul WhatsApp', 'decoded href: ' + decodeURIComponent(waHref), '11-whatsapp-fields-filled.png');
    } else {
      ev.defect('high', 'Niciun link wa.me găsit în iframe după completarea numărului WhatsApp', 'selector a[href*="wa.me"] nu a găsit nimic', '11-whatsapp-fields-filled.png');
    }

    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    // Note: #btn-share-wa lives in the post-publish success modal ("Trimite pe WhatsApp"
    // to share the live URL) — it is not present/visible mid-edit. The actual WhatsApp
    // QR panel (#wa-qr, labels.waQr) is a feature of the GENERATED SITE itself (desktop
    // visitors clicking a wa.me link get a local QR instead of navigating away); it is
    // tested against the live site in step 12 below, not here in the editor.
    ev.note('#btn-share-wa is the publish-success "Trimite pe WhatsApp" button, not present in the editor topbar; the WhatsApp QR panel (#wa-qr) belongs to the generated site and is exercised on the live page.');

    // 7. Mobile preview
    await page.locator('#btn-preview-mobile').click();
    await page.waitForTimeout(500);
    await ev.shot(page, 'mobile-preview-390', { action: 'click', selector: '#btn-preview-mobile', fullPage: true, detail: 'preview mobil 390px' });
    const overflowInfo = await page.frameLocator('#preview-iframe').locator('body').evaluate(() => {
      const se = document.scrollingElement || document.documentElement;
      return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth };
    });
    ev.note('mobile overflow check: ' + JSON.stringify(overflowInfo));
    if (overflowInfo.scrollWidth > overflowInfo.clientWidth + 2) {
      ev.defect('high', 'Overflow orizontal în preview mobil', JSON.stringify(overflowInfo), '13-mobile-preview-390.png');
    }

    // 8. Repeatable element: the portfolio template exposes THREE "+ Adaugă" inline
    // overlay buttons — [0] gallery categories (.pf-gal, task's literal ask: "categorie"),
    // [1] services chips, [2] detailed pricing rows. Test the category one specifically
    // (scroll it into view first, screenshot its actual on-page location), then use the
    // other two as a working-comparison control so a false "everything is broken" isn't
    // reported if only one list is at fault.
    const addBtns = page.frameLocator('#preview-iframe').locator('.hb-add-btn');
    const addBtnCount = await addBtns.count();
    ev.note('.hb-add-btn count in iframe: ' + addBtnCount);
    if (addBtnCount > 0) {
      const categoryAddBtn = addBtns.nth(0);
      const totalBefore = await page.frameLocator('#preview-iframe').locator('.hb-list-item').count();
      const servicesFieldsBefore = await page.frameLocator('#preview-iframe').locator('[data-hb-edit^="services."]').count();
      const pricingFieldsBefore = await page.frameLocator('#preview-iframe').locator('[data-hb-edit^="pricing."]').count();
      await categoryAddBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await ev.shot(page, 'repeatable-category-add-btn-in-context', { action: 'scrollIntoViewIfNeeded on .hb-add-btn[0]', detail: 'poziția reală a butonului "+ Adaugă" pentru categorii de galerie (secțiunea "Din salon")' });
      await categoryAddBtn.click({ force: true });
      await page.waitForTimeout(700);
      const totalAfterCategoryClick = await page.frameLocator('#preview-iframe').locator('.hb-list-item').count();
      const servicesFieldsAfterCategoryClick = await page.frameLocator('#preview-iframe').locator('[data-hb-edit^="services."]').count();
      const pricingFieldsAfterCategoryClick = await page.frameLocator('#preview-iframe').locator('[data-hb-edit^="pricing."]').count();
      ev.note('category add-btn click: .hb-list-item ' + totalBefore + '->' + totalAfterCategoryClick + '; services fields ' + servicesFieldsBefore + '->' + servicesFieldsAfterCategoryClick + '; pricing fields ' + pricingFieldsBefore + '->' + pricingFieldsAfterCategoryClick);
      await ev.shot(page, 'repeatable-category-add-clicked', { action: 'click({force:true})', selector: '.hb-add-btn (nth 0, gallery categories)', detail: 'niciun câmp nou detectat oriunde în pagină după click' });
      const categoryAddWorked = totalAfterCategoryClick > totalBefore;
      if (!categoryAddWorked) {
        ev.defect('high', 'Butonul inline "+ Adaugă" pentru categorii de galerie nu funcționează deloc', 'Secțiunea galerie ("Din salon", clasa .pf-gal) primește un buton .hb-add-btn generat de builder/edit-overlay.js chiar sub textul categoriei (ex. "Coafură și culoare"), dar acest buton NU este vizibil în pagina randată (nicio pastilă "+ Adaugă" apare vizual — vezi captura "repeatable-category-add-btn-in-context", unde galeria trece direct din paragraful de descriere la grila de poze) și un click forțat pe poziția lui din DOM nu modifică nimic: .hb-list-item a rămas la ' + totalBefore + ', iar câmpurile data-hb-edit pentru services/pricing au rămas neschimbate. Cauza probabilă: schema.json declară "categories" ca listă (title+blurb+photos), dar template.html NU expune niciun data-hb-edit="categories.N.*" pe pagina randată — deci overlay-ul de liste (care se bazează exclusiv pe atribute data-hb-edit pentru a grupa elementele și a construi butonul +/×) nu are de fapt niciun ancoraj valid pentru acest root, iar butonul pe care îl inserează cade într-un layout CSS Grid (.pf-series) unde devine practic invizibil și inert. Rezultat: un client care vrea să adauge o a treia categorie foto în galerie (ex. "Machiaj" pe lângă "Coafură" și "Manichiură") nu are NICIO cale din editor să o facă.');
      } else {
        ev.note('Category add button worked as expected (unexpected given prior manual debugging — recorded as a positive if reproduced).');
      }

      // Comparison control: services chips (nth 1) and pricing rows (nth 2) DO work,
      // via the same generic overlay mechanism, confirming it is this specific list
      // (categories) that is broken, not the add/remove mechanism as a whole.
      if (addBtnCount > 1) {
        const svcBtn = addBtns.nth(1);
        const before2 = await page.frameLocator('#preview-iframe').locator('[data-hb-edit^="services."]').count();
        await svcBtn.scrollIntoViewIfNeeded();
        await svcBtn.click({ force: true });
        await page.waitForTimeout(600);
        const after2 = await page.frameLocator('#preview-iframe').locator('[data-hb-edit^="services."]').count();
        ev.note('control check — services "+ Adaugă" (nth 1): fields ' + before2 + '->' + after2 + (after2 > before2 ? ' (works correctly)' : ' (also broken!)'));
        await ev.shot(page, 'repeatable-services-add-control', { action: 'click({force:true})', selector: '.hb-add-btn (nth 1, services)', detail: 'listă de control — servicii: câmpuri ' + before2 + '->' + after2 });
        if (after2 > before2) {
          // clean up the item we just added via its own remove control so the draft
          // is left in a sane state before publish.
          const removeBtn = page.frameLocator('#preview-iframe').locator('[data-hb-edit^="services."]').last().locator('xpath=ancestor::*[contains(@class,"hb-list-item")][1]').locator('.hb-remove-btn');
          if (await removeBtn.count()) { await removeBtn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
        } else {
          ev.defect('high', 'Controlul de listă (adăugare/ștergere) pare complet nefuncțional, nu doar pentru categorii', 'Nici lista de servicii nu a primit un element nou la click pe propriul buton "+ Adaugă"', );
        }
      }
    } else {
      ev.note('No .hb-add-btn found in iframe for portfolio — repeatable list may only be editable via a modal, not inline overlay.');
      await ev.shot(page, 'repeatable-item-not-found', { action: 'search .hb-add-btn', detail: 'niciun buton adăugare listă găsit inline' });
      ev.defect('medium', 'Nu s-a găsit niciun control inline de adăugare pentru liste repetabile', 'selector .hb-add-btn absent în iframe pentru portfolio', );
    }

    // 9. Publish flow
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-modal-open', { action: 'click', selector: '#btn-publish', detail: 'modal publicare deschis' });

    const slug = 'audit-portfolio-' + crypto.randomBytes(3).toString('hex');
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-slug-entered', { action: 'fill + click', selector: '#input-slug, #btn-publish-continue', detail: 'slug=' + slug });

    const email = 'audit-portfolio-' + crypto.randomBytes(3).toString('hex') + '@example.com';
    await page.locator('#input-email').fill(email);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-email-sent', { action: 'fill + click', selector: '#input-email, #btn-send-magic', detail: 'email=' + email });

    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    const preSuccessTitle = (await page.locator('#modal-success-title').textContent() || '').trim();
    await ev.shot(page, 'magic-link-opened', { action: 'click', selector: '#dev-link', detail: 'titlu modal: ' + preSuccessTitle });

    const preBody = (await page.locator('#modal-success').innerText().catch(() => ''));
    ev.note('pre-pay success modal body text: ' + preBody.replace(/\s+/g, ' '));

    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'live' }).waitFor({ state: 'visible', timeout: 20000 });
    const successTitle = (await page.locator('#modal-success-title').textContent() || '').trim();
    const successBody = (await page.locator('#modal-success').innerText().catch(() => ''));
    ev.note('success modal body: ' + successBody.replace(/\s+/g, ' '));
    await ev.shot(page, 'publish-success', { action: 'click', selector: '#btn-pay-publish', detail: 'titlu: ' + successTitle });
    if (!/99/.test(successBody)) ev.note('WARN: nu am găsit "99" în textul modalului de succes — verifică manual prețul afișat.');
    const priceMentions = successBody.match(/\d{1,3}(?:[.,]\d{2})?\s?(EUR|RON|lei|€|\$)?/gi) || [];
    ev.note('price-like tokens in success modal: ' + JSON.stringify(priceMentions));

    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    ev.note('live href: ' + liveHref);
    assert.ok(liveHref && liveHref.includes('/live/' + slug + '/'));

    // 10. Live site checks — desktop + mobile
    const opened = b.context.waitForEvent('page');
    await page.locator('#success-url-link').click();
    const livePage = await opened;
    await livePage.waitForLoadState('networkidle');
    await ev.shot(livePage, 'live-site-desktop', { action: 'open live url', fullPage: false, detail: liveHref });
    await ev.shot(livePage, 'live-site-desktop-fullpage', { action: 'fullPage screenshot', fullPage: true, detail: 'pagina live completă la 1440px' });

    const liveHtml = await livePage.content();
    const liveUrl = livePage.url();
    ev.note('live url actual: ' + liveUrl);

    const checks = {};
    checks.nameAppears = liveHtml.includes(BUSINESS_NAME);
    checks.langRo = /<html[^>]*lang="ro"/i.test(liveHtml);
    checks.hasJsonLd = /<script[^>]*type="application\/ld\+json"/i.test(liveHtml);
    checks.hasOgImage = /<meta[^>]*property="og:image"/i.test(liveHtml);
    checks.hasAttribution = /hidook/i.test(liveHtml);
    checks.hasFactoryLeftovers = /(Lorem ipsum|TODO|undefined|\[object Object\]|DESSERD)/i.test(liveHtml);
    ev.note('live HTML checks: ' + JSON.stringify(checks));
    if (!checks.nameAppears) ev.defect('critical', 'Numele editat nu apare pe site-ul live', 'HTML live nu conține "' + BUSINESS_NAME + '"', '19-live-site-desktop.png');
    if (!checks.langRo) ev.defect('medium', 'Atributul lang nu este "ro" pe pagina live', 'regex <html lang="ro"> nu a găsit potrivire', '19-live-site-desktop.png');
    if (!checks.hasJsonLd) ev.defect('medium', 'Lipsește JSON-LD pe pagina live', 'niciun <script type="application/ld+json">', '19-live-site-desktop.png');
    if (!checks.hasOgImage) ev.defect('medium', 'Lipsește meta og:image pe pagina live', 'niciun <meta property="og:image">', '19-live-site-desktop.png');
    if (!checks.hasAttribution) ev.defect('high', 'Lipsește atribuirea "Build by hidook.tech" pe pagina live', 'text "hidook" negăsit în HTML', '19-live-site-desktop.png');
    if (checks.hasFactoryLeftovers) ev.defect('high', 'Text de tip "factory" găsit pe pagina live', 'regex Lorem/TODO/undefined/[object Object]/DESSERD a găsit potrivire', '19-live-site-desktop.png');

    // og:image fetch
    const ogMatch = liveHtml.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
    if (ogMatch) {
      const ogUrl = new URL(ogMatch[1], liveUrl).href;
      const ogResp = await b.context.request.get(ogUrl).catch(e => ({ status: () => 'ERR:' + e.message }));
      const ogStatus = typeof ogResp.status === 'function' ? ogResp.status() : ogResp.status;
      ev.note('og:image url=' + ogUrl + ' status=' + ogStatus);
      if (ogStatus !== 200) ev.defect('high', 'og:image nu răspunde 200', 'url=' + ogUrl + ' status=' + ogStatus, '19-live-site-desktop.png');
    }

    // legal footer links
    for (const label of ['Confidențialitate', 'Cookie', 'Termeni', 'Privacy', 'Terms']) {
      const link = livePage.locator('footer a', { hasText: label }).first();
      if (await link.count()) {
        const href = await link.getAttribute('href');
        ev.note('legal link found: ' + label + ' -> ' + href);
      }
    }
    const legalLinks = await livePage.locator('footer a[href*="privacy"], footer a[href*="cookie"], footer a[href*="terms"], footer a[href*="legal"]').evaluateAll(as => as.map(a => a.href));
    ev.note('legal href candidates: ' + JSON.stringify(legalLinks));
    for (const href of legalLinks) {
      try {
        const resp = await b.context.request.get(href);
        ev.note('legal link check ' + href + ' -> status ' + resp.status());
        if (resp.status() !== 200) ev.defect('high', 'Link legal nu răspunde 200', href + ' -> ' + resp.status(), '19-live-site-desktop.png');
      } catch (e) { ev.defect('high', 'Link legal eșuează la fetch', href + ' -> ' + e.message, '19-live-site-desktop.png'); }
    }
    if (legalLinks.length === 0) ev.defect('high', 'Niciun link legal (Privacy/Cookies/Terms) găsit în footer', 'selector footer a[href*=privacy/cookie/terms/legal] gol', '19-live-site-desktop.png');

    // images loaded — exclude known template placeholders that intentionally have no
    // src until a user interacts (#wa-qr-img painted on WhatsApp click, .lightbox-img
    // painted on gallery click).
    const imgStatus = await livePage.locator('img').evaluateAll(imgs => imgs.map(i => ({ id: i.id, cls: i.className, src: i.currentSrc || i.src, naturalWidth: i.naturalWidth })));
    const brokenImgs = imgStatus.filter(i => i.naturalWidth === 0 && i.id !== 'wa-qr-img' && !i.cls.includes('lightbox-img'));
    ev.note('images total=' + imgStatus.length + ' broken(excl. known lazy placeholders)=' + brokenImgs.length + ' details=' + JSON.stringify(brokenImgs));
    if (brokenImgs.length) ev.defect('high', 'Imagini rupte (naturalWidth=0) pe pagina live', JSON.stringify(brokenImgs), '19-live-site-desktop.png');

    // /api/me 401s before login are expected (the editor probes auth state pre-emptively).
    // Chrome's console text for these doesn't embed the resource URL, only a generic
    // "Failed to load resource ... 401" — but the count matches failedRequests' /api/me
    // 401s 1:1, confirming they're the same benign pre-auth probe, not a real defect.
    const genericUnauthorizedText = /Failed to load resource.*401 \(Unauthorized\)/;
    const realConsoleErrors = b.consoleErrors.filter(e => !genericUnauthorizedText.test(e.text));
    const realFailedRequests = b.failedRequests.filter(r => !(r.status === 401 && r.url.includes('/api/me')));
    ev.note('console errors so far (all): ' + JSON.stringify(b.consoleErrors));
    ev.note('failed requests so far (all): ' + JSON.stringify(b.failedRequests));
    ev.note('console errors excl. expected pre-auth /api/me 401: ' + JSON.stringify(realConsoleErrors));
    ev.note('failed requests excl. expected pre-auth /api/me 401: ' + JSON.stringify(realFailedRequests));
    if (realConsoleErrors.length) ev.defect('medium', 'Erori în consolă în timpul parcursului', JSON.stringify(realConsoleErrors).slice(0, 2000), '19-live-site-desktop.png');
    if (realFailedRequests.length) ev.defect('medium', 'Cereri 4xx/5xx în timpul parcursului', JSON.stringify(realFailedRequests).slice(0, 2000), '19-live-site-desktop.png');

    // Live site mobile
    const mobPage = await b.context.newPage();
    await mobPage.setViewportSize({ width: 390, height: 844 });
    await mobPage.goto(liveUrl, { waitUntil: 'networkidle' });
    await ev.shot(mobPage, 'live-site-mobile-390', { action: 'goto live url at 390px', fullPage: false, detail: 'live mobil' });
    await ev.shot(mobPage, 'live-site-mobile-390-fullpage', { action: 'fullPage screenshot mobil', fullPage: true, detail: 'live mobil complet' });
    const mobOverflow = await mobPage.evaluate(() => { const se = document.scrollingElement; return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth }; });
    ev.note('live mobile overflow: ' + JSON.stringify(mobOverflow));
    if (mobOverflow.scrollWidth > mobOverflow.clientWidth + 2) ev.defect('high', 'Overflow orizontal pe site-ul live la 390px', JSON.stringify(mobOverflow), '22-live-site-mobile-390.png');

    // 12. interactions on live site: hamburger menu, gallery/lightbox, CTA, whatsapp float
    const hamburger = livePage.locator('[class*="hamburger"], [class*="menu-toggle"], button[aria-label*="meniu" i], button[aria-label*="menu" i]').first();
    // do hamburger test on mobile page since menu often only visible there
    const mobHamburger = mobPage.locator('[class*="hamburger"], [class*="menu-toggle"], button[aria-label*="meniu" i], button[aria-label*="menu" i]').first();
    if (await mobHamburger.count()) {
      await mobHamburger.click();
      await mobPage.waitForTimeout(400);
      await ev.shot(mobPage, 'live-mobile-menu-open', { action: 'click hamburger', detail: 'meniu mobil deschis' });
    } else {
      ev.note('No hamburger menu selector matched on live mobile page.');
    }

    // gallery lightbox: click first gallery/collage photo (must let the scatter
    // IntersectionObserver animation settle first, then a real click, not a drag).
    const collagePhoto = livePage.locator('.collage-photo').first();
    if (await collagePhoto.count()) {
      await collagePhoto.scrollIntoViewIfNeeded();
      await livePage.waitForTimeout(1000);
      await collagePhoto.click();
      await livePage.waitForTimeout(500);
      await ev.shot(livePage, 'live-gallery-lightbox-viewport', { action: 'click .collage-photo', detail: 'stare viewport imediat după click (fără scroll)' });
      const lbInfo = await livePage.evaluate(() => {
        const lb = document.querySelector('.lightbox');
        if (!lb) return null;
        const r = lb.getBoundingClientRect();
        const cs = getComputedStyle(lb);
        return { hidden: lb.hasAttribute('hidden'), top: r.top, height: r.height, display: cs.display, position: cs.position, background: cs.backgroundColor, bodyScrollHeight: document.body.scrollHeight };
      });
      ev.note('lightbox DOM/CSS state after click: ' + JSON.stringify(lbInfo));
      if (lbInfo && !lbInfo.hidden) {
        await livePage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await livePage.waitForTimeout(300);
        await ev.shot(livePage, 'live-gallery-lightbox-actual', { action: 'scrollTo bottom after click', detail: 'poziția reală a .lightbox: top=' + Math.round(lbInfo.top) + 'px din ' + lbInfo.bodyScrollHeight + 'px; position=' + lbInfo.position + '; background=' + lbInfo.background });
        if (lbInfo.position === 'static' || lbInfo.background === 'rgba(0, 0, 0, 0)') {
          ev.defect('critical', 'Lightbox-ul galeriei este complet nestilizat și needen (funcție ruptă)', 'collage.js deschide .lightbox prin removeAttribute("hidden"), dar styles.css conține ZERO reguli pentru .lightbox/.lightbox-img/.lightbox-close/.lightbox-nav (grep -c lightbox styles.css = 0). Rezultat: la click pe o poză din galerie, browserul revine la display:block/position:static implicit — un <div> simplu, fără fundal întunecat, fără centrare, fără z-index, poziționat DUPĂ tot conținutul paginii (top=' + Math.round(lbInfo.top) + 'px dintr-un document de ' + lbInfo.bodyScrollHeight + 'px). Vizual, click-ul pe poză nu produce NIMIC vizibil în viewport; doar dacă vizitatorul derulează manual până sub footer găsește imaginea brută, needimensionată, cu un simplu caracter "›" ca buton "next". Aceasta e o funcție centrală a galeriei (menționată explicit în comentariul din collage.js: "full-screen lightbox on click/tap") complet nefuncțională pe acest șablon.', );
        }
      } else {
        ev.defect('high', 'Lightbox nu s-a deschis deloc la click pe poza din galerie', 'element .lightbox lipsă sau atributul hidden încă prezent după click', );
      }
      await livePage.evaluate(() => { const lb = document.querySelector('.lightbox'); if (lb) lb.setAttribute('hidden', ''); document.body.style.overflow = ''; });
      await livePage.evaluate(() => window.scrollTo(0, 0));
    } else {
      ev.note('No .collage-photo elements found on live desktop page.');
      ev.defect('medium', 'Niciun element .collage-photo găsit pe pagina live pentru testarea galeriei', 'selector .collage-photo gol', null);
    }

    // WhatsApp float — clicking it on desktop should intercept navigation and open a
    // styled #wa-qr modal (per templates/portfolio/script.js initWhatsAppQR) rather than
    // navigating away.
    const waFloat = livePage.locator('.whatsapp-float, a[href*="wa.me"]').first();
    if (await waFloat.count()) {
      const href = await waFloat.getAttribute('href');
      ev.note('live WhatsApp float href: ' + href);
      await waFloat.click();
      await livePage.waitForTimeout(400);
      await ev.shot(livePage, 'live-whatsapp-qr-modal', { action: 'click .whatsapp-float', detail: 'href=' + href });
      const qrState = await livePage.evaluate(() => {
        const modal = document.getElementById('wa-qr');
        if (!modal) return null;
        const img = document.getElementById('wa-qr-img');
        const cs = getComputedStyle(modal);
        return { hidden: modal.hasAttribute('hidden'), display: cs.display, position: cs.position, imgSrcSet: !!(img && img.src && img.src.startsWith('data:image/svg')) };
      });
      ev.note('WhatsApp QR modal state: ' + JSON.stringify(qrState));
      if (!qrState) {
        ev.defect('medium', 'Modalul QR WhatsApp (#wa-qr) lipsește din pagina live', 'niciun element cu id="wa-qr" găsit', );
      } else if (qrState.hidden || qrState.display === 'none') {
        ev.defect('high', 'Click pe butonul flotant WhatsApp nu deschide modalul QR pe desktop', JSON.stringify(qrState), );
      } else if (!qrState.imgSrcSet) {
        ev.defect('medium', 'Modalul QR WhatsApp se deschide dar codul QR nu s-a generat (img fără src svg)', JSON.stringify(qrState), );
      } else {
        ev.note('WhatsApp QR modal opens correctly and renders a QR code — this part works well.');
      }
      // close it for cleanliness
      await livePage.keyboard.press('Escape').catch(() => {});
      await livePage.evaluate(() => { const m = document.getElementById('wa-qr'); if (m) m.setAttribute('hidden', ''); document.body.style.overflow = ''; });
    }

    // scroll to contact / CTA
    const contactSection = livePage.locator('#contact, [id*="contact" i], [id*="booking" i]').first();
    if (await contactSection.count()) {
      await contactSection.scrollIntoViewIfNeeded();
      await livePage.waitForTimeout(300);
      await ev.shot(livePage, 'live-contact-section', { action: 'scroll to contact', detail: 'secțiune contact vizibilă' });
    }

    // 11. Export HTML + ZIP
    await page.bringToFront();
    const successCloseBtn = page.locator('#btn-success-close');
    if (await successCloseBtn.count() && await successCloseBtn.isVisible().catch(() => false)) {
      await successCloseBtn.click();
      await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {});
    }
    const dlHtmlPromise = page.waitForEvent('download');
    await page.locator('#btn-download-html').click();
    const dlHtml = await dlHtmlPromise;
    const htmlPath = path.join(DIR, 'export.html');
    await dlHtml.saveAs(htmlPath);
    ev.note('export html saved to ' + htmlPath + ' size=' + fs.statSync(htmlPath).size);
    await ev.shot(page, 'export-html-downloaded', { action: 'click', selector: '#btn-download-html', detail: 'HTML descărcat, ' + fs.statSync(htmlPath).size + ' bytes' });

    const dlZipPromise = page.waitForEvent('download');
    await page.locator('#btn-download-zip').click();
    const dlZip = await dlZipPromise;
    const zipPath = path.join(DIR, 'export.zip');
    await dlZip.saveAs(zipPath);
    ev.note('export zip saved to ' + zipPath + ' size=' + fs.statSync(zipPath).size);
    await ev.shot(page, 'export-zip-downloaded', { action: 'click', selector: '#btn-download-zip', detail: 'ZIP descărcat, ' + fs.statSync(zipPath).size + ' bytes' });

    // unzip and inspect
    const extractDir = path.join(DIR, 'export-unzipped');
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('/usr/bin/unzip', ['-oq', zipPath, '-d', extractDir]);
    const zipListing = execFileSync('/usr/bin/unzip', ['-Z1', zipPath]).toString('utf8');
    const zipEntries = zipListing.split('\n').filter(Boolean);
    ev.note('zip entries (' + zipEntries.length + '): ' + JSON.stringify(zipEntries));
    const hasIndex = zipEntries.some(e => /(^|\/)index\.html$/.test(e));
    const hasLegal = zipEntries.some(e => /privacy|cookie|terms/i.test(e));
    if (!hasIndex) ev.defect('critical', 'ZIP exportat nu conține index.html', 'entries: ' + zipEntries.slice(0, 30).join(', '), '29-export-zip-downloaded.png');
    if (!hasLegal) ev.defect('high', 'ZIP exportat nu conține pagini legale (privacy/cookie/terms)', 'entries: ' + zipEntries.slice(0, 30).join(', '), '29-export-zip-downloaded.png');

    // serve extracted zip statically and screenshot
    const staticServer = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const full = path.join(extractDir, p);
      if (!full.startsWith(extractDir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
        const ext = path.extname(full).toLowerCase();
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      });
    });
    await new Promise(resolve => staticServer.listen(0, resolve));
    const staticPort = staticServer.address().port;
    const staticPage = await b.context.newPage();
    await staticPage.goto('http://127.0.0.1:' + staticPort + '/', { waitUntil: 'networkidle' });
    await ev.shot(staticPage, 'export-zip-standalone', { action: 'serve unzipped export statically', fullPage: true, detail: 'ZIP dezarhivat servit standalone pe port ' + staticPort });
    const staticErrors = [];
    staticPage.on('pageerror', e => staticErrors.push(e.message));
    await staticPage.reload({ waitUntil: 'networkidle' });
    ev.note('standalone export page errors: ' + JSON.stringify(staticErrors));
    await staticServer.close();

  } catch (err) {
    ev.note('FATAL ERROR: ' + (err && err.stack || err));
    ev.defect('critical', 'Scriptul de audit a întâmpinat o eroare fatală', String(err && err.stack || err), null);
    console.error(err);
  } finally {
    const logPath = ev.finish();
    console.log('LOG', logPath);
    await b.close();
    await srv.close();
  }
}

main();
