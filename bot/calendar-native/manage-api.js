'use strict';
/**
 * bot/calendar-native/manage-api.js — visitor manage-link surface (token scoped).
 * VISION §8: token unique, unguessable, single-booking; cancel frees slot.
 */

const engine = require('./engine');

const STATUS_LABEL_RO = Object.freeze({
    requested: 'în așteptare',
    confirmed: 'confirmată',
    cancelled: 'anulată',
    reschedule_needed: 'necesită reprogramare',
});

/**
 * Public-safe booking summary for the token holder only.
 * @param {object} row
 * @param {object|null} service
 */
function publicBookingView(row, service) {
    if (!row) return null;
    const status = String(row.status || '');
    return {
        id: row.id,
        status,
        statusLabelRo: STATUS_LABEL_RO[status] || status,
        startUtc: row.start_utc,
        endUtc: row.end_utc,
        serviceName: service ? service.name : null,
        visitorName: row.visitor_name,
        // email shown so visitor recognizes their booking; not other visitors
        visitorEmail: row.visitor_email,
        timezone: null, // filled by caller from settings when available
    };
}

/**
 * GET booking by raw manage token.
 * @returns {{ ok: true, booking: object } | { error, code, status }}
 */
function getBookingByToken(db, rawToken) {
    const token = String(rawToken || '').trim();
    if (!token || token.length < 16) {
        return { error: 'Link invalid sau expirat.', code: 'TOKEN', status: 400 };
    }
    const row = engine.getBookingByManageToken(db, token);
    if (!row) {
        return { error: 'Nu am găsit programarea pentru acest link.', code: 'NOT_FOUND', status: 404 };
    }
    const service = engine.getService(db, row.customer_id, row.site_id, row.service_id);
    const settings = engine.getSettings(db, row.customer_id, row.site_id);
    const booking = publicBookingView(row, service);
    if (settings) booking.timezone = settings.timezone;
    booking.minCancelHours = settings ? settings.min_cancel_hours : 24;
    return { ok: true, booking };
}

/**
 * POST cancel by manage token. Frees slot immediately when successful.
 */
function cancelByToken(db, rawToken, { nowMs = Date.now() } = {}) {
    const token = String(rawToken || '').trim();
    if (!token || token.length < 16) {
        return { error: 'Link invalid sau expirat.', code: 'TOKEN', status: 400 };
    }
    try {
        const result = engine.cancelBookingWithToken(db, token, { nowMs });
        const row = result.booking;
        const service = engine.getService(db, row.customer_id, row.site_id, row.service_id);
        const settings = engine.getSettings(db, row.customer_id, row.site_id);
        const booking = publicBookingView(row, service);
        if (settings) booking.timezone = settings.timezone;
        return {
            ok: true,
            already: !!result.already,
            booking,
            slotFreed: booking.status === 'cancelled',
        };
    } catch (e) {
        const code = e && e.code ? String(e.code) : 'CANCEL_ERROR';
        if (code === 'TOKEN') {
            return { error: 'Link invalid sau expirat.', code, status: 404 };
        }
        if (code === 'WINDOW') {
            return {
                error: 'Intervalul minim înainte de programare a trecut — nu mai poți anula din link.',
                code,
                status: 400,
            };
        }
        return {
            error: 'Nu am putut anula programarea. Încearcă din nou.',
            code,
            status: 500,
        };
    }
}

module.exports = {
    STATUS_LABEL_RO,
    publicBookingView,
    getBookingByToken,
    cancelByToken,
};
