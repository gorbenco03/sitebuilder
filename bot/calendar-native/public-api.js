'use strict';
/**
 * bot/calendar-native/public-api.js — public write-mostly booking surface.
 *
 * VISION.md §8 access control:
 * - reads only aggregated free slots + active services for one tenant
 * - creates bookings; never lists bookings / other visitors' PII
 * - tenant key = customer_id + site_id (required on every call)
 *
 * Separate from POST /api/appointments (local request form stays untouched).
 */

const path = require('path');
const { openCalendarDb } = require('./db');
const engine = require('./engine');
const { addDaysLocal } = require('./time');

const TENANT_RE = /^[a-zA-Z0-9_-]{2,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Demo tenant used by the public widget preview (not a cutover). */
const DEMO = Object.freeze({
    customerId: 'demo_customer_elena',
    siteId: 'demo_site_cabinet',
    brand: 'Cabinet Dr. Elena Pop',
    contactPhone: '0722 111 222',
    contactPhoneTel: '+40722111222',
    contactEmail: 'elena@cabinet.ro',
    contactWhatsapp: 'https://wa.me/40722111222',
});

let _db = null;
let _dbPath = null;

function getDb(opts = {}) {
    if (opts.db) return opts.db;
    if (opts.dbPath) {
        if (_db && _dbPath === opts.dbPath) return _db;
        if (_db) {
            try { _db.close(); } catch (_) { /* ignore */ }
        }
        _db = openCalendarDb({ dbPath: opts.dbPath });
        _dbPath = opts.dbPath;
        return _db;
    }
    if (_db) return _db;
    const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..');
    _db = openCalendarDb({ dataDir });
    _dbPath = null;
    return _db;
}

/** Test helper — reset singleton between oracle runs. */
function resetDbHandle() {
    if (_db) {
        try { _db.close(); } catch (_) { /* ignore */ }
    }
    _db = null;
    _dbPath = null;
}

function parseTenant(queryOrBody) {
    const customerId = String(
        (queryOrBody && (queryOrBody.customerId || queryOrBody.customer_id)) || ''
    ).trim();
    const siteId = String(
        (queryOrBody && (queryOrBody.siteId || queryOrBody.site_id)) || ''
    ).trim();
    if (!TENANT_RE.test(customerId) || !TENANT_RE.test(siteId)) {
        const err = new Error('customerId and siteId required');
        err.code = 'TENANT';
        err.status = 400;
        throw err;
    }
    return { customerId, siteId };
}

/**
 * Seed the design-canvas demo tenant (services + Mon–Fri hours).
 * Idempotent. Used by preview + behavioral oracle.
 */
function ensureDemoTenant(db) {
    engine.ensureSettings(db, DEMO.customerId, DEMO.siteId, {
        timezone: 'Europe/Bucharest',
        default_buffer_minutes: 10,
        slot_interval_minutes: 15,
        min_cancel_hours: 24,
    });
    const existing = engine.listServices(db, DEMO.customerId, DEMO.siteId, { activeOnly: false });
    if (!existing.length) {
        engine.upsertService(db, DEMO.customerId, DEMO.siteId, {
            id: 'svc_demo_consult',
            name: 'Consultație inițială',
            duration_minutes: 45,
            buffer_minutes: 10,
            sort_order: 0,
        });
        engine.upsertService(db, DEMO.customerId, DEMO.siteId, {
            id: 'svc_demo_control',
            name: 'Control',
            duration_minutes: 25,
            buffer_minutes: 5,
            sort_order: 1,
        });
        engine.upsertService(db, DEMO.customerId, DEMO.siteId, {
            id: 'svc_demo_online',
            name: 'Ședință online',
            duration_minutes: 40,
            buffer_minutes: 10,
            sort_order: 2,
        });
    }
    const weekly = engine.listWeeklyAvailability(db, DEMO.customerId, DEMO.siteId);
    if (!weekly.length) {
        engine.setWeeklyAvailability(db, DEMO.customerId, DEMO.siteId, [
            { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 },
            { weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60 },
            { weekday: 3, start_minute: 9 * 60, end_minute: 17 * 60 },
            { weekday: 4, start_minute: 9 * 60, end_minute: 17 * 60 },
            { weekday: 5, start_minute: 9 * 60, end_minute: 17 * 60 },
        ]);
    }
    return DEMO;
}

function publicService(row) {
    return {
        id: row.id,
        name: row.name,
        durationMinutes: row.duration_minutes,
        bufferMinutes: row.buffer_minutes,
    };
}

function publicSlot(row) {
    return {
        startUtc: row.start_utc,
        endUtc: row.end_utc,
        dateLocal: row.date_local,
    };
}

/**
 * GET services for one tenant only.
 * @returns {{ ok:true, timezone:string, services: object[] } | { error, code, status }}
 */
function listPublicServices(db, customerId, siteId) {
    const settings = engine.getSettings(db, customerId, siteId);
    if (!settings) {
        return { error: 'Calendar is not configured for this site.', code: 'NOT_CONFIGURED', status: 404 };
    }
    const services = engine.listServices(db, customerId, siteId, { activeOnly: true }).map(publicService);
    return {
        ok: true,
        timezone: settings.timezone,
        services,
    };
}

/**
 * GET free slots for one tenant + service across a date range (inclusive).
 * Caps range to 21 days to keep the public surface bounded.
 */
function listPublicSlots(db, customerId, siteId, {
    serviceId,
    fromDateLocal,
    toDateLocal,
    nowMs = Date.now(),
    minLeadMinutes = 30,
} = {}) {
    if (!serviceId || typeof serviceId !== 'string') {
        return { error: 'serviceId required', code: 'VALIDATION', status: 400 };
    }
    if (!DATE_RE.test(fromDateLocal || '') || !DATE_RE.test(toDateLocal || '')) {
        return { error: 'from and to dates required (YYYY-MM-DD)', code: 'VALIDATION', status: 400 };
    }
    if (toDateLocal < fromDateLocal) {
        return { error: 'to must be on or after from', code: 'VALIDATION', status: 400 };
    }
    // Cap window
    let end = toDateLocal;
    let cursor = fromDateLocal;
    let days = 0;
    while (cursor <= end && days < 22) {
        cursor = addDaysLocal(cursor, 1);
        days += 1;
    }
    if (days > 21) {
        end = addDaysLocal(fromDateLocal, 20);
    }

    const settings = engine.getSettings(db, customerId, siteId);
    if (!settings) {
        return { error: 'Calendar is not configured for this site.', code: 'NOT_CONFIGURED', status: 404 };
    }
    const service = engine.getService(db, customerId, siteId, serviceId);
    if (!service || !service.active) {
        return { error: 'Service not found.', code: 'SERVICE_NOT_FOUND', status: 404 };
    }

    let slots;
    try {
        slots = engine.generateSlotsRange(db, customerId, siteId, {
            serviceId,
            fromDateLocal,
            toDateLocal: end,
            nowMs,
            minLeadMinutes,
        });
    } catch (e) {
        return { error: 'Could not load free slots.', code: 'SLOTS_ERROR', status: 500, detail: e.message };
    }

    return {
        ok: true,
        timezone: settings.timezone,
        serviceId,
        fromDateLocal,
        toDateLocal: end,
        slots: slots.map(publicSlot),
    };
}

/**
 * POST create booking for one tenant. Never confirms outside availability.
 */
function createPublicBooking(db, customerId, siteId, body, { nowMs = Date.now() } = {}) {
    const serviceId = String((body && (body.serviceId || body.service_id)) || '').trim();
    const startUtc = String((body && (body.startUtc || body.start_utc)) || '').trim();
    if (!serviceId || !startUtc) {
        return { error: 'serviceId and startUtc required', code: 'VALIDATION', status: 400 };
    }

    try {
        const result = engine.createBooking(db, customerId, siteId, {
            serviceId,
            startUtc,
            visitorName: body.visitorName || body.visitor_name,
            visitorEmail: body.visitorEmail || body.visitor_email,
            visitorPhone: body.visitorPhone || body.visitor_phone,
            note: body.note,
            nowMs,
        });
        const b = result.booking;
        const service = engine.getService(db, customerId, siteId, b.service_id);
        return {
            ok: true,
            id: b.id,
            status: b.status,
            startUtc: b.start_utc,
            endUtc: b.end_utc,
            serviceId: b.service_id,
            serviceName: service ? service.name : null,
            // manage token only on create for this visitor — not listed elsewhere
            manageToken: result.manageToken,
        };
    } catch (e) {
        const code = e && e.code ? String(e.code) : 'BOOKING_ERROR';
        const status =
            code === 'VALIDATION' || code === 'SLOT_OUTSIDE_AVAILABILITY' || code === 'SLOT_IN_PAST'
                ? 400
                : code === 'SERVICE_NOT_FOUND' || code === 'SETTINGS_MISSING'
                    ? 404
                    : 500;
        const ro =
            code === 'SLOT_OUTSIDE_AVAILABILITY'
                ? 'Intervalul ales nu este disponibil (în afara programului sau zi liberă).'
                : code === 'SLOT_IN_PAST'
                    ? 'Intervalul ales a trecut deja.'
                    : code === 'VALIDATION'
                        ? 'Verifică numele, emailul și intervalul ales.'
                        : code === 'SERVICE_NOT_FOUND'
                            ? 'Serviciul nu mai este disponibil.'
                            : 'Nu am putut înregistra programarea. Încearcă din nou.';
        return { error: ro, code, status };
    }
}

module.exports = {
    DEMO,
    TENANT_RE,
    getDb,
    resetDbHandle,
    parseTenant,
    ensureDemoTenant,
    listPublicServices,
    listPublicSlots,
    createPublicBooking,
};
