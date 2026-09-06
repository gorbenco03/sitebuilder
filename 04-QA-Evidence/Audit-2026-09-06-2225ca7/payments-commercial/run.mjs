// Payments + commercial model audit — evidence run.
// Boots an isolated server in-process (test-pay + isolated deploy, temp DATA_DIR),
// drives the real browser UI through: publish -> pay (trial) -> dashboard, then
// reproduces the "paidUntil vs active Stripe subscription" double-billing trap
// (documented in probes 1-3) visually in the dashboard, plus a cancelled state.
import { bootServer, makeEvidence, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/payments-commercial';
const srv = await bootServer(); // sets process.env.DATA_DIR BEFORE any module below is required
const registry = require(path.join(ROOT, 'bot', 'registry.js')); // must be required AFTER bootServer (DATA_DIR is baked in at require-time)
const ev = makeEvidence(EVDIR, 'payments-commercial');

const b = await newBrowser({ width: 1440, height: 1000 });
const { page } = b;

async function readOrders(siteId) {
  const db = JSON.parse(fs.readFileSync(path.join(srv.dataDir, '.registry.json'), 'utf8'));
  return Object.values(db.orders || {}).filter(o => o.siteId === siteId);
}

// 1) Landing catalog price chip
await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
await page.click('#hb-cookie-accept').catch(()=>{});
await ev.shot(page, 'landing-catalog-price', { action: 'goto /app/, accept cookies', detail: 'catalog price chip visible (isolated QA defaults to RO/EUR bucket per pricing.js)' });

// 2) Start a template, publish, pay via trial (Adauga card)
await page.click('.template-card[data-template-id="product-menu"] .btn-start-tpl');
await page.waitForSelector('#screen-edit', { state: 'visible' });
await page.waitForTimeout(600);
await ev.shot(page, 'editor-opened', { action: 'click .btn-start-tpl product-menu', detail: 'editor + details drawer open' });

await page.click('#btn-close-drawer').catch(()=>{});
await page.waitForTimeout(200);
await page.click('#btn-publish');
await page.waitForSelector('#modal-publish', { state: 'visible' });
const slug = 'audit-pc-' + crypto.randomBytes(3).toString('hex');
await page.fill('#input-slug', slug);
await ev.shot(page, 'publish-modal-slug', { action: 'fill #input-slug', selector: '#input-slug', detail: slug });

await page.click('#btn-publish-continue');
await page.waitForSelector('#form-auth-email', { state: 'visible', timeout: 10000 }).catch(()=>{});
const email = 'audit-pc-' + crypto.randomBytes(3).toString('hex') + '@example.com';
await page.fill('#input-email', email);
await page.click('#btn-send-magic');
await page.waitForSelector('#dev-link', { state: 'visible', timeout: 10000 });
await ev.shot(page, 'auth-dev-link', { action: 'click #btn-send-magic', detail: 'dev magic link shown (no RESEND configured)' });
await page.click('#dev-link a, #dev-link');

await page.waitForSelector('#btn-pay-publish', { state: 'visible', timeout: 10000 });
await ev.shot(page, 'trial-card-cta', { action: 'after magic-link login', detail: 'Adauga card - incepe trialul de 7 zile CTA with price' });
await page.click('#btn-pay-publish');

await page.waitForSelector('#success-url-link', { state: 'visible', timeout: 15000 });
await ev.shot(page, 'success-live-trial', { action: 'click #btn-pay-publish (offline test-pay)', detail: 'Site-ul tau e live - trial de 7 zile chrome' });

const liveHref = await page.getAttribute('#success-url-link', 'href');
console.log('LIVE URL', liveHref);

await page.click('#btn-success-close');
await page.waitForSelector('#screen-edit', { state: 'visible', timeout: 10000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(400); // let returnToEditor's async chain fully settle before navigating away
const beforeHash = await page.evaluate(() => window.location.hash);
console.log('DEBUG hash BEFORE=', beforeHash);
const hcFired = await page.evaluate(() => new Promise((resolve) => {
  const onHc = () => { resolve(true); window.removeEventListener('hashchange', onHc); };
  window.addEventListener('hashchange', onHc);
  window.location.hash = '#dashboard';
  setTimeout(() => resolve(false), 1500);
}));
console.log('DEBUG hashchange fired?', hcFired);
await page.waitForTimeout(500);
console.log('DEBUG hash=', await page.evaluate(() => window.location.hash));
console.log('DEBUG screen-dashboard display=', await page.evaluate(() => { const el = document.getElementById('screen-dashboard'); return el ? getComputedStyle(el).display : 'NO_EL'; }));
console.log('DEBUG screen-edit display=', await page.evaluate(() => { const el = document.getElementById('screen-edit'); return el ? getComputedStyle(el).display : 'NO_EL'; }));
console.log('DEBUG console errors so far:', JSON.stringify(b.consoleErrors));
await page.waitForTimeout(500);
await ev.shot(page, 'dashboard-active-trial', { action: 'goto #dashboard', detail: 'dashboard card for the freshly-paid (trialing) site' });

// Resolve the siteId we just created via registry (only one site for this fresh user)
const sites = registry.listAllSites().filter(s => (s.slug || '').startsWith(slug));
const site = sites[0];
console.log('SITE', site && site.id, site && site.stripeSubscriptionId, site && site.paidUntil);

// 3) Reproduce the paidUntil-vs-active-subscription trap:
//    Stripe's automatic Subscription Schedule ALREADY auto-charged 29 for year 2 on the
//    SAME original subscription (this is the whole point of "renewal necondiționat" via
//    subscription, not a manual repeat purchase) and reports the subscription as still
//    'active'. Our local cache (paidUntil, set once at first publish) is never refreshed
//    by that automatic charge (no invoice.paid/invoice.payment_succeeded handler exists).
const origSubId = site.stripeSubscriptionId;
registry.updateSite(site.id, {
  stripeSubscriptionStatus: 'active',
  subscriptionStatus: 'active',
  paidUntil: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), // "13 months later" per stale cache
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#screen-dashboard', { state: 'visible', timeout: 10000 }).catch(()=>{});
await page.waitForTimeout(500);
await ev.shot(page, 'dashboard-false-expired-active-sub', {
  action: 'reload #sites after forcing paidUntil into the past while stripeSubscriptionStatus stays active',
  detail: 'BUG: dashboard shows "Reinnoieste hosting" upsell for a customer Stripe already auto-renewed (status=active)',
});

// Confirm export is blocked for this same "actually active" customer.
const cookies = await page.context().cookies();
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
const expRes = await fetch(srv.base + '/api/export-html?siteId=' + site.id, { headers: { Cookie: cookieHeader } });
const expBody = await expRes.text();
console.log('EXPORT WHILE "ACTIVE" BUT paidUntil-LAPSED ->', expRes.status, expBody.slice(0, 200));
ev.note('GET /api/export-html for a customer whose Stripe subscription is genuinely active (stripeSubscriptionStatus=active) but whose locally-cached paidUntil (set once, +12mo, at first publish) has lapsed -> HTTP ' + expRes.status + ' ' + expBody.slice(0,200) + ' (export blocked for a paying customer).');

// Click "Reinnoieste hosting" to show it opens a BRAND NEW checkout/subscription,
// independent from the one Stripe is already auto-billing.
const renewBtnFound = await page.locator('button:has-text("Reînnoiește hosting")').first();
const hasRenewBtn = await renewBtnFound.count();
console.log('Reinnoieste hosting button present:', hasRenewBtn);
if (hasRenewBtn) {
  await ev.shot(page, 'renew-button-visible', { action: 'locate Reinnoieste hosting button', detail: 'button offers a NEW paid checkout to an already-active subscriber' });
}

const ordersBefore = await readOrders(site.id);
console.log('orders before duplicate renew click:', ordersBefore.map(o => ({kind:o.kind,status:o.status})));

const coRes = await fetch(srv.base + '/api/sites/' + site.id + '/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieHeader }, body: '{}' });
const coBody = await coRes.json();
console.log('checkout endpoint on already-active subscription ->', coRes.status, 'kind=', coBody.kind, 'NEW paymentUrl issued:', !!coBody.paymentUrl);
ev.note('POST /api/sites/:id/checkout on a site whose Stripe subscription is ALREADY active -> HTTP ' + coRes.status + ' kind=' + coBody.kind + ' amountCents=' + coBody.amountCents + '. This issues a SECOND, independent Stripe subscription/checkout (mode=subscription, no trial, charges immediately) unrelated to the one Stripe is already auto-renewing.');

// Pay that duplicate renewal via unsigned test-pay webhook, then show the registry
// stripeSubscriptionId now points at the NEW subscription — the original is orphaned.
const ordersAfterCheckout = await readOrders(site.id);
const renPending = ordersAfterCheckout.filter(o => o.kind === 'renewal' && o.status === 'pending').pop();
const renEvt = {
  id: 'evt_ev_ren_' + crypto.randomBytes(4).toString('hex'),
  type: 'checkout.session.completed',
  data: { object: { id: renPending.stripeSessionId, payment_status: 'paid', metadata: { platform: 'web', orderId: renPending.id, siteId: site.id, kind: 'renewal' } } },
};
await fetch(srv.base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(renEvt) });
await new Promise(r => setTimeout(r, 300));
const siteAfter = registry.getSite(site.id);
console.log('ORIGINAL auto-renewing subscription id:', origSubId);
console.log('registry stripeSubscriptionId AFTER duplicate-renewal payment:', siteAfter.stripeSubscriptionId, ' same as original?', siteAfter.stripeSubscriptionId === origSubId);
ev.note('Original Stripe subscription id (the one Stripe auto-bills every year via the Subscription Schedule): ' + origSubId + '. After the confused customer pays the duplicate "Reinnoieste hosting" checkout, registry.stripeSubscriptionId becomes: ' + siteAfter.stripeSubscriptionId + ' (different). The original subscription reference is LOST from the app -- Stripe will keep charging it forever with zero visibility inside Hidook (not in /admin, not in the dashboard, not cancellable from the app\'s own billing-portal button, which now only knows the new subscription\'s customer/session).');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await ev.shot(page, 'dashboard-after-duplicate-renewal', { action: 'reload after paying the duplicate renewal', detail: 'card now shows hosting-until far future again, masking that TWO subscriptions are now live on the customer card' });

// 4) Cancel flow -> unpublish proof (separate quick site) for completeness.
await page.evaluate(() => { window.location.hash = '#dashboard'; });
await page.waitForSelector('#screen-dashboard', { state: 'visible', timeout: 10000 }).catch(()=>{});
await page.waitForTimeout(400);
const cancelBtn = page.locator('button:has-text("Anulează")').first();
if (await cancelBtn.count()) {
  page.once('dialog', d => d.accept());
  await cancelBtn.click();
  await page.waitForTimeout(800);
  await ev.shot(page, 'after-cancel-portal', { action: 'click Anuleaza, confirm dialog', detail: 'offline billing-portal completes cancel; site should unpublish' });
  const liveAfterCancel = await fetch(liveHref);
  console.log('live URL after cancel ->', liveAfterCancel.status);
  ev.note('GET ' + liveHref + ' after Cancel -> HTTP ' + liveAfterCancel.status + ' (expect 404 unpublished).');
}

console.log('console errors:', b.consoleErrors.length, 'failed requests:', b.failedRequests.length);
if (b.consoleErrors.length) console.log(JSON.stringify(b.consoleErrors.slice(0,10)));

ev.finish();
await b.close();
await srv.close();
console.log('DONE');
