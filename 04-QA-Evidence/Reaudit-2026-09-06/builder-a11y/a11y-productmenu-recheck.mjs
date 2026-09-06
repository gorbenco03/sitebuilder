import { bootServer, newBrowser } from './_harness.mjs';

const { base, close } = await bootServer();
const { browser, page, close: closeB } = await newBrowser({ width: 1440, height: 1000 });
page.setDefaultTimeout(30000);

await page.goto(base + '/app/', { waitUntil: 'networkidle' });
await page.locator('#hb-cookie-accept').click().catch(() => {});
await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
await page.waitForURL(/#edit$/);
await page.locator('#preview-iframe').waitFor({ state: 'visible' });
await page.waitForTimeout(800);
if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
  await page.locator('#btn-close-drawer').click().catch(() => {});
  await page.waitForTimeout(300);
}
await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
await page.locator('#input-slug').fill('qa-pm-recheck2');
await page.locator('#btn-publish-continue').click();
await page.locator('#form-auth-email').waitFor({ state: 'visible' });
await page.locator('#input-email').fill('qa-pm-recheck2@example.com');
await page.locator('#btn-send-magic').click();
await page.locator('#dev-link').waitFor({ state: 'visible' });
await page.locator('#dev-link').click();
await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
await page.locator('#btn-pay-publish').click();
await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
const href = await page.locator('#success-url-link').getAttribute('href');
const liveUrl = new URL(href, base).href;
console.log('LIVE URL:', liveUrl);

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
      if (bgImg && bgImg !== 'none' && /gradient/i.test(bgImg)) return { gradient: true };
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

const SELECTORS = ['.pm-kicker', '.pm-title', '.pm-catblock__t', '.pm-catblock__b', '.pm-contact', '.pm-rail__label', '.pm-ticket__label', '.hb-built-by'];
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(liveUrl, { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
const results = await p.evaluate(browserContrastCheck, SELECTORS);
const failures = results.filter((r) => r.pass === false);
const gradients = results.filter((r) => r.gradientBg);
const missing = results.filter((r) => r.missing);
console.log('CONTRAST failures (solid bg):', failures.length);
failures.forEach((f) => console.log('  FAIL', f.sel, f.ratio + ':1 (need ' + f.required + ':1)', JSON.stringify(f.text)));
console.log('SKIPPED (gradient):', gradients.length);
gradients.forEach((g) => console.log('  SKIP', g.sel, JSON.stringify(g.text)));
if (missing.length) console.log('missing selectors:', missing.map(m => m.sel).join(', '));

await p.close();
await closeB();
await close();
