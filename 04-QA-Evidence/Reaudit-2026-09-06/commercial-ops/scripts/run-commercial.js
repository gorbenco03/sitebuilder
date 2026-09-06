'use strict';
/**
 * Re-audit 2026-09-06 — commercial/payments HTTP-surface driver.
 * Boots an isolated Hidook server (HIDOOK_TEST_PAY, HIDOOK_ISOLATED_DEPLOY, temp
 * DATA_DIR, no real keys) exactly like _audit-harness.mjs, then drives the real
 * HTTP surface (fetch) as a customer would: signup, template pick, pay, cancel,
 * come back, simulate real Stripe renewal/failure events, and deliberately try
 * to reproduce the double-subscription defect and its dashboard-label lie.
 *
 * Output: JSON log to stdout AND to evidence/run-commercial.json.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a210a955143021a0f';
const EVID = path.join(ROOT, '04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/evidence');

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-reaudit-'));
process.env.SERVER_SECRET = 'reaudit-' + crypto.randomBytes(12).toString('hex');
for (const k of ['PUBLIC_URL', 'HIDOOK_FAKE_DEPLOY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'VERCEL_TOKEN', 'NETLIFY_TOKEN', 'CLOUDFLARE_API_TOKEN', 'TELEGRAM_BOT_TOKEN', 'RESEND_API_KEY']) {
    delete process.env[k];
}

const results = { startedAt: new Date().toISOString(), dataDir: process.env.DATA_DIR, steps: [] };
function record(name, data) {
    const entry = { name, at: new Date().toISOString(), data };
    results.steps.push(entry);
    console.log('STEP', name, JSON.stringify(data).slice(0, 500));
}

let cookie = '';
async function api(method, urlPath, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    if (opts.headers) Object.assign(headers, opts.headers);
    const res = await fetch(BASE + urlPath, {
        method,
        headers,
        redirect: 'manual',
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie && opts.keepCookie !== false) cookie = setCookie.split(';')[0];
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch (_) { /* not json (redirect etc) */ }
    return { status: res.status, headers: res.headers, json, text, location: res.headers.get('location') };
}

let BASE;

