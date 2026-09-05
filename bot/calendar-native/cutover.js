'use strict';
/**
 * bot/calendar-native/cutover.js — staged per-site opt-in to native booking
 * (VISION.md §8 step e).
 *
 * Mechanism: config flag `appointment.nativeBooking` (truthy "da"/"yes"/true).
 * Default falsy → legacy local appointment-request form (and optional Cal.com
 * bookingUrl) stay unchanged. Opt-in is reversible: clear the flag + republish
 * restores the legacy path. Native engine rows are never deleted on opt-out.
 *
 * At publish, when opted in, inject tenant keys from the Site Builder site
 * record (customerId = site.userId, siteId = site.id) and seed services +
 * weekly availability from the professionals appointment config.
 */

const engine = require('./engine');

const TENANT_RE = /^[a-zA-Z0-9_-]{2,80}$/;

/**
 * Public origin for native widget assets + public booking API when the published
 * site is a static export (Cloudflare/Vercel/Netlify) that is not same-origin
 * with the bot host. Empty string = same-origin relative URLs (local/bot host).
 *
 * Env (build/publish time): CALENDAR_PUBLIC_BASE_URL || PUBLIC_BASE_URL
 * Optional config override: appointment.nativeApiBase (absolute http(s) origin).
 *
 * @param {object} [appt]
 * @returns {string} origin without trailing slash, or ''
 */
function resolveNativeApiBase(appt) {
    const fromCfg =
        appt && typeof appt.nativeApiBase === 'string' ? appt.nativeApiBase.trim() : '';
    const fromEnv = String(
        process.env.CALENDAR_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || ''
    ).trim();
    const raw = fromCfg || fromEnv || '';
    if (!raw) return '';
    // Absolute origin only — reject path-only or protocol-relative junk.
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return (u.origin + (u.pathname || '').replace(/\/$/, '')).replace(/\/$/, '');
    } catch (_) {
        return '';
    }
}

/**
 * Truthy nativeBooking values (schema is type:text like appointment.enabled).
 * @param {*} value
 * @returns {boolean}
 */
function isNativeBookingEnabled(value) {
    if (value === true || value === 1) return true;
    if (value == null) return false;
    if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (!s || /^(false|0|no|nu|off|n)$/i.test(s)) return false;
        return /^(true|1|yes|da|on|y)$/i.test(s) || s === 'enabled';
    }
    return Boolean(value);
}

/**
 * Read flag from a site config object.
 * @param {object|null|undefined} config
 */
function configHasNativeBooking(config) {
    const appt = config && config.appointment;
    if (!appt || typeof appt !== 'object') return false;
    return isNativeBookingEnabled(appt.nativeBooking);
}

/**
 * Normalize HH:MM or H:MM → minute-of-day.
 * @param {string|number} hm
 * @returns {number|null}
 */
function parseHmToMinute(hm) {
    const s = String(hm == null ? '' : hm).trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
        return null;
    }
    return h * 60 + min;
}

/**
 * Inject tenant ids + keep nativeBooking flag. Mutates a shallow appointment copy
 * on the returned config clone — does not mutate the caller's object.
 *
 * @param {object} config
 * @param {{ userId: string, id: string }} site  registry site (userId + id)
 * @returns {{ config: object, optedIn: boolean, customerId: string|null, siteId: string|null }}
 */
function applyCutoverToConfig(config, site) {
    const cfg = JSON.parse(JSON.stringify(config || {}));
    if (!cfg.appointment || typeof cfg.appointment !== 'object') {
        cfg.appointment = {};
    }
    const optedIn = isNativeBookingEnabled(cfg.appointment.nativeBooking);
    if (!optedIn) {
        // Reversible: clear injected ids so a later accidental truthy render
        // cannot point at a stale tenant without an explicit re-opt-in publish.
        cfg.appointment.nativeCustomerId = '';
        cfg.appointment.nativeSiteId = '';
        cfg.appointment.nativeApiBase = '';
        return { config: cfg, optedIn: false, customerId: null, siteId: null };
    }
    const customerId = String((site && site.userId) || '').trim();
    const siteId = String((site && site.id) || '').trim();
    if (!TENANT_RE.test(customerId) || !TENANT_RE.test(siteId)) {
        const err = new Error('native cutover requires valid site.userId and site.id');
        err.code = 'CUTOVER_TENANT';
        throw err;
    }
    cfg.appointment.nativeCustomerId = customerId;
    cfg.appointment.nativeSiteId = siteId;
    // Static export hosts need an explicit bot-origin API base; empty = same-origin.
    cfg.appointment.nativeApiBase = resolveNativeApiBase(cfg.appointment);
    // Native path wins over Cal.com link when both set.
    // bookingUrl left intact in config so opt-out can restore it.
    return {
        config: cfg,
        optedIn: true,
        customerId,
        siteId,
        nativeApiBase: cfg.appointment.nativeApiBase,
    };
}

