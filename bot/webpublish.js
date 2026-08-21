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
 *   - deployPlaceholder: deploy a self-contained page for expired legacy trial sites
 *     with a payment/reactivation link.
 *
 * HIDOOK_FAKE_DEPLOY=1 (refused in production) → stub deploy returning
 * {url:'https://<slug>.test.local', provider:'fake'} — for offline tests.
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

const PROJECT_ROOT  = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const SITES_DIR     = path.join(process.env.DATA_DIR || PROJECT_ROOT, 'sites');

const TEMPLATE_EXCLUDES = /^(schema\.json|presets\.json)$|\.md$/i;

// ---------------------------------------------------------------------------
// Fake-deploy stub (tests only)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a data-URL to a Buffer. Returns null if the format is unexpected. */
function decodeDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return null;
    return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

/** Determine the filename for an image slot from the frontend name hint. */
function imageFilename(name) {
    if (!name || typeof name !== 'string') return null;
    const lower = name.toLowerCase().replace(/\s+/g, '-');
    if (lower === 'logo') return 'logo.jpg';
    if (/^gallery-\d+$/.test(lower)) return lower + '.jpg';
    const safe = lower.replace(/[^a-z0-9-]/g, '').slice(0, 40);
    return safe ? safe + '.jpg' : null;
}

/**
 * Recursively walk obj and replace any string value equal to `dataUrl` with `localPath`.
 */
function rewriteDataUrl(obj, dataUrl, localPath) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val === dataUrl) {
            obj[key] = localPath;
        } else if (typeof val === 'object' && val !== null) {
            rewriteDataUrl(val, dataUrl, localPath);
        }
    }
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
 * Respects HIDOOK_FAKE_DEPLOY=1 for offline tests.
 * If DEPLOY_PROVIDER=cloudflare and BRAND_DOMAIN is set, also attaches subdomain (best-effort).
 */
