'use strict';
/**
 * bot/calendar-native/owner-api.js — authenticated owner dashboard surface.
 *
 * VISION.md §8 step (c) part 2:
 * - list/search bookings for own tenant only
 * - weekly availability + blackout overrides + service duration/buffer
 * - cancel / reschedule (slot frees immediately; history audited, not deleted)
 * - reachable only by the authenticated owner of that exact site/tenant
 *
 * Same SQLite schema as step (a)+(b). No parallel store.
 * Step (d): owner mutations drain the local email outbox (no production sender).
 */

const engine = require('./engine');
const { DEMO, TENANT_RE, parseTenant } = require('./public-api');
const { addDaysLocal } = require('./time');
const retention = require('./retention');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BOOKING_ID_RE = /^[a-zA-Z0-9_-]{4,80}$/;
const STATUS_SET = new Set(['requested', 'confirmed', 'cancelled', 'reschedule_needed']);

/** Drain local email outbox after owner mutations (no wire send). */
function kickEmailOutbox(db, nowMs) {
    try {
        const email = require('./email');
        const p = email.processOutbox(db, {
            nowMs: nowMs != null ? nowMs : Date.now(),
            limit: 20,
        });
        if (p && typeof p.then === 'function') p.catch(() => {});
    } catch (_) {
        /* ignore */
    }
}

const STATUS_RO = Object.freeze({
    requested: 'în așteptare',
    confirmed: 'confirmată',
    cancelled: 'anulată',
    reschedule_needed: 'reprogramare',
});

/**
 * Authorize owner access to a calendar tenant.
 *
 * Isolation key = Site Builder customer id + site id (VISION §8).
 * Session userId must equal customerId. Site must belong to that user in the
 * registry — except the design-canvas DEMO pair, which is allowed when the
 * session is signed as DEMO.customerId (local preview only).
 *
 * @param {string} userId  authenticated session user
 * @param {string} customerId
 * @param {string} siteId
 * @param {{ getSite?: (id: string) => object|null }} [deps]
 */
function authorizeOwnerTenant(userId, customerId, siteId, deps = {}) {
    if (!userId || typeof userId !== 'string') {
        return {
            ok: false,
            status: 401,
            code: 'AUTH',
            error: 'Autentificare necesară.',
        };
    }
    if (!TENANT_RE.test(customerId || '') || !TENANT_RE.test(siteId || '')) {
        return {
            ok: false,
            status: 400,
            code: 'TENANT',
            error: 'customerId și siteId sunt obligatorii.',
        };
    }
    // Hard bind: calendar customer_id IS the Site Builder customer (session uid).
    if (customerId !== userId) {
        return {
            ok: false,
            status: 403,
            code: 'FORBIDDEN',
            error: 'Acces interzis.',
        };
    }

    const isDemo =
        customerId === DEMO.customerId && siteId === DEMO.siteId;
    if (isDemo) {
        return { ok: true, demo: true, customerId, siteId };
    }

    const getSite = deps.getSite;
    if (typeof getSite !== 'function') {
        return {
            ok: false,
            status: 503,
            code: 'REGISTRY',
            error: 'Serviciu indisponibil.',
        };
    }
    const site = getSite(siteId);
    if (!site || site.userId !== userId) {
        return {
            ok: false,
            status: 403,
            code: 'FORBIDDEN',
            error: 'Acces interzis.',
        };
    }
    return { ok: true, demo: false, customerId, siteId, site };
}

function publicOwnerBooking(row, serviceMap, resourceMap) {
    const svc = serviceMap && serviceMap.get(row.service_id);
    const res = resourceMap && row.resource_id ? resourceMap.get(row.resource_id) : null;
    return {
        id: row.id,
        status: row.status,
        statusLabel: STATUS_RO[row.status] || row.status,
        startUtc: row.start_utc,
        endUtc: row.end_utc,
        serviceId: row.service_id,
        serviceName: svc ? svc.name : null,
        durationMinutes: svc ? svc.duration_minutes : null,
        // Wave 7 (audit #25): who the appointment is with. resourceId is
        // null for a still-unresolved "any available" request — the owner
        // dashboard shows a "Nealocat" (unassigned) badge and a reassign
        // action in that case (see owner-dashboard.js).
        resourceId: row.resource_id || null,
        resourceName: res ? res.name : null,
        visitorName: row.visitor_name,
        visitorEmail: row.visitor_email,
        visitorPhone: row.visitor_phone || null,
        note: row.note || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        cancelledAt: row.cancelled_at || null,
    };
}

