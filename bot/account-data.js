'use strict';
/**
 * bot/account-data.js — GDPR self-service data (R-27, findings auth-account#3/#4).
 *
 * Two operations, both scoped to exactly one userId and never touching any
 * other account's rows:
 *   - buildUserDataExport(userId): a full, exportable snapshot of everything
 *     this account owns (profile, every site's config history, orders/
 *     invoices, native-calendar services/bookings, contact-form requests).
 *   - eraseAccount(userId): permanently removes it all — cancels any active
 *     Stripe subscription, unpublishes/removes live files, erases
 *     native-calendar tenant data, deletes the site rows, revokes every
 *     session and login token, and deletes the user row itself.
 *
 * Lazy `require()`s throughout mirror bot/server.js's getRegistry()/
 * getAuth() pattern: requiring this module alone must not force-open the
 * registry DB or the calendar-native DB before either function is actually
 * called (tests that only need one of the two never pay for the other).
 */

const fs = require('fs');
const path = require('path');
const { log } = require('./logger.js');

function _registry() { return require('./registry.js'); }
function _payments() { return require('./payments.js'); }
function _webpublish() { return require('./webpublish.js'); }
function _domains() { return require('./domains.js'); }
function _calendarPublicApi() { return require('./calendar-native/public-api.js'); }
function _calendarOwnerApi() { return require('./calendar-native/owner-api.js'); }
function _calendarEngine() { return require('./calendar-native/engine.js'); }
function _retention() { return require('./calendar-native/retention.js'); }

function _resolveCalendarDb() {
    return _calendarPublicApi().getDb({});
}

/** Same path convention as bot/server.js#appointmentsFileForSlug — the
 *  legacy local (non-native-calendar) contact-request store, one JSON file
 *  per site slug. Not exported from server.js, so reimplemented here rather
 *  than requiring server.js (which would require this module back). */
function _appointmentsFileForSlug(slug) {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
    const safe = String(slug || '').toLowerCase();
    return path.join(dataDir, 'appointments', `${safe}.json`);
}

function _loadAppointmentRequests(slug) {
    try {
        const raw = fs.readFileSync(_appointmentsFileForSlug(slug), 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data.requests) ? data.requests : [];
    } catch (_) {
        return [];
    }
}

/**
 * Build the full exportable snapshot of exactly one user's own data.
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function buildUserDataExport(userId) {
    const reg = _registry();
    const webpublish = _webpublish();
    const domains = _domains();
    const ownerApi = _calendarOwnerApi();
    const engine = _calendarEngine();
    const db = _resolveCalendarDb();

    const user = await reg.getUser(userId);
    const sites = (await reg.listSites(userId)) || [];

    const sitesOut = sites.map((site) => {
        const versions = (reg.listVersions(site.id) || []).map((v) => ({
            versionId: v.versionId,
            publishedAt: v.publishedAt,
            config: reg.getVersionConfig(site.id, v.versionId),
        }));

        const orders = reg.listOrdersBySite(site.id) || [];
        let invoices = [];
        try { invoices = webpublish.getInvoiceHistory(site) || []; } catch (_) { /* best-effort */ }

        let domain = null;
        try { domain = domains.getDomainForSite(site.id) || null; } catch (_) { /* best-effort */ }

        let bookings = [];
        try {
            const result = ownerApi.listOwnerBookings(db, site.userId, site.id, {});
            if (result && result.ok) bookings = result.bookings;
        } catch (_) { /* calendar never configured for this site — no bookings */ }

        let services = [];
        try {
            services = engine.listServices(db, site.userId, site.id, { activeOnly: false }) || [];
        } catch (_) { /* best-effort */ }

        let contactRequests = [];
        try { contactRequests = _loadAppointmentRequests(site.slug) || []; } catch (_) { /* best-effort */ }

        return {
            id: site.id,
            slug: site.slug,
            projectName: site.projectName,
            templateId: site.templateId,
            status: site.status,
            paid: !!site.paid,
            url: site.url,
            createdAt: site.createdAt,
            paidUntil: site.paidUntil || null,
            domain,
            versions,
            orders,
            invoices,
            calendarServices: services,
            calendarBookings: bookings,
            contactRequests,
        };
    });

    return {
        exportedAt: new Date().toISOString(),
        user: user
            ? { id: user.id, email: user.email || null, createdAt: user.createdAt }
            : { id: userId },
        sites: sitesOut,
    };
}

/**
 * Permanently erase a user's account and everything it owns. Mirrors
 * bot/server.js#handleDeleteSite's per-site cleanup (unpublish, domain
 * record, native-calendar tenant data, registry row) but — unlike a single
 * site delete — never refuses on an active subscription or future bookings:
 * it cancels the subscription itself first, then proceeds regardless, since
 * the whole account is being erased, not just unpublished.
 *
 * Every step is independently best-effort (one already-gone resource must
 * never block the rest — same contract as handleDeleteSite), so this is safe
 * to call twice on the same userId (e.g. a retried request after a partial
 * failure).
 *
 * @param {string} userId
 * @returns {Promise<{ok: true, sitesRemoved: number}>}
 */
async function eraseAccount(userId) {
    const reg = _registry();
    const payments = _payments();
    const webpublish = _webpublish();
    const domains = _domains();
    const retention = _retention();
    const db = _resolveCalendarDb();

    const sites = (await reg.listSites(userId)) || [];

    for (const site of sites) {
        if (site.paid && site.stripeSubscriptionId) {
            try {
                await payments.cancelSubscription(site.stripeSubscriptionId);
            } catch (e) {
                log('account_data.erase.cancel_subscription_failed', { siteId: site.id, err: e.message }, 'warn');
            }
        }
        try {
            webpublish.unpublishSite(site, { reason: 'account_deleted' });
        } catch (e) {
            log('account_data.erase.unpublish_failed', { siteId: site.id, err: e.message }, 'warn');
        }
        try {
            await domains.deleteDomainRecordForSite(site.id);
        } catch (e) {
            log('account_data.erase.domain_failed', { siteId: site.id, err: e.message }, 'warn');
        }
        try {
            retention.eraseSiteTenantData(db, site.userId, site.id);
        } catch (e) {
            log('account_data.erase.calendar_failed', { siteId: site.id, err: e.message }, 'warn');
        }
        try {
            if (site.slug) fs.rmSync(_appointmentsFileForSlug(site.slug), { force: true });
        } catch (_) { /* best-effort */ }
        try {
            require('./ledger.js').append({
                event: 'account_deleted_site_removed',
                siteId: site.id,
                userId,
                slug: site.slug,
            });
        } catch (_) { /* best-effort */ }
        try {
            reg.deleteSite(site.id);
        } catch (e) {
            log('account_data.erase.site_delete_failed', { siteId: site.id, err: e.message }, 'error');
        }
    }

    try { reg.revokeAllSessionsForUser(userId); } catch (e) {
        log('account_data.erase.sessions_failed', { userId, err: e.message }, 'warn');
    }

    try {
        const user = await reg.getUser(userId);
        if (user && user.email && typeof reg.deleteLoginTokensForEmail === 'function') {
            reg.deleteLoginTokensForEmail(user.email);
        }
    } catch (e) {
        log('account_data.erase.tokens_failed', { userId, err: e.message }, 'warn');
    }

    try {
        if (typeof reg.deleteUser === 'function') reg.deleteUser(userId);
    } catch (e) {
        log('account_data.erase.user_delete_failed', { userId, err: e.message }, 'error');
    }

    return { ok: true, sitesRemoved: sites.length };
}

module.exports = { buildUserDataExport, eraseAccount };
