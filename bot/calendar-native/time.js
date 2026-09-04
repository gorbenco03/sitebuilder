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

module.exports = {
    zonedWallTimeToUtcMs,
    getZonedParts,
    parseDateLocal,
    addDaysLocal,
    isoWeekdayForDateLocal,
    minutesToHourMinute,
    toIsoUtc,
};
