/**
 * bot/bot.js — DESSERD site bot (wiring only)
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

const {
    handleStart,
    handleWizard,
    handleAnuleaza,
    handleGata,
    handlePhoto,
    handleText,
    handleHelp,
    handlePreturi,
    persistSessions,
    setAdminNotifier,
    sessions,
} = flow;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ Lipsă TELEGRAM_BOT_TOKEN. Pornește cu:  node --env-file=.env bot.js');
    process.exit(1);
}

const bot = new Bot(TOKEN);

/* ── Owner notifications: DM the owner on key business events ── */
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
if (ADMIN_CHAT_ID) {
    setAdminNotifier((text) =>
        bot.api.sendMessage(ADMIN_CHAT_ID, text).catch((e) =>
            console.error('[admin notify] failed:', e.message)
        )
    );
}

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
bot.command('gata',     handleGata);

/* ── Media + Text ── */
bot.on('message:photo', handlePhoto);
bot.on('message:text',  handleText);

/* ── Per-update error boundary (one bad update never kills the bot) ── */
bot.catch((err) => {
    console.error('Bot error:', err?.error || err);
    const ctx = err?.ctx;
    if (ctx) ctx.reply('⚠️ A apărut o eroare. Încearcă din nou sau scrie /anuleaza.').catch(() => {});
});

/* ── Process-level safety net: log, never crash the whole bot ── */
process.on('uncaughtException',  (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

/* ── Graceful shutdown: flush sessions, stop polling cleanly ── */
const shutdown = (signal) => {
    console.log(`\n${signal} received — flushing sessions and stopping…`);
    try { require('./store.js').flush(sessions); } catch (_) {}
    bot.stop();
    process.exit(0);
};
process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

/* ── Start polling, auto-retry on startup failure (e.g. transient network) ── */
async function start() {
    try {
        await bot.start({
            drop_pending_updates: false,
            onStart: (me) => console.log(`🤖 Bot pornit ca @${me.username}`),
        });
    } catch (e) {
        console.error('Bot start failed, retrying in 5s:', e.message);
        setTimeout(start, 5000);
    }
}
start();
