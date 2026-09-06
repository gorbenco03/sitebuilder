import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import fs from 'node:fs';

const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/builder-chrome-ux';
const srv = await bootServer();
const logPath = DIR + '/oracle-log-part3.json';
const log = { lens: 'builder-chrome-ux-part3', startedAt: new Date().toISOString(), entries: [], defects: [], notes: [] };
const write = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
write();
let idx = 0;
async function shot(page, step, detail) {
  const file = String(++idx).padStart(2, '0') + '-p3-' + step.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png';
  await page.screenshot({ path: DIR + '/' + file });
  log.entries.push({ step, file, detail, url: page.url(), ts: new Date().toISOString() });
  write();
  console.log('P3', file, detail || '');
}
function defect(sev, title, detail) { log.defects.push({ sev, title, detail }); write(); console.log('DEFECT', sev, title); }
function note(t) { log.notes.push(t); write(); }

const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

async function acceptCookie(p) {
  const btn = p.locator('#hb-cookie-accept');
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

// ---------- A. Keyboard focus order from clean editor load ----------
await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await acceptCookie(page);
await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
await page.waitForURL(/#edit$/);
await page.locator('#details-drawer').waitFor({ state: 'visible' });
await page.locator('#btn-close-drawer').click();
await page.locator('#details-drawer').waitFor({ state: 'hidden' });
await page.mouse.move(5, 500); // park mouse away from all controls to avoid hover confusion
await page.waitForTimeout(200);

const focusIds = [];
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('Tab');
  const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName);
  focusIds.push(id);
}
note('Tab order (10 presses) from editor topbar: ' + JSON.stringify(focusIds));
await shot(page, 'tab-order-10th', 'focus after 10 tabs: ' + focusIds[focusIds.length - 1]);

