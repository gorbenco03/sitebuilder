import { bootServer, makeEvidence, newBrowser, ROOT, chromium } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/builder-chrome-ux';
const srv = await bootServer();
const ev = makeEvidence(DIR, 'builder-chrome-ux');
console.log('server base', srv.base);

const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

async function acceptCookie() {
  const btn = page.locator('#hb-cookie-accept');
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

// 1. Landing page desktop
await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await ev.shot(page, 'landing-desktop-cookie-banner', { action: 'goto /app/', detail: 'landing + cookie banner vizibil' });

await acceptCookie();
await ev.shot(page, 'landing-desktop-after-cookie-accept', { action: 'click #hb-cookie-accept' });

// check persistence: reload
await page.reload({ waitUntil: 'networkidle' });
const cookieVisibleAfterReload = await page.locator('#hb-cookie-banner').isVisible().catch(() => false);
await ev.shot(page, 'landing-after-reload-cookie-persistence', { action: 'reload', detail: 'cookie banner vizibil dupa reload: ' + cookieVisibleAfterReload });
if (cookieVisibleAfterReload) ev.defect('high', 'Bannerul de cookie reapare dupa reload desi a fost acceptat', 'localStorage/cookie persistence nu functioneaza corect', null);

// scroll to pricing / how it works / footer
await page.evaluate(() => document.getElementById('cum-e')?.scrollIntoView({ behavior: 'instant', block: 'start' }));
await ev.shot(page, 'landing-cum-functioneaza-section', { action: 'scroll to #cum-e' });

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await ev.shot(page, 'landing-footer-legal', { action: 'scroll to bottom' });

await page.evaluate(() => window.scrollTo(0, 0));

// catalog chips
const chips = await page.locator('#catalog-chips button, #catalog-chips [role="button"], #catalog-chips .chip').all();
console.log('chip count', chips.length);
await ev.shot(page, 'catalog-chips-default', { action: 'observe #catalog-chips', detail: 'chips=' + chips.length });

// try clicking each chip and see filtering effect on templates-grid count
const chipTexts = [];
for (const c of chips) chipTexts.push((await c.textContent() || '').trim());
console.log('chip texts', chipTexts);

for (let i = 0; i < chips.length; i++) {
  const chipsNow = await page.locator('#catalog-chips button, #catalog-chips [role="button"], #catalog-chips .chip').all();
  const chip = chipsNow[i];
  const label = chipTexts[i] || ('chip' + i);
  await chip.click();
  await page.waitForTimeout(300);
  const cardCount = await page.locator('#templates-grid .template-card').count();
  await ev.shot(page, 'catalog-chip-' + label.replace(/\s+/g,'-'), { action: 'click chip ' + label, detail: 'cards visible after click: ' + cardCount });
}
// reset to "Toate" (assume first chip resets)
if (chips.length) {
  const chipsNow = await page.locator('#catalog-chips button, #catalog-chips [role="button"], #catalog-chips .chip').all();
  await chipsNow[0].click();
  await page.waitForTimeout(300);
}

// template cards
const cardCount = await page.locator('.template-card').count();
console.log('template cards', cardCount);
await ev.shot(page, 'template-cards-overview', { action: 'observe .template-card', detail: 'count=' + cardCount, fullPage: true });

// zoom in on first card
const firstCard = page.locator('.template-card').first();
await firstCard.scrollIntoViewIfNeeded();
await ev.shot(page, 'template-card-closeup', { action: 'inspect first .template-card' });

// legal pages: privacy terms cookies
for (const p of ['privacy', 'terms', 'cookies']) {
  await page.goto(srv.base + '/app/' + p + '.html', { waitUntil: 'networkidle' });
  await ev.shot(page, 'legal-page-' + p, { action: 'goto /app/' + p + '.html' });
}

await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await acceptCookie();

// mobile viewport landing
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await ev.shot(page, 'landing-mobile-390', { action: 'goto /app/ @390px' });
await acceptCookie();
await page.evaluate(() => document.getElementById('cum-e')?.scrollIntoView());
await ev.shot(page, 'landing-mobile-cum-e', { action: 'scroll #cum-e @390px' });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await ev.shot(page, 'landing-mobile-footer', { action: 'scroll bottom @390px' });

// back to desktop for the main editor flow
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await acceptCookie();

ev.finish();
console.log('PHASE1 DONE');
await b.close();
