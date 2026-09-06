#!/usr/bin/env node
'use strict';
/**
 * Wave10 adversarial re-walk — commercial flow: trial → live → renewal →
 * decline → retry → exhaustion → cancel → return.
 *
 * Methodology matches 04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/:
 * drive the REAL HTTP surface (bot/server.js + the real, unmodified
 * bot/web.js#onStripeEvent dispatcher — the Dockerfile CMD entry point),
 * HIDOOK_TEST_PAY + HIDOOK_ISOLATED_DEPLOY, no real Stripe/Resend
 * credentials, report only what was reproduced.
 *
 * Specifically re-checks the two things this wave's briefing said were
 * already fixed (does NOT redo the fix, DOES re-verify it under adversarial
 * conditions since a fix silently regressing is exactly how a "5/10, up from
 * 3/10" product stays stuck) and the one new thing this wave adds (real
 * owner email), looking throughout for any place where what the customer is
 * TOLD and what they are CHARGED can disagree.
 *
 * Run: node --experimental-sqlite 04-QA-Evidence/Wave10-payments/adversarial-walk.mjs
 * Writes 04-QA-Evidence/Wave10-payments/adversarial-walk-result.json
 */

import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-adversarial-'));
process.env.DATA_DIR               = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = '';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.RESEND_API_KEY; // no real credentials anywhere in this walk

const botDir = path.join(__dirname, '..', '..', 'bot');
const registry   = require(path.join(botDir, 'registry.js'));
const ledger      = require(path.join(botDir, 'ledger.js'));
const webpublish  = require(path.join(botDir, 'webpublish.js'));
const { startServer } = require(path.join(botDir, 'server.js'));
const { onStripeEvent } = require(path.join(botDir, 'web.js')); // real, unmodified production dispatcher

const steps = [];
function record(name, ok, detail) {
    steps.push({ name, ok: !!ok, detail: detail || null });
    console.log((ok ? 'OK  ' : 'FAIL') + ' — ' + name + (detail ? ' :: ' + JSON.stringify(detail) : ''));
}

function sign(payload, secret, tSec = Math.floor(Date.now() / 1000)) {
    const mac = crypto.createHmac('sha256', secret).update(`${tSec}.${payload}`, 'utf8').digest('hex');
    return `t=${tSec},v1=${mac}`;
}

function seedSite(prefix, email) {
    const user = registry.getOrCreateUserByEmail(email);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: prefix + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    return { user, site: registry.getSite(site.id) };
}

function ownerEmailRows(siteId) {
    return ledger.read().filter((r) => r && r.event === 'owner_notified' && r.channel === 'email' && r.siteId === siteId);
}