function publicResourceAdmin(row) {
    return {
        id: row.id,
        name: row.name,
        active: !!row.active,
        sortOrder: row.sort_order,
        isDefault: !!row.is_default,
    };
}

function publicServiceAdmin(row) {
    return {
        id: row.id,
        name: row.name,
        durationMinutes: row.duration_minutes,
        bufferMinutes: row.buffer_minutes,
        active: !!row.active,
        sortOrder: row.sort_order,
    };
}

function publicWeekly(row) {
    return {
        id: row.id,
        weekday: row.weekday,
        startMinute: row.start_minute,
        endMinute: row.end_minute,
    };
}

/** Camel-cased settings shape shared by GET availability and PUT settings. */
function publicSettings(row) {
    return {
        timezone: row.timezone,
        defaultBufferMinutes: row.default_buffer_minutes,
        minCancelHours: row.min_cancel_hours,
        slotIntervalMinutes: row.slot_interval_minutes,
        minNoticeMinutes: row.min_notice_minutes,
        maxAdvanceDays: row.max_advance_days != null ? row.max_advance_days : null,
        reminderHoursBefore: row.reminder_hours_before,
        reminderVisitorEnabled: !!row.reminder_visitor_enabled,
        reminderOwnerEnabled: !!row.reminder_owner_enabled,
    };
}

function publicOverride(row) {
    return {
        id: row.id,
        dateLocal: row.date_local,
        kind: row.kind,
        startMinute: row.start_minute,
        endMinute: row.end_minute,
        note: row.note || null,
    };
}

function serviceMapFor(db, customerId, siteId) {
    const list = engine.listServices(db, customerId, siteId, { activeOnly: false });
    const m = new Map();
    for (const s of list) m.set(s.id, s);
    return m;
}

function resourceMapFor(db, customerId, siteId) {
    const list = engine.listResources(db, customerId, siteId, { activeOnly: false });
    const m = new Map();
    for (const r of list) m.set(r.id, r);
    return m;
}

/**
 * Resource admin view enriched with the EFFECTIVE set of service ids each
 * resource currently offers (explicit assignment, or every service via the
 * "zero rows = all" fallback — see engine.listResourcesForService) so the
 * owner dashboard's per-resource service checklist reflects reality, not
 * just explicit rows.
 */
function resourcesWithServiceIds(db, customerId, siteId) {
    const resources = engine.listResources(db, customerId, siteId, { activeOnly: false });
    const services = engine.listServices(db, customerId, siteId, { activeOnly: false });
    const eligibleByService = new Map();
    for (const s of services) {
        eligibleByService.set(s.id, new Set(engine.listResourcesForService(db, customerId, siteId, s.id).map((r) => r.id)));
    }
    return resources.map((r) => {
        const serviceIds = services.filter((s) => eligibleByService.get(s.id).has(r.id)).map((s) => s.id);
        const out = publicResourceAdmin(r);
        out.serviceIds = serviceIds;
        return out;
    });
}

/**
 * List / search bookings for one tenant (owner only — caller must authorize).
 */
