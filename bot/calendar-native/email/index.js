'use strict';
/**
 * bot/calendar-native/email/index.js — booking lifecycle → email pipeline.
 *
 * Wires engine state transitions to RO transactional emails via the generic
 * provider boundary + local/test harness (VISION.md §8 step d).
 *
 * Does NOT touch legacy POST /api/appointments.
 */

const crypto = require('crypto');
const outbox = require('./outbox');
const templates = require('./templates-ro');
const { createTransport, createMemoryTransport, createFailingTransport } = require('./provider');
const policy = require('./policy');
const secrets = require('./secrets');
const { getZonedParts } = require('../time');

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function mintManageToken() {
    return crypto.randomBytes(24).toString('base64url');
}

/**
 * Public base for manage links (no secrets). Local default is loopback path only.
 */
function manageBaseUrl() {
    const fromEnv = process.env.CALENDAR_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
    if (fromEnv && String(fromEnv).trim()) {
        return String(fromEnv).trim().replace(/\/$/, '');
    }
    return 'http://127.0.0.1:0';
}

/**
 * Build manage URL. Token is unguessable (32+ chars base64url) and scoped by
 * hash lookup to exactly one booking row.
 * @param {string} rawToken
 */
function buildManageUrl(rawToken) {
    const t = encodeURIComponent(String(rawToken || ''));
    return manageBaseUrl() + '/calendar-native/manage?token=' + t;
}

/**
 * Format start for owner timezone display.
 */
function formatOwnerLocal(startUtc, timezone) {
    const ms = Date.parse(startUtc);
    if (!Number.isFinite(ms)) return String(startUtc || '');
    const tz = timezone || 'Europe/Bucharest';
    try {
        const parts = getZonedParts(new Date(ms), tz);
        const y = String(parts.year).padStart(4, '0');
        const mo = String(parts.month).padStart(2, '0');
        const d = String(parts.day).padStart(2, '0');
        const h = String(parts.hour).padStart(2, '0');
        const mi = String(parts.minute).padStart(2, '0');
        return y + '-' + mo + '-' + d + ' ' + h + ':' + mi + ' (' + tz + ')';
    } catch (_) {
        return String(startUtc);
    }
}

/**
 * Resolve raw manage token for email bodies.
 *
 * Only the create path holds the raw token (hashed at rest afterward). Later
 * lifecycle events (owner cancel/confirm/reschedule) must NOT mint+rotate the
 * hash — that invalidated the visitor's original manage-link (AC3 defect).
 * When raw token is absent, return null and omit the manage URL from email.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} booking
 * @param {string|null|undefined} rawToken
 * @returns {string|null}
 */
function ensureRawManageToken(db, booking, rawToken) {
    if (rawToken && String(rawToken).length >= 16) {
        return String(rawToken);
    }
    // Do not rotate manage_token_hash. Old visitor links must keep working.
    return null;
}

