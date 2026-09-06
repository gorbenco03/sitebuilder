'use strict';
/**
 * bot/calendar-native/email/templates-ro.js — Romanian transactional copy.
 *
 * Honesty rule (VISION §8): copy MUST match booking status snapshot.
 * Never claim "confirmat" for requested / reschedule_needed / cancelled.
 */

const { EMAIL_TEMPLATE_KEYS } = require('../schema');

/**
 * Map booking status (+ optional event hint) → template key.
 * @param {string} bookingStatus
 * @param {{ kind?: string, previousStatus?: string }} [ctx]
 */
function templateKeyForStatus(bookingStatus, ctx = {}) {
    const st = String(bookingStatus || '');
    const kind = String(ctx.kind || '');

    if (kind === 'cancelled' || st === 'cancelled') return 'booking_cancelled';
    if (kind === 'reschedule_confirmed' || (kind === 'rescheduled' && st === 'confirmed')) {
        return 'booking_reschedule_confirmed';
    }
    if (st === 'confirmed') return 'booking_confirmed';
    if (st === 'reschedule_needed') return 'booking_reschedule_needed';
    if (st === 'requested') return 'booking_requested';
    // Fail closed: unknown → requested-style, never confirmed
    return 'booking_requested';
}

/**
 * Status label in Romanian — never overstates.
 * @param {string} bookingStatus
 */
function statusLabelRo(bookingStatus) {
    switch (String(bookingStatus || '')) {
        case 'confirmed':
            return 'confirmată';
        case 'requested':
            return 'în așteptare (cerere înregistrată)';
        case 'reschedule_needed':
            return 'necesită reprogramare';
        case 'cancelled':
            return 'anulată';
        default:
            return 'înregistrată';
    }
}

/**
 * @param {{
 *   templateKey: string,
 *   visitorName: string,
 *   visitorEmail?: string,
 *   visitorPhone?: string|null,
 *   serviceName: string,
 *   resourceName?: string|null,
 *   startOwnerLocal: string,
 *   startUtc: string,
 *   bookingStatus: string,
 *   manageUrl?: string|null,
 *   siteLabel?: string,
 * }} p
 */
