'use strict';
/**
 * bot/calendar-native/email/outbox.js — queue, deliver, retry, audit.
 *
 * Status: queued → sent | failed (retrying) → dead_letter | suppressed
 * No silent drop. Secrets never stored in outbox/audit.
 */

const crypto = require('crypto');
const { MAX_ATTEMPTS, nextAttemptAtIso, policyDescription } = require('./policy');
const { createTransport, sanitizeTransportError } = require('./provider');
const { scrubJson, scrubString, assertNoSecrets } = require('./secrets');
const templates = require('./templates-ro');

function nowIso(ms) {
    return new Date(ms != null ? ms : Date.now()).toISOString();
}

function newId(prefix) {
    return prefix + '_' + crypto.randomBytes(12).toString('hex');
}

/** @type {import('./provider').EmailTransport|null} */
let defaultTransport = null;

function getTransport() {
    if (!defaultTransport) defaultTransport = createTransport('local-memory');
    return defaultTransport;
}

/**
 * Replace process-wide transport (tests). Returns previous.
 * @param {import('./provider').EmailTransport|null} t
 */
function setTransport(t) {
    const prev = defaultTransport;
    defaultTransport = t;
    return prev;
}

function resetTransport() {
    defaultTransport = createTransport('local-memory');
    return defaultTransport;
}

