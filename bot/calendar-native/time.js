'use strict';
/**
 * bot/calendar-native/time.js — UTC canonical storage helpers.
 * Owner timezone for weekly/blackout walls; visitor display is caller's job.
 */

/**
 * Convert a wall-clock local time in `timeZone` to UTC epoch ms.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @param {number} hour 0-23
 * @param {number} minute 0-59
 * @param {string} timeZone IANA
 * @returns {number} epoch ms
 */
function zonedWallTimeToUtcMs(year, month, day, hour, minute, timeZone) {
    // desired wall clock interpreted as if it were UTC numbers:
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    // utc = desired - offset(zone, utc); offset = (zone local as UTC nums) - utc
    let utc = desired;
    for (let i = 0; i < 3; i++) {
        const parts = getZonedParts(new Date(utc), timeZone);
        const asUtc = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second || 0,
            0
        );
        const offset = asUtc - utc;
        utc = desired - offset;
    }
    return utc;
}

/**
 * @param {Date} date
 * @param {string} timeZone
 * @returns {{ year:number, month:number, day:number, hour:number, minute:number, second:number, weekday:number }}
 * weekday: 1=Mon .. 7=Sun (ISO)
 */
function getZonedParts(date, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const map = {};
    for (const p of dtf.formatToParts(date)) {
        if (p.type !== 'literal') map[p.type] = p.value;
    }
    const wd = weekdayShortToIso(map.weekday);
    return {
        year: Number(map.year),
        month: Number(map.month),
        day: Number(map.day),
        hour: Number(map.hour),
        minute: Number(map.minute),
        second: Number(map.second),
        weekday: wd,
    };
}

function weekdayShortToIso(short) {
    const s = String(short || '').slice(0, 3).toLowerCase();
    const table = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
    if (!table[s]) throw new Error('Unexpected weekday: ' + short);
    return table[s];
}

/** @param {string} dateLocal YYYY-MM-DD */
function parseDateLocal(dateLocal) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateLocal || ''));
    if (!m) throw new Error('Invalid date_local: ' + dateLocal);
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Add calendar days to a YYYY-MM-DD (no TZ — pure civil date).
 * @param {string} dateLocal
 * @param {number} days
 */
function addDaysLocal(dateLocal, days) {
    const { year, month, day } = parseDateLocal(dateLocal);
    const dt = new Date(Date.UTC(year, month - 1, day + days));
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** ISO weekday 1-7 for a civil date (using UTC noon anchor). */
function isoWeekdayForDateLocal(dateLocal) {
    const { year, month, day } = parseDateLocal(dateLocal);
    const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const js = dt.getUTCDay(); // 0 Sun .. 6 Sat
    return js === 0 ? 7 : js;
}

function minutesToHourMinute(total) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return { hour: h, minute: m };
}

function toIsoUtc(ms) {
    return new Date(ms).toISOString();
}

/**
 * UTC offset (minutes, e.g. +180 for EEST) actually in effect at `utcMs` in
 * `timeZone`. Shared building block for DST-aware wall-time resolution below.
 */
function offsetMinutesAtUtc(utcMs, timeZone) {
    const parts = getZonedParts(new Date(utcMs), timeZone);
    const asUtc = Date.UTC(
        parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0, 0
    );
    return (asUtc - utcMs) / 60000;
}

/**
 * CAL-07 — resolve every UTC instant that realizes a given local wall-clock
 * time in `timeZone`, explicit about the two DST-transition hazards instead
 * of quietly picking one arbitrary answer the way zonedWallTimeToUtcMs's
 * simple fixed-point iteration does:
 *
 *  - Normal day: exactly one instant.
 *  - Spring-forward gap (e.g. Europe/Bucharest 2026-03-29 03:00-03:59 never
 *    happens — clocks jump 03:00 -> 04:00): zero instants. Neither the
 *    pre-transition nor the post-transition offset round-trips back to the
 *    requested wall clock, so both candidates are rejected.
 *  - Fall-back overlap (e.g. Europe/Bucharest 2026-10-25 03:00-03:59 happens
 *    twice — clocks fall back 04:00 -> 03:00): two distinct instants, one
 *    hour apart, each carrying its own UTC offset. Both are real, bookable,
 *    non-colliding moments (different start_utc), ordered earliest first.
 *
 * Works by taking the UTC offset that prevailed a day before and a day after
 * the requested date (correct for any single-transition day, since a zone's
 * offset is constant for months at a time) as the two only possible
 * candidates, then keeping only the ones that are self-consistent AND
 * round-trip to the exact requested wall clock.
 *
 * @returns {{ utcMs: number, offsetMinutes: number }[]} sorted ascending by utcMs
 */
function resolveZonedWallTime(year, month, day, hour, minute, timeZone) {
    const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const offsetBefore = offsetMinutesAtUtc(naiveUtc - 24 * 3600000, timeZone);
    const offsetAfter = offsetMinutesAtUtc(naiveUtc + 24 * 3600000, timeZone);

    const candidates = new Map();
    for (const offset of [offsetBefore, offsetAfter]) {
        const utcMs = naiveUtc - offset * 60000;
        const selfCheck = offsetMinutesAtUtc(utcMs, timeZone);
        if (selfCheck !== offset) continue; // this offset does not actually hold at utcMs
        const parts = getZonedParts(new Date(utcMs), timeZone);
        if (
            parts.year !== year || parts.month !== month || parts.day !== day ||
            parts.hour !== hour || parts.minute !== minute
        ) continue; // wall clock does not round-trip — not a real instant
        candidates.set(utcMs, offset);
    }
    return Array.from(candidates.entries())
        .map(([utcMs, offsetMinutes]) => ({ utcMs, offsetMinutes }))
        .sort((a, b) => a.utcMs - b.utcMs);
}

/**
 * "+03:00" / "-05:30" style UTC offset label for confirmation copy on an
 * ambiguous (fall-back) local time.
 * @param {number} offsetMinutes
 */
function formatUtcOffset(offsetMinutes) {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(offsetMinutes);
    const h = String(Math.floor(abs / 60)).padStart(2, '0');
    const m = String(abs % 60).padStart(2, '0');
    return 'UTC' + sign + h + ':' + m;
}

module.exports = {
    zonedWallTimeToUtcMs,
    getZonedParts,
    parseDateLocal,
    addDaysLocal,
    isoWeekdayForDateLocal,
    minutesToHourMinute,
    toIsoUtc,
    offsetMinutesAtUtc,
    resolveZonedWallTime,
    formatUtcOffset,
};