async function _deploy(siteDir, projectName, userId) {
    if (_isFakeDeploy()) {
        return await _fakeDeploy(projectName);
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

    if (!siteDirAlreadyBuilt) {
        fs.mkdirSync(imagesDir, { recursive: true });

        // 1. Copy template files (excluding schema/presets/md)
        const templateDir = path.join(TEMPLATES_DIR, site.templateId);
        if (fs.existsSync(templateDir)) {
            for (const entry of fs.readdirSync(templateDir)) {
                if (TEMPLATE_EXCLUDES.test(entry)) continue;
                const src = path.join(templateDir, entry);
                if (fs.statSync(src).isFile()) {
                    fs.copyFileSync(src, path.join(siteDir, entry));
                }
            }
        }

        // 2. Decode images and write to disk; rewrite src in config
        const imageBuffers = [];
        const cfgCopy = JSON.parse(JSON.stringify(config || {}));

        for (const img of (images || [])) {
            if (!img || !img.dataUrl || !img.name) continue;
            const decoded = decodeDataUrl(img.dataUrl);
            if (!decoded) continue;
            const fname = imageFilename(img.name);
            if (!fname) continue;
            fs.writeFileSync(path.join(imagesDir, fname), decoded.buffer);
            imageBuffers.push(decoded.buffer);
            rewriteDataUrl(cfgCopy, img.dataUrl, 'images/' + fname);
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
                const err = new Error(verdict.reason || 'Imaginile nu au trecut moderarea.');
                err.code = 'MODERATION';
                throw err;
            }
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

    // 5. Deploy
    let url;
    try {
        const result = await _deploy(siteDir, site.projectName, site.userId);
        url = result && result.url;
    } catch (e) {
        registry.updateSite(site.id, { status: 'needs-retry' });
        throw e;
    }

    if (!url) {
        registry.updateSite(site.id, { status: 'needs-retry' });
        throw new Error('Furnizorul de deploy nu a returnat un URL.');
    }

    // 6. Mark live
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
// deployPlaceholder
// ---------------------------------------------------------------------------

/**
 * Deploy a self-contained branded placeholder page for an expired trial site.
 * The page includes a payment/reactivation link.
 *
 * @param {object} site   — registry site record (must have site.id, site.projectName)
 * @returns {Promise<{url: string}>}
 */
async function deployPlaceholder(site) {
    const siteDir = path.join(SITES_DIR, site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });

    // Generate a checkout/reactivation link
    let paymentUrl = null;
    try {
        const payments = require('./payments.js');
        if (payments.isConfigured()) {
            const pricing   = require('./pricing.js');
            const p         = pricing.getPricing();
            const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
            const checkout = await payments.createCheckout({
                amountCents: p.amountCents,
                currency:    p.currency,
                productName: 'Reactivare site Hidook',
                successUrl:  publicUrl + '/app/#platit',
                cancelUrl:   publicUrl + '/app/#anulat',
                metadata: { platform: 'web', siteId: site.id, reactivate: '1' },
                clientReferenceId: 'reactivate-' + site.id,
            });
            paymentUrl = checkout.url;
            // Persist latest checkout session for this site
            registry.updateSite(site.id, { reactivateSessionId: checkout.id });
        }
    } catch (e) {
        log('webpublish.placeholder.checkout_error', { siteId: site.id, err: e.message }, 'warn');
    }

    const bizName = _getBizName(site);
    const payBtn = paymentUrl
        ? `<a href="${paymentUrl}" class="btn">Reactivează site-ul</a>`
        : '<p class="sub">Contactați-ne pentru reactivare.</p>';

    const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(bizName)} — Perioadă de probă expirată</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f7f3f0;color:#333;
       display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
  .card{background:#fff;border-radius:16px;padding:48px 32px;max-width:480px;
        box-shadow:0 4px 32px rgba(0,0,0,.1)}
  h1{font-size:1.4rem;margin-bottom:8px}
  .sub{color:#777;font-size:.95rem;margin-bottom:24px}
  .btn{display:inline-block;background:#E8588C;color:#fff;text-decoration:none;
       padding:14px 32px;border-radius:8px;font-weight:600;font-size:1rem}
  .btn:hover{background:#d14477}
  .brand{margin-top:32px;font-size:.75rem;color:#bbb}
</style>
</head>
<body>
<div class="card">
  <h1>${_esc(bizName)}</h1>
  <p class="sub">Perioada de acces a expirat.</p>
  <p class="sub">Plătește pentru a-ți reactiva site-ul și 12 luni de hosting gestionat.</p>
  ${payBtn}
  <div class="brand">Hidook · site builder</div>
</div>
</body>
</html>`;

    fs.writeFileSync(path.join(siteDir, 'index.html'), html, 'utf8');

    // Deploy
    let url;
    try {
        const result = await _deploy(siteDir, site.projectName, site.userId);
        url = result && result.url;
    } catch (e) {
        log('webpublish.placeholder.deploy_error', { siteId: site.id, err: e.message }, 'error');
        throw e;
    }

    if (!url) {
        throw new Error('Placeholder deploy nu a returnat un URL.');
    }

    registry.updateSite(site.id, { status: 'expired', url });
    try { ledger.append({ event: 'placeholder_deployed', siteId: site.id, url }); } catch (_) {}

    return { url };
}

/** Extract business name from site metadata (best-effort). */
function _getBizName(site) {
    if (site.businessName) return site.businessName;
    // Try reading config from last saved version
    try {
        const siteDir = path.join(SITES_DIR, site.projectName);
        const cfg = JSON.parse(fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8'));
        return (cfg && cfg.business && cfg.business.name) || site.projectName;
    } catch (_) {}
    return site.projectName || 'Site';
}

/** HTML-escape a string. */
function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// handleStripePaid — generalized across platforms
// ---------------------------------------------------------------------------

/**
 * Idempotent: called after Stripe confirms payment for any order (web or telegram).
 * - Marks order paid once (markOrderPaid returns null if already paid).
 * - Same Stripe event id is claimed once (claimStripeEvent).
 * - First publish payment: site.paid + paidUntil ≈ now+12 months; deploy newest draft/version.
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

    // Owner notification
    if (typeof notifyAdmin === 'function') {
        notifyAdmin(`💰 Plată confirmată! Site: ${site.slug || site.projectName} (${site.platform || 'web'}) kind=${kind}`);
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

    // If reactivation (expired trial): republish last version
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
 * Notify the site owner on their channel (Telegram or just admin) after payment.
 * Sends the "domeniu propriu" concierge message.
 */
function _notifyOwnerChannel(site, url, messenger, notifyAdmin) {
    const contactUrl = (process.env.CONTACT_URL || '').trim();
    const domainMsg  = contactUrl
        ? `Vrei domeniul tău propriu (ex: firma-ta.ro)? ${contactUrl}`
        : 'Vrei domeniul tău propriu (ex: firma-ta.ro)? Scrie-ne și îl setăm noi pentru tine.';
    const msg = `✅ Site-ul tău e LIVE: ${url}\n\n${domainMsg}`;

    if (site.platform === 'telegram' && site.ownerChatId && typeof messenger === 'function') {
        Promise.resolve().then(() => messenger(String(site.ownerChatId), msg)).catch(() => {});
    }
    if (typeof notifyAdmin === 'function') {
        notifyAdmin(`💰 Site plătit + live: ${url} (${site.platform || 'web'})`);
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    publishSite,
    handleStripePaid,
    deployPlaceholder,
    savePendingDraft,
    loadPendingDraft,
    resolvePublishPayload,
};
