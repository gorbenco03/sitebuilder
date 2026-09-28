'use strict';
/**
 * bot/site-messages.js — S-2C (PLAN-UX §5.2 supporting piece): backend for
 * the generic contact-form section a published site's template can carry
 * (`<form data-site-messages-api data-site-slug>`, added by the sibling
 * template tasks S-2A/S-2B). Three responsibilities, kept in one small
 * module the way bot/calendar-native/cutover.js keeps the calendar's
 * equivalent publish-time wiring in one place:
 *
 *   1. resolveMessagesApiBase() / injectPublishedHtml() — publish-time: fill
 *      the form's data-site-messages-api/data-site-slug attributes in the
 *      rendered HTML with the same origin resolution the native calendar
 *      widget already uses (CALENDAR_PUBLIC_BASE_URL || PUBLIC_BASE_URL ||
 *      PUBLIC_URL, empty for same-origin /live). Called from
 *      bot/webpublish.js, right where nativeApiBase is injected.
 *   2. blankPublishedHtmlForExport() — the mirror image for a static export
 *      (bot/site-export.js): a downloaded ZIP/HTML has no Hidook backend
 *      behind it, so the form must never point at one — VISION §6 ("no
 *      requests to a Hidook domain to work"). Blanking the attribute is what
 *      makes the client-side form script fall back to WhatsApp/mailto.
 *   3. createPublicMessage() — the actual write: validates a public
 *      submission (honeypot, length limits, site must be live/paid) and
 *      persists it via the registry. Rate limiting is the caller's job
 *      (bot/server.js), same split as handleCalendarNativeBookings/
 *      calendar-native/public-api.js#createPublicBooking.
 *
 * Owner-side read/mark-read/delete are thin enough to live directly in
 * bot/server.js (resolveOwnedSite + the registry functions below) — no
 * extra indirection needed for those.
 */

const fs = require('fs');
const { log } = require('./logger.js');

const NAME_MAX = 80;
const CONTACT_MAX = 120;
const MESSAGE_MAX = 1000;

function _registry() { return require('./registry.js'); }
function _email() { return require('./email.js'); }

// ---------------------------------------------------------------------------
// 1. Publish-time: resolve + inject the API base into the rendered HTML.
// ---------------------------------------------------------------------------

/**
 * Public origin for the site-messages API when the published site is a
 * static-host export that is not same-origin with the bot host. Empty
 * string means same-origin relative URLs (local/bot host, /live/<slug>/).
 * Same env precedence as bot/calendar-native/cutover.js#resolveNativeApiBase
 * — deliberately reused rather than reinvented, so a deployment only has to
 * set CALENDAR_PUBLIC_BASE_URL/PUBLIC_BASE_URL/PUBLIC_URL once for both
 * features.
 * @returns {string} origin without trailing slash, or ''
 */
function resolveMessagesApiBase() {
    const raw = String(
        process.env.CALENDAR_PUBLIC_BASE_URL ||
        process.env.PUBLIC_BASE_URL ||
        process.env.PUBLIC_URL ||
        ''
    ).trim();
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return (u.origin + (u.pathname || '').replace(/\/$/, '')).replace(/\/$/, '');
    } catch (_) {
        return '';
    }
}

