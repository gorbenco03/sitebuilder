#!/usr/bin/env node
// Lens: template "Restaurant" (product-menu) — full E2E walk with screenshots.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bootServer, makeEvidence, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const execFileP = promisify(execFile);
const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/template-product-menu';
const ev = makeEvidence(DIR, 'template-product-menu');

const FACTORY_RES = [
  /\bLorem ipsum\b/i, /\bTODO\b/, /\bFIXME\b/, /\[object Object\]/, /\bundefined\b/,
  /\bDESSERD\b/, /\bNew section\b/i, /\bNew item\b/i, /\bBook now\b/i,
];

function scanFactory(text) {
  const hay = String(text || '');
  const hits = [];
  for (const re of FACTORY_RES) { const m = hay.match(re); if (m) hits.push(m[0]); }
  return hits;
}

async function main() {
  const srv = await bootServer();
  ev.note('server base=' + srv.base + ' dataDir=' + srv.dataDir);
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;
  const timings = {};

  try {
    // ---------- STEP 1: open /app/, accept cookie, start Restaurant template ----------
    await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-banner').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await ev.shot(page, 'catalog-cookie-banner', { action: 'goto /app/', detail: 'cookie banner state' });
    const cookieVisible = await page.locator('#hb-cookie-banner').isVisible().catch(() => false);
    if (cookieVisible) {
      await page.locator('#hb-cookie-accept').click();
      await page.locator('#hb-cookie-banner').waitFor({ state: 'hidden' }).catch(() => {});
    } else {
      ev.defect('high', 'Cookie banner nu a apărut pe /app/', 'banner lipsă la prima încărcare');
    }
    await ev.shot(page, 'catalog-cookie-accepted', { action: 'click', selector: '#hb-cookie-accept' });

    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').waitFor({ state: 'visible' });
    await ev.shot(page, 'catalog-before-start', { action: 'observe', selector: '.template-card[data-template-id="product-menu"]' });

    const t0 = Date.now();
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 25000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
    const previewFrame = page.frameLocator('#preview-iframe');
    {
      const deadline = Date.now() + 25000;
      let ready = false;
      while (Date.now() < deadline) {
        const len = await previewFrame.locator('body').innerText({ timeout: 1500 }).then(t => t.trim().length).catch(() => 0);
        if (len > 40) { ready = true; break; }
        await page.waitForTimeout(150);
      }
      if (!ready) ev.defect('high', 'Iframe-ul preview nu a atins conținut >40 caractere în 25s', '');
    }
    const loadMs = Date.now() - t0;
    timings.startToIframeContentMs = loadMs;
    ev.note('Timp de la click Start pana la continut vizibil in iframe: ' + loadMs + 'ms');
    await page.waitForTimeout(600);
    const drawerVisible1 = await page.locator('#details-drawer').isVisible().catch(() => false);
    await ev.shot(page, 'editor-drawer-autoopen', { action: 'click .btn-start-tpl', detail: 'drawerVisible=' + drawerVisible1 + ' loadMs=' + loadMs, fullPage: false, ok: drawerVisible1 });
    if (!drawerVisible1) ev.defect('critical', 'Details drawer nu se deschide automat', 'drawer hidden after Start pentru product-menu');

    // ---------- STEP 2: inventory drawer fields ----------
    await ev.shot(page, 'drawer-inventory-fullpage', { action: 'screenshot', selector: '#details-drawer', fullPage: true });
    const fieldInventory = await page.evaluate(() => {
      const body = document.getElementById('drawer-body');
      if (!body) return [];
      const groups = Array.from(body.querySelectorAll('.drawer-section'));
      const out = [];
      groups.forEach((g) => {
        const title = g.querySelector('.drawer-section-title')?.textContent?.trim() || '';
        g.querySelectorAll('.field-group').forEach((fg) => {
          const label = fg.querySelector('.field-label')?.textContent?.trim() || '';
          const input = fg.querySelector('input, textarea, select');
          out.push({
            section: title,
            label,
            tag: input ? input.tagName.toLowerCase() : null,
            type: input ? (input.type || null) : null,
            value: input ? (input.value || '').slice(0, 120) : null,
          });
        });
      });
      return out;
    });
    fs.writeFileSync(path.join(DIR, 'drawer-field-inventory.json'), JSON.stringify(fieldInventory, null, 2));
    ev.note('Drawer field inventory: ' + fieldInventory.length + ' câmpuri, salvat în drawer-field-inventory.json');
    const nonRoLabels = fieldInventory.filter(f => f.label && /^[A-Za-z0-9 .,'"()\-\/]+$/.test(f.label) && !/[ăâîșț]/i.test(f.label) && f.label.length > 3);
    ev.note('Câmpuri fără diacritice vizibile (posibil OK dacă englezești termeni tehnici sau scurte): ' + JSON.stringify(nonRoLabels.map(f => f.label)));

    // ---------- STEP 3: inline text edit business.name ----------
    // Close the auto-opened drawer first: its scrim (#drawer-overlay) intercepts pointer
    // events on the iframe underneath.
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
    const frame = previewFrame;
    const nameEl = frame.locator('[data-hb-edit="business.name"]').first();
    await nameEl.waitFor({ state: 'visible', timeout: 8000 });
    const before = await nameEl.innerText();
    await nameEl.click();
    await nameEl.evaluate((el) => {
      const doc = el.ownerDocument, win = doc.defaultView;
      const sel = win.getSelection(); sel.removeAllRanges();
      const r = doc.createRange(); r.selectNodeContents(el); sel.addRange(r);
    });
    const newName = 'Șt. Țăndărică & Fiii';
    await page.keyboard.type(newName);
    await nameEl.blur().catch(() => {});
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(700);
    const afterName = await nameEl.innerText();
    await ev.shot(page, 'inline-edit-business-name', { action: 'type diacritics into business.name', detail: 'before="' + before + '" after="' + afterName + '"', ok: afterName.includes('Țăndărică') });
    if (!afterName.includes('Țăndărică')) ev.defect('critical', 'Editarea inline a numelui nu a persistat diacriticele', 'after=' + afterName);
    // Note: business.name is type "text" with no dedicated drawer control by design
    // (DRAWER_TYPES = phone/url/color/background only) — it is edited inline-only in the
    // iframe. Interestingly the Instagram URL auto-derives from the business name; confirm
    // that side-effect instead of a (non-existent) #dr_business_name mirror field.
    await page.locator('#btn-open-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
    const drawerHasNameField = await page.locator('#dr_business_name').count();
    const igUrlAfterRename = await page.locator('#dr_instagram_url').inputValue().catch(() => null);
    await ev.shot(page, 'drawer-reflects-name', { action: 'reopen drawer', detail: 'dr_business_name count=' + drawerHasNameField + ' (expected 0, edited inline-only) | instagram.url auto-derived=' + igUrlAfterRename });
    ev.note('business.name nu are câmp dedicat în drawer (by design, se editează inline în iframe). Efect secundar observat: instagram.url s-a re-derivat automat din noul nume -> ' + igUrlAfterRename);

    // ---------- STEP 4: hero image via drawer picker ----------
    const heroWrap = page.locator('[data-field-key="hero.background"]');
    await heroWrap.waitFor({ state: 'visible', timeout: 8000 });
    const pickBtn = heroWrap.locator('button', { hasText: 'Alege o poză' });
    const beforeHeroBg = await frame.locator('.pm-hero__frame').first().evaluate(el => getComputedStyle(el).backgroundImage).catch(() => null);
    const fileChooserPromise = page.waitForEvent('filechooser');
    await pickBtn.click();
    const chooser = await fileChooserPromise;
    const picUrl = '/Users/Work/Desktop/sitebuilder/templates/product-menu/images/tv-hero.jpg';
    await chooser.setFiles(picUrl);
    await page.waitForTimeout(1200);
    const afterHeroBg = await frame.locator('.pm-hero__frame').first().evaluate(el => getComputedStyle(el).backgroundImage).catch(() => null);
    await ev.shot(page, 'hero-image-changed', { action: 'setFiles on hero.background picker', detail: 'before=' + beforeHeroBg + ' | after=' + afterHeroBg, ok: afterHeroBg !== beforeHeroBg && afterHeroBg && afterHeroBg !== 'none' });
    if (!afterHeroBg || afterHeroBg === beforeHeroBg || afterHeroBg === 'none') {
      ev.defect('high', 'Imaginea hero nu s-a schimbat vizual în iframe după upload din drawer', 'before=' + beforeHeroBg + ' after=' + afterHeroBg);
    }

    // ---------- STEP 5: colors ----------
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
    const ctaBefore = await frame.locator('.pm-hero__cta--fill').first().evaluate(el => getComputedStyle(el).backgroundColor).catch(() => null);
    await ev.shot(page, 'colors-before', { action: 'observe', detail: 'CTA bg before=' + ctaBefore });
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'visible', timeout: 5000 });
    await ev.shot(page, 'color-popover-open', { action: 'click', selector: '#btn-color-picker' });
    const accentHex = '#1D5B79';
    const bgHex = '#E7F1F7';
    await page.locator('#color-custom-text').fill(accentHex);
    await page.locator('#color-custom-text').press('Enter').catch(() => {});
    await page.locator('#color-bg-text').fill(bgHex);
    await page.locator('#color-bg-text').press('Enter').catch(() => {});
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    const ctaInfo = await frame.locator('.pm-hero__cta--fill').first().evaluate(el => ({
      cls: el.className, bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderColor, color: getComputedStyle(el).color,
    })).catch(() => null);
    const pillInfo = await frame.locator('.pm-mast__pill').first().evaluate(el => getComputedStyle(el).backgroundColor).catch(() => null);
    const bodyBgAfter = await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor).catch(() => null);
    await ev.shot(page, 'colors-after', { action: 'fill #color-custom-text/#color-bg-text', detail: 'hero CTA=' + JSON.stringify(ctaInfo) + ' | header pill bg=' + pillInfo + ' | bodyBg=' + bodyBgAfter, ok: ctaInfo && ctaInfo.bg !== ctaBefore });
    if (ctaInfo && ctaInfo.bg === 'rgba(0, 0, 0, 0)') {
      ev.defect('high', 'Butonul CTA principal din hero rămâne transparent la orice culoare de accent (bug CSS de specificitate)', 'Element are class="' + ctaInfo.cls + '". Regula .pm-hero__cta--fill{background:var(--cta)} (styles.css:120) e suprascrisă de .hero-cta{background:transparent} (styles.css:121) — ambele au specificitate egală (o singură clasă), iar .hero-cta e definită AL DOILEA în fișier, deci câștigă cascada. Rezultat: CTA "REZERVĂ O MASĂ" e mereu un buton transparent/outline identic vizual cu butonul secundar "MENIU", indiferent de culoarea de accent aleasă. Header pill (.pm-mast__pill) NU are acest bug și se colorează corect (bg=' + pillInfo + ') — deci userul vede culoarea funcționând în header dar nu în hero, o inconsistență direct vizibilă.');
    } else if (ctaInfo && ctaInfo.bg === ctaBefore) {
      ev.defect('high', 'Schimbarea culorii accent nu se reflectă pe butonul CTA din iframe', 'ctaBefore=' + ctaBefore + ' ctaAfter=' + ctaInfo.bg);
    }

    // ---------- STEP 6: WhatsApp ----------
    await page.locator('#btn-open-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
    const waPhoneInput = page.locator('#dr_contact_whatsapp');
    const waMsgInput = page.locator('#dr_contact_waMessage');
    const waNumber = '40721234567';
    const waMsg = 'Bună! Aș dori să rezerv o masă pentru diseară, mulțumesc frumos!';
    if (await waPhoneInput.count()) {
      await waPhoneInput.fill(waNumber);
      await waPhoneInput.blur();
    } else {
      ev.defect('high', 'Câmp WhatsApp lipsă în drawer', 'nu am găsit #dr_contact_whatsapp');
    }
    if (await waMsgInput.count()) {
      await waMsgInput.fill(waMsg);
      await waMsgInput.blur();
    }
    await page.waitForTimeout(800);
    await ev.shot(page, 'whatsapp-drawer-filled', { action: 'fill contact.whatsapp + waMessage', detail: 'number=' + waNumber });
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(400);
    const waHref = await frame.locator('a[href*="wa.me"]').first().getAttribute('href').catch(() => null);
    await ev.shot(page, 'whatsapp-badge-href', { action: 'inspect', detail: 'href=' + waHref, ok: !!waHref && waHref.includes(waNumber) });
    if (!waHref || !waHref.includes(waNumber)) {
      ev.defect('critical', 'Badge WhatsApp nu conține numărul introdus', 'href=' + waHref);
    } else {
      const decoded = decodeURIComponent(waHref.split('text=')[1] || '');
      if (!decoded.includes('rezerv')) ev.defect('medium', 'Mesajul WhatsApp cu diacritice pare trunchiat/alterat în href', 'decoded=' + decoded);
    }
    // NOTE: #btn-share-wa is the editor-topbar "share the finished site" button — it only
    // becomes visible on the post-publish success modal (isLive gate in app.js), so it is not
    // reachable here. The actual QR fallback lives in the template's own script.js
    // (initWhatsAppQR): on desktop UA it intercepts clicks on any a[href*="wa.me"] inside the
    // rendered site and shows a #wa-qr modal instead of navigating away. Exercise that instead.
    const waFloatLink = frame.locator('a.whatsapp-float, a[href*="wa.me"]').first();
    await waFloatLink.click().catch((e) => ev.defect('high', 'Linkul WhatsApp din site nu răspunde la click', String(e)));
    await page.waitForTimeout(500);
    await ev.shot(page, 'whatsapp-qr-panel', { action: 'click a[href*="wa.me"] (whatsapp-float)', selector: 'a.whatsapp-float' });
    const qrBox = await frame.locator('#wa-qr, .wa-qr').first().boundingBox().catch(() => null);
    const qrImgBox = await frame.locator('#wa-qr-img, .wa-qr__code img').first().boundingBox().catch(() => null);
    if (qrBox && qrImgBox) {
      const cx = qrBox.x + qrBox.width / 2, imgCx = qrImgBox.x + qrImgBox.width / 2;
      if (Math.abs(cx - imgCx) > 12) ev.defect('low', 'QR WhatsApp pare necentrat în panou', 'panelCenterX=' + cx + ' imgCenterX=' + imgCx);
    } else {
      ev.defect('medium', 'Panoul QR WhatsApp nu s-a deschis vizibil', 'qrBox=' + JSON.stringify(qrBox));
    }
    // Use the explicit close button, not the backdrop: the backdrop's bounding-box center
    // (Playwright's default click point) sits under the card itself, so a naive
    // `[data-wa-close]` .first() (which resolves to the backdrop, first in DOM order) gets
    // silently intercepted and never actually closes the modal.
    await frame.locator('.wa-qr__close').first().click().catch(() => {});
    await page.waitForTimeout(300);
    const waModalStillOpen = await frame.locator('#wa-qr').evaluate(el => !el.hasAttribute('hidden')).catch(() => false);
    if (waModalStillOpen) ev.defect('low', 'Panoul QR WhatsApp nu s-a închis la click pe butonul de close', '#wa-qr nu are atribut hidden după click pe .wa-qr__close');

    // ---------- STEP 7: mobile preview ----------
    await page.locator('#btn-preview-mobile').click();
    await page.waitForTimeout(700);
    await ev.shot(page, 'mobile-preview-390', { action: 'click', selector: '#btn-preview-mobile' });
    const overflowCheck = await frame.locator('html').evaluate((html) => {
      const doc = html.ownerDocument;
      const se = doc.scrollingElement || doc.documentElement;
      return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth };
    });
    ev.note('Mobile overflow check: scrollWidth=' + overflowCheck.scrollWidth + ' clientWidth=' + overflowCheck.clientWidth);
    if (overflowCheck.scrollWidth > overflowCheck.clientWidth + 2) {
      ev.defect('high', 'Overflow orizontal în preview mobil (390px)', JSON.stringify(overflowCheck));
    }
    // check collisions cookie/whatsapp/CTA — take a zoomed screenshot of bottom area
    await ev.shot(page, 'mobile-preview-bottom-zone', { action: 'observe bottom UI', detail: 'verificare coliziuni CTA/WA/cookie' });
    await page.locator('#btn-preview-desktop').click();
    await page.waitForTimeout(500);

    // ---------- STEP 8: add/remove repeatable item (services) ----------
    const servicesCountBefore = await frame.locator('[data-hb-edit^="services."]').evaluateAll(els => {
      const idxs = new Set(els.map(e => e.getAttribute('data-hb-edit').split('.')[1]));
      return idxs.size;
    }).catch(() => null);
    const addBtn = frame.locator('.hb-add-btn').first();
    const addBtnVisible = await addBtn.isVisible().catch(() => false);
    if (addBtnVisible) {
      await addBtn.click();
      await page.waitForTimeout(700);
      const servicesCountAfter = await frame.locator('[data-hb-edit^="services."]').evaluateAll(els => {
        const idxs = new Set(els.map(e => e.getAttribute('data-hb-edit').split('.')[1]));
        return idxs.size;
      }).catch(() => null);
      const newItemText = await frame.locator('.hb-list-item').last().innerText().catch(() => '');
      await ev.shot(page, 'repeatable-item-added', { action: 'click .hb-add-btn', detail: 'before=' + servicesCountBefore + ' after=' + servicesCountAfter + ' text="' + newItemText.replace(/\n/g, ' ') + '"', ok: servicesCountAfter > servicesCountBefore });
      const factoryHits = scanFactory(newItemText);
      if (!newItemText.trim() || /^\s*$/.test(newItemText)) {
        ev.defect('medium', 'Elementul nou adăugat (serviciu) apare gol, fără text default RO', 'text="' + newItemText + '"');
      } else if (factoryHits.length) {
        ev.defect('medium', 'Elementul nou adăugat conține text de tip "factory"', factoryHits.join(', '));
      }
      // remove it
      const removeBtn = frame.locator('.hb-list-item').last().locator('.hb-remove-btn');
      if (await removeBtn.count()) {
        await removeBtn.click();
        await page.waitForTimeout(500);
        await ev.shot(page, 'repeatable-item-removed', { action: 'click .hb-remove-btn', detail: 'removed last added service item' });
      } else {
        ev.defect('low', 'Butonul de ștergere a elementului nu a fost găsit', 'selector .hb-remove-btn');
      }
    } else {
      ev.defect('medium', 'Nu am găsit buton "+ Adaugă" vizibil pentru secțiunea servicii/specialități', 'selector .hb-add-btn');
      await ev.shot(page, 'repeatable-add-not-found', { action: 'search .hb-add-btn', ok: false });
    }

    // ---------- STEP 9: publish flow ----------
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await ev.shot(page, 'publish-modal-open', { action: 'click', selector: '#btn-publish' });
    const slug = 'audit-product-menu-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible', timeout: 8000 });
    await ev.shot(page, 'publish-slug-entered', { action: 'fill+click', selector: '#input-slug,#btn-publish-continue', detail: slug });
    await page.locator('#input-email').fill('audit-product-menu@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible', timeout: 8000 });
    await ev.shot(page, 'publish-magic-link-sent', { action: 'fill+click', selector: '#input-email,#btn-send-magic' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible', timeout: 8000 });
    await ev.shot(page, 'publish-authenticated-paywall', { action: 'click', selector: '#dev-link' });
    const paywallText = await page.locator('#modal-publish').innerText().catch(() => '');
    ev.note('Paywall text: ' + paywallText.replace(/\n+/g, ' | ').slice(0, 400));
    if (!/99/.test(paywallText)) ev.defect('medium', 'Prețul 99 nu apare vizibil pe ecranul de plată', paywallText.slice(0, 200));
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 25000 });
    await ev.shot(page, 'publish-success-modal', { action: 'click', selector: '#btn-pay-publish', fullPage: false });
    const successText = await page.locator('#modal-success').innerText().catch(() => '');
    ev.note('Success modal text: ' + successText.replace(/\n+/g, ' | '));
    const successFactory = scanFactory(successText);
    if (successFactory.length) ev.defect('medium', 'Text "factory" în modalul de succes', successFactory.join(','));
    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    ev.note('Live URL: ' + liveHref);
    if (!liveHref || !liveHref.includes('/live/')) ev.defect('critical', 'Nu există URL live valid după publish', 'href=' + liveHref);

    // ---------- STEP 10: LIVE site checks ----------
    const liveUrl = new URL(liveHref, srv.base).toString();
    const b2 = await newBrowser({ width: 1440, height: 1000 });
    await b2.page.goto(liveUrl, { waitUntil: 'networkidle' });
    await ev.shot(b2.page, 'live-site-desktop', { action: 'goto live URL desktop', detail: liveUrl, fullPage: false });
    await ev.shot(b2.page, 'live-site-desktop-fullpage', { action: 'goto live URL desktop fullPage', fullPage: true });
    const liveText = await b2.page.evaluate(() => document.body.innerText);
    const liveHtml = await b2.page.content();
    const liveChecks = {
      hasNewName: liveText.includes('Țăndărică'),
      hasAttribution: /hidook\.tech/i.test(liveHtml) && /hidook\.agency/i.test(liveHtml),
      langRo: await b2.page.evaluate(() => document.documentElement.getAttribute('lang')),
      jsonLdCount: await b2.page.evaluate(() => document.querySelectorAll('script[type="application/ld+json"]').length),
      ogImage: await b2.page.evaluate(() => document.querySelector('meta[property="og:image"]')?.getAttribute('content') || null),
      privacyLink: await b2.page.locator('a[href*="privacy"]').count(),
      termsLink: await b2.page.locator('a[href*="terms"]').count(),
      cookiesLink: await b2.page.locator('a[href*="cookies"]').count(),
    };
    fs.writeFileSync(path.join(DIR, 'live-site-checks.json'), JSON.stringify(liveChecks, null, 2));
    ev.note('Live site checks: ' + JSON.stringify(liveChecks));
    if (!liveChecks.hasNewName) ev.defect('critical', 'Site-ul live nu conține numele editat', 'text nu conține Țăndărică');
    if (!liveChecks.hasAttribution) ev.defect('critical', 'Atribuirea "Build by hidook.tech powered by hidook.agency" lipsește din site-ul live', '');
    if (liveChecks.langRo !== 'ro') ev.defect('medium', 'lang attribute nu este "ro"', 'lang=' + liveChecks.langRo);
    if (liveChecks.jsonLdCount === 0) ev.defect('medium', 'Nu există JSON-LD pe pagina live', '');
    if (!liveChecks.ogImage) ev.defect('medium', 'Nu există meta og:image pe pagina live', '');
    if (!liveChecks.privacyLink || !liveChecks.termsLink || !liveChecks.cookiesLink) ev.defect('high', 'Link(uri) legale lipsă din footer live', JSON.stringify(liveChecks));

    const factoryHitsLive = scanFactory(liveText);
    if (factoryHitsLive.length) ev.defect('high', 'Text "factory"/leftover pe site-ul live', factoryHitsLive.join(', '));

    // og:image reachability (ogImage content is a relative path — resolve against liveUrl)
    if (liveChecks.ogImage) {
      const ogAbs = new URL(liveChecks.ogImage, liveUrl).toString();
      try {
        const resp = await b2.page.request.get(ogAbs);
        if (resp.status() !== 200) ev.defect('medium', 'og:image nu răspunde 200', 'status=' + resp.status() + ' url=' + ogAbs);
      } catch (e) { ev.defect('medium', 'og:image request eșuat', String(e) + ' url=' + ogAbs); }
    }

    // images naturalWidth — exclude #wa-qr-img and .lightbox-img, which are intentional
    // empty placeholders (<img> with no src) only populated on user interaction (QR/lightbox open).
    const brokenImgs = await b2.page.evaluate(() => Array.from(document.querySelectorAll('img'))
      .filter(i => i.complete && i.naturalWidth === 0 && i.id !== 'wa-qr-img' && !i.classList.contains('lightbox-img'))
      .map(i => ({ src: i.getAttribute('src'), id: i.id, cls: i.className })));
    if (brokenImgs.length) ev.defect('high', 'Imagini cu naturalWidth=0 (rupte) pe site-ul live', JSON.stringify(brokenImgs.slice(0, 10)));
    else ev.note('Toate <img> (exceptând placeholder-ele intenționate #wa-qr-img și .lightbox-img) au naturalWidth>0.');

    // legal pages
    for (const seg of ['privacy', 'terms', 'cookies']) {
      const legalUrl = new URL(seg + '.html', liveUrl).toString();
      const resp = await b2.page.request.get(legalUrl).catch(() => null);
      const status = resp ? resp.status() : 'ERR';
      ev.note('Legal page ' + seg + ': status=' + status);
      if (status !== 200) ev.defect('high', 'Pagina legală ' + seg + '.html nu răspunde 200', 'status=' + status + ' url=' + legalUrl);
    }
    await b2.page.goto(new URL('privacy.html', liveUrl).toString(), { waitUntil: 'networkidle' });
    await ev.shot(b2.page, 'live-legal-privacy', { action: 'goto privacy.html' });
    await b2.page.goto(liveUrl, { waitUntil: 'networkidle' });

    // mobile live
    await b2.page.setViewportSize({ width: 390, height: 844 });
    await b2.page.goto(liveUrl, { waitUntil: 'networkidle' });
    await ev.shot(b2.page, 'live-site-mobile-390', { action: 'goto live URL mobile 390', fullPage: false });
    await ev.shot(b2.page, 'live-site-mobile-390-fullpage', { action: 'goto live URL mobile fullPage', fullPage: true });
    const liveOverflowMobile = await b2.page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
    if (liveOverflowMobile.sw > liveOverflowMobile.cw + 2) ev.defect('high', 'Overflow orizontal pe site-ul LIVE la 390px', JSON.stringify(liveOverflowMobile));

    ev.note('Console errors (live desktop+mobile): ' + JSON.stringify(b2.consoleErrors.slice(0, 20)));
    ev.note('Failed requests (live desktop+mobile): ' + JSON.stringify(b2.failedRequests.slice(0, 20)));
    if (b2.consoleErrors.length) ev.defect('medium', 'Console errors pe site-ul live', JSON.stringify(b2.consoleErrors.slice(0, 5)));
    if (b2.failedRequests.length) ev.defect('medium', 'Cereri eșuate (4xx/5xx) pe site-ul live', JSON.stringify(b2.failedRequests.slice(0, 5)));

    // ---------- STEP 12: interactions on live site (desktop) ----------
    await b2.page.setViewportSize({ width: 1440, height: 1000 });
    await b2.page.goto(liveUrl, { waitUntil: 'networkidle' });
    // gallery lightbox
    const collagePhoto = b2.page.locator('.collage-photo').first();
    if (await collagePhoto.count()) {
      await collagePhoto.click({ timeout: 4000 }).catch(() => {});
      await b2.page.waitForTimeout(400);
      const lbVisible = await b2.page.locator('.lightbox').first().isVisible().catch(() => false);
      await ev.shot(b2.page, 'live-gallery-lightbox', { action: 'click .collage-photo', detail: 'lightboxVisible=' + lbVisible, ok: lbVisible });
      if (!lbVisible) ev.defect('medium', 'Lightbox galerie nu se deschide la click pe poză', '');
      else await b2.page.locator('.lightbox-close').click().catch(() => {});
    } else {
      ev.note('Nu există .collage-photo pe pagina live (galerie posibil goală sau clasă diferită)');
    }
    // CTA scroll anchor
    const ctaLink = b2.page.locator('a.pm-hero__cta--fill').first();
    if (await ctaLink.count()) {
      await ctaLink.click().catch(() => {});
      await b2.page.waitForTimeout(500);
      await ev.shot(b2.page, 'live-cta-scroll', { action: 'click hero CTA anchor', detail: 'scrolled to #contact-card' });
    }
    // mobile menu / nav on mobile viewport
    await b2.page.setViewportSize({ width: 390, height: 844 });
    await b2.page.goto(liveUrl, { waitUntil: 'networkidle' });
    const navBox = await b2.page.locator('.pm-mast__nav').first().boundingBox().catch(() => null);
    const barBox = await b2.page.locator('.pm-mast__bar').first().boundingBox().catch(() => null);
    ev.note('Mobile nav boundingBox=' + JSON.stringify(navBox) + ' barBox=' + JSON.stringify(barBox));
    await ev.shot(b2.page, 'live-mobile-nav-header', { action: 'observe header nav on mobile (no hamburger in template)', detail: JSON.stringify({ navBox, barBox }) });
    if (navBox && navBox.width < 40) ev.defect('medium', 'Navigația din header pare invizibilă/comprimată pe mobil, fără hamburger de rezervă', JSON.stringify(navBox));

    await b2.close();

    // ---------- STEP 11: exports ----------
    await page.bringToFront();
    // The success modal is still open on `page` from step 9 — its scrim blocks the topbar
    // export buttons underneath, so close it first.
    await page.locator('#btn-success-close').click().catch(() => {});
    await page.waitForTimeout(500);
    const dlHtmlPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await page.locator('#btn-download-html').click();
    const dlHtml = await dlHtmlPromise;
    let htmlPath = null;
    if (dlHtml) { htmlPath = path.join(DIR, 'export.html'); await dlHtml.saveAs(htmlPath); }
    await ev.shot(page, 'export-html-clicked', { action: 'click', selector: '#btn-download-html', detail: dlHtml ? dlHtml.suggestedFilename() : 'NO DOWNLOAD', ok: !!dlHtml });
    if (!dlHtml) ev.defect('high', 'Export HTML nu a declanșat download', '');

    const dlZipPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await page.locator('#btn-download-zip').click();
    const dlZip = await dlZipPromise;
    let zipPath = null;
    if (dlZip) { zipPath = path.join(DIR, 'export.zip'); await dlZip.saveAs(zipPath); }
    await ev.shot(page, 'export-zip-clicked', { action: 'click', selector: '#btn-download-zip', detail: dlZip ? dlZip.suggestedFilename() : 'NO DOWNLOAD', ok: !!dlZip });
    if (!dlZip) ev.defect('high', 'Export ZIP nu a declanșat download', '');

    if (zipPath && fs.existsSync(zipPath)) {
      const unzipDir = path.join(DIR, 'export-unzipped');
      fs.mkdirSync(unzipDir, { recursive: true });
      await execFileP('unzip', ['-o', zipPath, '-d', unzipDir]);
      const files = fs.readdirSync(unzipDir);
      ev.note('ZIP conține la root: ' + JSON.stringify(files));
      const hasIndex = fs.existsSync(path.join(unzipDir, 'index.html'));
      const hasPrivacy = fs.existsSync(path.join(unzipDir, 'privacy.html'));
      if (!hasIndex) ev.defect('critical', 'ZIP nu conține index.html', JSON.stringify(files));
      if (!hasPrivacy) ev.defect('high', 'ZIP nu conține paginile legale (privacy.html)', JSON.stringify(files));

      // serve statically on ephemeral port
      const mimeMap = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
      const staticServer = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const fp = path.join(unzipDir, p);
        fs.readFile(fp, (err, data) => {
          if (err) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': mimeMap[path.extname(fp)] || 'application/octet-stream' });
          res.end(data);
        });
      });
      await new Promise((res) => staticServer.listen(0, res));
      const staticPort = staticServer.address().port;
      const b3 = await newBrowser({ width: 1440, height: 1000 });
      await b3.page.goto('http://127.0.0.1:' + staticPort + '/', { waitUntil: 'networkidle' });
      await ev.shot(b3.page, 'zip-standalone-served', { action: 'serve unzipped export statically', detail: 'port=' + staticPort, fullPage: true });
      const zipText = await b3.page.evaluate(() => document.body.innerText);
      if (!zipText.includes('Țăndărică')) ev.defect('high', 'Export ZIP standalone nu conține numele editat', '');
      ev.note('ZIP standalone console errors: ' + JSON.stringify(b3.consoleErrors.slice(0, 10)));
      if (b3.consoleErrors.length) ev.defect('medium', 'Console errors la deschiderea ZIP standalone', JSON.stringify(b3.consoleErrors.slice(0, 5)));
      await b3.close();
      staticServer.close();
    }

    // ---------- STEP 14: run relevant existing tests ----------
    const testResults = {};
    for (const t of ['flow2-product-menu-language.test.js']) {
      try {
        const { stdout, stderr } = await execFileP('node', ['--test', path.join(ROOT, 'bot/test', t)], { cwd: ROOT, timeout: 60000, env: process.env });
        testResults[t] = { ok: true, tail: (stdout + stderr).split('\n').slice(-15).join('\n') };
      } catch (e) {
        testResults[t] = { ok: false, tail: String(e.stdout || '').split('\n').slice(-20).join('\n') + '\n' + String(e.stderr || '').split('\n').slice(-20).join('\n') };
      }
    }
    fs.writeFileSync(path.join(DIR, 'existing-tests-run.json'), JSON.stringify(testResults, null, 2));
    ev.note('Existing test results saved to existing-tests-run.json: ' + JSON.stringify(Object.entries(testResults).map(([k, v]) => [k, v.ok])));

  } catch (err) {
    ev.defect('critical', 'Excepție neașteptată în scriptul de audit', String(err && err.stack || err));
    try { await ev.shot(page, 'unexpected-exception', { action: 'error', detail: String(err) }); } catch (_) {}
  } finally {
    ev.note('mainPage consoleErrors: ' + JSON.stringify(b.consoleErrors.slice(0, 20)));
    ev.note('mainPage failedRequests: ' + JSON.stringify(b.failedRequests.slice(0, 20)));
    ev.finish();
    await b.close();
    await srv.close();
  }
}

main().then(() => { console.log('DONE'); process.exit(0); }).catch((e) => { console.error('FATAL', e); process.exit(1); });
