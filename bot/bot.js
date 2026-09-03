/**
 * bot/bot.js — hidook site bot (wiring only)
 *
 * Instantiates the grammY Bot, registers all command/message handlers, persists
 * sessions after each update, wires owner notifications, and survives crashes.
 * All business logic lives in bot/flow.js.
 *
 * Run:  node --env-file=.env bot.js   (or set env vars another way)
 * See bot/flow.js for the state machine and bot/README.md for env vars.
 */

'use strict';

const { Bot } = require('grammy');
const flow = require('./flow.js');
const webpublish = require('./webpublish.js');
const { log } = require('./logger.js');
const { startServer } = require('./server.js');

const {
    handleStart,
    handleWizard,
    handleAnuleaza,
    handleRetry,
    handleGata,
    handlePhoto,
    handleDocument,
    handleOther,
    handleText,
    handleHelp,
    handlePreturi,
    handleSterge, // Faza 5: order deletion (exported by flow.js / Agent A)
    persistSessions,
    setAdminNotifier,
    setBotUsername,
    setMessenger,
    reconcilePending,
    handleStripeWebhookEvent,
    sessions,
} = flow;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ Lipsă TELEGRAM_BOT_TOKEN. Pornește cu:  node --env-file=.env bot.js');
    process.exit(1);
}

const bot = new Bot(TOKEN);

/* ── Periodic reconciliation sweep: re-checks pending payments and resumes paid-but-
      unpublished orders, so nothing is lost between restarts or past a poll window. ── */
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS) || 5 * 60 * 1000;
let sweepTimer = null;

/* ── Render replies as Markdown by default, but never let a stray special char in a
      dynamic value (e.g. a domain or amount) drop the message: on an entity-parse
      error, transparently resend the same text as plain text. ── */
bot.api.config.use(async (prev, method, payload, signal) => {
    const isText = method === 'sendMessage' || method === 'editMessageText';
    if (isText && payload.parse_mode === undefined) {
        payload = { ...payload, parse_mode: 'Markdown' };
    }
    try {
        return await prev(method, payload, signal);
    } catch (e) {
        const desc = (e && (e.description || e.message)) || '';
        if (isText && payload.parse_mode && /parse entities/i.test(desc)) {
            const { parse_mode, ...plain } = payload;
            return await prev(method, plain, signal);
        }
        throw e;
    }
});

/* ── Owner notifications: DM the owner on key business events ── */
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
if (ADMIN_CHAT_ID) {
    setAdminNotifier((text) =>
        bot.api.sendMessage(ADMIN_CHAT_ID, text).catch((e) =>
            console.error('[admin notify] failed:', e.message)
        )
    );
}

/* ── Outbound messenger for background flows that have no ctx (payment reconciler) ── */
setMessenger((chatId, text, opts) =>
    bot.api.sendMessage(chatId, text, opts).catch((e) =>
        console.error('[bg message] failed:', e.message)
    )
);

/* ── HTTP server: health endpoint + Stripe payment webhook (source of truth for
      "paid" — instant, restart-proof; the poller/sweeper stay as fallback).
      Binds Railway's injected PORT; a bind failure logs but never kills the bot. ── */
/**
 * Dispatcher: subscription lifecycle events are handled before metadata routing.
 * Remaining Stripe events are routed by metadata.platform.
 *   customer.subscription.updated/deleted → persist entitlement / unpublish
 *   platform === 'web'  → webpublish.handleStripePaid (builder web flow)
 *   otherwise           → flow.handleStripeWebhookEvent (Telegram bot flow)
 */
async function onStripeEvent(event) {
    const cs       = event && event.data && event.data.object;
    const platform = cs && cs.metadata && cs.metadata.platform;
    const type     = event && event.type;

    if (
        type === 'customer.subscription.updated' ||
        type === 'customer.subscription.deleted'
    ) {
        try {
            await webpublish.handleStripeSubscriptionEvent(event);
            log('webhook.stripe.subscription.handled', { type });
        } catch (e) {
            log('webhook.stripe.subscription.error', { err: e.message, type }, 'error');
        }
        return;
    }

    if (platform === 'web') {
        // Web builder flow — handled directly by webpublish with no TG messenger
        try {
            await webpublish.handleStripePaid(event, {
                notifyAdmin: ADMIN_CHAT_ID
                    ? (text) => bot.api.sendMessage(ADMIN_CHAT_ID, text).catch(() => {})
                    : undefined,
            });
            log('webhook.stripe.web.handled', { type: event.type });
        } catch (e) {
            log('webhook.stripe.web.error', { err: e.message, type: event.type }, 'error');
        }
        return;
    }

    // Telegram / unknown platform:
    // handleStripeWebhookEvent now tries registry first, then legacy sessions.
    try {
        const r = await handleStripeWebhookEvent(event);
        log('webhook.stripe.handled', { type: event.type, ...r });
    } finally {
        persistSessions();
    }
}

