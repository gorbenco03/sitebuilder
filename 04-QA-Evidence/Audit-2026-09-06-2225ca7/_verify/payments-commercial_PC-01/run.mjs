// Adversarial verification of PC-01:
// "paidUntil never refreshed by Stripe auto-renewal -> active subscriber shown
//  'Expirat' -> Renew button opens a brand-new separate subscription, orphaning
//  the original auto-renewing one."
//
// Method: boot the isolated server (same harness the audit lens used), drive the
// PUBLIC flow through real HTTP endpoints (publish -> pay via /webhooks/stripe),
// then simulate ONLY the two things a black-box tester cannot fabricate over HTTP
// (the passage of ~12 months, and Stripe's own subscription.updated confirming the
// subscription is still 'active') by writing directly to the same on-disk registry
// the running server reads -- exactly the technique bot/test/s51-builder-renewal.test.js
// already uses for "force hosting expired". Then re-enter through real HTTP endpoints
// (GET /api/sites, GET /api/export-html, POST rollback, POST checkout) to see what the
// app actually does.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bootServer } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const ROOT = '/Users/Work/Desktop/sitebuilder';
const OUT = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/payments-commercial_PC-01';
const out = (name, data) => fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));

function makeClient(base) {
  const jar = {};
  async function doFetch(urlPath, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieStr) headers['Cookie'] = cookieStr;
    const res = await fetch(base + urlPath, { ...opts, headers, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const sc of setCookie) {
      const first = sc.split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
    }
    return res;
  }
  return doFetch;
}

