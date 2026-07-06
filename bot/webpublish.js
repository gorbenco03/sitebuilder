'use strict';
/**
 * bot/webpublish.js — Web-platform publish pipeline.
 *
 * Handles:
 *  - publishSite({site, config, images}): decode images, moderate, build, deploy.
 *  - handleStripePaid(event): idempotent post-payment publish triggered by Stripe webhook.
 *
 * CommonJS, zero new npm dependencies, Node 18+.
 */

const fs   = require('fs');
const path = require('path');

const { build }         = require('../build.js');
const { deployBuiltSite } = require('./flow.js');
const registry          = require('./registry.js');
const ledger            = require('./ledger.js');
const ai                = require('./ai.js');
const { log }           = require('./logger.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const SITES_DIR = path.join(process.env.DATA_DIR || PROJECT_ROOT, 'sites');

const TEMPLATE_EXCLUDES = /^(schema\.json|presets\.json)$|\.md$/i;

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
    // gallery-N or any other name
    if (/^gallery-\d+$/.test(lower)) return lower + '.jpg';
    // safe fallback
    const safe = lower.replace(/[^a-z0-9-]/g, '').slice(0, 40);
    return safe ? safe + '.jpg' : null;
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
    fs.writeFileSync(tmp, JSON.stringify(draft), 'utf8');
    fs.renameSync(tmp, file);
}

/** Delete pending draft after successful publish (best-effort). */
function deletePendingDraft(orderId) {
    try {
        const file = path.join(process.env.DATA_DIR || __dirname, `_pending-${orderId}.json`);
        fs.unlinkSync(file);
    } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// publishSite
// ---------------------------------------------------------------------------

/**
 * Build and deploy a site for a web-platform order.
 *
 * @param {object} opts
 * @param {object} opts.site     — registry site record
 * @param {object} opts.config   — site config (tokens/copy, may contain dataUrls in src fields)
 * @param {Array<{name:string, dataUrl:string}>} opts.images — uploaded images
 * @returns {Promise<{url: string}>}
 * @throws if moderation blocks, or deploy fails
 */
async function publishSite({ site, config, images }) {
    const siteDir    = path.join(SITES_DIR, site.projectName);
    const imagesDir  = path.join(siteDir, 'images');
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
    const cfgCopy = JSON.parse(JSON.stringify(config));

    for (const img of (images || [])) {
        if (!img || !img.dataUrl || !img.name) continue;
        const decoded = decodeDataUrl(img.dataUrl);
        if (!decoded) continue;
        const fname = imageFilename(img.name);
        if (!fname) continue;
        fs.writeFileSync(path.join(imagesDir, fname), decoded.buffer);
        imageBuffers.push(decoded.buffer);
        // Rewrite any dataUrl references in config to the local path
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

    // 5. Deploy
    let url;
    try {
        const result = await deployBuiltSite(siteDir, site.projectName, site.userId);
        url = result && result.url;
    } catch (e) {
        await registry.updateSite(site.id, { status: 'needs-retry' });
        throw e;
    }

    if (!url) {
        await registry.updateSite(site.id, { status: 'needs-retry' });
        throw new Error('Furnizorul de deploy nu a returnat un URL.');
    }

    // 6. Mark live
    await registry.updateSite(site.id, { status: 'live', url, paid: site.paid });
    await registry.saveVersion(site.id, cfgCopy);

    try { ledger.append({ event: 'published', siteId: site.id, url, platform: 'web' }); } catch (_) {}

    return { url };
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

// ---------------------------------------------------------------------------
// handleStripePaid
// ---------------------------------------------------------------------------

/**
 * Idempotent: called after Stripe confirms payment for a web-platform order.
 * Reads the pending draft, marks order paid, then publishes.
 *
 * @param {object} event  Stripe checkout.session.completed event
 */
async function handleStripePaid(event) {
    const cs = event.data && event.data.object;
    if (!cs) return;

    // Idempotency: markOrderPaid returns null if already paid
    const order = await registry.markOrderPaid(cs.id);
    if (!order) {
        log('webpublish.stripe_paid.already_handled', { sessionId: cs.id });
        return;
    }

    const siteId  = cs.metadata && cs.metadata.siteId;
    const orderId = order.id;

    if (!siteId) {
        log('webpublish.stripe_paid.no_site_id', { sessionId: cs.id, orderId }, 'error');
        return;
    }

    // Mark the site as paid so future edits publish for free
    try { await registry.updateSite(siteId, { paid: true }); } catch (_) {}

    // Read pending draft saved at /api/publish time
    const draft = loadPendingDraft(orderId);
    if (!draft) {
        log('webpublish.stripe_paid.no_draft', { orderId, siteId }, 'error');
        // Site is paid but we have no draft — mark needs-retry
        try { await registry.updateSite(siteId, { status: 'needs-retry' }); } catch (_) {}
        return;
    }

    const site = await registry.getSite(siteId);
    if (!site) {
        log('webpublish.stripe_paid.no_site', { siteId, orderId }, 'error');
        return;
    }

    try {
        await publishSite({ site: { ...site, paid: true }, config: draft.config, images: draft.images });
        deletePendingDraft(orderId);
        log('webpublish.stripe_paid.published', { siteId, orderId });
    } catch (e) {
        log('webpublish.stripe_paid.publish_failed', { siteId, orderId, err: e.message }, 'error');
        // site status already set to needs-retry inside publishSite
    }
}

module.exports = { publishSite, handleStripePaid, savePendingDraft, loadPendingDraft };
