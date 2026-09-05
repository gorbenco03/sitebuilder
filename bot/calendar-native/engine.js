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
                min_cancel_hours, slot_interval_minutes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            customerId,
            siteId,
            patch.timezone || 'Europe/Bucharest',
            patch.default_buffer_minutes != null ? patch.default_buffer_minutes : 0,
            patch.min_cancel_hours != null ? patch.min_cancel_hours : 24,
            patch.slot_interval_minutes != null ? patch.slot_interval_minutes : 15,
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
                updated_at = ?
             WHERE customer_id = ? AND site_id = ?`
        ).run(
            patch.timezone != null ? patch.timezone : null,
            patch.default_buffer_minutes != null ? patch.default_buffer_minutes : null,
            patch.min_cancel_hours != null ? patch.min_cancel_hours : null,
            patch.slot_interval_minutes != null ? patch.slot_interval_minutes : null,
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

function setWeeklyAvailability(db, customerId, siteId, windows) {
    assertTenant(customerId, siteId);
    if (!Array.isArray(windows)) throw new Error('windows must be an array');
    db.prepare(
        `DELETE FROM calendar_weekly_availability WHERE customer_id = ? AND site_id = ?`
    ).run(customerId, siteId);
    const ins = db.prepare(
        `INSERT INTO calendar_weekly_availability
            (id, customer_id, site_id, weekday, start_minute, end_minute)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const w of windows) {
        ins.run(newId('wav'), customerId, siteId, w.weekday, w.start_minute, w.end_minute);
    }
    return listWeeklyAvailability(db, customerId, siteId);
}

function listWeeklyAvailability(db, customerId, siteId) {
    assertTenant(customerId, siteId);
    return db.prepare(
        `SELECT * FROM calendar_weekly_availability
         WHERE customer_id = ? AND site_id = ?
         ORDER BY weekday ASC, start_minute ASC`
    ).all(customerId, siteId);
}

function addDateOverride(db, customerId, siteId, override) {
    assertTenant(customerId, siteId);
    const id = override.id || newId('ov');
    db.prepare(
        `INSERT INTO calendar_date_overrides
            (id, customer_id, site_id, date_local, kind, start_minute, end_minute, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        id,
        customerId,
        siteId,
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

function listDateOverrides(db, customerId, siteId, { fromDate, toDate } = {}) {
    assertTenant(customerId, siteId);
    if (fromDate && toDate) {
        return db.prepare(
            `SELECT * FROM calendar_date_overrides
             WHERE customer_id = ? AND site_id = ?
               AND date_local >= ? AND date_local <= ?
             ORDER BY date_local ASC`
        ).all(customerId, siteId, fromDate, toDate);
    }
    return db.prepare(
        `SELECT * FROM calendar_date_overrides
         WHERE customer_id = ? AND site_id = ?
         ORDER BY date_local ASC`
    ).all(customerId, siteId);
}

/**
 * Open minute ranges for a local civil date after weekly + blackout rules.
 * @returns {{ start_minute: number, end_minute: number }[]}
 */
function openRangesForDate(db, customerId, siteId, dateLocal) {
    assertTenant(customerId, siteId);
    const overrides = db.prepare(
        `SELECT * FROM calendar_date_overrides
         WHERE customer_id = ? AND site_id = ? AND date_local = ?`
    ).all(customerId, siteId, dateLocal);

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
         WHERE customer_id = ? AND site_id = ? AND weekday = ?
         ORDER BY start_minute ASC`
    ).all(customerId, siteId, weekday);
}

/**
 * Active bookings that occupy time (requested + confirmed) for tenant.
 * Optionally filter by service for slot-lock uniqueness; overlap uses same service
 * for engine lock per VISION (tenant/site + service + slot).
 */
function listActiveBookings(db, customerId, siteId, { serviceId, fromUtc, toUtc } = {}) {
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
    if (fromUtc && toUtc) {
        // overlap: start < to AND end > from
        sql += ' AND start_utc < ? AND end_utc > ?';
        params.push(toUtc, fromUtc);
    }
    sql += ' ORDER BY start_utc ASC';
    return db.prepare(sql).all(...params);
}

/**
 * Generate free slot starts (UTC ISO) for a local date.
 */
function generateSlots(db, customerId, siteId, {
    serviceId,
    dateLocal,
    nowMs = Date.now(),
    minLeadMinutes = 0,
} = {}) {
    assertTenant(customerId, siteId);
    const settings = getSettings(db, customerId, siteId);
    if (!settings) throw new Error('calendar settings missing for tenant');
    const service = getService(db, customerId, siteId, serviceId);
    if (!service || !service.active) throw new Error('service not found');

    const tz = settings.timezone;
    const interval = settings.slot_interval_minutes;
    const buffer = service.buffer_minutes != null
        ? service.buffer_minutes
        : settings.default_buffer_minutes;
    const duration = service.duration_minutes;
    const ranges = openRangesForDate(db, customerId, siteId, dateLocal);
    if (!ranges.length) return [];

    const { year, month, day } = parseDateLocal(dateLocal);
    const dayStartMs = zonedWallTimeToUtcMs(year, month, day, 0, 0, tz);
    const dayEndMs = zonedWallTimeToUtcMs(year, month, day, 23, 59, tz) + 60 * 1000;

    const occupied = listActiveBookings(db, customerId, siteId, {
        serviceId,
        fromUtc: toIsoUtc(dayStartMs - buffer * 60000),
        toUtc: toIsoUtc(dayEndMs + buffer * 60000),
    });

    const slots = [];
    const earliest = nowMs + minLeadMinutes * 60000;

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
            slots.push({ start_utc: startIso, end_utc: endIso, date_local: dateLocal });
        }
    }
    return slots;
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
        }));
        d = addDaysLocal(d, 1);
    }
    return out;
}

