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
const ics = require('../ics');
const { getZonedParts } = require('../time');

/** Templates that carry a calendar object (.ics) — one VEVENT per booking, RFC 5545. */
const ICS_TEMPLATE_METHOD = Object.freeze({
    booking_confirmed: 'REQUEST',
    booking_reschedule_confirmed: 'REQUEST',
    booking_cancelled: 'CANCEL',
});

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function mintManageToken() {
    return crypto.randomBytes(24).toString('base64url');
}

/**
 * Public base for manage links (no secrets).
 *
 * This used to read only CALENDAR_PUBLIC_BASE_URL / PUBLIC_BASE_URL, neither of
 * which is set anywhere in this repo -- not in the Dockerfile, railway.json, CI
 * or the deploy runbook -- while the rest of the application configures itself
 * from PUBLIC_URL. So a deployment set up exactly as documented fell through to
 * the loopback default, and every cancel/reschedule link mailed to a visitor
 * pointed at http://127.0.0.1:0, a port that cannot be connected to at all.
 *
 * PUBLIC_URL is now the fallback before the loopback default, and choosing the
 * loopback is logged as an error rather than happening quietly: a dead link in
 * a customer's inbox is invisible to the business until someone who wanted to
 * cancel simply does not turn up.
 */
function manageBaseUrl() {
    const candidates = [
        process.env.CALENDAR_PUBLIC_BASE_URL,
        process.env.PUBLIC_BASE_URL,
        process.env.PUBLIC_URL,
    ];
    for (const candidate of candidates) {
        if (candidate && String(candidate).trim()) {
            return String(candidate).trim().replace(/\/$/, '');
        }
    }
    try {
        require('../../logger.js').log(
            'calendar.manage_url.unconfigured',
            { detail: 'no CALENDAR_PUBLIC_BASE_URL / PUBLIC_BASE_URL / PUBLIC_URL — manage links in visitor emails will not resolve' },
            'error'
        );
    } catch (_) { /* logging must never block sending */ }
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

/**
 * Wave 7 (audit #25) — who the appointment is with. Returns null (never a
 * placeholder string, and never the copy-visible "cu <nume>" line) when:
 *   - the booking has no resource yet (still-unresolved "any available"
 *     request), or
 *   - the tenant has only ONE resource — every pre-Wave-7 tenant and every
 *     tenant that never adds a second stylist/room. Naming a single
 *     implicit resource in visitor email would be a purely internal detail
 *     ("cu Personal implicit") leaking into copy that read fine before this
 *     wave — so email/. ics text only ever mentions who it's with once that
 *     information is actually meaningful (2+ resources exist).
 */
function loadResourceName(db, booking) {
    if (!booking || !booking.resource_id) return null;
    try {
        const engine = require('../engine');
        if (!engine.hasMultipleResources(db, booking.customer_id, booking.site_id)) return null;
        const row = db.prepare(
            `SELECT name FROM calendar_resources
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).get(booking.resource_id, booking.customer_id, booking.site_id);
        return row && row.name ? row.name : null;
    } catch (_) {
        return null;
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
 * Owner contact email — for the optional owner reminder and as the .ics
 * ORGANIZER. Same demo-tenant special case and try/catch fallback pattern
 * as loadSiteLabel above (registry is optional in the pure unit harness).
 * @param {object} booking
 * @returns {string|null}
 */
function loadOrganizerEmail(booking) {
    const customerId = booking && booking.customer_id;
    const siteId = booking && booking.site_id;
    if (customerId === 'demo_customer_elena' && siteId === 'demo_site_cabinet') {
        return 'elena@cabinet.ro';
    }
    try {
        const registry = require('../../registry');
        const user = registry.getUser(customerId);
        if (user && user.email) return String(user.email).trim();
    } catch (_) {
        /* registry optional in pure unit harness */
    }
    return null;
}

/**
 * Build the .ics calendar object for a lifecycle email, when that template
 * carries one (confirm / reschedule-confirm / cancel — never for
 * requested/reschedule_needed, which have nothing confirmed to put in a
 * calendar). Bumps and persists booking.ics_sequence (RFC 5545 SEQUENCE)
 * every time it is called — monotonic across the booking's whole lifecycle,
 * independent of which lifecycle event triggered this particular emission.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} booking
 * @param {string} templateKey
 * @returns {{ content: string, filename: string }|null}
 */
function buildIcsForEvent(db, booking, templateKey) {
    const method = ICS_TEMPLATE_METHOD[templateKey];
    if (!method) return null;

    const sequence = Number(booking.ics_sequence || 0);
    const serviceName = loadServiceName(db, booking);
    const siteLabel = loadSiteLabel(booking);
    const organizerEmail = loadOrganizerEmail(booking) || 'no-reply@hidook.invalid';
    const resourceName = loadResourceName(db, booking);

    const content = ics.buildBookingIcs({
        booking,
        serviceName,
        siteLabel,
        organizerEmail,
        method,
        sequence,
        resourceName,
    });

    try {
        db.prepare(`UPDATE calendar_bookings SET ics_sequence = ? WHERE id = ?`)
            .run(sequence + 1, booking.id);
    } catch (_) {
        /* best-effort — a stuck SEQUENCE still yields a valid, importable .ics */
    }

    return { content, filename: 'programare.ics' };
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
    const resourceName = loadResourceName(db, booking);
    const tz = loadTimezone(db, booking);
    const startOwnerLocal = formatOwnerLocal(booking.start_utc, tz);

    const rendered = templates.render({
        templateKey,
        visitorName: booking.visitor_name,
        serviceName,
        resourceName,
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

    const icsPart = buildIcsForEvent(db, booking, templateKey);

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
        icsContent: icsPart ? icsPart.content : null,
        icsFilename: icsPart ? icsPart.filename : null,
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
 * Enqueue one appointment reminder (visitor or owner kind) — called only by
 * reminders.js's fireOneReminder(), after it has already re-validated the
 * booking is still confirmed/upcoming/unsent inside its own transaction.
 * Reuses the exact same outbox (idempotency, backoff, dead-letter, audit)
 * as every lifecycle email; the only difference is the recipient and copy.
 *
 * No manage link: by the time a reminder fires, only the create path ever
 * held the raw manage token (hashed at rest since), so — like every
 * lifecycle email after create — the link is simply omitted rather than
 * rotating the hash (see ensureRawManageToken above).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ booking: object, kind: 'visitor'|'owner', nowMs?: number }} input
 */
function enqueueReminderEmail(db, input) {
    const booking = input && input.booking;
    const kind = input && input.kind === 'owner' ? 'owner' : 'visitor';
    if (!booking || !booking.id) return null;

    const templateKey = kind === 'owner' ? 'booking_reminder_owner' : 'booking_reminder';
    const serviceName = loadServiceName(db, booking);
    const resourceName = loadResourceName(db, booking);
    const tz = loadTimezone(db, booking);
    const startOwnerLocal = formatOwnerLocal(booking.start_utc, tz);
    const siteLabel = loadSiteLabel(booking);

    let recipientEmail;
    if (kind === 'owner') {
        recipientEmail = loadOrganizerEmail(booking);
        if (!recipientEmail) return null; // no owner email on file — nothing to send
    } else {
        recipientEmail = booking.visitor_email;
    }

    const rendered = templates.render({
        templateKey,
        visitorName: booking.visitor_name,
        visitorEmail: booking.visitor_email,
        visitorPhone: booking.visitor_phone,
        serviceName,
        resourceName,
        startOwnerLocal,
        startUtc: booking.start_utc,
        bookingStatus: booking.status,
        manageUrl: null,
        siteLabel,
    });

    const idem = 'calreminder:' + kind + ':' + booking.id + ':' + String(booking.start_utc);

    const row = outbox.enqueue(db, {
        customerId: booking.customer_id,
        siteId: booking.site_id,
        bookingId: booking.id,
        templateKey: rendered.templateKey,
        recipientEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        bookingStatus: booking.status,
        manageLinkPresent: false,
        idempotencyKey: idem,
        nowMs: input.nowMs,
    });

    return { outboxId: row.id, templateKey: rendered.templateKey, recipientEmail };
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
    enqueueReminderEmail,
    notifyBookingEvent,
    notifyBookingEventSafe,
    buildManageUrl,
    manageBaseUrl,
    ensureRawManageToken,
    formatOwnerLocal,
    loadSiteLabel,
    loadOrganizerEmail,
    loadResourceName,
    buildIcsForEvent,
    hashToken,
    mintManageToken,
    outbox,
    templates,
    policy,
    secrets,
    ics,
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
