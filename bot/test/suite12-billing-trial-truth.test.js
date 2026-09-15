'use strict';
/**
 * bot/test/suite12-billing-trial-truth.test.js — Wave 12: invoices tell the
 * truth about money.
 *
 * VERIFIED FINDING (root cause, pre-fix): the dashboard "Facturi" list
 * showed a paid-looking 99€ line dated the day the 7-day free trial starts —
 * before any charge (the real charge lands on day 7). Two bugs in
 * bot/webpublish.js combined to cause it:
 *   1. handleStripePaid wrote the same ledger 'invoice' row whether Stripe's
 *      checkout payment_status was 'paid' (real money) or
 *      'no_payment_required' (trial start with a saved card, $0 moved) —
 *      nothing marked the trial row as pending/scheduled.
 *   2. handleStripeInvoicePaid — the handler for the REAL day-7 charge —
 *      short-circuited before ever reaching its ledger write whenever
 *      paidUntil was already far in the future (RENEWAL_DUE_WINDOW_MS),
 *      which is exactly the case right after a trial start. So the one
 *      event that truly means "Stripe collected money" was silently
 *      dropped, while the $0 trial start displayed as paid.
 *
 * Proven failing-first: reverting the two webpublish.js fixes (git stash /
 * diff of this branch) makes 'trial start records NO paid invoice' and
 * 'real day-7 charge ... records a paid invoice' both fail — the first
 * because the trial row's status becomes 'paid', the second because
 * getInvoiceHistory(after the day-7 event) still has length 1 (the charge
 * was silently ignored). See the report for the exact RED transcript.
 *
 * Run: node bot/test/suite12-billing-trial-truth.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-billing-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'suite12-billing-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;

const pricing    = require('../pricing.js');
const registry   = require('../registry.js');
const ledger     = require('../ledger.js');
const webpublish = require('../webpublish.js');
const { onStripeEvent } = require('../web.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

function fullConfig(name) {
    return {
        business: { name, title: `${name} | T`, metaDescription: `${name} — desc`, lang: 'ro' },
        hero: { background: "url('images/x.jpg')", ctaLabel: 'Sună acum' },
        contact: { phone: '+40721234567' },
        footer: { address: 'Strada Test 1' },
    };
}

function seedPendingSite(prefix) {
    const user = registry.getOrCreateUserByEmail(`${prefix}-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: prefix + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const sessionId = 'cs_test_' + prefix + '_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    const config = fullConfig(prefix);
    registry.saveVersion(site.id, config);
    webpublish.savePendingDraft(order.id, { config, images: [], siteId: site.id, savedAt: new Date().toISOString() });
    return { user, site, order, sessionId };
}

/** Drive a real checkout.session.completed(no_payment_required) — a trial start. */
async function startTrial(prefix) {
    const { site, order, sessionId, user } = seedPendingSite(prefix);
    const subscriptionId = 'sub_test_' + prefix + '_' + crypto.randomBytes(4).toString('hex');
    await onStripeEvent({
        id: 'evt_' + crypto.randomUUID(),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'no_payment_required',
                customer: 'cus_test_' + prefix,
                subscription: subscriptionId,
                metadata: { platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id },
            },
        },
    });
    return { site: registry.getSite(site.id), subscriptionId, user, order };
}

/** customer.subscription.{created,updated,deleted} event. */
function subscriptionStatusEvent({ eventId, subscriptionId, status, type = 'customer.subscription.updated' }) {
    return {
        id: eventId,
        type,
        data: {
            object: {
                id: subscriptionId,
                status,
                customer: 'cus_test_' + subscriptionId,
            },
        },
    };
}

/** A real day-7 (or later renewal) Stripe invoice event. */
function subscriptionCycleInvoiceEvent({ eventId, invoiceId, subscriptionId, type = 'invoice.paid', amountPaid }) {
    return {
        id: eventId,
        type,
        data: {
            object: {
                id: invoiceId,
                subscription: subscriptionId,
                billing_reason: 'subscription_cycle',
                amount_paid: amountPaid != null ? amountPaid : pricing.PRICE_CENTS,
                currency: 'eur',
                hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/' + invoiceId,
                invoice_pdf: 'https://invoice.stripe.com/i/acct_x/' + invoiceId + '/pdf',
            },
        },
    };
}

