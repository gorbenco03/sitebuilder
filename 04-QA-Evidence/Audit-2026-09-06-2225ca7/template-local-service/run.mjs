// E2E audit walk for template "local-service" (Meserii)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { bootServer, makeEvidence, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const EVID = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/template-local-service';
const ev = makeEvidence(EVID, 'template-local-service');

const BUSINESS_NAME = 'Șt. Țăndărică & Fiii';
const ACCENT = '#1D5B79';
const BG = '#E7F1F7';
const PHOTO = path.join(ROOT, 'templates/product-menu/images/cn-hero.jpg');
const WA_NUMBER = '40745123456';
const WA_MSG = 'Bună ziua! Aș dori o ofertă pentru renovare băie, mulțumesc.';

function timestamp() { return new Date().toISOString(); }

async function main() {
  const srv = await bootServer();
  ev.note('Server isolat pornit la ' + srv.base + ' (DATA_DIR=' + srv.dataDir + ')');
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;

  let liveUrl = null;
  let slug = 'qa-local-service-' + Date.now().toString(36);

  try {
    // ---------- 1. Deschidere catalog + selectare șablon ----------
    await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').waitFor({ state: 'visible' });
    await page.locator('#hb-cookie-accept').click();
    await ev.shot(page, 'accept-cookie', { action: 'click', selector: '#hb-cookie-accept', detail: 'banner cookie acceptat' });

    const t0 = Date.now();
    await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    // Wait for iframe body to have content
    const frame = page.frameLocator('#preview-iframe');
    await frame.locator('body').waitFor({ state: 'visible', timeout: 15000 });
    await frame.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 15000 });
    const loadMs = Date.now() - t0;
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await ev.shot(page, 'template-selected-editor-open', { action: 'click .btn-start-tpl', detail: 'editor deschis, drawer auto-open, iframe cu conținut în ' + loadMs + 'ms' });
    ev.note('Timp de la click pana la continut in iframe: ' + loadMs + 'ms');
    if (loadMs > 4000) ev.defect('low', 'Încărcare inițială lentă a iframe-ului', 'A durat ' + loadMs + 'ms de la click la conținut vizibil in iframe.', ev.log.entries.at(-1).screenshot);

    // ---------- 2. Inventar câmpuri drawer ----------
    const fieldInventory = await page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('#drawer-body .drawer-section'));
      const out = [];
      groups.forEach(g => {
        const title = g.querySelector('.drawer-section-title')?.textContent?.trim() || '(fara titlu)';
        const fields = Array.from(g.querySelectorAll('[data-field-key]'));
        fields.forEach(f => {
          const key = f.dataset.fieldKey;
          const label = f.querySelector('.field-label')?.textContent?.trim() || '(fara label)';
          const input = f.querySelector('input,textarea,select,button');
          let val = '';
          if (input) {
            if (input.tagName === 'SELECT') val = input.options[input.selectedIndex]?.textContent || '';
            else if (input.tagName === 'BUTTON') val = input.textContent.trim();
            else val = input.value;
          }
          out.push({ section: title, key, label, tag: input ? input.tagName : null, type: input ? input.type : null, value: (val||'').slice(0,60) });
        });
      });
      return out;
    });
    fs.writeFileSync(path.join(EVID, 'drawer-field-inventory.json'), JSON.stringify(fieldInventory, null, 2));
    ev.note('Inventar campuri drawer: ' + fieldInventory.length + ' campuri, salvat in drawer-field-inventory.json');
    await ev.shot(page, 'drawer-inventory-fullpage', { action: 'inspect #drawer-body', fullPage: true, detail: fieldInventory.length + ' campuri inventariate' });

    // Check RO diacritics / jargon heuristics
    const nonRoLabels = fieldInventory.filter(f => /^[a-z]/i.test(f.label) && /\b(URL|href|CSS|JSON|API|slug)\b/i.test(f.label) === false && /[a-z]/.test(f.label) && !/[ăâîșț]/i.test(f.label) && f.label.split(' ').length <= 2 && /^(logo|hero|dock|wordmark)/i.test(f.label));
    // (heuristic only, will manually eyeball too)

    // ---------- 3. Editare text inline in iframe ----------
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    const nameEl = frame.locator('[data-hb-edit="business.name"]').first();
    await nameEl.click();
    await nameEl.fill(BUSINESS_NAME);
    await nameEl.blur();
    await page.waitForTimeout(400);
    const iframeText = await nameEl.textContent();
    await ev.shot(page, 'edit-business-name-inline', { action: 'click + fill + blur', selector: '#preview-iframe [data-hb-edit="business.name"]', detail: 'text iframe: ' + iframeText });
    if ((iframeText||'').trim() !== BUSINESS_NAME) ev.defect('high', 'Numele editat nu apare identic in iframe', 'Asteptat "' + BUSINESS_NAME + '", gasit "' + iframeText + '"', ev.log.entries.at(-1).screenshot);

    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const businessNameInDrawer = await page.locator('[data-field-key="business.name"]').count();
    await ev.shot(page, 'drawer-reflects-business-name', { action: 'open drawer, check for business.name field', detail: 'field prezent in drawer: ' + (businessNameInDrawer > 0) });
    ev.note('ARHITECTURA: business.name (type=text) nu e camp de drawer deloc (doar phone/url/color/background + cateva chei whitelisted apar in Detalii); editarea se face EXCLUSIV inline in iframe. businessNameInDrawer=' + businessNameInDrawer);

    // ---------- 4. Editare poza hero ----------
    const heroBtn = page.locator('[data-field-key="hero.background"] button').first();
    const chooserPromise = page.waitForEvent('filechooser');
    await heroBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(PHOTO);
    await page.locator('#dr_hero_background_img').waitFor({ state: 'visible' }).catch(() => {});
    await page.waitForTimeout(600);
    await ev.shot(page, 'edit-hero-photo', { action: 'click + setInputFiles', selector: '[data-field-key="hero.background"] button', detail: 'poza incarcata: ' + PHOTO });
    const heroBgCss = await frame.locator('.ls-hero__media').first().evaluate(el => getComputedStyle(el).backgroundImage).catch(() => '');
    ev.note('hero .ls-hero__media background-image dupa upload: ' + (heroBgCss||'').slice(0,160));
    if (!heroBgCss || heroBgCss === 'none') ev.defect('high', 'Fundalul hero (.ls-hero__media) nu s-a schimbat vizual dupa upload poza', 'getComputedStyle(.ls-hero__media).backgroundImage = ' + heroBgCss, ev.log.entries.at(-1).screenshot);

    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    // ---------- 5. Culori ----------
    const ctaBefore = await frame.locator('a, button').filter({ hasText: /ofert|sun|cere/i }).first().evaluate(el => getComputedStyle(el).backgroundColor).catch(() => null);
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'visible' });
    await ev.shot(page, 'color-popover-open', { action: 'click #btn-color-picker', detail: 'CTA culoare inainte: ' + ctaBefore });
    await page.locator('#color-custom-text').fill(ACCENT);
    await page.locator('#color-bg-text').fill(BG);
    await page.waitForTimeout(400);
    await ev.shot(page, 'colors-applied', { action: 'fill #color-custom-text/#color-bg-text', detail: 'accent=' + ACCENT + ' bg=' + BG });
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'hidden' });

    const ctaAfter = await frame.locator('a, button').filter({ hasText: /ofert|sun|cere/i }).first().evaluate(el => getComputedStyle(el).backgroundColor).catch(() => null);
    const bodyBgAfter = await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor).catch(() => null);
    ev.note('CTA culoare dupa: ' + ctaAfter + ' | body bg dupa: ' + bodyBgAfter);
    const expectRgb = hexToRgbString(ACCENT);
    if (ctaAfter && ctaBefore && ctaAfter === ctaBefore) ev.defect('high', 'Culoarea accent nu s-a propagat pe pixeli (CTA)', 'CTA avea aceeasi culoare de fundal inainte si dupa: ' + ctaAfter, ev.log.entries.at(-1).screenshot);

    // ---------- 6. WhatsApp ----------
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const waPhoneInput = page.locator('[data-field-key="contact.whatsapp"] input').first();
    await waPhoneInput.fill(WA_NUMBER);
    const waMsgInput = page.locator('[data-field-key="contact.waMessage"] textarea, [data-field-key="contact.waMessage"] input').first();
    await waMsgInput.fill(WA_MSG);
    await waMsgInput.blur();
    await page.waitForTimeout(500);
    await ev.shot(page, 'whatsapp-fields-filled', { action: 'fill contact.whatsapp + contact.waMessage', detail: 'nr=' + WA_NUMBER + ' msg="' + WA_MSG + '"' });

    const waHref = await frame.locator('a[href*="wa.me"]').first().getAttribute('href').catch(() => null);
    ev.note('href WhatsApp badge dupa completare: ' + waHref);
    if (!waHref || !waHref.includes(WA_NUMBER)) ev.defect('high', 'Linkul WhatsApp nu contine numarul introdus', 'href=' + waHref, ev.log.entries.at(-1).screenshot);
    if (waHref) {
      const decoded = decodeURIComponent(waHref.split('text=')[1] || '');
      if (!decoded.includes('ofertă') && !decoded.includes(WA_MSG)) {
        ev.defect('medium', 'Diacriticele din mesajul WhatsApp pot fi corupte in link', 'decoded=' + decoded, ev.log.entries.at(-1).screenshot);
      }
      ev.note('WA href decoded: ' + decoded);
    }

    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    // The product's actual "WhatsApp QR" affordance: clicking any wa.me link inside the
    // rendered site (desktop UA) intercepts navigation and opens the site's own #wa-qr
    // modal with a hand-rolled client-side QR encoder (templates/local-service/script.js).
    const waLinkInFrame = frame.locator('a[href*="wa.me"]').first();
    await waLinkInFrame.click();
    await page.waitForTimeout(400);
    await ev.shot(page, 'whatsapp-qr-panel', { action: 'click link wa.me in iframe preview', detail: 'panou QR WhatsApp (#wa-qr) din template' });
    const qrModalVisible = await frame.locator('#wa-qr').evaluate(el => !el.hidden).catch(() => false);
    ev.note('Modal #wa-qr vizibil dupa click pe link wa.me: ' + qrModalVisible);
    if (!qrModalVisible) ev.defect('high', 'Modalul QR WhatsApp (#wa-qr) nu se deschide la click pe linkul wa.me in preview', '', ev.log.entries.at(-1).screenshot);
    // Save the QR image for decode verification later (cv2) and check it is centered/finished.
    let qrImgSrc = null;
    if (qrModalVisible) {
      qrImgSrc = await frame.locator('#wa-qr-img').getAttribute('src').catch(() => null);
      try {
        await frame.locator('#wa-qr-img').screenshot({ path: path.join(EVID, 'wa-qr-code.png') });
      } catch (e) { ev.note('Nu am putut face screenshot separat la #wa-qr-img: ' + e.message); }
    }
    await frame.locator('[data-wa-close]').first().click().catch(() => {});
    await page.waitForTimeout(200);
    if (qrImgSrc) fs.writeFileSync(path.join(EVID, 'wa-qr-expected.json'), JSON.stringify({ waHref, qrImgSrcLen: qrImgSrc.length }, null, 2));

    // ---------- 7. Preview mobil ----------
    await page.locator('#btn-preview-mobile').click();
    await page.waitForTimeout(400);
    await ev.shot(page, 'preview-mobile-390', { action: 'click #btn-preview-mobile', fullPage: true, detail: 'previzualizare mobil in editor' });
    const mobileOverflow = await frame.locator('html').evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth).catch(() => null);
    ev.note('Overflow orizontal preview mobil (scrollWidth-clientWidth): ' + mobileOverflow);
    if (mobileOverflow && mobileOverflow > 2) ev.defect('medium', 'Overflow orizontal in preview mobil', 'scrollWidth - clientWidth = ' + mobileOverflow + 'px', ev.log.entries.at(-1).screenshot);
    await page.locator('#btn-preview-mobile').click(); // toggle back to desktop
    await page.waitForTimeout(300);

    // ---------- 8. Element repetabil: adauga/sterge serviciu ----------
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const servicesListWrap = page.locator('[data-field-key="services"]');
    await servicesListWrap.scrollIntoViewIfNeeded().catch(() => {});
    const addServiceBtn = page.locator('button', { hasText: '+ Adaugă articol' }).first();
    const countBefore = await page.locator('[data-field-key="services"] .list-item, [data-field-key="services"] [class*="item"]').count().catch(() => 0);
    await addServiceBtn.click().catch(async () => { ev.defect('medium', 'Buton "+ Adaugă articol" nu a fost gasit pentru services', '', null); });
    await page.waitForTimeout(500);
    await ev.shot(page, 'add-service-item', { action: 'click "+ Adaugă articol" pentru services', detail: 'countBefore=' + countBefore });
    const newItemText = await page.evaluate(() => {
      const wrap = document.querySelector('[data-field-key="services"]');
      if (!wrap) return null;
      const inputs = wrap.querySelectorAll('input,textarea');
      return Array.from(inputs).map(i => i.value).join(' | ');
    });
    ev.note('Continut articol nou adaugat la services: ' + newItemText);
    if (newItemText === '' || newItemText === null) ev.defect('low', 'Articol nou la services pare gol', 'inputs value = "' + newItemText + '"', ev.log.entries.at(-1).screenshot);

    // Remove it
    const removeIcons = page.locator('[data-field-key="services"] [class*="remove"], [data-field-key="services"] button[aria-label*="terge" i], [data-field-key="services"] button[title*="terge" i]');
    const removeCount = await removeIcons.count();
    if (removeCount > 0) {
      await removeIcons.last().click();
      await page.waitForTimeout(300);
    }
    await ev.shot(page, 'remove-service-item', { action: 'sterge ultimul articol services', detail: 'removeButtonsFound=' + removeCount });

    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' }).catch(() => {});

    // ---------- 9. Publish flow ----------
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-modal-open', { action: 'click #btn-publish', detail: 'modal publicare deschis' });

    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await ev.shot(page, 'slug-accepted', { action: 'fill #input-slug + click continue', detail: 'slug=' + slug });

    await page.locator('#input-email').fill('qa-local-service@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await ev.shot(page, 'magic-link-sent', { action: 'fill email + send magic link', detail: 'dev-link vizibil' });

    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    const successTitleUnpaid = (await page.locator('#modal-success-title').textContent() || '').trim();
    await ev.shot(page, 'unpaid-draft-published', { action: 'click #dev-link', detail: 'titlu: ' + successTitleUnpaid });

    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: /live/i }).waitFor({ state: 'visible', timeout: 20000 });
    const successTitlePaid = (await page.locator('#modal-success-title').textContent() || '').trim();
    const successBodyText = await page.locator('#modal-success').innerText();
    await ev.shot(page, 'test-pay-success', { action: 'click #btn-pay-publish', detail: 'titlu: ' + successTitlePaid });
    ev.note('Text modal succes: ' + successBodyText.replace(/\n+/g, ' | '));
    if (!/99/.test(successBodyText) ) ev.note('ATENTIE: pretul 99 nu apare textual in modalul de succes (verifica manual copy-ul preturilor).');

    liveUrl = await page.locator('#success-url-link').getAttribute('href');
    ev.note('URL live: ' + liveUrl);

    // "Trimite pe WhatsApp" button in the success modal (share the freshly published site link).
    const shareWaVisible = await page.locator('#btn-share-wa').isVisible().catch(() => false);
    ev.note('#btn-share-wa vizibil in modalul de succes: ' + shareWaVisible);
    if (shareWaVisible) {
      const shareWaHref = await page.locator('#btn-share-wa').evaluate(el => el.getAttribute('href') || el.dataset.href || null).catch(() => null);
      await ev.shot(page, 'success-modal-share-whatsapp', { action: 'inspect #btn-share-wa in modal-success', detail: 'href/data=' + shareWaHref });
    } else {
      ev.defect('low', '#btn-share-wa nu e vizibil in modalul de succes dupa plata de test', '', ev.log.entries.at(-1)?.screenshot);
    }

    // ---------- 10. Site live ----------
    const livePageP = b.context.waitForEvent('page');
    await page.locator('#success-url-link').click();
    const livePage = await livePageP;
    await livePage.waitForLoadState('networkidle');
    await ev.shot(livePage, 'live-site-desktop', { action: 'open live URL (desktop 1440)', fullPage: false, detail: liveUrl });
    await ev.shot(livePage, 'live-site-desktop-fullpage', { action: 'fullPage screenshot live desktop', fullPage: true, detail: liveUrl });

    const liveConsoleErrors = [];
    livePage.on('console', m => { if (m.type() === 'error') liveConsoleErrors.push(m.text()); });
    const liveFailedReq = [];
    livePage.on('response', r => { if (r.status() >= 400) liveFailedReq.push(r.status() + ' ' + r.url()); });

    const liveHtml = await livePage.content();
    const checks = {
      businessNamePresent: liveHtml.includes(BUSINESS_NAME),
      langRo: /<html[^>]*lang="ro"/i.test(liveHtml),
      attributionPresent: /hidook\.tech/i.test(liveHtml) && /hidook\.agency/i.test(liveHtml),
      jsonLdPresent: /<script[^>]*type="application\/ld\+json"/i.test(liveHtml),
      ogImagePresent: /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.test(liveHtml),
    };
    const ogImageMatch = liveHtml.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    fs.writeFileSync(path.join(EVID, 'live-html-checks.json'), JSON.stringify({ liveUrl, checks, ogImage: ogImageMatch ? ogImageMatch[1] : null }, null, 2));
    ev.note('Verificari HTML live: ' + JSON.stringify(checks));
    if (!checks.businessNamePresent) ev.defect('critical', 'Numele afacerii editat nu apare pe site-ul live', '', ev.log.entries.at(-1).screenshot);
    if (!checks.langRo) ev.defect('medium', 'lang="ro" lipseste din <html> pe site-ul live', '', ev.log.entries.at(-1).screenshot);
    if (!checks.attributionPresent) ev.defect('high', 'Atribuirea "Build by hidook.tech powered by hidook.agency" lipseste din footer', '', ev.log.entries.at(-1).screenshot);
    if (!checks.jsonLdPresent) ev.defect('medium', 'JSON-LD lipseste din pagina live', '', ev.log.entries.at(-1).screenshot);
    if (!checks.ogImagePresent) ev.defect('medium', 'meta og:image lipseste din pagina live', '', ev.log.entries.at(-1).screenshot);

    if (ogImageMatch) {
      const ogAbsUrl = new URL(ogImageMatch[1], liveHtmlBaseUrl(livePage.url())).href;
      const ogResp = await b.context.request.get(ogAbsUrl).catch(e => ({ status: () => 'ERR:' + e.message }));
      ev.note('og:image (' + ogAbsUrl + ') status: ' + (typeof ogResp.status === 'function' ? ogResp.status() : ogResp.status));
      if (typeof ogResp.status === 'function' && ogResp.status() !== 200) ev.defect('medium', 'og:image nu raspunde 200', 'status=' + ogResp.status() + ' url=' + ogAbsUrl, null);
    }

    // Images all loaded — exclude deliberately-empty modal placeholders (lightbox/QR <img>
    // that only get a src once the user opens that modal) which are legitimately unloaded on page load.
    const imgCheck = await livePage.evaluate(() => Array.from(document.images).map(i => ({
      id: i.id || null, src: i.currentSrc || i.src, hasSrcAttr: i.hasAttribute('src') && i.getAttribute('src') !== '',
      ok: i.naturalWidth > 0, insideHiddenModal: !!i.closest('[hidden]')
    })));
    const brokenImgs = imgCheck.filter(i => !i.ok && i.hasSrcAttr && !i.insideHiddenModal);
    fs.writeFileSync(path.join(EVID, 'live-image-check.json'), JSON.stringify(imgCheck, null, 2));
    if (brokenImgs.length) ev.defect('high', brokenImgs.length + ' imagini nu s-au incarcat pe site-ul live', JSON.stringify(brokenImgs.slice(0,5)), ev.log.entries.at(-1).screenshot);
    ev.note('Imagini placeholder de modal excluse din verificare (lightbox/QR, src gol pana la deschidere): ' + imgCheck.filter(i => !i.hasSrcAttr).map(i => i.id).join(', '));

    // Factory text check
    const factoryPatterns = [/lorem ipsum/i, /\bTODO\b/, /undefined/i, /\[object Object\]/, /desserdirina/i];
    const factoryHits = factoryPatterns.filter(p => p.test(liveHtml));
    if (factoryHits.length) ev.defect('high', 'Text "factory" gasit pe site-ul live', factoryHits.map(String).join(', '), ev.log.entries.at(-1).screenshot);

    // legal pages
    for (const [label, hrefPattern] of [['Privacy', /privacy/i], ['Cookies', /cookies/i], ['Terms', /terms/i]]) {
      const link = livePage.locator('a[href*="' + label.toLowerCase() + '"]').first();
      const exists = await link.count();
      if (!exists) { ev.defect('medium', 'Link legal "' + label + '" nu a fost gasit in footer', '', null); continue; }
      const href = await link.getAttribute('href');
      const resp = await b.context.request.get(new URL(href, livePage.url()).href);
      ev.note('Legal ' + label + ' href=' + href + ' status=' + resp.status());
      if (resp.status() !== 200) ev.defect('high', 'Pagina legala ' + label + ' nu raspunde 200', 'status=' + resp.status() + ' href=' + href, null);
    }

    // Mobile live
    const bMobile = await newBrowser({ width: 390, height: 844 });
    await bMobile.page.goto(liveUrl, { waitUntil: 'networkidle' });
    await ev.shot(bMobile.page, 'live-site-mobile-390', { action: 'open live URL la 390px', detail: liveUrl });
    await ev.shot(bMobile.page, 'live-site-mobile-390-fullpage', { action: 'fullPage screenshot live mobil', fullPage: true, detail: liveUrl });
    const mobileLiveOverflow = await bMobile.page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
    ev.note('Overflow orizontal site LIVE mobil: ' + mobileLiveOverflow);
    if (mobileLiveOverflow > 2) ev.defect('high', 'Overflow orizontal pe site-ul LIVE la 390px', 'scrollWidth-clientWidth=' + mobileLiveOverflow, ev.log.entries.at(-1).screenshot);
    ev.note('Console errors (live mobil): ' + JSON.stringify(bMobile.consoleErrors));
    ev.note('Failed requests (live mobil): ' + JSON.stringify(bMobile.failedRequests));
    if (bMobile.consoleErrors.length) ev.defect('medium', 'Console errors pe site-ul live (mobil)', JSON.stringify(bMobile.consoleErrors).slice(0,500), ev.log.entries.at(-1).screenshot);
    if (bMobile.failedRequests.length) ev.defect('medium', 'Request-uri 4xx/5xx pe site-ul live (mobil)', JSON.stringify(bMobile.failedRequests).slice(0,500), ev.log.entries.at(-1).screenshot);
    await bMobile.close();

    ev.note('Console errors (live desktop, colectate dupa incarcare): ' + JSON.stringify(liveConsoleErrors));
    ev.note('Failed requests (live desktop): ' + JSON.stringify(liveFailedReq));
    if (liveConsoleErrors.length) ev.defect('medium', 'Console errors pe site-ul live (desktop)', JSON.stringify(liveConsoleErrors).slice(0,500), null);
    if (liveFailedReq.length) ev.defect('medium', 'Request-uri 4xx/5xx pe site-ul live (desktop)', JSON.stringify(liveFailedReq).slice(0,500), null);

    // ---------- 12. Interactiuni pe site live ----------
    // Lightbox gallery
    const galleryThumb = livePage.locator('[id*="lightbox"] , .ls-block img, [class*="gallery"] img, [class*="category"] img').first();
    const galleryImgs = livePage.locator('section img').first();
    try {
      await galleryImgs.scrollIntoViewIfNeeded({ timeout: 3000 });
      await galleryImgs.click({ timeout: 3000 });
      await livePage.waitForTimeout(400);
      await ev.shot(livePage, 'live-lightbox-open', { action: 'click pe o poza din galerie', detail: 'incercare deschidere lightbox' });
      const lightboxVisible = await livePage.locator('#lightbox').evaluate(el => !el.hidden).catch(() => false);
      ev.note('Lightbox vizibil dupa click: ' + lightboxVisible);
      if (!lightboxVisible) ev.defect('medium', 'Click pe poza din galerie nu deschide lightbox-ul', '#lightbox ramane hidden', ev.log.entries.at(-1).screenshot);
      await livePage.locator('#lightbox-close').click({ timeout: 2000 }).catch(() => {});
    } catch (e) {
      ev.note('Nu am putut testa galeria/lightbox: ' + e.message);
    }

    // CTA / scroll anchors
    try {
      const ctaLink = livePage.locator('a[href^="#"]').first();
      const href = await ctaLink.getAttribute('href');
      await ctaLink.click({ timeout: 2000 });
      await livePage.waitForTimeout(300);
      await ev.shot(livePage, 'live-cta-scroll-anchor', { action: 'click primul link ancora (' + href + ')', detail: 'scroll test' });
    } catch (e) { ev.note('Nu am putut testa ancora CTA: ' + e.message); }

    // Sticky WA/call dock at mobile
    await livePage.setViewportSize({ width: 390, height: 844 });
    await livePage.waitForTimeout(300);
    await ev.shot(livePage, 'live-dock-mobile', { action: 'resize to 390 pentru bara sticky call/WA', detail: 'ls-dock' });
    await livePage.setViewportSize({ width: 1440, height: 1000 });

    // Return editor tab to a clean state (close the still-open success modal) before
    // driving the topbar export buttons, which sit underneath the modal overlay.
    await page.locator('#btn-success-close').click().catch(() => {});
    await page.locator('#modal-success').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

    // ---------- 11. Export HTML / ZIP ----------
    const dlDir = path.join(EVID, 'downloads');
    fs.mkdirSync(dlDir, { recursive: true });
    const [dl1] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-download-html').click(),
    ]);
    const htmlPath = path.join(dlDir, 'export.html');
    await dl1.saveAs(htmlPath);
    await ev.shot(page, 'export-html-triggered', { action: 'click #btn-download-html', detail: 'salvat in ' + htmlPath + ' (' + fs.statSync(htmlPath).size + ' bytes)' });

    const [dl2] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-download-zip').click(),
    ]);
    const zipPath = path.join(dlDir, 'export.zip');
    await dl2.saveAs(zipPath);
    await ev.shot(page, 'export-zip-triggered', { action: 'click #btn-download-zip', detail: 'salvat in ' + zipPath + ' (' + fs.statSync(zipPath).size + ' bytes)' });

    // Unzip and inspect
    const unzipDir = path.join(dlDir, 'unzipped');
    fs.mkdirSync(unzipDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', zipPath, '-d', unzipDir], { stdio: 'pipe' });
      const zipList = execFileSync('find', [unzipDir, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n');
      fs.writeFileSync(path.join(EVID, 'zip-contents.txt'), zipList.join('\n'));
      ev.note('ZIP contine ' + zipList.length + ' fisiere. Vezi zip-contents.txt');
      const hasIndex = zipList.some(f => f.endsWith('/index.html') || f.endsWith('index.html'));
      const hasLegal = zipList.some(f => /privacy|terms|cookies/i.test(f));
      if (!hasIndex) ev.defect('high', 'ZIP exportat nu contine index.html', zipList.slice(0,10).join(', '), ev.log.entries.at(-1).screenshot);
      if (!hasLegal) ev.defect('medium', 'ZIP exportat nu pare sa contina paginile legale', zipList.slice(0,10).join(', '), ev.log.entries.at(-1).screenshot);

      // Serve unzipped statically on ephemeral port
      const staticServer = http.createServer((req, res) => {
        let fp = path.join(unzipDir, decodeURIComponent(req.url.split('?')[0]));
        if (fp.endsWith('/')) fp = path.join(fp, 'index.html');
        fs.readFile(fp, (err, data) => {
          if (err) {
            // try nested single-dir
            res.writeHead(404); res.end('not found: ' + req.url); return;
          }
          const ext = path.extname(fp);
          const type = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml' }[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': type });
          res.end(data);
        });
      });
      // find actual index.html location (may be nested)
      let indexRel = zipList.find(f => f.endsWith('index.html'));
      let staticRoot = unzipDir;
      if (indexRel) staticRoot = path.dirname(indexRel);
      await new Promise(res => staticServer.listen(0, res));
      const staticPort = staticServer.address().port;
      const staticServer2Root = staticRoot; // capture
      staticServer.close();
      // Recreate server rooted correctly
      const staticServer2 = http.createServer((req, res) => {
        let fp = path.join(staticServer2Root, decodeURIComponent(req.url.split('?')[0]));
        if (fp.endsWith('/') || fs.existsSync(fp) === false) {
          if (fs.existsSync(path.join(staticServer2Root, 'index.html')) && (req.url === '/' )) fp = path.join(staticServer2Root, 'index.html');
        }
        fs.readFile(fp, (err, data) => {
          if (err) { res.writeHead(404); res.end('not found'); return; }
          const ext = path.extname(fp);
          const type = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml' }[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': type });
          res.end(data);
        });
      });
      await new Promise(res => staticServer2.listen(0, res));
      const port2 = staticServer2.address().port;
      const bZip = await newBrowser({ width: 1440, height: 1000 });
      await bZip.page.goto('http://127.0.0.1:' + port2 + '/', { waitUntil: 'networkidle' }).catch(e => ev.note('Eroare la incarcarea ZIP static: ' + e.message));
      await ev.shot(bZip.page, 'zip-standalone-served', { action: 'servit ZIP static local si deschis', detail: 'root=' + staticServer2Root + ' port=' + port2 });
      await bZip.close();
      staticServer2.close();
    } catch (e) {
      ev.note('Eroare la dezarhivare/verificare ZIP: ' + e.message);
      ev.defect('medium', 'Nu am putut dezarhiva/verifica standalone ZIP-ul exportat', e.message, null);
    }

    await livePage.close();
  } catch (err) {
    ev.note('EROARE FATALA in timpul walk-ului: ' + err.stack);
    try { await ev.shot(page, 'fatal-error-state', { action: 'screenshot dupa eroare', detail: err.message }); } catch {}
    ev.defect('critical', 'Walk-ul E2E a esuat neasteptat', err.message, ev.log.entries.at(-1)?.screenshot);
  } finally {
    ev.finish();
    await b.close();
    await srv.close();
  }
}

function liveHtmlBaseUrl(u) { return u.endsWith('/') ? u : u + '/'; }

function hexToRgbString(hex) {
  const m = hex.replace('#','').match(/.{1,2}/g).map(h => parseInt(h,16));
  return 'rgb(' + m.join(', ') + ')';
}

main();
