// Publish real live sites (through the actual test-pay pipeline, same as
// bot/test/flow2-template-e2e.mjs) for desserdirina and product-menu, then run
// WCAG AA contrast / 24x24 touch-target / 200%-zoom-reflow checks against the
// REAL published HTML+CSS (including cookie-banner.css / legal footer links
// that a bare template.html+styles.css export would miss). This sidesteps any
// fidelity gaps in a hand-rolled static export.
import fs from 'node:fs';
import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB } = await newBrowser({ width: 1440, height: 1000 });
page.setDefaultTimeout(30000);

async function publish(templateId, slug) {
  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator('.template-card[data-template-id="' + templateId + '"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  // Already authenticated from an earlier publish() in this same session? Then
  // the auth-email step is skipped entirely and we land straight on pay/success.
  const authForm = page.locator('#form-auth-email');
  const payBtn = page.locator('#btn-pay-publish');
  await Promise.race([
    authForm.waitFor({ state: 'visible' }).catch(() => {}),
    payBtn.waitFor({ state: 'visible' }).catch(() => {}),
  ]);
  if (await authForm.isVisible().catch(() => false)) {
    await page.locator('#input-email').fill('qa-' + slug + '@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
  }
  await payBtn.waitFor({ state: 'visible' });
  await payBtn.click();
  await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
  const href = await page.locator('#success-url-link').getAttribute('href');
  return new URL(href, base).href;
}

const urls = {};
urls['professionals'] = await publish('professionals', 'qa-a11y-professionals');
urls['portfolio'] = await publish('portfolio', 'qa-a11y-portfolio');
urls['local-service'] = await publish('local-service', 'qa-a11y-localservice');
urls['desserdirina'] = await publish('desserdirina', 'qa-a11y-desserdirina');
urls['product-menu'] = await publish('product-menu', 'qa-a11y-productmenu');
console.log('LIVE URLS:', JSON.stringify(urls, null, 2));

/* eslint-disable */
function browserContrastCheck(selectors) {
  function parseColor(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function effectiveBg(el) {
    let node = el;
    const layers = [];
    while (node) {
      const cs = getComputedStyle(node);
      const bgImg = cs.backgroundImage;
      if (bgImg && bgImg !== 'none' && /gradient/i.test(bgImg)) {
        return { r: NaN, g: NaN, b: NaN, gradient: true };
      }
      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 0.999) break; }
      node = node.parentElement;
    }
    let result = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const c = layers[i];
      result = { r: c.r * c.a + result.r * (1 - c.a), g: c.g * c.a + result.g * (1 - c.a), b: c.b * c.a + result.b * (1 - c.a) };
    }
    return result;
  }
  function relLum({ r, g, b }) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(c1, c2) {
    const L1 = relLum(c1), L2 = relLum(c2);
    const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (a + 0.05) / (b + 0.05);
  }
  const out = [];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (!els.length) { out.push({ sel, missing: true }); continue; }
    els.forEach((el, idx) => {
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      const bg = effectiveBg(el);
      if (bg.gradient) { out.push({ sel: sel + '[' + idx + ']', gradientBg: true, text: (el.textContent || '').trim().slice(0, 40) }); return; }
      const fgEffective = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) } : fg;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = isLarge ? 3 : 4.5;
      const r = ratio(fgEffective, bg);
      out.push({ sel: sel + (els.length > 1 ? '[' + idx + ']' : ''), ratio: Math.round(r * 100) / 100, required, pass: r >= required, text: (el.textContent || '').trim().slice(0, 40) });
    });
  }
  return out;
}
/* eslint-enable */

const SELECTORS = {
  desserdirina: ['.section-eyebrow', '.hero-tagline', '.menu-lang-btn', '.category-title', '.category-blurb', '.section-title', '.contact-item', '.footer-info', '.hb-legal-links a', '.hb-built-by', '.menu-cat'],
  'product-menu': ['.section-eyebrow', '.hero-tagline', '.category-title', '.section-title', '.contact-item', '.footer-info', '.hb-legal-links a', '.hb-built-by', 'nav a', '.menu-cat', '.pm-tickets .service-card'],
};

