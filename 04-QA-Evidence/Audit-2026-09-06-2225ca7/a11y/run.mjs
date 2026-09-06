#!/usr/bin/env node
// A11y audit — builder chrome + 5 live templates. Isolated server via audit-harness.
import fs from 'node:fs';
import path from 'node:path';
import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/a11y';
const ev = makeEvidence(EVDIR, 'a11y');

// ---------- in-page audit helpers (serialized, run via page.evaluate) ----------
const AXE_LITE = () => {
  function relLum(c) {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function parseColor(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function contrastRatio(fg, bg) {
    const L1 = relLum([fg.r, fg.g, fg.b]) + 0.05;
    const L2 = relLum([bg.r, bg.g, bg.b]) + 0.05;
    return L1 > L2 ? L1 / L2 : L2 / L1;
  }
  function effectiveBg(el) {
    let node = el;
    while (node) {
      const cs = getComputedStyle(node);
      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0.01) {
        if (bg.a < 0.999) {
          // approximate: blend with white (can't easily recurse alpha compositing accurately)
          return { r: bg.r, g: bg.g, b: bg.b, approx: true };
        }
        return bg;
      }
      // detect background-image
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        return { imageBg: true, node: node.tagName + (node.id ? '#' + node.id : '') + (node.className ? '.' + String(node.className).split(' ').join('.') : '') };
      }
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255 };
  }

  const results = { headings: [], imgs: [], landmarks: {}, forms: [], contrastFails: [], contrastUndetermined: [], ariaIssues: [], smallTargets: [], lang: null, title: null };

  results.lang = document.documentElement.getAttribute('lang');
  results.title = document.title;

  // landmarks
  results.landmarks.header = document.querySelectorAll('header, [role=banner]').length;
  results.landmarks.nav = document.querySelectorAll('nav, [role=navigation]').length;
  results.landmarks.main = document.querySelectorAll('main, [role=main]').length;
  results.landmarks.footer = document.querySelectorAll('footer, [role=contentinfo]').length;

  // headings
  const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  results.headings = hs.map((h) => ({ tag: h.tagName, text: (h.textContent || '').trim().slice(0, 60), visible: h.offsetParent !== null }));
  results.h1Count = document.querySelectorAll('h1').length;
  let lastLevel = 0;
  const skips = [];
  for (const h of hs) {
    const lvl = parseInt(h.tagName[1], 10);
    if (lastLevel && lvl - lastLevel > 1) skips.push(`${lastLevel}->${lvl} @ "${(h.textContent||'').trim().slice(0,40)}"`);
    lastLevel = lvl;
  }
  results.headingSkips = skips;

  // images
  const imgs = Array.from(document.querySelectorAll('img'));
  results.imgs = imgs.map((img) => ({
    src: (img.currentSrc || img.src || '').split('/').slice(-2).join('/'),
    alt: img.getAttribute('alt'),
    hasAlt: img.hasAttribute('alt'),
    empty: img.hasAttribute('alt') && img.getAttribute('alt').trim() === '',
    generic: !!(img.getAttribute('alt') && /^(image|photo|img|picture|poza|imagine)\.?$/i.test(img.getAttribute('alt').trim())),
    decorative: img.getAttribute('role') === 'presentation' || img.getAttribute('aria-hidden') === 'true',
  }));

  // forms
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  results.forms = inputs.map((inp) => {
    const id = inp.id;
    const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrappingLabel = inp.closest('label');
    const ariaLabel = inp.getAttribute('aria-label');
    const ariaLabelledby = inp.getAttribute('aria-labelledby');
    const placeholder = inp.getAttribute('placeholder');
    return {
      tag: inp.tagName, type: inp.type || null, id, name: inp.name || null,
      hasLabel: !!(labelFor || wrappingLabel || ariaLabel || ariaLabelledby),
      via: labelFor ? 'label[for]' : wrappingLabel ? 'wrapping label' : ariaLabel ? 'aria-label' : ariaLabelledby ? 'aria-labelledby' : placeholder ? 'placeholder-only' : 'NONE',
      visible: inp.offsetParent !== null,
    };
  });

  // aria role sanity: elements with role but missing required name where applicable
  const withRole = Array.from(document.querySelectorAll('[role]'));
  for (const el of withRole) {
    const role = el.getAttribute('role');
    const needsName = ['dialog', 'alertdialog', 'region', 'group', 'toolbar', 'navigation', 'tab', 'tabpanel', 'button', 'link'].includes(role);
    const hasName = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.textContent || '').trim().length > 0;
    if (needsName && !hasName) {
      results.ariaIssues.push(`role="${role}" fără nume accesibil: ${el.tagName}${el.id ? '#' + el.id : ''}`);
    }
  }
  // aria-hidden on focusable
  const hiddenFocusable = Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter((el) => {
    return el.matches('a[href], button, input, select, textarea, [tabindex]') && !el.disabled;
  });
  hiddenFocusable.forEach((el) => results.ariaIssues.push(`aria-hidden=true pe element focusabil: ${el.tagName}${el.id ? '#' + el.id : ''}`));

  // contrast: check visible text nodes' parent elements (sampled)
  const allEls = Array.from(document.querySelectorAll('body, body *'));
  const seen = new Set();
  for (const el of allEls) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasOwnText) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const fg = parseColor(style.color);
    if (!fg) continue;
    const bgInfo = effectiveBg(el);
    const fontSize = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && bold);
    const threshold = isLarge ? 3.0 : 4.5;
    const key = el.tagName + '|' + (el.id || '') + '|' + (el.className || '') + '|' + (el.textContent||'').trim().slice(0,20);
    if (seen.has(key)) continue;
    seen.add(key);
    if (bgInfo.imageBg) {
      results.contrastUndetermined.push({ text: (el.textContent || '').trim().slice(0, 40), tag: el.tagName, id: el.id, cls: String(el.className).slice(0,60), reason: 'background-image on ' + bgInfo.node });
      continue;
    }
    const ratio = contrastRatio(fg, bgInfo);
    if (ratio < threshold) {
      results.contrastFails.push({
        text: (el.textContent || '').trim().slice(0, 40), tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 60),
        ratio: Math.round(ratio * 100) / 100, threshold, fg: style.color, bg: bgInfo.approx ? '(alpha~)' + JSON.stringify(bgInfo) : `rgb(${bgInfo.r},${bgInfo.g},${bgInfo.b})`,
        fontSize, bold,
      });
    }
  }

  // target size (mobile) - interactive elements
  const interactive = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [role=button], [tabindex="0"]'));
  for (const el of interactive) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 44 || r.height < 44) {
      results.smallTargets.push({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) });
    }
  }

  return results;
};

