'use strict';
/**
 * bot/calendar-native/ics.js — hand-written RFC 5545 iCalendar builder.
 *
 * Zero runtime dependencies (repo-wide constraint). Correctness matters more
 * than features here — a malformed .ics silently fails to import in most
 * calendar clients, which is worse than sending nothing (audit finding #26).
 *
 * Every property emitted is checked against:
 *  - RFC 5545 §3.1    content line folding at 75 octets, CRLF line endings
 *  - RFC 5545 §3.3.11 TEXT value escaping (backslash, semicolon, comma, \n)
 *  - RFC 5545 §3.3.5  DATE-TIME in UTC form (…T…Z)
 *  - RFC 5545 §3.8    UID, DTSTAMP, DTSTART/DTEND, SUMMARY, DESCRIPTION,
 *                      LOCATION, ORGANIZER, SEQUENCE, STATUS
 *  - RFC 5546 §3.2    METHOD:REQUEST (create/update) / METHOD:CANCEL,
 *                      SEQUENCE bumped on every re-send for the same UID
 *
 * This module only builds the visitor-facing .ics text and offers a small
 * round-trip parser used purely to verify our own output (evidence +
 * oracle) — it is not a general-purpose ICS reader.
 */

const CRLF = '\r\n';
const PRODID = '-//Hidook Site Builder//Calendar Native//RO';

/** Stable UID for a booking — same value on every re-emit (create/update/cancel). */
function icsUidForBooking(bookingId) {
    return String(bookingId) + '@calendar.hidook.invalid';
}

/** RFC 5545 §3.3.11 TEXT escaping (SUMMARY / DESCRIPTION / LOCATION values). */
function escapeIcsText(s) {
    return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}

/** Quote a parameter value (e.g. CN=) only when it needs it; DQUOTE itself is never allowed inside. */
function paramValue(v) {
    const s = String(v == null ? '' : v).replace(/"/g, "'");
    return /[:;,]/.test(s) ? '"' + s + '"' : s;
}

/** UTC timestamp per RFC 5545 §3.3.5 form #2, e.g. 20260906T140000Z. */
function icsUtcStamp(ms) {
    const iso = new Date(ms).toISOString(); // 2026-09-06T14:00:00.000Z
    return (
        iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) +
        'T' + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z'
    );
}

/**
 * Fold one unfolded "NAME...:VALUE" content line at 75 octets (RFC 5545
 * §3.1), splitting on UTF-8 byte boundaries only — never inside a
 * multi-byte character (Romanian diacritics are 2-byte UTF-8). Continuation
 * lines are prefixed with a single space, joined with CRLF.
 */
function foldLine(line) {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;
    const parts = [];
    let start = 0;
    let limit = 75;
    while (start < bytes.length) {
        let end = Math.min(start + limit, bytes.length);
        // back off while the next byte is a UTF-8 continuation byte (10xxxxxx)
        while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
        parts.push(bytes.slice(start, end).toString('utf8'));
        start = end;
        limit = 74; // continuation lines lose one octet to the leading space
    }
    return parts.join(CRLF + ' ');
}

function contentLine(name, value) {
    return foldLine(name + ':' + value);
}

/**
 * Build one VCALENDAR object for a booking lifecycle event.
 *
 * @param {{
 *   booking: object,                 // calendar_bookings row (current, post-mutation)
 *   serviceName: string,
 *   siteLabel: string,
 *   organizerEmail: string,
 *   method: 'REQUEST'|'CANCEL',
 *   sequence: number,                // RFC 5545 SEQUENCE — monotonic per UID
 *   nowMs?: number,                  // DTSTAMP instant (defaults to Date.now())
 *   resourceName?: string,           // Wave 7 (audit #25) — who the appointment
 *                                    // is with (a stylist, a room). Omitted for
 *                                    // a legacy single-resource tenant or a
 *                                    // still-unresolved booking — SUMMARY /
 *                                    // DESCRIPTION stay exactly as before this
 *                                    // wave when absent. No ATTENDEE line is
 *                                    // added for the resource (no real staff
 *                                    // email exists to put there) — text only.
 * }} p
 * @returns {string} CRLF-terminated VCALENDAR text
 */