/** Escape a value for safe placement inside a double-quoted HTML attribute. */
function _escapeAttr(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Set (or replace) one attribute on an already-matched opening tag string.
 * Handles a bare attribute (`data-site-messages-api`), one with a quoted
 * value (empty or not), and — belt and suspenders — appends it if somehow
 * absent from the tag it was called on.
 */
function _setAttrOnTag(tag, name, value) {
    const escaped = _escapeAttr(value);
    const withValueRe = new RegExp('\\b' + name + '\\s*=\\s*(["\']).*?\\1', 'i');
    const bareRe = new RegExp('\\b' + name + '\\b(?!\\s*=)', 'i');
    if (withValueRe.test(tag)) {
        return tag.replace(withValueRe, `${name}="${escaped}"`);
    }
    if (bareRe.test(tag)) {
        return tag.replace(bareRe, `${name}="${escaped}"`);
    }
    return tag.replace(/\/?>$/, (m) => ` ${name}="${escaped}"${m}`);
}

/**
 * Fill data-site-messages-api / data-site-slug on every
 * `<form data-site-messages-api ...>` in the given rendered HTML file, in
 * place on disk. Best-effort: never throws, returns whether anything
 * changed. A template with no such form (most templates today, until
 * S-2A/S-2B land it) is a correct no-op.
 * @param {string} indexPath
 * @param {{ apiBase?: string, slug?: string }} opts
 * @returns {boolean}
 */
function injectPublishedHtml(indexPath, opts = {}) {
    if (!indexPath || !fs.existsSync(indexPath)) return false;
    let html;
    try {
        html = fs.readFileSync(indexPath, 'utf8');
    } catch (_) {
        return false;
    }
    const apiBase = String(opts.apiBase || '');
    const slug = String(opts.slug || '');
    let changed = false;
    const next = html.replace(/<form\b[^>]*>/gi, (tag) => {
        if (!/data-site-messages-api\b/i.test(tag)) return tag;
        changed = true;
        let out = _setAttrOnTag(tag, 'data-site-messages-api', apiBase);
        out = _setAttrOnTag(out, 'data-site-slug', slug);
        return out;
    });
    if (!changed) return false;
    try {
        fs.writeFileSync(indexPath, next, 'utf8');
    } catch (_) {
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// 2. Export-time: force the attribute back to empty (never depend on Hidook).
// ---------------------------------------------------------------------------

/**
 * Mirror of injectPublishedHtml for a static export: forces
 * data-site-messages-api/data-site-slug to '' regardless of what the
 * template rendered, so a downloaded ZIP/standalone HTML never quietly
 * calls home to this customer's Hidook account. The client-side form
 * script (S-2A/S-2B) treats an empty data-site-messages-api as "fall back
 * to WhatsApp/mailto".
 * @param {string} html
 * @returns {string}
 */
function blankMessagesApiInHtml(html) {
    return String(html || '').replace(/<form\b[^>]*>/gi, (tag) => {
        if (!/data-site-messages-api\b/i.test(tag)) return tag;
        let out = _setAttrOnTag(tag, 'data-site-messages-api', '');
        out = _setAttrOnTag(out, 'data-site-slug', '');
        return out;
    });
}

// ---------------------------------------------------------------------------
// 3. Public submission: validate + persist + notify.
// ---------------------------------------------------------------------------

/**
 * @param {{ slug: string, name: string, contact: string, message: string, website?: string }} body
 * @returns {{ ok: true, dropped?: boolean } | { ok: false, status: number, error: string, code?: string }}
 */
function createPublicMessage(body) {
    const slug = String((body && body.slug) || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
        return { ok: false, status: 400, error: 'Site invalid.', code: 'INVALID_SLUG' };
    }

    const reg = _registry();
    const all = typeof reg.listAllSites === 'function' ? reg.listAllSites() : [];
    const site = all.find((s) => s && String(s.slug || '').toLowerCase() === slug) || null;
    if (!site) {
        return { ok: false, status: 404, error: 'Acest site nu este publicat.', code: 'NOT_FOUND' };
    }
    const isLive = !!site.paid && (site.status === 'live' || site.status === 'active');
    if (!isLive) {
        return { ok: false, status: 404, error: 'Acest site nu este publicat.', code: 'NOT_LIVE' };
    }

    // Honeypot: a real visitor never fills a field hidden by CSS. Silently
    // accept-and-drop so a bot never learns its submission was rejected.
    const website = String((body && body.website) || '').trim();
    if (website) {
        log('site_messages.honeypot_dropped', { slug });
        return { ok: true, dropped: true };
    }

    const name = String((body && body.name) || '').trim().slice(0, NAME_MAX);
    const contact = String((body && body.contact) || '').trim().slice(0, CONTACT_MAX);
    const message = String((body && body.message) || '').trim().slice(0, MESSAGE_MAX);
    if (!name || !contact || !message) {
        return { ok: false, status: 400, error: 'Numele, contactul și mesajul sunt obligatorii.', code: 'MISSING_FIELDS' };
    }

    const record = reg.createSiteMessage({ siteId: site.id, name, contact, message });

    // Best-effort owner notification — never blocks or fails the visitor's
    // submission if the email transport is unavailable.
    notifyOwnerOfMessage(site, record).catch((e) => {
        log('site_messages.notify_failed', { siteId: site.id, err: e.message }, 'warn');
    });

    log('site_messages.created', { siteId: site.id, slug });
    return { ok: true, id: record.id };
}

/**
 * Email the site's owner in Romanian, via the existing Resend transport
 * (bot/email.js#sendResendEmail). No-ops quietly without RESEND_API_KEY
 * (dev/test), same fallback shape as sendMagicLink.
 * @param {object} site
 * @param {object} record
 */
async function notifyOwnerOfMessage(site, record) {
    const reg = _registry();
    const user = await reg.getUser(site.userId);
    const ownerEmail = user && user.email;
    if (!ownerEmail) return;

    const siteName = (site.projectName || site.slug || '').trim();
    const subject = `Mesaj nou de pe site-ul tău${siteName ? ` (${siteName})` : ''}`;
    const html = `
<!DOCTYPE html>
<html lang="ro">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#333">Ai un mesaj nou</h2>
  <p><strong>De la:</strong> ${_escapeAttr(record.name)}</p>
  <p><strong>Contact:</strong> ${_escapeAttr(record.contact)}</p>
  <p><strong>Mesaj:</strong><br>${_escapeAttr(record.message).replace(/\n/g, '<br>')}</p>
  <p style="font-size:13px;color:#888">
    Vezi și răspunde din tabloul de bord Hidook, la site-ul „${_escapeAttr(siteName || site.slug)}”, secțiunea „Mesaje”.
  </p>
</body>
</html>`.trim();
    const text =
        `Ai un mesaj nou de pe site-ul tău${siteName ? ` (${siteName})` : ''}.\n\n` +
        `De la: ${record.name}\nContact: ${record.contact}\nMesaj:\n${record.message}\n\n` +
        `Vezi și răspunde din tabloul de bord Hidook.`;

    try {
        await _email().sendResendEmail({ to: ownerEmail, subject, html, text });
        log('site_messages.owner_notified', { siteId: site.id });
    } catch (e) {
        if (e && e.code === 'NO_API_KEY') {
            log('site_messages.owner_notify.dev', { siteId: site.id, ownerEmail });
            return;
        }
        throw e;
    }
}

module.exports = {
    NAME_MAX,
    CONTACT_MAX,
    MESSAGE_MAX,
    resolveMessagesApiBase,
    injectPublishedHtml,
    blankMessagesApiInHtml,
    createPublicMessage,
    notifyOwnerOfMessage,
};