function listOwnerBookings(db, customerId, siteId, {
    status,
    fromUtc,
    toUtc,
    fromDateLocal,
    toDateLocal,
    q,
    resourceId,
} = {}) {
    const settings = engine.getSettings(db, customerId, siteId);
    if (!settings) {
        return { error: 'Calendarul nu este configurat pentru acest site.', code: 'NOT_CONFIGURED', status: 404 };
    }

    let from = fromUtc || null;
    let to = toUtc || null;
    // Optional civil-date window → UTC bounds via settings timezone is display-side;
    // for filter we accept ISO or expand dateLocal loosely as full-day UTC envelope.
    if (!from && DATE_RE.test(fromDateLocal || '')) {
        from = fromDateLocal + 'T00:00:00.000Z';
    }
    if (!to && DATE_RE.test(toDateLocal || '')) {
        to = addDaysLocal(toDateLocal, 1) + 'T00:00:00.000Z';
    }

    let statusFilter = status || null;
    if (statusFilter && !STATUS_SET.has(statusFilter)) {
        return { error: 'Status invalid.', code: 'VALIDATION', status: 400 };
    }

    let rows = engine.listBookings(db, customerId, siteId, {
        status: statusFilter || undefined,
        fromUtc: from || undefined,
        toUtc: to || undefined,
    });

    const query = String(q || '').trim().toLowerCase();
    if (query) {
        rows = rows.filter((r) => {
            const hay = [
                r.visitor_name,
                r.visitor_email,
                r.visitor_phone,
                r.note,
                r.id,
            ].map((x) => String(x || '').toLowerCase()).join(' ');
            return hay.includes(query);
        });
    }

    // Wave 7 (audit #25) — filter to one resource's day/list, or
    // resourceId === '__unassigned__' for still-unresolved "any available"
    // requests the owner still needs to reassign.
    if (resourceId === '__unassigned__') {
        rows = rows.filter((r) => !r.resource_id);
    } else if (resourceId) {
        rows = rows.filter((r) => r.resource_id === resourceId);
    }

    const sm = serviceMapFor(db, customerId, siteId);
    const rm = resourceMapFor(db, customerId, siteId);
    const bookings = rows.map((r) => publicOwnerBooking(r, sm, rm));

    const counts = {
        confirmed: 0,
        requested: 0,
        reschedule_needed: 0,
        cancelled: 0,
    };
    for (const b of bookings) {
        if (counts[b.status] != null) counts[b.status] += 1;
    }

    return {
        ok: true,
        timezone: settings.timezone,
        counts,
        bookings,
    };
}

function cancelOwnerBooking(db, customerId, siteId, bookingId) {
    if (!BOOKING_ID_RE.test(bookingId || '')) {
        return { error: 'Programare invalidă.', code: 'VALIDATION', status: 400 };
    }
    const updated = engine.cancelBookingAsOwner(db, customerId, siteId, bookingId);
    if (!updated) {
        return { error: 'Programarea nu a fost găsită.', code: 'NOT_FOUND', status: 404 };
    }
    kickEmailOutbox(db);
    const sm = serviceMapFor(db, customerId, siteId);
    const rm = resourceMapFor(db, customerId, siteId);
    return { ok: true, booking: publicOwnerBooking(updated, sm, rm) };
}

function rescheduleOwnerBooking(db, customerId, siteId, bookingId, body, { nowMs } = {}) {
    if (!BOOKING_ID_RE.test(bookingId || '')) {
        return { error: 'Programare invalidă.', code: 'VALIDATION', status: 400 };
    }
    const startUtc = String((body && (body.startUtc || body.start_utc)) || '').trim();
    if (!startUtc) {
        return { error: 'startUtc este obligatoriu.', code: 'VALIDATION', status: 400 };
    }
    try {
        const updated = engine.rescheduleBookingAsOwner(db, customerId, siteId, bookingId, {
            startUtc,
            nowMs: nowMs != null ? nowMs : Date.now(),
        });
        if (!updated) {
            return { error: 'Programarea nu a fost găsită.', code: 'NOT_FOUND', status: 404 };
        }
        kickEmailOutbox(db, nowMs);
        const sm = serviceMapFor(db, customerId, siteId);
        const rm = resourceMapFor(db, customerId, siteId);
        return { ok: true, booking: publicOwnerBooking(updated, sm, rm) };
    } catch (e) {
        return mapEngineError(e);
    }
}

function confirmOwnerBooking(db, customerId, siteId, bookingId) {
    if (!BOOKING_ID_RE.test(bookingId || '')) {
        return { error: 'Programare invalidă.', code: 'VALIDATION', status: 400 };
    }
    try {
        const updated = engine.confirmBookingAsOwner(db, customerId, siteId, bookingId);
        if (!updated) {
            return { error: 'Programarea nu a fost găsită.', code: 'NOT_FOUND', status: 404 };
        }
        kickEmailOutbox(db);
        const sm = serviceMapFor(db, customerId, siteId);
        const rm = resourceMapFor(db, customerId, siteId);
        return { ok: true, booking: publicOwnerBooking(updated, sm, rm) };
    } catch (e) {
        return mapEngineError(e);
    }
}

/**
 * Owner-triggered early deletion ("dreptul la ștergere", VISION §8) — scrubs
 * one visitor's PII on this booking immediately, ahead of the 24-month
 * default retention sweep. Tenant-scoped like every other owner mutation;
 * idempotent (re-calling on an already-anonymized booking is a no-op).
 */
