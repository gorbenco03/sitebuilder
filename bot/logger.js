'use strict';
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

/**
 * Build the structured record without emitting it. Pure — used by tests.
 * @param {string} event   short dotted event name, e.g. 'order.paid'
 * @param {object} [fields] extra key/values merged into the record
 * @returns {{ts:string, event:string, [k:string]:any}}
 */
function format(event, fields) {
    const rec = { ts: new Date().toISOString(), event: String(event) };
    if (fields && typeof fields === 'object') {
        for (const k of Object.keys(fields)) {
            if (k === 'event') continue; // never let a field clobber the event name
            const v = fields[k];
            // Serialize Errors meaningfully (message + name) rather than as {}.
            rec[k] = v instanceof Error ? { name: v.name, message: v.message } : v;
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

module.exports = { log, info, error, format };
