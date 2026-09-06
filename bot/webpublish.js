'use strict';
/**
 * bot/webpublish.js — Web-platform publish pipeline (pay-before-publish).
 *
 * Model:
 *   - publishSite: deploy after payment (or paid republish). Accepts {siteDirAlreadyBuilt}
 *     to skip the build step when files are already on disk (Telegram flow).
 *   - handleStripePaid: generalized across platforms; if site was expired →
 *     republish last version; if pending draft → first public publish after pay;
 *     notify owner on owner's channel + concierge domain msg.
 *     Also stores stripeCustomerId + stripeSubscriptionId for cancel → unpublish.
 *   - handleStripeSubscriptionEvent: persist subscription.updated lifecycle status;
 *     customer.subscription.deleted, or updated with status one of
 *     canceled/cancelled/unpaid/incomplete_expired → unpublishSite (idempotent).
 *     PC-03: 'unpaid' is Stripe's terminal dunning state (all retries exhausted)
 *     and can persist indefinitely without ever sending .deleted, so it must be
 *     a trigger on its own, not just canceled/deleted. Other statuses (active,
 *     trialing, past_due) only update the stored status — no unpublish, no new
 *     grace-window state invented.
 *   - unpublishSite: stop serving isolated $DATA_DIR/published/<slug>/; registry not live.
 *   - handleStripeInvoicePaymentFailed: BE-06 — records a failed dunning
 *     attempt (ledger + best-effort owner notification) and never unpublishes;
 *     'past_due' stays live while Stripe retries, and the existing
 *     unpaid/incomplete_expired path above is what eventually unpublishes.
 *   - deployPlaceholder: documented no-op (pay-before-publish; historical unused
 *     expiry-placeholder entry). Kept exported so legacy callers do not throw.
 *
 * publishSite() also derives, at build time, an absolute canonical link/
 * og:url, a LocalBusiness JSON-LD block (buildLocalBusinessJsonLd), and
 * robots.txt/sitemap.xml (F5/F6) — see the "F5/F6" section below for how the
 * pre-deploy prediction / post-deploy correction works.
 *
 * HIDOOK_FAKE_DEPLOY=1 (refused in production) → stub deploy returning
 * {url:'https://<slug>.test.local', provider:'fake'} — for offline unit tests.
 *
 * HIDOOK_ISOLATED_DEPLOY=1 (refused in production) → copy built site into
 * $DATA_DIR/published/<slug>/ and return {url: (PUBLIC_URL||'')+'/live/'+slug+'/'
 * (relative /live/<slug>/ when PUBLIC_URL is unset), provider:'isolated'}.
 * Served by GET /live/<slug>/ (same HTTP server). Never copy-then-throw on empty PUBLIC_URL.
 *
 * Commercial amounts come only from ./pricing.js.
 * CommonJS, zero new npm dependencies, Node 18+.
 */

const fs   = require('fs');
const path = require('path');

const { build }         = require('../build.js');
// deployBuiltSite is loaded lazily to avoid circular dep: flow.js ↔ webpublish.js
function getDeployBuiltSite() { return require('./flow.js').deployBuiltSite; }
const registry          = require('./registry.js');
const ledger            = require('./ledger.js');
const ai                = require('./ai.js');
const { log }           = require('./logger.js');
const cfDeploy          = require('./deploy-cloudflare.js');
const payments          = require('./payments.js');
const pricing           = require('./pricing.js');
const siteExport        = require('./site-export.js');

const PROJECT_ROOT  = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const SITES_DIR     = path.join(process.env.DATA_DIR || PROJECT_ROOT, 'sites');

const TEMPLATE_EXCLUDES = /^(schema\.json|presets\.json)$|\.md$/i;
// Checkout grants the first hosting year before Stripe's day-7 trial
// collection. Only cycle invoices at/near the existing entitlement end renew.
const RENEWAL_DUE_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * F5/F6 — placeholder origin used when a site's real public host is only
 * known AFTER the deploy call returns (plain Cloudflare Pages / Vercel
 * without BRAND_DOMAIN — see predictedPublicOrigin below). It has to be some
 * syntactically valid https:// URL at build time so the template's
 * `@if seo.canonical` guard actually emits the <link rel="canonical">/
 * <meta property="og:url"> tags (and so robots.txt/sitemap.xml already have
 * an origin to put in <loc>) — publishSite() always rewrites every occurrence
 * of this string to the real origin once the deploy call returns (same
 * pattern as absolutizeSocialImageMeta above, extended to
 * canonical/robots/sitemap). RFC 2606 reserves the .invalid TLD for exactly
 * this "never a real host" use, so it can never collide with an actual
 * deploy target.
 */
const PENDING_SEO_ORIGIN = 'https://pending-deploy.hidook.invalid';

/**
 * Remove isolated published files for a slug (stop serving /live/<slug>/).
 * Idempotent: missing dir is fine.
 * @param {string} slug
 */