/**
 * True when startMs..startMs+duration fits an open range on that civil date
 * after weekly + blackout + special_hours rules (owner timezone).
 */
function slotFitsOpenAvailability(db, customerId, siteId, settings, service, startMs) {
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
    const ranges = openRangesForDate(db, customerId, siteId, dateLocal);
    return ranges.some(
        (r) => startMinute >= r.start_minute && endMinute <= r.end_minute
    );
}

/**
 * Create booking with race-safe lock.
 * Returns { booking, manageToken } — token only on create (hashed at rest).
 * Rejects starts outside weekly availability / blackout (SLOT_OUTSIDE_AVAILABILITY).
 */
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
    const duration = service.duration_minutes;
    const buffer = service.buffer_minutes != null
        ? service.buffer_minutes
        : settings.default_buffer_minutes;
    const endMs = startMs + duration * 60000;
    const startIso = toIsoUtc(startMs);
    const endIso = toIsoUtc(endMs);

    // HARD gate: never confirm (or accept) a start outside weekly + blackout walls.
    // generateSlots already filters; createBooking must re-validate so a forged
    // start_utc cannot land as confirmed outside open ranges.
    if (!slotFitsOpenAvailability(db, customerId, siteId, settings, service, startMs)) {
        const err = new Error('slot outside weekly availability or blackout');
        err.code = 'SLOT_OUTSIDE_AVAILABILITY';
        throw err;
    }

    const manageToken = mintManageToken();
    const tokenHash = hashToken(manageToken);
    const id = newId('bk');
    const ts = nowIso();

    // Prefer confirm when free; on conflict → requested/reschedule_needed never confirmed.
    let status = STATUSES.CONFIRMED;
    let booking = null;

    db.exec('BEGIN IMMEDIATE;');
    try {
        const overlap = listActiveBookings(db, customerId, siteId, {
            serviceId: service.id,
            fromUtc: startIso,
            toUtc: toIsoUtc(endMs + buffer * 60000),
        }).filter((b) => {
            const bStart = Date.parse(b.start_utc);
            const bEnd = Date.parse(b.end_utc) + buffer * 60000;
            const slotEnd = endMs + buffer * 60000;
            return startMs < bEnd && slotEnd > bStart;
        });

        if (overlap.length) {
            status = input.preferRescheduleOnConflict
                ? STATUSES.RESCHEDULE_NEEDED
                : STATUSES.REQUESTED;
        }

        // For conflicted "requested" we still store the desired start; unique index
        // only covers requested+confirmed — two requested same start would still
        // collide on unique. If unique would fire on requested same slot, second
        // becomes reschedule_needed without claiming the slot key: we only INSERT
        // confirmed/requested when no exact active start exists; else reschedule_needed
        // with a synthetic start offset is wrong. Instead: on exact unique conflict,
        // catch and insert as reschedule_needed after cancelling uniqueness by...
        // Actually UNIQUE includes requested. So two people requesting same slot:
        // first gets requested or confirmed, second hits unique → we convert to
        // reschedule_needed WITHOUT the same start_utc? That would lose the desired time.
        // Better approach: unique only on confirmed? VISION says lock on slot for
        // requested+confirmed. Two concurrent confirms: one wins.
        // Two requests same slot: unique blocks second — treat second as reschedule_needed
        // with SAME start_utc by first deleting uniqueness... can't.
        //
        // Fix: partial unique only WHERE status = 'confirmed'.
        // Plus transactional overlap for both requested+confirmed.
        // Re-read VISION: "constraint unic la nivel de DB și/sau lock tranzacțional"
        // So transactional lock alone is enough; unique is belt. Having unique on
        // both requested+confirmed means only one active row per start.
        // Second concurrent book → catch SQLITE_CONSTRAINT → status reschedule_needed
        // and use start_utc with micro-perturbation? Bad.
        //
        // Cleaner: on unique failure, INSERT with status=reschedule_needed and
        // start_utc unchanged — but unique includes requested. So exclude
        // reschedule_needed from unique (already excluded). For second request on
        // same slot while first is requested: unique fails. Then we INSERT as
        // reschedule_needed — still same start_utc — unique does NOT include
        // reschedule_needed, so OK!

        try {
            db.prepare(
                `INSERT INTO calendar_bookings (
                    id, customer_id, site_id, service_id, start_utc, end_utc, status,
                    visitor_name, visitor_email, visitor_phone, note,
                    manage_token_hash, created_at, updated_at, cancelled_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
            ).run(
                id,
                customerId,
                siteId,
                service.id,
                startIso,
                endIso,
                status,
                visitorName,
                visitorEmail,
                visitorPhone || null,
                note || null,
                tokenHash,
                ts,
                ts
            );
        } catch (e) {
            const msg = String(e && e.message || e);
            if (/UNIQUE|unique/i.test(msg)) {
                // Slot taken between check and write — never confirm.
                status = STATUSES.RESCHEDULE_NEEDED;
                db.prepare(
                    `INSERT INTO calendar_bookings (
                        id, customer_id, site_id, service_id, start_utc, end_utc, status,
                        visitor_name, visitor_email, visitor_phone, note,
                        manage_token_hash, created_at, updated_at, cancelled_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
                ).run(
                    id,
                    customerId,
                    siteId,
                    service.id,
                    startIso,
                    endIso,
                    status,
                    visitorName,
                    visitorEmail,
                    visitorPhone || null,
                    note || null,
                    tokenHash,
                    ts,
                    ts
                );
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

        const service = getService(db, customerId, siteId, row.service_id);
        if (!service || !service.active) {
            db.exec('ROLLBACK;');
            const err = new Error('service not found');
            err.code = 'SERVICE_NOT_FOUND';
            throw err;
        }
        const settings = getSettings(db, customerId, siteId);
        if (!settings) {
            db.exec('ROLLBACK;');
            const err = new Error('calendar settings missing');
            err.code = 'SETTINGS_MISSING';
            throw err;
        }

        if (!slotFitsOpenAvailability(db, customerId, siteId, settings, service, startMs)) {
            db.exec('ROLLBACK;');
            const err = new Error('slot outside weekly availability or blackout');
            err.code = 'SLOT_OUTSIDE_AVAILABILITY';
            throw err;
        }

        const buffer = service.buffer_minutes != null
            ? service.buffer_minutes
            : settings.default_buffer_minutes;
        const duration = service.duration_minutes;
        const endMs = startMs + duration * 60000;
        const startIso = toIsoUtc(startMs);
        const endIso = toIsoUtc(endMs);

        const overlap = listActiveBookings(db, customerId, siteId, {
            serviceId: service.id,
            fromUtc: startIso,
            toUtc: toIsoUtc(endMs + buffer * 60000),
        }).filter((b) => b.id !== row.id).filter((b) => {
            const bStart = Date.parse(b.start_utc);
            const bEnd = Date.parse(b.end_utc) + buffer * 60000;
            return startMs < bEnd && (endMs + buffer * 60000) > bStart;
        });

        let status = STATUSES.CONFIRMED;
        if (overlap.length) {
            status = STATUSES.RESCHEDULE_NEEDED;
        }

        const ts = nowIso();
        try {
            db.prepare(
                `UPDATE calendar_bookings
                 SET start_utc = ?, end_utc = ?, status = ?, updated_at = ?, cancelled_at = NULL
                 WHERE id = ? AND customer_id = ? AND site_id = ?`
            ).run(startIso, endIso, status, ts, bookingId, customerId, siteId);
        } catch (e) {
            const msg = String(e && e.message || e);
            if (/UNIQUE|unique/i.test(msg)) {
                status = STATUSES.RESCHEDULE_NEEDED;
                // Keep the desired wall time; unique only covers requested+confirmed.
                db.prepare(
                    `UPDATE calendar_bookings
                     SET start_utc = ?, end_utc = ?, status = ?, updated_at = ?, cancelled_at = NULL
                     WHERE id = ? AND customer_id = ? AND site_id = ?`
                ).run(startIso, endIso, status, ts, bookingId, customerId, siteId);
            } else {
                throw e;
            }
        }

        const updated = getBooking(db, customerId, siteId, bookingId);
        db.exec('COMMIT;');
        emitBookingEmail(db, {
            booking: updated,
            kind: updated.status === STATUSES.CONFIRMED ? 'reschedule_confirmed' : 'rescheduled',
            previousStatus: row.status,
        });
        return updated;
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
        const service = getService(db, customerId, siteId, row.service_id);
        const settings = getSettings(db, customerId, siteId);
        const buffer = (service && service.buffer_minutes != null)
            ? service.buffer_minutes
            : (settings ? settings.default_buffer_minutes : 0);
        const startMs = Date.parse(row.start_utc);
        const endMs = Date.parse(row.end_utc);
        const overlap = listActiveBookings(db, customerId, siteId, {
            serviceId: row.service_id,
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
            `UPDATE calendar_bookings SET status = ?, updated_at = ?
             WHERE id = ? AND customer_id = ? AND site_id = ?`
        ).run(STATUSES.CONFIRMED, nowIso(), bookingId, customerId, siteId);
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
    cancelBookingWithToken,
    rescheduleBookingAsOwner,
    confirmBookingAsOwner,
    hashToken,
    unsafeGetBookingByIdOnly,
};
