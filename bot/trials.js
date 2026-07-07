'use strict';
/**
 * bot/trials.js — Trial sweeper for the hidook platform.
 *
 * sweepTrials({ messenger, notifyAdmin }):
 *   (a) Reminder: for each live unpaid site expiring in <24h (once, flag `reminded`):
 *       - Telegram sites: messenger(ownerChatId, text)
 *       - Web sites: email if available (best-effort)
 *   (b) Expired unpaid: deploy placeholder → status 'expired' → notify
 *
 * Called from the existing sweeper in bot.js (setInterval / reconcilePending).
 *
 * CommonJS, Node 18+.
 */

const registry   = require('./registry.js');
const webpublish = require('./webpublish.js');
const { log }    = require('./logger.js');

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 3;
const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sweep all sites for trial expirations.
 *
 * @param {object} opts
 * @param {Function} [opts.messenger]    fn(chatId, text) — Telegram messenger
 * @param {Function} [opts.notifyAdmin]  fn(text) — owner/admin notification
 * @returns {Promise<{reminders: number, expired: number}>}
 */
async function sweepTrials({ messenger, notifyAdmin } = {}) {
    const now    = Date.now();
    const sites  = registry.listAllSites();
    let reminders = 0;
    let expired   = 0;

    for (const site of sites) {
        // Only process live, unpaid, trial sites
        if (site.paid)              continue;
        if (!site.trialEndsAt)      continue;
        if (site.status === 'expired' || site.status === 'deleted') continue;
        if (site.status !== 'live') continue;

        const endsAt = new Date(site.trialEndsAt).getTime();
        if (isNaN(endsAt))          continue;

        const msLeft = endsAt - now;

        // (b) Expired
        if (msLeft <= 0) {
            try {
                await webpublish.deployPlaceholder(site);
                log('trials.expired', { siteId: site.id, slug: site.slug });
                expired++;

                // Notify owner
                const msg = `⏳ Perioada de probă a expirat pentru site-ul tău. Plătește pentru a-l reactiva: ${site.url || ''}`;
                _sendToOwner(site, msg, messenger);
                if (typeof notifyAdmin === 'function') {
                    notifyAdmin(`⏳ Trial expirat: ${site.slug} (${site.platform || 'web'})`);
                }
            } catch (e) {
                log('trials.expire_error', { siteId: site.id, err: e.message }, 'error');
            }
            continue;
        }

        // (a) Reminder: < 24h left, not yet reminded
        if (msLeft < REMINDER_BEFORE_MS && !site.reminded) {
            try {
                registry.updateSite(site.id, { reminded: true });
                const hoursLeft = Math.max(1, Math.round(msLeft / 3600000));
                const msg = `⚠️ Site-ul tău "${site.slug}" expiră în ~${hoursLeft}h. Plătește acum pentru a-l păstra permanent: ${site.url || ''}`;
                _sendToOwner(site, msg, messenger);
                if (typeof notifyAdmin === 'function') {
                    notifyAdmin(`⚠️ Reminder trial: ${site.slug} (~${hoursLeft}h rămase)`);
                }
                reminders++;
                log('trials.reminder_sent', { siteId: site.id, hoursLeft });
            } catch (e) {
                log('trials.reminder_error', { siteId: site.id, err: e.message }, 'error');
            }
        }
    }

    return { reminders, expired };
}

/**
 * Send a message to the site owner on their platform channel.
 * Best-effort — never throws.
 */
function _sendToOwner(site, msg, messenger) {
    try {
        if (site.platform === 'telegram' && site.ownerChatId && typeof messenger === 'function') {
            Promise.resolve().then(() => messenger(String(site.ownerChatId), msg)).catch(() => {});
        }
        // Web: email would go here (best-effort, not yet implemented)
    } catch (_) {}
}

module.exports = { sweepTrials, TRIAL_DAYS };