function _removeIsolatedPublished(slug) {
    const safe = String(slug || '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
    if (!safe) return;
    const dataDir = process.env.DATA_DIR || PROJECT_ROOT;
    const dest = path.join(dataDir, 'published', safe);
    try {
        fs.rmSync(dest, { recursive: true, force: true });
    } catch (_) {}
}

/**
 * Find a registry site by Stripe subscription id (stored on paid transition).
 * @param {string} subscriptionId
 * @returns {object|null}
 */
function findSiteBySubscriptionId(subscriptionId) {
    if (!subscriptionId) return null;
    const want = String(subscriptionId);
    const all = registry.listAllSites() || [];
    return all.find((s) => s && (s.stripeSubscriptionId === want || s.subscriptionId === want)) || null;
}

/**
 * Unpublish a site after subscription cancel: registry status not live, clear
 * public url, remove isolated published files. Idempotent.
 *
 * @param {object|string} siteOrId  site object or site id
 * @param {object} [meta]
 * @returns {object|null} updated site or null
 */
function unpublishSite(siteOrId, meta = {}) {
    const site = typeof siteOrId === 'string' ? registry.getSite(siteOrId) : siteOrId;
    if (!site || !site.id) {
        log('webpublish.unpublish.no_site', { meta });
        return null;
    }
    if (site.slug) _removeIsolatedPublished(site.slug);

    const alreadyDown = site.status !== 'live' && site.status !== 'active';
    // PC-03: keep the real Stripe status (e.g. 'unpaid', 'incomplete_expired')
    // instead of always forcing 'canceled', so an operator/dashboard fix can
    // later tell "customer canceled" apart from "card kept failing" — the
    // commercial outcome (not public) is the same either way.
    const nextSubscriptionStatus = meta.subscriptionStatus || 'canceled';
    try {
        registry.updateSite(site.id, {
            status: 'unpublished',
            url: null,
            // Keep paid/paidUntil history; cancel does not invent a charge.
            canceledAt: site.canceledAt || new Date().toISOString(),
            stripeSubscriptionStatus: nextSubscriptionStatus,
            // Keep the legacy compatibility field in sync with the Stripe status.
            // Statuses that now unpublish (unpaid, incomplete_expired) used to fall
            // through the plain persist path, which set this field; skipping it here
            // would silently desynchronise the two.
            subscriptionStatus: nextSubscriptionStatus,
        });
    } catch (e) {
        log('webpublish.unpublish.update_failed', { siteId: site.id, err: e.message }, 'error');
        return null;
    }
    try {
        ledger.append({
            event: 'unpublished',
            siteId: site.id,
            reason: meta.reason || 'subscription_canceled',
            subscriptionId: meta.subscriptionId || site.stripeSubscriptionId || null,
            alreadyDown: !!alreadyDown,
        });
    } catch (_) {}
    log('webpublish.unpublish.done', {
        siteId: site.id,
        slug: site.slug,
        alreadyDown: !!alreadyDown,
        subscriptionId: meta.subscriptionId || null,
    });
    return registry.getSite(site.id);
}

/**
 * Handle Stripe subscription lifecycle for entitlement + cancel → unpublish.
 * - customer.subscription.deleted → always unpublish
 * - customer.subscription.updated with status=canceled → unpublish
 * - other customer.subscription.updated statuses → persist for entitlement checks
 * Idempotent via unpublishSite.
 *
 * @param {object} event Stripe event
 * @returns {Promise<object|null>}
 */
async function handleStripeSubscriptionEvent(event) {
    if (!event || !event.type) return null;
    const type = event.type;
    const sub = event.data && event.data.object;
    if (!sub || !sub.id) return null;

    const status = String(sub.status || '').toLowerCase();
    const isDeleted = type === 'customer.subscription.deleted';
    const isUpdated = type === 'customer.subscription.updated';
    const isCanceledUpdate =
        isUpdated &&
        (status === 'canceled' || status === 'cancelled');
    // PC-03: 'unpaid' is Stripe's terminal state once every dunning retry has
    // failed — it can stay 'unpaid' forever without ever firing .deleted.
    // 'incomplete_expired' is the equivalent terminal failure for a
    // subscription whose very first invoice never got paid. Both must
    // unpublish; no other status (active/trialing/past_due) does.
    const isUnpaidUpdate =
        isUpdated &&
        (status === 'unpaid' || status === 'incomplete_expired');

    if (!isDeleted && (!isUpdated || !status)) {
        log('webpublish.subscription.ignored', { type, status, subscriptionId: sub.id });
        return null;
    }

    // Resolve site: metadata.siteId → stripeSubscriptionId lookup
    let site = null;
    const metaSiteId = sub.metadata && sub.metadata.siteId;
    if (metaSiteId) site = registry.getSite(metaSiteId);
    if (!site) site = findSiteBySubscriptionId(sub.id);

    if (!site) {
        log('webpublish.subscription.no_site', {
            type,
            subscriptionId: sub.id,
            customer: sub.customer || null,
        }, 'warn');
        return null;
    }

    // Event-level claim (duplicate webhooks)
    const eventId = event.id;
    if (eventId && typeof registry.claimStripeEvent === 'function') {
        const first = registry.claimStripeEvent(eventId);
        if (!first) {
            log('webpublish.subscription.already_handled', { eventId, siteId: site.id });
            // Still ensure unpublished (idempotent) in case prior run partially applied
        }
    }

    if (isDeleted || isCanceledUpdate || isUnpaidUpdate) {
        return unpublishSite(site, {
            reason: isDeleted
                ? 'subscription_deleted'
                : (isCanceledUpdate ? 'subscription_canceled' : `subscription_${status}`),
            subscriptionId: sub.id,
            subscriptionStatus: status || 'canceled',
        });
    }

    const patch = {
        stripeSubscriptionId: sub.id,
        stripeSubscriptionStatus: status,
        subscriptionStatus: status,
    };
    const customerId = typeof sub.customer === 'string'
        ? sub.customer
        : (sub.customer && sub.customer.id);
    if (customerId) patch.stripeCustomerId = customerId;

    try {
        const updated = registry.updateSite(site.id, patch);
        log('webpublish.subscription.status_updated', {
            siteId: site.id,
            status,
            subscriptionId: sub.id,
        });
        return updated;
    } catch (e) {
        log('webpublish.subscription.status_update_failed', {
            siteId: site.id,
            status,
            subscriptionId: sub.id,
            err: e.message,
        }, 'error');
        return null;
    }
}

/**
 * Extend a site's entitlement after Stripe automatically collects a subscription
 * renewal invoice. Checkout handles the first subscription invoice, therefore
 * subscription_create is deliberately a no-op here.
 *
 * @param {object} event Stripe invoice.payment_succeeded or invoice.paid event
 * @returns {Promise<object|null>}
 */
async function handleStripeInvoicePaid(event) {
    const invoice = event && event.data && event.data.object;
    if (!invoice) return null;

    const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : (invoice.subscription && invoice.subscription.id);
    if (!subscriptionId) return null;
    if (invoice.billing_reason === 'subscription_create') {
        log('webpublish.invoice_paid.subscription_create_ignored', { subscriptionId, invoiceId: invoice.id || null });
        return null;
    }
    if (invoice.billing_reason !== 'subscription_cycle') {
        log('webpublish.invoice_paid.ignored', {
            subscriptionId,
            invoiceId: invoice.id || null,
            billingReason: invoice.billing_reason || null,
        });
        return null;
    }

    const site = findSiteBySubscriptionId(subscriptionId);
    if (!site) {
        log('webpublish.invoice_paid.no_site', { subscriptionId, invoiceId: invoice.id || null }, 'warn');
        return null;
    }

    const currentPaidUntilMs = Date.parse(site.paidUntil || '');
    if (Number.isFinite(currentPaidUntilMs) && currentPaidUntilMs > Date.now() + RENEWAL_DUE_WINDOW_MS) {
        log('webpublish.invoice_paid.first_year_cycle_ignored', {
            siteId: site.id,
            subscriptionId,
            invoiceId: invoice.id || null,
            paidUntil: site.paidUntil,
        });
        return site;
    }

    const eventId = event && event.id;
    if (eventId && typeof registry.claimStripeEvent === 'function' && !registry.claimStripeEvent(eventId)) {
        log('webpublish.invoice_paid.already_handled', { eventId, siteId: site.id });
        return registry.getSite(site.id);
    }
    // Stripe may emit both supported event types for the same invoice. The
    // invoice claim complements Stripe-event idempotency and prevents two years.
    if (invoice.id && typeof registry.claimStripeEvent === 'function' && !registry.claimStripeEvent(`invoice-paid:${invoice.id}`)) {
        log('webpublish.invoice_paid.invoice_already_handled', { invoiceId: invoice.id, siteId: site.id });
        return registry.getSite(site.id);
    }

    const baseIso = site.paidUntil && Date.parse(site.paidUntil) > Date.now()
        ? site.paidUntil
        : new Date().toISOString();
    const paidUntil = registry.addMonthsIso(baseIso, 12);
    registry.updateSite(site.id, { paid: true, paidUntil });

    const fresh = registry.getSite(site.id);
    if (fresh && fresh.status === 'expired') {
        const versions = registry.listVersions(site.id);
        const last = versions[versions.length - 1];
        const lastConfig = last && registry.getVersionConfig(site.id, last.versionId);
        if (!lastConfig) {
            log('webpublish.invoice_paid.no_version_for_reactivation', { siteId: site.id }, 'error');
            registry.updateSite(site.id, { status: 'needs-retry', paid: true, paidUntil });
        } else {
            try {
                const result = await module.exports.publishSite({
                    site: { ...fresh, paid: true },
                    config: lastConfig,
                    images: [],
                    siteDirAlreadyBuilt: false,
                });
                registry.updateSite(site.id, { status: 'live', url: result.url, paid: true, paidUntil });
                log('webpublish.invoice_paid.reactivated', { siteId: site.id, subscriptionId, invoiceId: invoice.id || null, url: result.url });
            } catch (e) {
                log('webpublish.invoice_paid.reactivate_failed', { siteId: site.id, err: e.message }, 'error');
                registry.updateSite(site.id, { status: 'needs-retry', paid: true, paidUntil });
            }
        }
    }

    log('webpublish.invoice_paid.renewed', { siteId: site.id, subscriptionId, invoiceId: invoice.id || null, paidUntil });
    return registry.getSite(site.id);
}

/**
 * BE-06 — invoice.payment_failed was never handled at all: a subscription
 * whose charge got declined stayed live indefinitely with nobody told.
 * Stripe already flips the subscription's `status` to `past_due` around the
 * same time, which handleStripeSubscriptionEvent persists without
 * unpublishing (past_due is a recoverable dunning state — Stripe keeps
 * retrying the charge on its own schedule; 'unpaid'/'incomplete_expired' are
 * the terminal failures that already unpublish) — so this handler
 * deliberately does NOT unpublish or invent a second, competing entitlement
 * rule. Its job is the other half: make the failure visible instead of
 * silent — append it to the durable ledger (bot/ledger.js) and best-effort
 * notify the owner. `notifyAdmin` is the Telegram admin channel when wired
 * (bot.js); it is always undefined on the web-only deployment (bot/web.js),
 * which currently has no equivalent channel.
 *
 * NOTE: registry.updateSite() filters patches to a known site-field allowlist
 * (bot/registry-shared.js#KNOWN_SITE_FIELDS — a deliberate fix from the
 * storage rewrite). `paymentFailedAt`/`paymentFailedCount` are not on that
 * allowlist yet, so a patch carrying them is accepted but silently dropped —
 * this is why the durable record of a failed invoice lives in the ledger
 * (queryable via ledger.read()), not on the site record. See HANDOFF-seo.md
 * for the one-line registry-shared.js change that would let an /admin
 * dashboard read this straight off site.paymentFailedAt instead.
 *
 * @param {object} event Stripe invoice.payment_failed event
 * @param {Function} [notifyAdmin] fn(text) — owner notification, best-effort
 * @returns {Promise<object|null>}
 */
async function handleStripeInvoicePaymentFailed(event, notifyAdmin) {
    const invoice = event && event.data && event.data.object;
    if (!invoice) return null;

    const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : (invoice.subscription && invoice.subscription.id);
    if (!subscriptionId) return null;

    const site = findSiteBySubscriptionId(subscriptionId);
    if (!site) {
        log('webpublish.invoice_payment_failed.no_site', {
            subscriptionId,
            invoiceId: invoice.id || null,
        }, 'warn');
        return null;
    }

    // Event-level claim (duplicate webhooks) — same idempotency pattern as
    // handleStripeSubscriptionEvent above.
    const eventId = event && event.id;
    if (eventId && typeof registry.claimStripeEvent === 'function' && !registry.claimStripeEvent(eventId)) {
        log('webpublish.invoice_payment_failed.already_handled', { eventId, siteId: site.id });
        return registry.getSite(site.id);
    }

    // Stripe's own attempt_count already accumulates across dunning retries —
    // trust it rather than maintaining a second counter that cannot persist
    // on the site record (see NOTE above).
    const attemptCount = Number(invoice.attempt_count) || 1;
    try {
        registry.updateSite(site.id, {
            paymentFailedAt: new Date().toISOString(),
            paymentFailedCount: attemptCount,
        });
    } catch (e) {
        log('webpublish.invoice_payment_failed.update_failed', { siteId: site.id, err: e.message }, 'error');
    }

    try {
        ledger.append({
            event: 'payment_failed',
            siteId: site.id,
            subscriptionId,
            invoiceId: invoice.id || null,
            attemptCount,
        });
    } catch (_) {}

    log('webpublish.invoice_payment_failed.recorded', {
        siteId: site.id,
        slug: site.slug,
        subscriptionId,
        invoiceId: invoice.id || null,
        attemptCount,
    }, 'warn');

    if (typeof notifyAdmin === 'function') {
        notifyAdmin(
            `⚠️ Plată eșuată pentru site-ul "${site.slug || site.projectName}" (id ${site.id}). ` +
            `Încercarea ${attemptCount}. Stripe reîncearcă automat cardul; site-ul rămâne live cât timp abonamentul e "past_due". ` +
            'Dacă toate reîncercările eșuează, Stripe trece abonamentul pe "unpaid"/"incomplete_expired" și fluxul existent de anulare oprește site-ul.'
        );
    }

    return registry.getSite(site.id);
}

// ---------------------------------------------------------------------------
// Fake-deploy stub (tests only) + isolated local publish
// ---------------------------------------------------------------------------

function _isFakeDeploy() {
    if (process.env.HIDOOK_FAKE_DEPLOY !== '1') return false;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('HIDOOK_FAKE_DEPLOY=1 is refused in production');
    }
    return true;
}

