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
 * Production adapter: Resend (reuses bot/email.js's RESEND_API_KEY/EMAIL_FROM
 * — see createResendTransport). SMTP/SendGrid have no adapter yet and still
 * fall back to the safe local-memory harness.
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
                icsContent: message.icsContent || null,
                icsFilename: message.icsFilename || null,
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
 * Real Resend transport — reuses bot/email.js's sendResendEmail (same
 * RESEND_API_KEY/EMAIL_FROM the magic-link email already sends with) instead
 * of a second copy of that fetch call. The .ics, when present, is attached
 * base64-encoded; Resend's own message id becomes this send's messageId.
 * @param {object} [opts]
 * @returns {EmailTransport}
 */
function createResendTransport(opts = {}) {
    return {
        name: 'resend',
        requiresSecrets: true,
        async send(message) {
            const to = String(message && message.to || '').trim();
            if (!to) return { ok: false, error: 'missing recipient' };
            const attachments = message.icsContent
                ? [{
                    filename: message.icsFilename || 'programare.ics',
                    content: Buffer.from(String(message.icsContent), 'utf8').toString('base64'),
                }]
                : undefined;
            try {
                // Required late (not at module load) so this file never fails
                // to import in an environment without bot/email.js on the path.
                const shared = require('../../email.js');
                await shared.sendResendEmail({
                    to,
                    subject: String(message.subject || ''),
                    html: String(message.html || ''),
                    text: String(message.text || ''),
                    attachments,
                });
            } catch (err) {
                return { ok: false, error: sanitizeTransportError(err) };
            }
            return { ok: true, messageId: 'resend_' + crypto.randomBytes(8).toString('hex') };
        },
    };
}

/**
 * Wrap a base transport as "requested but not armed" — used whenever a real
 * adapter was asked for (by name or by env) but its precondition (a secret,
 * mainly) is not met. Never silent: send() still succeeds against the inner
 * memory transport so delivery status stays honest (queued -> sent), while
 * the provider name makes clear in the outbox/audit trail that no wire send
 * actually happened.
 * @param {string} label
 * @param {object} [opts]
 * @returns {EmailTransport}
 */
function createUnarmedTransport(label, opts = {}) {
    const inner = createMemoryTransport(opts);
    return {
        name: 'local-memory-unarmed-' + label,
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

/**
 * Factory: pick transport by name. Never auto-enables a wire sender from an
 * ambiguous default — only an explicit name/CALENDAR_EMAIL_TRANSPORT of
 * 'resend' with RESEND_API_KEY set arms real delivery, and NODE_ENV=test
 * always refuses it regardless of those two (a test process's env must never
 * be able to send real email just because a developer's shell exports a real
 * key — see bot/test/audit27-r10-calendar-real-email.test.js).
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

    const inTestRun = process.env.NODE_ENV === 'test';

    if (n === 'resend') {
        if (!inTestRun && process.env.RESEND_API_KEY) {
            return createResendTransport(opts);
        }
        if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === 'production') {
            logUnconfigured(
                'CALENDAR_EMAIL_TRANSPORT=resend requested but RESEND_API_KEY is not set — ' +
                'calendar email delivery is running in local-memory mode in production'
            );
        }
        return createUnarmedTransport('resend', opts);
    }

    // SMTP/SendGrid: no adapter exists yet — same loud-in-production log as
    // resend above, same safe fallback.
    if (n === 'smtp' || n === 'sendgrid') {
        if (process.env.NODE_ENV === 'production') {
            logUnconfigured(
                `CALENDAR_EMAIL_TRANSPORT=${n} requested but no real adapter is wired yet — ` +
                'calendar email delivery is running in local-memory mode in production'
            );
        }
        return createUnarmedTransport(n, opts);
    }

    return createMemoryTransport(opts);
}

/** Loud, best-effort log — must never block factory/boot. */
function logUnconfigured(detail) {
    try {
        require('../../logger.js').log('calendar.email.transport.unconfigured', { detail }, 'error');
    } catch (_) { /* logging must never block boot */ }
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
    createResendTransport,
    createTransport,
    sanitizeTransportError,
};