function eraseOwnerBookingPii(db, customerId, siteId, bookingId) {
    if (!BOOKING_ID_RE.test(bookingId || '')) {
        return { error: 'Programare invalidă.', code: 'VALIDATION', status: 400 };
    }
    const updated = retention.eraseBookingPii(db, customerId, siteId, bookingId);
    if (!updated) {
        return { error: 'Programarea nu a fost găsită.', code: 'NOT_FOUND', status: 404 };
    }
    const sm = serviceMapFor(db, customerId, siteId);
    const rm = resourceMapFor(db, customerId, siteId);
    return { ok: true, booking: publicOwnerBooking(updated, sm, rm) };
}

/**
 * @param {string} [opts.resourceId] Wave 7 (audit #25) — scope weekly hours
 *   + overrides to one resource's own calendar. Omitted keeps the exact
 *   pre-Wave-7 shape (every resource's rows together) for any caller that
 *   has not been updated for the new "Personal" tab yet.
 */
function getOwnerAvailability(db, customerId, siteId, { resourceId } = {}) {
    const settings = engine.getSettings(db, customerId, siteId);
    if (!settings) {
        return { error: 'Calendarul nu este configurat pentru acest site.', code: 'NOT_CONFIGURED', status: 404 };
    }
    const resources = resourcesWithServiceIds(db, customerId, siteId);
    return {
        ok: true,
        settings: publicSettings(settings),
        weekly: engine.listWeeklyAvailability(db, customerId, siteId, resourceId ? { resourceId } : {}).map(publicWeekly),
        overrides: engine.listDateOverrides(db, customerId, siteId, resourceId ? { resourceId } : {}).map(publicOverride),
        services: engine.listServices(db, customerId, siteId, { activeOnly: false }).map(publicServiceAdmin),
        resources,
        selectedResourceId: resourceId || null,
    };
}

/** GET /api/calendar-native/owner/resources */
function listOwnerResources(db, customerId, siteId) {
    const settings = engine.getSettings(db, customerId, siteId);
    if (!settings) {
        return { error: 'Calendarul nu este configurat pentru acest site.', code: 'NOT_CONFIGURED', status: 404 };
    }
    return { ok: true, resources: resourcesWithServiceIds(db, customerId, siteId) };
}

/**
 * Create (no id) or update (existing id) a resource. Mirrors putOwnerService's
 * partial-patch shape exactly. `serviceIds`, when provided, replaces this
 * resource's explicit service assignment (engine.setServiceResources) — omit
 * it to leave existing assignments untouched.
 */
function putOwnerResource(db, customerId, siteId, resourceId, body) {
    let existing = null;
    if (resourceId) {
        existing = engine.getResource(db, customerId, siteId, resourceId);
        if (!existing) {
            return { error: 'Resursa nu a fost găsită.', code: 'NOT_FOUND', status: 404 };
        }
    }
    const name = body && body.name != null ? String(body.name).trim().slice(0, 80) : (existing ? existing.name : '');
    if (!name) {
        return { error: 'Numele este obligatoriu.', code: 'VALIDATION', status: 400 };
    }
    const active = body && body.active != null ? (body.active ? 1 : 0) : (existing ? existing.active : 1);
    const sortOrder = body && body.sortOrder != null
        ? Number(body.sortOrder)
        : (existing ? existing.sort_order : 0);
    try {
        const row = engine.upsertResource(db, customerId, siteId, {
            id: resourceId || undefined,
            name,
            active,
            sort_order: sortOrder,
        });
        if (body && Array.isArray(body.serviceIds)) {
            // Assign this resource to exactly the given services — mirrors
            // engine.setServiceResources' per-service replace semantics, but
            // scoped from the resource side for the owner UI's checklist.
            for (const svc of engine.listServices(db, customerId, siteId, { activeOnly: false })) {
                const current = engine.listResourcesForService(db, customerId, siteId, svc.id).map((r) => r.id);
                const wants = body.serviceIds.includes(svc.id);
                const has = current.includes(row.id);
                if (wants && !has) {
                    engine.setServiceResources(db, customerId, siteId, svc.id, Array.from(new Set([...current, row.id])));
                } else if (!wants && has) {
                    engine.setServiceResources(db, customerId, siteId, svc.id, current.filter((id) => id !== row.id));
                }
            }
        }
        return { ok: true, resource: publicResourceAdmin(row) };
    } catch (e) {
        return mapEngineError(e);
    }
}

