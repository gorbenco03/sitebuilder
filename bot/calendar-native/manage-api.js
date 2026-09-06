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

/**
 * GET free slots for the tenant/service behind a manage token — reuses the
 * same slot generator as the public widget (VISION §8 recommendation), scoped
 * to the token's own booking so the visitor never needs to know or supply
 * customerId/siteId directly.
 */
function getSlotsForToken(db, rawToken, { fromDateLocal, toDateLocal, nowMs = Date.now() } = {}) {
    const token = String(rawToken || '').trim();
    if (!token || token.length < 16) {
        return { error: 'Link invalid sau expirat.', code: 'TOKEN', status: 400 };
    }
    const row = engine.getBookingByManageToken(db, token);
    if (!row) {
        return { error: 'Nu am găsit programarea pentru acest link.', code: 'NOT_FOUND', status: 404 };
    }
    if (row.status === 'cancelled') {
        return { error: 'Această programare este anulată — nu mai poate fi reprogramată.', code: 'STATE', status: 400 };
    }
    const { listPublicSlots } = require('./public-api');
    const out = listPublicSlots(db, row.customer_id, row.site_id, {
        serviceId: row.service_id,
        fromDateLocal,
        toDateLocal,
        nowMs,
    });
    if (out.error) return out;
    // Tenant ids stay server-side; visitor only needs the slot list.
    return {
        ok: true,
        timezone: out.timezone,
        fromDateLocal: out.fromDateLocal,
        toDateLocal: out.toDateLocal,
        slots: out.slots,
    };
}

/**
 * POST reschedule by manage token. Moves the booking to a new free slot;
 * old slot frees only if the new one was actually secured (never both taken
 * and lost — see engine.rescheduleBookingWithToken).
 */
function rescheduleByToken(db, rawToken, { startUtc, nowMs = Date.now() } = {}) {
    const token = String(rawToken || '').trim();
    if (!token || token.length < 16) {
        return { error: 'Link invalid sau expirat.', code: 'TOKEN', status: 400 };
    }
    const start = String(startUtc || '').trim();
    if (!start) {
        return { error: 'Alege un interval nou.', code: 'VALIDATION', status: 400 };
    }
    try {
        const result = engine.rescheduleBookingWithToken(db, token, { startUtc: start, nowMs });
        const row = result.booking;
        const service = engine.getService(db, row.customer_id, row.site_id, row.service_id);
        const settings = engine.getSettings(db, row.customer_id, row.site_id);
        const booking = publicBookingView(row, service);
        if (settings) booking.timezone = settings.timezone;
        booking.minCancelHours = settings ? settings.min_cancel_hours : 24;
        return { ok: true, booking };
    } catch (e) {
        const code = e && e.code ? String(e.code) : 'RESCHEDULE_ERROR';
        if (code === 'TOKEN') {
            return { error: 'Link invalid sau expirat.', code, status: 404 };
        }
        if (code === 'WINDOW') {
            return {
                error: 'Intervalul minim înainte de programare a trecut — nu mai poți reprograma din link.',
                code,
                status: 400,
            };
        }
        if (code === 'STATE') {
            return { error: 'Această programare este anulată — nu mai poate fi reprogramată.', code, status: 400 };
        }
        if (code === 'SLOT_TAKEN') {
            return {
                error: 'Acest interval tocmai a fost ocupat — nu e o confirmare falsă. Alege alt interval; programarea ta veche rămâne neschimbată.',
                code,
                status: 409,
            };
        }
        if (code === 'SLOT_OUTSIDE_AVAILABILITY') {
            return { error: 'Intervalul ales nu este disponibil (în afara programului sau zi liberă).', code, status: 400 };
        }
        if (code === 'SLOT_IN_PAST') {
            return { error: 'Intervalul ales a trecut deja.', code, status: 400 };
        }
        if (code === 'MIN_NOTICE') {
            return { error: 'Această programare trebuie făcută cu mai mult timp înainte.', code, status: 400 };
        }
        if (code === 'MAX_ADVANCE') {
            return { error: 'Această dată este prea departe în viitor pentru o programare.', code, status: 400 };
        }
        if (code === 'VALIDATION') {
            return { error: 'Interval invalid.', code, status: 400 };
        }
        return {
            error: 'Nu am putut reprograma. Încearcă din nou.',
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
    getSlotsForToken,
    rescheduleByToken,
};
