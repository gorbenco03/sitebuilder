/**
 * Assert owner dashboard has no horizontal page overflow at 390px.
 * Requires server on PORT (default 8791).
 */
import { chromium } from 'playwright';

const PORT = process.env.PORT || '8791';
const BASE = process.env.CAL_PREVIEW_URL || `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${BASE}/calendar-native/owner/`, { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForSelector('[data-hod-shell], .hod-auth, .hod-boot', { timeout: 20000 });
// Allow preview-session + first paint
await page.waitForTimeout(1200);
await page.waitForSelector('.hod-tab, .hod-auth', { timeout: 15000 }).catch(() => null);

const report = await page.evaluate(() => {
  const shell = document.querySelector('[data-hod-shell]') || document.body;
  const sw = document.documentElement.scrollWidth;
  const cw = document.documentElement.clientWidth;
  const hb = shell.getBoundingClientRect();
  const outs = [];
  shell.querySelectorAll('button, input, select, .hod-booking, .hod-tab, .hod-btn, .hod-stat').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > cw + 2 || r.left < -2) {
      outs.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 80),
        left: Math.round(r.left),
        right: Math.round(r.right),
        vw: cw,
      });
    }
  });
  const pageOk = sw <= cw + 1;
  return {
    ok: pageOk && outs.length === 0,
    scrollW: sw,
    clientW: cw,
    shellW: Math.round(hb.width),
    outs,
    pageOk,
    title: document.title,
    hasTabs: !!document.querySelector('.hod-tab'),
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.ok) {
  console.error('OWNER_OVERFLOW_FAIL');
  process.exit(2);
}
if (!report.hasTabs) {
  console.error('OWNER_TABS_MISSING');
  process.exit(3);
}
console.log('OWNER_OVERFLOW_OK');
