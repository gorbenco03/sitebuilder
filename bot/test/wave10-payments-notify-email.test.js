'use strict';
/**
 * bot/test/wave10-payments-notify-email.test.js — Wave10: nobody tells the
 * customer anything.
 *
 * The re-audit's C2 finding: the failed-payment/dunning machinery is fully
 * built and correct, but the ONLY notification channel wired to it
 * (notifyAdmin) is Telegram, and bot/web.js — the production entry point —
 * always calls it with notifyAdmin: undefined. A card expiring is the single
 * most common way a small business loses its site by accident: they do not
 * log in, so a dashboard-only signal is not the same as being told. This
 * file proves the new real channel — Romanian transactional email, reusing
 * the same dev-fallback/Resend-POST shape as bot/email.js#sendMagicLink —
 * fires:
 *   1. on the first decline (site stays live, concrete next-retry date)
 *   2. on each further retry (updated attempt count)
 *   3. once and only once for a duplicate webhook delivery of the SAME event
 *   4. the day the site actually comes down (unpaid/incomplete_expired) —
 *      the one email that must never be missed
 *   5. never for a customer-initiated cancel (they already clicked Cancel)
 *   6. never again once the subscription has recovered (past_due → active)
 *
 * Run: node bot/test/wave10-payments-notify-email.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave10-notify-email-'));
process.env.DATA_DIR               = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'https://example.test';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.RESEND_API_KEY;

const registry   = require('../registry.js');
const ledger     = require('../ledger.js');
const webpublish = require('../webpublish.js');

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

function seedSite(prefix, email) {
    const user = registry.getOrCreateUserByEmail(email || `${prefix}-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: prefix + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    registry.updateSite(site.id, {
        paid: true,
        paidUntil: new Date(Date.now() + 300 * 86400000).toISOString(),
        status: 'live',
    });
    const subscriptionId = 'sub_test_' + prefix + '_' + crypto.randomBytes(4).toString('hex');
    registry.updateSite(site.id, { stripeSubscriptionId: subscriptionId, stripeCustomerId: 'cus_test_' + prefix });
    return { user, site: registry.getSite(site.id), subscriptionId };
}

/** Ledger rows this test cares about, for one site. */
function ownerEmailLedgerRows(siteId) {
    return ledger.read().filter((r) => r && r.event === 'owner_notified' && r.channel === 'email' && r.siteId === siteId);
}

/** Mock global.fetch so a real RESEND_API_KEY path can be exercised offline. */
function withMockResend(fn) {
    return async () => {
        const prevKey = process.env.RESEND_API_KEY;
        const prevFetch = global.fetch;
        process.env.RESEND_API_KEY = 'test-key-not-real';
        const posted = [];
        global.fetch = async (url, opts) => {
            posted.push({ url, body: JSON.parse(opts.body) });
            return { ok: true, status: 200, text: async () => '' };
        };
        try {
            await fn(posted);
        } finally {
            global.fetch = prevFetch;
            if (prevKey === undefined) delete process.env.RESEND_API_KEY;
            else process.env.RESEND_API_KEY = prevKey;
        }
    };
}

