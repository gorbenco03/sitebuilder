'use strict';
/**
 * bot/web.js — web-only entry point for Hidook Site Builder.
 *
 * Serves the commercial product: the browser builder at /app/*, the /api/*
 * surface, Stripe webhooks and published-site hosting. No Telegram.
 *
 * Use this when TELEGRAM_BOT_TOKEN is not set — bot.js exits at boot without a
 * token, so it cannot host a web-only deployment.
 *
 * To run Telegram draft intake as well, start `node bot.js` instead: it boots
 * the same HTTP server plus long-polling (one replica only, one poller/token).
 *
 * Stripe: server.js verifies the webhook signature and then delegates the event
 * to onStripeEvent. Without that wiring a payment is acknowledged with 200 and
 * silently never publishes, so it is wired here.
 *
 * Production paid-transition (Dockerfile CMD: `node web.js`): route the same way
 * bot.js does for platform===web — webpublish.handleStripePaid. Do not send
 * web checkout through flow's Stripe webhook handler: that path only accepts
 * payment_status==='paid' and drops subscription trial starts with
 * payment_status=no_payment_required.
 *
 * Zero npm dependencies beyond what server.js needs. Node 18+ CommonJS.
 */

const { startServer } = require('./server.js');
const { log } = require('./logger.js');
const webpublish = require('./webpublish.js');

/** Lazy flow load — reconciliation only; Stripe paid-transition does not use it. */
function getFlow() { return require('./flow.js'); }

/**
 * Web dispatcher: Stripe → webpublish.
 * - checkout.session.completed → handleStripePaid (trial + paid)
 * - customer.subscription.updated → persist entitlement status; canceled → unpublish
 * - customer.subscription.deleted → unpublish
 * Exported so focused tests can exercise the Docker/`web.js` path directly.
 *
 * @param {object} event Stripe event
 */
async function onStripeEvent(event) {
    try {
        const type = event && event.type;
        if (
            type === 'customer.subscription.deleted' ||
            type === 'customer.subscription.updated'
        ) {
            await webpublish.handleStripeSubscriptionEvent(event);
            log('webhook.stripe.handled', { type });
            return;
        }
        await webpublish.handleStripePaid(event, {
            // web-only entry: no Telegram messenger / admin chat
            notifyAdmin: undefined,
        });
        log('webhook.stripe.handled', { type });
    } catch (e) {
        log('webhook.stripe.handler_error', {
            err: e.message,
            type: event && event.type,
        }, 'error');
    }
}

module.exports = { onStripeEvent };

/* Boot only when this file is the process entry (Dockerfile CMD / `node web.js`).
   Tests require { onStripeEvent } without binding a port or starting sweeps. */
if (require.main === module) {
    const httpServer = startServer({ onStripeEvent });

    /* ── Reconciliation sweep ──────────────────────────────────────────────────
       A missed or late webhook would otherwise leave a paid order unpublished.
       Re-check pending payments at boot and on an interval, exactly as bot.js does. */
    const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS) || 5 * 60 * 1000;
    let sweepTimer = null;

    function sweep(where) {
        try {
            getFlow().reconcilePending();
            log('reconcile.' + where);
        } catch (e) {
            console.error('[sweep] failed:', e.message);
        }
    }

    sweep('boot');
    sweepTimer = setInterval(() => sweep('interval'), SWEEP_INTERVAL_MS);
    if (sweepTimer.unref) sweepTimer.unref();

    /* ── Crash safety: never linger as a zombie that cannot deploy or persist ── */
    process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
    process.on('uncaughtException', (e) => {
        console.error('uncaughtException (exiting):', e);
        process.exit(1);
    });

    /* ── Graceful shutdown ── */
    const shutdown = (signal) => {
        console.log(`\n${signal} received — shutting down…`);
        log('web.shutdown', { signal });
        if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
        try { httpServer.close(); } catch (_) {}
        process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    console.log('🌐 Hidook Site Builder — web-only mode (no Telegram)');
}