function buildBookingIcs(p) {
    const booking = p.booking;
    const method = p.method === 'CANCEL' ? 'CANCEL' : 'REQUEST';
    const sequence = Number.isFinite(p.sequence) ? Math.max(0, Math.trunc(p.sequence)) : 0;
    const nowMs = p.nowMs != null ? p.nowMs : Date.now();
    const startMs = Date.parse(booking.start_utc);
    const endMs = Date.parse(booking.end_utc);
    const uid = icsUidForBooking(booking.id);
    const status = method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
    const serviceName = p.serviceName || 'Serviciu';
    const siteLabel = p.siteLabel || 'Hidook';
    const resourceName = p.resourceName ? String(p.resourceName).trim() : '';

    const summary = escapeIcsText(
        resourceName
            ? 'Programare: ' + serviceName + ' cu ' + resourceName + ' — ' + siteLabel
            : 'Programare: ' + serviceName + ' — ' + siteLabel
    );
    const description = escapeIcsText(
        'Programare la ' + siteLabel + ' pentru „' + serviceName + '”' +
        (resourceName ? ', cu ' + resourceName + '.' : '.') +
        (method === 'CANCEL' ? '\nAceastă programare a fost anulată.' : '')
    );
    const location = escapeIcsText(siteLabel);
    const organizerEmail = String(p.organizerEmail || 'no-reply@hidook.invalid').trim();
    const visitorEmail = String((booking && booking.visitor_email) || '').trim();
    const visitorName = paramValue((booking && booking.visitor_name) || 'Client');

    const lines = [];
    lines.push(contentLine('BEGIN', 'VCALENDAR'));
    lines.push(contentLine('VERSION', '2.0'));
    lines.push(contentLine('PRODID', PRODID));
    lines.push(contentLine('CALSCALE', 'GREGORIAN'));
    lines.push(contentLine('METHOD', method));
    lines.push(contentLine('BEGIN', 'VEVENT'));
    lines.push(contentLine('UID', uid));
    lines.push(contentLine('DTSTAMP', icsUtcStamp(nowMs)));
    lines.push(contentLine('DTSTART', icsUtcStamp(startMs)));
    lines.push(contentLine('DTEND', icsUtcStamp(endMs)));
    lines.push(contentLine('SUMMARY', summary));
    lines.push(contentLine('DESCRIPTION', description));
    lines.push(contentLine('LOCATION', location));
    lines.push(contentLine('STATUS', status));
    lines.push(contentLine('SEQUENCE', String(sequence)));
    lines.push(contentLine('ORGANIZER;CN=' + paramValue(siteLabel), 'mailto:' + organizerEmail));
    if (visitorEmail) {
        lines.push(contentLine(
            'ATTENDEE;CN=' + visitorName + ';ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE',
            'mailto:' + visitorEmail
        ));
    }
    lines.push(contentLine('TRANSP', 'OPAQUE'));
    lines.push(contentLine('END', 'VEVENT'));
    lines.push(contentLine('END', 'VCALENDAR'));
    return lines.join(CRLF) + CRLF;
}

/**
 * Minimal RFC 5545 parser: unfolds continuation lines, then splits each
 * logical line into NAME(;PARAMS)?:VALUE. Used to verify our own output
 * round-trips (oracle + evidence) — not a general-purpose ICS reader.
 * @param {string} text
 * @returns {{ name: string, params: string, value: string, raw: string }[]}
 */
function parseIcs(text) {
    const raw = String(text || '').split(CRLF);
    const unfolded = [];
    for (const l of raw) {
        if ((l.startsWith(' ') || l.startsWith('\t')) && unfolded.length) {
            unfolded[unfolded.length - 1] += l.slice(1);
        } else if (l.length) {
            unfolded.push(l);
        }
    }
    const props = [];
    for (const l of unfolded) {
        const idx = l.indexOf(':');
        if (idx < 0) continue;
        const left = l.slice(0, idx);
        const value = l.slice(idx + 1);
        const semi = left.indexOf(';');
        const name = (semi >= 0 ? left.slice(0, semi) : left).toUpperCase();
        const params = semi >= 0 ? left.slice(semi + 1) : '';
        props.push({ name, params, value, raw: l });
    }
    return props;
}

/** Convenience: find first property by name (case-insensitive), or null. */
function findProp(props, name) {
    const n = String(name).toUpperCase();
    return props.find((p) => p.name === n) || null;
}

module.exports = {
    CRLF,
    PRODID,
    icsUidForBooking,
    escapeIcsText,
    paramValue,
    icsUtcStamp,
    foldLine,
    buildBookingIcs,
    parseIcs,
    findProp,
};
