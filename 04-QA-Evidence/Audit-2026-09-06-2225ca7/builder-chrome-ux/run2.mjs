import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import fs from 'node:fs';

const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/builder-chrome-ux';
const srv = await bootServer();
const ev = makeEvidence2(DIR);
console.log('server base', srv.base);

// separate log file so it doesn't clobber phase 1's oracle-log.json
function makeEvidence2(dir) {
  const base = makeEvidence(dir, 'builder-chrome-ux-editor');
  const origLog = base.log;
  const logPath = dir + '/oracle-log-editor.json';
  fs.writeFileSync(logPath, JSON.stringify(origLog, null, 2));
  base.write2 = () => fs.writeFileSync(logPath, JSON.stringify(origLog, null, 2) + '\n');
  const origShot = base.shot.bind(base);
  base.shot = async (...args) => { const r = await origShot(...args); base.write2(); return r; };
  const origDefect = base.defect.bind(base);
  base.defect = (...args) => { const r = origDefect(...args); base.write2(); return r; };
  const origNote = base.note.bind(base);
  base.note = (...args) => { origNote(...args); base.write2(); };
  return base;
}

const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

async function acceptCookie() {
  const btn = page.locator('#hb-cookie-accept');
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await acceptCookie();

// Start with product-menu template
await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
await page.waitForURL(/#edit$/);
await page.locator('#details-drawer').waitFor({ state: 'visible' });
await ev.shot(page, 'editor-loaded-drawer-auto-open', { action: 'click .btn-start-tpl product-menu', detail: 'editor loaded, Details drawer auto-open' });

// Inspect drawer body content
await ev.shot(page, 'details-drawer-content', { action: 'observe #drawer-body' });

// close drawer
await page.locator('#btn-close-drawer').click();
await page.locator('#details-drawer').waitFor({ state: 'hidden' });
await ev.shot(page, 'drawer-closed-inline-preview', { action: 'click #btn-close-drawer' });

// keyboard: Tab through editor topbar
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await ev.shot(page, 'keyboard-tab-focus-topbar', { action: 'press Tab x3', detail: 'checking visible focus ring on topbar controls' });

// inline edit business name
const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
await nameField.click();
await nameField.fill('QA Bistro Verificare');
await nameField.blur();
await ev.shot(page, 'inline-edit-business-name', { action: 'click+fill+blur business.name', detail: 'inline text edit in iframe' });

// reopen drawer -> check persistence of scroll/state + reflect edited name if drawer has a name field
await page.locator('#btn-open-drawer').click();
await page.locator('#details-drawer').waitFor({ state: 'visible' });
await ev.shot(page, 'drawer-reopened-after-edit', { action: 'click #btn-open-drawer', detail: 'drawer reopened after inline edit' });
await page.locator('#btn-close-drawer').click();
await page.locator('#details-drawer').waitFor({ state: 'hidden' });

// color popover
await page.locator('#btn-color-picker').click();
await page.locator('#color-popover').waitFor({ state: 'visible' }).catch(()=>{});
await ev.shot(page, 'color-popover-open', { action: 'click #btn-color-picker' });
// try invalid hex
await page.locator('#color-custom-text').fill('zzz');
await page.locator('#color-custom-text').blur();
await ev.shot(page, 'color-popover-invalid-hex', { action: 'fill #color-custom-text with zzz', detail: 'testing invalid hex input handling' });
await page.locator('#color-custom-text').fill('#2F6B5F');
await page.locator('#color-bg-text').fill('#E8F2EE');
await page.waitForTimeout(700);
await ev.shot(page, 'color-popover-valid-hex', { action: 'fill valid hex colors' });
await page.locator('#btn-color-picker').click();
await page.locator('#color-popover').waitFor({ state: 'hidden' }).catch(()=>{});
await page.waitForTimeout(400);
const iframeCookieVisibleAfterColorChange = await page.frameLocator('#preview-iframe').locator('#hb-cookie-banner').isVisible().catch(() => 'ERR');
await ev.shot(page, 'iframe-cookie-banner-after-color-change', { action: 'observe iframe after color change re-render', detail: 'template cookie banner visible again inside preview iframe after full re-render: ' + iframeCookieVisibleAfterColorChange });
if (iframeCookieVisibleAfterColorChange === true) {
  ev.defect('high', 'Bannerul de cookie al șablonului reapare în canvas la fiecare re-render (schimbare culoare/imagine)', 'Iframe-ul de previzualizare are sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" FARA allow-same-origin, deci localStorage/cookie din interiorul iframe-ului esueaza silentios (try/catch); starea "acceptat" a bannerului de cookie al site-ului nu persista intre re-render-uri complete (schimbare culoare, poza, liste). Verificat: acceptat manual in iframe -> banner ascuns; dupa schimbarea culorii accent -> banner reapare din nou.', 'iframe-cookie-banner-after-color-change');
}

// device toggle mobile
await page.locator('#btn-preview-mobile').click();
await ev.shot(page, 'preview-toggle-mobile', { action: 'click #btn-preview-mobile' });
await page.locator('#btn-preview-desktop').click();
await ev.shot(page, 'preview-toggle-desktop-back', { action: 'click #btn-preview-desktop' });

// Instagram modal - empty state / empty email
await page.locator('#btn-add-instagram').click();
await page.locator('#modal-instagram').waitFor({ state: 'visible' });
await ev.shot(page, 'instagram-modal-initial', { action: 'click #btn-add-instagram' });
// try submitting empty email if auth panel present
const igAuthVisible = await page.locator('#ig-auth-panel').isVisible().catch(()=>false);
if (igAuthVisible) {
  await page.locator('#btn-ig-send-magic').click().catch(()=>{});
  await ev.shot(page, 'instagram-modal-empty-email-submit', { action: 'click #btn-ig-send-magic with empty email', detail: 'validation message check' });
}
// Escape should close modal
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const igModalVisibleAfterEsc = await page.locator('#modal-instagram').isVisible().catch(()=>false);
await ev.shot(page, 'instagram-modal-after-escape', { action: 'press Escape', detail: 'modal-instagram visible after Escape: ' + igModalVisibleAfterEsc });
if (igModalVisibleAfterEsc) ev.defect('medium', 'Escape nu inchide modalul Instagram', 'Modalele ar trebui sa se inchida la Escape pentru accesibilitate/asteptari SaaS standard', null);
if (igModalVisibleAfterEsc) {
  await page.locator('#btn-close-instagram').click().catch(()=>{});
}

// refresh mid-editing: does draft persist?
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await ev.shot(page, 'refresh-mid-edit-check', { action: 'reload page mid-edit', detail: 'checking if #edit route + business name persisted' });
const urlAfterReload = page.url();
const nameAfterReload = await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first().textContent().catch(() => null);
ev.note('URL after reload: ' + urlAfterReload + ' | business.name after reload: ' + JSON.stringify(nameAfterReload));

// publish modal + slug validation
await page.locator('#btn-publish').click().catch(async () => {
  // if drawer or something blocks it, try opening editor route directly
});
await page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 8000 }).catch(()=>{});
await ev.shot(page, 'publish-modal-open', { action: 'click #btn-publish' });