(async () => {
    // ── 1. First decline: real Resend POST, correct Romanian, correct recipient ──
    await check('first decline (attempt 1, retry scheduled): emails the owner with a concrete date and the dashboard link', withMockResend(async (posted) => {
        const { site, subscriptionId, user } = seedSite('email-decline1', 'owner-decline1@example.test');
        const nextAttemptUnix = Math.floor(Date.now() / 1000) + 3 * 86400;
        await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: nextAttemptUnix } },
        });

        assert.strictEqual(posted.length, 1, 'exactly one email must be sent');
        const msg = posted[0].body;
        assert.strictEqual(msg.to, user.email);
        assert.match(msg.subject, /încercarea 1/, 'subject names the attempt');
        assert.match(msg.subject, /rămâne live/, 'subject reassures the site is still up');
        assert.match(msg.text, /refuzat/, 'body says the card was declined');
        assert.match(msg.text, /rămâne live/, 'body states what it costs: nothing yet, site is live');
        assert.match(msg.text, /https:\/\/example\.test\/app/, 'body includes a clickable dashboard link');
        assert.ok(/[ăâîșț]/i.test(msg.text), 'must be Romanian');
        assert.ok(/[ăâîșț]/i.test(msg.html));

        const rows = ownerEmailLedgerRows(site.id);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].kind, 'payment_declined');
        assert.strictEqual(rows[0].sent, true);
        assert.strictEqual(rows[0].to, user.email);
    }));

    // ── 2. Retry: updated attempt count, still a warning, no false urgency ──
    await check('a later retry (attempt 3, still scheduled): updated attempt count, still "site stays live"', withMockResend(async (posted) => {
        const { site, subscriptionId, user } = seedSite('email-retry3', 'owner-retry3@example.test');
        const nextAttemptUnix = Math.floor(Date.now() / 1000) + 1 * 86400;
        await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 3, next_payment_attempt: nextAttemptUnix } },
        });
        assert.strictEqual(posted.length, 1);
        assert.match(posted[0].body.subject, /încercarea 3/);
        assert.match(posted[0].body.text, /rămâne live/);
    }));

    // ── 3. Last scheduled retry failing: last-chance copy, no date to hide behind ──
    await check('final scheduled retry fails (no next_payment_attempt): last-chance copy, tells them the site is about to go down', withMockResend(async (posted) => {
        const { site, subscriptionId, user } = seedSite('email-lastchance', 'owner-lastchance@example.test');
        await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 4, next_payment_attempt: null } },
        });
        assert.strictEqual(posted.length, 1);
        assert.match(posted[0].body.subject, /Ultima încercare/);
        assert.match(posted[0].body.text, /neplătit/, 'must name the terminal state heading their way');
        assert.match(posted[0].body.text, /oprit/, 'must warn the site will be taken down');
        assert.match(posted[0].body.text, /chiar acum/, 'must convey urgency, not the calmer "before <date>" copy');
    }));

    // ── 4. Exactly once: a duplicate webhook delivery must not double-send ──
    await check('duplicate delivery of the SAME invoice.payment_failed event: email sent exactly once', withMockResend(async (posted) => {
        const { site, subscriptionId } = seedSite('email-dup-decline', 'owner-dup-decline@example.test');
        const event = {
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 86400 } },
        };
        await webpublish.handleStripeInvoicePaymentFailed(event);
        await webpublish.handleStripeInvoicePaymentFailed(event); // Stripe redelivers the same event id
        assert.strictEqual(posted.length, 1, 'must not double-send on webhook redelivery');
        assert.strictEqual(ownerEmailLedgerRows(site.id).length, 1);
    }));

    // ── 5. The terminal email: the day the site actually comes down ──
    await check('subscription flips to unpaid: the critical "site is down" email fires, names the site, links the dashboard', withMockResend(async (posted) => {
        const { site, subscriptionId, user } = seedSite('email-sitedown', 'owner-sitedown@example.test');
        const result = await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'unpaid', customer: 'cus_x' } },
        });
        assert.strictEqual(result.status, 'unpublished');
        assert.strictEqual(posted.length, 1);
        const msg = posted[0].body;
        assert.strictEqual(msg.to, user.email);
        assert.match(msg.subject, /oprit/);
        assert.match(msg.subject, new RegExp(site.slug));
        assert.match(msg.text, /NU mai este live/);
        assert.match(msg.text, /nu s-a pierdut nimic/, 'must reassure the site content is preserved');
        assert.match(msg.text, /https:\/\/example\.test\/app/);

        const rows = ownerEmailLedgerRows(site.id);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].kind, 'site_down');
    }));

    // ── 6. incomplete_expired is the OTHER terminal failure — same email ──
    await check('subscription flips to incomplete_expired (first invoice never paid): the same critical email fires', withMockResend(async (posted) => {
        const { subscriptionId, user } = seedSite('email-incexp', 'owner-incexp@example.test');
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'incomplete_expired', customer: 'cus_x' } },
        });
        assert.strictEqual(posted.length, 1);
        assert.match(posted[0].body.subject, /oprit/);
    }));

    // ── 7. Exactly once, even across a webhook redelivery of the unpaid event ──
    await check('duplicate delivery of the SAME customer.subscription.updated(unpaid) event: email sent exactly once', withMockResend(async (posted) => {
        const { site, subscriptionId } = seedSite('email-dup-unpaid', 'owner-dup-unpaid@example.test');
        const event = {
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'unpaid', customer: 'cus_x' } },
        };
        await webpublish.handleStripeSubscriptionEvent(event);
        await webpublish.handleStripeSubscriptionEvent(event); // duplicate delivery
        assert.strictEqual(posted.length, 1, 'must not double-send on webhook redelivery');
        assert.strictEqual(ownerEmailLedgerRows(site.id).length, 1);
    }));

    // ── 8. Never for a customer-initiated cancel — they already know ──
    await check('subscription canceled via the customer portal: no email at all (they clicked Cancel themselves)', withMockResend(async (posted) => {
        const { subscriptionId } = seedSite('email-cancel', 'owner-cancel@example.test');
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'canceled', customer: 'cus_x' } },
        });
        assert.strictEqual(posted.length, 0, 'a self-service cancel must not fire the site-down email');
    }));

    await check('subscription.deleted: no email either (same reasoning as canceled)', withMockResend(async (posted) => {
        const { subscriptionId } = seedSite('email-deleted', 'owner-deleted@example.test');
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.deleted',
            data: { object: { id: subscriptionId, status: 'canceled', customer: 'cus_x' } },
        });
        assert.strictEqual(posted.length, 0);
    }));

    // ── 9. Never for a recovered subscription — past_due → active fires no email ──
    await check('subscription recovers (past_due → active): no email fires for the recovery transition itself', withMockResend(async (posted) => {
        const { subscriptionId } = seedSite('email-recover', 'owner-recover@example.test');
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'past_due', customer: 'cus_x' } },
        });
        await webpublish.handleStripeSubscriptionEvent({
            id: 'evt_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: { object: { id: subscriptionId, status: 'active', customer: 'cus_x' } },
        });
        assert.strictEqual(posted.length, 0, 'neither past_due nor active update sends an email — only invoice.payment_failed and the terminal unpaid do');
    }));

    // ── 10. Dev fallback (no RESEND_API_KEY): never throws, still recorded ──
    await check('no RESEND_API_KEY (dev/offline default): does not throw, ledger still records the attempt as unsent', async () => {
        delete process.env.RESEND_API_KEY;
        const { site, subscriptionId, user } = seedSite('email-devmode', 'owner-devmode@example.test');
        const result = await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 86400 } },
        });
        assert.ok(result, 'handler must still resolve normally');
        const rows = ownerEmailLedgerRows(site.id);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].sent, false);
        assert.strictEqual(rows[0].reason, 'dev_no_api_key');
        assert.strictEqual(rows[0].to, user.email, 'recipient is still resolved and recorded even when unsent');
    });

    // ── 11. No owner email on file (e.g. Telegram-origin site): never throws ──
    await check('site has no user email on file (e.g. Telegram-origin site): never throws, ledger records "no_recipient"', withMockResend(async (posted) => {
        // Telegram-origin user: no email column at all, only tg_id.
        const tgUser = registry.getOrCreateUserByTelegram(Math.floor(Math.random() * 1e9));
        const site = registry.createSite({
            userId: tgUser.id,
            templateId: 'product-menu',
            templateVersion: 1,
            slug: 'email-noowner-' + crypto.randomUUID().slice(0, 8),
            platform: 'web',
        });
        registry.updateSite(site.id, { paid: true, paidUntil: new Date(Date.now() + 300 * 86400000).toISOString(), status: 'live' });
        const subscriptionId = 'sub_test_noowner_' + crypto.randomBytes(4).toString('hex');
        registry.updateSite(site.id, { stripeSubscriptionId: subscriptionId, stripeCustomerId: 'cus_test_noowner' });

        const result = await webpublish.handleStripeInvoicePaymentFailed({
            id: 'evt_' + crypto.randomUUID(),
            type: 'invoice.payment_failed',
            data: { object: { id: 'in_' + crypto.randomUUID().slice(0, 8), subscription: subscriptionId, attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 86400 } },
        });
        assert.ok(result);
        assert.strictEqual(posted.length, 0, 'no recipient means no send attempt over the wire');
        const rows = ownerEmailLedgerRows(site.id);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].sent, false);
        assert.strictEqual(rows[0].reason, 'no_recipient');
        assert.strictEqual(rows[0].to, null);
    }));

    // ── 12. Content building is pure and testable without any network ──
    await check('buildPaymentDeclinedEmailRo / buildSiteDownEmailRo are pure functions (no site mutation, no network)', () => {
        const site = { id: 'x1', slug: 'demo-site', userId: 'u1' };
        const declined = webpublish.buildPaymentDeclinedEmailRo(site, { attemptCount: 2, nextPaymentAttempt: new Date(Date.now() + 86400000).toISOString() });
        assert.match(declined.subject, /demo-site/);
        assert.match(declined.text, /demo-site/);
        assert.match(declined.html, /demo-site/);
        assert.ok(/[ăâîșț]/i.test(declined.text));

        const down = webpublish.buildSiteDownEmailRo(site);
        assert.match(down.subject, /demo-site/);
        assert.match(down.text, /demo-site/);
        assert.ok(/[ăâîșț]/i.test(down.text));
    });

    if (failed) {
        console.error(`\n${failed} failure(s)`);
        process.exit(1);
    }
    console.log('\nAll wave10-payments-notify-email checks passed.');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
