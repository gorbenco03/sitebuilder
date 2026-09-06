import path from 'node:path';
import { bootServer, makeEvidence, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/template-desserdirina_DSD-01';

const srv = await bootServer();
const ev = makeEvidence(EVDIR, 'verify-DSD-01');
const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

async function heroBgComputed() {
  return page.frameLocator('#preview-iframe').locator('.hero-background').first().evaluate((el) => ({
    inlineStyle: el.getAttribute('style'),
    computedBackgroundImage: getComputedStyle(el).backgroundImage,
  }));
}

await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await page.locator('#hb-cookie-accept').click();
await ev.shot(page, 'cookie-accepted', { action: 'click', selector: '#hb-cookie-accept' });

await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
await page.waitForURL(/#edit$/);
await page.locator('#details-drawer').waitFor({ state: 'visible' });
await ev.shot(page, 'editor-opened-desserdirina-default', { action: 'click', selector: '.template-card[data-template-id="desserdirina"] .btn-start-tpl', detail: 'default (unedited) hero, before touching hero.background field' });

const beforeEdit = await heroBgComputed();
ev.note('BEFORE any hero.background edit: ' + JSON.stringify(beforeEdit));
console.log('BEFORE EDIT', beforeEdit);

// Now edit the hero background photo via the Details drawer, same as production flow.
const photo = path.join(ROOT, 'templates/desserdirina/images/cupcakes-1.jpg');
const btn = page.locator('[data-field-key="hero.background"] button');
const chooserPromise = page.waitForEvent('filechooser');
await btn.click();
const chooser = await chooserPromise;
await chooser.setFiles(photo);
await page.locator('#dr_hero_background_img').waitFor({ state: 'visible' });
await page.waitForFunction(() => document.querySelector('#dr_hero_background_img')?.value === 'Poză adăugată');
await page.waitForTimeout(400); // allow rerender

await ev.shot(page, 'hero-after-photo-upload-drawer-open', { action: 'setInputFiles', selector: '[data-field-key="hero.background"] button', detail: 'uploaded cupcakes-1.jpg via Details drawer' });

await page.locator('#btn-close-drawer').click();
await page.locator('#details-drawer').waitFor({ state: 'hidden' });
await ev.shot(page, 'hero-after-photo-upload-iframe', { action: 'click', selector: '#btn-close-drawer', detail: 'iframe preview after uploading hero photo, drawer closed' });

const afterEdit = await heroBgComputed();
ev.note('AFTER hero.background photo edit: ' + JSON.stringify(afterEdit));
console.log('AFTER EDIT (photo)', afterEdit);

if (afterEdit.computedBackgroundImage === 'none' || afterEdit.computedBackgroundImage === '') {
  ev.defect('critical', 'Hero background-image invalid after photo edit (repro confirmed)', 'inline style: ' + afterEdit.inlineStyle + ' | computed backgroundImage: ' + afterEdit.computedBackgroundImage, '03-hero-after-photo-upload-iframe.png');
} else {
  ev.note('Photo edit did NOT reproduce the bug in the iframe preview: ' + JSON.stringify(afterEdit));
}

// Also check the tagline/CTA visibility claim in the same live iframe state.
const taglineCta = await page.frameLocator('#preview-iframe').locator('.hero-content').first().evaluate((el) => {
  const tagline = el.querySelector('.hero-tagline');
  const cta = el.querySelector('.hero-cta');
  const cs = (n) => n ? { opacity: getComputedStyle(n).opacity, display: getComputedStyle(n).display, text: n.textContent?.trim().slice(0,40) } : null;
  return { tagline: cs(tagline), cta: cs(cta) };
});
console.log('TAGLINE/CTA after photo edit', JSON.stringify(taglineCta));
ev.note('tagline/CTA computed after photo edit: ' + JSON.stringify(taglineCta));

// Now publish end to end and check the LIVE published page.
await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
const slugVal = 'dsd01-verify-' + Date.now().toString(36);
await page.locator('#input-slug').fill(slugVal);
await ev.shot(page, 'publish-modal-slug-filled', { action: 'fill', selector: '#input-slug' });
await page.locator('#btn-publish-continue').click();

await page.locator('#form-auth-email').waitFor({ state: 'visible', timeout: 15000 });
await page.locator('#input-email').fill('dsd01-verify@example.com');
await page.locator('#btn-send-magic').click();
const devLink = page.locator('#dev-link');
await devLink.waitFor({ state: 'visible', timeout: 15000 });
await devLink.click();

await page.locator('#btn-pay-publish').waitFor({ state: 'visible', timeout: 20000 });
await ev.shot(page, 'pay-publish-step', { action: 'visible', selector: '#btn-pay-publish' });
await page.locator('#btn-pay-publish').click();

await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 20000 });
await page.waitForFunction(() => {
  const href = document.querySelector('#success-url-link')?.getAttribute('href');
  return href && href !== '#';
}, { timeout: 10000 });
const liveUrl = await page.locator('#success-url-link').getAttribute('href');
ev.note('published live URL: ' + liveUrl);
await ev.shot(page, 'publish-success-modal', { action: 'visible', selector: '#modal-success', detail: 'live URL: ' + liveUrl });

// Load the actual live published page in a fresh page (no builder JS/CSS at all).
const livePage = await b.context.newPage();
const fullLiveUrl = liveUrl.startsWith('http') ? liveUrl : srv.base + liveUrl;
await livePage.goto(fullLiveUrl, { waitUntil: 'networkidle' });
await livePage.screenshot({ path: path.join(EVDIR, '07-live-published-desktop.png'), fullPage: true });
console.log('STEP 07-live-published-desktop.png');

const liveHeroBg = await livePage.locator('.hero-background').first().evaluate((el) => ({
  inlineStyle: el.getAttribute('style'),
  computedBackgroundImage: getComputedStyle(el).backgroundImage,
}));
console.log('LIVE PAGE hero-background', JSON.stringify(liveHeroBg));
ev.note('LIVE published page .hero-background computed: ' + JSON.stringify(liveHeroBg));

if (liveHeroBg.computedBackgroundImage === 'none') {
  ev.defect('critical', 'CONFIRMED on LIVE PUBLISHED page: hero background-image is none', 'inline style: ' + liveHeroBg.inlineStyle, '07-live-published-desktop.png');
}

// Wait out the CSS entrance animations (delay up to 1.8s) before judging tagline/CTA visibility,
// to rule out a screenshot-timing artifact rather than a real persistent defect.
await livePage.waitForTimeout(3000);
const liveTaglineCta = await livePage.evaluate(() => {
  const tagline = document.querySelector('.hero-tagline');
  const cta = document.querySelector('.hero-cta');
  const cs = (n) => n ? { opacity: getComputedStyle(n).opacity, transform: getComputedStyle(n).transform, display: getComputedStyle(n).display, text: n.textContent?.trim().slice(0,50) } : 'MISSING';
  return { tagline: cs(tagline), cta: cs(cta) };
});
console.log('LIVE PAGE tagline/CTA after 3s settle', JSON.stringify(liveTaglineCta));
ev.note('LIVE page tagline/CTA after 3s settle: ' + JSON.stringify(liveTaglineCta));
await livePage.screenshot({ path: path.join(EVDIR, '08-live-after-3s-settle.png'), fullPage: true });
console.log('STEP 08-live-after-3s-settle.png');

ev.finish();
await b.close();
await srv.close();
console.log('DONE');