/**
 * Seed / refresh native calendar services + weekly hours from professionals
 * appointment config. Idempotent upserts. Never deletes existing bookings.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} customerId
 * @param {string} siteId
 * @param {object} config
 * @returns {{ services: number, weeklyWindows: number, timezone: string }}
 */
function seedTenantFromProfessionalConfig(db, customerId, siteId, config) {
    if (!TENANT_RE.test(customerId) || !TENANT_RE.test(siteId)) {
        const err = new Error('invalid tenant for seed');
        err.code = 'TENANT';
        throw err;
    }
    const appt = (config && config.appointment) || {};
    const timezone = String(appt.timezone || 'Europe/Bucharest').trim() || 'Europe/Bucharest';
    const slotInterval = Math.min(
        120,
        Math.max(5, parseInt(appt.slotIntervalMinutes, 10) || 30)
    );
    const minLead = Math.min(
        7 * 24 * 60,
        Math.max(0, parseInt(appt.minLeadMinutes, 10) || 0)
    );

    engine.ensureSettings(db, customerId, siteId, {
        timezone,
        default_buffer_minutes: 0,
        slot_interval_minutes: slotInterval,
        min_cancel_hours: 24,
        // min lead is enforced at slot gen via generateSlots opts; settings keep interval
    });

    const types = Array.isArray(appt.types) ? appt.types : [];
    let serviceCount = 0;
    types.forEach((t, idx) => {
        if (!t || typeof t !== 'object') return;
        const id = String(t.id || ('svc_' + idx)).trim().slice(0, 64);
        if (!id) return;
        const name = String(t.label || t.name || id).trim().slice(0, 120) || id;
        const duration = Math.min(
            480,
            Math.max(15, parseInt(t.durationMin != null ? t.durationMin : t.duration_minutes, 10) || 45)
        );
        engine.upsertService(db, customerId, siteId, {
            id,
            name,
            duration_minutes: duration,
            buffer_minutes: 0,
            sort_order: idx,
            active: true,
        });
        serviceCount += 1;
    });

    // If no types configured, keep a single default service so the widget is usable.
    if (serviceCount === 0) {
        const duration = Math.min(
            480,
            Math.max(15, parseInt(appt.durationMin, 10) || 45)
        );
        engine.upsertService(db, customerId, siteId, {
            id: 'svc_default',
            name: 'Consultație',
            duration_minutes: duration,
            buffer_minutes: 0,
            sort_order: 0,
            active: true,
        });
        serviceCount = 1;
    }

    const weeklyRaw = Array.isArray(appt.weekly) ? appt.weekly : [];
    const windows = [];
    weeklyRaw.forEach((w) => {
        if (!w || typeof w !== 'object') return;
        const weekday = parseInt(w.weekday, 10);
        if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) return;
        const start_minute = parseHmToMinute(w.start);
        const end_minute = parseHmToMinute(w.end);
        if (start_minute == null || end_minute == null || end_minute <= start_minute) return;
        windows.push({ weekday, start_minute, end_minute });
    });
    if (!windows.length) {
        // Mon–Fri 09–17 default
        for (let d = 1; d <= 5; d++) {
            windows.push({ weekday: d, start_minute: 9 * 60, end_minute: 17 * 60 });
        }
    }
    engine.setWeeklyAvailability(db, customerId, siteId, windows);

    return {
        services: serviceCount,
        weeklyWindows: windows.length,
        timezone,
        minLeadMinutes: minLead,
        slotIntervalMinutes: slotInterval,
    };
}

/**
 * Full publish-time cutover: inject ids into config + seed engine when opted in.
 * When opted out, only clears injected ids (engine data retained).
 *
 * @param {object} opts
 * @param {object} opts.config
 * @param {{ userId: string, id: string }} opts.site
 * @param {object} opts.db  calendar-native db handle
 * @returns {{ config: object, optedIn: boolean, seed: object|null }}
 */
function preparePublishCutover({ config, site, db }) {
    const applied = applyCutoverToConfig(config, site);
    if (!applied.optedIn) {
        return { config: applied.config, optedIn: false, seed: null };
    }
    const seed = seedTenantFromProfessionalConfig(
        db,
        applied.customerId,
        applied.siteId,
        applied.config
    );
    return { config: applied.config, optedIn: true, seed, customerId: applied.customerId, siteId: applied.siteId };
}

module.exports = {
    TENANT_RE,
    isNativeBookingEnabled,
    configHasNativeBooking,
    resolveNativeApiBase,
    applyCutoverToConfig,
    seedTenantFromProfessionalConfig,
    preparePublishCutover,
    parseHmToMinute,
};