/**
 * Owner reassignment (audit #25 — "reassign a booking"): move a booking onto
 * a different resource without changing its time. Confirms only if free.
 */
function reassignOwnerBooking(db, customerId, siteId, bookingId, body) {
    if (!BOOKING_ID_RE.test(bookingId || '')) {
        return { error: 'Programare invalidă.', code: 'VALIDATION', status: 400 };
    }
    const resourceId = String((body && (body.resourceId || body.resource_id)) || '').trim();
    if (!resourceId) {
        return { error: 'resourceId este obligatoriu.', code: 'VALIDATION', status: 400 };
    }
    try {
        const updated = engine.reassignBookingAsOwner(db, customerId, siteId, bookingId, resourceId);
        if (!updated) {
            return { error: 'Programarea nu a fost găsită.', code: 'NOT_FOUND', status: 404 };
        }
        kickEmailOutbox(db);
        const sm = serviceMapFor(db, customerId, siteId);
        const rm = resourceMapFor(db, customerId, siteId);
        return { ok: true, booking: publicOwnerBooking(updated, sm, rm) };
    } catch (e) {
        return mapEngineError(e);
    }
}

function putOwnerWeekly(db, customerId, siteId, body) {
    const windowsIn = (body && (body.windows || body.weekly)) || [];
    if (!Array.isArray(windowsIn)) {
        return { error: 'windows trebuie să fie o listă.', code: 'VALIDATION', status: 400 };
    }
    const windows = [];
    for (const w of windowsIn) {
        const weekday = Number(w.weekday);
        const startMinute = Number(w.startMinute != null ? w.startMinute : w.start_minute);
        const endMinute = Number(w.endMinute != null ? w.endMinute : w.end_minute);
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
            return { error: 'weekday invalid (1–7).', code: 'VALIDATION', status: 400 };
        }
        if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) {
            return { error: 'interval orar invalid.', code: 'VALIDATION', status: 400 };
        }
        if (startMinute < 0 || startMinute >= 1440 || endMinute <= 0 || endMinute > 1440) {
            return { error: 'minutele trebuie să fie în 0–1440.', code: 'VALIDATION', status: 400 };
        }
        windows.push({ weekday, start_minute: startMinute, end_minute: endMinute });
    }
    // Wave 7 (audit #25): resourceId scopes this write to one resource's own
    // hours; omitted keeps the exact pre-Wave-7 behavior (writes the
    // tenant's implicit/default resource, created lazily on first use).
    const resourceId = body && (body.resourceId || body.resource_id) ? String(body.resourceId || body.resource_id) : undefined;
    try {
        engine.ensureSettings(db, customerId, siteId, {});
        const weekly = engine
            .setWeeklyAvailability(db, customerId, siteId, windows, resourceId ? { resourceId } : {})
            .map(publicWeekly);
        return { ok: true, weekly };
    } catch (e) {
        return mapEngineError(e);
    }
}

function addOwnerOverride(db, customerId, siteId, body) {
    const dateLocal = String((body && (body.dateLocal || body.date_local)) || '').trim();
    const kind = String((body && body.kind) || '').trim();
    if (!DATE_RE.test(dateLocal)) {
        return { error: 'dateLocal obligatoriu (YYYY-MM-DD).', code: 'VALIDATION', status: 400 };
    }
    if (kind !== 'blackout' && kind !== 'special_hours') {
        return { error: 'kind trebuie să fie blackout sau special_hours.', code: 'VALIDATION', status: 400 };
    }
    const override = {
        date_local: dateLocal,
        kind,
        note: body && body.note != null ? String(body.note).slice(0, 200) : null,
        // Wave 7 (audit #25): scope this blackout/special-hours override to
        // one resource; omitted defaults to the tenant's implicit/default
        // resource, matching pre-Wave-7 behavior exactly.
        resourceId: body && (body.resourceId || body.resource_id) ? String(body.resourceId || body.resource_id) : undefined,
    };
    if (kind === 'special_hours') {
        const startMinute = Number(body.startMinute != null ? body.startMinute : body.start_minute);
        const endMinute = Number(body.endMinute != null ? body.endMinute : body.end_minute);
        if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) {
            return { error: 'special_hours necesită startMinute și endMinute valide.', code: 'VALIDATION', status: 400 };
        }
        override.start_minute = startMinute;
        override.end_minute = endMinute;
    }
    try {
        engine.ensureSettings(db, customerId, siteId, {});
        const row = engine.addDateOverride(db, customerId, siteId, override);
        return { ok: true, override: publicOverride(row) };
    } catch (e) {
        return mapEngineError(e);
    }
}