async function main() {
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    BASE = 'http://127.0.0.1:' + server.address().port;
    record('server_booted', { base: BASE });

    // ── 1. Signup (magic link, devLink returned since NODE_ENV!=='production') ──
    const email = 'audit-customer@example.com';
    const authResp = await api('POST', '/api/auth/email', { email });
    record('auth_email', { status: authResp.status, devLink: authResp.json && authResp.json.devLink });
    const devLink = authResp.json && authResp.json.devLink;
    if (!devLink) throw new Error('No devLink returned — cannot authenticate as a test customer.');
    const token = new URL(devLink, BASE).searchParams.get('token');
    const verifyResp = await api('GET', '/auth/verify?token=' + encodeURIComponent(token));
    record('auth_verify', { status: verifyResp.status, location: verifyResp.location, gotCookie: !!cookie });

    const meResp = await api('GET', '/api/me');
    record('me', { status: meResp.status, user: meResp.json && meResp.json.user });

    // ── 2. Choose template, edit, publish (unpaid draft -> checkout) ──────────
    const templatesResp = await api('GET', '/api/templates');
    const tplList = (templatesResp.json && templatesResp.json.templates) || [];
    record('templates_list', { count: tplList.length, ids: tplList.map(t => t.id) });

    const presetsRaw = fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8');
    const presetConfig = JSON.parse(presetsRaw).presets[0].config;
    presetConfig.business = presetConfig.business || {};
    presetConfig.business.name = 'Audit Cabinet ' + Date.now();

    const publishResp = await api('POST', '/api/publish', {
        templateId: 'professionals',
        config: presetConfig,
        images: [],
        slug: 'audit-cabinet-' + Date.now(),
    });
    record('publish_unpaid_draft', {
        status: publishResp.status,
        site: publishResp.json && { id: publishResp.json.site.id, status: publishResp.json.site.status, paid: publishResp.json.site.paid },
        paymentUrl: publishResp.json && publishResp.json.paymentUrl,
    });
    const siteId = publishResp.json.site.id;
    const paymentUrl1 = publishResp.json.paymentUrl;
    const sessionId1 = /test-checkout=([^&]+)/.exec(paymentUrl1)[1];

    // ── 3. Pay the trial (test-pay complete = first commercial charge in test mode) ──
    const payResp = await api('POST', '/api/test-pay/complete', { sessionId: sessionId1 });
    record('test_pay_complete_first', { status: payResp.status, site: payResp.json });

    let site = registry.getSite(siteId);
    record('site_after_first_pay', {
        paid: site.paid, status: site.status, paidUntil: site.paidUntil,
        stripeSubscriptionId: site.stripeSubscriptionId, stripeCustomerId: site.stripeCustomerId,
        stripeSubscriptionStatus: site.stripeSubscriptionStatus || null,
    });

    // ── 4. Simulate the real Stripe subscription.created event (webhook lag fix path) ──
    const subId = site.stripeSubscriptionId; // synthesized deterministically by _storeStripeBillingIds
    const custId = site.stripeCustomerId;
    const subCreatedEvent = {
        id: 'evt_sub_created_' + crypto.randomBytes(6).toString('hex'),
        type: 'customer.subscription.created',
        data: { object: { id: subId, status: 'active', customer: custId, metadata: { siteId } } },
    };
    const whResp1 = await api('POST', '/webhooks/stripe', subCreatedEvent);
    record('webhook_subscription_created', { status: whResp1.status });
    await sleep(50);
    site = registry.getSite(siteId);
    record('site_after_subscription_created', {
        stripeSubscriptionStatus: site.stripeSubscriptionStatus,
        subscriptionStatus: site.subscriptionStatus,
    });

    // ── 5. Renewal via real Stripe invoice.paid event (subscription_cycle) — must extend once, idempotently ──
    const paidUntilBeforeRenewal = site.paidUntil;
    const invoiceId1 = 'in_test_' + crypto.randomBytes(6).toString('hex');
    const invoicePaidEvent = {
        id: 'evt_invoice_paid_' + crypto.randomBytes(6).toString('hex'),
        type: 'invoice.payment_succeeded',
        data: { object: { id: invoiceId1, subscription: subId, billing_reason: 'subscription_cycle', customer: custId } },
    };
    const whResp2 = await api('POST', '/webhooks/stripe', invoicePaidEvent);
    record('webhook_invoice_paid_1', { status: whResp2.status });
    await sleep(50);
    site = registry.getSite(siteId);
    record('site_after_renewal_1', { paidUntilBefore: paidUntilBeforeRenewal, paidUntilAfter: site.paidUntil });

    // Replay the SAME event id (duplicate webhook delivery) — must NOT extend again.
    const whResp3 = await api('POST', '/webhooks/stripe', invoicePaidEvent);
    record('webhook_invoice_paid_1_REPLAY_same_event_id', { status: whResp3.status });
    await sleep(50);
    const siteAfterReplay = registry.getSite(siteId);
    record('site_after_renewal_1_replay', { paidUntilAfterReplay: siteAfterReplay.paidUntil, unchanged: siteAfterReplay.paidUntil === site.paidUntil });

    // A second DISTINCT invoice (a genuine second cycle) — should extend again exactly once.
    const invoiceId2 = 'in_test_' + crypto.randomBytes(6).toString('hex');
    const invoicePaidEvent2 = {
        id: 'evt_invoice_paid_' + crypto.randomBytes(6).toString('hex'),
        type: 'invoice.paid',
        data: { object: { id: invoiceId2, subscription: subId, billing_reason: 'subscription_cycle', customer: custId } },
    };
    const paidUntilBefore2 = site.paidUntil;
    await api('POST', '/webhooks/stripe', invoicePaidEvent2);
    await sleep(50);
    const siteAfter2 = registry.getSite(siteId);
    record('site_after_renewal_2_distinct_invoice', { before: paidUntilBefore2, after: siteAfter2.paidUntil });

    // ── 6. Reproduce the audit's worst finding: stale local paidUntil, subscription still active ──
    // Force paidUntil into the past directly (simulating webhook lag / stale local record)
    // while the Stripe-truth subscription status field stays 'active'.
    const beforeForce = registry.getSite(siteId);
    registry.updateSite(siteId, { paidUntil: new Date(Date.now() - 24 * 3600 * 1000).toISOString() });
    const forced = registry.getSite(siteId);
    record('forced_stale_expired_while_active', {
        paidUntil: forced.paidUntil,
        stripeSubscriptionStatus: forced.stripeSubscriptionStatus,
        isHostingExpiredClientSide: (function (s) {
            if (s.status === 'expired') return true;
            const t = Date.parse(s.paidUntil || '');
            return Number.isFinite(t) && t < Date.now();
        })(forced),
    });

    // Attempt A: click "Reînnoiește hosting" — POST /api/sites/:id/checkout
    const renewAttempt = await api('POST', '/api/sites/' + encodeURIComponent(siteId) + '/checkout', {});
    record('ATTEMPT_A_renewal_checkout_while_active', { status: renewAttempt.status, body: renewAttempt.json });

    // Attempt B: bypass via the ordinary edit+publish flow (/api/publish with siteId set) —
    // this is the path a customer takes just by editing content and hitting Publică again,
    // NOT through the dashboard "Reînnoiește hosting" button.
    const editedConfig = JSON.parse(JSON.stringify(presetConfig));
    editedConfig.business.tagline = 'Edited during stale-expired repro ' + Date.now();
    const republishAttempt = await api('POST', '/api/publish', {
        siteId,
        templateId: 'professionals',
        config: editedConfig,
        images: [],
    });
    record('ATTEMPT_B_edit_and_republish_while_active_but_stale', {
        status: republishAttempt.status,
        paymentUrl: republishAttempt.json && republishAttempt.json.paymentUrl,
        site: republishAttempt.json && republishAttempt.json.site && {
            status: republishAttempt.json.site.status, paid: republishAttempt.json.site.paid,
        },
        fullBody: republishAttempt.json,
    });

    // Attempt C: repeat attempt A twice back-to-back (race / idempotency of the guard itself)
    const [ra1, ra2] = await Promise.all([
        api('POST', '/api/sites/' + encodeURIComponent(siteId) + '/checkout', {}),
        api('POST', '/api/sites/' + encodeURIComponent(siteId) + '/checkout', {}),
    ]);
    record('ATTEMPT_C_concurrent_renewal_checkout', { ra1: { status: ra1.status, code: ra1.json && ra1.json.code }, ra2: { status: ra2.status, code: ra2.json && ra2.json.code } });

    // ── 7. Dashboard truth check: GET /api/sites while forced-stale — what does the API/UI see? ──
    const sitesListResp = await api('GET', '/api/sites');
    const listedSite = (sitesListResp.json.sites || []).find(s => s.id === siteId);
    record('dashboard_api_state_while_stale_but_active', listedSite);

    // ── 8. Failed payment: invoice.payment_failed — does the record capture it, is anything user-facing? ──
    // Reset paidUntil back to future first so this phase is a clean failed-payment test independent of #6.
    registry.updateSite(siteId, { paidUntil: new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString() });
    const failInvoiceId = 'in_test_fail_' + crypto.randomBytes(6).toString('hex');
    const failEvent = {
        id: 'evt_invoice_failed_' + crypto.randomBytes(6).toString('hex'),
        type: 'invoice.payment_failed',
        data: { object: { id: failInvoiceId, subscription: subId, customer: custId, attempt_count: 1 } },
    };
    await api('POST', '/webhooks/stripe', failEvent);
    await sleep(50);
    let siteAfterFail = registry.getSite(siteId);
    record('site_after_invoice_payment_failed', {
        paymentFailedAt: siteAfterFail.paymentFailedAt || null,
        paymentFailedCount: siteAfterFail.paymentFailedCount || null,
        status: siteAfterFail.status,
        stripeSubscriptionStatus: siteAfterFail.stripeSubscriptionStatus,
    });
    // Also apply the matching subscription.updated -> past_due (Stripe does this near-simultaneously)
    const pastDueEvent = {
        id: 'evt_sub_pastdue_' + crypto.randomBytes(6).toString('hex'),
        type: 'customer.subscription.updated',
        data: { object: { id: subId, status: 'past_due', customer: custId, metadata: { siteId } } },
    };
    await api('POST', '/webhooks/stripe', pastDueEvent);
    await sleep(50);
    siteAfterFail = registry.getSite(siteId);
    record('site_after_past_due', { status: siteAfterFail.status, stripeSubscriptionStatus: siteAfterFail.stripeSubscriptionStatus, paidUntil: siteAfterFail.paidUntil });

    // What does the dashboard-facing API return now? (raw JSON the client badge logic consumes)
    const sitesResp2 = await api('GET', '/api/sites');
    const listedSite2 = (sitesResp2.json.sites || []).find(s => s.id === siteId);
    record('dashboard_api_state_during_past_due', listedSite2);
    // Invoice history + admin billing label surface
    const invoicesResp = await api('GET', '/api/sites/' + encodeURIComponent(siteId) + '/invoices');
    record('invoice_history_during_past_due', invoicesResp.json);

    // ── 9. Retries exhausted: Stripe gives up -> subscription.updated status=unpaid ──
    const unpaidEvent = {
        id: 'evt_sub_unpaid_' + crypto.randomBytes(6).toString('hex'),
        type: 'customer.subscription.updated',
        data: { object: { id: subId, status: 'unpaid', customer: custId, metadata: { siteId } } },
    };
    await api('POST', '/webhooks/stripe', unpaidEvent);
    await sleep(50);
    const siteAfterUnpaid = registry.getSite(siteId);
    record('site_after_retries_exhausted_unpaid', {
        status: siteAfterUnpaid.status, paid: siteAfterUnpaid.paid, paidUntil: siteAfterUnpaid.paidUntil,
        stripeSubscriptionStatus: siteAfterUnpaid.stripeSubscriptionStatus, url: siteAfterUnpaid.url,
    });
    const sitesResp3 = await api('GET', '/api/sites');
    const listedSite3 = (sitesResp3.json.sites || []).find(s => s.id === siteId);
    record('dashboard_api_state_after_unpaid_unpublish', listedSite3);
    // Reproduce client-side badge logic exactly as builder/app.js does (copied verbatim from source read).
    record('client_badge_simulation_after_unpaid', simulateBadge(listedSite3));

    // ── 10. Currency with NO Cloudflare country header at all ─────────────────
    // Boot-time isolatedDevBoot() is true here (HIDOOK_ISOLATED_DEPLOY=1) which forces
    // an RO/EUR default even with no CF header - that masks the real production gap.
    // Test the pricing module directly the way server.js#getPricingFromRequest does,
    // for both the isolated-dev boot (current process) and a simulated real-production
    // boot (temporarily flip env), to separate "what the harness shows" from "what a
    // real Railway deployment without Cloudflare in front would show".
    const pricing = require(path.join(ROOT, 'bot', 'pricing.js'));
    const noHeaderReq = { headers: {} };
    record('pricing_isolated_dev_boot_no_cf_header', pricing.getPricingFromRequest(noHeaderReq));
    const roAcceptLang = { headers: { 'accept-language': 'ro-RO,ro;q=0.9' } };
    record('pricing_isolated_dev_boot_ro_accept_language', pricing.getPricingFromRequest(roAcceptLang));

    const savedIso = process.env.HIDOOK_ISOLATED_DEPLOY;
    delete process.env.HIDOOK_ISOLATED_DEPLOY; // simulate real prod: HIDOOK_TEST_PAY still 1 but not "isolated dev boot"
    record('pricing_PROD_LIKE_no_cf_header_no_accept_language', pricing.getPricingFromRequest({ headers: {} }));
    record('pricing_PROD_LIKE_no_cf_header_english_accept_language', pricing.getPricingFromRequest({ headers: { 'accept-language': 'en-US,en;q=0.9' } }));
    record('pricing_PROD_LIKE_no_cf_header_romanian_accept_language', pricing.getPricingFromRequest({ headers: { 'accept-language': 'ro-RO,ro;q=0.9' } }));
    record('pricing_PROD_LIKE_with_cf_header_RO', pricing.getPricingFromRequest({ headers: { 'cf-ipcountry': 'RO' } }));
    process.env.HIDOOK_ISOLATED_DEPLOY = savedIso;

    // ── 11. VAT settings honesty ────────────────────────────────────────────
    const payments = require(path.join(ROOT, 'bot', 'payments.js'));
    record('vat_automatic_tax_enabled_flag', { STRIPE_AUTOMATIC_TAX_env: process.env.STRIPE_AUTOMATIC_TAX || null });

    // ── 12. Cancel then come back ───────────────────────────────────────────
    // Reset to a clean live+active state first.
    registry.updateSite(siteId, { status: 'live', paid: true, paidUntil: new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString(), stripeSubscriptionStatus: 'active', subscriptionStatus: 'active' });
    const subDeletedEvent = {
        id: 'evt_sub_deleted_' + crypto.randomBytes(6).toString('hex'),
        type: 'customer.subscription.deleted',
        data: { object: { id: subId, status: 'canceled', customer: custId, metadata: { siteId } } },
    };
    await api('POST', '/webhooks/stripe', subDeletedEvent);
    await sleep(50);
    const siteAfterCancel = registry.getSite(siteId);
    record('site_after_real_cancel', {
        status: siteAfterCancel.status, url: siteAfterCancel.url, paid: siteAfterCancel.paid,
        paidUntil: siteAfterCancel.paidUntil, stripeSubscriptionStatus: siteAfterCancel.stripeSubscriptionStatus,
        canceledAt: siteAfterCancel.canceledAt,
    });
    // Come back: click renew after a REAL cancel — must be ALLOWED (not falsely blocked).
    const comeBackAttempt = await api('POST', '/api/sites/' + encodeURIComponent(siteId) + '/checkout', {});
    record('come_back_after_real_cancel_should_be_allowed', { status: comeBackAttempt.status, body: comeBackAttempt.json });

    fs.writeFileSync(path.join(EVID, 'run-commercial.json'), JSON.stringify(results, null, 2));
    console.log('DONE. Evidence written to', path.join(EVID, 'run-commercial.json'));
    server.close();
    process.exit(0);
}

