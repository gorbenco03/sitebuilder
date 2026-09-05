/**
 * Assert public booking widget has no horizontal page overflow at 390px.
 * Requires server on PORT (default 8791).
 */
import { chromium } from 'playwright';

const PORT = process.env.PORT || '8791';
const BASE = process.env.CAL_PREVIEW_URL || `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
await page.waitForTimeout(500);

const report = await page.evaluate(() => {
  const hnb = document.querySelector('.hnb');
  if (!hnb) return { ok: false, reason: 'no .hnb' };
  const sw = document.documentElement.scrollWidth;
  const cw = document.documentElement.clientWidth;
  const hb = hnb.getBoundingClientRect();
  const outs = [];
  // Day chips intentionally extend inside a horizontal scroller; exclude them.
  hnb.querySelectorAll('button:not(.hnb__day), input, label, .hnb__form, .hnb__svc, .hnb__cta, .hnb__slots').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right > hb.right + 2 || r.left < hb.left - 2) {
      outs.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 80),
        left: Math.round(r.left),
        right: Math.round(r.right),
        cardL: Math.round(hb.left),
        cardR: Math.round(hb.right),
      });
    }
  });
  const days = hnb.querySelector('.hnb__days');
  let daysOk = true;
  if (days) {
    const dr = days.getBoundingClientRect();
    daysOk = dr.left >= hb.left - 1 && dr.right <= hb.right + 1;
  }
  const pageOk = sw <= cw + 1;
  return {
    ok: pageOk && outs.length === 0 && daysOk,
    scrollW: sw,
    clientW: cw,
    cardW: Math.round(hb.width),
    outs,
    daysOk,
    pageOk,
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.ok) {
  console.error('OVERFLOW_FAIL');
  process.exit(2);
}
console.log('OVERFLOW_OK');