function summarizeAudit(name, r) {
  ev.note(`=== ${name} ===`);
  ev.note(`lang="${r.lang}" title="${r.title}"`);
  ev.note(`landmarks: header=${r.landmarks.header} nav=${r.landmarks.nav} main=${r.landmarks.main} footer=${r.landmarks.footer}`);
  ev.note(`h1 count=${r.h1Count}; heading skips: ${r.headingSkips.length ? r.headingSkips.join(' | ') : 'none'}`);
  const badImgs = r.imgs.filter((i) => !i.decorative && (!i.hasAlt || i.generic));
  ev.note(`imgs total=${r.imgs.length}; missing/generic alt (non-decorative)=${badImgs.length}`);
  badImgs.slice(0, 10).forEach((i) => ev.note(`  IMG bad-alt: src=${i.src} alt=${JSON.stringify(i.alt)}`));
  const badForms = r.forms.filter((f) => !f.hasLabel && f.visible);
  ev.note(`form fields total=${r.forms.length}; unlabeled visible=${badForms.length}`);
  badForms.forEach((f) => ev.note(`  FORM unlabeled: ${f.tag}#${f.id || '(no id)'} type=${f.type} via=${f.via}`));
  ev.note(`contrast fails=${r.contrastFails.length}; undetermined(image-bg)=${r.contrastUndetermined.length}`);
  r.contrastFails.slice(0, 15).forEach((c) => ev.note(`  CONTRAST FAIL ${c.ratio}:1 (need ${c.threshold}) "${c.text}" <${c.tag}${c.id ? '#'+c.id:''}.${c.cls}> fg=${c.fg} bg=${c.bg} size=${c.fontSize}px bold=${c.bold}`));
  ev.note(`aria issues=${r.ariaIssues.length}`);
  r.ariaIssues.slice(0, 10).forEach((a) => ev.note(`  ARIA: ${a}`));
  ev.note(`small targets(<44px)=${r.smallTargets.length}`);
  r.smallTargets.slice(0, 15).forEach((t) => ev.note(`  SMALL TARGET ${t.w}x${t.h} <${t.tag}${t.id?'#'+t.id:''}.${t.cls}> "${t.text}"`));
  return { badImgs, badForms };
}

