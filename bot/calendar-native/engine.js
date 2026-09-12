'use strict';
/**
 * bot/calendar-native/engine.js — slot generation + race-safe booking state machine.
 *
 * VISION.md §8:
 * - instant confirm only when free; else requested / reschedule_needed
 * - slot lock via BEGIN IMMEDIATE + UNIQUE active-slot index (not optimistic-only)
 * - all reads/writes scoped by (customer_id, site_id)
 */

const crypto = require('crypto');
const {
    zonedWallTimeToUtcMs,
    parseDateLocal,
    addDaysLocal,
    isoWeekdayForDateLocal,
    minutesToHourMinute,
    toIsoUtc,
    getZonedParts,
} = require('./time');
const { ACTIVE_BOOKING_STATUSES } = require('./schema');

/**
 * VISION §8 step (d): enqueue transactional email on booking state changes.
 * Sync, local harness only — never opens a wire socket from the engine.
 * Failures must not roll back the booking write.
 */
function emitBookingEmail(db, payload) {
    try {
        const email = require('./email');
        email.enqueueBookingEmailSafe(db, payload);
    } catch (_) {
        /* ignore — booking path stays authoritative */
    }
}

const STATUSES = Object.freeze({
    REQUESTED: 'requested',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    RESCHEDULE_NEEDED: 'reschedule_needed',
});

function nowIso() {
    return new Date().toISOString();
}