function removeOwnerOverride(db, customerId, siteId, overrideId) {
    if (!overrideId || typeof overrideId !== 'string') {
        return { error: 'override invalid.', code: 'VALIDATION', status: 400 };
    }
    const ok = engine.removeDateOverride(db, customerId, siteId, overrideId);
    if (!ok) {
        return { error: 'Override-ul nu a fost găsit.', code: 'NOT_FOUND', status: 404 };
    }
    return { ok: true, removed: true, id: overrideId };
}

function putOwnerService(db, customerId, siteId, serviceId, body) {
    if (!serviceId || typeof serviceId !== 'string') {
        return { error: 'serviciu invalid.', code: 'VALIDATION', status: 400 };
    }
    const existing = engine.getService(db, customerId, siteId, serviceId);
    if (!existing) {
        return { error: 'Serviciul nu a fost găsit.', code: 'NOT_FOUND', status: 404 };
    }
    const name = body && body.name != null ? String(body.name).trim().slice(0, 80) : existing.name;
    const durationMinutes = body && (body.durationMinutes != null || body.duration_minutes != null)
        ? Number(body.durationMinutes != null ? body.durationMinutes : body.duration_minutes)
        : existing.duration_minutes;
    let bufferMinutes = existing.buffer_minutes;
    if (body && (body.bufferMinutes != null || body.buffer_minutes != null)) {
        const raw = body.bufferMinutes != null ? body.bufferMinutes : body.buffer_minutes;
        bufferMinutes = raw === null || raw === '' ? null : Number(raw);
    }
    const active = body && body.active != null
        ? (body.active ? 1 : 0)
        : existing.active;
    if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) {
        return { error: 'Nume și durată valide sunt obligatorii.', code: 'VALIDATION', status: 400 };
    }
    if (bufferMinutes != null && (!Number.isFinite(bufferMinutes) || bufferMinutes < 0)) {
        return { error: 'Buffer invalid.', code: 'VALIDATION', status: 400 };
    }
    try {
        const row = engine.upsertService(db, customerId, siteId, {
            id: serviceId,
            name,
            duration_minutes: durationMinutes,
            buffer_minutes: bufferMinutes,
            active,
            sort_order: existing.sort_order,
        });
        return { ok: true, service: publicServiceAdmin(row) };
    } catch (e) {
        return mapEngineError(e);
    }
}

function putOwnerSettings(db, customerId, siteId, body) {
    const patch = {};
    if (body && body.timezone) patch.timezone = String(body.timezone).slice(0, 64);
    if (body && (body.defaultBufferMinutes != null || body.default_buffer_minutes != null)) {
        patch.default_buffer_minutes = Number(
            body.defaultBufferMinutes != null ? body.defaultBufferMinutes : body.default_buffer_minutes
        );
    }
    if (body && (body.minCancelHours != null || body.min_cancel_hours != null)) {
        patch.min_cancel_hours = Number(
            body.minCancelHours != null ? body.minCancelHours : body.min_cancel_hours
        );
    }
    if (body && (body.slotIntervalMinutes != null || body.slot_interval_minutes != null)) {
        patch.slot_interval_minutes = Number(
            body.slotIntervalMinutes != null ? body.slotIntervalMinutes : body.slot_interval_minutes
        );
    }

    // Booking-window policy (audit #26) — same owner-configurable pattern as
    // default_buffer_minutes / min_cancel_hours above.
    if (body && (body.minNoticeMinutes != null || body.min_notice_minutes != null)) {
        const v = Number(body.minNoticeMinutes != null ? body.minNoticeMinutes : body.min_notice_minutes);
        if (!Number.isFinite(v) || v < 0 || v > 20160) {
            return { error: 'Notificarea minimă trebuie să fie între 0 și 20160 minute (14 zile).', code: 'VALIDATION', status: 400 };
        }
        patch.min_notice_minutes = v;
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'maxAdvanceDays')
        || (body && Object.prototype.hasOwnProperty.call(body, 'max_advance_days'))) {
        const raw = body.maxAdvanceDays !== undefined ? body.maxAdvanceDays : body.max_advance_days;
        if (raw === null || raw === '') {
            patch.max_advance_days = null;
        } else {
            const v = Number(raw);
            if (!Number.isFinite(v) || v <= 0 || v > 730) {
                return { error: 'Orizontul maxim de rezervare trebuie să fie între 1 și 730 zile (sau gol pentru fără limită).', code: 'VALIDATION', status: 400 };
            }
            patch.max_advance_days = v;
        }
    }

    // Reminder policy (audit #26).
    if (body && (body.reminderHoursBefore != null || body.reminder_hours_before != null)) {
        const v = Number(body.reminderHoursBefore != null ? body.reminderHoursBefore : body.reminder_hours_before);
        if (!Number.isFinite(v) || v < 0 || v > 336) {
            return { error: 'Reamintirea trebuie să fie între 0 și 336 ore (14 zile) înainte.', code: 'VALIDATION', status: 400 };
        }
        patch.reminder_hours_before = v;
    }
    if (body && (body.reminderVisitorEnabled != null || body.reminder_visitor_enabled != null)) {
        patch.reminder_visitor_enabled = Boolean(
            body.reminderVisitorEnabled != null ? body.reminderVisitorEnabled : body.reminder_visitor_enabled
        );
    }
    if (body && (body.reminderOwnerEnabled != null || body.reminder_owner_enabled != null)) {
        patch.reminder_owner_enabled = Boolean(
            body.reminderOwnerEnabled != null ? body.reminderOwnerEnabled : body.reminder_owner_enabled
        );
    }

    try {
        const settings = engine.ensureSettings(db, customerId, siteId, patch);
        return { ok: true, settings: publicSettings(settings) };
    } catch (e) {
        return mapEngineError(e);
    }
}

