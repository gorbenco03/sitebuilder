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
 *   - handleStripeSubscriptionEvent: persist subscription lifecycle status from
 *     both customer.subscription.created and .updated; either with status one
 *     of canceled/cancelled/unpaid/incomplete_expired → unpublishSite
 *     (idempotent). PC-03: 'unpaid' is Stripe's terminal dunning state (all
 *     retries exhausted) and can persist indefinitely without ever sending
 *     .deleted, so it must be a trigger on its own, not just canceled/deleted.
 *     Other statuses (active, trialing, past_due) only update the stored
 *     status — no unpublish, no new grace-window state invented.
 *     Wave7: .created is handled the same way as .updated (not just ignored)
 *     so stripeSubscriptionStatus is populated the moment Stripe creates the
 *     subscription, not only on its first later transition. Without this, a
 *     subscription whose status never changes after creation (the common
 *     case — e.g. trial_period_days=0 straight to 'active') would leave
 *     stripeSubscriptionStatus empty forever, which is exactly the blind spot
 *     canStartRenewalCheckout() below depends on NOT having: an empty status
 *     cannot be told apart from "no subscription exists", so the orphaned-
 *     double-billing guard would never fire on it (audit finding #8).
 *   - canStartRenewalCheckout: refuses to let a site open a second Checkout
 *     Session while Stripe still considers an existing subscription current
 *     (active/trialing/past_due) — see HANDOFF-payments.md for the exact
 *     bot/server.js call site.
 *   - reconcileSiteFromStripe: when a site's local paidUntil looks expired but
 *     it still has a stripeSubscriptionId, asks Stripe directly whether the
 *     subscription is actually still active/trialing and heals paidUntil from
 *     Stripe's own current_period_end — the fix for a dashboard that would
 *     otherwise say "Expirat" on a paying customer because of webhook lag.
 *   - unpublishSite: stop serving isolated $DATA_DIR/published/<slug>/; registry not live.
 *   - handleStripeInvoicePaymentFailed: BE-06/Wave7 — records a failed dunning
 *     attempt (ledger + best-effort owner notification, now including
 *     Stripe's own next_payment_attempt so the message is concrete: which
 *     attempt this is and when the next one lands) and never unpublishes;
 *     'past_due' stays live while Stripe retries, and the existing
 *     unpaid/incomplete_expired path above is what eventually unpublishes —
 *     which is where the site actually goes dark. getDunningState() below is
 *     the read side: what a dashboard renders from a site record alone.
 *   - getDunningState / getInvoiceHistory: Wave7 read helpers for the owner
 *     dashboard (a route/UI change server.js/builder own — see
 *     HANDOFF-payments.md). Invoice history is sourced from the durable
 *     ledger 'invoice' entries this module now appends on every successful
 *     charge (test-pay and real Stripe alike), so it is provable without real
 *     Stripe credentials.
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
 * - customer.subscription.created / .updated with status=canceled → unpublish
 * - customer.subscription.created / .updated with status one of
 *   unpaid/incomplete_expired → unpublish (PC-03 terminal dunning failure)
 * - other customer.subscription.created / .updated statuses → persist for
 *   entitlement checks (and for canStartRenewalCheckout's orphaned-double-
 *   billing guard — see Wave7 note on .created in the file-level docblock)
 * Idempotent via unpublishSite.
 *
 * @param {object} event Stripe event
 * @param {{notifyAdmin?: Function}} [opts] fn(text) — best-effort owner
 *   notification, called only when this event just took the site's public
 *   entitlement away because Stripe gave up on the card (unpaid /
 *   incomplete_expired) — the "your site is now dark" case the owner must
 *   never be surprised by. Not called for a customer-initiated cancel (they
 *   already know — they clicked Cancel in the portal).
 * @returns {Promise<object|null>}
 */
async function handleStripeSubscriptionEvent(event, { notifyAdmin } = {}) {
    if (!event || !event.type) return null;
    const type = event.type;
    const sub = event.data && event.data.object;
    if (!sub || !sub.id) return null;

    const status = String(sub.status || '').toLowerCase();
    const isDeleted = type === 'customer.subscription.deleted';
    // Wave7: .created is handled identically to .updated for persistence and
    // for the (unlikely but not impossible) case Stripe hands us an already-
    // terminal status at creation time. See the file-level docblock.
    const isLifecycleEvent =
        type === 'customer.subscription.updated' ||
        type === 'customer.subscription.created';
    const isCanceledUpdate =
        isLifecycleEvent &&
        (status === 'canceled' || status === 'cancelled');
    // PC-03: 'unpaid' is Stripe's terminal state once every dunning retry has
    // failed — it can stay 'unpaid' forever without ever firing .deleted.
    // 'incomplete_expired' is the equivalent terminal failure for a
    // subscription whose very first invoice never got paid. Both must
    // unpublish; no other status (active/trialing/past_due) does.
    const isUnpaidUpdate =
        isLifecycleEvent &&
        (status === 'unpaid' || status === 'incomplete_expired');

    if (!isDeleted && (!isLifecycleEvent || !status)) {
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

    // Event-level claim (duplicate webhooks). unpublishSite() below stays
    // idempotent and runs on every delivery (in case a prior run's registry
    // write partially applied), but a NOTIFICATION is not idempotent from the
    // owner's point of view — Wave10 fix: a duplicate delivery of the same
    // eventId used to still call notifyAdmin again (the old code only logged
    // "already_handled" and fell through), which would have sent the same
    // "site oprit" Telegram message — and now email — more than once for one
    // real-world failure. firstDelivery gates every notification below.
    const eventId = event.id;
    let firstDelivery = true;
    if (eventId && typeof registry.claimStripeEvent === 'function') {
        firstDelivery = registry.claimStripeEvent(eventId);
        if (!firstDelivery) {
            log('webpublish.subscription.already_handled', { eventId, siteId: site.id });
        }
    }

    if (isDeleted || isCanceledUpdate || isUnpaidUpdate) {
        const result = unpublishSite(site, {
            reason: isDeleted
                ? 'subscription_deleted'
                : (isCanceledUpdate ? 'subscription_canceled' : `subscription_${status}`),
            subscriptionId: sub.id,
            subscriptionStatus: status || 'canceled',
        });
        // Wave7: the owner must never be surprised by their site going dark.
        // isUnpaidUpdate is the ONE path here that is not the owner's own
        // action (they didn't click Cancel) — Stripe exhausted every dunning
        // retry and gave up. That is exactly the moment a silent unpublish is
        // unacceptable, so notify (best-effort; web-only deployments have no
        // Telegram channel — Wave10 adds a real email channel below).
        // firstDelivery: exactly once per Stripe event, never on a replay.
        if (isUnpaidUpdate && firstDelivery && result) {
            if (typeof notifyAdmin === 'function') {
                try {
                    notifyAdmin(
                        `🔴 Site oprit: „${site.slug || site.projectName}” nu mai este public. ` +
                        `Stripe a renunțat la reîncercări după eșecul repetat al plății (status abonament: ${status}). ` +
                        'Adaugă un card nou din tabloul de bord ca să repornești site-ul — hostingul rămâne al tău, doar plata a eșuat.'
                    );
                } catch (_) { /* best-effort — never let a notify failure block the unpublish */ }
            }
            try {
                await _notifyOwnerEmail(
                    site,
                    'site_down',
                    buildSiteDownEmailRo(site),
                    { subscriptionId: sub.id, subscriptionStatus: status }
                );
            } catch (_) { /* best-effort — must never turn an unpublish into a thrown error */ }
        }
        return result;
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

// ---------------------------------------------------------------------------
// Wave7 PC-01 follow-up — no second live subscription for a site that has one
// ---------------------------------------------------------------------------
//
// Audit's worst payments finding: a paying customer was labelled "Expirat"
// on the dashboard and pushed into opening a SECOND subscription that billed
// alongside the first. The stale label is one half of that bug (fixed by
// reconcileSiteFromStripe below, which heals paidUntil from Stripe's own
// truth); the other half — nothing ever stopped a renewal Checkout from
// firing while a subscription was still open — is this guard. Both read the
// exact same fields bot/server.js#adminBillingLabel already uses for the
// operator dashboard (stripeSubscriptionStatus / subscriptionStatus), so
// there is one definition of "still has a live subscription", not two.

/**
 * True for a Stripe subscription status under which Stripe still considers
 * the subscription current (see payments.SUBSCRIPTION_ENTITLED_STATUSES).
 * @param {object} site
 * @returns {boolean}
 */
function _hasEntitledSubscriptionStatus(site) {
    const subSt = String(
        (site && (site.stripeSubscriptionStatus || site.subscriptionStatus)) || ''
    ).toLowerCase();
    return !!subSt && payments.SUBSCRIPTION_ENTITLED_STATUSES.has(subSt);
}

/**
 * Wave7 — must be called before opening a Checkout Session for an already-
 * paid site (renewal / reactivation). Refuses when the site's own record
 * says Stripe still considers its subscription current: opening a second
 * Checkout there would create a second live subscription billing alongside
 * the first (audit finding — orphaned double billing), not "fix" an expired
 * one. When stripeSubscriptionStatus is empty (no .created/.updated webhook
 * has landed yet — e.g. HIDOOK_TEST_PAY offline flows, or a first checkout
 * whose webhook hasn't arrived), this allows the checkout: we have no
 * positive signal of a conflicting subscription, and refusing on silence
 * would block every legitimate first reactivation after a real cancel.
 *
 * See HANDOFF-payments.md for the exact bot/server.js#handleSiteCheckout
 * call site — this module cannot enforce it on its own, since the HTTP route
 * lives in a file this agent does not own.
 *
 * @param {object} site
 * @returns {{allowed: boolean, reasonCode?: string, reasonRo?: string}}
 */
function canStartRenewalCheckout(site) {
    if (!site) return { allowed: false, reasonCode: 'NO_SITE' };
    if (!site.paid) return { allowed: true }; // first publish/trial start — no prior subscription to conflict with
    if (_hasEntitledSubscriptionStatus(site)) {
        return {
            allowed: false,
            reasonCode: 'SUBSCRIPTION_STILL_ACTIVE',
            reasonRo: payments.RO_ERRORS.ALREADY_ACTIVE_SUBSCRIPTION,
        };
    }
    return { allowed: true };
}

/**
 * Wave7 — heal a site whose local paidUntil looks expired but Stripe may
 * already have renewed it (webhook lag, or a missed/late invoice.paid
 * delivery). Only touches Stripe when there is a concrete reason to doubt
 * the local state (paid site, has a subscription id, paidUntil is in the
 * past) — never on every dashboard load. HIDOOK_TEST_PAY / no configured key
 * → no-op (nothing to reconcile against; returns the site unchanged), so
 * this is always safe to call unconditionally from a caller like
 * bot/server.js#handleSiteCheckout before applying canStartRenewalCheckout.
 *
 * @param {object} site
 * @returns {Promise<object>} the (possibly updated) site — always a value, never null
 */
async function reconcileSiteFromStripe(site) {
    if (!site || !site.paid || !site.stripeSubscriptionId) return site;
    if (process.env.HIDOOK_TEST_PAY === '1' && process.env.NODE_ENV !== 'production') return site;
    if (!process.env.STRIPE_SECRET_KEY) return site;

    const paidUntilMs = Date.parse(site.paidUntil || '');
    const looksExpired = !Number.isFinite(paidUntilMs) || paidUntilMs <= Date.now();
    if (!looksExpired) return site;

    let sub;
    try {
        sub = await payments.getSubscription(site.stripeSubscriptionId);
    } catch (e) {
        log('webpublish.reconcile.fetch_failed', { siteId: site.id, err: e.message }, 'warn');
        return site;
    }
    if (!sub || !sub.status) return site;

    const status = String(sub.status).toLowerCase();
    const patch = { stripeSubscriptionStatus: status, subscriptionStatus: status };
    if (status === 'active' || status === 'trialing') {
        const periodEndMs = sub.current_period_end ? sub.current_period_end * 1000 : null;
        if (periodEndMs && periodEndMs > Date.now()) {
            patch.paidUntil = new Date(periodEndMs).toISOString();
            if (site.status !== 'live' && site.status !== 'active') patch.status = 'live';
        }
    }
    try {
        registry.updateSite(site.id, patch);
        log('webpublish.reconcile.applied', {
            siteId: site.id, status, paidUntil: patch.paidUntil || null,
        });
    } catch (e) {
        log('webpublish.reconcile.update_failed', { siteId: site.id, err: e.message }, 'error');
        return site;
    }
    return registry.getSite(site.id);
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

    // Wave7 — invoice history: this is the ONE place a real renewal invoice's
    // own Stripe id/hosted URL/PDF link ever reaches this codebase (a first-
    // year subscription_create invoice is deliberately ignored above; that
    // year's record is written by handleStripePaid instead). Best-effort —
    // never let a ledger write turn a successful renewal into a failure.
    try {
        ledger.append({
            event: 'invoice',
            siteId: site.id,
            subscriptionId,
            kind: 'renewal',
            invoiceId: invoice.id || null,
            amountCents: invoice.amount_paid != null ? invoice.amount_paid : null,
            currency: invoice.currency || null,
            hostedInvoiceUrl: invoice.hosted_invoice_url || null,
            invoicePdf: invoice.invoice_pdf || null,
        });
    } catch (_) {}

    log('webpublish.invoice_paid.renewed', { siteId: site.id, subscriptionId, invoiceId: invoice.id || null, paidUntil });
    return registry.getSite(site.id);
}

/**
 * BE-06/Wave7 — invoice.payment_failed was never handled at all: a
 * subscription whose charge got declined stayed live indefinitely with
 * nobody told. Stripe already flips the subscription's `status` to
 * `past_due` around the same time, which handleStripeSubscriptionEvent
 * persists without unpublishing (past_due is a recoverable dunning state —
 * Stripe keeps retrying the charge on its own schedule; 'unpaid'/
 * 'incomplete_expired' are the terminal failures that already unpublish, and
 * notify — see the isUnpaidUpdate branch above) — so this handler
 * deliberately does NOT unpublish or invent a second, competing entitlement
 * rule. Its job is the other half: make the failure visible instead of
 * silent, with enough detail for the owner to actually act — append it to
 * the durable ledger (bot/ledger.js), persist it on the site record so a
 * dashboard can read it directly (getDunningState below), and best-effort
 * notify. `notifyAdmin` is the Telegram admin channel when wired (bot.js);
 * it is always undefined on the web-only deployment (bot/web.js), which
 * currently has no equivalent owner-facing channel — see HANDOFF-payments.md.
 *
 * `paymentFailedAt`/`paymentFailedCount` are on the updateSite() known-field
 * allowlist (bot/registry-shared.js#SITE_EXTRA_FIELDS) as of the storage
 * rewrite, so they now persist on the site record itself — getDunningState()
 * reads them directly rather than scanning the ledger.
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
    // on the site record (see NOTE above). next_payment_attempt (unix
    // seconds) is present while Stripe still has a retry scheduled; it is
    // absent/null once retries are exhausted — the concrete signal
    // getDunningState() needs to tell "still retrying" from "about to go
    // dark" apart in the message it builds.
    const attemptCount = Number(invoice.attempt_count) || 1;
    const nextPaymentAttempt = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : null;
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
            nextPaymentAttempt,
        });
    } catch (_) {}

    log('webpublish.invoice_payment_failed.recorded', {
        siteId: site.id,
        slug: site.slug,
        subscriptionId,
        invoiceId: invoice.id || null,
        attemptCount,
        nextPaymentAttempt,
    }, 'warn');

    if (typeof notifyAdmin === 'function') {
        notifyAdmin(buildDunningNoticeRo(site, { attemptCount, nextPaymentAttempt }));
    }

    // Wave10 — the real owner-facing channel: notifyAdmin above is Telegram
    // only and is always undefined on the production web entry point
    // (bot/web.js). Gated by the same eventId claim as the rest of this
    // function (already returned early above on a duplicate delivery), so
    // this fires exactly once per Stripe event — one email per decline, one
    // per retry, never a resend for a duplicate webhook.
    try {
        await _notifyOwnerEmail(
            site,
            'payment_declined',
            buildPaymentDeclinedEmailRo(site, { attemptCount, nextPaymentAttempt }),
            { attemptCount, nextPaymentAttempt, subscriptionId, invoiceId: invoice.id || null }
        );
    } catch (_) { /* best-effort — must never turn a recorded decline into a thrown error */ }

    return registry.getSite(site.id);
}

/**
 * Wave7 — the Romanian dunning notice sent to the owner on each failed
 * invoice attempt. Pulled out of handleStripeInvoicePaymentFailed so
 * getDunningState() (the dashboard read side) can build the exact same
 * wording from a site record alone, without replaying the webhook.
 * The literal substring "Plată eșuată" is asserted by existing tests — keep
 * it verbatim if this copy changes again.
 *
 * @param {object} site
 * @param {{attemptCount: number, nextPaymentAttempt: string|null}} info
 * @returns {string}
 */
function buildDunningNoticeRo(site, { attemptCount, nextPaymentAttempt }) {
    const label = site.slug || site.projectName || site.id;
    const next = nextPaymentAttempt
        ? `Următoarea reîncercare automată: ${new Date(nextPaymentAttempt).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}. `
        : 'Stripe nu mai are altă reîncercare programată — următorul pas e ca abonamentul să treacă pe "unpaid" și site-ul să se oprească. ';
    return (
        `⚠️ Plată eșuată pentru site-ul "${label}" (id ${site.id}). ` +
        `Încercarea ${attemptCount}. Site-ul rămâne live cât timp abonamentul e "past_due". ` +
        next +
        'Actualizează cardul din portalul de facturare (butonul din tabloul de bord) ca să eviți oprirea site-ului.'
    );
}

// ---------------------------------------------------------------------------
// Wave10 — real owner email for the failing-payment sequence
// ---------------------------------------------------------------------------
//
// The dunning machinery above (record + Telegram notifyAdmin) is correct but
// Telegram-only: bot/web.js (the production entry point, Dockerfile CMD
// `node web.js`) always passes notifyAdmin: undefined, because a web-only
// deployment has no admin chat. A card that quietly expires is the single
// most common way a small business loses its site by accident — they do not
// log in to see a dashboard badge, so a dashboard-only signal is not being
// told anything. This reuses the same transactional-email shape as
// bot/email.js's sendMagicLink (RESEND_API_KEY → real POST to Resend; unset
// → dev-log only, never throws) and the same idempotency spine as the rest
// of this file (registry.claimStripeEvent), so it is provable end-to-end
// under HIDOOK_TEST_PAY/no RESEND_API_KEY without any real Stripe/Resend
// credentials. It is intentionally self-contained here (does not import
// bot/email.js or bot/calendar-native/email/**) — bot/calendar-native/** is
// owned by another agent, and bot/email.js is scoped to sign-in links, not
// commercial-entitlement copy; the pattern (dev fallback, Resend POST, never
// throw) is reused, not the module.

const RESEND_API = 'https://api.resend.com/emails';

/** Best-effort "From" for owner-facing transactional email. */
function _emailFrom() {
    return process.env.EMAIL_FROM || 'onboarding@resend.dev';
}

/**
 * Dashboard URL for "what to click" links in owner email. Same fallback
 * order and same "log the fallback as an error" convention as
 * bot/calendar-native/email/index.js#manageBaseUrl (a dead link in a
 * worried owner's inbox is invisible to the business until they click it),
 * reimplemented here rather than imported since that module is out of scope
 * to edit and this is a two-line rule, not shared state.
 * @returns {string}
 */
function _dashboardUrl() {
    const publicUrl = process.env.PUBLIC_URL;
    if (publicUrl && String(publicUrl).trim()) {
        return String(publicUrl).trim().replace(/\/$/, '') + '/app';
    }
    try {
        log('webpublish.dashboard_url.unconfigured', {
            detail: 'PUBLIC_URL is unset — the link in owner payment-failure email will not resolve',
        }, 'error');
    } catch (_) { /* logging must never block sending */ }
    return 'http://127.0.0.1:0/app';
}

/**
 * The site owner's email address — the same account used to sign in to the
 * dashboard (magic-link auth; registry.getUser(userId).email). Returns null
 * (never throws) when the site has no userId or the user has no email on
 * file (e.g. a Telegram-origin site with no web account), so callers must
 * treat null as "nothing to send to", not as an error.
 * @param {object} site
 * @returns {string|null}
 */
function _ownerEmailForSite(site) {
    if (!site) return null;
    try {
        const userId = site.userId;
        if (!userId) return null;
        const user = registry.getUser(userId);
        if (user && user.email && String(user.email).trim()) {
            return String(user.email).trim();
        }
    } catch (_) { /* registry lookup must never block a notification attempt */ }
    return null;
}

/**
 * Low-level send: RESEND_API_KEY set → real POST to Resend; unset → log-only
 * dev fallback, same contract as bot/email.js#sendMagicLink. Never throws —
 * a failed/misconfigured send must never break webhook processing, which is
 * why every call site below wraps this in its own try/catch as well (belt
 * and suspenders: a bug in this function specifically must not either).
 *
 * @param {{to: string|null, subject: string, text: string, html: string, meta?: object}} msg
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function _sendOwnerEmail({ to, subject, text, html, meta }) {
    if (!to) {
        log('webpublish.owner_email.no_recipient', { meta: meta || null }, 'warn');
        return { sent: false, reason: 'no_recipient' };
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        log('webpublish.owner_email.dev', { to, subject, meta: meta || null });
        return { sent: false, reason: 'dev_no_api_key' };
    }
    try {
        const res = await fetch(RESEND_API, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from: _emailFrom(), to, subject, text, html }),
        });
        if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            log('webpublish.owner_email.error', {
                to, subject, status: res.status, body: bodyText.slice(0, 200), meta: meta || null,
            }, 'error');
            return { sent: false, reason: `resend_http_${res.status}` };
        }
        log('webpublish.owner_email.sent', { to, subject, meta: meta || null });
        return { sent: true };
    } catch (e) {
        log('webpublish.owner_email.exception', { to, subject, err: e.message, meta: meta || null }, 'error');
        return { sent: false, reason: e.message };
    }
}

/** ro-RO long date, e.g. "5 septembrie 2026" — shared by every email below. */
function _formatRoDateLong(iso) {
    const ms = Date.parse(iso || '');
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Shared HTML wrapper — same visual language as bot/email.js#sendMagicLink. */
function _emailHtmlShell({ heading, bodyHtml, dashboardUrl, buttonLabel }) {
    return `
<!DOCTYPE html>
<html lang="ro">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222">
  <h2 style="color:#333">${heading}</h2>
  ${bodyHtml}
  <p style="text-align:center;margin:32px 0">
    <a href="${dashboardUrl}"
       style="background:#E8588C;color:#fff;padding:12px 28px;border-radius:6px;
              text-decoration:none;font-size:16px;display:inline-block">
      ${buttonLabel}
    </a>
  </p>
  <p style="font-size:13px;color:#aaa">
    Sau copiază acest link:<br>
    <a href="${dashboardUrl}" style="color:#aaa;word-break:break-all">${dashboardUrl}</a>
  </p>
</body>
</html>`.trim();
}

/**
 * Wave10 — email #1/#2 in the sequence: a card declined, whether it is the
 * first attempt or a later automatic retry. Two variants share one template:
 * a retry still scheduled (site stays live, concrete date to act by) vs. no
 * retry left (last chance before the terminal 'unpaid' email below fires).
 *
 * @param {object} site
 * @param {{attemptCount: number, nextPaymentAttempt: string|null}} info
 * @returns {{subject: string, text: string, html: string}}
 */
function buildPaymentDeclinedEmailRo(site, { attemptCount, nextPaymentAttempt }) {
    const label = site.slug || site.projectName || site.id;
    const dashboardUrl = _dashboardUrl();
    const hasNext = !!nextPaymentAttempt;
    const nextDate = hasNext ? _formatRoDateLong(nextPaymentAttempt) : '';

    const subject = hasNext
        ? `Card refuzat pentru site-ul „${label}" (încercarea ${attemptCount}) — site-ul rămâne live`
        : `Ultima încercare de plată a eșuat pentru „${label}" — actualizează cardul acum`;

    const whatHappened = hasNext
        ? `Cardul folosit pentru hostingul site-ului „${label}" a fost refuzat la încercarea ${attemptCount}.`
        : `Cardul folosit pentru hostingul site-ului „${label}" a fost refuzat din nou (încercarea ${attemptCount}).`;

    const whatItCosts = hasNext
        ? `Site-ul tău rămâne live. Stripe reîncearcă automat plata — următoarea încercare este pe ${nextDate}. Dacă nici acea încercare nu reușește, site-ul va fi oprit.`
        : 'Stripe nu mai are nicio reîncercare programată. Dacă nu actualizezi cardul, abonamentul va trece pe stare „neplătit" și site-ul tău va fi oprit — vizitatorii nu vor mai putea să-l vadă.';

    const whatToClick = hasNext
        ? `Actualizează cardul din tabloul de bord (secțiunea de facturare) înainte de ${nextDate}, ca să eviți oprirea site-ului.`
        : 'Adaugă un card nou din tabloul de bord chiar acum, ca să eviți oprirea site-ului.';

    const text =
        `Bună,\n\n${whatHappened}\n\n` +
        `Ce se întâmplă acum: ${whatItCosts}\n\n` +
        `Ce trebuie să faci: ${whatToClick}\n\n` +
        `Deschide tabloul de bord: ${dashboardUrl}\n\n` +
        'Dacă ai întrebări, răspunde la acest email.\n\n' +
        '— Hidook Site Builder';

    const html = _emailHtmlShell({
        heading: hasNext ? 'Card refuzat — site-ul rămâne live' : 'Ultima încercare a eșuat',
        bodyHtml:
            `<p>${whatHappened}</p>` +
            `<p><strong>Ce se întâmplă acum:</strong> ${whatItCosts}</p>` +
            `<p><strong>Ce trebuie să faci:</strong> ${whatToClick}</p>`,
        dashboardUrl,
        buttonLabel: 'Actualizează cardul',
    });

    return { subject, text, html };
}

/**
 * Wave10 — email #3 in the sequence: the terminal one, the day the site
 * actually comes down (subscription status unpaid/incomplete_expired —
 * Stripe has given up on every retry). Only ever built for that path, never
 * for a customer-initiated cancel (canceled/deleted) — they already know,
 * they clicked Cancel; see the isUnpaidUpdate-only call site below.
 *
 * @param {object} site
 * @returns {{subject: string, text: string, html: string}}
 */
function buildSiteDownEmailRo(site) {
    const label = site.slug || site.projectName || site.id;
    const dashboardUrl = _dashboardUrl();

    const subject = `Site-ul „${label}" a fost oprit — plata nu a putut fi finalizată`;
    const text =
        `Bună,\n\nSite-ul tău „${label}" NU mai este live. Stripe a încercat de mai multe ori să proceseze ` +
        'plata pentru hosting și toate încercările au eșuat, așa că am oprit publicarea automat.\n\n' +
        'Ce înseamnă asta: vizitatorii primesc acum o pagină inexistentă în locul site-ului tău. ' +
        'Conținutul și configurația site-ului sunt păstrate neschimbate — nu s-a pierdut nimic.\n\n' +
        'Ce trebuie să faci: adaugă un card nou din tabloul de bord ca să repornești site-ul imediat — ' +
        'de îndată ce plata trece, site-ul redevine live automat.\n\n' +
        `Deschide tabloul de bord: ${dashboardUrl}\n\n` +
        '— Hidook Site Builder';

    const html = _emailHtmlShell({
        heading: 'Site-ul a fost oprit',
        bodyHtml:
            `<p>Site-ul tău „${label}" <strong>nu mai este live</strong>. Stripe a încercat de mai multe ori ` +
            'să proceseze plata pentru hosting și toate încercările au eșuat, așa că am oprit publicarea automat.</p>' +
            '<p><strong>Ce înseamnă asta:</strong> vizitatorii primesc acum o pagină inexistentă în locul site-ului tău. ' +
            'Conținutul și configurația site-ului sunt păstrate neschimbate — nu s-a pierdut nimic.</p>' +
            '<p><strong>Ce trebuie să faci:</strong> adaugă un card nou din tabloul de bord ca să repornești site-ul imediat.</p>',
        dashboardUrl,
        buttonLabel: 'Repornește site-ul',
    });

    return { subject, text, html };
}

/**
 * Wave10 — send + durably record one owner notification email. Best-effort
 * end to end (never throws into the caller's webhook handler): a failed or
 * dev-mode send still gets a ledger row (sent:false + reason), so an
 * operator can grep the ledger for "did the owner actually get told" without
 * needing production Resend credentials to prove the attempt happened.
 *
 * @param {object} site
 * @param {'payment_declined'|'site_down'} kind
 * @param {{subject: string, text: string, html: string}} content
 * @param {object} [extra]  extra ledger fields (attemptCount, subscriptionId, …)
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function _notifyOwnerEmail(site, kind, content, extra = {}) {
    const to = _ownerEmailForSite(site);
    let result;
    try {
        result = await _sendOwnerEmail({
            to,
            subject: content.subject,
            text: content.text,
            html: content.html,
            meta: { siteId: site.id, kind },
        });
    } catch (e) {
        result = { sent: false, reason: e.message };
    }
    try {
        ledger.append({
            event: 'owner_notified',
            channel: 'email',
            kind,
            siteId: site.id,
            to: to || null,
            sent: !!result.sent,
            reason: result.reason || null,
            ...extra,
        });
    } catch (_) { /* best-effort — never let a ledger write mask a real send */ }
    return result;
}

/**
 * Wave7 — dashboard read side of dunning: what to show an owner from a site
 * record alone (no webhook replay, no ledger scan). Built from
 * paymentFailedAt/paymentFailedCount and stripeSubscriptionStatus, which
 * GET /api/sites already returns verbatim (bot/server.js#handleGetSites is a
 * plain passthrough of the registry record) — see HANDOFF-payments.md for
 * exactly where builder/app.js should render this.
 *
 * Returns null when there is nothing to show (no failure on record and the
 * subscription is not past_due) — omit rather than invent, same convention
 * as bot/server.js#adminBillingLabel.
 *
 * @param {object} site
 * @returns {{severity:'warning'|'critical', code:string, messageRo:string, attemptCount?:number, lastFailedAt?:string}|null}
 */
function getDunningState(site) {
    if (!site) return null;
    const subSt = String(site.stripeSubscriptionStatus || site.subscriptionStatus || '').toLowerCase();
    const hasFailureOnRecord = !!site.paymentFailedAt;

    if (subSt === 'unpaid' || subSt === 'incomplete_expired') {
        return {
            severity: 'critical',
            code: 'SITE_DOWN_PAYMENT_FAILED',
            messageRo:
                'Site-ul a fost oprit pentru că plata nu a putut fi finalizată după mai multe încercări. ' +
                'Adaugă un card nou din tabloul de bord ca să repornești site-ul.',
        };
    }
    if (subSt === 'past_due' || hasFailureOnRecord) {
        return {
            severity: 'warning',
            code: 'PAYMENT_RETRY_IN_PROGRESS',
            attemptCount: site.paymentFailedCount || 1,
            lastFailedAt: site.paymentFailedAt || null,
            messageRo:
                `Card refuzat la încercarea ${site.paymentFailedCount || 1}. Stripe reîncearcă automat cardul; site-ul rămâne live. ` +
                'Actualizează cardul din portalul de facturare ca să eviți oprirea site-ului.',
        };
    }
    return null;
}

/**
 * Wave7 — invoice history for the owner dashboard (an owner paying yearly
 * previously had no way to see or download past invoices). Reads the
 * durable ledger 'invoice' entries this module appends on every successful
 * charge — handleStripePaid (first year, both HIDOOK_TEST_PAY and real
 * Stripe) and handleStripeInvoicePaid (real-Stripe renewals) — so this is
 * fully provable under HIDOOK_TEST_PAY without any real Stripe credentials.
 * Newest first.
 *
 * @param {object} site
 * @returns {Array<object>}
 */
function getInvoiceHistory(site) {
    if (!site || !site.id) return [];
    return ledger.read()
        .filter((r) => r && r.event === 'invoice' && r.siteId === site.id)
        .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
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

// bot/domains.js requires this module back (to flip the SEO origin the
// moment a custom domain goes active/disconnected — see
// applyCustomDomainOrigin below), so this side of the require loop has to be
// lazy too, same pattern as getDeployBuiltSite() above for bot/flow.js.
function getDomains() { return require('./domains.js'); }

/**
 * Best-effort predicted public origin for a site BEFORE deploy runs.
 *
 * Checked in priority order:
 *   1. Wave 7: an ACTIVE self-serve custom domain (bot/domains.js) always
 *      wins — once an owner's own domain is live, every subsequent
 *      publish/republish must keep canonical/og:url/robots/sitemap pointed
 *      at it, not silently drift back to the Hidook subdomain.
 *   2. HIDOOK_ISOLATED_DEPLOY=1: identical formula to _isolatedDeploy()'s own
 *      return url, so the copy that lands in $DATA_DIR/published/<slug>/ is
 *      already correct.
 *   3. BRAND_DOMAIN + DEPLOY_PROVIDER=cloudflare: identical to the
 *      <slug>.<BRAND_DOMAIN> subdomain _deploy() attaches below.
 * Returns '' when the real host is only known after the deploy call returns
 * (plain Cloudflare Pages / Vercel) — the post-deploy pass in publishSite()
 * covers that case using the actual returned url instead.
 *
 * @param {string} slug
 * @param {{siteId?: string}} [opts]
 * @returns {string}
 */
function predictedPublicOrigin(slug, opts) {
    const siteId = opts && opts.siteId;
    if (siteId) {
        try {
            const activeDomain = getDomains().getActiveDomainForSite(siteId);
            if (activeDomain) return `https://${activeDomain}`;
        } catch (_) {
            // domains.js unavailable/broken must never block a publish.
        }
    }
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
// Wave 7 — flip SEO origin on custom-domain connect/disconnect
// ---------------------------------------------------------------------------

/**
 * Flip a site's SEO origin (canonical/og:url/og:image/robots.txt/sitemap.xml)
 * between its Hidook subdomain and an owner-connected custom domain, then
 * redeploy so the LIVE site matches, not just the on-disk copy. Called from
 * bot/domains.js exactly twice per connection's lifetime: the moment
 * Cloudflare first reports the custom domain active (domain = the new host),
 * and on disconnect (domain = null, restoring fallbackOrigin/the subdomain).
 *
 * Unlike the normal publish-time origin prediction above (predictedPublicOrigin
 * — only fills seo.canonical when it is NOT already set, so a Telegram-drafted
 * canonical is never clobbered), this deliberately OVERWRITES an existing
 * canonical: that is the entire point of a domain connect/disconnect
 * transition, and is why it lives in its own function rather than reusing
 * the "only fill if empty" publish-time logic.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @param {string|null} opts.domain   new custom-domain host, or null to revert.
 * @param {string} [opts.fallbackOrigin]  used only when domain is null and no
 *   better origin can be derived (predictedPublicOrigin() / current site.url).
 * @returns {Promise<{changed: boolean, origin: string|null}>}
 */
async function applyCustomDomainOrigin({ siteId, domain, fallbackOrigin }) {
    const site = registry.getSite(siteId);
    if (!site) throw new Error(`Site not found: ${siteId}`);

    const siteDir     = path.join(SITES_DIR, site.projectName);
    const configPath  = path.join(siteDir, 'config.json');
    if (!fs.existsSync(siteDir) || !fs.existsSync(configPath)) {
        throw new Error(`Built site not found for site ${siteId} — publish it before connecting a domain.`);
    }

    const slugForUrl = site.slug || site.projectName;
    // Strip any trailing slash regardless of source — fallbackOrigin/site.url
    // (registry's stored URL always carries one; predictedPublicOrigin()/the
    // https://<domain> form never do) so seo.canonical's own `${newOrigin}/`
    // below never doubles up into "//".
    const rawNewOrigin = domain
        ? `https://${domain}`
        : (fallbackOrigin || predictedPublicOrigin(slugForUrl) || site.url || null);
    const newOrigin = rawNewOrigin ? String(rawNewOrigin).replace(/\/+$/, '') : null;
    if (!newOrigin) {
        return { changed: false, origin: null };
    }

    let cfg;
    try {
        cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        throw new Error(`Could not read config.json for site ${siteId}: ${e.message}`);
    }
    cfg.seo = (cfg.seo && typeof cfg.seo === 'object') ? cfg.seo : {};
    // Deliberately NOT siteExport.originFromCanonical()'s `new URL().origin`
    // parse: that collapses to scheme+host, dropping any path — fine for that
    // module's own purpose, but wrong here, where the previously-embedded
    // string can legitimately carry a path (predictedPublicOrigin()'s isolated
    // formula is "<PUBLIC_URL>/live/<slug>", not a bare origin). What must be
    // found-and-replaced in the built files is the EXACT string that was
    // written into seo.canonical, byte for byte — same rule
    // rewriteOriginInFile()'s own post-deploy correction already follows.
    const oldOrigin = String(cfg.seo.canonical || '').replace(/\/+$/, '') || site.url || '';

    if (oldOrigin === newOrigin) {
        return { changed: false, origin: newOrigin }; // idempotent — nothing to flip
    }

    cfg.seo.canonical = `${newOrigin}/`;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');

    const indexPath   = path.join(siteDir, 'index.html');
    const robotsPath  = path.join(siteDir, 'robots.txt');
    const sitemapPath = path.join(siteDir, 'sitemap.xml');
    let anyFixed = false;
    if (oldOrigin) {
        // canonical link + og:url share the exact seo.canonical string (see
        // rewriteOriginInFile's own doc comment), and any already-absolutized
        // og:image/twitter:image also embeds oldOrigin — one substring pass
        // across each file fixes all of them together.
        if (rewriteOriginInFile(indexPath, oldOrigin, newOrigin))   anyFixed = true;
        if (rewriteOriginInFile(robotsPath, oldOrigin, newOrigin))  anyFixed = true;
        if (rewriteOriginInFile(sitemapPath, oldOrigin, newOrigin)) anyFixed = true;
    }
    // Covers the (rarer) case where og:image/twitter:image was still
    // relative — e.g. this site was built before F3 ever ran on it.
    if (absolutizeSocialImageMeta(indexPath, newOrigin)) anyFixed = true;

    await _deploy(siteDir, site.projectName, site.userId, { slug: slugForUrl });

    log('webpublish.custom_domain.origin_applied', { siteId, oldOrigin, newOrigin, anyFixed });
    return { changed: true, origin: newOrigin };
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
    const seoBuildOrigin = predictedPublicOrigin(slugForUrl, { siteId: site.id }) || PENDING_SEO_ORIGIN;

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
        absolutizeSocialImageMeta(indexPath, predictedPublicOrigin(slugForUrl, { siteId: site.id }));
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
    //
    // Wave 7 guard: this must ONLY fire when seoBuildOrigin was actually the
    // unresolved placeholder. Once predictedPublicOrigin() DID resolve a real
    // origin ahead of deploy — BRAND_DOMAIN+cloudflare, isolated, or (Wave 7)
    // an ACTIVE custom domain — seoBuildOrigin is deliberately allowed to
    // differ from `url` (the underlying Cloudflare Pages/subdomain host the
    // deploy call itself returns): a custom domain's whole point is to be the
    // public-facing origin while the site keeps deploying to its ordinary
    // host underneath. Correcting "back" to `url` in that case would silently
    // undo domains.js's applyCustomDomainOrigin() on every single republish.
    if (seoBuildOrigin === PENDING_SEO_ORIGIN) {
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

    // Wave7 — invoice history record. This checkout.session.completed IS the
    // first-year charge (subscription_create billing_reason, which
    // handleStripeInvoicePaid deliberately ignores — see its docblock) as
    // well as the HIDOOK_TEST_PAY path for a renewal (offline flows never
    // send a real invoice.paid event). Best-effort: never let a ledger write
    // turn a confirmed payment into a failure.
    try {
        ledger.append({
            event: 'invoice',
            siteId,
            orderId,
            kind,
            invoiceId: (typeof cs.invoice === 'string' ? cs.invoice : (cs.invoice && cs.invoice.id)) || null,
            amountCents: order.amountCents != null ? order.amountCents : null,
            currency: order.currency || null,
        });
    } catch (_) {}

    // Wave7 VAT — best-effort record of what the customer supplied at
    // Checkout for legal-invoice / B2B-reverse-charge bookkeeping (only
    // present when STRIPE_AUTOMATIC_TAX=1 turned on billing_address_collection
    // + tax_id_collection — see payments.js#_automaticTaxEnabled). Absent on
    // HIDOOK_TEST_PAY sessions and on any checkout created before that env
    // flag was on; never blocks or fails the payment confirmation.
    try {
        _recordCheckoutTaxInfo(siteId, cs);
    } catch (_) {}

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
 * Wave7 VAT — best-effort ledger record of what a customer supplied at
 * Checkout for tax/legal-invoice purposes: billing country (for the VAT rate
 * Stripe applied) and any VAT id (for the B2B intra-EU reverse charge).
 * Present only when STRIPE_AUTOMATIC_TAX=1 turned on billing_address_
 * collection + tax_id_collection (see payments.js#_automaticTaxEnabled) —
 * a no-op (nothing appended) otherwise, so this is always safe to call.
 * Never throws.
 *
 * @param {string} siteId
 * @param {object} cs checkout.session
 */
function _recordCheckoutTaxInfo(siteId, cs) {
    if (!siteId || !cs) return;
    const details = cs.customer_details;
    if (!details) return;
    const country = details.address && details.address.country ? details.address.country : null;
    const vatIds = Array.isArray(details.tax_ids)
        ? details.tax_ids.map((t) => ({ type: t.type, value: t.value })).filter((t) => t.value)
        : [];
    if (!country && vatIds.length === 0) return;
    try {
        ledger.append({
            event: 'checkout_tax_info',
            siteId,
            country,
            vatIds,
        });
    } catch (_) {}
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
    // Wave 7 — self-serve custom domain connect (called from bot/domains.js)
    applyCustomDomainOrigin,
    canStartRenewalCheckout,
    reconcileSiteFromStripe,
    getDunningState,
    getInvoiceHistory,
    buildDunningNoticeRo,
    // Wave10 — owner payment-failure email (tests + HANDOFF-payments-notify.md)
    buildPaymentDeclinedEmailRo,
    buildSiteDownEmailRo,
    _dashboardUrl,
    _ownerEmailForSite,
    _sendOwnerEmail,
    _notifyOwnerEmail,
};