function newId(prefix) {
    return prefix + '_' + crypto.randomBytes(12).toString('hex');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function mintManageToken() {
    return crypto.randomBytes(24).toString('base64url');
}

/**
 * Owner-configurable booking-window policy (audit #26): minimum notice and
 * maximum advance horizon, enforced server-side wherever a start_utc is
 * accepted (createBooking, both reschedule paths) — not only in slot
 * generation, so a crafted request with a forged start_utc cannot bypass it.
 * Defaults (0 / NULL) are permissive — this never rejects a tenant that has
 * not configured the policy.
 */
function assertBookingWindow(settings, startMs, nowMs) {
    if (settings.min_notice_minutes && (startMs - nowMs) < settings.min_notice_minutes * 60000) {
        const err = new Error('slot violates minimum notice window');
        err.code = 'MIN_NOTICE';
        throw err;
    }
    if (settings.max_advance_days != null && (startMs - nowMs) > settings.max_advance_days * 86400000) {
        const err = new Error('slot beyond maximum advance window');
        err.code = 'MAX_ADVANCE';
        throw err;
    }
}

function assertTenant(customerId, siteId) {
    if (!customerId || typeof customerId !== 'string') throw new Error('customer_id required');
    if (!siteId || typeof siteId !== 'string') throw new Error('site_id required');
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} customerId
 * @param {string} siteId
 */
function getSettings(db, customerId, siteId) {
    assertTenant(customerId, siteId);
    return db.prepare(
        `SELECT * FROM calendar_settings WHERE customer_id = ? AND site_id = ?`
    ).get(customerId, siteId) || null;
}

function ensureSettings(db, customerId, siteId, patch = {}) {
    assertTenant(customerId, siteId);
    const existing = getSettings(db, customerId, siteId);
    const ts = nowIso();
    if (!existing) {
        db.prepare(
            `INSERT INTO calendar_settings (
                customer_id, site_id, timezone, default_buffer_minutes,
                min_cancel_hours, slot_interval_minutes,
                min_notice_minutes, max_advance_days,
                reminder_hours_before, reminder_visitor_enabled, reminder_owner_enabled,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            customerId,
            siteId,
            patch.timezone || 'Europe/Bucharest',
            patch.default_buffer_minutes != null ? patch.default_buffer_minutes : 0,
            patch.min_cancel_hours != null ? patch.min_cancel_hours : 24,
            patch.slot_interval_minutes != null ? patch.slot_interval_minutes : 15,
            patch.min_notice_minutes != null ? patch.min_notice_minutes : 0,
            patch.max_advance_days !== undefined ? patch.max_advance_days : null,
            patch.reminder_hours_before != null ? patch.reminder_hours_before : 24,
            patch.reminder_visitor_enabled != null ? (patch.reminder_visitor_enabled ? 1 : 0) : 1,
            patch.reminder_owner_enabled != null ? (patch.reminder_owner_enabled ? 1 : 0) : 0,
            ts,
            ts
        );
        return getSettings(db, customerId, siteId);
    }
    if (Object.keys(patch).length) {
        db.prepare(
            `UPDATE calendar_settings SET
                timezone = COALESCE(?, timezone),
                default_buffer_minutes = COALESCE(?, default_buffer_minutes),
                min_cancel_hours = COALESCE(?, min_cancel_hours),
                slot_interval_minutes = COALESCE(?, slot_interval_minutes),
                min_notice_minutes = COALESCE(?, min_notice_minutes),
                max_advance_days = CASE WHEN ? THEN ? ELSE max_advance_days END,
                reminder_hours_before = COALESCE(?, reminder_hours_before),
                reminder_visitor_enabled = COALESCE(?, reminder_visitor_enabled),
                reminder_owner_enabled = COALESCE(?, reminder_owner_enabled),
                updated_at = ?
             WHERE customer_id = ? AND site_id = ?`
        ).run(
            patch.timezone != null ? patch.timezone : null,
            patch.default_buffer_minutes != null ? patch.default_buffer_minutes : null,
            patch.min_cancel_hours != null ? patch.min_cancel_hours : null,
            patch.slot_interval_minutes != null ? patch.slot_interval_minutes : null,
            patch.min_notice_minutes != null ? patch.min_notice_minutes : null,
            patch.max_advance_days !== undefined ? 1 : 0,
            patch.max_advance_days !== undefined ? patch.max_advance_days : null,
            patch.reminder_hours_before != null ? patch.reminder_hours_before : null,
            patch.reminder_visitor_enabled != null ? (patch.reminder_visitor_enabled ? 1 : 0) : null,
            patch.reminder_owner_enabled != null ? (patch.reminder_owner_enabled ? 1 : 0) : null,
            ts,
            customerId,
            siteId
        );
    }
    return getSettings(db, customerId, siteId);
}

function upsertService(db, customerId, siteId, service) {
    assertTenant(customerId, siteId);
    if (!service || !service.name) throw new Error('service.name required');
    const id = service.id || newId('svc');
    const ts = nowIso();
    const existing = db.prepare(
        `SELECT id FROM calendar_services WHERE id = ? AND customer_id = ? AND site_id = ?`
    ).get(id, customerId, siteId);
    if (existing) {
        db.prepare(
            `UPDATE calendar_services SET
                name = ?, duration_minutes = ?, buffer_minutes = ?,
                active = ?, sort_order = ?, updated_at = ?
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).run(
            service.name,
            service.duration_minutes,
            service.buffer_minutes != null ? service.buffer_minutes : null,
            service.active === 0 ? 0 : 1,
            service.sort_order != null ? service.sort_order : 0,
            ts,
            id,
            customerId,
            siteId
        );
    } else {
        db.prepare(
            `INSERT INTO calendar_services (
                id, customer_id, site_id, name, duration_minutes, buffer_minutes,
                active, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id,
            customerId,
            siteId,
            service.name,
            service.duration_minutes,
            service.buffer_minutes != null ? service.buffer_minutes : null,
            service.active === 0 ? 0 : 1,
            service.sort_order != null ? service.sort_order : 0,
            ts,
            ts
        );
    }
    return getService(db, customerId, siteId, id);
}

function getService(db, customerId, siteId, serviceId) {
    assertTenant(customerId, siteId);
    return db.prepare(
        `SELECT * FROM calendar_services WHERE id = ? AND customer_id = ? AND site_id = ?`
    ).get(serviceId, customerId, siteId) || null;
}

function listServices(db, customerId, siteId, { activeOnly = true } = {}) {
    assertTenant(customerId, siteId);
    if (activeOnly) {
        return db.prepare(
            `SELECT * FROM calendar_services
             WHERE customer_id = ? AND site_id = ? AND active = 1
             ORDER BY sort_order ASC, name ASC`
        ).all(customerId, siteId);
    }
    return db.prepare(
        `SELECT * FROM calendar_services
         WHERE customer_id = ? AND site_id = ?
         ORDER BY sort_order ASC, name ASC`
    ).all(customerId, siteId);
}

/**
 * Wave 7 (audit #25) — staff/resource model. A "resource" is a named
 * bookable unit: a stylist, a room, a bay. Every tenant that never touches
 * resources gets exactly one, created lazily on first use, so every
 * pre-existing single-calendar call path (and every pre-Wave-7 test) keeps
 * behaving exactly as before. See schema.js v5 doc comment.
 */

/**
 * Returns the tenant's implicit default resource id, creating it if this
 * tenant has never had one (lazy — covers both brand-new tenants and any
 * legacy path that calls availability/booking functions without a
 * resourceId). Idempotent: never creates a second default per tenant.
 */
function getOrCreateDefaultResourceId(db, customerId, siteId) {
    assertTenant(customerId, siteId);
    const existing = db.prepare(
        `SELECT id FROM calendar_resources WHERE customer_id = ? AND site_id = ? AND is_default = 1`
    ).get(customerId, siteId);
    if (existing) return existing.id;
    const id = newId('res');
    const ts = nowIso();
    db.prepare(
        `INSERT INTO calendar_resources
            (id, customer_id, site_id, name, active, sort_order, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, 1, ?, ?)`
    ).run(id, customerId, siteId, 'Personal implicit', ts, ts);
    return id;
}

function upsertResource(db, customerId, siteId, resource) {
    assertTenant(customerId, siteId);
    if (!resource || !resource.name) throw new Error('resource.name required');
    const id = resource.id || newId('res');
    const ts = nowIso();
    const existing = db.prepare(
        `SELECT id FROM calendar_resources WHERE id = ? AND customer_id = ? AND site_id = ?`
    ).get(id, customerId, siteId);
    if (existing) {
        db.prepare(
            `UPDATE calendar_resources SET
                name = ?, active = ?, sort_order = ?, updated_at = ?
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).run(
            resource.name,
            resource.active === 0 ? 0 : 1,
            resource.sort_order != null ? resource.sort_order : 0,
            ts,
            id,
            customerId,
            siteId
        );
    } else {
        db.prepare(
            `INSERT INTO calendar_resources
                (id, customer_id, site_id, name, active, sort_order, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(
            id,
            customerId,
            siteId,
            resource.name,
            resource.active === 0 ? 0 : 1,
            resource.sort_order != null ? resource.sort_order : 0,
            ts,
            ts
        );
    }
    return getResource(db, customerId, siteId, id);
}

function getResource(db, customerId, siteId, resourceId) {
    assertTenant(customerId, siteId);
    return db.prepare(
        `SELECT * FROM calendar_resources WHERE id = ? AND customer_id = ? AND site_id = ?`
    ).get(resourceId, customerId, siteId) || null;
}

function listResources(db, customerId, siteId, { activeOnly = true } = {}) {
    assertTenant(customerId, siteId);
    if (activeOnly) {
        return db.prepare(
            `SELECT * FROM calendar_resources
             WHERE customer_id = ? AND site_id = ? AND active = 1
             ORDER BY sort_order ASC, name ASC`
        ).all(customerId, siteId);
    }
    return db.prepare(
        `SELECT * FROM calendar_resources
         WHERE customer_id = ? AND site_id = ?
         ORDER BY sort_order ASC, name ASC`
    ).all(customerId, siteId);
}

/**
 * True once a tenant has configured more than its one implicit resource.
 * Used everywhere a "cu <nume>" / "Cu cine" line would otherwise leak a
 * purely internal detail ("Personal implicit") into visitor-facing copy for
 * every legacy single-resource tenant — see email/index.js loadResourceName,
 * manage-api.js publicBookingView, public-api.js createPublicBooking.
 */
function hasMultipleResources(db, customerId, siteId) {
    assertTenant(customerId, siteId);
    const row = db.prepare(
        `SELECT COUNT(*) AS n FROM calendar_resources WHERE customer_id = ? AND site_id = ?`
    ).get(customerId, siteId);
    return !!row && Number(row.n) > 1;
}

/**
 * Replace the full set of resources eligible for a service (explicit
 * assignment). An empty array is a valid, meaningful state — "no resource
 * currently offers this service" — distinct from "never assigned" (see
 * listResourcesForService).
 */
function setServiceResources(db, customerId, siteId, serviceId, resourceIds) {
    assertTenant(customerId, siteId);
    if (!Array.isArray(resourceIds)) throw new Error('resourceIds must be an array');
    const ts = nowIso();
    db.prepare(
        `DELETE FROM calendar_service_resources
         WHERE customer_id = ? AND site_id = ? AND service_id = ?`
    ).run(customerId, siteId, serviceId);
    const ins = db.prepare(
        `INSERT OR IGNORE INTO calendar_service_resources
            (customer_id, site_id, service_id, resource_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
    );
    for (const rid of resourceIds) {
        ins.run(customerId, siteId, serviceId, rid, ts);
    }
    return listResourcesForService(db, customerId, siteId, serviceId);
}

/**
 * Resources eligible to perform a service. Zero explicit assignment rows
 * (this service_id was never touched by setServiceResources) falls back to
 * "every active resource of this tenant" — the permissive default that lets
 * a brand-new service or a never-touched single-resource tenant work with
 * no owner action. Once at least one row exists for the service, only
 * assigned + active resources are eligible (an explicit empty assignment
 * correctly yields zero eligible resources, not "all").
 */
function listResourcesForService(db, customerId, siteId, serviceId) {
    assertTenant(customerId, siteId);
    const assigned = db.prepare(
        `SELECT r.* FROM calendar_service_resources sr
         JOIN calendar_resources r
           ON r.id = sr.resource_id AND r.customer_id = sr.customer_id AND r.site_id = sr.site_id
         WHERE sr.customer_id = ? AND sr.site_id = ? AND sr.service_id = ? AND r.active = 1
         ORDER BY r.sort_order ASC, r.name ASC`
    ).all(customerId, siteId, serviceId);
    if (assigned.length) return assigned;
    const anyAssignment = db.prepare(
        `SELECT 1 FROM calendar_service_resources
         WHERE customer_id = ? AND site_id = ? AND service_id = ? LIMIT 1`
    ).get(customerId, siteId, serviceId);
    if (anyAssignment) return []; // explicit assignment exists, all now inactive
    return listResources(db, customerId, siteId, { activeOnly: true });
}

function listServicesForResource(db, customerId, siteId, resourceId) {
    assertTenant(customerId, siteId);
    return db.prepare(
        `SELECT s.* FROM calendar_service_resources sr
         JOIN calendar_services s
           ON s.id = sr.service_id AND s.customer_id = sr.customer_id AND s.site_id = sr.site_id
         WHERE sr.customer_id = ? AND sr.site_id = ? AND sr.resource_id = ?
         ORDER BY s.sort_order ASC, s.name ASC`
    ).all(customerId, siteId, resourceId);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.resourceId] Scope to one resource. Omitted (legacy
 *   callers) means "the tenant's implicit default resource" on write, and
 *   "every resource of this tenant" on read — see call sites below.
 */
function setWeeklyAvailability(db, customerId, siteId, windows, opts = {}) {
    assertTenant(customerId, siteId);
    if (!Array.isArray(windows)) throw new Error('windows must be an array');
    const resourceId = opts.resourceId || getOrCreateDefaultResourceId(db, customerId, siteId);
    db.prepare(
        `DELETE FROM calendar_weekly_availability WHERE customer_id = ? AND site_id = ? AND resource_id = ?`
    ).run(customerId, siteId, resourceId);
    const ins = db.prepare(
        `INSERT INTO calendar_weekly_availability
            (id, customer_id, site_id, resource_id, weekday, start_minute, end_minute)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const w of windows) {
        ins.run(newId('wav'), customerId, siteId, resourceId, w.weekday, w.start_minute, w.end_minute);
    }
    return listWeeklyAvailability(db, customerId, siteId, { resourceId });
}

function listWeeklyAvailability(db, customerId, siteId, opts = {}) {
    assertTenant(customerId, siteId);
    if (opts.resourceId) {
        return db.prepare(
            `SELECT * FROM calendar_weekly_availability
             WHERE customer_id = ? AND site_id = ? AND resource_id = ?
             ORDER BY weekday ASC, start_minute ASC`
        ).all(customerId, siteId, opts.resourceId);
    }
    return db.prepare(
        `SELECT * FROM calendar_weekly_availability
         WHERE customer_id = ? AND site_id = ?
         ORDER BY weekday ASC, start_minute ASC`
    ).all(customerId, siteId);
}

function addDateOverride(db, customerId, siteId, override) {
    assertTenant(customerId, siteId);
    const id = override.id || newId('ov');
    const resourceId = override.resourceId || override.resource_id
        || getOrCreateDefaultResourceId(db, customerId, siteId);
    db.prepare(
        `INSERT INTO calendar_date_overrides
            (id, customer_id, site_id, resource_id, date_local, kind, start_minute, end_minute, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        id,
        customerId,
        siteId,
        resourceId,
        override.date_local,
        override.kind,
        override.start_minute != null ? override.start_minute : null,
        override.end_minute != null ? override.end_minute : null,
        override.note != null ? override.note : null
    );
    return db.prepare(
        `SELECT * FROM calendar_date_overrides WHERE id = ? AND customer_id = ? AND site_id = ?`
    ).get(id, customerId, siteId);
}

/**
 * Remove a date override for this tenant only. Returns true if a row was deleted.
 */
function removeDateOverride(db, customerId, siteId, overrideId) {
    assertTenant(customerId, siteId);
    if (!overrideId) return false;
    const r = db.prepare(
        `DELETE FROM calendar_date_overrides
         WHERE id = ? AND customer_id = ? AND site_id = ?`
    ).run(overrideId, customerId, siteId);
    return r.changes > 0;
}

function listDateOverrides(db, customerId, siteId, { fromDate, toDate, resourceId } = {}) {
    assertTenant(customerId, siteId);
    let sql = `SELECT * FROM calendar_date_overrides WHERE customer_id = ? AND site_id = ?`;
    const params = [customerId, siteId];
    if (resourceId) {
        sql += ' AND resource_id = ?';
        params.push(resourceId);
    }
    if (fromDate && toDate) {
        sql += ' AND date_local >= ? AND date_local <= ?';
        params.push(fromDate, toDate);
    }
    sql += ' ORDER BY date_local ASC';
    return db.prepare(sql).all(...params);
}

/**
 * Open minute ranges for a local civil date after weekly + blackout rules,
 * scoped to one resource (defaults to the tenant's implicit resource so
 * every pre-Wave-7 call site keeps its exact old behavior).
 * @returns {{ start_minute: number, end_minute: number }[]}
 */
function openRangesForDate(db, customerId, siteId, dateLocal, opts = {}) {
    assertTenant(customerId, siteId);
    const resourceId = opts.resourceId || getOrCreateDefaultResourceId(db, customerId, siteId);
    const overrides = db.prepare(
        `SELECT * FROM calendar_date_overrides
         WHERE customer_id = ? AND site_id = ? AND date_local = ? AND resource_id = ?`
    ).all(customerId, siteId, dateLocal, resourceId);

    if (overrides.some((o) => o.kind === 'blackout')) {
        return [];
    }
    const special = overrides.filter((o) => o.kind === 'special_hours');
    if (special.length) {
        return special
            .map((o) => ({ start_minute: o.start_minute, end_minute: o.end_minute }))
            .sort((a, b) => a.start_minute - b.start_minute);
    }

    const weekday = isoWeekdayForDateLocal(dateLocal);
    return db.prepare(
        `SELECT start_minute, end_minute FROM calendar_weekly_availability
         WHERE customer_id = ? AND site_id = ? AND resource_id = ? AND weekday = ?
         ORDER BY start_minute ASC`
    ).all(customerId, siteId, resourceId, weekday);
}

/**
 * Active bookings that occupy time (requested + confirmed) for tenant.
 * Optionally filter by service for slot-lock uniqueness; overlap uses same service
 * for engine lock per VISION (tenant/site + service + slot).
 */
function listActiveBookings(db, customerId, siteId, { serviceId, resourceId, fromUtc, toUtc } = {}) {
    assertTenant(customerId, siteId);
    const statuses = ACTIVE_BOOKING_STATUSES;
    let sql = `
        SELECT * FROM calendar_bookings
        WHERE customer_id = ? AND site_id = ?
          AND status IN ('${statuses[0]}', '${statuses[1]}')
    `;
    const params = [customerId, siteId];
    if (serviceId) {
        sql += ' AND service_id = ?';
        params.push(serviceId);
    }
    if (resourceId) {
        sql += ' AND resource_id = ?';
        params.push(resourceId);
    }
    if (fromUtc && toUtc) {
        // overlap: start < to AND end > from
        sql += ' AND start_utc < ? AND end_utc > ?';
        params.push(toUtc, fromUtc);
    }
    sql += ' ORDER BY start_utc ASC';
    return db.prepare(sql).all(...params);
}

/**
 * Free slot starts for ONE resource on a local date. Occupancy is checked
 * against that resource's own active bookings (any service — a resource is
 * a physical person/room that can only do one thing at a time), never the
 * service label. Internal helper for generateSlots.
 */
function generateSlotsForResource(db, customerId, siteId, settings, service, dateLocal, resourceId, nowMs, minLeadMinutes) {
    const tz = settings.timezone;
    const interval = settings.slot_interval_minutes;
    const buffer = service.buffer_minutes != null
        ? service.buffer_minutes
        : settings.default_buffer_minutes;
    const duration = service.duration_minutes;

    const ranges = openRangesForDate(db, customerId, siteId, dateLocal, { resourceId });
    if (!ranges.length) return [];

    const { year, month, day } = parseDateLocal(dateLocal);
    const dayStartMs = zonedWallTimeToUtcMs(year, month, day, 0, 0, tz);
    const dayEndMs = zonedWallTimeToUtcMs(year, month, day, 23, 59, tz) + 60 * 1000;

    const occupied = listActiveBookings(db, customerId, siteId, {
        resourceId,
        fromUtc: toIsoUtc(dayStartMs - buffer * 60000),
        toUtc: toIsoUtc(dayEndMs + buffer * 60000),
    });

    const slots = [];
    const effectiveMinLeadMinutes = Math.max(minLeadMinutes, settings.min_notice_minutes || 0);
    const earliest = nowMs + effectiveMinLeadMinutes * 60000;

    for (const range of ranges) {
        for (let startMin = range.start_minute; startMin + duration <= range.end_minute; startMin += interval) {
            const hm = minutesToHourMinute(startMin);
            const startMs = zonedWallTimeToUtcMs(year, month, day, hm.hour, hm.minute, tz);
            const endMs = startMs + duration * 60000;
            if (startMs < earliest) continue;

            // span must fit in open range (already checked by loop) — also end wall inside range
            const endWallMin = startMin + duration;
            if (endWallMin > range.end_minute) continue;

            const startIso = toIsoUtc(startMs);
            const endIso = toIsoUtc(endMs);
            const blocked = occupied.some((b) => {
                const bStart = Date.parse(b.start_utc);
                const bEnd = Date.parse(b.end_utc) + buffer * 60000;
                const slotEndWithBuffer = endMs + buffer * 60000;
                // overlap with buffer after existing booking
                return startMs < bEnd && slotEndWithBuffer > bStart;
            });
            if (blocked) continue;
            slots.push({ start_utc: startIso, end_utc: endIso });
        }
    }
    return slots;
}

/**
 * Generate free slot starts (UTC ISO) for a local date.
 *
 * @param {string} [opts.resourceId] Scope to one resource. Omitted means
 *   "any available": every resource eligible for this service (see
 *   listResourcesForService) is checked and a start_utc is returned once if
 *   at least one of them is free there — resource_id on the returned slot
 *   is a representative free resource, resource_ids lists all of them.
 *   A legacy single-resource tenant always has exactly one eligible
 *   resource, so this is byte-identical to pre-Wave-7 output plus the two
 *   new fields.
 */
function generateSlots(db, customerId, siteId, {
    serviceId,
    dateLocal,
    nowMs = Date.now(),
    minLeadMinutes = 0,
    resourceId,
} = {}) {
    assertTenant(customerId, siteId);
    const settings = getSettings(db, customerId, siteId);
    if (!settings) throw new Error('calendar settings missing for tenant');
    const service = getService(db, customerId, siteId, serviceId);
    if (!service || !service.active) throw new Error('service not found');

    const tz = settings.timezone;

    // Booking-window policy (owner-configurable, VISION §8 / audit #26):
    // enforced here too (defense in depth) so any caller of generateSlots —
    // not just public-api's listPublicSlots — stays inside the window.
    if (settings.max_advance_days != null) {
        const capParts = getZonedParts(new Date(nowMs + settings.max_advance_days * 86400000), tz);
        const capDateLocal =
            String(capParts.year).padStart(4, '0') + '-' +
            String(capParts.month).padStart(2, '0') + '-' +
            String(capParts.day).padStart(2, '0');
        if (dateLocal > capDateLocal) return [];
    }

    const resourceIds = resourceId
        ? [resourceId]
        : listResourcesForService(db, customerId, siteId, serviceId).map((r) => r.id);
    if (!resourceIds.length) return [];

    const merged = new Map();
    for (const rid of resourceIds) {
        const perResource = generateSlotsForResource(
            db, customerId, siteId, settings, service, dateLocal, rid, nowMs, minLeadMinutes
        );
        for (const s of perResource) {
            const existing = merged.get(s.start_utc);
            if (existing) {
                if (!existing.resource_ids.includes(rid)) existing.resource_ids.push(rid);
            } else {
                merged.set(s.start_utc, {
                    start_utc: s.start_utc,
                    end_utc: s.end_utc,
                    date_local: dateLocal,
                    resource_id: rid,
                    resource_ids: [rid],
                });
            }
        }
    }
    return Array.from(merged.values()).sort((a, b) => (a.start_utc < b.start_utc ? -1 : a.start_utc > b.start_utc ? 1 : 0));
}

/**
 * Generate slots across inclusive local date range.
 */
function generateSlotsRange(db, customerId, siteId, opts) {
    const out = [];
    let d = opts.fromDateLocal;
    const end = opts.toDateLocal;
    while (d <= end) {
        out.push(...generateSlots(db, customerId, siteId, {
            serviceId: opts.serviceId,
            dateLocal: d,
            nowMs: opts.nowMs,
            minLeadMinutes: opts.minLeadMinutes,
            resourceId: opts.resourceId,
        }));
        d = addDaysLocal(d, 1);
    }
    return out;
}

/**
 * True when startMs..startMs+duration fits an open range on that civil date
 * after weekly + blackout + special_hours rules (owner timezone), for the
 * given resource (defaults to the tenant's implicit resource — see
 * openRangesForDate — so every pre-Wave-7 caller keeps its exact behavior).
 */
function slotFitsOpenAvailability(db, customerId, siteId, settings, service, startMs, resourceId) {
    const tz = settings.timezone;
    const parts = getZonedParts(new Date(startMs), tz);
    const dateLocal =
        String(parts.year).padStart(4, '0') +
        '-' +
        String(parts.month).padStart(2, '0') +
        '-' +
        String(parts.day).padStart(2, '0');
    const startMinute = parts.hour * 60 + parts.minute;
    const endMinute = startMinute + service.duration_minutes;
    if (endMinute > 24 * 60) return false;
    const ranges = openRangesForDate(db, customerId, siteId, dateLocal, { resourceId });
    return ranges.some(
        (r) => startMinute >= r.start_minute && endMinute <= r.end_minute
    );
}

/**
 * Create booking with race-safe lock.
 * Returns { booking, manageToken } — token only on create (hashed at rest).
 * Rejects starts outside weekly availability / blackout (SLOT_OUTSIDE_AVAILABILITY).
 */
/**
 * True when a booking row `b` (already buffer-widened) overlaps
 * [startMs, endMs] widened by `buffer` on the querying side too. Shared by
 * every "is this resource busy right now" check in this file.
 */
function overlapsBuffered(b, startMs, endMs, buffer) {
    const bStart = Date.parse(b.start_utc);
    const bEnd = Date.parse(b.end_utc) + buffer * 60000;
    const slotEnd = endMs + buffer * 60000;
    return startMs < bEnd && slotEnd > bStart;
}

/**
 * Resolve which resource a booking should land on.
 *
 * - `resourceId` given (visitor/owner picked a specific person or room):
 *   that resource only, if it is eligible for the service (schema.js v5 —
 *   listResourcesForService); throws RESOURCE_NOT_FOUND otherwise.
 * - `resourceId` omitted ("any available", the Wave 7 default): every
 *   resource eligible for the service, in stable sort_order/name order —
 *   createBooking tries each in turn inside the write transaction and
 *   confirms on the first free one.
 *
 * A legacy single-resource tenant always has exactly one eligible
 * resource, so "any available" degrades to the old single-calendar
 * behavior with no visible change.
 */
function resolveEligibleResources(db, customerId, siteId, service, resourceId) {
    if (resourceId) {
        const all = listResourcesForService(db, customerId, siteId, service.id);
        const match = all.find((r) => r.id === resourceId);
        if (!match) {
            const err = new Error('resource not available for this service');
            err.code = 'RESOURCE_NOT_FOUND';
            throw err;
        }
        return [match];
    }
    return listResourcesForService(db, customerId, siteId, service.id);
}

function createBooking(db, customerId, siteId, input) {
    assertTenant(customerId, siteId);
    const service = getService(db, customerId, siteId, input.serviceId);
    if (!service || !service.active) {
        const err = new Error('service not found');
        err.code = 'SERVICE_NOT_FOUND';
        throw err;
    }
    const settings = getSettings(db, customerId, siteId);
    if (!settings) {
        const err = new Error('calendar settings missing');
        err.code = 'SETTINGS_MISSING';
        throw err;
    }
    const requestedResourceId = input.resourceId || input.resource_id || null;
    const eligibleResources = resolveEligibleResources(db, customerId, siteId, service, requestedResourceId);
    if (!eligibleResources.length) {
        const err = new Error('no resource offers this service');
        err.code = 'RESOURCE_NOT_FOUND';
        throw err;
    }

    const visitorName = String(input.visitorName || '').trim().slice(0, 80);
    const visitorEmail = String(input.visitorEmail || '').trim().slice(0, 120).toLowerCase();
    const visitorPhone = input.visitorPhone != null
        ? String(input.visitorPhone).trim().slice(0, 40)
        : null;
    const note = input.note != null ? String(input.note).trim().slice(0, 400) : null;
    if (!visitorName || !visitorEmail) {
        const err = new Error('visitor name and email required');
        err.code = 'VALIDATION';
        throw err;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitorEmail)) {
        const err = new Error('invalid email');
        err.code = 'VALIDATION';
        throw err;
    }

    const startMs = Date.parse(input.startUtc);
    if (!Number.isFinite(startMs)) {
        const err = new Error('invalid start_utc');
        err.code = 'VALIDATION';
        throw err;
    }
    const nowMs = input.nowMs != null ? Number(input.nowMs) : Date.now();
    if (startMs < nowMs - 60 * 1000) {
        const err = new Error('slot is in the past');
        err.code = 'SLOT_IN_PAST';
        throw err;
    }
    assertBookingWindow(settings, startMs, nowMs);
    const duration = service.duration_minutes;
    const buffer = service.buffer_minutes != null
        ? service.buffer_minutes
        : settings.default_buffer_minutes;
    const endMs = startMs + duration * 60000;
    const startIso = toIsoUtc(startMs);
    const endIso = toIsoUtc(endMs);

    // HARD gate: never confirm (or accept) a start outside weekly + blackout walls
    // of EVERY eligible resource. generateSlots already filters; createBooking
    // must re-validate so a forged start_utc cannot land as confirmed outside
    // open ranges. A resource whose own hours don't fit is dropped from the
    // "any available" candidate set entirely (never even considered below).
    const fittingResources = eligibleResources.filter((r) =>
        slotFitsOpenAvailability(db, customerId, siteId, settings, service, startMs, r.id)
    );
    if (!fittingResources.length) {
        const err = new Error('slot outside weekly availability or blackout');
        err.code = 'SLOT_OUTSIDE_AVAILABILITY';
        throw err;
    }

    const manageToken = mintManageToken();
    const tokenHash = hashToken(manageToken);
    const id = newId('bk');
    const ts = nowIso();

    function insertRow(resourceIdForRow, statusForRow) {
        db.prepare(
            `INSERT INTO calendar_bookings (
                id, customer_id, site_id, service_id, resource_id, start_utc, end_utc, status,
                visitor_name, visitor_email, visitor_phone, note,
                manage_token_hash, created_at, updated_at, cancelled_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        ).run(
            id,
            customerId,
            siteId,
            service.id,
            resourceIdForRow,
            startIso,
            endIso,
            statusForRow,
            visitorName,
            visitorEmail,
            visitorPhone || null,
            note || null,
            tokenHash,
            ts,
            ts
        );
    }

    // Prefer confirm when free; on conflict → requested/reschedule_needed never confirmed.
    let status = STATUSES.CONFIRMED;
    let chosenResourceId = null;
    let booking = null;

    // BEGIN IMMEDIATE (VISION §8): SQLite serializes every writer behind this
    // reserved lock, so by the time each concurrent "any available" request's
    // transaction runs, it sees every previously committed booking — this is
    // what makes the per-resource loop below race-safe without extra locking,
    // and is the mechanism the Wave 7 concurrency oracle exercises directly
    // (see bot/test/wave7-calendar-resources-concurrency.test.js).
    db.exec('BEGIN IMMEDIATE;');
    try {
        if (requestedResourceId) {
            // Visitor/owner asked for one specific resource — never silently
            // reassign; a conflict there demotes to requested/reschedule_needed
            // exactly like the pre-Wave-7 single-calendar behavior did.
            const r = fittingResources[0];
            const overlap = listActiveBookings(db, customerId, siteId, {
                resourceId: r.id,
                fromUtc: startIso,
                toUtc: toIsoUtc(endMs + buffer * 60000),
            }).filter((b) => overlapsBuffered(b, startMs, endMs, buffer));
            chosenResourceId = r.id;
            if (overlap.length) {
                status = input.preferRescheduleOnConflict
                    ? STATUSES.RESCHEDULE_NEEDED
                    : STATUSES.REQUESTED;
            }
        } else {
            // "Any available": try each eligible+fitting resource in stable
            // order and confirm on the first one with no active overlap.
            for (const r of fittingResources) {
                const overlap = listActiveBookings(db, customerId, siteId, {
                    resourceId: r.id,
                    fromUtc: startIso,
                    toUtc: toIsoUtc(endMs + buffer * 60000),
                }).filter((b) => overlapsBuffered(b, startMs, endMs, buffer));
                if (!overlap.length) {
                    chosenResourceId = r.id;
                    status = STATUSES.CONFIRMED;
                    break;
                }
            }
            if (!chosenResourceId) {
                // Every eligible resource is busy at this instant — store the
                // desired time unassigned (resource_id NULL) rather than pin
                // it to a busy resource. An owner can reassign it later (see
                // reassignBookingAsOwner) once a resource frees up.
                status = input.preferRescheduleOnConflict
                    ? STATUSES.RESCHEDULE_NEEDED
                    : STATUSES.REQUESTED;
            }
        }

        // For conflicted "requested" we still store the desired start; unique index
        // only covers requested+confirmed — two requested same start would still
        // collide on unique IF they share the same resource_id (NULL resource_id
        // rows never collide with each other — SQLite treats NULL != NULL in a
        // unique index, which is exactly right: an unresolved "any available"
        // request doesn't occupy any real resource yet). On unique failure
        // (a resource was claimed between our check and this write), fall back
        // to reschedule_needed at the same desired time, same resource.
        try {
            insertRow(chosenResourceId, status);
        } catch (e) {
            const msg = String(e && e.message || e);
            if (/UNIQUE|unique/i.test(msg)) {
                status = STATUSES.RESCHEDULE_NEEDED;
                insertRow(chosenResourceId, status);
            } else {
                throw e;
            }
        }

        booking = db.prepare(
            `SELECT * FROM calendar_bookings WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).get(id, customerId, siteId);
        db.exec('COMMIT;');
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }

    emitBookingEmail(db, {
        booking,
        manageToken,
        kind: 'created',
    });

    return { booking, manageToken, status: booking.status };
}

/**
 * List bookings for tenant only. Never accepts "all tenants".
 */
function listBookings(db, customerId, siteId, { status, fromUtc, toUtc } = {}) {
    assertTenant(customerId, siteId);
    let sql = `SELECT * FROM calendar_bookings WHERE customer_id = ? AND site_id = ?`;
    const params = [customerId, siteId];
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }
    if (fromUtc) {
        sql += ' AND start_utc >= ?';
        params.push(fromUtc);
    }
    if (toUtc) {
        sql += ' AND start_utc < ?';
        params.push(toUtc);
    }
    sql += ' ORDER BY start_utc ASC';
    return db.prepare(sql).all(...params);
}

function getBooking(db, customerId, siteId, bookingId) {
    assertTenant(customerId, siteId);
    return db.prepare(
        `SELECT * FROM calendar_bookings WHERE id = ? AND customer_id = ? AND site_id = ?`
    ).get(bookingId, customerId, siteId) || null;
}

/**
 * Owner cancel — must own tenant.
 */
function cancelBookingAsOwner(db, customerId, siteId, bookingId) {
    assertTenant(customerId, siteId);
    const ts = nowIso();
    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = getBooking(db, customerId, siteId, bookingId);
        if (!row) {
            db.exec('ROLLBACK;');
            return null;
        }
        if (row.status === STATUSES.CANCELLED) {
            db.exec('COMMIT;');
            return row;
        }
        db.prepare(
            `UPDATE calendar_bookings
             SET status = ?, updated_at = ?, cancelled_at = ?
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).run(STATUSES.CANCELLED, ts, ts, bookingId, customerId, siteId);
        const updated = getBooking(db, customerId, siteId, bookingId);
        db.exec('COMMIT;');
        emitBookingEmail(db, { booking: updated, kind: 'cancelled' });
        return updated;
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
}

/**
 * Resolve a booking by raw manage token (hashed at rest). Single-booking scope.
 * Does not reveal other bookings. Returns null when token is unknown.
 */
function getBookingByManageToken(db, rawToken) {
    const token = String(rawToken || '').trim();
    if (!token || token.length < 16) return null;
    const tokenHash = hashToken(token);
    return db.prepare(
        `SELECT * FROM calendar_bookings WHERE manage_token_hash = ?`
    ).get(tokenHash) || null;
}

/**
 * Visitor cancel with manage token (hashed). Scoped to single booking.
 */
function cancelBookingWithToken(db, rawToken, { nowMs = Date.now() } = {}) {
    const tokenHash = hashToken(rawToken);
    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = db.prepare(
            `SELECT * FROM calendar_bookings WHERE manage_token_hash = ?`
        ).get(tokenHash);
        if (!row) {
            db.exec('ROLLBACK;');
            const err = new Error('invalid token');
            err.code = 'TOKEN';
            throw err;
        }
        if (row.status === STATUSES.CANCELLED) {
            db.exec('COMMIT;');
            return { booking: row, already: true };
        }
        const settings = getSettings(db, row.customer_id, row.site_id);
        const minHours = settings ? settings.min_cancel_hours : 24;
        const startMs = Date.parse(row.start_utc);
        if (startMs - nowMs < minHours * 3600000) {
            db.exec('ROLLBACK;');
            const err = new Error('too late to cancel');
            err.code = 'WINDOW';
            throw err;
        }
        const ts = nowIso();
        db.prepare(
            `UPDATE calendar_bookings
             SET status = ?, updated_at = ?, cancelled_at = ?
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).run(STATUSES.CANCELLED, ts, ts, row.id, row.customer_id, row.site_id);
        const updated = getBooking(db, row.customer_id, row.site_id, row.id);
        db.exec('COMMIT;');
        emitBookingEmail(db, { booking: updated, kind: 'cancelled' });
        return { booking: updated, already: false };
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
}

/**
 * Shared reschedule core — assumes caller already holds BEGIN IMMEDIATE and
 * has verified `row` is a non-cancelled booking for the correct tenant.
 * Never mutates `row` in the database before all validation has passed, so a
 * thrown error always leaves the existing booking exactly as it was.
 *
 * `onConflict`:
 *  - 'demote' (owner path): a taken target slot still moves the booking there,
 *    but status becomes reschedule_needed instead of confirmed (VISION: never
 *    confirm over a conflict). Matches pre-existing owner behavior.
 *  - 'reject' (visitor token path): a taken target slot throws SLOT_TAKEN and
 *    leaves the booking (old slot) completely untouched — the visitor
 *    self-service flow must not silently move a confirmed booking into limbo.
 *
 * @returns {object} updated booking row
 */
function applyReschedule(db, row, startMs, { onConflict = 'demote', nowMs = Date.now(), resourceId } = {}) {
    const customerId = row.customer_id;
    const siteId = row.site_id;
    const bookingId = row.id;

    const service = getService(db, customerId, siteId, row.service_id);
    if (!service || !service.active) {
        const err = new Error('service not found');
        err.code = 'SERVICE_NOT_FOUND';
        throw err;
    }
    const settings = getSettings(db, customerId, siteId);
    if (!settings) {
        const err = new Error('calendar settings missing');
        err.code = 'SETTINGS_MISSING';
        throw err;
    }
    // Keep the booking's current resource unless the caller explicitly moves
    // it (owner reassignment). A still-unresolved "any available" request
    // (resource_id NULL) stays unresolved through a plain time move — moving
    // its desired time is not the same as assigning it a resource.
    const targetResourceId = resourceId !== undefined ? resourceId : row.resource_id;

    if (targetResourceId) {
        if (!slotFitsOpenAvailability(db, customerId, siteId, settings, service, startMs, targetResourceId)) {
            const err = new Error('slot outside weekly availability or blackout');
            err.code = 'SLOT_OUTSIDE_AVAILABILITY';
            throw err;
        }
    } else {
        // Unresolved booking: the new desired time must still fit at least
        // one resource eligible for this service, or it's not a real slot.
        const eligible = listResourcesForService(db, customerId, siteId, service.id);
        const fits = eligible.some((r) =>
            slotFitsOpenAvailability(db, customerId, siteId, settings, service, startMs, r.id)
        );
        if (!fits) {
            const err = new Error('slot outside weekly availability or blackout');
            err.code = 'SLOT_OUTSIDE_AVAILABILITY';
            throw err;
        }
    }
    // Only re-enforce the booking-window policy when the time itself is
    // moving. A pure reassignment (same start_utc, new resource — e.g. an
    // owner swapping staff shortly before an appointment) must not fail
    // min-notice just because "now" has crept closer to an already-accepted
    // time.
    if (startMs !== Date.parse(row.start_utc)) {
        assertBookingWindow(settings, startMs, nowMs);
    }

    const buffer = service.buffer_minutes != null
        ? service.buffer_minutes
        : settings.default_buffer_minutes;
    const duration = service.duration_minutes;
    const endMs = startMs + duration * 60000;
    const startIso = toIsoUtc(startMs);
    const endIso = toIsoUtc(endMs);

    const overlap = targetResourceId
        ? listActiveBookings(db, customerId, siteId, {
            resourceId: targetResourceId,
            fromUtc: startIso,
            toUtc: toIsoUtc(endMs + buffer * 60000),
        }).filter((b) => b.id !== row.id).filter((b) => overlapsBuffered(b, startMs, endMs, buffer))
        : []; // no resource occupied yet — nothing to conflict with

    if (overlap.length) {
        if (onConflict === 'reject') {
            // Pre-write check caught the conflict — nothing written, old slot untouched.
            const err = new Error('target slot already taken');
            err.code = 'SLOT_TAKEN';
            throw err;
        }
    }
    // Never promote an unresolved (resource_id NULL) booking to confirmed
    // just by moving its desired time — only explicit reassignment does that.
    let status = overlap.length
        ? STATUSES.RESCHEDULE_NEEDED
        : (targetResourceId ? STATUSES.CONFIRMED : STATUSES.REQUESTED);

    const ts = nowIso();
    try {
        db.prepare(
            `UPDATE calendar_bookings
             SET start_utc = ?, end_utc = ?, status = ?, resource_id = ?, updated_at = ?, cancelled_at = NULL,
                 visitor_reminder_sent_at = NULL, owner_reminder_sent_at = NULL
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).run(startIso, endIso, status, targetResourceId, ts, bookingId, customerId, siteId);
    } catch (e) {
        const msg = String(e && e.message || e);
        if (/UNIQUE|unique/i.test(msg)) {
            // Race: someone claimed the exact slot key between our check and write.
            if (onConflict === 'reject') {
                // Write never took effect (constraint violation) — old slot stays as-is.
                const err = new Error('target slot already taken');
                err.code = 'SLOT_TAKEN';
                throw err;
            }
            status = STATUSES.RESCHEDULE_NEEDED;
            // Keep the desired wall time; unique only covers requested+confirmed.
            db.prepare(
                `UPDATE calendar_bookings
                 SET start_utc = ?, end_utc = ?, status = ?, resource_id = ?, updated_at = ?, cancelled_at = NULL,
                     visitor_reminder_sent_at = NULL, owner_reminder_sent_at = NULL
                 WHERE id = ? AND customer_id = ? AND site_id = ?`
            ).run(startIso, endIso, status, targetResourceId, ts, bookingId, customerId, siteId);
        } else {
            throw e;
        }
    }

    return getBooking(db, customerId, siteId, bookingId);
}

/**
 * Owner reschedule — moves start/end on the same booking row (history kept).
 * Old slot frees immediately via UNIQUE active-slot index + transactional update.
 * Instant confirm only when the new slot is free and inside availability.
 */
function rescheduleBookingAsOwner(db, customerId, siteId, bookingId, input = {}) {
    assertTenant(customerId, siteId);
    const startMs = Date.parse(input.startUtc);
    if (!Number.isFinite(startMs)) {
        const err = new Error('invalid start_utc');
        err.code = 'VALIDATION';
        throw err;
    }
    const nowMs = input.nowMs != null ? Number(input.nowMs) : Date.now();
    if (startMs < nowMs - 60 * 1000) {
        const err = new Error('slot is in the past');
        err.code = 'SLOT_IN_PAST';
        throw err;
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = getBooking(db, customerId, siteId, bookingId);
        if (!row) {
            db.exec('ROLLBACK;');
            return null;
        }
        if (row.status === STATUSES.CANCELLED) {
            db.exec('ROLLBACK;');
            const err = new Error('cannot reschedule cancelled booking');
            err.code = 'STATE';
            throw err;
        }

        const previousStatus = row.status;
        const requestedResourceId = input.resourceId || input.resource_id;
        const updated = applyReschedule(db, row, startMs, {
            onConflict: 'demote',
            nowMs,
            resourceId: requestedResourceId !== undefined ? requestedResourceId : undefined,
        });
        db.exec('COMMIT;');
        emitBookingEmail(db, {
            booking: updated,
            kind: updated.status === STATUSES.CONFIRMED ? 'reschedule_confirmed' : 'rescheduled',
            previousStatus,
        });
        return updated;
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
}

/**
 * Owner reassignment (audit #25 — "reassign a booking"): move a booking to a
 * different resource WITHOUT changing its time. Never silently overwrites a
 * busy resource — confirms only if the new resource is free and eligible for
 * the service at that time, else demotes to reschedule_needed exactly like
 * every other conflict path in this file.
 */
function reassignBookingAsOwner(db, customerId, siteId, bookingId, resourceId) {
    assertTenant(customerId, siteId);
    if (!resourceId) {
        const err = new Error('resourceId required');
        err.code = 'VALIDATION';
        throw err;
    }
    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = getBooking(db, customerId, siteId, bookingId);
        if (!row) {
            db.exec('ROLLBACK;');
            return null;
        }
        if (row.status === STATUSES.CANCELLED) {
            db.exec('ROLLBACK;');
            const err = new Error('cannot reassign a cancelled booking');
            err.code = 'STATE';
            throw err;
        }
        const resource = getResource(db, customerId, siteId, resourceId);
        if (!resource || !resource.active) {
            db.exec('ROLLBACK;');
            const err = new Error('resource not found');
            err.code = 'RESOURCE_NOT_FOUND';
            throw err;
        }
        const startMs = Date.parse(row.start_utc);
        const previousStatus = row.status;
        const updated = applyReschedule(db, row, startMs, {
            onConflict: 'demote',
            nowMs: Date.now(),
            resourceId,
        });
        db.exec('COMMIT;');
        emitBookingEmail(db, {
            booking: updated,
            kind: updated.status === STATUSES.CONFIRMED ? 'reschedule_confirmed' : 'rescheduled',
            previousStatus,
        });
        return updated;
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
}

/**
 * Visitor reschedule with manage token (hashed at rest). Scoped to a single
 * booking, same as cancelBookingWithToken. VISION §8 "Anulare / reprogramare":
 * visitor may reschedule only inside the owner-configured notice window
 * (default >= 24h before the *current* slot start — same gate as cancel), and
 * a reschedule onto an already-occupied slot is rejected outright, never
 * silently downgraded — the existing booking must stay exactly as it was.
 */
function rescheduleBookingWithToken(db, rawToken, { startUtc, nowMs = Date.now() } = {}) {
    const startMs = Date.parse(startUtc);
    if (!Number.isFinite(startMs)) {
        const err = new Error('invalid start_utc');
        err.code = 'VALIDATION';
        throw err;
    }
    if (startMs < nowMs - 60 * 1000) {
        const err = new Error('slot is in the past');
        err.code = 'SLOT_IN_PAST';
        throw err;
    }
    const tokenHash = hashToken(rawToken);
    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = db.prepare(
            `SELECT * FROM calendar_bookings WHERE manage_token_hash = ?`
        ).get(tokenHash);
        if (!row) {
            db.exec('ROLLBACK;');
            const err = new Error('invalid token');
            err.code = 'TOKEN';
            throw err;
        }
        if (row.status === STATUSES.CANCELLED) {
            db.exec('ROLLBACK;');
            const err = new Error('cannot reschedule cancelled booking');
            err.code = 'STATE';
            throw err;
        }
        const settings = getSettings(db, row.customer_id, row.site_id);
        const minHours = settings ? settings.min_cancel_hours : 24;
        const oldStartMs = Date.parse(row.start_utc);
        if (oldStartMs - nowMs < minHours * 3600000) {
            db.exec('ROLLBACK;');
            const err = new Error('too late to reschedule');
            err.code = 'WINDOW';
            throw err;
        }

        const previousStatus = row.status;
        const updated = applyReschedule(db, row, startMs, { onConflict: 'reject', nowMs });
        db.exec('COMMIT;');
        emitBookingEmail(db, {
            booking: updated,
            kind: 'reschedule_confirmed',
            previousStatus,
        });
        return { booking: updated, already: false };
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
}

/**
 * Owner confirm a requested booking if still free.
 */
function confirmBookingAsOwner(db, customerId, siteId, bookingId) {
    assertTenant(customerId, siteId);
    db.exec('BEGIN IMMEDIATE;');
    try {
        const row = getBooking(db, customerId, siteId, bookingId);
        if (!row) {
            db.exec('ROLLBACK;');
            return null;
        }
        if (row.status === STATUSES.CONFIRMED) {
            db.exec('COMMIT;');
            return row;
        }
        if (row.status === STATUSES.CANCELLED) {
            db.exec('ROLLBACK;');
            const err = new Error('cannot confirm cancelled');
            err.code = 'STATE';
            throw err;
        }
        if (!row.resource_id) {
            // Suite 5 / B6 (2026-09-12): an unresolved "any available"
            // request has no physical resource yet — confirming it would
            // claim nothing. On a tenant with more than one resource the
            // owner genuinely has to pick which one (see
            // reassignBookingAsOwner — the dashboard's "Reatribuie").
            // But the common "professionals" tenant has exactly ONE
            // resource — there is no ambiguity to ask the owner about, so
            // "Confirmă" can default to it directly, inline in this same
            // transaction (equivalent to reassignBookingAsOwner(..., that
            // one id), just without a second BEGIN IMMEDIATE). Zero active
            // resources (the owner deactivated their only one) is its own
            // honest error, distinct from "pick one of several".
            const soloResources = listResources(db, customerId, siteId, { activeOnly: true });
            if (!soloResources.length) {
                db.exec('ROLLBACK;');
                const err = new Error('no active resource configured for this site — add one in Personal first');
                err.code = 'NO_RESOURCE';
                throw err;
            }
            if (soloResources.length > 1) {
                db.exec('ROLLBACK;');
                const err = new Error('booking has no resource assigned yet — reassign it first');
                err.code = 'RESOURCE_REQUIRED';
                throw err;
            }
            row.resource_id = soloResources[0].id;
        }
        const service = getService(db, customerId, siteId, row.service_id);
        const settings = getSettings(db, customerId, siteId);
        const buffer = (service && service.buffer_minutes != null)
            ? service.buffer_minutes
            : (settings ? settings.default_buffer_minutes : 0);
        const startMs = Date.parse(row.start_utc);
        const endMs = Date.parse(row.end_utc);
        const overlap = listActiveBookings(db, customerId, siteId, {
            resourceId: row.resource_id,
            fromUtc: row.start_utc,
            toUtc: toIsoUtc(endMs + buffer * 60000),
        }).filter((b) => b.id !== row.id).filter((b) => {
            const bStart = Date.parse(b.start_utc);
            const bEnd = Date.parse(b.end_utc) + buffer * 60000;
            return startMs < bEnd && (endMs + buffer * 60000) > bStart;
        });
        if (overlap.length) {
            db.prepare(
                `UPDATE calendar_bookings SET status = ?, updated_at = ?
                 WHERE id = ? AND customer_id = ? AND site_id = ?`
            ).run(STATUSES.RESCHEDULE_NEEDED, nowIso(), bookingId, customerId, siteId);
            const updated = getBooking(db, customerId, siteId, bookingId);
            db.exec('COMMIT;');
            emitBookingEmail(db, {
                booking: updated,
                kind: 'reschedule_needed',
                previousStatus: row.status,
            });
            return updated;
        }
        db.prepare(
            `UPDATE calendar_bookings SET status = ?, resource_id = ?, updated_at = ?
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).run(STATUSES.CONFIRMED, row.resource_id, nowIso(), bookingId, customerId, siteId);
        const updated = getBooking(db, customerId, siteId, bookingId);
        db.exec('COMMIT;');
        emitBookingEmail(db, {
            booking: updated,
            kind: 'confirmed',
            previousStatus: row.status,
        });
        return updated;
    } catch (e) {
        try { db.exec('ROLLBACK;'); } catch (_) { /* ignore */ }
        throw e;
    }
}

/**
 * Tenant isolation: attempt to read another tenant's row by id without their key.
 * Public API never offers unscoped queries — this helper is for the oracle only.
 */
function unsafeGetBookingByIdOnly(db, bookingId) {
    return db.prepare(`SELECT * FROM calendar_bookings WHERE id = ?`).get(bookingId) || null;
}

module.exports = {
    STATUSES,
    ensureSettings,
    getSettings,
    upsertService,
    getService,
    listServices,
    getOrCreateDefaultResourceId,
    upsertResource,
    getResource,
    listResources,
    hasMultipleResources,
    setServiceResources,
    listResourcesForService,
    listServicesForResource,
    setWeeklyAvailability,
    listWeeklyAvailability,
    addDateOverride,
    removeDateOverride,
    listDateOverrides,
    openRangesForDate,
    slotFitsOpenAvailability,
    listActiveBookings,
    generateSlots,
    generateSlotsRange,
    createBooking,
    listBookings,
    getBooking,
    cancelBookingAsOwner,
    getBookingByManageToken,
    cancelBookingWithToken,
    rescheduleBookingAsOwner,
    reassignBookingAsOwner,
    rescheduleBookingWithToken,
    confirmBookingAsOwner,
    hashToken,
    unsafeGetBookingByIdOnly,
};
