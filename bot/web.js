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
 * Zero npm dependencies beyond what server.js needs. Node 18+ CommonJS.
 */

const { startServer } = require('./server.js');
const { log } = require('./logger.js');

/** Telegram-free Stripe handling: the registry/browser-pay path in flow.js. */
function getFlow() { return require('./flow.js'); }

async function onStripeEvent(event) {
    try {
        const r = await getFlow().handleStripeWebhookEvent(event);
        log('webhook.stripe.handled', { type: event && event.type, ...r });
    } catch (e) {
        log('webhook.stripe.handler_error', {
            err: e.message,
            type: event && event.type,
        }, 'error');
    }
}

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
