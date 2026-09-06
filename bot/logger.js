'use strict';
const crypto = require('crypto');
/**
 * bot/logger.js — tiny zero-dependency structured logger.
 *
 * Emits exactly one JSON line per call, shaped {ts, event, ...fields}, so logs
 * are greppable and machine-parseable (Railway/Grafana/jq) while staying cheap.
 * No transport, no buffering, no deps: it just writes to stdout/stderr.
 *
 * Usage:
 *   const { log } = require('./logger.js');
 *   log('order.built', { chatId, slug });        // -> {"ts":"…","event":"order.built","chatId":…}
 *   log('order.failed', { chatId, err }, 'error'); // routes to stderr
 *
 * `ts` is injected automatically (ISO 8601) but may be overridden by passing a
 * `ts` field — handy for deterministic tests. Node's Date is fine in the bot
 * runtime, so the default never throws.
 *
 * Zero dependencies. Node 18+.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Partially redact an email address for logs (GDPR — BE-07): a raw address
 * logged on every auth attempt exposes the target of a spam list (not just
 * the attacker) to anyone with log access (Railway, an aggregator, ...).
 * Keeps the first character of the local part + the full domain (enough to
 * eyeball "is this the same user having trouble") plus an 8-char sha256
 * prefix of the lowercased address, so the same address always maps to the
 * same masked form and can still be correlated across log lines without ever
 * printing it in clear.
 * @param {string} email
 * @returns {string} e.g. 'a***@example.com#3f2a9c1d', or the input unchanged
 *                   if it does not look like an email address at all.
 */
function maskEmail(email) {
    const s = String(email == null ? '' : email);
    if (!EMAIL_RE.test(s)) return s;
    const at = s.indexOf('@');
    const local = s.slice(0, at);
    const domain = s.slice(at + 1);
    const hash = crypto.createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 8);
    return `${local.slice(0, 1)}***@${domain}#${hash}`;
}

/**
 * Build the structured record without emitting it. Pure — used by tests.
 *
 * Any field literally named `email` is masked automatically (see maskEmail)
 * so every caller gets GDPR-safe logs for free without having to remember to
 * redact at each call site — bot/email.js logs {email} on every magic-link
 * send/error, and that is the only place in the codebase that does.
 * @param {string} event   short dotted event name, e.g. 'order.paid'
 * @param {object} [fields] extra key/values merged into the record
 * @returns {{ts:string, event:string, [k:string]:any}}
 */
function format(event, fields) {
    const rec = { ts: new Date().toISOString(), event: String(event) };
    if (fields && typeof fields === 'object') {
        for (const k of Object.keys(fields)) {
            if (k === 'event') continue; // never let a field clobber the event name
            let v = fields[k];
            if (v instanceof Error) {
                // Serialize Errors meaningfully (message + name) rather than as {}.
                rec[k] = { name: v.name, message: v.message };
                continue;
            }
            if (typeof v === 'string' && k.toLowerCase() === 'email') {
                v = maskEmail(v);
            }
            rec[k] = v;
        }
    }
    return rec;
}

/**
 * Emit one JSON line. `level` 'error' routes to stderr, everything else stdout.
 * Never throws: a logger that crashes the process is worse than a dropped line.
 * @param {string} event
 * @param {object} [fields]
 * @param {'info'|'error'} [level]
 */
function log(event, fields, level) {
    let line;
    try {
        line = JSON.stringify(format(event, fields));
    } catch (_) {
        // Circular or otherwise unserializable fields — fall back to the event alone.
        try { line = JSON.stringify({ ts: new Date().toISOString(), event: String(event) }); }
        catch (_2) { return; }
    }
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
}

/** Convenience: log at error level. */
function error(event, fields) { log(event, fields, 'error'); }

/** Convenience: log at info level (default). */
function info(event, fields) { log(event, fields, 'info'); }

module.exports = { log, info, error, format, maskEmail };