const httpServer = startServer({ onStripeEvent });

/* ── Persist sessions after every handled update (debounced in store.js) ── */
bot.use(async (ctx, next) => {
    try {
        await next();
    } finally {
        persistSessions();
    }
});

/* ── Commands ── */
bot.command('start',    handleStart);
bot.command('wizard',   handleWizard);
bot.command('help',     handleHelp);
bot.command('preturi',  handlePreturi);
bot.command('anuleaza', handleAnuleaza);
bot.command('retry',    handleRetry);
bot.command('gata',     handleGata);
// /sterge — delete a published/paid order. Guarded: flow.js exports handleSterge
// (Agent A); if a build predates it, skip registration rather than crash on boot.
if (typeof handleSterge === 'function') {
    bot.command('sterge', handleSterge);
} else {
    console.warn('[wiring] handleSterge not exported by flow.js — /sterge disabled');
}

/* ── Media + Text (catch-all registered LAST so it only fires for unhandled types) ── */
bot.on('message:photo',    handlePhoto);
bot.on('message:document', handleDocument);
bot.on('message:text',     handleText);
bot.on('message',          handleOther);

/* ── Per-update error boundary (one bad update never kills the bot) ── */
bot.catch((err) => {
    console.error('Bot error:', err?.error || err);
    const ctx = err?.ctx;
    if (ctx) ctx.reply('⚠️ A apărut o eroare. Încearcă din nou sau scrie /anuleaza.').catch(() => {});
});

/* ── Process-level safety net ──
   unhandledRejection: log only (a single bad promise shouldn't kill the bot).
   uncaughtException: the process state may be corrupt — flush sessions and EXIT non-zero
   so Railway (restartPolicy ON_FAILURE) restarts a clean process, which then re-arms any
   pending payments via reconcilePending(). Staying alive risks a zombie that can't
   deploy or persist. */
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException',  (e) => {
    console.error('uncaughtException (flushing + exiting):', e);
    try { require('./store.js').flush(sessions); } catch (_) {}
    process.exit(1);
});

/* ── Graceful shutdown: flush sessions, stop polling cleanly ── */
const shutdown = (signal) => {
    console.log(`\n${signal} received — flushing sessions and stopping…`);
    log('bot.shutdown', { signal });
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    try { httpServer.close(); } catch (_) {}
    try { require('./store.js').flush(sessions); } catch (_) {}
    bot.stop();
    process.exit(0);
};
process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

/* ── User-facing command menu shown in the Telegram client (RO descriptions) ── */
const COMMAND_MENU = [
    { command: 'start',    description: 'Pornește și creează un site nou' },
    { command: 'preturi',  description: 'Vezi prețurile și ce e inclus' },
    { command: 'help',     description: 'Ajutor și cum funcționează' },
    { command: 'anuleaza', description: 'Anulează procesul curent' },
    { command: 'retry',    description: 'Reîncearcă plata / deschide builderul' },
    { command: 'sterge',   description: 'Șterge datele tale (GDPR)' },
];

/* ── Start polling, auto-retry on startup failure (e.g. transient network) ── */
async function start() {
    try {
        await bot.start({
            drop_pending_updates: false,
            onStart: (me) => {
                setBotUsername(me.username);
                console.log(`🤖 Bot pornit ca @${me.username}`);
                log('bot.started', { username: me.username, id: me.id });
                // Register the slash-command menu so Telegram shows it in the UI.
                bot.api.setMyCommands(COMMAND_MENU)
                    .then(() => log('bot.commands_set', { count: COMMAND_MENU.length }))
                    .catch((e) => console.error('[setMyCommands] failed:', e.message));
                // Resume any orders that were mid-payment/publish when we last stopped,
                // then keep checking on an interval (covers slow payments + restarts).
                try { reconcilePending(); log('reconcile.boot'); }
                catch (e) { console.error('[reconcile] failed:', e.message); }
                if (!sweepTimer) {
                    sweepTimer = setInterval(() => {
                        try { reconcilePending(); } catch (e) { console.error('[sweep] failed:', e.message); }
                    }, SWEEP_INTERVAL_MS);
                    if (sweepTimer.unref) sweepTimer.unref();
                }
            },
        });
    } catch (e) {
        console.error('Bot start failed, retrying in 5s:', e.message);
        log('bot.start_failed', { err: e.message }, 'error');
        setTimeout(start, 5000);
    }
}
start();
