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
 *   - deployPlaceholder: documented no-op (pay-before-publish; historical unused
 *     expiry-placeholder entry). Kept exported so legacy callers do not throw.
 *
 * HIDOOK_FAKE_DEPLOY=1 (refused in production) → stub deploy returning
 * {url:'https://<slug>.test.local', provider:'fake'} — for offline unit tests.
 *
 * HIDOOK_ISOLATED_DEPLOY=1 (refused in production) → copy built site into
 * $DATA_DIR/published/<slug>/ and return {url: PUBLIC_URL+'/live/'+slug+'/',
 * provider:'isolated'}. Served by GET /live/<slug>/ (same HTTP server).
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
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    if (!publicUrl) throw new Error('PUBLIC_URL is required for isolated deploy');
    return { url: `${publicUrl}/live/${safe}/`, provider: 'isolated' };
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
                } else if (st.isDirectory() && entry === 'images') {
                    fs.mkdirSync(imagesDir, { recursive: true });
                    for (const img of fs.readdirSync(src)) {
                        const from = path.join(src, img);
                        if (fs.statSync(from).isFile()) {
                            fs.copyFileSync(from, path.join(imagesDir, img));
                        }
                    }
                }
            }
        }

        // 2. Decode images and write to disk; rewrite src in config
        const cfgCopy = JSON.parse(JSON.stringify(config || {}));
        const imageBuffers = materializeImages(cfgCopy, imagesDir, images);

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
        const result = await _deploy(siteDir, site.projectName, site.userId, {
            slug: site.slug || site.projectName,
        });
        url = result && result.url;
    } catch (e) {
        try { registry.updateSite(site.id, { status: 'needs-retry' }); } catch (_) {}
        throw e;
    }

    if (!url) {
        registry.updateSite(site.id, { status: 'needs-retry' });
        throw new Error('The hosting provider did not return a URL.');
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
    handleStripePaid,
    deployPlaceholder,
    savePendingDraft,
    loadPendingDraft,
    resolvePublishPayload,
};