for (const tpl of ['desserdirina', 'product-menu']) {
  console.log('\n########## LIVE: ' + tpl + ' (' + urls[tpl] + ') ##########');
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(urls[tpl], { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const results = await p.evaluate(browserContrastCheck, SELECTORS[tpl]);
  const failures = results.filter((r) => r.pass === false);
  const gradients = results.filter((r) => r.gradientBg);
  const missing = results.filter((r) => r.missing);
  console.log('CONTRAST failures (solid bg only):', failures.length);
  failures.forEach((f) => console.log('  FAIL', f.sel, f.ratio + ':1 (need ' + f.required + ':1)', JSON.stringify(f.text)));
  console.log('SKIPPED (gradient background - needs visual check):', gradients.length);
  gradients.forEach((g) => console.log('  SKIP(gradient)', g.sel, JSON.stringify(g.text)));
  if (missing.length) console.log('  (selectors not found:', missing.map((m) => m.sel).join(', '), ')');

  const failsDesktop = await p.evaluate(() => {
    function inlineExempt(el) { return el.tagName === 'A' && !!el.closest('p'); }
    return Array.from(document.querySelectorAll('a[href], button, summary, input[type="radio"]'))
      .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .filter((el) => !inlineExempt(el))
      .map((el) => { const box = el.getBoundingClientRect(); return { tag: el.tagName, cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 30), w: Math.round(box.width), h: Math.round(box.height) }; })
      .filter((r) => r.w > 0 && r.h > 0 && (r.w < 24 || r.h < 24));
  });
  console.log('TOUCH TARGET <24x24 (desktop):', failsDesktop.length);
  failsDesktop.forEach((f) => console.log('  FAIL', f.tag, f.cls, JSON.stringify(f.text), f.w + 'x' + f.h));
  await p.close();

  const pm = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pm.goto(urls[tpl], { waitUntil: 'networkidle' });
  await pm.waitForTimeout(300);
  const navToggle = pm.locator('[aria-label*="meniu" i], [aria-label*="menu" i], .nav-toggle, .menu-toggle, [class*="nav-toggle"], [class*="hamburger"]').first();
  if (await navToggle.count().catch(() => 0)) await navToggle.click().catch(() => {});
  await pm.waitForTimeout(200);
  const failsMobile = await pm.evaluate(() => {
    function inlineExempt(el) { return el.tagName === 'A' && !!el.closest('p'); }
    return Array.from(document.querySelectorAll('a[href], button, summary, input[type="radio"]'))
      .filter((el) => getComputedStyle(el).pointerEvents !== 'none')
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .filter((el) => !inlineExempt(el))
      .map((el) => { const box = el.getBoundingClientRect(); return { tag: el.tagName, cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 30), w: Math.round(box.width), h: Math.round(box.height) }; })
      .filter((r) => r.w > 0 && r.h > 0 && (r.w < 24 || r.h < 24));
  });
  console.log('TOUCH TARGET <24x24 (mobile):', failsMobile.length);
  failsMobile.forEach((f) => console.log('  FAIL', f.tag, f.cls, JSON.stringify(f.text), f.w + 'x' + f.h));
  await pm.close();

  for (const width of [640, 320]) {
    const pz = await browser.newPage({ viewport: { width, height: 900 } });
    await pz.goto(urls[tpl], { waitUntil: 'networkidle' });
    await pz.waitForTimeout(200);
    const overflow = await pz.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    console.log('ZOOM REFLOW @' + width + 'px:', overflow.scrollWidth <= overflow.clientWidth + 1 ? 'OK' : ('SCROLL scrollWidth=' + overflow.scrollWidth + ' clientWidth=' + overflow.clientWidth));
    await pz.close();
  }
}

await closeB();
await close();