// slug too short
await page.locator('#input-slug').fill('a');
await page.waitForTimeout(600);
await ev.shot(page, 'slug-too-short', { action: 'fill #input-slug with "a"', detail: 'slug too short validation' });

// slug invalid chars
await page.locator('#input-slug').fill('Bistro Ăâî!!');
await page.waitForTimeout(600);
await ev.shot(page, 'slug-invalid-chars', { action: 'fill #input-slug with invalid chars', detail: 'diacritics/spaces/symbols validation' });

// valid slug
const runSlug = 'qa-bistro-chrome-ux-' + Date.now().toString(36);
await page.locator('#input-slug').fill(runSlug);
await page.waitForTimeout(600);
await ev.shot(page, 'slug-valid', { action: 'fill #input-slug with valid slug' });

await page.locator('#btn-publish-continue').click();
await page.locator('#form-auth-email').waitFor({ state: 'visible' });
await ev.shot(page, 'auth-step-email-form', { action: 'click #btn-publish-continue' });

// invalid email format
await page.locator('#input-email').fill('not-an-email');
await page.locator('#btn-send-magic').click().catch(()=>{});
await page.waitForTimeout(400);
await ev.shot(page, 'auth-invalid-email-format', { action: 'submit invalid email format', detail: 'client-side email validation check' });

const email = 'qa-chrome-ux-' + Date.now() + '@example.com';
await page.locator('#input-email').fill(email);
await page.locator('#btn-send-magic').click();
await page.locator('#dev-link').waitFor({ state: 'visible' });
await ev.shot(page, 'auth-dev-link-visible', { action: 'submit valid email', detail: 'dev magic link visible (no RESEND configured)' });

const devHref = await page.locator('#dev-link').getAttribute('href');
ev.note('dev-link href: ' + devHref);

await page.locator('#dev-link').click();
await page.locator('#modal-success').waitFor({ state: 'visible' });
await ev.shot(page, 'success-modal-add-card', { action: 'click #dev-link', detail: 'draft published unpaid; add-card CTA' });

// reused magic-link token: navigate again to same verify URL
const verifyResp = await page.request.get(new URL(devHref, srv.base).href);
ev.note('First /auth/verify status on click (via UI) already consumed possibly. Testing raw second GET status=' + verifyResp.status());

await page.locator('#btn-pay-publish').click();
await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
await ev.shot(page, 'success-modal-live', { action: 'click #btn-pay-publish (test pay)', detail: 'live URL shown' });

const liveHref = await page.locator('#success-url-link').getAttribute('href');
ev.note('live href: ' + liveHref);

await page.locator('#btn-success-close').click();
await ev.shot(page, 'success-modal-closed-back-to-editor', { action: 'click #btn-success-close' });

// Now try reused magic link (second GET to same token URL) -> expect #login-expired or error, since already consumed
const secondVerify = await page.goto(new URL(devHref, srv.base).href, { waitUntil: 'networkidle' }).catch(e => null);
await page.waitForTimeout(500);
await ev.shot(page, 'reused-magic-link-token', { action: 'navigate to consumed dev-link again', detail: 'url=' + page.url() });

// go to dashboard
await page.goto(srv.base + '/app/#dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await ev.shot(page, 'dashboard-view', { action: 'goto #dashboard', detail: 'sites-list with published site' });

// open versions modal if available
const versionsBtn = page.locator('button:has-text("Istoric")').first();
const hasVersionsBtn = await versionsBtn.count();
ev.note('versions button count on dashboard card: ' + hasVersionsBtn);
if (hasVersionsBtn) {
  await versionsBtn.click().catch(()=>{});
  await page.locator('#modal-versions').waitFor({ state: 'visible', timeout: 5000 }).catch(()=>{});
  await ev.shot(page, 'versions-modal', { action: 'click versions button' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// logout
await page.locator('#btn-logout').click().catch(()=>{});
await page.waitForTimeout(500);
await ev.shot(page, 'after-logout', { action: 'click #btn-logout' });

ev.finish();
console.log('PHASE2 DONE');
console.log('RUN_SLUG=' + runSlug, 'EMAIL=' + email);
fs.writeFileSync(DIR + '/phase2-vars.json', JSON.stringify({ runSlug, email, liveHref, devHref }, null, 2));
await b.close();
await srv.close();