async function _fakeDeploy(slug) {
    return { url: `https://${slug}.test.local`, provider: 'fake' };
}

function _isIsolatedDeploy() {
    if (process.env.HIDOOK_ISOLATED_DEPLOY !== '1') return false;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('HIDOOK_ISOLATED_DEPLOY=1 is refused in production');
    }
    return true;
}

/**
 * Local preset photos are real files beside live HTML. Load them eagerly in the
 * isolated stranger oracle so off-screen seed photography has a natural size
 * without relying on a synthetic scroll before the full-page inspection.
 */
function makeLocalSeedImagesEager(html) {
    return String(html || '').replace(
        /<img\b[^>]*\bsrc=(['"])images\/[^'">]+\1[^>]*>/gi,
        (tag) => {
            if (/\bloading=(['"])lazy\1/i.test(tag)) {
                return tag.replace(/\bloading=(['"])lazy\1/i, 'loading="eager"');
            }
            if (/\bloading=(['"])[^'"]+\1/i.test(tag)) {
                return tag.replace(/\bloading=(['"])[^'"]+\1/i, 'loading="eager"');
            }
            return tag.replace(/>$/, ' loading="eager">');
        }
    );
}

function prepareIsolatedLiveHtml(siteDir) {
    if (!_isIsolatedDeploy()) return;
    const indexPath = path.join(siteDir, 'index.html');
    if (!fs.existsSync(indexPath)) return;
    const html = fs.readFileSync(indexPath, 'utf8');
    const eagerHtml = makeLocalSeedImagesEager(html);
    if (eagerHtml !== html) fs.writeFileSync(indexPath, eagerHtml, 'utf8');
}

/**
 * Copy built siteDir into $DATA_DIR/published/<slug>/ and return fetchable local URL.
 * @param {string} siteDir
 * @param {string} slug  public path segment (site.slug)
 */
async function _isolatedDeploy(siteDir, slug) {
    const safe = String(slug || '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
    if (!safe || safe !== String(slug || '').toLowerCase()) {
        throw new Error('isolated deploy: invalid slug');
    }
    const dataDir = process.env.DATA_DIR || PROJECT_ROOT;
    const dest = path.join(dataDir, 'published', safe);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(siteDir, dest, { recursive: true });
    // Prefer absolute PUBLIC_URL when set; otherwise same-origin relative path
    // so isolated local boot (no PUBLIC_URL) still returns a fetchable /live URL.
    // Do not throw after copy — that left files on disk while publish failed.
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    const url = publicUrl ? `${publicUrl}/live/${safe}/` : `/live/${safe}/`;
    return { url, provider: 'isolated' };
}

// ---------------------------------------------------------------------------
// F3 — absolute og:image / twitter:image on the published site
// ---------------------------------------------------------------------------
//
// build.js -> deriveSocialImage() intentionally returns a path relative to the
// site root (e.g. "images/hero.jpg") — it must, since it also runs for the
// offline export where there is no public host yet. Link-preview crawlers
// (WhatsApp/Facebook/Telegram/X) require a fully-qualified absolute URL, so
// webpublish.js rewrites the *built* index.html on disk using the real public
// origin of THIS deploy, once it is known. Never touches build.js/template.html.

/** True when `src` is already a fully-qualified absolute URL. */
function _isAbsoluteImageUrl(src) {
    return /^https?:\/\//i.test(String(src || '')) || /^\/\//.test(String(src || ''));
}

/**
 * Rewrite <meta property="og:image" ...> and <meta name="twitter:image" ...>
 * content in the given built index.html from a relative path to an absolute
 * URL under `baseUrl`. No-ops (returns false) when baseUrl is not itself a
 * fully-qualified http(s) URL, or the file has no such meta tag, or the
 * content is already absolute. Idempotent.
 *
 * @param {string} indexPath
 * @param {string} baseUrl  origin (+ optional path prefix), no trailing slash
 * @returns {boolean} true if the file was rewritten
 */
function absolutizeSocialImageMeta(indexPath, baseUrl) {
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return false;
    if (!fs.existsSync(indexPath)) return false;
    let html;
    try {
        html = fs.readFileSync(indexPath, 'utf8');
    } catch (_) {
        return false;
    }
    const base = String(baseUrl).replace(/\/+$/, '');
    let changed = false;
    const patterns = [
        /(<meta\s+property=["']og:image["']\s+content=)(["'])([^"']*)\2/i,
        /(<meta\s+name=["']twitter:image["']\s+content=)(["'])([^"']*)\2/i,
    ];
    for (const re of patterns) {
        html = html.replace(re, (full, prefix, quote, value) => {
            if (!value || _isAbsoluteImageUrl(value)) return full;
            changed = true;
            const rel = value.replace(/^\.?\//, '');
            return `${prefix}${quote}${base}/${rel}${quote}`;
        });
    }
    if (!changed) return false;
    try {
        fs.writeFileSync(indexPath, html, 'utf8');
    } catch (_) {
        return false;
    }
    return true;
}

/**
 * Best-effort predicted public origin for a site BEFORE deploy runs, for the
 * two cases where it is deterministic ahead of time:
 *   - HIDOOK_ISOLATED_DEPLOY=1: identical formula to _isolatedDeploy()'s own
 *     return url, so the copy that lands in $DATA_DIR/published/<slug>/ is
 *     already correct.
 *   - BRAND_DOMAIN + DEPLOY_PROVIDER=cloudflare: identical to the
 *     <slug>.<BRAND_DOMAIN> subdomain _deploy() attaches below.
 * Returns '' when the real host is only known after the deploy call returns
 * (plain Cloudflare Pages / Vercel) — the post-deploy pass in publishSite()
 * covers that case using the actual returned url instead.
 *
 * @param {string} slug
 * @returns {string}
 */
function predictedPublicOrigin(slug) {
    if (process.env.BRAND_DOMAIN && String(process.env.DEPLOY_PROVIDER || '').toLowerCase() === 'cloudflare') {
        return `https://${slug}.${process.env.BRAND_DOMAIN}`;
    }
    if (_isIsolatedDeploy()) {
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        return publicUrl ? `${publicUrl}/live/${slug}` : '';
    }
    return '';
}

// ---------------------------------------------------------------------------
// F5/F6 — canonical/og:url + LocalBusiness JSON-LD + robots.txt/sitemap.xml
// ---------------------------------------------------------------------------
//
// None of these were ever populated on the web-builder publish path: the
// canonical/og:url template slot exists (build.js's URL_TOKENS + every
// template's `@if seo.canonical` guard) but nothing on this path ever wrote
// to it (F5), no LocalBusiness JSON-LD was built outside the Telegram flow
// (bot/flow.js's buildSeo() is Telegram-only, not exported, and bot/flow.js
// is frozen/out of scope here, so this is a second, web-builder-shaped
// implementation — not a duplicate of an already-shared one), and
// robots.txt/sitemap.xml were never written at all (F6). The owner has ruled
// out ever asking the client to type a technical URL (2026-09-02 feedback),
// so all of this is derived automatically at publish time, reusing the same
// predictedPublicOrigin() this module already computes for F3.

/**
 * prof-06 — schema.org LocalBusiness JSON-LD from the web builder's config
 * shape (business.name/metaDescription, contact.phone,
 * contact.instagram.url/contact.facebook.url, footer.address as plain text —
 * confirmed the common shape across all 5 templates' presets.json). Mirrors
 * the *intent* of bot/flow.js's buildSeo() (same schema.org fields, same
 * "only emit if there's something useful" rule, same </script>-breakout
 * escaping) without importing it — flow.js is frozen and out of scope, and
 * buildSeo() is not exported from it anyway. Only called when seo.jsonLd is
 * not already set, so a site drafted through Telegram (which does populate
 * it) is never overwritten.
 *
 * @param {object} cfg  web builder config (post materializeImages)
 * @returns {string} JSON string for {{& seo.jsonLd}}, or '' if nothing useful
 */
function buildLocalBusinessJsonLd(cfg) {
    const business = (cfg && cfg.business) || {};
    const contact  = (cfg && cfg.contact) || {};
    const footer   = (cfg && cfg.footer) || {};

    const name        = String(business.name || '').trim();
    const description = String(business.metaDescription || '').trim();
    // footer.address is already plain text in every template's config shape;
    // contact.address may carry a <br> from the address-formatting helper —
    // strip it to plain text rather than leak markup into a JSON string value.
    const addressRaw = footer.address || contact.address || '';
    const address = String(addressRaw).replace(/<br\s*\/?>/gi, ', ').replace(/\s+/g, ' ').trim();
    const phone = String(contact.phone || '').trim();
    const sameAs = [
        contact.instagram && contact.instagram.url,
        contact.facebook && contact.facebook.url,
    ].filter(Boolean);

    const useful = name || description || address || phone || sameAs.length;
    if (!useful) return '';

    const ld = { '@context': 'https://schema.org', '@type': 'LocalBusiness' };
    if (name) ld.name = name;
    if (description) ld.description = description;
    if (address) ld.address = address;
    if (phone) ld.telephone = phone;
    if (sameAs.length) ld.sameAs = sameAs;

    // Neutralize a smuggled "</script>" the same way build.js's own
    // sanitizeJsonLd() does for the raw {{& seo.jsonLd}} sink.
    return JSON.stringify(ld).replace(/</g, '\\u003c');
}

/**
 * Replace every occurrence of `oldOrigin` with `newOrigin` in a text file.
 * Used post-deploy to correct the placeholder/predicted origin baked into
 * index.html (canonical link + og:url meta share the same seo.canonical
 * value, so one substring pass fixes both) and into robots.txt/sitemap.xml,
 * once the real deploy url is known. No-op (false, no write) when the file
 * is missing, the two origins are identical (nothing to fix — the common
 * case for isolated/BRAND_DOMAIN, which predicted correctly up front), or
 * the placeholder never actually made it into that file.
 *
 * @param {string} filePath
 * @param {string} oldOrigin
 * @param {string} newOrigin
 * @returns {boolean} true if the file was rewritten
 */
function rewriteOriginInFile(filePath, oldOrigin, newOrigin) {
    if (!oldOrigin || !newOrigin || oldOrigin === newOrigin) return false;
    if (!fs.existsSync(filePath)) return false;
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
        return false;
    }
    if (!text.includes(oldOrigin)) return false;
    text = text.split(oldOrigin).join(newOrigin);
    try {
        fs.writeFileSync(filePath, text, 'utf8');
    } catch (_) {
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a data-URL to a Buffer. Returns null if the format is unexpected. */
function decodeDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || '').replace(/\s+/g, ''));
    if (!m) return null;
    return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

function extFromMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    return 'jpg';
}

/** Determine the filename for an image slot from the frontend name hint. */
function imageFilename(name, mimeHint) {
    if (!name || typeof name !== 'string') return null;
    const lower = name.toLowerCase().replace(/\s+/g, '-');
    // Already has extension (logo.png, gallery-1.jpg, hero.webp)
    if (/\.(jpe?g|png|webp)$/i.test(lower)) {
        const safe = lower.replace(/[^a-z0-9._-]/g, '').slice(0, 60);
        return safe || null;
    }
    const ext = extFromMime(mimeHint);
    if (lower === 'logo') return 'logo.' + ext;
    if (lower === 'hero') return 'hero.' + ext;
    if (/^gallery-\d+$/.test(lower)) return lower + '.' + ext;
    if (/^hero-\d+$/.test(lower)) return lower + '.' + ext;
    const safe = lower.replace(/[^a-z0-9-]/g, '').slice(0, 40);
    return safe ? safe + '.' + ext : null;
}

/**
 * Recursively walk obj and replace any string value equal to `dataUrl` with `localPath`,
 * or embedded occurrences inside CSS url(...) values.
 * Bare data-URL on background-ish keys becomes url('images/...').
 */
function rewriteDataUrl(obj, dataUrl, localPath) {
    if (!obj || typeof obj !== 'object') return;
    const bare = String(dataUrl || '').replace(/\s+/g, '');
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string') {
            const compact = val.replace(/\s+/g, '');
            if (val === dataUrl || compact === bare) {
                if (/background|style|gradient/i.test(key)) {
                    obj[key] = "url('" + localPath + "')";
                } else {
                    obj[key] = localPath;
                }
            } else if (val.includes(dataUrl) || (bare && compact.includes(bare))) {
                // Prefer original substring match; fall back to whitespace-stripped
                if (val.includes(dataUrl)) {
                    obj[key] = val.split(dataUrl).join(localPath);
                } else {
                    // rebuild by replacing bare form occurrences carefully
                    obj[key] = val.replace(
                        /data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+/gi,
                        (m) => (m.replace(/\s+/g, '') === bare ? localPath : m)
                    );
                }
            }
        } else if (typeof val === 'object' && val !== null) {
            rewriteDataUrl(val, dataUrl, localPath);
        }
    }
}

/**
 * Write explicit image payloads + any leftover data:image blobs still in cfg onto disk.
 * Mutates cfg in place (rewrites to images/… paths / url(images/…)).
 * @returns {Buffer[]} buffers written (for moderation)
 */
function materializeImages(cfg, imagesDir, explicitImages) {
    const imageBuffers = [];
    const written = new Set();

    function writeOne(name, dataUrl) {
        const decoded = decodeDataUrl(dataUrl);
        if (!decoded) return null;
        let fname = imageFilename(name, decoded.mimeType);
        if (!fname) return null;
        // Avoid clobbering distinct payloads onto the same filename
        if (written.has(fname)) {
            const base = fname.replace(/\.(jpe?g|png|webp)$/i, '');
            const ext = (fname.match(/\.(jpe?g|png|webp)$/i) || ['.jpg'])[0];
            let n = 2;
            while (written.has(base + '-' + n + ext)) n++;
            fname = base + '-' + n + ext;
        }
        fs.mkdirSync(imagesDir, { recursive: true });
        fs.writeFileSync(path.join(imagesDir, fname), decoded.buffer);
        written.add(fname);
        imageBuffers.push(decoded.buffer);
        const localPath = 'images/' + fname;
        rewriteDataUrl(cfg, dataUrl, localPath);
        return localPath;
    }

    for (const img of (explicitImages || [])) {
        if (!img || !img.dataUrl || !img.name) continue;
        writeOne(img.name, img.dataUrl);
    }

    // Defense: materialize any remaining data:image still embedded in config
    const DATA_RE = /data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+/gi;
    function walkLeftovers(obj, parentKey) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => walkLeftovers(item, parentKey || String(i)));
            return;
        }
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string' && val.includes('data:image/')) {
                if (val.startsWith('data:image/')) {
                    const hint = /logo/i.test(key) ? 'logo' : (/background/i.test(key) ? 'hero' : 'gallery');
                    writeOne(hint, val);
                } else {
                    const found = val.match(DATA_RE) || [];
                    let n = 0;
                    for (const raw of found) {
                        n++;
                        const hint = /background/i.test(key)
                            ? (n === 1 ? 'hero' : 'hero-' + n)
                            : 'gallery';
                        writeOne(hint, raw);
                    }
                }
            } else if (typeof val === 'object' && val !== null) {
                walkLeftovers(val, key);
            }
        }
    }
    walkLeftovers(cfg, '');
    return imageBuffers;
}

/**
 * Load pending draft from DATA_DIR/_pending-<orderId>.json.
 * Returns null if not found.
 */
function loadPendingDraft(orderId) {
    const file = path.join(process.env.DATA_DIR || __dirname, `_pending-${orderId}.json`);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/** Save pending draft (before payment is confirmed). */
function savePendingDraft(orderId, draft) {
    const dir = process.env.DATA_DIR || __dirname;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `_pending-${orderId}.json`);
    const tmp  = file + '.tmp';
    const payload = {
        ...draft,
        savedAt: (draft && draft.savedAt) || new Date().toISOString(),
    };
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
}

/**
 * Pick the newest publishable snapshot for first public deploy after pay.
 * Compares pending draft savedAt (or file mtime) vs last saveVersion publishedAt.
 * @returns {{ config: object, images: array, siteDirAlreadyBuilt: boolean }|null}
 */
function resolvePublishPayload(siteId, orderId) {
    const draft = loadPendingDraft(orderId);
    let draftTime = 0;
    if (draft) {
        if (draft.savedAt) draftTime = Date.parse(draft.savedAt) || 0;
        if (!draftTime) {
            try {
                const file = path.join(process.env.DATA_DIR || __dirname, `_pending-${orderId}.json`);
                draftTime = fs.statSync(file).mtimeMs || 0;
            } catch { /* ignore */ }
        }
    }

    const versions = registry.listVersions(siteId);
    let lastVer = null;
    let verTime = 0;
    if (versions.length > 0) {
        lastVer = versions[versions.length - 1];
        verTime = Date.parse(lastVer.publishedAt) || 0;
        // listVersions is chronological push order; also consider max publishedAt
        for (const v of versions) {
            const t = Date.parse(v.publishedAt) || 0;
            if (t >= verTime) {
                verTime = t;
                lastVer = v;
            }
        }
    }

    if (draft && (!lastVer || draftTime >= verTime)) {
        return {
            config: draft.config || {},
            images: draft.images || [],
            siteDirAlreadyBuilt: !!draft.siteDirAlreadyBuilt,
            source: 'pending-draft',
        };
    }
    if (lastVer) {
        const config = registry.getVersionConfig(siteId, lastVer.versionId);
        if (config) {
            return {
                config,
                images: (draft && draft.images) || [],
                siteDirAlreadyBuilt: false,
                source: 'version',
            };
        }
    }
    if (draft) {
        return {
            config: draft.config || {},
            images: draft.images || [],
            siteDirAlreadyBuilt: !!draft.siteDirAlreadyBuilt,
            source: 'pending-draft-fallback',
        };
    }
    return null;
}

/** Delete pending draft after successful publish (best-effort). */
function deletePendingDraft(orderId) {
    try {
        const file = path.join(process.env.DATA_DIR || __dirname, `_pending-${orderId}.json`);
        fs.unlinkSync(file);
    } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Core deploy helper (with BRAND_DOMAIN subdomain support)
// ---------------------------------------------------------------------------

/**
 * Deploy a built site directory. Returns {url, provider}.
 * Respects HIDOOK_FAKE_DEPLOY=1 (unit stub) and HIDOOK_ISOLATED_DEPLOY=1 (local /live/).
 * If DEPLOY_PROVIDER=cloudflare and BRAND_DOMAIN is set, also attaches subdomain (best-effort).
 *
 * @param {string} siteDir
 * @param {string} projectName
 * @param {string} userId
 * @param {{ slug?: string }} [opts]  opts.slug used for isolated URL path
 */
async function _deploy(siteDir, projectName, userId, opts = {}) {
    if (_isFakeDeploy()) {
        return await _fakeDeploy(projectName);
    }

    if (_isIsolatedDeploy()) {
        const slug = opts.slug || projectName;
        return await _isolatedDeploy(siteDir, slug);
    }

    const result = await getDeployBuiltSite()(siteDir, projectName, userId);
    const url    = result && result.url;
    const provider = result && result.provider;

    // BRAND_DOMAIN: attach <slug>.<BRAND_DOMAIN> when cloudflare is the provider
    if (provider === 'cloudflare' && process.env.BRAND_DOMAIN) {
        const sub = await cfDeploy.ensureSubdomain(projectName);
        // Return brandUrl as the canonical URL if available
        return { url: sub.brandUrl || url || sub.url, provider };
    }

    return { url, provider };
}

// ---------------------------------------------------------------------------
// publishSite
// ---------------------------------------------------------------------------

/**
 * Build (if needed) and deploy a site (paid path / reactivation).
 *
 * @param {object} opts
 * @param {object} opts.site              — registry site record
 * @param {object} [opts.config]          — site config (with possible dataUrls); required unless siteDirAlreadyBuilt
 * @param {Array<{name:string, dataUrl:string}>} [opts.images] — uploaded images
 * @param {boolean} [opts.siteDirAlreadyBuilt] — if true, skip template copy/build; files are on disk already
 * @returns {Promise<{url: string}>}
 * @throws if moderation blocks, or deploy fails
 */
async function publishSite({ site, config, images, siteDirAlreadyBuilt }) {
    const siteDir   = path.join(SITES_DIR, site.projectName);
    const imagesDir = path.join(siteDir, 'images');

    // F5/F6: resolved once, up front, so the same origin string is used both
    // when writing the pre-deploy placeholder/prediction (below) and when
    // correcting it post-deploy (after the real url comes back). Independent
    // of cfgCopy, so it is available even when siteDirAlreadyBuilt skips the
    // build branch below (robots.txt/sitemap.xml still get written either way).
    const slugForUrl    = site.slug || site.projectName;
    const seoBuildOrigin = predictedPublicOrigin(slugForUrl) || PENDING_SEO_ORIGIN;

    if (!siteDirAlreadyBuilt) {
        fs.mkdirSync(imagesDir, { recursive: true });

        // 1. Copy template files (excluding schema/presets/md)
        //    Also copy templates/<id>/images/* so opened default presets that
        //    reference relative images/… paths render without a network fetch.
        const templateDir = path.join(TEMPLATES_DIR, site.templateId);
        if (fs.existsSync(templateDir)) {
            for (const entry of fs.readdirSync(templateDir)) {
                if (TEMPLATE_EXCLUDES.test(entry)) continue;
                const src = path.join(templateDir, entry);
                const st = fs.statSync(src);
                if (st.isFile()) {
                    fs.copyFileSync(src, path.join(siteDir, entry));
                } else if (st.isDirectory()) {
                    // Any asset directory a template ships, not just images/.
                    // See the matching comment in bot/site-export.js.
                    const destDir = entry === 'images' ? imagesDir : path.join(siteDir, entry);
                    fs.mkdirSync(destDir, { recursive: true });
                    for (const asset of fs.readdirSync(src)) {
                        const from = path.join(src, asset);
                        if (fs.statSync(from).isFile()) {
                            fs.copyFileSync(from, path.join(destDir, asset));
                        }
                    }
                }
            }
        }

        // 2. Decode images and write to disk; rewrite src in config
        const cfgCopy = JSON.parse(JSON.stringify(config || {}));
        const imageBuffers = materializeImages(cfgCopy, imagesDir, images);

        // 2b. Calendar native staged cutover (VISION §8 e): when
        // appointment.nativeBooking is opted in, inject tenant ids from the
        // Site Builder site record and seed the native engine. Opt-out clears
        // injected ids only — engine history is retained (non-destructive).
        try {
            const cutover = require('./calendar-native/cutover');
            if (cutover.configHasNativeBooking(cfgCopy) || (cfgCopy.appointment && cfgCopy.appointment.nativeCustomerId)) {
                const { openCalendarDb } = require('./calendar-native/db');
                const calDb = openCalendarDb({});
                const prepared = cutover.preparePublishCutover({
                    config: cfgCopy,
                    site,
                    db: calDb,
                });
                // Replace cfgCopy keys in place so later write uses cutover config
                Object.keys(cfgCopy).forEach((k) => { delete cfgCopy[k]; });
                Object.assign(cfgCopy, prepared.config);
                if (prepared.optedIn) {
                    log('calendar.cutover.seeded', {
                        siteId: site.id,
                        customerId: prepared.customerId,
                        services: prepared.seed && prepared.seed.services,
                    });
                } else {
                    log('calendar.cutover.opt_out', { siteId: site.id });
                }
            }
        } catch (e) {
            log('calendar.cutover.error', { err: e.message, siteId: site && site.id }, 'error');
            if (e && e.code === 'CUTOVER_TENANT') throw e;
            // Soft-fail seed errors should not block publish of non-native sites;
            // if opted in and seed failed hard, surface.
            const cutover = require('./calendar-native/cutover');
            if (cutover.configHasNativeBooking(config)) throw e;
        }

        // 3. Image moderation (if configured)
        if (typeof ai.moderateImages === 'function' && imageBuffers.length > 0) {
            let verdict;
            try {
                verdict = await ai.moderateImages(imageBuffers, 'ro');
            } catch (e) {
                log('webpublish.moderation_error', { err: e.message, siteId: site.id }, 'error');
                // transient failure — don't block publication
            }
            if (verdict && verdict.blocked) {
                const err = new Error(verdict.reason || 'Your images did not pass moderation.');
                err.code = 'MODERATION';
                throw err;
            }
        }

        // 3b. F5/prof-06: derive canonical/og:url + LocalBusiness JSON-LD
        // automatically — must happen before build() renders the template's
        // `@if seo.canonical` / `@if seo.jsonLd` guards. canonical uses the
        // predicted origin when deterministic, else the placeholder that gets
        // corrected post-deploy (see 6b below); jsonLd/canonical are only
        // filled when not already set, so a Telegram-drafted config (which
        // already carries real jsonLd, and never sets canonical) is never
        // overwritten.
        cfgCopy.seo = (cfgCopy.seo && typeof cfgCopy.seo === 'object') ? cfgCopy.seo : {};
        if (!cfgCopy.seo.canonical) {
            cfgCopy.seo.canonical = `${seoBuildOrigin}/`;
        }
        if (!cfgCopy.seo.jsonLd) {
            cfgCopy.seo.jsonLd = buildLocalBusinessJsonLd(cfgCopy);
        }

        // 4. Write config.json and build
        fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify(cfgCopy, null, 2));
        build(siteDir);
    } else {
        // Files already on disk — just verify the directory exists
        if (!fs.existsSync(siteDir)) {
            const err = new Error(`siteDir not found: ${siteDir}`);
            err.code  = 'SITE_DIR_MISSING';
            throw err;
        }
    }

    // 5. Isolated live oracle: make local seed photos load before inspection.
    prepareIsolatedLiveHtml(siteDir);

    // 5b. F3: absolutize og:image/twitter:image ahead of deploy when the final
    // host is deterministic (isolated /live/ or BRAND_DOMAIN+cloudflare) so the
    // copy that actually gets served/uploaded already has the fix.
    const indexPath = path.join(siteDir, 'index.html');
    try {
        absolutizeSocialImageMeta(indexPath, predictedPublicOrigin(slugForUrl));
    } catch (e) {
        log('webpublish.social_image.predeploy_failed', { siteId: site.id, err: e.message }, 'warn');
    }

    // 5c. F6: robots.txt + sitemap.xml — written for every publish (both
    // build branches, so a siteDirAlreadyBuilt republish still gets them even
    // if the directory predates this fix), using the same predicted-origin/
    // placeholder rule as F5 above; corrected post-deploy alongside it.
    try {
        const seoPages = ['index.html'];
        for (const p of ['privacy.html', 'terms.html', 'cookies.html']) {
            if (fs.existsSync(path.join(siteDir, p))) seoPages.push(p);
        }
        const { robotsTxt, sitemapXml } = siteExport.buildSeoFiles(seoBuildOrigin, seoPages);
        fs.writeFileSync(path.join(siteDir, 'robots.txt'), robotsTxt, 'utf8');
        fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), sitemapXml, 'utf8');
    } catch (e) {
        log('webpublish.seo_files.predeploy_failed', { siteId: site.id, err: e.message }, 'warn');
    }

    // 6. Deploy
    let url;
    let deployProvider;
    try {
        const result = await _deploy(siteDir, site.projectName, site.userId, {
            slug: slugForUrl,
        });
        url = result && result.url;
        deployProvider = result && result.provider;
    } catch (e) {
        try { registry.updateSite(site.id, { status: 'needs-retry' }); } catch (_) {}
        throw e;
    }

    if (!url) {
        registry.updateSite(site.id, { status: 'needs-retry' });
        throw new Error('The hosting provider did not return a URL.');
    }

    // 6b. F3/F5/F6 fallback: for providers whose host is only known after
    // deploy (plain Cloudflare Pages / Vercel / Netlify without
    // BRAND_DOMAIN), the pre-deploy passes above could not predict it and
    // og:image stayed relative / canonical+robots+sitemap kept the
    // PENDING_SEO_ORIGIN placeholder. Rewrite every occurrence with the real
    // origin now and, only if that actually changed something on a genuine
    // remote push, redeploy once so the LIVE copy also carries the
    // correction (not just local disk). Best-effort: never blocks or fails
    // the publish itself. No-op for isolated/fake (already correct, or
    // nothing external to re-push).
    try {
        const fixedImage    = absolutizeSocialImageMeta(indexPath, url);
        const finalOrigin   = String(url || '').replace(/\/$/, '');
        const fixedCanonical = rewriteOriginInFile(indexPath, seoBuildOrigin, finalOrigin);
        const fixedRobots   = rewriteOriginInFile(path.join(siteDir, 'robots.txt'), seoBuildOrigin, finalOrigin);
        const fixedSitemap  = rewriteOriginInFile(path.join(siteDir, 'sitemap.xml'), seoBuildOrigin, finalOrigin);
        const anyFixed = fixedImage || fixedCanonical || fixedRobots || fixedSitemap;
        if (anyFixed && deployProvider && deployProvider !== 'isolated' && deployProvider !== 'fake') {
            await _deploy(siteDir, site.projectName, site.userId, { slug: slugForUrl });
        }
    } catch (e) {
        log('webpublish.seo_files.postdeploy_failed', { siteId: site.id, err: e.message }, 'warn');
    }

    // 7. Mark live
    registry.updateSite(site.id, { status: 'live', url, paid: site.paid });
    if (!siteDirAlreadyBuilt && config) {
        const cfgToSave = JSON.parse(JSON.stringify(config || {}));
        // rewrite dataUrls already happened in cfgCopy above; use the saved config.json
        try {
            const saved = JSON.parse(fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8'));
            registry.saveVersion(site.id, saved);
        } catch (_) {
            registry.saveVersion(site.id, cfgToSave);
        }
    }

    try { ledger.append({ event: 'published', siteId: site.id, url, platform: site.platform || 'web' }); } catch (_) {}

    return { url };
}

// ---------------------------------------------------------------------------
// deployPlaceholder — documented no-op (pay-before-publish)
// ---------------------------------------------------------------------------

/**
 * Historical unused expiry-placeholder entry. Product rule is
 * payment before first public publish — no public unpaid hosting and no
 * customer-facing expired-hosting placeholder deploy.
 *
 * Remains exported so legacy require() call sites do not throw. Does not
 * write files, deploy, open payments, change registry status, or store
 * reactivation checkout ids. Does not mutate disk or registry.
 *
 * @param {object} [_site] — ignored
 * @returns {Promise<void>}
 */
async function deployPlaceholder(_site) {
    return;
}

// ---------------------------------------------------------------------------
// handleStripePaid — generalized across platforms
// ---------------------------------------------------------------------------

/**
 * Idempotent: called after Stripe confirms card-on-file / payment for any order (web or telegram).
 * - Accepts checkout.session.completed when payment_status is `paid` OR `no_payment_required`
 *   (subscription trial start — card collected, charge deferred to day 7).
 * - Unpaid / open / missing payment_status must not publish.
 * - Marks order paid once (markOrderPaid returns null if already paid).
 * - Same Stripe event id is claimed once (claimStripeEvent).
 * - First publish: site.paid + paidUntil ≈ now+12 months; deploy newest draft/version immediately.
 * - Renewal: extends paidUntil by 12 months; does not require a second 100 fee or new site.
 * - Notifies owner on owner's channel + concierge domain msg when a deploy happens.
 *
 * @param {object} event            Stripe checkout.session.completed event
 * @param {object} [opts]
 * @param {Function} [opts.messenger]    fn(chatId, text) — Telegram messenger for TG sites
 * @param {Function} [opts.notifyAdmin]  fn(text) — owner notification
 */
async function handleStripePaid(event, { messenger, notifyAdmin } = {}) {
    const cs = event.data && event.data.object;
    if (!cs) return;

    // Card-on-file success: immediate charge OR subscription trial (no charge yet).
    const paymentStatus = cs.payment_status;
    if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
        log('webpublish.stripe_paid.not_card_on_file', {
            sessionId: cs.id,
            paymentStatus: paymentStatus || null,
            eventId: event && event.id,
        });
        return;
    }

    const sessionId = cs.id;
    const eventId   = event && event.id;

    // Session-level: markOrderPaid returns null if already paid or unknown
    const order = registry.markOrderPaid(sessionId);
    if (!order) {
        log('webpublish.stripe_paid.already_handled', { sessionId, eventId });
        return;
    }

    // Event-level bookkeeping after a successful paid transition (duplicate event ids)
    if (eventId && typeof registry.claimStripeEvent === 'function') {
        registry.claimStripeEvent(eventId);
    }

    // First-then-renewal: attach Subscription Schedule so year-2+ bills RENEWAL_CENTS.
    // Checkout only has the first-period Price; metadata alone does not change invoices.
    try {
        await maybeAttachRenewalSchedule(cs);
    } catch (e) {
        log('webpublish.stripe_paid.schedule_attach_failed', {
            sessionId,
            err: e && e.message,
            subscription: cs.subscription || null,
        }, 'error');
    }

    const siteId  = (cs.metadata && cs.metadata.siteId) || order.siteId;
    const orderId = order.id;
    const kind    = (cs.metadata && cs.metadata.kind) || order.kind || 'publish';

    if (!siteId) {
        log('webpublish.stripe_paid.no_site_id', { sessionId, orderId }, 'error');
        return;
    }

    const site = registry.getSite(siteId);
    if (!site) {
        log('webpublish.stripe_paid.no_site', { siteId, orderId }, 'error');
        return;
    }

    // Persist Stripe customer + subscription so cancel webhooks can unpublish.
    _storeStripeBillingIds(siteId, cs);

    // Owner notification
    if (typeof notifyAdmin === 'function') {
        notifyAdmin(`💰 Payment confirmed! Site: ${site.slug || site.projectName} (${site.platform || 'web'}) kind=${kind}`);
    }

    // ── Renewal: extend hosting year; do not re-run first-publish fee path ──
    if (kind === 'renewal') {
        const baseIso = site.paidUntil && Date.parse(site.paidUntil) > Date.now()
            ? site.paidUntil
            : new Date().toISOString();
        const paidUntil = registry.addMonthsIso(baseIso, 12);
        try {
            registry.updateSite(siteId, { paid: true, paidUntil });
        } catch (_) {}
        log('webpublish.stripe_paid.renewed', { siteId, orderId, paidUntil });
        // If expired, republish last version so the site is live again
        const fresh = registry.getSite(siteId);
        if (fresh && fresh.status === 'expired') {
            const versions = registry.listVersions(siteId);
            if (versions.length > 0) {
                const last = versions[versions.length - 1];
                const lastConfig = registry.getVersionConfig(siteId, last.versionId);
                if (lastConfig) {
                    try {
                        const result = await module.exports.publishSite({
                            site: { ...fresh, paid: true },
                            config: lastConfig,
                            images: [],
                            siteDirAlreadyBuilt: false,
                        });
                        registry.updateSite(siteId, { status: 'live', url: result.url, paid: true, paidUntil });
                        _notifyOwnerChannel({ ...fresh, paid: true }, result.url, messenger, notifyAdmin);
                        log('webpublish.stripe_paid.renewal_reactivated', { siteId, orderId, url: result.url });
                    } catch (e) {
                        log('webpublish.stripe_paid.renewal_reactivate_failed', { siteId, orderId, err: e.message }, 'error');
                        registry.updateSite(siteId, { status: 'needs-retry', paid: true, paidUntil });
                    }
                }
            }
        }
        return;
    }

    // ── First publish / reactivation payment ───────────────────────────────
    const paidUntil = registry.addMonthsIso(new Date().toISOString(), 12);
    try {
        registry.updateSite(siteId, { paid: true, paidUntil });
    } catch (_) {}

    const paidSite = { ...registry.getSite(siteId), paid: true, paidUntil };

    // If reactivation (hosting expired / status === 'expired'): republish last version
    if (site.status === 'expired') {
        const versions = registry.listVersions(siteId);
        if (versions.length > 0) {
            const lastConfig = registry.getVersionConfig(siteId, versions[versions.length - 1].versionId)
                            || registry.getVersionConfig(siteId, versions[0].versionId);
            if (lastConfig) {
                try {
                    const result = await module.exports.publishSite({
                        site: paidSite,
                        config: lastConfig,
                        images: [],
                        siteDirAlreadyBuilt: false,
                    });
                    registry.updateSite(siteId, { status: 'live', url: result.url, paid: true, paidUntil });
                    _notifyOwnerChannel(paidSite, result.url, messenger, notifyAdmin);
                    log('webpublish.stripe_paid.reactivated', { siteId, orderId, url: result.url });
                } catch (e) {
                    log('webpublish.stripe_paid.reactivate_failed', { siteId, orderId, err: e.message }, 'error');
                    registry.updateSite(siteId, { status: 'needs-retry' });
                }
                return;
            }
        }
        log('webpublish.stripe_paid.no_version_for_reactivation', { siteId, orderId }, 'error');
        registry.updateSite(siteId, { status: 'needs-retry' });
        return;
    }

    // Prefer newest of pending draft vs last saved version (edit-latest)
    const payload = resolvePublishPayload(siteId, orderId);
    if (payload) {
        try {
            const result = await module.exports.publishSite({
                site: paidSite,
                config: payload.config,
                images: payload.images || [],
                siteDirAlreadyBuilt: !!payload.siteDirAlreadyBuilt,
            });
            deletePendingDraft(orderId);
            _notifyOwnerChannel(paidSite, result.url, messenger, notifyAdmin);
            log('webpublish.stripe_paid.published', {
                siteId, orderId, url: result.url, source: payload.source,
            });
        } catch (e) {
            log('webpublish.stripe_paid.publish_failed', { siteId, orderId, err: e.message }, 'error');
        }
        return;
    }

    log('webpublish.stripe_paid.no_draft_no_version', { orderId, siteId }, 'error');
    registry.updateSite(siteId, { status: 'needs-retry' });
}

/**
 * Persist Stripe customer + subscription ids on the site after checkout completes.
 * Offline HIDOOK_TEST_PAY may still pass synthetic ids on the session object.
 * @param {string} siteId
 * @param {object} cs checkout.session
 */
function _storeStripeBillingIds(siteId, cs) {
    if (!siteId || !cs) return;
    const customerId = typeof cs.customer === 'string'
        ? cs.customer
        : (cs.customer && cs.customer.id);
    const subscriptionId = typeof cs.subscription === 'string'
        ? cs.subscription
        : (cs.subscription && cs.subscription.id);
    // Offline trial path: synthesize stable ids when missing so cancel tests can wire up.
    let subId = subscriptionId;
    let custId = customerId;
    if (!subId && process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production') {
        subId = 'sub_test_' + String(cs.id || siteId).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
    }
    if (!custId && process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production') {
        custId = 'cus_test_' + String(cs.id || siteId).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
    }
    if (!subId && !custId) return;
    const patch = {};
    if (custId) patch.stripeCustomerId = custId;
    if (subId) patch.stripeSubscriptionId = subId;
    try {
        registry.updateSite(siteId, patch);
    } catch (e) {
        log('webpublish.stripe_paid.store_billing_ids_failed', { siteId, err: e.message }, 'warn');
    }
}

/**
 * When checkout completed a first_then_renewal subscription, attach the
 * 99-then-29 Subscription Schedule (phase 0 = first year, phase 1 = renewal).
 * No-ops for pure renewal, offline test pay without a subscription id, or
 * sessions that already lack billing_contract=first_then_renewal.
 *
 * @param {object} cs  checkout.session object from the Stripe event
 * @returns {Promise<object|null>}
 */
async function maybeAttachRenewalSchedule(cs) {
    if (!cs) return null;
    const meta = cs.metadata || {};
    const contractKind = meta.billing_contract || meta.billingContract || '';
    const kind = meta.kind || '';
    // Skip pure hosting renewals and anything not marked first_then_renewal.
    if (kind === 'renewal' || contractKind === 'renewal') return null;
    if (contractKind && contractKind !== 'first_then_renewal') return null;

    const subscriptionId = typeof cs.subscription === 'string'
        ? cs.subscription
        : (cs.subscription && cs.subscription.id);
    // Offline HIDOOK_TEST_PAY sessions have no real subscription — skip quietly
    // unless test-pay is on and we still want an offline schedule record.
    if (!subscriptionId) {
        if (process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production') {
            return payments.attachFirstThenRenewalSchedule({
                subscriptionId: 'sub_test_' + String(cs.id || 'offline'),
                currency: (cs.currency || meta.currency || 'eur'),
                productName: 'Hidook Site Builder',
                contract: {
                    firstPeriodCents: Number(meta.first_period_cents) || pricing.PRICE_CENTS,
                    renewalCents: Number(meta.renewal_cents) || pricing.RENEWAL_CENTS,
                    trialDays: payments.SUBSCRIPTION_TRIAL_DAYS,
                    interval: 'year',
                },
                renewalPriceId: meta.renewal_price_id || null,
            });
        }
        // Without a subscription id and without first_then_renewal marker, nothing to do.
        // If metadata says first_then_renewal but sub missing, still try only when marked.
        if (contractKind !== 'first_then_renewal') return null;
        return null;
    }

    // Default to attaching when we have a subscription on a publish checkout
    // (missing billing_contract still gets schedule when first publish — safe).
    if (contractKind !== 'first_then_renewal' && kind === 'renewal') return null;

    const firstCents = Number(meta.first_period_cents) || pricing.PRICE_CENTS;
    const renewCents = Number(meta.renewal_cents) || pricing.RENEWAL_CENTS;
    if (firstCents === renewCents) return null;

    const result = await payments.attachFirstThenRenewalSchedule({
        subscriptionId,
        currency: (cs.currency || meta.currency || 'eur'),
        productName: 'Hidook Site Builder',
        contract: {
            firstPeriodCents: firstCents,
            renewalCents: renewCents,
            trialDays: payments.SUBSCRIPTION_TRIAL_DAYS,
            interval: 'year',
        },
        renewalPriceId: meta.renewal_price_id || payments.resolveStripeRenewalPriceId(cs.currency || 'eur'),
    });
    log('webpublish.stripe_paid.schedule_attached', {
        sessionId: cs.id,
        subscriptionId,
        scheduleId: result && result.id,
        offline: !!(result && result.offline),
    });
    return result;
}

/**
 * Notify the site owner on their channel (Telegram or just admin) after payment.
 * Sends the "your own domain" concierge message.
 */
function _notifyOwnerChannel(site, url, messenger, notifyAdmin) {
    const contactUrl = (process.env.CONTACT_URL || '').trim();
    const domainMsg  = contactUrl
        ? `Want your own domain (e.g. yourbusiness.com)? ${contactUrl}`
        : "Want your own domain (e.g. yourbusiness.com)? Contact us and we'll set it up for you.";
    const msg = `✅ Your site is LIVE: ${url}\n\n${domainMsg}`;

    if (site.platform === 'telegram' && site.ownerChatId && typeof messenger === 'function') {
        Promise.resolve().then(() => messenger(String(site.ownerChatId), msg)).catch(() => {});
    }
    if (typeof notifyAdmin === 'function') {
        notifyAdmin(`💰 Site paid + live: ${url} (${site.platform || 'web'})`);
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    publishSite,
    makeLocalSeedImagesEager,
    handleStripePaid,
    handleStripeInvoicePaid,
    handleStripeInvoicePaymentFailed,
    handleStripeSubscriptionEvent,
    unpublishSite,
    findSiteBySubscriptionId,
    deployPlaceholder,
    savePendingDraft,
    loadPendingDraft,
    resolvePublishPayload,
    absolutizeSocialImageMeta,
    predictedPublicOrigin,
    buildLocalBusinessJsonLd,
};