(async () => {
    await check('trial start records NO paid invoice — status trial_started, scheduled amount + date shown', async () => {
        const { site } = await startTrial('trial-truth');
        const history = webpublish.getInvoiceHistory(site);
        assert.strictEqual(history.length, 1, 'exactly one ledger row for the trial start');
        assert.notStrictEqual(history[0].status, 'paid', 'a trial start must never display as paid');
        assert.strictEqual(history[0].status, 'trial_started');
        assert.strictEqual(history[0].kind, 'publish');
        assert.strictEqual(history[0].amountCents, pricing.PRICE_CENTS, 'the scheduled amount must still be shown, just not as "paid"');
        assert.strictEqual(history[0].currency, 'eur');
        assert.ok(history[0].scheduledChargeAt, 'the upcoming charge date must be present');
        assert.ok(
            Date.parse(history[0].scheduledChargeAt) > Date.now(),
            'the scheduled charge date must be in the future (the trial has not ended yet)'
        );
    });

    await check('real day-7 charge (invoice.paid, subscription_cycle) records a paid invoice and does not extend paidUntil a second time', async () => {
        const { site, subscriptionId } = await startTrial('trial-real-charge');
        const paidUntilAtTrialStart = site.paidUntil;
        assert.ok(paidUntilAtTrialStart, 'trial start already grants a full year of entitlement (site is live during the trial)');

        const invoiceId = 'in_' + crypto.randomUUID().slice(0, 10);
        await onStripeEvent(subscriptionCycleInvoiceEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            invoiceId,
            subscriptionId,
        }));

        const afterSite = registry.getSite(site.id);
        assert.strictEqual(
            afterSite.paidUntil, paidUntilAtTrialStart,
            'the day-7 charge only CONFIRMS the year already granted at trial start — it must not add a second year'
        );

        const history = webpublish.getInvoiceHistory(afterSite);
        assert.strictEqual(history.length, 2, 'trial-start row + the new real-charge row');
        const paidRow = history.find((h) => h.invoiceId === invoiceId);
        assert.ok(paidRow, 'the real charge must actually be recorded — this is the event the old code silently dropped');
        assert.strictEqual(paidRow.status, 'paid');
        assert.strictEqual(paidRow.kind, 'publish');
        assert.strictEqual(paidRow.amountCents, pricing.PRICE_CENTS);
        assert.ok(paidRow.hostedInvoiceUrl.includes(invoiceId));

        const trialRow = history.find((h) => h.status === 'trial_started');
        assert.ok(trialRow, 'the original trial-start row must still be there, still unpaid — history is additive, not overwritten');
    });

    await check('duplicate webhook delivery never doubles the ledger (same event id, and the same invoice under both Stripe event types)', async () => {
        const { site, subscriptionId } = await startTrial('trial-dup');
        const invoiceId = 'in_' + crypto.randomUUID().slice(0, 10);
        const evtId = 'evt_' + crypto.randomUUID();

        const event = subscriptionCycleInvoiceEvent({ eventId: evtId, invoiceId, subscriptionId });
        await onStripeEvent(event);
        await onStripeEvent(event); // exact same event redelivered by Stripe
        await onStripeEvent(subscriptionCycleInvoiceEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            invoiceId, // same invoice, Stripe's sibling event type for the same charge
            subscriptionId,
            type: 'invoice.payment_succeeded',
        }));

        const history = webpublish.getInvoiceHistory(registry.getSite(site.id));
        const paidRows = history.filter((h) => h.invoiceId === invoiceId);
        assert.strictEqual(paidRows.length, 1, 'one real Stripe invoice must only ever produce one paid ledger row');
    });

    await check('pre-existing (legacy) trial-start ledger rows no longer display as paid — non-destructive read-time correction', async () => {
        const { site } = seedPendingSite('legacy-trial');
        // Exactly the pre-Wave12 shape: a checkout-time 'invoice' row with NO
        // `status` field at all — what handleStripePaid used to write for a
        // trial start (and for a real charge) alike. The ledger file itself
        // is append-only and is never rewritten by the fix; only what a
        // reader (getInvoiceHistory) reports about this row changes.
        const legacyRow = ledger.append({
            event: 'invoice',
            siteId: site.id,
            orderId: 'legacy-order',
            kind: 'publish',
            invoiceId: null,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
        });
        assert.ok(legacyRow && !('status' in legacyRow), 'sanity: the simulated legacy row really has no status field');

        const history = webpublish.getInvoiceHistory(registry.getSite(site.id));
        assert.strictEqual(history.length, 1);
        assert.notStrictEqual(history[0].status, 'paid', 'a legacy first-time-checkout row must not keep displaying as paid');
        assert.strictEqual(history[0].status, 'trial_started');
    });

    await check('pre-existing (legacy) renewal ledger rows still display as paid — a renewal checkout never carries a trial', async () => {
        const { site } = seedPendingSite('legacy-renew');
        ledger.append({
            event: 'invoice',
            siteId: site.id,
            orderId: 'legacy-renewal-order',
            kind: 'renewal',
            invoiceId: null,
            amountCents: pricing.RENEWAL_CENTS,
            currency: 'eur',
        });
        const history = webpublish.getInvoiceHistory(registry.getSite(site.id));
        assert.strictEqual(history.length, 1);
        assert.strictEqual(
            history[0].status, 'paid',
            'a renewal checkout always charges immediately (bot/payments.js#createCheckout attaches no trial when firstPeriodCents === renewalCents) — a legacy renewal row was always real money'
        );
    });

    await check('a failed payment attempt is visible in the invoice history, never with a fabricated amount', async () => {
        const { site, subscriptionId } = await startTrial('trial-failed');
        await onStripeEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: {
                object: {
                    id: 'in_failed_' + crypto.randomUUID().slice(0, 8),
                    subscription: subscriptionId,
                    attempt_count: 1,
                    next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 86400,
                },
            },
        });
        const history = webpublish.getInvoiceHistory(registry.getSite(site.id));
        const failedRow = history.find((h) => h.status === 'failed');
        assert.ok(failedRow, 'the failed attempt must be recorded in the invoice history, not only the separate dunning banner');
        assert.strictEqual(failedRow.attemptCount, 1);
    });

    // ── TRW-04 / TRW-05 — recovery after an unpublish for non-payment ──────
    // A site Stripe unpublished because every dunning retry failed (terminal
    // 'unpaid'/'incomplete_expired') must come back live once a real payment
    // succeeds again — the product's own "site-ul redevine live automat"
    // email promise (buildSiteDownEmailRo) was not actually implemented
    // anywhere before this fix. An owner-initiated cancel must never be
    // resurrected the same way.

    await check('TRW-04: a site Stripe exhausted retries on republishes once the subscription itself reports active again', async () => {
        const { site, subscriptionId } = await startTrial('trw04-sub-active');
        // Simulate Stripe exhausting every dunning retry: one failed attempt
        // on record, then the terminal status update that unpublishes.
        await onStripeEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: {
                object: {
                    id: 'in_failed_' + crypto.randomUUID().slice(0, 8),
                    subscription: subscriptionId,
                    attempt_count: 3,
                    next_payment_attempt: null,
                },
            },
        });
        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'unpaid',
        }));

        const downSite = registry.getSite(site.id);
        assert.strictEqual(downSite.status, 'unpublished', 'sanity: the site really is down');
        assert.strictEqual(downSite.url, null, 'sanity: no public URL while down');
        assert.ok(downSite.paymentFailedAt, 'sanity: the dunning failure is on record');
        const downDunning = webpublish.getDunningState(downSite);
        assert.strictEqual(downDunning.severity, 'critical', 'sanity: dashboard must show the critical/site-down state, not a plain cancel');

        // Owner adds a new card; Stripe retries and the subscription itself
        // flips back to active.
        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'active',
        }));

        const recoveredSite = registry.getSite(site.id);
        assert.strictEqual(recoveredSite.status, 'live', 'TRW-04: the site must republish once the card update goes through');
        assert.ok(recoveredSite.url, 'TRW-04: a live site must have a public URL again');
        assert.strictEqual(recoveredSite.canceledAt, null, 'the resolved outage must not keep showing as cancelled');
        assert.strictEqual(recoveredSite.paymentFailedAt, null, 'TRW-05: the stale "card refuzat" failure record must clear on recovery');
        assert.strictEqual(recoveredSite.paymentFailedCount, null, 'TRW-05: the stale failure count must clear on recovery');

        const recoveredDunning = webpublish.getDunningState(recoveredSite);
        assert.strictEqual(recoveredDunning, null, 'TRW-05: a recovered site must stop reporting a dunning warning/critical state entirely');
    });

    await check('TRW-04: a site Stripe exhausted retries on republishes once the real day-7 charge succeeds (invoice.paid, isFirstPeriodCompletion branch)', async () => {
        const { site, subscriptionId } = await startTrial('trw04-invoice-first');
        const paidUntilBeforeOutage = registry.getSite(site.id).paidUntil;

        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'unpaid',
        }));
        assert.strictEqual(registry.getSite(site.id).status, 'unpublished', 'sanity: down before recovery');

        // The recovery charge succeeds — this is the SAME event type that
        // originally confirmed the day-7 charge (isFirstPeriodCompletion),
        // since paidUntil (granted a full year at trial start) never moved
        // during the whole outage.
        const invoiceId = 'in_recovery_' + crypto.randomUUID().slice(0, 10);
        await onStripeEvent(subscriptionCycleInvoiceEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            invoiceId,
            subscriptionId,
        }));

        const recoveredSite = registry.getSite(site.id);
        assert.strictEqual(recoveredSite.status, 'live', 'TRW-04: the site must republish once the real charge succeeds');
        assert.ok(recoveredSite.url, 'a live site must have a public URL');
        assert.strictEqual(
            recoveredSite.paidUntil, paidUntilBeforeOutage,
            'recovery confirms the year already granted at trial start — it must not add a second year'
        );
        assert.strictEqual(recoveredSite.paymentFailedAt, null, 'TRW-05: the dunning failure record must clear on recovery');

        const history = webpublish.getInvoiceHistory(recoveredSite);
        const paidRow = history.find((h) => h.invoiceId === invoiceId);
        assert.ok(paidRow && paidRow.status === 'paid', 'the recovery charge itself must still be recorded as a real paid invoice');
    });

    await check('TRW-04: an owner-cancelled site is never resurrected by a later stray "active" event for the same subscription', async () => {
        const { site, subscriptionId } = await startTrial('trw04-owner-cancel');
        // Owner clicks Cancel in the Customer Portal — a real Stripe cancel
        // reports status 'canceled', never 'unpaid'/'incomplete_expired'.
        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'canceled',
        }));
        const cancelledSite = registry.getSite(site.id);
        assert.strictEqual(cancelledSite.status, 'unpublished');
        assert.strictEqual(cancelledSite.stripeSubscriptionStatus, 'canceled');

        // An anomalous/out-of-order webhook later claims 'active' for the
        // very same (already-canceled) subscription id. A real canceled
        // Stripe subscription never legitimately does this, but the guard
        // must hold even if one arrives.
        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'active',
        }));

        const afterStraySite = registry.getSite(site.id);
        assert.strictEqual(afterStraySite.status, 'unpublished', 'an owner cancel must never be resurrected by a later stray event');
        assert.strictEqual(afterStraySite.url, null, 'no public URL must reappear for a cancelled site');
    });

    await check('TRW-04: duplicate/out-of-order recovery delivery never double-publishes or throws', async () => {
        const { site, subscriptionId } = await startTrial('trw04-dup-recover');
        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'unpaid',
        }));

        const recoverEvent = subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'active',
        });
        await onStripeEvent(recoverEvent);
        const firstUrl = registry.getSite(site.id).url;
        assert.ok(firstUrl, 'sanity: recovered once');

        // Redelivery of the identical event, and a sibling "still active"
        // update arriving after recovery — neither must republish again or
        // throw.
        await onStripeEvent(recoverEvent);
        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'active',
        }));

        const finalSite = registry.getSite(site.id);
        assert.strictEqual(finalSite.status, 'live');
        assert.strictEqual(finalSite.url, firstUrl, 'republishing again must not change the already-recovered site');
    });

    // ── TRW-09a — cancel before any real charge must not keep reading paid ─
    await check('TRW-09a: cancelling a trial BEFORE Stripe ever charged it clears paid — no invented payment history', async () => {
        const { site, subscriptionId } = await startTrial('trw09a-never-charged');
        assert.strictEqual(registry.getSite(site.id).paid, true, 'sanity: entitled to be live during the trial');
        assert.strictEqual(
            webpublish.getInvoiceHistory(registry.getSite(site.id)).some((r) => r.status === 'paid'),
            false,
            'sanity: no real charge on record yet — only the trial_started row'
        );

        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'canceled',
        }));

        const cancelled = registry.getSite(site.id);
        assert.strictEqual(cancelled.status, 'unpublished');
        assert.strictEqual(
            cancelled.paid, false,
            'TRW-09a: a trial cancelled before any real charge must not keep reading as a paid site'
        );
    });

    await check('TRW-09a: cancelling AFTER a real charge still keeps paid:true — real payment history is not erased', async () => {
        const { site, subscriptionId } = await startTrial('trw09a-charged-then-cancel');
        // The real day-7 charge succeeds before the owner cancels.
        await onStripeEvent(subscriptionCycleInvoiceEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            invoiceId: 'in_' + crypto.randomUUID().slice(0, 10),
            subscriptionId,
        }));
        assert.ok(
            webpublish.getInvoiceHistory(registry.getSite(site.id)).some((r) => r.status === 'paid'),
            'sanity: a real charge is now on record'
        );

        await onStripeEvent(subscriptionStatusEvent({
            eventId: 'evt_' + crypto.randomUUID(),
            subscriptionId,
            status: 'canceled',
        }));

        const cancelled = registry.getSite(site.id);
        assert.strictEqual(cancelled.status, 'unpublished');
        assert.strictEqual(
            cancelled.paid, true,
            'TRW-09a: cancelling after a real charge must still keep paid:true — that payment history is real, not invented'
        );
    });

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll suite12-billing-trial-truth checks passed.');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
