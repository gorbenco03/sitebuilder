#!/usr/bin/env node
// E2E walk of the "desserdirina" template, as a skeptical foreign client.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { bootServer, makeEvidence, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/template-desserdirina';
const ev = makeEvidence(EVDIR, 'template-desserdirina');
const TPL = 'desserdirina';
const BIZNAME = 'Șt. Țăndărică & Fiii';
const HERO_PHOTO = path.join(ROOT, 'templates/product-menu/images/cn-hero.jpg');
const ACCENT = '#1D5B79';
const BG = '#E7F1F7';
const WA_NUMBER = '40745123456';
const WA_MESSAGE = 'Bună! Aș vrea să comand un tort pentru ziua mea de naștere — mulțumesc!';

function frame(page) { return page.frameLocator('#preview-iframe'); }

async function main() {
  const srv = await bootServer();
  ev.note('server booted at ' + srv.base);
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;

  try {
    // 1. open /app/, accept cookie, pick template, measure iframe-ready time
    await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
    const cookieBtn = page.locator('#hb-cookie-accept');
    await cookieBtn.waitFor({ state: 'visible' });
    await cookieBtn.click();
    await ev.shot(page, 'accept-cookie', { action: 'click #hb-cookie-accept', detail: 'cookie banner accepted on catalog' });

    const t0 = Date.now();
    await page.locator(`.template-card[data-template-id="${TPL}"] .btn-start-tpl`).click();
    await page.waitForURL(/#edit$/);
    // NOTE: #preview-iframe is sandboxed WITHOUT allow-same-origin, so contentDocument access
    // from the top page is null; use Playwright's frameLocator (works via CDP regardless of sandboxing).
    await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first().waitFor({ state: 'visible', timeout: 20000 });
    const iframeReadyMs = Date.now() - t0;
    ev.note('time from template click to iframe body content ready: ' + iframeReadyMs + ' ms');
    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 5000 }).catch(() => ev.defect('high', 'Details drawer nu se deschide automat', 'după selectarea șablonului desserdirina, #details-drawer nu a devenit vizibil automat', null));
    await page.waitForTimeout(300);
    await ev.shot(page, 'editor-open-with-drawer', { action: 'goto /app/ -> click template card', detail: `editor deschis, iframe ready in ${iframeReadyMs}ms, drawer auto-open verificat` });

    // 2. inventory drawer fields
    const fieldInfo = await page.evaluate(() => {
      const body = document.getElementById('drawer-body');
      if (!body) return null;
      const out = [];
      body.querySelectorAll('[data-field-key], input, textarea, select').forEach(el => {
        const wrap = el.closest('[data-field-key]');
        const key = wrap ? wrap.getAttribute('data-field-key') : el.id || null;
        let label = '';
        const labelEl = wrap ? wrap.querySelector('label, .field-label, .drawer-field-label') : null;
        if (labelEl) label = labelEl.textContent.trim();
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          out.push({ key, label, tag: el.tagName, type: el.type || null, value: (el.value || '').slice(0, 80), placeholder: el.placeholder || null });
        }
      });
      const sectionTitles = Array.from(body.querySelectorAll('.drawer-section-title')).map(x => x.textContent.trim());
      return { fields: out, sectionTitles };
    });
    fs.writeFileSync(path.join(EVDIR, 'drawer-field-inventory.json'), JSON.stringify(fieldInfo, null, 2));
    ev.note('drawer field inventory written to drawer-field-inventory.json: ' + (fieldInfo ? fieldInfo.fields.length : 0) + ' fields, sections: ' + JSON.stringify(fieldInfo?.sectionTitles));
    await ev.shot(page, 'drawer-inventory-fullpage', { action: 'inspect #drawer-body', fullPage: true, detail: 'inventar câmpuri drawer (vezi drawer-field-inventory.json)' });

    // check RO diacritics / jargon heuristically
    if (fieldInfo) {
      const nonRoLabels = fieldInfo.fields.filter(f => f.label && /^[A-Za-z0-9 ,.'"()\/-]+$/.test(f.label) && /\b(URL|API|JSON|slug|meta|SEO)\b/i.test(f.label));
      ev.note('labels containing possible dev jargon: ' + JSON.stringify(nonRoLabels.map(f => f.label)));
    }

    // 3. inline text edit business.name
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    const nameEl = frame(page).locator('[data-hb-edit="business.name"]').first();
    await nameEl.click();
    await nameEl.fill(BIZNAME);
    await nameEl.blur();
    await page.waitForTimeout(300);
    const iframeText = await nameEl.textContent();
    await ev.shot(page, 'inline-edit-business-name', { action: 'click+fill+blur [data-hb-edit="business.name"]', detail: 'text iframe: ' + iframeText });
    if ((iframeText || '').trim() !== BIZNAME) ev.defect('high', 'Numele editat nu apare identic în iframe', 'expected="' + BIZNAME + '" got="' + iframeText + '"', null);

    // NOTE: business.name is type "text" -> NOT one of DRAWER_TYPES (phone/url/color/background) and
    // matches no DRAWER_KEYS_PARTIAL entry, so by design (builder/app.js isDrawerField) it has no drawer
    // field at all — it is inline-canvas-only. We instead confirm the cascade: editing business.name inline
    // should cascade into fields that DO live in the drawer (contact.instagram.url/label etc, per
    // cascadeBusinessNameIdentity in app.js) — reopen the drawer and read one such cascaded field.
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const hasNameDrawerField = await page.locator('[data-field-key="business.name"]').count();
    ev.note('confirmare: business.name are camp in drawer? ' + (hasNameDrawerField > 0) + ' (asteptat: false, e doar inline pe canvas)');
    await ev.shot(page, 'drawer-synced-business-name', { action: 'reopen drawer after inline business.name edit', detail: 'drawer nu are camp separat pentru business.name (by design; text editabil doar inline)' });

    // 4. hero photo
    const heroBgBefore = await frame(page).locator('.hero-background').first().evaluate(el => getComputedStyle(el).backgroundImage);
    ev.note('hero background computed style BEFORE upload: ' + heroBgBefore.slice(0, 140));
    const heroBtn = page.locator('[data-field-key="hero.background"] button').first();
    const chooserPromise = page.waitForEvent('filechooser');
    await heroBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(HERO_PHOTO);
    await page.locator('#dr_hero_background_img').waitFor({ state: 'visible' }).catch(() => {});
    // Poll (up to 8s) for the iframe's computed hero background to actually change bytes/URL,
    // since the default preset already ships a hero photo (label stays "Poză adăugată" either way).
    let heroBg = heroBgBefore;
    for (let i = 0; i < 20; i++) {
      heroBg = await frame(page).locator('.hero-background').first().evaluate(el => getComputedStyle(el).backgroundImage);
      // "none" is a transient mid-rerender state (iframe srcdoc swap) — keep polling past it.
      if (heroBg !== heroBgBefore && /url\(/.test(heroBg)) break;
      await page.waitForTimeout(400);
    }
    await ev.shot(page, 'drawer-hero-photo-set', { action: 'click hero.background button + setInputFiles', detail: 'uploaded ' + HERO_PHOTO });
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    ev.note('hero background computed style AFTER upload: ' + heroBg.slice(0, 140));
    if (heroBg === heroBgBefore) ev.defect('high', 'Poza hero nu s-a schimbat dupa upload', 'computed background-image identic inainte/dupa: ' + heroBg, null);
    else if (!/url\(/.test(heroBg)) ev.defect('medium', 'Poza hero s-a schimbat dar formatul computed neasteptat', 'background-image=' + heroBg, null);
    await ev.shot(page, 'hero-photo-applied-iframe', { action: 'read computed hero background-image in iframe', detail: heroBg.slice(0, 80) });

    // 5. colors — .hero-cta uses `background: linear-gradient(...)` (backgroundImage), not backgroundColor.
    function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return `${(n>>16)&255}, ${(n>>8)&255}, ${n&255}`; }
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'visible' });
    const beforeCta = await frame(page).locator('.hero-cta').first().evaluate(el => getComputedStyle(el).backgroundImage);
    const beforeCream = await frame(page).locator('body').evaluate(() => getComputedStyle(document.body).backgroundColor);
    await ev.shot(page, 'colors-before', { action: 'open #btn-color-picker', detail: 'CTA gradient before: ' + beforeCta.slice(0, 100) });
    await page.locator('#color-custom-text').fill(ACCENT);
    await page.locator('#color-bg-text').fill(BG);
    await page.locator('#color-custom-text').press('Tab');
    // poll instead of a fixed sleep — fullRerender() is async
    let afterCta = beforeCta;
    for (let i = 0; i < 12; i++) {
      afterCta = await frame(page).locator('.hero-cta').first().evaluate(el => getComputedStyle(el).backgroundImage);
      if (afterCta !== beforeCta) break;
      await page.waitForTimeout(300);
    }
    ev.note('CTA gradient after color change: ' + afterCta.slice(0, 140));
    await ev.shot(page, 'colors-after', { action: 'fill #color-custom-text=' + ACCENT + ', #color-bg-text=' + BG, detail: 'CTA gradient after: ' + afterCta.slice(0, 100) });
    if (afterCta === beforeCta) ev.defect('high', 'Culoarea aleasă nu se reflectă în pixeli (CTA gradient neschimbat)', 'before=' + beforeCta + ' after=' + afterCta, null);
    else if (!afterCta.includes(hexToRgb(ACCENT))) ev.defect('medium', 'Gradientul CTA s-a schimbat dar nu conține rgb-ul exact al culorii alese', 'expected rgb(' + hexToRgb(ACCENT) + ') in ' + afterCta, null);
    const afterCream = await frame(page).locator('body').evaluate(() => getComputedStyle(document.body).backgroundColor);
    ev.note('body background-color before=' + beforeCream + ' after=' + afterCream + ' expected rgb(' + hexToRgb(BG) + ')');
    if (afterCream === beforeCream) ev.defect('high', 'Culoarea de fundal (crem) aleasă nu se reflectă in pixeli (body background-color neschimbat)', 'before=' + beforeCream + ' after=' + afterCream, null);
    else if (!afterCream.includes(hexToRgb(BG))) ev.defect('medium', 'body background-color s-a schimbat dar nu la valoarea exactă aleasă', 'expected rgb(' + hexToRgb(BG) + ') got ' + afterCream, null);
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'hidden' }).catch(()=>{});

    // 6. WhatsApp
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    // scroll to contact section fields in drawer & fill
    const waNumInput = page.locator('[data-field-key="contact.whatsapp"] input, [data-field-key="contact.whatsapp"] textarea').first();
    await waNumInput.scrollIntoViewIfNeeded();
    await waNumInput.fill(WA_NUMBER);
    const waMsgInput = page.locator('[data-field-key="contact.waMessage"] textarea, [data-field-key="contact.waMessage"] input').first();
    await waMsgInput.fill(WA_MESSAGE);
    await waMsgInput.blur();
    await page.waitForTimeout(500);
    await ev.shot(page, 'whatsapp-drawer-filled', { action: 'fill contact.whatsapp + contact.waMessage in drawer', detail: 'nr=' + WA_NUMBER + ' msg=' + WA_MESSAGE });
    const waHref = await frame(page).locator('a.whatsapp-float').first().getAttribute('href').catch(() => null);
    ev.note('whatsapp-float href: ' + waHref);
    let waHrefOk = false;
    if (waHref) {
      try {
        const u = new URL(waHref);
        const txt = u.searchParams.get('text');
        waHrefOk = u.hostname.includes('wa.me') && u.pathname.includes(WA_NUMBER) && txt && txt.includes('tort');
        ev.note('decoded wa href text param: ' + txt);
      } catch (e) { ev.note('wa href parse error: ' + e.message); }
    }
    if (!waHrefOk) ev.defect('high', 'Linkul WhatsApp nu conține numărul/mesajul cu diacritice corect', 'href=' + waHref, null);
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    await ev.shot(page, 'whatsapp-badge-iframe', { action: 'read a.whatsapp-float href in iframe', detail: 'href=' + waHref });

    // NOTE: #btn-share-wa is the post-publish "Trimite pe WhatsApp" button inside #modal-success,
    // hidden (display:none) until the site is live — clicking it now would hang on actionability.
    // The real "panou QR WhatsApp" (#wa-qr) lives on the exported/live SITE (templates/desserdirina/script.js
    // initWhatsAppQR): on desktop it intercepts any a[href*="wa.me"] click and paints a QR instead of navigating.
    // We verify that flow later, on the live site itself (see step 12).
    ev.note('#btn-share-wa este ascuns in editor pana la publish (isLive=false); QR real e verificat pe site-ul live la pasul 12');

    // 7. mobile preview
    await page.locator('#btn-preview-mobile').click();
    await page.waitForTimeout(500);
    await ev.shot(page, 'mobile-preview-390', { action: 'click #btn-preview-mobile', detail: 'preview mobil in editor' });
    const overflowInfo = await frame(page).locator('body').evaluate(() => {
      const se = document.scrollingElement || document.documentElement;
      return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth };
    }).catch(() => null);
    ev.note('mobile overflow check (editor iframe): ' + JSON.stringify(overflowInfo));
    if (overflowInfo && overflowInfo.scrollWidth > overflowInfo.clientWidth + 2) {
      ev.defect('medium', 'Overflow orizontal in preview mobil (editor)', JSON.stringify(overflowInfo), null);
    }
    await page.locator('#btn-preview-desktop').click().catch(() => {});
    await page.waitForTimeout(300);

    // 8. add repeatable gallery category item
    // NOTE: .hb-add-btn is not unique — the page also has "+ Adaugă articol"/"+ Adaugă secțiune"
    // list-add buttons for the (hidden EN) bilingual menu lists. Scope to the gallery section.
    await frame(page).locator('.gallery-section .hb-add-btn').first().scrollIntoViewIfNeeded().catch(() => {});
    const addBtn = frame(page).locator('.gallery-section .hb-add-btn').first();
    const addBtnCount = await addBtn.count();
    if (addBtnCount) {
      const beforeCount = await frame(page).locator('.category-block').count();
      await addBtn.click();
      await page.waitForTimeout(500);
      const afterCount = await frame(page).locator('.category-block').count();
      const newTitle = await frame(page).locator('.category-block').last().locator('.category-title').textContent().catch(() => null);
      ev.note('gallery categories before=' + beforeCount + ' after=' + afterCount + ' newTitle="' + newTitle + '"');
      await ev.shot(page, 'gallery-category-added', { action: 'click .hb-add-btn (gallery.categories)', detail: 'before=' + beforeCount + ' after=' + afterCount + ' title=' + newTitle });
      if (!newTitle || !newTitle.trim() || /^(new|untitled)/i.test(newTitle.trim())) {
        ev.defect('medium', 'Elementul nou adaugat in galerie are text implicit non-RO / gol', 'title nou = "' + newTitle + '"', null);
      }
      // remove it (scope to the gallery section — see note above about ambiguous .hb-add-btn/.hb-remove-btn)
      const removeBtn = frame(page).locator('.gallery-section .hb-remove-btn').last();
      if (await removeBtn.count()) {
        await removeBtn.click();
        await page.waitForTimeout(500);
        const afterRemove = await frame(page).locator('.category-block').count();
        ev.note('gallery categories after remove=' + afterRemove);
        await ev.shot(page, 'gallery-category-removed', { action: 'click .hb-remove-btn', detail: 'count after remove=' + afterRemove });
      } else {
        ev.defect('low', 'Nu exista buton de stergere pentru elementul de galerie adaugat', '.hb-remove-btn count=0', null);
      }
    } else {
      ev.defect('medium', 'Nu exista control "+ Adauga" pentru galerie in iframe', '.hb-add-btn count=0', null);
      await ev.shot(page, 'gallery-add-missing', { action: 'look for .hb-add-btn', detail: 'not found' });
    }

    // 9. publish flow
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-modal-open', { action: 'click #btn-publish', detail: 'modal publish deschis' });
    const runSlug = 'audit-desserdirina-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(runSlug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-slug-continue', { action: 'fill #input-slug + click #btn-publish-continue', detail: 'slug=' + runSlug });
    await page.locator('#input-email').fill('audit-desserdirina@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await ev.shot(page, 'auth-magic-link-issued', { action: 'fill email + click #btn-send-magic', detail: 'dev-link vizibil' });
    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await ev.shot(page, 'auth-verified-unpaid', { action: 'click #dev-link', detail: 'modal success (neplatit) vizibil' });
    await page.locator('#btn-pay-publish').click();
    // NOTE: filtering on the substring "live" false-matches the still-unpaid title
    // "Adaugă un card ca să fii live" — use the exact paid-title phrase (as flow2-template-e2e.mjs does).
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
    const successTitle = await page.locator('#modal-success-title').textContent();
    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    ev.note('success title: "' + successTitle + '" liveHref=' + liveHref);
    await ev.shot(page, 'publish-success-live', { action: 'click #btn-pay-publish (test pay)', detail: 'title=' + successTitle + ' href=' + liveHref });
    // check copy pricing text on the page (footer/hero price on catalog is different, but check success modal + pricing route separately)

    // 10. open live site desktop + mobile
    const liveUrl = new URL(liveHref, srv.base).href;
    const live = await b.context.newPage();
    const liveErrors = [];
    live.on('pageerror', e => liveErrors.push('pageerror: ' + e.message));
    live.on('console', m => { if (m.type() === 'error') liveErrors.push('console: ' + m.text()); });
    const liveFailedReqs = [];
    live.on('response', r => { if (r.status() >= 400) liveFailedReqs.push(r.status() + ' ' + r.url()); });
    await live.setViewportSize({ width: 1440, height: 1000 });
    await live.goto(liveUrl, { waitUntil: 'networkidle' });
    await live.screenshot({ path: path.join(EVDIR, 'live-desktop-1440.png') });
    ev.log.entries.push({ index: ev.log.entries.length, step: 'live-site-desktop-1440', action: 'goto live url', selector: null, screenshot: 'live-desktop-1440.png', sha256: null, timestamp: new Date().toISOString(), url: liveUrl, contentCheck: { ok: true, detail: 'live site desktop viewport' } });
    fs.writeFileSync(path.join(EVDIR, 'oracle-log.json'), JSON.stringify(ev.log, null, 2));
    await live.screenshot({ path: path.join(EVDIR, 'live-desktop-1440-fullpage.png'), fullPage: true });

    const liveHtml = await live.content();
    const checks = {
      hasBizName: liveHtml.includes(BIZNAME),
      hasHidookAttribution: /Build by/.test(liveHtml) && /hidook\.tech/.test(liveHtml) && /hidook\.agency/.test(liveHtml),
      langRo: /<html[^>]*lang="ro"/.test(liveHtml),
      hasOgImage: /property="og:image"/.test(liveHtml),
      hasJsonLd: /application\/ld\+json/.test(liveHtml),
      hasFactoryText: /\bLorem ipsum\b|\bTODO\b|\bundefined\b|\[object Object\]|DESSERD(?!IRINA)/i.test(liveHtml),
    };
    ev.note('live HTML checks: ' + JSON.stringify(checks));
    if (!checks.hasBizName) ev.defect('critical', 'Numele editat lipseste din site-ul live', 'BIZNAME nu apare in HTML live', 'live-desktop-1440.png');
    if (!checks.hasHidookAttribution) ev.defect('high', 'Atribuirea Hidook lipseste din footer-ul site-ului live', 'grep Build by / hidook.tech / hidook.agency a esuat', 'live-desktop-1440.png');
    if (!checks.langRo) ev.defect('medium', 'lang atribut nu este "ro"', 'html lang!=ro', null);
    if (checks.hasFactoryText) ev.defect('high', 'Text de tip "factory" gasit in HTML live', JSON.stringify(checks), 'live-desktop-1440.png');

    // legal pages
    for (const p of ['privacy.html', 'terms.html', 'cookies.html']) {
      const url = new URL(p, liveUrl).href;
      const resp = await live.request.get(url);
      ev.note('legal page ' + p + ' -> status ' + resp.status());
      if (resp.status() !== 200) ev.defect('high', 'Pagina legala ' + p + ' nu raspunde 200', 'status=' + resp.status() + ' url=' + url, null);
    }

    // og:image fetch
    const ogMatch = liveHtml.match(/property="og:image" content="([^"]+)"/);
    if (ogMatch) {
      const ogUrl = new URL(ogMatch[1], liveUrl).href;
      const ogResp = await live.request.get(ogUrl);
      ev.note('og:image ' + ogUrl + ' -> status ' + ogResp.status());
      if (ogResp.status() !== 200) ev.defect('medium', 'og:image nu raspunde 200', 'status=' + ogResp.status() + ' url=' + ogUrl, null);
    } else {
      ev.defect('medium', 'og:image meta tag lipseste din site live', 'nu s-a gasit property="og:image" cu content in HTML', null);
    }

    // images loaded check
    const imgCheck = await live.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.map(i => ({ src: i.currentSrc || i.src, naturalWidth: i.naturalWidth, alt: i.alt }));
    });
    const brokenImgs = imgCheck.filter(i => i.naturalWidth === 0);
    ev.note('images total=' + imgCheck.length + ' broken(naturalWidth=0)=' + brokenImgs.length + ' -> ' + JSON.stringify(brokenImgs.slice(0, 5)));
    if (brokenImgs.length) ev.defect('high', 'Imagini rupte (naturalWidth=0) pe site-ul live', JSON.stringify(brokenImgs), null);

    ev.note('live console errors: ' + JSON.stringify(liveErrors));
    ev.note('live failed requests (>=400): ' + JSON.stringify(liveFailedReqs));
    if (liveErrors.length) ev.defect('medium', 'Erori consola JS pe site-ul live', JSON.stringify(liveErrors), null);
    if (liveFailedReqs.length) ev.defect('high', 'Request-uri 4xx/5xx pe site-ul live', JSON.stringify(liveFailedReqs), null);

    // mobile live
    await live.setViewportSize({ width: 390, height: 844 });
    await live.reload({ waitUntil: 'networkidle' });
    await live.screenshot({ path: path.join(EVDIR, 'live-mobile-390.png') });
    ev.log.entries.push({ index: ev.log.entries.length, step: 'live-site-mobile-390', action: 'resize+reload', selector: null, screenshot: 'live-mobile-390.png', sha256: null, timestamp: new Date().toISOString(), url: liveUrl, contentCheck: { ok: true, detail: 'live site mobile viewport' } });
    fs.writeFileSync(path.join(EVDIR, 'oracle-log.json'), JSON.stringify(ev.log, null, 2));
    const mobileOverflow = await live.evaluate(() => {
      const se = document.scrollingElement;
      return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth };
    });
    ev.note('live mobile overflow: ' + JSON.stringify(mobileOverflow));
    if (mobileOverflow.scrollWidth > mobileOverflow.clientWidth + 2) ev.defect('high', 'Overflow orizontal pe site-ul LIVE la 390px', JSON.stringify(mobileOverflow), 'live-mobile-390.png');

    // 12. interactions on live site
    // WhatsApp float visible + href
    const waFloatHref = await live.locator('a.whatsapp-float').first().getAttribute('href').catch(() => null);
    ev.note('live wa float href (mobile view): ' + waFloatHref);
    await live.screenshot({ path: path.join(EVDIR, 'live-mobile-wafloat.png') });
    ev.log.entries.push({ index: ev.log.entries.length, step: 'live-wa-float-mobile', action: 'screenshot', selector: 'a.whatsapp-float', screenshot: 'live-mobile-wafloat.png', sha256: null, timestamp: new Date().toISOString(), url: liveUrl, contentCheck: { ok: !!waFloatHref, detail: 'href=' + waFloatHref } });
    fs.writeFileSync(path.join(EVDIR, 'oracle-log.json'), JSON.stringify(ev.log, null, 2));

    await live.setViewportSize({ width: 1440, height: 1000 });
    await live.reload({ waitUntil: 'networkidle' });
    // scroll indicator / CTA click -> scrolls to #order
    const cta = live.locator('.hero-cta').first();
    if (await cta.count()) {
      await cta.click();
      await live.waitForTimeout(500);
      const scrollY = await live.evaluate(() => window.scrollY);
      ev.note('scrollY after clicking hero CTA: ' + scrollY);
      await live.screenshot({ path: path.join(EVDIR, 'live-cta-scrolled.png') });
      ev.log.entries.push({ index: ev.log.entries.length, step: 'live-cta-scroll', action: 'click .hero-cta', selector: '.hero-cta', screenshot: 'live-cta-scrolled.png', sha256: null, timestamp: new Date().toISOString(), url: liveUrl, contentCheck: { ok: scrollY > 100, detail: 'scrollY=' + scrollY } });
      fs.writeFileSync(path.join(EVDIR, 'oracle-log.json'), JSON.stringify(ev.log, null, 2));
      if (scrollY < 100) ev.defect('medium', 'CTA hero nu deruleaza spre sectiunea de contact', 'scrollY=' + scrollY + ' dupa click .hero-cta (href=#order)', 'live-cta-scrolled.png');
    }

    // gallery lightbox
    await live.evaluate(() => window.scrollTo(0, document.querySelector('.gallery-section')?.offsetTop || 0));
    await live.waitForTimeout(400);
    const collagePhoto = live.locator('.collage-photo img').first();
    if (await collagePhoto.count()) {
      await collagePhoto.click({ force: true });
      await live.waitForTimeout(400);
      const lbVisible = await live.locator('.lightbox').first().evaluate(el => !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none').catch(() => false);
      ev.note('lightbox opened after clicking collage photo: ' + lbVisible);
      await live.screenshot({ path: path.join(EVDIR, 'live-lightbox.png') });
      ev.log.entries.push({ index: ev.log.entries.length, step: 'live-gallery-lightbox', action: 'click .collage-photo img', selector: '.collage-photo img', screenshot: 'live-lightbox.png', sha256: null, timestamp: new Date().toISOString(), url: liveUrl, contentCheck: { ok: lbVisible, detail: 'lightbox visible=' + lbVisible } });
      fs.writeFileSync(path.join(EVDIR, 'oracle-log.json'), JSON.stringify(ev.log, null, 2));
      if (!lbVisible) ev.defect('medium', 'Lightbox nu se deschide la click pe poza din galerie (poate fi coliziune cu drag-collage)', 'lbVisible=false', 'live-lightbox.png');
      const closeBtn = live.locator('.lightbox-close').first();
      if (await closeBtn.count()) await closeBtn.click().catch(() => {});
    } else {
      ev.note('nu exista .collage-photo img pe pagina live (galerie fara categorii/poze?)');
    }

    // live desktop WhatsApp QR panel (templates/desserdirina/script.js initWhatsAppQR():
    // on desktop UA, clicking any a[href*="wa.me"] should intercept and paint a QR instead of navigating)
    await live.evaluate(() => window.scrollTo(0, 0));
    const waLink = live.locator('a[href*="wa.me"]').first();
    if (await waLink.count()) {
      await waLink.scrollIntoViewIfNeeded();
      await waLink.click();
      await live.waitForTimeout(400);
      const qrInfo = await live.evaluate(() => {
        const modal = document.getElementById('wa-qr');
        const img = document.getElementById('wa-qr-img');
        if (!modal) return { hasModal: false };
        const style = getComputedStyle(modal);
        return {
          hasModal: true,
          hidden: modal.hidden,
          visible: !modal.hidden && style.display !== 'none',
          imgSrcLen: img ? (img.getAttribute('src') || '').length : 0,
          imgNaturalWidth: img ? img.naturalWidth : 0,
        };
      });
      ev.note('WA QR panel state after clicking wa.me link (desktop): ' + JSON.stringify(qrInfo));
      await live.screenshot({ path: path.join(EVDIR, 'live-whatsapp-qr-panel.png') });
      ev.log.entries.push({ index: ev.log.entries.length, step: 'live-whatsapp-qr-panel', action: 'click a[href*="wa.me"] (desktop, expect QR intercept)', selector: 'a[href*="wa.me"]', screenshot: 'live-whatsapp-qr-panel.png', sha256: null, timestamp: new Date().toISOString(), url: liveUrl, contentCheck: { ok: !!qrInfo.visible, detail: JSON.stringify(qrInfo) } });
      fs.writeFileSync(path.join(EVDIR, 'oracle-log.json'), JSON.stringify(ev.log, null, 2));
      if (!qrInfo.hasModal) ev.defect('high', 'Panoul QR WhatsApp (#wa-qr) lipsește din site-ul live', 'querySelector #wa-qr => null', 'live-whatsapp-qr-panel.png');
      else if (!qrInfo.visible) ev.defect('high', 'Click pe linkul WhatsApp pe desktop nu deschide panoul QR (navighează direct in schimb)', JSON.stringify(qrInfo), 'live-whatsapp-qr-panel.png');
      else if (!qrInfo.imgSrcLen) ev.defect('medium', 'Panoul QR se deschide dar imaginea QR e goală', JSON.stringify(qrInfo), 'live-whatsapp-qr-panel.png');
      const waCloseBtn = live.locator('[data-wa-close]').first();
      if (await waCloseBtn.count()) await waCloseBtn.click().catch(() => {});
    } else {
      ev.defect('high', 'Nu exista niciun link a[href*="wa.me"] pe site-ul live desi contact.whatsapp a fost completat', 'selector count=0', null);
    }

    // 11. export html + zip (still using original editor `page`, same authenticated context)
    await page.bringToFront();
    const dlDir = EVDIR;
    const htmlDlPromise = page.waitForEvent('download');
    await page.locator('#btn-download-html').click();
    const htmlDl = await htmlDlPromise;
    const htmlPath = path.join(dlDir, 'export.html');
    await htmlDl.saveAs(htmlPath);
    ev.note('export HTML saved to ' + htmlPath + ' size=' + fs.statSync(htmlPath).size + ' bytes, suggestedFilename=' + htmlDl.suggestedFilename());
    await ev.shot(page, 'export-html-downloaded', { action: 'click #btn-download-html', detail: 'fisier salvat: ' + htmlDl.suggestedFilename() });

    const zipDlPromise = page.waitForEvent('download');
    await page.locator('#btn-download-zip').click();
    const zipDl = await zipDlPromise;
    const zipPath = path.join(dlDir, 'export.zip');
    await zipDl.saveAs(zipPath);
    ev.note('export ZIP saved to ' + zipPath + ' size=' + fs.statSync(zipPath).size + ' bytes, suggestedFilename=' + zipDl.suggestedFilename());
    await ev.shot(page, 'export-zip-downloaded', { action: 'click #btn-download-zip', detail: 'fisier salvat: ' + zipDl.suggestedFilename() });

    // unzip and inspect
    const unzipDir = path.join(dlDir, 'export-zip-unpacked');
    fs.rmSync(unzipDir, { recursive: true, force: true });
    fs.mkdirSync(unzipDir, { recursive: true });
    try {
      execFileSync('unzip', ['-q', '-o', zipPath, '-d', unzipDir]);
      const files = fs.readdirSync(unzipDir);
      ev.note('ZIP unpacked, top-level entries: ' + JSON.stringify(files));
      const hasIndex = fs.existsSync(path.join(unzipDir, 'index.html'));
      const hasPrivacy = fs.existsSync(path.join(unzipDir, 'privacy.html'));
      const hasTerms = fs.existsSync(path.join(unzipDir, 'terms.html'));
      const hasCookies = fs.existsSync(path.join(unzipDir, 'cookies.html'));
      const hasImagesDir = fs.existsSync(path.join(unzipDir, 'images'));
      ev.note('ZIP contents check: index.html=' + hasIndex + ' privacy.html=' + hasPrivacy + ' terms.html=' + hasTerms + ' cookies.html=' + hasCookies + ' images/=' + hasImagesDir);
      if (!hasIndex) ev.defect('critical', 'ZIP exportat nu contine index.html', 'fisiere gasite: ' + JSON.stringify(files), null);
      if (!hasPrivacy || !hasTerms || !hasCookies) ev.defect('high', 'ZIP exportat nu contine toate paginile legale', 'privacy=' + hasPrivacy + ' terms=' + hasTerms + ' cookies=' + hasCookies, null);

      // serve statically on an ephemeral port and screenshot
      const mimeMap = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
      const staticServer = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const fp = path.join(unzipDir, p);
        if (!fp.startsWith(unzipDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(fp);
        res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
        fs.createReadStream(fp).pipe(res);
      });
      await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
      const staticPort = staticServer.address().port;
      const staticBase = 'http://127.0.0.1:' + staticPort;
      const zipPage = await b.context.newPage();
      await zipPage.goto(staticBase + '/', { waitUntil: 'networkidle' });
      await zipPage.screenshot({ path: path.join(EVDIR, 'export-zip-standalone-served.png') });
      ev.log.entries.push({ index: ev.log.entries.length, step: 'export-zip-standalone-served', action: 'serve unzipped export statically + goto', selector: null, screenshot: 'export-zip-standalone-served.png', sha256: null, timestamp: new Date().toISOString(), url: staticBase + '/', contentCheck: { ok: true, detail: 'zip export served standalone on ephemeral port ' + staticPort } });
      fs.writeFileSync(path.join(EVDIR, 'oracle-log.json'), JSON.stringify(ev.log, null, 2));
      const zipHtml = await zipPage.content();
      if (!zipHtml.includes(BIZNAME)) ev.defect('high', 'ZIP standalone servit nu contine numele editat', 'BIZNAME lipseste din index.html servit standalone', 'export-zip-standalone-served.png');
      await zipPage.close();
      await new Promise((resolve) => staticServer.close(resolve));
    } catch (unzipErr) {
      ev.defect('high', 'Nu s-a putut dezarhiva/verifica ZIP-ul exportat', String(unzipErr && unzipErr.message || unzipErr), null);
    }

    await b.close();
  } catch (err) {
    ev.defect('critical', 'Exceptie neasteptata in scriptul de audit', String(err && err.stack || err), null);
    console.error(err);
  } finally {
    ev.finish();
    await srv.close();
  }
}

main();