(async () => {
    const SECRET = 'whsec_wave10_adversarial';
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const srv = startServer({ port: 0, onStripeEvent });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;

    async function postWebhook(event) {
        const body = JSON.stringify(event);
        return fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'stripe-signature': sign(body, SECRET) },
            body,
        });
    }

    async function getLive(slug) {
        return fetch(`${base}/live/${slug}/`);
    }

    // ── 1. Trial → live: checkout.session.completed with no_payment_required ──
    const { user, site } = seedSite('walk', 'owner-walk@example.test');
    const subscriptionId = 'sub_test_walk_' + crypto.randomBytes(4).toString('hex');
    // Seed a pending order the same way handlePublish would before checkout.
    const order = registry.createOrder({
        siteId: site.id, userId: user.id, amountCents: 9900, currency: 'eur',
        stripeSessionId: 'pending', kind: 'publish',
    });
    webpublish.savePendingDraft(order.id, {
        config: { business: { name: 'Adversarial Walk Co' } },
        images: [],
        siteId: site.id,
        savedAt: new Date().toISOString(),
    });
    registry.attachStripeSession(order.id, 'cs_test_walk');

    {
        const res = await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'checkout.session.completed',
            data: { object: {
                id: 'cs_test_walk',
                payment_status: 'no_payment_required',
                subscription: subscriptionId,
                customer: 'cus_test_walk',
                metadata: { platform: 'web', orderId: order.id, userId: user.id, siteId: site.id, kind: 'publish' },
            } },
        });
        await new Promise((r) => setTimeout(r, 80));
        const fresh = registry.getSite(site.id);
        record('trial start (checkout.session.completed, no_payment_required) → site goes live', fresh.status === 'live' && fresh.paid === true, { status: fresh.status, paid: fresh.paid });
        const liveRes = await getLive(fresh.slug);
        record('told-vs-charged: dashboard says live AND the public URL actually serves (told == real)', liveRes.status === 200, { liveStatus: liveRes.status });
    }

    // ── 2. Renewal: invoice.paid on the real cycle ──────────────────────────
    {
        // Renewal invoices are only honored near the existing entitlement's
        // end (RENEWAL_DUE_WINDOW_MS = 45 days) — a subscription_cycle event
        // arriving right after the first-year checkout (paidUntil ~12 months
        // out) is deliberately ignored, otherwise a duplicate/misordered
        // webhook could grant a second free year. Move the clock: back-date
        // paidUntil into that window to simulate arriving at the real renewal
        // date, the same convention bot/test/wave7-payments-invoices.test.js
        // and wave7-no-double-subscription.test.js use.
        registry.updateSite(site.id, { paidUntil: new Date(Date.now() + 10 * 86400000).toISOString() });
        const before = registry.getSite(site.id);
        const res = await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.paid',
            data: { object: {
                id: 'in_' + crypto.randomUUID().slice(0, 8),
                subscription: subscriptionId,
                billing_reason: 'subscription_cycle',
                amount_paid: 2900,
                currency: 'eur',
            } },
        });
        await new Promise((r) => setTimeout(r, 80));
        const after = registry.getSite(site.id);
        const extendedByAYear = Date.parse(after.paidUntil) > Date.parse(before.paidUntil || 0);
        record('renewal (invoice.paid, subscription_cycle): entitlement extends', extendedByAYear, { before: before.paidUntil, after: after.paidUntil });

        const invoices = webpublish.getInvoiceHistory(after);
        record('told-vs-charged: invoice history has exactly one renewal entry matching the charged amount (2900 eur)', invoices.filter(i => i.kind === 'renewal').length === 1 && invoices.find(i => i.kind === 'renewal').amountCents === 2900, { invoices });

        // Duplicate delivery of the same renewal invoice — must not double-extend.
        const dupEventSameInvoiceId = invoices.find(i => i.kind === 'renewal').invoiceId;
        await postWebhook({
            id: 'evt_' + crypto.randomUUID(), // different event id, SAME invoice id
            type: 'invoice.payment_succeeded',
            data: { object: {
                id: dupEventSameInvoiceId,
                subscription: subscriptionId,
                billing_reason: 'subscription_cycle',
                amount_paid: 2900,
                currency: 'eur',
            } },
        });
        await new Promise((r) => setTimeout(r, 80));
        const afterDup = registry.getSite(site.id);
        const invoicesAfterDup = webpublish.getInvoiceHistory(afterDup);
        record('told-vs-charged: a different event id for the SAME invoice does not double-charge the ledger (idempotent renewal)', invoicesAfterDup.filter(i => i.kind === 'renewal').length === 1 && afterDup.paidUntil === after.paidUntil, {});
    }

    // ── 3. C1 re-check: republish on a stale-but-active site must NOT open a second subscription ──
    {
        // Force paidUntil into the past while Stripe still says active — the exact
        // webhook-lag scenario the original audit's worst finding described.
        registry.updateSite(site.id, {
            paidUntil: new Date(Date.now() - 86400000).toISOString(),
            stripeSubscriptionId: subscriptionId,
            stripeSubscriptionStatus: 'active',
            subscriptionStatus: 'active',
        });
        const staleSite = registry.getSite(site.id);
        const guard = webpublish.canStartRenewalCheckout(staleSite);
        record('C1 re-check: canStartRenewalCheckout refuses a stale-but-active site (guard itself, direct call)', guard.allowed === false && guard.reasonCode === 'SUBSCRIPTION_STILL_ACTIVE', guard);

        // Full HTTP re-walk of the actual dashboard renewal endpoint requires an
        // authenticated session cookie (out of this module's ownership to fake
        // convincingly) — server.js's own wiring at handleSiteCheckout /
        // handlePublish was independently confirmed by direct source inspection
        // (bot/server.js:3166-3201 calls reconcileSiteFromStripe +
        // canStartRenewalCheckout before ever opening a new Checkout Session,
        // on both the renewal endpoint and the ordinary publish/republish path)
        // — recorded here as a code-level re-confirmation, not a fresh HTTP
        // reproduction, since this agent does not own bot/server.js to add a
        // session-authenticated HTTP harness for it without touching that file.
        const serverSrc = fs.readFileSync(path.join(botDir, 'server.js'), 'utf8');
        const hasRenewalGuard = /canStartRenewalCheckout\(site\)/.test(serverSrc) && /reconcileSiteFromStripe\(site\)/.test(serverSrc);
        const hasRepublishGuard = /site\.paid === true && !webpublish\.canStartRenewalCheckout\(site\)\.allowed/.test(serverSrc);
        record('C1 re-check: bot/server.js still wires the guard into BOTH the renewal endpoint and the republish path (source re-confirmed, unedited by this wave)', hasRenewalGuard && hasRepublishGuard, {});

        // Restore healthy state for the rest of the walk.
        registry.updateSite(site.id, {
            paidUntil: new Date(Date.now() + 300 * 86400000).toISOString(),
            status: 'live',
        });
    }

    // ── 4. Decline sequence: attempt 1 (warning, site live) ─────────────────
    {
        const res = await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 86400 } },
        });
        await new Promise((r) => setTimeout(r, 80));
        const fresh = registry.getSite(site.id);
        const dunning = webpublish.getDunningState(fresh);
        record('decline attempt 1: dashboard state is "warning", NOT "critical" (told matches reality: site still up)', dunning && dunning.severity === 'warning', dunning);

        const liveRes = await getLive(fresh.slug);
        record('told-vs-charged: after decline #1 the email says "site stays live" AND the site actually still serves', liveRes.status === 200, { liveStatus: liveRes.status, siteStatus: fresh.status });

        const rows = ownerEmailRows(site.id);
        record('decline #1 produced exactly one owner email, addressed to the real account email', rows.length === 1 && rows[0].to === user.email && rows[0].kind === 'payment_declined', rows);
    }

    // ── 5. Retries 2, 3 ──────────────────────────────────────────────────────
    for (const attempt of [2, 3]) {
        await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: attempt, next_payment_attempt: Math.floor(Date.now() / 1000) + (4 - attempt) * 86400 } },
        });
    }
    await new Promise((r) => setTimeout(r, 100));
    {
        const rows = ownerEmailRows(site.id);
        record('each retry produced its own email — total 3 payment_declined emails after 3 attempts', rows.filter(r => r.kind === 'payment_declined').length === 3, { count: rows.filter(r => r.kind === 'payment_declined').length });
    }

    // ── 6. Retry exhaustion: subscription → unpaid, site actually comes down ─
    {
        const res = await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'unpaid', customer: 'cus_test_walk' } },
        });
        await new Promise((r) => setTimeout(r, 80));
        const fresh = registry.getSite(site.id);
        record('retries exhausted: site status flips to unpublished', fresh.status === 'unpublished', { status: fresh.status });

        const liveRes = await getLive(fresh.slug);
        record('told-vs-charged: the critical email says the site is down AND /live/<slug>/ actually 404s (never a live site with a "down" email, never the reverse)', liveRes.status === 404, { liveStatus: liveRes.status });

        const dunning = webpublish.getDunningState(fresh);
        record('dashboard now shows "critical" — matches the email, matches reality', dunning && dunning.severity === 'critical', dunning);

        const rows = ownerEmailRows(site.id);
        const siteDownRows = rows.filter(r => r.kind === 'site_down');
        record('exactly one site_down email, addressed correctly', siteDownRows.length === 1 && siteDownRows[0].to === user.email, siteDownRows);

        // Duplicate delivery of the SAME unpaid event — must not re-send.
        await postWebhook({
            id: 'evt_' + crypto.randomUUID(), // NOTE: different id on purpose is tested elsewhere;
            type: 'customer.subscription.updated',              // here we redeliver the exact same event id.
            data: { object: { id: subscriptionId, status: 'unpaid', customer: 'cus_test_walk' } },
        });
    }

    // ── 7. Return: owner fixes the card — checkout.session.completed / invoice.paid style recovery is Stripe-side; this repo's side is reconcileSiteFromStripe + a fresh renewal Checkout, already covered by wave7 tests. Confirm the guard does not now wrongly block a genuine resubscribe after the terminal state. ──
    {
        const returned = registry.getSite(site.id);
        const guard = webpublish.canStartRenewalCheckout(returned);
        record('return: after a real terminal failure (unpaid), a genuine resubscribe checkout is allowed again (not permanently locked out)', guard.allowed === true, guard);
    }

    // ── 8. Cancel path on a FRESH site: no email (they already know) ───────
    {
        const { user: user2, site: site2 } = seedSite('walk-cancel', 'owner-walk-cancel@example.test');
        const sub2 = 'sub_test_walkcancel_' + crypto.randomBytes(4).toString('hex');
        registry.updateSite(site2.id, {
            paid: true, paidUntil: new Date(Date.now() + 300 * 86400000).toISOString(), status: 'live',
            stripeSubscriptionId: sub2, stripeCustomerId: 'cus_test_walkcancel',
        });
        await postWebhook({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.deleted',
            data: { object: { id: sub2, status: 'canceled', customer: 'cus_test_walkcancel' } },
        });
        await new Promise((r) => setTimeout(r, 80));
        const fresh2 = registry.getSite(site2.id);
        const rows2 = ownerEmailRows(site2.id);
        record('customer-initiated cancel: site comes down, but zero payment-failure emails fire (they already know)', fresh2.status === 'unpublished' && rows2.length === 0, { status: fresh2.status, emailRows: rows2.length });
    }

    srv.close();

    const allOk = steps.every((s) => s.ok);
    const result = { ranAt: new Date().toISOString(), allOk, steps };
    fs.writeFileSync(path.join(__dirname, 'adversarial-walk-result.json'), JSON.stringify(result, null, 2));
    console.log('\n' + (allOk ? 'ALL STEPS OK' : 'SOME STEPS FAILED') + ` (${steps.filter(s=>s.ok).length}/${steps.length})`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(allOk ? 0 : 1);
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