function writeAudit(db, {
    outboxId,
    customerId,
    siteId,
    bookingId,
    event,
    detail,
}) {
    const id = newId('ea');
    const detailJson = scrubJson(detail || {});
    assertNoSecrets(detailJson, 'email audit');
    db.prepare(
        `INSERT INTO calendar_email_audit (
            id, outbox_id, customer_id, site_id, booking_id, event, detail_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        id,
        outboxId,
        customerId,
        siteId,
        bookingId,
        String(event),
        detailJson,
        nowIso()
    );
    return id;
}

/**
 * Enqueue one transactional email. Idempotent on idempotencyKey.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   customerId: string,
 *   siteId: string,
 *   bookingId: string,
 *   templateKey: string,
 *   recipientEmail: string,
 *   subject: string,
 *   text: string,
 *   html: string,
 *   bookingStatus: string,
 *   manageLinkPresent?: boolean,
 *   idempotencyKey: string,
 *   providerName?: string,
 *   maxAttempts?: number,
 *   nowMs?: number,
 * }} input
 */
function enqueue(db, input) {
    const customerId = String(input.customerId || '');
    const siteId = String(input.siteId || '');
    const bookingId = String(input.bookingId || '');
    const templateKey = String(input.templateKey || '');
    const recipient = String(input.recipientEmail || '').trim().toLowerCase();
    const subject = scrubString(String(input.subject || '')).slice(0, 200);
    const text = scrubString(String(input.text || ''));
    const html = scrubString(String(input.html || ''));
    const bookingStatus = String(input.bookingStatus || '');
    const idem = String(input.idempotencyKey || '');
    const maxAttempts = input.maxAttempts != null ? Number(input.maxAttempts) : MAX_ATTEMPTS;
    const ts = nowIso(input.nowMs);
    const transport = getTransport();
    const providerName = String(input.providerName || transport.name || 'local-memory');

    if (!customerId || !siteId || !bookingId || !templateKey || !recipient || !idem) {
        const err = new Error('email enqueue validation failed');
        err.code = 'VALIDATION';
        throw err;
    }

    assertNoSecrets(subject + '\n' + text + '\n' + html, 'email body');

    const existing = db.prepare(
        `SELECT * FROM calendar_email_outbox WHERE idempotency_key = ?`
    ).get(idem);
    if (existing) return existing;

    const id = newId('em');
    db.prepare(
        `INSERT INTO calendar_email_outbox (
            id, customer_id, site_id, booking_id, template_key,
            recipient_email, subject, body_text, body_html, booking_status_snapshot,
            manage_link_present, status, attempt_count, max_attempts, next_attempt_at,
            last_error, provider_name, provider_message_id, idempotency_key,
            created_at, updated_at, sent_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, 'queued', 0, ?, ?,
            NULL, ?, NULL, ?,
            ?, ?, NULL
        )`
    ).run(
        id,
        customerId,
        siteId,
        bookingId,
        templateKey,
        recipient,
        subject,
        text,
        html,
        bookingStatus,
        input.manageLinkPresent ? 1 : 0,
        maxAttempts,
        null, // next_attempt_at NULL = due immediately
        providerName,
        idem,
        ts,
        ts
    );

    writeAudit(db, {
        outboxId: id,
        customerId,
        siteId,
        bookingId,
        event: 'queued',
        detail: {
            templateKey,
            bookingStatus,
            providerName,
            recipientDomain: recipient.includes('@') ? recipient.split('@')[1] : null,
            policy: policyDescription(),
        },
    });

    return db.prepare(`SELECT * FROM calendar_email_outbox WHERE id = ?`).get(id);
}

/**
 * Process due queued/failed rows once. Bounded by limit.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ limit?: number, nowMs?: number, transport?: import('./provider').EmailTransport }} [opts]
 */
async function processOutbox(db, opts = {}) {
    const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
    const now = nowIso(nowMs);
    const limit = opts.limit != null ? Number(opts.limit) : 50;
    const transport = opts.transport || getTransport();

    const due = db.prepare(
        `SELECT * FROM calendar_email_outbox
         WHERE status IN ('queued', 'failed')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`
    ).all(now, limit);

    const results = [];
    for (const row of due) {
        results.push(await attemptDeliver(db, row, { nowMs, transport }));
    }
    return results;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} row
 * @param {{ nowMs: number, transport: import('./provider').EmailTransport }} ctx
 */
async function attemptDeliver(db, row, ctx) {
    const transport = ctx.transport;
    const nowMs = ctx.nowMs;
    const ts = nowIso(nowMs);

    if (row.status === 'sent' || row.status === 'dead_letter' || row.status === 'suppressed') {
        return { id: row.id, status: row.status, skipped: true };
    }

    const attempt = Number(row.attempt_count || 0) + 1;
    let result;
    try {
        result = await transport.send({
            to: row.recipient_email,
            subject: row.subject,
            text: row.body_text,
            html: row.body_html,
            meta: {
                outboxId: row.id,
                templateKey: row.template_key,
                bookingId: row.booking_id,
                bookingStatus: row.booking_status_snapshot,
            },
        });
    } catch (e) {
        result = { ok: false, error: sanitizeTransportError(e) };
    }

    if (result && result.suppressed) {
        db.prepare(
            `UPDATE calendar_email_outbox
             SET status = 'suppressed', attempt_count = ?, updated_at = ?,
                 last_error = ?, next_attempt_at = NULL
             WHERE id = ?`
        ).run(attempt, ts, scrubString(result.error || 'suppressed').slice(0, 300), row.id);
        writeAudit(db, {
            outboxId: row.id,
            customerId: row.customer_id,
            siteId: row.site_id,
            bookingId: row.booking_id,
            event: 'suppressed',
            detail: { attempt, error: scrubString(result.error || '') },
        });
        return { id: row.id, status: 'suppressed' };
    }

    if (result && result.ok) {
        const mid = scrubString(result.messageId || '').slice(0, 120) || null;
        db.prepare(
            `UPDATE calendar_email_outbox
             SET status = 'sent', attempt_count = ?, updated_at = ?, sent_at = ?,
                 provider_message_id = ?, last_error = NULL, next_attempt_at = NULL,
                 provider_name = ?
             WHERE id = ?`
        ).run(attempt, ts, ts, mid, transport.name, row.id);
        writeAudit(db, {
            outboxId: row.id,
            customerId: row.customer_id,
            siteId: row.site_id,
            bookingId: row.booking_id,
            event: 'sent',
            detail: { attempt, providerMessageId: mid, providerName: transport.name },
        });
        return { id: row.id, status: 'sent', messageId: mid };
    }

    const errMsg = scrubString((result && result.error) || 'send failed').slice(0, 300);
    const maxA = Number(row.max_attempts) || MAX_ATTEMPTS;

    if (attempt >= maxA) {
        db.prepare(
            `UPDATE calendar_email_outbox
             SET status = 'dead_letter', attempt_count = ?, updated_at = ?,
                 last_error = ?, next_attempt_at = NULL
             WHERE id = ?`
        ).run(attempt, ts, errMsg, row.id);
        writeAudit(db, {
            outboxId: row.id,
            customerId: row.customer_id,
            siteId: row.site_id,
            bookingId: row.booking_id,
            event: 'dead_letter',
            detail: { attempt, error: errMsg, maxAttempts: maxA },
        });
        return { id: row.id, status: 'dead_letter', error: errMsg };
    }

    const nextAt = nextAttemptAtIso(attempt, nowMs);
    db.prepare(
        `UPDATE calendar_email_outbox
         SET status = 'failed', attempt_count = ?, updated_at = ?,
             last_error = ?, next_attempt_at = ?
         WHERE id = ?`
    ).run(attempt, ts, errMsg, nextAt, row.id);
    writeAudit(db, {
        outboxId: row.id,
        customerId: row.customer_id,
        siteId: row.site_id,
        bookingId: row.booking_id,
        event: 'failed',
        detail: { attempt, error: errMsg, nextAttemptAt: nextAt },
    });
    return { id: row.id, status: 'failed', error: errMsg, nextAttemptAt: nextAt };
}

/**
 * Tenant-scoped list for owner tooling / tests (no secrets).
 */
function listOutbox(db, customerId, siteId, { bookingId, status, limit = 100, includeBodies = false } = {}) {
    const bodyCols = includeBodies ? ',\n                body_text, body_html' : '';
    let sql =
        `SELECT id, customer_id, site_id, booking_id, template_key, recipient_email,
                subject, booking_status_snapshot, manage_link_present, status,
                attempt_count, max_attempts, next_attempt_at, last_error,
                provider_name, provider_message_id, idempotency_key,
                created_at, updated_at, sent_at${bodyCols}
         FROM calendar_email_outbox
         WHERE customer_id = ? AND site_id = ?`;
    const params = [customerId, siteId];
    if (bookingId) {
        sql += ' AND booking_id = ?';
        params.push(bookingId);
    }
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }
    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
}

function getOutbox(db, outboxId) {
    return db.prepare(`SELECT * FROM calendar_email_outbox WHERE id = ?`).get(outboxId) || null;
}

function listAudit(db, customerId, siteId, { outboxId, limit = 200 } = {}) {
    let sql =
        `SELECT id, outbox_id, customer_id, site_id, booking_id, event, detail_json, created_at
         FROM calendar_email_audit
         WHERE customer_id = ? AND site_id = ?`;
    const params = [customerId, siteId];
    if (outboxId) {
        sql += ' AND outbox_id = ?';
        params.push(outboxId);
    }
    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
}

/**
 * Export-safe view of one outbox row (no body dump required for UI).
 */
function publicOutboxView(row) {
    if (!row) return null;
    return {
        id: row.id,
        bookingId: row.booking_id,
        templateKey: row.template_key,
        recipientEmail: row.recipient_email,
        subject: row.subject,
        bookingStatus: row.booking_status_snapshot,
        status: row.status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        providerName: row.provider_name,
        providerMessageId: row.provider_message_id,
        lastError: row.last_error,
        createdAt: row.created_at,
        sentAt: row.sent_at,
    };
}

module.exports = {
    enqueue,
    processOutbox,
    attemptDeliver,
    listOutbox,
    listAudit,
    publicOutboxView,
    setTransport,
    resetTransport,
    getTransport,
    writeAudit,
    getOutbox,
    templates,
};