async function tabOrderCheck(page, maxTabs = 40) {
  const seq = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // check for visible focus indicator: outline or box-shadow or border change heuristically via outline
      const outline = cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
      return {
        tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 40),
        text: (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 30),
        outline, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow,
        visible: r.width > 0 && r.height > 0,
      };
    });
    seq.push(info);
  }
  return seq;
}

async function main() {
  const srv = await bootServer();
  ev.note('server base=' + srv.base);

  // ============ BUILDER CHROME ============
  try {
    const b = await newBrowser({ width: 1440, height: 1000 });
    const { page } = b;
    await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
    await ev.shot(page, 'builder-landing-cookie', { action: 'goto /app/', detail: 'landing before cookie decision' });

    // Cookie banner accessibility check BEFORE accepting
    const cookieAudit = await page.evaluate(() => {
      const banner = document.querySelector('#hb-cookie-banner');
      if (!banner) return { present: false };
      const cs = getComputedStyle(banner);
      const btn = document.querySelector('#hb-cookie-accept');
      return {
        present: true,
        role: banner.getAttribute('role'),
        ariaLabel: banner.getAttribute('aria-label'),
        ariaLive: banner.getAttribute('aria-live'),
        btnTag: btn ? btn.tagName : null,
        btnText: btn ? btn.textContent.trim() : null,
        display: cs.display,
      };
    });
    ev.note('COOKIE BANNER a11y attrs: ' + JSON.stringify(cookieAudit));

    // keyboard reach cookie banner from top
    await page.keyboard.press('Tab');
    const firstFocus = await page.evaluate(() => document.activeElement ? document.activeElement.outerHTML.slice(0,120) : null);
    ev.note('First Tab stop on landing (cookie visible): ' + firstFocus);

    await page.locator('#hb-cookie-accept').click();
    await ev.shot(page, 'builder-cookie-accepted', { action: 'click #hb-cookie-accept' });

    await page.waitForTimeout(500);
    const catalogAudit = await page.evaluate(AXE_LITE);
    fs.writeFileSync(path.join(EVDIR, 'raw-builder-catalog.json'), JSON.stringify(catalogAudit, null, 2));
    summarizeAudit('BUILDER: catalog/landing', catalogAudit);
    await ev.shot(page, 'builder-catalog-full', { action: 'audit', detail: 'catalog a11y scan', fullPage: true });

    // zoom 200%
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await page.waitForTimeout(300);
    await ev.shot(page, 'builder-catalog-zoom200', { action: 'zoom 200%', detail: 'check overflow/clipping' });
    const overflowCheck = await page.evaluate(() => {
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, hasHorizScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 5 };
    });
    ev.note('Zoom 200% overflow check (catalog): ' + JSON.stringify(overflowCheck));
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });

    // reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    await ev.shot(page, 'builder-catalog-reduced-motion', { action: 'emulateMedia reduce', detail: 'check hero/card animation' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Tab order across catalog page
    await page.evaluate(() => window.scrollTo(0,0));
    await page.keyboard.press('Home');
    // focus body first
    await page.evaluate(() => document.body.focus());
    const tabSeq = await tabOrderCheck(page, 25);
    fs.writeFileSync(path.join(EVDIR, 'raw-builder-catalog-tabseq.json'), JSON.stringify(tabSeq, null, 2));
    const noOutline = tabSeq.filter((t) => t && !t.outline && (!t.boxShadow || t.boxShadow === 'none'));
    ev.note(`Tab sequence length=${tabSeq.filter(Boolean).length}; stops with NO visible focus indicator (no outline, no box-shadow)=${noOutline.length}`);
    noOutline.slice(0, 10).forEach((t) => ev.note(`  NO FOCUS INDICATOR: <${t.tag}${t.id?'#'+t.id:''}.${t.cls}> "${t.text}" outlineStyle=${t.outlineStyle} boxShadow=${t.boxShadow}`));
    await ev.shot(page, 'builder-tab-focus-sample', { action: 'Tab x' + tabSeq.length, detail: 'last focused element visual' });

    // click into a template -> editor
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.locator('#screen-edit').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    await ev.shot(page, 'builder-editor-professionals', { action: 'click .btn-start-tpl professionals', detail: 'editor opened, drawer auto' });

    const editorAudit = await page.evaluate(AXE_LITE);
    fs.writeFileSync(path.join(EVDIR, 'raw-builder-editor.json'), JSON.stringify(editorAudit, null, 2));
    summarizeAudit('BUILDER: editor chrome (professionals loaded)', editorAudit);

    // Details drawer: focus trap + Escape close
    const drawerVisible = await page.locator('#details-drawer').isVisible().catch(() => false);
    ev.note('Details drawer auto-visible after template select: ' + drawerVisible);
    if (drawerVisible) {
      await ev.shot(page, 'builder-drawer-open', { action: 'observe', detail: 'drawer open state' });
      // check drawer has role/aria
      const drawerAttrs = await page.evaluate(() => {
        const d = document.querySelector('#details-drawer');
        return { role: d.getAttribute('role'), ariaModal: d.getAttribute('aria-modal'), ariaLabel: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'), tabindex: d.getAttribute('tabindex') };
      });
      ev.note('Drawer attrs: ' + JSON.stringify(drawerAttrs));
      // Try Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const stillVisible = await page.locator('#details-drawer').isVisible().catch(() => false);
      ev.note('Drawer visible after Escape key: ' + stillVisible + (stillVisible ? ' -> DEFECT: Escape does not close drawer' : ' -> OK closes on Escape'));
      await ev.shot(page, 'builder-drawer-after-escape', { action: 'press Escape', detail: 'expect drawer closed' });
      if (stillVisible) {
        // reopen check & try close button
        const closeBtn = await page.locator('#btn-close-drawer').isVisible().catch(()=>false);
        ev.note('btn-close-drawer visible: ' + closeBtn);
      }
    }

    // reopen drawer via button for field label check
    const openDrawerBtn = page.locator('#btn-open-drawer');
    if (await openDrawerBtn.isVisible().catch(() => false)) {
      await openDrawerBtn.click();
      await page.waitForTimeout(500);
      await ev.shot(page, 'builder-drawer-reopened', { action: 'click #btn-open-drawer' });
      const drawerFormAudit = await page.evaluate(AXE_LITE);
      fs.writeFileSync(path.join(EVDIR, 'raw-builder-drawer.json'), JSON.stringify(drawerFormAudit, null, 2));
      const { badForms } = summarizeAudit('BUILDER: details drawer form fields', drawerFormAudit);
      // close drawer again before proceeding (avoid overlay intercepting later clicks)
      const closeBtn2 = page.locator('#btn-close-drawer');
      if (await closeBtn2.isVisible().catch(() => false)) {
        await closeBtn2.click();
        await page.waitForTimeout(300);
      }
    }

    // color popover
    const colorBtn = page.locator('#btn-color-picker');
    if (await colorBtn.isVisible().catch(() => false)) {
      await colorBtn.click();
      await page.waitForTimeout(400);
      await ev.shot(page, 'builder-color-popover', { action: 'click #btn-color-picker' });
      const popVisible = await page.locator('#color-popover').isVisible().catch(() => false);
      ev.note('Color popover visible: ' + popVisible);
      if (popVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const stillVis = await page.locator('#color-popover').isVisible().catch(() => false);
        ev.note('Color popover visible after Escape: ' + stillVis);
        await ev.shot(page, 'builder-color-popover-escape', { action: 'press Escape' });
      }
    }

    // mobile preview toggle + mobile viewport pass on builder chrome itself
    await b.close();
  } catch (err) {
    ev.defect('medium', 'Eroare in timpul auditului builder chrome', String(err && err.stack || err));
    ev.note('ERROR builder chrome section: ' + (err && err.message));
  }

  // ============ MOBILE 390 pass: builder chrome + template card sizes ============
  try {
    const b = await newBrowser({ width: 390, height: 844 });
    const { page } = b;
    await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.waitForTimeout(400);
    await ev.shot(page, 'mobile-390-catalog', { action: 'goto /app/ @390px, accept cookie', fullPage: true });
    const mobileAudit = await page.evaluate(AXE_LITE);
    fs.writeFileSync(path.join(EVDIR, 'raw-mobile-catalog.json'), JSON.stringify(mobileAudit, null, 2));
    ev.note(`MOBILE 390 catalog: small targets(<44px)=${mobileAudit.smallTargets.length}`);
    mobileAudit.smallTargets.slice(0, 20).forEach((t) => ev.note(`  MOBILE SMALL TARGET ${t.w}x${t.h} <${t.tag}${t.id?'#'+t.id:''}.${t.cls}> "${t.text}"`));

    // check hamburger / header nav on mobile keyboard operability
    const navInfo = await page.evaluate(() => {
      const nav = document.querySelector('#header-nav');
      const burger = document.querySelector('[class*=burger],[class*=hamburger],[aria-label*=meniu i],[aria-label*=Meniu]');
      return { navDisplay: nav ? getComputedStyle(nav).display : null, burgerFound: !!burger, burgerTag: burger ? burger.tagName : null, burgerAria: burger ? burger.getAttribute('aria-label') : null };
    });
    ev.note('Mobile nav/hamburger info: ' + JSON.stringify(navInfo));

    await b.close();
  } catch (err) {
    ev.defect('medium', 'Eroare in timpul auditului mobil 390px', String(err && err.stack || err));
    ev.note('ERROR mobile-390 section: ' + (err && err.message));
  }

  // ============ 5 TEMPLATES via publish -> /live/<slug>/ ============
  const templates = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];
  for (const tpl of templates) {
    const b = await newBrowser({ width: 1440, height: 1000 });
    const { page } = b;
    try {
      await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
      await page.locator('#hb-cookie-accept').click().catch(() => {});
      await page.waitForTimeout(300);
      await page.locator(`.template-card[data-template-id="${tpl}"] .btn-start-tpl`).click();
      await page.locator('#screen-edit').waitFor({ state: 'visible' });
      await page.waitForTimeout(1200);
      // close drawer if open
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);

      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      const slug = 'a11y-' + tpl + '-' + Date.now().toString(36);
      await page.locator('#input-slug').fill(slug);
      await page.locator('#btn-publish-continue').click();
      await page.waitForTimeout(500);
      await page.locator('#input-email').fill('a11y-audit@example.com');
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#dev-link').click();
      await page.locator('#btn-pay-publish').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#btn-pay-publish').click();
      await page.locator('#success-url-link').waitFor({ state: 'visible', timeout: 15000 });
      const liveHref = await page.locator('#success-url-link').getAttribute('href');
      ev.note(`Published ${tpl} -> ${liveHref}`);
      await b.close();

      const lb = await newBrowser({ width: 1440, height: 1000 });
      const livePage = lb.page;
      const liveUrl = liveHref.startsWith('http') ? liveHref : srv.base + liveHref;
      await livePage.goto(liveUrl, { waitUntil: 'networkidle' });
      await ev.shot(livePage, `live-${tpl}-desktop`, { action: 'goto live url', detail: liveUrl, fullPage: true });

      const audit = await livePage.evaluate(AXE_LITE);
      fs.writeFileSync(path.join(EVDIR, `raw-live-${tpl}.json`), JSON.stringify(audit, null, 2));
      summarizeAudit(`TEMPLATE ${tpl} (desktop, live)`, audit);

      // reduced motion
      await livePage.emulateMedia({ reducedMotion: 'reduce' });
      await livePage.reload({ waitUntil: 'networkidle' });
      await livePage.waitForTimeout(600);
      await ev.shot(livePage, `live-${tpl}-reduced-motion`, { action: 'emulateMedia reduce + reload' });
      await livePage.emulateMedia({ reducedMotion: 'no-preference' });

      // zoom 200%
      await livePage.evaluate(() => { document.documentElement.style.zoom = '2'; });
      await livePage.waitForTimeout(300);
      const zoomOverflow = await livePage.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 5 }));
      ev.note(`TEMPLATE ${tpl} zoom200 overflow: ${JSON.stringify(zoomOverflow)}`);
      await ev.shot(livePage, `live-${tpl}-zoom200`, { action: 'zoom 200%' });
      await livePage.evaluate(() => { document.documentElement.style.zoom = '1'; });

      // tab order + focus visibility on live page
      await livePage.evaluate(() => document.body.focus());
      const liveTabSeq = await tabOrderCheck(livePage, 20);
      const liveNoOutline = liveTabSeq.filter((t) => t && !t.outline && (!t.boxShadow || t.boxShadow === 'none'));
      ev.note(`TEMPLATE ${tpl} tab stops=${liveTabSeq.filter(Boolean).length}; no visible focus=${liveNoOutline.length}`);
      liveNoOutline.slice(0, 8).forEach((t) => ev.note(`  ${tpl} NO FOCUS: <${t.tag}${t.id?'#'+t.id:''}.${t.cls}> "${t.text}"`));

      // mobile viewport for this template — target sizes + screenshot
      await lb.close();
      const mb = await newBrowser({ width: 390, height: 844 });
      const mp = mb.page;
      await mp.goto(liveUrl, { waitUntil: 'networkidle' });
      await ev.shot(mp, `live-${tpl}-mobile390`, { action: 'goto @390px', fullPage: true });
      const mAudit = await mp.evaluate(AXE_LITE);
      fs.writeFileSync(path.join(EVDIR, `raw-live-${tpl}-mobile.json`), JSON.stringify(mAudit, null, 2));
      ev.note(`TEMPLATE ${tpl} MOBILE small targets(<44px)=${mAudit.smallTargets.length}`);
      mAudit.smallTargets.slice(0, 10).forEach((t) => ev.note(`  ${tpl} MOBILE SMALL: ${t.w}x${t.h} <${t.tag}${t.id?'#'+t.id:''}.${t.cls}> "${t.text}"`));

      // WhatsApp badge check
      const waInfo = await mp.evaluate(() => {
        const wa = document.querySelector('[class*=whatsapp],[href*="wa.me"],[href*="api.whatsapp"]');
        if (!wa) return { found: false };
        return { found: true, tag: wa.tagName, ariaLabel: wa.getAttribute('aria-label'), text: (wa.textContent||'').trim().slice(0,40), href: wa.getAttribute('href') };
      });
      ev.note(`TEMPLATE ${tpl} WhatsApp element: ${JSON.stringify(waInfo)}`);

      await mb.close();
    } catch (err) {
      ev.defect('high', `Eroare la auditarea șablonului ${tpl}`, String(err && err.stack || err));
      ev.note(`ERROR auditing ${tpl}: ${err && err.message}`);
      try { await b.close(); } catch {}
    }
  }

  ev.finish();
  await srv.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