function simulateBadge(site) {
    if (!site) return 'NO_SITE';
    function isHostingExpired(s) {
        if (!s) return false;
        if (s.status === 'expired') return true;
        if (s.paidUntil) {
            const t = Date.parse(s.paidUntil);
            if (Number.isFinite(t) && t < Date.now()) return true;
        }
        return false;
    }
    const hostingExpired = isHostingExpired(site);
    let badgeLabel = 'Ciornă (default/fallthrough)';
    if (site.paid && hostingExpired) badgeLabel = 'Expirat';
    else if (site.paid && (site.status === 'live' || site.status === 'active')) badgeLabel = 'Activ';
    else if (site.status === 'live' && !site.paid) badgeLabel = 'Neplătit (legacy unpaid live)';
    else if (site.status === 'expired') badgeLabel = 'Expirat';
    else if (site.status === 'needs-retry') badgeLabel = 'Reîncearcă';
    else if (!site.paid) badgeLabel = 'Neplătit';
    return { badgeLabel, hostingExpired, rawStatus: site.status, rawPaid: site.paid, rawPaidUntil: site.paidUntil };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch((e) => {
    console.error('FATAL', e);
    fs.writeFileSync(path.join(EVID, 'run-commercial.json'), JSON.stringify({ ...results, fatalError: e.message, stack: e.stack }, null, 2));
    process.exit(1);
});