function loadServiceName(db, booking) {
    try {
        const row = db.prepare(
            `SELECT name FROM calendar_services
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).get(booking.service_id, booking.customer_id, booking.site_id);
        return row && row.name ? row.name : 'Serviciu';
    } catch (_) {
        return 'Serviciu';
    }
}

function loadTimezone(db, booking) {
    try {
        const row = db.prepare(
            `SELECT timezone FROM calendar_settings
             WHERE customer_id = ? AND site_id = ?`
        ).get(booking.customer_id, booking.site_id);
        return row && row.timezone ? row.timezone : 'Europe/Bucharest';
    } catch (_) {
        return 'Europe/Bucharest';
    }
}

/**
 * Human cabinet/site name for email copy — never the internal site id.
 * Demo tenant uses the public brand; registry name when present; else "cabinet".
 */
function loadSiteLabel(booking, explicit) {
    if (explicit && String(explicit).trim()) {
        const e = String(explicit).trim();
        // Reject factory ids that leaked as labels
        if (!/^demo_site_/i.test(e) && !/^site_/i.test(e)) return e;
    }
    const customerId = booking && booking.customer_id;
    const siteId = booking && booking.site_id;
    if (customerId === 'demo_customer_elena' && siteId === 'demo_site_cabinet') {
        return 'Cabinet Dr. Elena Pop';
    }
    try {
        const site = require('../../registry').getSite(siteId);
        if (site) {
            const name =
                site.businessName ||
                site.brand ||
                site.name ||
                site.title ||
                (site.draft && (site.draft.businessName || site.draft.name)) ||
                null;
            if (name && String(name).trim()) return String(name).trim();
        }
    } catch (_) {
        /* registry optional in pure unit harness */
    }
    return 'cabinet';
}

/**
 * Synchronous enqueue only (engine hooks). Does not open sockets.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   booking: object,
 *   manageToken?: string|null,
 *   kind?: string,
 *   previousStatus?: string,
 *   siteLabel?: string,
 *   nowMs?: number,
 * }} input
 */
function enqueueBookingEmail(db, input) {
    const booking = input && input.booking;
    if (!booking || !booking.id) return null;

    const status = String(booking.status || '');
    const templateKey = templates.templateKeyForStatus(status, {
        kind: input.kind,
        previousStatus: input.previousStatus,
    });

    const rawToken = ensureRawManageToken(db, booking, input.manageToken);
    // Cancel emails omit manage link; other templates include it only when raw token known.
    const manageUrl =
        templateKey === 'booking_cancelled' || !rawToken ? null : buildManageUrl(rawToken);

    const serviceName = loadServiceName(db, booking);
    const tz = loadTimezone(db, booking);
    const startOwnerLocal = formatOwnerLocal(booking.start_utc, tz);

    const rendered = templates.render({
        templateKey,
        visitorName: booking.visitor_name,
        serviceName,
        startOwnerLocal,
        startUtc: booking.start_utc,
        bookingStatus: status,
        manageUrl,
        siteLabel: loadSiteLabel(booking, input.siteLabel),
    });

    // Idempotency: one email per booking + template + status + updated_at slice
    const idem =
        'calmail:' +
        booking.id +
        ':' +
        templateKey +
        ':' +
        status +
        ':' +
        String(booking.updated_at || booking.created_at || '');

    const row = outbox.enqueue(db, {
        customerId: booking.customer_id,
        siteId: booking.site_id,
        bookingId: booking.id,
        templateKey: rendered.templateKey,
        recipientEmail: booking.visitor_email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        bookingStatus: status,
        manageLinkPresent: Boolean(manageUrl),
        idempotencyKey: idem,
        nowMs: input.nowMs,
    });

    return {
        outboxId: row.id,
        templateKey: rendered.templateKey,
        manageUrl,
        manageToken: rawToken,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
    };
}

/**
 * Engine-safe sync hook: enqueue only; never throws into booking path.
 */
function enqueueBookingEmailSafe(db, input) {
    try {
        return enqueueBookingEmail(db, input);
    } catch (_) {
        return null;
    }
}

/**
 * Enqueue + immediately process (local harness) one lifecycle email.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   booking: object,
 *   manageToken?: string|null,
 *   kind?: string,
 *   previousStatus?: string,
 *   siteLabel?: string,
 *   nowMs?: number,
 *   deliver?: boolean,
 * }} input
 */
async function notifyBookingEvent(db, input) {
    const queued = enqueueBookingEmail(db, input || {});
    if (!queued) return null;

    const deliver = !input || input.deliver !== false;
    if (deliver) {
        await outbox.processOutbox(db, {
            nowMs: input && input.nowMs != null ? input.nowMs : Date.now(),
            limit: 20,
        });
    }

    return queued;
}

/**
 * Fire-and-forget safe wrapper (never breaks booking write).
 */
function notifyBookingEventSafe(db, input) {
    try {
        const p = notifyBookingEvent(db, input);
        if (p && typeof p.then === 'function') {
            p.catch(() => { /* never break booking path */ });
        }
        return p;
    } catch (_) {
        return null;
    }
}

module.exports = {
    enqueueBookingEmail,
    enqueueBookingEmailSafe,
    notifyBookingEvent,
    notifyBookingEventSafe,
    buildManageUrl,
    manageBaseUrl,
    ensureRawManageToken,
    formatOwnerLocal,
    loadSiteLabel,
    hashToken,
    mintManageToken,
    outbox,
    templates,
    policy,
    secrets,
    createTransport,
    createMemoryTransport,
    createFailingTransport,
    setTransport: outbox.setTransport,
    resetTransport: outbox.resetTransport,
    processOutbox: outbox.processOutbox,
    listOutbox: outbox.listOutbox,
    listAudit: outbox.listAudit,
    publicOutboxView: outbox.publicOutboxView,
};
