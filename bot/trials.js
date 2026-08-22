'use strict';
/**
 * bot/trials.js — Legacy export surface for trial helpers.
 *
 * Product rule (pay-before-publish): there is no public unpaid trial and no
 * commercial sweeper that expires live sites or promises permanent hosting.
 *
 * sweepTrials is retained as a documented no-op so any stale require does not
 * expire sites, send reminders, or replace live content with a placeholder.
 * S24 already removed the bot.js interval call; this module must not reintroduce
 * that machine.
 *
 * CommonJS, Node 18+.
 *
 * S28: no trial-length product constant, no trial-days env read, no default
 * 3-day unpaid trial window — payment before first public publish.
 */

/**
 * No-op trial sweep. Does not list sites, deploy placeholders, set status,
 * set reminded, or send owner/admin messages.
 *
 * @param {object} [_opts] ignored (messenger / notifyAdmin unused)
 * @returns {Promise<{reminders: number, expired: number}>}
 */
async function sweepTrials(_opts = {}) {
    return { reminders: 0, expired: 0 };
}

module.exports = { sweepTrials };
