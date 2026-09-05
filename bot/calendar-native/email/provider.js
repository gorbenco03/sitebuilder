'use strict';
/**
 * bot/calendar-native/email/provider.js — generic email provider boundary.
 *
 * VISION.md §8 Email delivery:
 * - generic interface (not hardwired to one vendor)
 * - local/test harness that does NOT send over the wire and needs NO production secrets
 *
 * A transport implements:
 *   send(message) → Promise<{ ok:boolean, messageId?:string, error?:string, suppressed?:boolean }>
 *
 * `message` shape (no secrets):
 *   { to, subject, text, html, headers?, meta?: { outboxId, templateKey, bookingId } }
 *
 * Production adapters (Resend/SMTP/…) are future owner-gated work — not this card.
 */

const crypto = require('crypto');
const { scrubString } = require('./secrets');

/**
 * @typedef {{
 *   to: string,
 *   subject: string,
 *   text: string,
 *   html: string,
 *   headers?: Record<string,string>,
 *   meta?: Record<string, unknown>,
 * }} EmailMessage
 *
 * @typedef {{
 *   ok: boolean,
 *   messageId?: string,
 *   error?: string,
 *   suppressed?: boolean,
 * }} SendResult
 *
 * @typedef {{
 *   name: string,
 *   requiresSecrets: boolean,
 *   send: (msg: EmailMessage) => Promise<SendResult>,
 *   getSent?: () => Array<Record<string, unknown>>,
 *   clear?: () => void,
 * }} EmailTransport
 */

/**
 * Local/test memory transport — records payloads, never opens a socket.
 * Default for this environment.
 * @param {{ failTimes?: number, alwaysFail?: boolean, suppressTo?: string[] }} [opts]
 * @returns {EmailTransport}
 */
function createMemoryTransport(opts = {}) {
    const sent = [];
    let failLeft = opts.failTimes != null ? Number(opts.failTimes) : 0;
    const alwaysFail = Boolean(opts.alwaysFail);
    const suppressTo = new Set((opts.suppressTo || []).map((e) => String(e).toLowerCase()));

    return {
        name: 'local-memory',
        requiresSecrets: false,
        async send(message) {
            const to = String(message && message.to || '').trim().toLowerCase();
            if (!to) {
                return { ok: false, error: 'missing recipient' };
            }
            if (suppressTo.has(to)) {
                return { ok: false, suppressed: true, error: 'recipient suppressed' };
            }
            if (alwaysFail || failLeft > 0) {
                if (failLeft > 0) failLeft -= 1;
                return { ok: false, error: 'simulated transport failure' };
            }
            const messageId = 'mem_' + crypto.randomBytes(8).toString('hex');
            const record = {
                messageId,
                to,
                subject: String(message.subject || ''),
                text: String(message.text || ''),
                html: String(message.html || ''),
                templateKey: message.meta && message.meta.templateKey,
                bookingId: message.meta && message.meta.bookingId,
                outboxId: message.meta && message.meta.outboxId,
                bookingStatus: message.meta && message.meta.bookingStatus,
                recordedAt: new Date().toISOString(),
            };
            sent.push(record);
            return { ok: true, messageId };
        },
        getSent() {
            return sent.slice();
        },
        clear() {
            sent.length = 0;
        },
    };
}

/**
 * Null transport that always fails (retry/dead-letter tests).
 * @returns {EmailTransport}
 */
function createFailingTransport() {
    return createMemoryTransport({ alwaysFail: true });
}

/**
 * Factory: pick transport by name. Never auto-enables a wire sender.
 * Unknown / production names fall back to local-memory unless explicitly forced
 * later by an owner-gated adapter module (not present here).
 *
 * @param {string} [name]
 * @param {object} [opts]
 * @returns {EmailTransport}
 */
function createTransport(name, opts = {}) {
    const n = String(name || process.env.CALENDAR_EMAIL_TRANSPORT || 'local-memory').toLowerCase();
    if (n === 'failing' || n === 'always-fail') return createFailingTransport();
    if (n === 'local' || n === 'local-memory' || n === 'memory' || n === 'test') {
        return createMemoryTransport(opts);
    }
    // Refuse silent wire send: any "resend"/"smtp" without a registered adapter
    // still uses memory and records that production was requested but not armed.
    if (n === 'resend' || n === 'smtp' || n === 'sendgrid') {
        const inner = createMemoryTransport(opts);
        return {
            name: 'local-memory-unarmed-' + n,
            requiresSecrets: false,
            async send(message) {
                const result = await inner.send(message);
                if (result.ok) {
                    result.messageId = (result.messageId || 'mem') + '_unarmed';
                }
                return result;
            },
            getSent: () => inner.getSent(),
            clear: () => inner.clear(),
        };
    }
    return createMemoryTransport(opts);
}

/**
 * Sanitize a transport error for storage/logs (no secrets).
 * @param {unknown} err
 */
function sanitizeTransportError(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return scrubString(err).slice(0, 300);
    if (err instanceof Error) return scrubString(err.message).slice(0, 300);
    return scrubString(String(err)).slice(0, 300);
}

module.exports = {
    createMemoryTransport,
    createFailingTransport,
    createTransport,
    sanitizeTransportError,
};