/**
 * Free slots for owner reschedule UI (same generator as public, tenant-scoped).
 */
function listOwnerSlots(db, customerId, siteId, opts) {
    const { listPublicSlots } = require('./public-api');
    return listPublicSlots(db, customerId, siteId, opts);
}

function mapEngineError(e) {
    const code = e && e.code ? String(e.code) : 'ERROR';
    const status =
        code === 'VALIDATION' || code === 'SLOT_OUTSIDE_AVAILABILITY' || code === 'SLOT_IN_PAST' ||
            code === 'STATE' || code === 'MIN_NOTICE' || code === 'MAX_ADVANCE' || code === 'RESOURCE_REQUIRED' ||
            code === 'NO_RESOURCE'
            ? 400
            : code === 'SERVICE_NOT_FOUND' || code === 'SETTINGS_MISSING' || code === 'NOT_FOUND' || code === 'RESOURCE_NOT_FOUND'
                ? 404
                : 500;
    const ro =
        code === 'NO_RESOURCE'
            ? 'Cabinetul nu are nicio persoană/resursă activă — adaugă una în tabul „Personal” înainte de a confirma.'
            : code === 'SLOT_OUTSIDE_AVAILABILITY'
            ? 'Intervalul ales nu este disponibil (în afara programului sau zi liberă).'
            : code === 'SLOT_IN_PAST'
                ? 'Intervalul ales a trecut deja.'
                : code === 'MIN_NOTICE'
                    ? 'Această programare trebuie făcută cu mai mult timp înainte.'
                    : code === 'MAX_ADVANCE'
                        ? 'Această dată este prea departe în viitor pentru o programare.'
                        : code === 'STATE'
                            ? 'Starea programării nu permite această acțiune.'
                            : code === 'RESOURCE_NOT_FOUND'
                                ? 'Persoana/resursa aleasă nu a fost găsită sau nu oferă acest serviciu.'
                                : code === 'RESOURCE_REQUIRED'
                                    ? 'Alocă mai întâi o persoană/resursă acestei programări.'
                                    : code === 'VALIDATION'
                                        ? 'Verifică datele introduse.'
                                        : 'Nu am putut salva. Încearcă din nou.';
    return { error: ro, code, status };
}

module.exports = {
    DEMO,
    STATUS_RO,
    authorizeOwnerTenant,
    parseTenant,
    listOwnerBookings,
    cancelOwnerBooking,
    rescheduleOwnerBooking,
    confirmOwnerBooking,
    reassignOwnerBooking,
    eraseOwnerBookingPii,
    getOwnerAvailability,
    listOwnerResources,
    putOwnerResource,
    putOwnerWeekly,
    addOwnerOverride,
    removeOwnerOverride,
    putOwnerService,
    putOwnerSettings,
    listOwnerSlots,
};