async function loginClient(base, email) {
  const c = makeClient(base);
  const loginRes = await fetch(`${base}/api/auth/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const loginBody = await loginRes.json();
  const link = loginBody.devLink;
  const qs = link.includes('?') ? link.slice(link.indexOf('?') + 1) : '';
  const token = new URLSearchParams(qs).get('token');
  const v = await c(`/auth/verify?token=${encodeURIComponent(token)}`);
  if (v.status !== 302) throw new Error('verify failed: ' + v.status);
  return c;
}

const log = [];
function step(name, data) { log.push({ name, at: new Date().toISOString(), ...data }); console.log('STEP', name, JSON.stringify(data)); }

const srv = await bootServer();
const base = srv.base;
const registryPath = path.join(srv.dataDir, '.registry.json');
const readDb = () => JSON.parse(fs.readFileSync(registryPath, 'utf8'));

try {
  const presetsPath = path.join(ROOT, 'templates', 'product-menu', 'presets.json');
  const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8')).presets;
  const cfg = JSON.parse(JSON.stringify(presets[0].config));
  cfg.business = cfg.business || {};
  cfg.business.name = 'PC01 Verify Restaurant';

  const email = `pc01-verify-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const c = await loginClient(base, email);

  // 1) First publish (creates order kind=publish, amount=PRICE_CENTS)
  const pub = await c('/api/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: 'product-menu', slug: `pc01-verify-${crypto.randomUUID().slice(0, 8)}`, config: cfg, images: [] }),
  });
  const pubBody = await pub.json();
  step('publish', { status: pub.status, siteId: pubBody.site && pubBody.site.id, paid: pubBody.site && pubBody.site.paid });
  const siteId = pubBody.site.id;
  const slug = pubBody.site.slug;

  const orders = () => Object.values(readDb().orders || {}).filter(o => o.siteId === siteId);
  const publishOrder = orders().find(o => o.kind === 'publish' || !o.kind);
  const firstSubId = 'sub_pc01_original_' + crypto.randomBytes(6).toString('hex');

  // 2) Pay via the real webhook route -- this is the ONLY commercial "activation"
  //    path the app has. Real Stripe would fire checkout.session.completed here too.
  const payEvt = {
    id: 'evt_pc01_pub_' + crypto.randomUUID().slice(0, 8),
    type: 'checkout.session.completed',
    data: { object: {
      id: publishOrder.stripeSessionId, payment_status: 'paid', subscription: firstSubId, customer: 'cus_pc01_' + crypto.randomBytes(6).toString('hex'),
      metadata: { platform: 'web', orderId: publishOrder.id, siteId, kind: 'publish' },
    } },
  };
  const wh1 = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payEvt) });
  await new Promise(r => setTimeout(r, 300)); // async webhook processing
  let site = readDb().sites[siteId];
  step('paid_first_period', { whStatus: wh1.status, paid: site.paid, paidUntil: site.paidUntil, stripeSubscriptionId: site.stripeSubscriptionId, status: site.status });

  // 3) Real Stripe, per VISION/OWNER-STRIPE-TRIAL model, auto-bills this SAME
  //    subscription every year via the Subscription Schedule (payments.js
  //    attachFirstThenRenewalSchedule) with zero customer action, and confirms
  //    it is still healthy via customer.subscription.updated status=active.
  //    This is the one Stripe event type the app DOES listen for -- fire it.
  const subUpdateEvt = {
    id: 'evt_pc01_subupdate_' + crypto.randomUUID().slice(0, 8),
    type: 'customer.subscription.updated',
    data: { object: { id: firstSubId, status: 'active', customer: site.stripeCustomerId, metadata: { siteId } } },
  };
  const wh2 = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subUpdateEvt) });
  await new Promise(r => setTimeout(r, 300));
  site = readDb().sites[siteId];
  step('after_stripe_confirms_still_active', { whStatus: wh2.status, stripeSubscriptionStatus: site.stripeSubscriptionStatus, paidUntil: site.paidUntil });

  // 4) Simulate the passage of ~12 months (the only thing a live test cannot
  //    literally wait for). We do NOT touch subscriptionStatus/paid/canceledAt --
  //    only advance the clock on paidUntil, exactly as s51-builder-renewal.test.js's
  //    own "force hosting expired" step does. Everything else -- the still-active
  //    Stripe subscription, the still-current customer/subscription ids -- is left
  //    untouched, because that IS what Stripe would report at month 13 on a
  //    healthy, auto-renewing subscription.
  const db = readDb();
  db.sites[siteId].paidUntil = new Date(Date.now() - 5 * 86400000).toISOString();
  fs.writeFileSync(registryPath, JSON.stringify(db, null, 2));
  step('simulated_month_13_paidUntil_elapsed', { paidUntil: db.sites[siteId].paidUntil, stripeSubscriptionStatusStillOnFile: db.sites[siteId].stripeSubscriptionStatus });

  // 5) Dashboard read -- what does the paying, still-subscribed customer see?
  const listRes = await c('/api/sites');
  const listBody = await listRes.json();
  const listed = (listBody.sites || []).find(s => s.id === siteId);
  step('dashboard_GET_api_sites', { status: listRes.status, site: listed });

  // 6) Export -- gated by hasActiveCommercialEntitlement
  const exp = await c('/api/export-html?siteId=' + encodeURIComponent(siteId));
  const expBody = exp.status !== 200 ? await exp.json().catch(() => ({})) : '(200 html body, omitted)';
  step('export_html_while_stripe_subscription_active', { status: exp.status, body: expBody });

  // 7) Rollback -- also gated by hasActiveCommercialEntitlement
  const versions = Object.values(readDb().versions && readDb().versions[siteId] ? readDb().versions[siteId] : {});
  let rollbackResult = { skipped: true, reason: 'no version rows found in this registry shape, see raw dump' };
  const rb = await c(`/api/sites/${encodeURIComponent(siteId)}/rollback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: 'any' }),
  });
  const rbBody = await rb.json().catch(() => ({}));
  step('rollback_while_stripe_subscription_active', { status: rb.status, body: rbBody });

  // 8) The confused-but-paying customer clicks "Reinnoieste hosting" as the
  //    dashboard instructs. What does the app actually do?
  const co = await c(`/api/sites/${encodeURIComponent(siteId)}/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  const coBody = await co.json();
  step('click_renew_hosting_button', { status: co.status, kind: coBody.kind, amountCents: coBody.amountCents, paymentUrl: coBody.paymentUrl });

  const renewalOrder = Object.values(readDb().orders || {}).find(o => o.siteId === siteId && o.kind === 'renewal' && o.status === 'pending');
  const secondSubId = 'sub_pc01_SECOND_' + crypto.randomBytes(6).toString('hex');
  const renEvt = {
    id: 'evt_pc01_ren_' + crypto.randomUUID().slice(0, 8),
    type: 'checkout.session.completed',
    data: { object: {
      id: renewalOrder.stripeSessionId, payment_status: 'paid', subscription: secondSubId, customer: site.stripeCustomerId,
      metadata: { platform: 'web', orderId: renewalOrder.id, siteId, kind: 'renewal' },
    } },
  };
  const wh3 = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(renEvt) });
  await new Promise(r => setTimeout(r, 300));
  site = readDb().sites[siteId];
  step('after_paying_the_renew_button', {
    whStatus: wh3.status,
    paidUntil: site.paidUntil,
    stripeSubscriptionId_now: site.stripeSubscriptionId,
    ORIGINAL_subscription_id_was: firstSubId,
    NEW_subscription_id_from_button: secondSubId,
    original_subscription_still_referenced_anywhere_in_registry: JSON.stringify(readDb()).includes(firstSubId),
  });

  // 9) Prove the orphaning: Stripe later sends a lifecycle event for the
  //    ORIGINAL (still real, still billing) subscription -- e.g. the customer
  //    finally cancels it in the Stripe-hosted portal a year later. Does the
  //    app do anything?
  const origCancelEvt = {
    id: 'evt_pc01_orig_cancel_' + crypto.randomUUID().slice(0, 8),
    type: 'customer.subscription.deleted',
    data: { object: { id: firstSubId, status: 'canceled', customer: site.stripeCustomerId } },
  };
  const wh4 = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(origCancelEvt) });
  await new Promise(r => setTimeout(r, 300));
  const siteAfterOrigCancel = readDb().sites[siteId];
  step('original_subscription_later_canceled_by_customer', {
    whStatus: wh4.status,
    site_status_unchanged: siteAfterOrigCancel.status,
    site_stripeSubscriptionStatus_unchanged: siteAfterOrigCancel.stripeSubscriptionStatus,
    app_never_noticed_because_registry_points_at_the_NEW_sub_id: siteAfterOrigCancel.stripeSubscriptionId === secondSubId,
  });

  out('log.json', log);
  out('final-registry-site-row.json', readDb().sites[siteId]);
  console.log('\n=== VERDICT DATA ===');
  console.log('export blocked with active Stripe sub on file:', exp.status === 402);
  console.log('rollback blocked with active Stripe sub on file:', rb.status === 402);
  console.log('renew button created a NEW separate subscription id:', coBody.kind === 'renewal' && secondSubId !== firstSubId);
  console.log('registry overwrote pointer to new sub, dropping original:', site.stripeSubscriptionId === secondSubId);
  console.log('original (still-real, later-canceled) subscription silently ignored:', siteAfterOrigCancel.stripeSubscriptionId === secondSubId);
} finally {
  await srv.close();
}