function render(p) {
    const key = String(p.templateKey || '');
    if (!EMAIL_TEMPLATE_KEYS.includes(key)) {
        const err = new Error('unknown email template: ' + key);
        err.code = 'TEMPLATE';
        throw err;
    }

    const name = String(p.visitorName || 'Client').trim() || 'Client';
    const visitorEmail = String(p.visitorEmail || '').trim();
    const visitorPhone = p.visitorPhone != null ? String(p.visitorPhone).trim() : '';
    const service = String(p.serviceName || 'Serviciu').trim() || 'Serviciu';
    // Wave 7 (audit #25): who the appointment is with. Empty string for a
    // legacy single-resource tenant or a still-unresolved booking — callers
    // (email/index.js loadResourceName) already suppress it in exactly those
    // cases, so every template body below only grows a "cu <nume>" clause
    // when it is genuinely meaningful, leaving single-resource tenants'
    // copy byte-identical to before this wave.
    const resourceName = p.resourceName ? String(p.resourceName).trim() : '';
    const withResource = resourceName ? ' cu ' + resourceName : '';
    const when = String(p.startOwnerLocal || p.startUtc || '').trim();
    const status = String(p.bookingStatus || '');
    const label = statusLabelRo(status);
    const site = String(p.siteLabel || 'cabinet').trim() || 'cabinet';
    const manageUrl = p.manageUrl ? String(p.manageUrl) : null;

    // Hard honesty: confirmed template only when status is confirmed
    if (
        (key === 'booking_confirmed' || key === 'booking_reschedule_confirmed') &&
        status !== 'confirmed'
    ) {
        const err = new Error('refusing confirmed copy for status=' + status);
        err.code = 'HONESTY';
        throw err;
    }
    if (key === 'booking_requested' && status === 'confirmed') {
        const err = new Error('refusing requested copy for confirmed booking');
        err.code = 'HONESTY';
        throw err;
    }
    if (key === 'booking_cancelled' && status !== 'cancelled') {
        const err = new Error('refusing cancelled copy for status=' + status);
        err.code = 'HONESTY';
        throw err;
    }
    if (key === 'booking_reschedule_needed' && status !== 'reschedule_needed') {
        const err = new Error('refusing reschedule_needed copy for status=' + status);
        err.code = 'HONESTY';
        throw err;
    }
    if ((key === 'booking_reminder' || key === 'booking_reminder_owner') && status !== 'confirmed') {
        const err = new Error('refusing reminder copy for status=' + status);
        err.code = 'HONESTY';
        throw err;
    }

    let subject;
    let headline;
    let bodyLead;

    switch (key) {
        case 'booking_confirmed':
            subject = 'Programare confirmată — ' + service;
            headline = 'Programarea ta este confirmată';
            bodyLead =
                'Salut, ' + name + '.\n\n' +
                'Programarea ta la ' + site + ' pentru „' + service + '”' + withResource + ' a fost confirmată.\n' +
                'Data și ora (ora cabinetului): ' + when + '.\n' +
                'Stare: ' + label + '.';
            break;
        case 'booking_requested':
            subject = 'Cerere de programare înregistrată — ' + service;
            headline = 'Cererea ta de programare a fost înregistrată';
            bodyLead =
                'Salut, ' + name + '.\n\n' +
                'Am înregistrat cererea ta pentru „' + service + '”' + withResource + ' la ' + site + '.\n' +
                'Data și ora solicitate (ora cabinetului): ' + when + '.\n' +
                'Stare: ' + label + '.\n\n' +
                'Aceasta NU este o confirmare finală. Te anunțăm pe email când programarea ' +
                'este confirmată sau dacă e nevoie de reprogramare.';
            break;
        case 'booking_reschedule_needed':
            subject = 'Reprogramare necesară — ' + service;
            headline = 'Intervalul ales nu mai este disponibil';
            bodyLead =
                'Salut, ' + name + '.\n\n' +
                'Cererea ta pentru „' + service + '”' + withResource + ' la ' + site + ' necesită reprogramare.\n' +
                'Data și ora solicitate (ora cabinetului): ' + when + '.\n' +
                'Stare: ' + label + '.\n\n' +
                'Programarea NU este confirmată. Te rugăm să alegi un alt interval.';
            break;
        case 'booking_cancelled':
            subject = 'Programare anulată — ' + service;
            headline = 'Programarea a fost anulată';
            bodyLead =
                'Salut, ' + name + '.\n\n' +
                'Programarea ta pentru „' + service + '”' + withResource + ' la ' + site + ' a fost anulată.\n' +
                'Data și ora (ora cabinetului): ' + when + '.\n' +
                'Stare: ' + label + '.';
            break;
        case 'booking_reschedule_confirmed':
            subject = 'Programare reprogramată și confirmată — ' + service;
            headline = 'Noul interval este confirmat';
            bodyLead =
                'Salut, ' + name + '.\n\n' +
                'Programarea ta pentru „' + service + '”' + withResource + ' la ' + site + ' a fost reprogramată și confirmată.\n' +
                'Noua dată și oră (ora cabinetului): ' + when + '.\n' +
                'Stare: ' + label + '.';
            break;
        case 'booking_reminder':
            subject = 'Reamintire programare — ' + service;
            headline = 'Reamintire pentru programarea ta';
            bodyLead =
                'Salut, ' + name + '.\n\n' +
                'Îți reamintim de programarea ta la ' + site + ' pentru „' + service + '”' + withResource + '.\n' +
                'Data și ora (ora cabinetului): ' + when + '.\n' +
                'Stare: ' + label + '.\n\n' +
                'Dacă nu mai poți ajunge, te rugăm să anulezi sau să reprogramezi din timp.';
            break;
        case 'booking_reminder_owner':
            subject = 'Reamintire programare — ' + service + ' (' + name + ')';
            headline = 'Programare viitoare';
            bodyLead =
                'Ai o programare viitoare la ' + site + '.\n\n' +
                'Client: ' + name +
                (visitorEmail ? ' (' + visitorEmail + ')' : '') +
                (visitorPhone ? ' · ' + visitorPhone : '') + '.\n' +
                'Serviciu: ' + service + '.\n' +
                (resourceName ? 'Cu: ' + resourceName + '.\n' : '') +
                'Data și ora (ora cabinetului): ' + when + '.\n' +
                'Stare: ' + label + '.';
            break;
        default:
            subject = 'Actualizare programare — ' + service;
            headline = 'Actualizare programare';
            bodyLead =
                'Salut, ' + name + '.\n\n' +
                'Ai o actualizare pentru „' + service + '”.\n' +
                'Data și ora: ' + when + '.\n' +
                'Stare: ' + label + '.';
    }

    let manageBlock = '';
    if (manageUrl && key !== 'booking_cancelled') {
        manageBlock =
            '\n\nGestionează programarea (anulare / reprogramare) cu linkul unic de mai jos. ' +
            'Linkul este valabil doar pentru această programare:\n' + manageUrl;
    }

    const footer =
        '\n\n—\nHidook Site Builder\n' +
        'Acest mesaj este tranzacțional, legat de programarea ta.';

    const text = bodyLead + manageBlock + footer;

    const manageHtml = manageUrl && key !== 'booking_cancelled'
        ? '<p style="margin:24px 0">' +
          '<a href="' + escapeHtml(manageUrl) + '" ' +
          'style="background:#1a1a1a;color:#fff;padding:12px 20px;border-radius:6px;' +
          'text-decoration:none;display:inline-block">Gestionează programarea</a></p>' +
          '<p style="font-size:12px;color:#666;word-break:break-all">' +
          escapeHtml(manageUrl) + '</p>'
        : '';

    // The owner-reminder copy addresses the site owner, not the visitor — no
    // "Salut, {visitorName}" greeting, and the full lead paragraph (it has no
    // separate greeting line to strip via slice(1) like every other template).
    const isOwnerFacing = key === 'booking_reminder_owner';
    const greetingHtml = isOwnerFacing ? '' : '<p>' + escapeHtml('Salut, ' + name + '.') + '</p>';
    const leadHtml = isOwnerFacing
        ? bodyLead.replace(/\n/g, ' ')
        : bodyLead.split('\n\n').slice(1).join(' ').replace(/\n/g, ' ');

    const html = [
        '<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><title>',
        escapeHtml(subject),
        '</title></head><body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#222">',
        '<h1 style="font-size:20px;line-height:1.3">', escapeHtml(headline), '</h1>',
        greetingHtml,
        '<p>', escapeHtml(leadHtml), '</p>',
        '<p><strong>Stare:</strong> ', escapeHtml(label), '</p>',
        '<p><strong>Serviciu:</strong> ', escapeHtml(service), '<br>',
        resourceName ? '<strong>Cu:</strong> ' + escapeHtml(resourceName) + '<br>' : '',
        '<strong>Data/ora (cabinet):</strong> ', escapeHtml(when), '</p>',
        manageHtml,
        '<p style="font-size:12px;color:#888;margin-top:32px">Hidook Site Builder — mesaj tranzacțional</p>',
        '</body></html>',
    ].join('');

    // Forbidden phrases for non-confirmed templates
    if (key !== 'booking_confirmed' && key !== 'booking_reschedule_confirmed') {
        const lower = (subject + '\n' + text + '\n' + html).toLowerCase();
        // Allow "NU este o confirmare" / "când programarea este confirmată" explanatory,
        // but ban positive confirmation claims as the status.
        if (
            /programarea ta este confirmată/.test(lower) ||
            /a fost confirmată/.test(lower) ||
            (/stare:\s*confirmată/.test(lower) && status !== 'confirmed')
        ) {
            const err = new Error('template honesty violation for ' + key);
            err.code = 'HONESTY';
            throw err;
        }
    }

    return { templateKey: key, subject, text, html, statusLabel: label };
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = {
    templateKeyForStatus,
    statusLabelRo,
    render,
    escapeHtml,
};