// ---------- B. Escape across modals ----------
async function testEscape(openSelector, modalId, label) {
  await page.locator(openSelector).click();
  await page.locator('#' + modalId).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const visibleBefore = await page.locator('#' + modalId).isVisible().catch(() => false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const visibleAfter = await page.locator('#' + modalId).isVisible().catch(() => false);
  await shot(page, 'escape-' + modalId, label + ': before=' + visibleBefore + ' after=' + visibleAfter);
  if (visibleBefore && visibleAfter) defect('medium', 'Escape nu închide modalul ' + modalId, label + ' - Escape ar trebui să închidă orice modal deschis (pattern standard SaaS/accesibilitate)');
  if (visibleAfter) {
    const closeId = 'btn-close-' + modalId.replace(/^modal-/, '');
    await page.locator('#' + closeId).click({ force: true }).catch(async () => {
      await page.evaluate((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; }, modalId);
    });
    await page.waitForTimeout(200);
  }
}

await testEscape('#btn-publish', 'modal-publish', 'Publish modal + Escape');
await testEscape('#btn-add-instagram', 'modal-instagram', 'Instagram modal + Escape (re-check)');

// drawer + Escape
await page.locator('#btn-open-drawer').click();
await page.locator('#details-drawer').waitFor({ state: 'visible' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const drawerVisibleAfterEsc = await page.locator('#details-drawer').isVisible().catch(() => false);
await shot(page, 'escape-drawer', 'details-drawer visible after Escape: ' + drawerVisibleAfterEsc);
if (drawerVisibleAfterEsc) defect('low', 'Escape nu închide Details drawer', 'Drawer-ul de detalii rămâne deschis la Escape; comportament inconsistent față de așteptarea standard de UI');
if (drawerVisibleAfterEsc) await page.locator('#btn-close-drawer').click().catch(() => {});

// ---------- C. Mobile viewport editor ----------
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await shot(page, 'editor-mobile-390-viewport', 'editor chrome at 390px width (is builder itself usable on phone?)');
await page.locator('#btn-open-drawer').click().catch(() => {});
await page.waitForTimeout(300);
await shot(page, 'editor-mobile-390-drawer-open', 'Details drawer at 390px width');
await page.setViewportSize({ width: 1440, height: 1000 });

// ---------- D. Two tabs simultaneously (same session) ----------
const page2 = await b.context.newPage();
await page2.goto(srv.base + '/app/#edit', { waitUntil: 'networkidle' });
await page2.waitForTimeout(500);
await shot(page2, 'second-tab-same-editor-url', 'opened a 2nd tab directly at #edit in the same browser context');
// edit business name in tab 2
const nameField2 = page2.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
const nameFieldVisible2 = await nameField2.isVisible().catch(() => false);
note('Tab2 preview-iframe business.name editable field visible without re-picking a template: ' + nameFieldVisible2);
await shot(page2, 'second-tab-editor-state', 'tab2 editor state (draft loaded from localStorage independently?)');
await page2.close();

// ---------- E. Returning client: publish a site, logout, log back in with same email, edit + republish ----------
await page.bringToFront();
await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await acceptCookie(page);
await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
await page.waitForURL(/#edit$/);
await page.locator('#btn-close-drawer').click().catch(() => {});
await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
const returnSlug = 'qa-returning-client-' + Date.now().toString(36);
await page.locator('#input-slug').fill(returnSlug);
await page.locator('#btn-publish-continue').click();
await page.locator('#form-auth-email').waitFor({ state: 'visible' });
const returnEmail = 'qa-returning-' + Date.now() + '@example.com';
await page.locator('#input-email').fill(returnEmail);
await page.locator('#btn-send-magic').click();
await page.locator('#dev-link').waitFor({ state: 'visible' });
const firstDevHref = await page.locator('#dev-link').getAttribute('href');
await page.locator('#dev-link').click();
await page.locator('#modal-success').waitFor({ state: 'visible' });
await page.locator('#btn-pay-publish').click();
await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
await page.locator('#btn-success-close').click();
await shot(page, 'returning-client-site-published', 'site published for ' + returnEmail + ' / ' + returnSlug);

// NOTE: #btn-logout lives in #app-header, which showScreen() hides while route==='edit'
// (editor-topbar has no logout/dashboard affordance) - must leave editor first.
const logoutVisibleInEditor = await page.locator('#btn-logout').isVisible().catch(() => false);
note('btn-logout visible while still in editor (#edit route) right after publish: ' + logoutVisibleInEditor);
if (!logoutVisibleInEditor) {
  defect('medium', 'Niciun acces la cont (deconectare/proiectele mele) din interiorul editorului', 'editor-topbar (afișat pe ruta #edit) nu conține #btn-logout sau #nav-dashboard - acestea există doar în #app-header, ascuns explicit de showScreen() cât timp name===\'edit\' (builder/app.js showScreen). Utilizatorul trebuie să apese Înapoi (spre catalogul de designuri) ca să ajungă la Deconectare sau Proiectele mele.');
  await page.locator('#btn-back-templates').click();
  await page.waitForTimeout(400);
}
await shot(page, 'returning-client-back-to-header', 'back to a screen where #app-header (logout) is available');

// logout
await page.locator('#btn-logout').click();
await page.waitForTimeout(400);
await shot(page, 'returning-client-after-logout', 'logged out');

// log back in with the SAME email via a fresh publish attempt to trigger auth (or via dashboard route requiring auth)
await page.goto(srv.base + '/app/#dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot(page, 'returning-client-dashboard-logged-out', 'visiting #dashboard while logged out');

// Re-authenticate with the SAME email via the plain email-login form (no need to publish a 2nd site)
// The builder has no standalone "login" screen outside the publish flow, so we drive
// POST /api/auth/email directly (same call #btn-send-magic makes) to get a fresh dev link.
const authResp = await page.request.post(srv.base + '/api/auth/email', { data: { email: returnEmail } });
const authJson = await authResp.json();
note('Re-auth POST /api/auth/email status=' + authResp.status() + ' devLink=' + authJson.devLink);
await page.goto(new URL(authJson.devLink, srv.base).href, { waitUntil: 'networkidle' });
await shot(page, 'returning-client-relogin-result', 're-authenticated with same email ' + returnEmail + ' via magic link');

// Now go to dashboard as this returning user and verify the FIRST site is visible + editable
await page.goto(srv.base + '/app/#dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const siteCount = await page.locator('.site-card').count();
note('Returning client dashboard: site-card count after re-login = ' + siteCount + ' (expect 1: ' + returnSlug + ')');
await shot(page, 'returning-client-dashboard-both-sites', 'dashboard after re-login, site-card count=' + siteCount);

// edit the FIRST (original) site and confirm it loads, make a change, republish
const firstCard = page.locator('.site-card', { hasText: returnSlug });
const firstCardExists = await firstCard.count();
note('First site card (' + returnSlug + ') found on dashboard after re-login: ' + firstCardExists);
if (firstCardExists) {
  await firstCard.locator('button:has-text("Editează")').click();
  await page.waitForURL(/#edit$/);
  await page.waitForTimeout(600);
  await shot(page, 'returning-client-edit-original-site', 'reopened original site in editor for further edits');
  await page.locator('#btn-close-drawer').click().catch(() => {});
  const nameFieldR = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
  await nameFieldR.click();
  await nameFieldR.fill('Portofoliu Client Revenit');
  await nameFieldR.blur();
  await shot(page, 'returning-client-edited-original-site', 'edited business name on the original returning-client site');
  await page.locator('#btn-publish').click();
  // For an already-paid site, app.js skips modal-publish entirely (doActualPublish ->
  // execPublish -> showSuccessScreen) and republishes silently straight to modal-success.
  await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 10000 });
  await shot(page, 'returning-client-republish-success', 'republish for already-paid site skipped modal-publish and went straight to modal-success (silent republish by design)');
} else {
  defect('high', 'Site-ul publicat inițial de un client existent nu apare pe dashboard după logout+re-login', 'Client existent nu-și regăsește site-ul publicat anterior la reautentificare cu același email', null);
}

fs.writeFileSync(DIR + '/part3-log-final.json', JSON.stringify(log, null, 2));
console.log('PART3 DONE');
await b.close();
await srv.close();
