'use strict';
/**
 * bot/flow.js — Orchestrator / state machine for the hidook site builder.
 *
 * Phases:
 *   'chat'   — AI-driven free-form conversation (default when AI is available)
 *   'wizard' — Step-by-step manual wizard (fallback or /wizard command)
 *   'domain' — Client picks a domain name
 *   'pay'    — Stripe checkout; polls until paid
 *   'deploy' — Buy domain + deploy to Vercel + return live URL
 *   'done'   — Terminal state; /start resets
 *
 * All user-visible text is in Romanian.
 *
 * CommonJS, vanilla Node 18+, no new npm dependencies.
 */

const fs   = require('fs');
const path = require('path');

const { build, escapeHtml } = require('../build.js');
const store               = require('./store.js');
const ratelimit           = require('./ratelimit.js');
const { getProvider, polishBusinessData } = require('./ai.js');
// Payment provider: Revolut Merchant API when configured (or PAYMENT_PROVIDER=revolut),
// otherwise fall back to Stripe. Both expose the same interface.
const _payments = (process.env.PAYMENT_PROVIDER || '').toLowerCase() === 'stripe'
    ? require('./payments.js')
    : (require('./revolut.js').isConfigured() ? require('./revolut.js') : require('./payments.js'));
const { isConfigured: stripeOk, createCheckout, pollUntilPaid } = _payments;
const { isConfigured: vercelOk, checkDomain, suggestDomains, buyDomain } = require('./domains.js');
const { isConfigured: vercelDeployOk, deploySite, attachDomain } = require('./deploy-vercel.js');
const { deployToNetlify } = require('./deploy.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.join(__dirname, '..');
// Built sites + temp uploads live on the persistent volume (DATA_DIR) so a paid,
// not-yet-published order survives a Railway redeploy/restart. Falls back to the
// project root for local runs where DATA_DIR is unset.
const SITES_DIR    = path.join(process.env.DATA_DIR || PROJECT_ROOT, 'sites');
const SHARED_FILES = ['template.html', 'styles.css', 'script.js', 'collage.js'];

/** One-time site build fee, in USD cents. Charged for every site (even on vercel.app). Env: BUILD_FEE_USD (default 29). */
const BUILD_FEE_CENTS = Math.round((parseFloat(process.env.BUILD_FEE_USD) || 29) * 100);

/** Optional markup added on top of the domain's wholesale price, in USD. Env: DOMAIN_MARKUP_USD (default 0). */
const DOMAIN_MARKUP_CENTS = Math.round((parseFloat(process.env.DOMAIN_MARKUP_USD) || 0) * 100);

/** Max gallery photos accepted per site (abuse cap). Env: MAX_GALLERY_PHOTOS (default 10). */
const MAX_GALLERY = Number(process.env.MAX_GALLERY_PHOTOS) || 10;

/** Max accepted image size when downloading from Telegram, in bytes. Env: MAX_IMAGE_BYTES (default 8MB). */
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES) || 8 * 1024 * 1024;

/** Telegram bot token (needed to build Telegram deep-link URLs). */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/** Bot @username for checkout return links. Seeded from env; bot.js overrides it at boot via getMe(). */
let botUsername = process.env.BOT_USERNAME || '';
function setBotUsername(u) { if (u) botUsername = String(u).replace(/^@/, ''); }
function getBotUsername() { return botUsername || process.env.BOT_USERNAME || 'hidook_bot'; }

// ---------------------------------------------------------------------------
// Session store (in-memory; chatId → session object)
// ---------------------------------------------------------------------------

// Sessions are restored from disk on boot so a client mid-build survives restarts.
const sessions = new Map(store.loadSessions());

// chatIds with a payment poller currently running (in-memory only) — prevents the
// boot reconciler and the periodic sweeper from launching duplicate pollers.
const activePolls = new Set();

/** A paid-but-unconfirmed checkout is re-polled until this age, then abandoned. Env: PAY_MAX_AGE_MS (default 24h). */
const PAY_MAX_AGE_MS = Number(process.env.PAY_MAX_AGE_MS) || 24 * 3600 * 1000;

/** Persist the current sessions Map (debounced). Called after each handled update. */
function persistSessions() {
    store.scheduleSave(sessions);
}

/** Force a synchronous flush of sessions to disk — used at money-critical transitions
 *  (entering deploy, finishing/deleting an order) so a crash can't lose or replay them. */
function flushSessions() {
    store.flush(sessions);
}

// Owner notifications: bot.js injects a sender so the owner gets a Telegram DM
// on key business events (new site built, payment confirmed). No-op until set.
let adminNotify = null;
function setAdminNotifier(fn) { adminNotify = fn; }
function notifyAdmin(text) {
    if (!adminNotify) return;
    Promise.resolve().then(() => adminNotify(text)).catch(() => {});
}

// Outbound messenger for background flows that have no incoming `ctx` (e.g. the
// boot-time payment reconciler). bot.js injects bot.api.sendMessage.
let sendMessageRaw = null;
function setMessenger(fn) { sendMessageRaw = fn; }
function _ctxShim(chatId) {
    return {
        chat: { id: chatId },
        reply: (text, opts) => (sendMessageRaw ? sendMessageRaw(chatId, text, opts) : Promise.resolve()),
        replyWithChatAction: () => Promise.resolve(),
    };
}

/**
 * Reconcile orders that were mid-flight when the bot last stopped — safe to call at
 * boot AND periodically (the sweeper). Closes the "paid but never delivered" gap that
 * a single in-memory poller can't survive. Per session:
 *   'pay'              → (re)arm the payment poller (unless one already runs), or
 *                        abandon it once the checkout is older than PAY_MAX_AGE_MS.
 *   'deploy' /
 *   'paid-needs-retry' → already paid → resume publishing (idempotent via guards).
 * @returns {number} how many orders it acted on this pass.
 */
function reconcilePending() {
    let n = 0;
    for (const [chatId, session] of sessions) {
        if (!session) continue;
        if (session.phase === 'pay' && session.stripeSessionId) {
            if (session.payStartedAt && Date.now() - session.payStartedAt > PAY_MAX_AGE_MS) {
                session.phase = 'done';      // checkout long expired, never paid → stop polling
                sessions.delete(chatId);
                flushSessions();
                continue;
            }
            if (activePolls.has(chatId)) continue;   // a poller is already watching this one
            n++;
            _pollPaymentBackground(_ctxShim(chatId), session, chatId, session.stripeSessionId);
        } else if (session.phase === 'deploy' || session.phase === 'paid-needs-retry') {
            if (session._publishing) continue;       // a publish is already in flight
            n++;
            _publishAndFinish(_ctxShim(chatId), session, chatId).catch(e => console.error('[reconcile publish]', e));
        }
    }
    if (n) console.log(`[reconcile] resumed ${n} pending order(s)`);
    return n;
}

/**
 * @typedef {Object} Session
 * @property {'chat'|'wizard'|'domain'|'pay'|'deploy'|'done'} phase
 * @property {number} stepIndex  — wizard step index (-1 = not started)
 * @property {Object} data       — wizard key/value answers
 * @property {string[]} gallery  — temp gallery filenames
 * @property {boolean} hasLogo   — logo uploaded?
 * @property {Array<{role:string,content:string}>} conversation — AI chat history
 * @property {Object|null} siteConfig — merged config ready for build
 * @property {string|null} siteDir    — absolute path to built site
 * @property {string|null} siteSlug   — URL-safe slug
 * @property {string|null} domain     — chosen domain
 * @property {number|null} domainPriceUsd
 * @property {string|null} stripeSessionId
 */

function getSession(chatId) {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, _emptySession());
    }
    return sessions.get(chatId);
}

function _emptySession() {
    return {
        phase: 'idle',
        stepIndex: -1,
        data: {},
        gallery: [],
        hasLogo: false,
        conversation: [],
        siteConfig: null,
        siteDir: null,
        siteSlug: null,
        domain: null,
        domainPriceUsd: null,
        stripeSessionId: null,
        projectId: null,   // Vercel project id from the free deploy (to attach custom domain later)
        liveUrl: null,     // the free *.vercel.app URL
    };
}

function resetSession(chatId) {
    // Clean up temp files
    const tmpDir = path.join(SITES_DIR, '_tmp-' + chatId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    sessions.set(chatId, _emptySession());
    return sessions.get(chatId);
}

// ---------------------------------------------------------------------------
// Netlify site-map (re-deploy → same URL)
// ---------------------------------------------------------------------------

const SITES_MAP_FILE = path.join(process.env.DATA_DIR || __dirname, '.sites-map.json');
function loadSitesMap() {
    try { return JSON.parse(fs.readFileSync(SITES_MAP_FILE, 'utf8')); } catch { return {}; }
}
function saveSiteId(chatId, siteId) {
    const m = loadSitesMap();
    m[chatId] = siteId;
    fs.writeFileSync(SITES_MAP_FILE, JSON.stringify(m, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s) {
    return (s || 'site')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'site';
}

/**
 * Download a Telegram photo to destPath.
 * Uses the grammY ctx.getFile() API, then raw fetch.
 */
async function downloadPhoto(ctx, destPath, maxBytes) {
    const file = await ctx.getFile();
    if (maxBytes && file.file_size && file.file_size > maxBytes) {
        const e = new Error('FILE_TOO_LARGE'); e.code = 'FILE_TOO_LARGE'; throw e;
    }
    const url  = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
    const res  = await fetch(url);
    const buf  = Buffer.from(await res.arrayBuffer());
    if (maxBytes && buf.length > maxBytes) {
        const e = new Error('FILE_TOO_LARGE'); e.code = 'FILE_TOO_LARGE'; throw e;
    }
    fs.writeFileSync(destPath, buf);
}

// ---------------------------------------------------------------------------
// Contact normalization helpers
// ---------------------------------------------------------------------------

const isSkip = (v) => !v || !String(v).trim() || String(v).trim().toLowerCase() === 'skip';

/** Validate a #rgb / #rrggbb hex color; return `fallback` for anything else.
 *  Theme colors land inside a <style> block (CSS context), where HTML-escaping does
 *  NOT neutralize injection — so we validate the value instead. */
const HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
function safeHex(v, fallback) {
    return (typeof v === 'string' && HEX_RE.test(v.trim())) ? v.trim() : fallback;
}

/** The mechanical/default theme (also reused as the safe fallback for bad AI colors). */
const DEFAULT_THEME = { primary: '#E8588C', primaryLight: '#f07aa5', primaryDark: '#d14477', cream: '#faf8f8' };

/**
 * Normalize any Instagram input (@handle, handle, instagram.com/handle, full URL)
 * into { handle, url }. Returns null when empty/skip. The handle is reduced to the
 * characters Instagram actually allows (A-Z a-z 0-9 . _), which also neutralizes any
 * attribute-breakout/XSS attempt smuggled through this field.
 */
function normalizeInstagram(input) {
    if (isSkip(input)) return null;
    let h = String(input).trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^(www\.|m\.)/i, '')
        .replace(/^instagram\.com\//i, '')
        .replace(/[/?#].*$/, '')      // drop trailing path / query
        .replace(/^@/, '')
        .replace(/[^A-Za-z0-9._]/g, '')  // keep only valid handle chars (XSS-safe)
        .trim();
    if (!h) return null;
    return { handle: h, url: 'https://instagram.com/' + h };
}

/**
 * Normalize a Facebook input (page name or URL) into { url, label }. null on skip.
 * Always rebuilds a canonical facebook.com URL from a sanitized slug so no raw,
 * attacker-influenced URL is ever reflected into an href.
 */
function normalizeFacebook(input) {
    if (isSkip(input)) return null;
    let s = String(input).trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^(www\.|m\.)/i, '')
        .replace(/^facebook\.com\//i, '')
        .replace(/^fb\.com\//i, '')
        .replace(/[?#].*$/, '')           // drop query / hash
        .replace(/^@/, '')
        .replace(/\/+$/, '')              // trailing slash
        .replace(/[^A-Za-z0-9._/-]/g, '') // conservative slug charset (XSS-safe)
        .trim();
    if (!s) return null;
    const label = s.split('/').filter(Boolean).pop() || 'Facebook';
    return { url: 'https://facebook.com/' + s, label };
}

/** Format a free-text address: HTML-escape, then turn newlines into <br>.
 *  Returned via the template's `{{& contact.address}}` raw slot, so it MUST be
 *  pre-escaped here (only the <br> we add is intentional markup). */
function formatAddressHtml(raw) {
    return escapeHtml(String(raw)).replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// buildConfig — produces full config with `categories` schema
// ---------------------------------------------------------------------------

/**
 * Build a complete site config from wizard answers + gallery files.
 *
 * Always produces `categories` (never flat `gallery`) so build.js template
 * renders with zero unresolved tokens.
 *
 * @param {Object} data         — wizard answers (name, tagline, about, services, …)
 * @param {string[]} galleryFiles — filenames like ['gallery-1.jpg', 'gallery-2.jpg']
 * @returns {Object} Full config ready for build.js
 */
function buildConfig(data, galleryFiles, hasLogo) {
    const ig = normalizeInstagram(data.instagram);
    const fb = normalizeFacebook(data.facebook);

    const services = (data.offer || data.services || '')
        .split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
        .map(label => ({ icon: '✦', label }));

    const contact = {
        title: 'Contactează-ne',
        intro: 'Scrie-ne un mesaj direct sau vizitează-ne.',
        instagram: { url: ig ? ig.url : '#', label: ig ? '@' + ig.handle : 'Instagram' },
        facebook:  { url: fb ? fb.url : '#', label: fb ? fb.label : 'Facebook' },
        whatsapp:  isSkip(data.whatsapp) ? '' : String(data.whatsapp).replace(/\D/g, ''),
        address:   isSkip(data.address)  ? '' : formatAddressHtml(data.address),
    };

    const categories = [
        {
            title:  '',
            blurb:  '',
            photos: galleryFiles.map((f, i) => ({ src: `images/${f}`, alt: `${data.name || 'Produs'} ${i + 1}` })),
        },
    ];

    return {
        business: {
            name:            data.name || '',
            tagline:         data.tagline || '',
            title:           `${data.name || ''}`,
            metaDescription: (data.about || '').slice(0, 160),
            about:           data.about || '',
            lang:            'ro',
        },
        theme: { ...DEFAULT_THEME },
        logo:        hasLogo ? 'images/logo.jpg' : '',
        showWordmark: !hasLogo,
        hero: {
            background: galleryFiles[0] ? `url('images/${galleryFiles[0]}')` : 'linear-gradient(135deg, #f7f3f0 0%, #efe7ea 100%)',
            ctaLabel: 'Contactează-ne',
        },
        servicesTitle: 'Ce oferim',
        services,
        galleryTitle: '',
        categories,
        instagram: {
            handle:  ig ? ig.handle : '',
            url:     ig ? ig.url : '#',
            gallery: galleryFiles.slice(0, 6).map(f => 'images/' + f),
        },
        contact,
        footer: {
            address: isSkip(data.address) ? '' : String(data.address).replace(/\n/g, ', '),
            year:    new Date().getFullYear(),
            note:    'Creat cu drag.',
        },
    };
}

/**
 * Merge the deterministic parts (logo, contacts, images, footer) onto the
 * AI-polished config, producing a complete config ready for build.js.
 *
 * The AI handles copy/theme/categories/services; this fills everything the AI
 * must NOT invent: the client's real logo, normalized contacts, image paths.
 *
 * @param {Object}   aiConfig    — config from polishBusinessData (or null)
 * @param {Object}   data        — wizard answers
 * @param {string[]} galleryFiles
 * @param {boolean}  hasLogo
 * @returns {Object} merged config
 */
function mergeWizardConfig(aiConfig, data, galleryFiles, hasLogo) {
    if (!aiConfig) return buildConfig(data, galleryFiles, hasLogo);   // AI unavailable → mechanical fallback

    const cfg = JSON.parse(JSON.stringify(aiConfig));
    const ig = normalizeInstagram(data.instagram);
    const fb = normalizeFacebook(data.facebook);

    // Business name always comes from the owner (don't let the AI rename them)
    cfg.business = cfg.business || {};
    cfg.business.name = data.name || cfg.business.name || '';
    cfg.business.lang = 'ro';

    // Validate AI-chosen theme colors. They are interpolated into a <style> block
    // (CSS context), where HTML-escaping does not neutralize injection — so any
    // non-hex value is replaced with a safe default rather than trusted.
    const t = cfg.theme || {};
    cfg.theme = {
        primary:      safeHex(t.primary,      DEFAULT_THEME.primary),
        primaryLight: safeHex(t.primaryLight, DEFAULT_THEME.primaryLight),
        primaryDark:  safeHex(t.primaryDark,  DEFAULT_THEME.primaryDark),
        cream:        safeHex(t.cream,        DEFAULT_THEME.cream),
    };

    // Logo: the client's own logo, or a text wordmark when none was provided
    cfg.logo         = hasLogo ? 'images/logo.jpg' : '';
    cfg.showWordmark = !hasLogo;

    // Hero background = first real photo (keep AI's ctaLabel)
    cfg.hero = cfg.hero || {};
    cfg.hero.background = galleryFiles[0]
        ? `url('images/${galleryFiles[0]}')`
        : 'linear-gradient(135deg, #f7f3f0 0%, #efe7ea 100%)';
    cfg.hero.ctaLabel = cfg.hero.ctaLabel || 'Contactează-ne';

    // Contacts — normalized from the owner's raw input (AI only gave title/intro)
    const aiContact = cfg.contact || {};
    cfg.contact = {
        title: aiContact.title || 'Contactează-ne',
        intro: aiContact.intro || 'Scrie-ne un mesaj direct sau vizitează-ne.',
        instagram: { url: ig ? ig.url : '#', label: ig ? '@' + ig.handle : 'Instagram' },
        facebook:  { url: fb ? fb.url : '#', label: fb ? fb.label : 'Facebook' },
        whatsapp:  isSkip(data.whatsapp) ? '' : String(data.whatsapp).replace(/\D/g, ''),
        address:   isSkip(data.address)  ? '' : formatAddressHtml(data.address),
    };

    // Instagram photo-grid section
    cfg.instagram = {
        handle:  ig ? ig.handle : '',
        url:     ig ? ig.url : '#',
        gallery: galleryFiles.slice(0, 6).map(f => 'images/' + f),
    };

    // Footer
    cfg.footer = {
        address: isSkip(data.address) ? '' : String(data.address).replace(/\n/g, ', '),
        year:    new Date().getFullYear(),
        note:    (cfg.footer && cfg.footer.note) || 'Creat cu drag.',
    };

    cfg.galleryTitle = typeof cfg.galleryTitle === 'string' ? cfg.galleryTitle : '';

    // Distribute the real gallery photos across the AI's categories
    if (!Array.isArray(cfg.categories) || cfg.categories.length === 0) {
        cfg.categories = [{ title: '', blurb: '', photos: [] }];
    }
    let fileIndex = 0;
    for (const cat of cfg.categories) {
        if (!Array.isArray(cat.photos)) cat.photos = [];
        for (const photo of cat.photos) {
            if (fileIndex < galleryFiles.length) photo.src = `images/${galleryFiles[fileIndex++]}`;
        }
        cat.photos = cat.photos.filter(p => p.src && p.src !== '');
    }
    if (fileIndex < galleryFiles.length) {
        const last = cfg.categories[cfg.categories.length - 1];
        for (; fileIndex < galleryFiles.length; fileIndex++) {
            last.photos.push({ src: `images/${galleryFiles[fileIndex]}`, alt: `${cfg.business.name || 'Produs'} ${fileIndex + 1}` });
        }
    }

    return cfg;
}

// ---------------------------------------------------------------------------
// Site generation (shared by both chat and wizard paths)
// ---------------------------------------------------------------------------

/**
 * Lay out the site folder on disk, write config.json, and run build.js.
 *
 * @param {number} chatId
 * @param {Session} session
 * @returns {{ siteDir: string, slug: string, bytes: number }}
 */
async function generateSite(chatId, session) {
    const name = (session.siteConfig && session.siteConfig.business && session.siteConfig.business.name)
        || (session.data && session.data.name)
        || 'site';

    const slug    = slugify(name) + '-' + chatId;
    const siteDir = path.join(SITES_DIR, slug);
    const imagesDir = path.join(siteDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    // Copy shared template/styles/script
    for (const f of SHARED_FILES) {
        const src = path.join(PROJECT_ROOT, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(siteDir, f));
    }

    // Move images from temp dir into site. NOTE: if the client uploaded no logo,
    // we do NOT substitute any other logo — the site shows a text wordmark instead.
    const tmpDir = path.join(SITES_DIR, '_tmp-' + chatId);
    const hasLogo = fs.existsSync(path.join(tmpDir, 'logo.jpg'));
    if (hasLogo) {
        fs.copyFileSync(path.join(tmpDir, 'logo.jpg'), path.join(imagesDir, 'logo.jpg'));
    }

    const galleryFiles = [];
    for (let i = 0; i < session.gallery.length; i++) {
        const name = session.gallery[i];
        const out  = `gallery-${i + 1}.jpg`;
        const src  = path.join(tmpDir, name);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(imagesDir, out));
            galleryFiles.push(out);
        }
    }

    // Build config: prefer the AI-polished config; fall back to mechanical buildConfig
    const config = session.siteConfig
        ? mergeWizardConfig(session.siteConfig, session.data, galleryFiles, hasLogo)
        : buildConfig(session.data, galleryFiles, hasLogo);

    fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify(config, null, 2));
    const { bytes } = build(siteDir);

    // Cleanup temp
    fs.rmSync(tmpDir, { recursive: true, force: true });

    session.siteDir  = siteDir;
    session.siteSlug = slug;

    return { siteDir, slug, bytes };
}

// ---------------------------------------------------------------------------
// Deploy helpers
// ---------------------------------------------------------------------------

/**
 * Deploy the built site using Vercel (preferred) or Netlify (fallback).
 * Returns the live URL string, or null if neither is configured.
 *
 * @param {string} siteDir
 * @param {string} slug
 * @param {number|string} chatId
 * @returns {Promise<{url:string|null, projectId:string|null}>}
 */
async function deployBuiltSite(siteDir, slug, chatId) {
    if (vercelDeployOk()) {
        const result = await deploySite(siteDir, { name: slug });
        return { url: result.url, projectId: result.projectId || slug };
    }

    const netlifyToken = process.env.NETLIFY_TOKEN;
    if (netlifyToken) {
        const existingId = loadSitesMap()[chatId];
        const result = await deployToNetlify(siteDir, netlifyToken, existingId);
        saveSiteId(chatId, result.siteId);
        return { url: result.url, projectId: null };
    }

    return { url: null, projectId: null };
}

// ---------------------------------------------------------------------------
// WIZARD STEPS
// ---------------------------------------------------------------------------

const STEPS = [
    { key: 'name',      prompt: '🏪 (1/9) Cum se numește afacerea ta?' },
    { key: 'offer',     prompt: '🛍️ (2/9) Ce produse sau servicii oferi? Enumeră-le (fiecare pe linie nouă sau separate prin virgulă).' },
    { key: 'about',     prompt: '📝 (3/9) Spune-mi pe scurt despre afacerea ta — ce o face specială? (1-3 propoziții, scrie cum îți vine; AI-ul le aranjează frumos)' },
    { key: 'colors',    prompt: '🎨 (4/9) Ce culori ai vrea pentru site? (ex: roz și auriu, albastru elegant, verde natural, minimalist alb-negru...)' },
    { key: 'instagram', prompt: '📸 (5/9) Instagram-ul tău (username @nume sau link), sau scrie „skip".' },
    { key: 'facebook',  prompt: '👍 (6/9) Facebook (link sau nume pagină), sau „skip".' },
    { key: 'whatsapp',  prompt: '💬 (7/9) Număr WhatsApp cu prefix de țară (ex: 373..., 40..., 44...), sau „skip".' },
    { key: 'address',   prompt: '📍 (8/9) Adresa afacerii (sau „skip").' },
    { key: 'logo',      prompt: '🖼️ (9/9) Trimite LOGO-ul afacerii ca poză. Dacă nu ai logo, scrie „skip" (vom folosi numele afacerii).', photo: true },
    { key: 'gallery',   prompt: '🎂 Acum trimite 3-6 poze cu produsele/serviciile tale (una câte una). Când termini, scrie /gata și AI-ul construiește site-ul.', photos: true },
];

// ---------------------------------------------------------------------------
// Public handlers — called from bot.js
// ---------------------------------------------------------------------------

/**
 * /start — single guided flow: collect answers step by step, then the AI polishes
 * everything and builds the site.
 */
async function handleStart(ctx) {
    const chatId  = ctx.chat.id;

    // Returning from a checkout deep-link (t.me/bot?start=paid|cancel): NEVER reset a
    // session that is mid-payment/publish, or we'd orphan the paid-but-unpublished build.
    const payload  = (ctx.match || '').toString().trim().toLowerCase();
    const existing = sessions.get(chatId);
    if ((payload === 'paid' || payload === 'cancel') && existing &&
        (existing.phase === 'pay' || existing.phase === 'deploy')) {
        if (payload === 'cancel') {
            return ctx.reply('Ai întrerupt plata. Redeschide linkul de plată ca să finalizezi, sau scrie /anuleaza ca să o iei de la capăt.');
        }
        return ctx.reply('✅ Mulțumim! Verific plata și public site-ul automat — durează un moment. Nu închide conversația.');
    }

    const session = resetSession(chatId);
    session.phase     = 'wizard';
    session.stepIndex = 0;
    await ctx.reply(
        '👋 Salut! Îți construiesc un site web profesional pentru afacerea ta.\n\n' +
        'Îți pun câteva întrebări scurte despre afacere, apoi un AI îți aranjează frumos ' +
        'textele, alege culorile și publică site-ul. Hai să începem!\n\n' +
        'Oricând poți scrie /anuleaza ca să o iei de la capăt.'
    );
    await ctx.reply(STEPS[0].prompt);
}

/** /wizard — alias of /start (kept for compatibility). */
async function handleWizard(ctx) {
    return handleStart(ctx);
}

/**
 * /anuleaza — reset everything.
 */
async function handleAnuleaza(ctx) {
    const chatId = ctx.chat.id;
    const s = sessions.get(chatId);
    // Never silently discard a PAID order (would lose the customer's money).
    if (s && (s.phase === 'deploy' || s.phase === 'paid-needs-retry')) {
        return ctx.reply('Ai o comandă deja PLĂTITĂ în curs de publicare — nu o anulez ca să nu pierzi banii. Scrie /retry ca să finalizez publicarea.');
    }
    resetSession(chatId);
    await ctx.reply('🔄 Am resetat sesiunea. Scrie /start ca să o iei de la capăt.');
}

/**
 * /retry — resume publishing a paid order that failed to deploy/finish (phase
 * 'paid-needs-retry' or 'deploy'). Idempotent via _publishAndFinish's guards.
 */
async function handleRetry(ctx) {
    const chatId  = ctx.chat.id;
    const session = getSession(chatId);
    if (session.phase === 'paid-needs-retry' || session.phase === 'deploy') {
        await ctx.reply('🔁 Reiau publicarea...');
        await _publishAndFinish(ctx, session, chatId);
        return;
    }
    if (session.phase === 'pay') {
        return ctx.reply('Încă aștept confirmarea plății. Dacă ai plătit, o detectez automat în scurt timp.');
    }
    return ctx.reply('Nu ai o publicare în așteptare. Scrie /start ca să creezi un site.');
}

/**
 * /gata — finish gallery in wizard mode.
 */
async function handleGata(ctx) {
    const chatId  = ctx.chat.id;
    const session = getSession(chatId);

    if (session.phase !== 'wizard') {
        return ctx.reply('Comanda /gata funcționează doar în modul wizard (după /wizard).');
    }

    const step = STEPS[session.stepIndex];
    if (!step || step.key !== 'gallery') {
        return ctx.reply('Nu ești la pasul galeriei.');
    }

    if (session.gallery.length === 0) {
        return ctx.reply('Trimite cel puțin o poză cu produsele tale înainte de /gata.');
    }

    // Abuse throttle: cap builds per chat/hour and globally per day (protects the AI budget).
    const rl = ratelimit.allowBuild(chatId);
    if (!rl.ok) {
        if (rl.scope === 'global') notifyAdmin('⚠️ Limita globală zilnică de build-uri a fost atinsă.');
        return ctx.reply('⏳ ' + rl.reason);
    }
    ratelimit.consumeBuild(chatId);

    // 1) Send all collected answers to the AI to polish copy, organise products
    //    into categories and pick a theme matching the requested colors.
    await ctx.reply('✨ Am toate informațiile! AI-ul îți aranjează acum site-ul (texte, culori, secțiuni)...');
    ctx.replyWithChatAction('typing').catch(() => {});

    try {
        const result = await polishBusinessData(session.data, {
            photoCount: session.gallery.length,
            lang: 'ro',
        });
        if (result.blocked) {
            await ctx.reply('🚫 ' + (result.blockReason || 'Pot construi doar site-uri pentru afaceri legitime.') + '\n\nScrie /start ca să încerci din nou.');
            resetSession(chatId);
            return;
        }
        session.siteConfig = result.config || null;   // null → mechanical buildConfig fallback
    } catch (e) {
        console.error('[polishBusinessData error]', e);
        // Don't lose the client — fall back to the mechanical builder
        session.siteConfig = null;
    }

    // 2) Build the site from the (polished or fallback) config
    try {
        await generateSite(chatId, session);
    } catch (e) {
        console.error('[/gata error]', e);
        await ctx.reply('❌ Eroare la generarea site-ului: ' + e.message + '\nScrie /anuleaza și încearcă din nou.');
        return;
    }

    // 3) Offer custom domain → payment → publish
    await _afterBuildOfferDomain(ctx, session, chatId);
}

// ---------------------------------------------------------------------------
// Photo handler
// ---------------------------------------------------------------------------

/** Download + register the logo at the logo step. Returns false (and replies) on failure. */
async function _saveLogo(ctx, session, tmpDir) {
    try {
        await downloadPhoto(ctx, path.join(tmpDir, 'logo.jpg'), MAX_IMAGE_BYTES);
    } catch (e) {
        if (e.code === 'FILE_TOO_LARGE') { await ctx.reply('Imaginea e prea mare (max 8MB). Trimite una mai mică.'); return false; }
        console.error('[logo download]', e);
        await ctx.reply('Nu am putut prelua imaginea. Mai încearcă o dată.');
        return false;
    }
    session.hasLogo = true;
    session.stepIndex++;
    await ctx.reply('👍 Logo primit!');
    await ctx.reply(STEPS[session.stepIndex].prompt);
    return true;
}

/** Download + register one gallery photo. Enforces the count cap. Returns false on cap/failure. */
async function _saveGalleryPhoto(ctx, session, tmpDir) {
    if (session.gallery.length >= MAX_GALLERY) {
        await ctx.reply(`Ai trimis deja ${MAX_GALLERY} poze — sunt suficiente. Scrie /gata ca să construiesc site-ul.`);
        return false;
    }
    const name = `g-${session.gallery.length + 1}.jpg`;
    try {
        await downloadPhoto(ctx, path.join(tmpDir, name), MAX_IMAGE_BYTES);
    } catch (e) {
        if (e.code === 'FILE_TOO_LARGE') { await ctx.reply('Poza e prea mare (max 8MB). Trimite una mai mică.'); return false; }
        console.error('[gallery download]', e);
        await ctx.reply('Nu am putut prelua poza. Mai încearcă o dată.');
        return false;
    }
    session.gallery.push(name);
    await ctx.reply(`📷 Poză ${session.gallery.length} salvată. Mai trimite sau scrie /gata.`);
    return true;
}

/**
 * Handle incoming photo in any phase.
 */
async function handlePhoto(ctx) {
    const chatId  = ctx.chat.id;
    const session = getSession(chatId);

    const tmpDir = path.join(SITES_DIR, '_tmp-' + chatId);
    fs.mkdirSync(tmpDir, { recursive: true });

    // ----- WIZARD -----
    if (session.phase === 'wizard') {
        const step = STEPS[session.stepIndex];
        if (!step || (!step.photo && !step.photos)) {
            return ctx.reply('Acum aștept text, nu o poză. Continuă cu răspunsul.');
        }
        if (step.photo)  { await _saveLogo(ctx, session, tmpDir); return; }
        if (step.photos) { await _saveGalleryPhoto(ctx, session, tmpDir); return; }
        return;
    }

    // ----- ANY OTHER PHASE -----
    await ctx.reply('Nu am nevoie de o poză acum. Continuă cu instrucțiunile precedente.');
}

/**
 * Handle an incoming DOCUMENT (uncompressed file). Logos are very often sent this
 * way (a transparent PNG), and Telegram does NOT deliver those as message:photo — so
 * without this handler the user silently dead-ends at the logo step. We accept only
 * image/* documents and route them through the same save logic as photos.
 */
async function handleDocument(ctx) {
    const chatId  = ctx.chat.id;
    const session = getSession(chatId);
    const doc     = ctx.message.document;

    const tmpDir = path.join(SITES_DIR, '_tmp-' + chatId);
    fs.mkdirSync(tmpDir, { recursive: true });

    if (session.phase === 'wizard') {
        const step = STEPS[session.stepIndex];
        if (!step || (!step.photo && !step.photos)) {
            return ctx.reply('Acum aștept text, nu un fișier. Continuă cu răspunsul.');
        }
        const isImage = doc && typeof doc.mime_type === 'string' && doc.mime_type.startsWith('image/');
        if (!isImage) {
            return ctx.reply('Te rog trimite o imagine (JPG sau PNG)' + (step.photo ? ' cu logo-ul, sau scrie „skip".' : ' cu produsul.'));
        }
        if (step.photo)  { await _saveLogo(ctx, session, tmpDir); return; }
        if (step.photos) { await _saveGalleryPhoto(ctx, session, tmpDir); return; }
        return;
    }

    await ctx.reply('Nu am nevoie de un fișier acum. Continuă cu instrucțiunile precedente.');
}

/**
 * Catch-all for message types we don't otherwise handle (stickers, voice, video,
 * location, contact, …). Registered LAST so it only fires when nothing else matched.
 * Gives the user a clear nudge instead of silence.
 */
async function handleOther(ctx) {
    const session = getSession(ctx.chat.id);
    if (session.phase === 'wizard') {
        const step = STEPS[session.stepIndex];
        if (step && (step.photo || step.photos)) {
            return ctx.reply(step.photo
                ? 'Te rog trimite logo-ul ca imagine (poză sau fișier JPG/PNG), sau scrie „skip".'
                : 'Te rog trimite poze cu produsele (imagini). Când termini, scrie /gata.');
        }
        return ctx.reply('Te rog răspunde cu text la întrebare 🙂');
    }
    return ctx.reply('Scrie /start ca să începem.');
}

// ---------------------------------------------------------------------------
// Text handler
// ---------------------------------------------------------------------------

/**
 * Handle incoming text in any phase.
 */
async function handleText(ctx) {
    const chatId  = ctx.chat.id;
    const session = getSession(chatId);
    const text    = ctx.message.text.trim();

    // ----- IDLE -----
    if (session.phase === 'idle') {
        return ctx.reply('Scrie /start ca să începem.');
    }

    // ----- DONE -----
    if (session.phase === 'done') {
        return ctx.reply('Site-ul tău e deja gata! Scrie /start ca să faci unul nou.');
    }

    // ----- WIZARD -----
    if (session.phase === 'wizard') {
        if (session.stepIndex < 0) return ctx.reply('Scrie /start ca să începem.');
        const step = STEPS[session.stepIndex];
        if (!step) return;

        // Logo step: allow "skip" (no logo) via text; otherwise wait for a photo.
        if (step.photo) {
            if (isSkip(text)) {
                session.hasLogo = false;
                session.stepIndex++;
                await ctx.reply('👍 OK, fără logo — vom folosi numele afacerii.');
                await ctx.reply(STEPS[session.stepIndex].prompt);
                return;
            }
            return ctx.reply('Aici aștept LOGO-ul ca poză 🙂 (sau scrie „skip" dacă nu ai logo).');
        }

        // Gallery step: photos only (finish with /gata)
        if (step.photos) {
            return ctx.reply('Acum aștept poze cu produsele tale 🙂 (sau /gata când ai terminat).');
        }

        session.data[step.key] = text;
        session.stepIndex++;
        const next = STEPS[session.stepIndex];
        if (next) await ctx.reply(next.prompt);
        return;
    }

    // ----- OFFER DOMAIN (da/nu) -----
    if (session.phase === 'offer-domain') {
        const ans = text.toLowerCase();
        const yes = /^(da|yes|vreau|ok|sigur|y)\b/.test(ans);
        const no  = /^(nu|no|n|nu mul)/.test(ans);
        if (yes) {
            session.phase = 'domain';
            await ctx.reply('🌐 Ce domeniu vrei? (ex: `numeleafacerii.ro` sau `numeleafacerii.com`)\n\n_Verific disponibilitatea și îți spun prețul total._');
        } else if (no) {
            // No custom domain — pay just the build fee, then publish on vercel.app.
            session.domain = null;
            session.domainPriceUsd = null;
            session.phase = 'pay';
            await _initiatePayment(ctx, session, chatId);
        } else {
            await ctx.reply('Scrie *da* (vreau domeniu custom) sau *nu* (doar pe vercel.app).');
        }
        return;
    }

    // ----- DOMAIN -----
    if (session.phase === 'domain') {
        await _handleDomainAnswer(ctx, session, text);
        return;
    }

    // ----- PAY -----
    if (session.phase === 'pay') {
        await ctx.reply(
            '⏳ Așteptăm confirmarea plății. Dacă ai plătit deja, ' +
            'procesăm automat în câteva momente. Dacă ai probleme, scrie /anuleaza.'
        );
        return;
    }

    // ----- DEPLOY -----
    if (session.phase === 'deploy') {
        await ctx.reply('⏳ Publicăm site-ul, te rugăm să aștepți...');
        return;
    }
}

// ---------------------------------------------------------------------------
// After build: the site is ready but NOT published yet. Publishing requires
// payment (build fee). Offer an optional custom domain, then go to checkout.
// ---------------------------------------------------------------------------

const BUILD_FEE_LABEL = () => `${(BUILD_FEE_CENTS / 100).toFixed(2)} USD`;

async function _afterBuildOfferDomain(ctx, session, chatId) {
    const bizName = (session.siteConfig && session.siteConfig.business && session.siteConfig.business.name) || session.data.name || 'necunoscut';
    notifyAdmin(`🔧 Site nou construit: "${bizName}" (chat ${chatId}). Așteaptă plata.`);

    // If deploy isn't even configured, there's no product to sell — just say so.
    if (!vercelDeployOk() && !process.env.NETLIFY_TOKEN) {
        session.phase = 'done';
        sessions.delete(chatId);
        await ctx.reply(
            `✅ Site generat local în:\n\`${session.siteDir}\`\n\n` +
            '_(Publicarea automată e dezactivată — adaugă VERCEL_TOKEN.)_'
        );
        return;
    }

    await ctx.reply(
        `🔧 Site-ul tău e gata de publicare!\n\n` +
        `Publicarea costă o taxă unică de *${BUILD_FEE_LABEL()}* (site pe adresă vercel.app).`
    );

    if (vercelOk()) {
        session.phase = 'offer-domain';
        await ctx.reply(
            '🌐 Vrei și un *domeniu custom* (ex: `numeleafacerii.ro`)? Costul domeniului se adaugă la plată.\n\n' +
            'Scrie *da* ca să caut un domeniu și să-ți spun prețul total, sau *nu* ca să publici doar pe vercel.app.'
        );
    } else {
        // No domain capability — go straight to paying the build fee.
        session.domain = null;
        session.phase = 'pay';
        await _initiatePayment(ctx, session, chatId);
    }
}

// ---------------------------------------------------------------------------
// Domain phase
// ---------------------------------------------------------------------------

async function _handleDomainAnswer(ctx, session, text) {
    const chatId = ctx.chat.id;

    // Clean input: remove spaces, lowercase
    const domainName = text.toLowerCase().replace(/\s+/g, '').replace(/^https?:\/\//, '');

    if (!domainName.includes('.')) {
        return ctx.reply('Te rog introduci un domeniu complet, ex: `afacereaMea.ro` sau `afacereamea.com`.');
    }

    await ctx.reply(`🔍 Verific disponibilitatea pentru \`${domainName}\`...`);

    let info;
    try {
        info = await checkDomain(domainName);
    } catch (e) {
        console.error('[checkDomain error]', e);
        await ctx.reply('❌ Nu am putut verifica domeniul: ' + e.message + '\nÎncearcă alt domeniu sau /anuleaza.');
        return;
    }

    if (info.available && info.priceUsd == null) {
        // Available but we couldn't get a price (premium/unsupported TLD) — ask for another.
        await ctx.reply(
            `\`${domainName}\` pare disponibil dar nu pot afla prețul automat (TLD premium sau nesuportat).\n` +
            'Încearcă un alt domeniu, ex. cu `.com` sau `.ro`.'
        );
        return;
    }

    if (info.available) {
        session.domain        = domainName;
        session.domainPriceUsd = info.priceUsd;

        await ctx.reply(`✅ Domeniu disponibil: \`${domainName}\` — ${info.priceUsd} USD/an.\n\nPregătesc plata...`);
        session.phase = 'pay';
        await _initiatePayment(ctx, session, chatId);
    } else {
        // Suggest alternatives
        await ctx.reply(`❌ \`${domainName}\` nu este disponibil. Caut alternative...`);

        const base = domainName.split('.')[0];
        let suggestions = [];
        try {
            suggestions = await suggestDomains(base);
        } catch (e) {
            console.error('[suggestDomains error]', e);
        }

        if (suggestions.length > 0) {
            const list = suggestions.slice(0, 5).map(s => {
                const price = s.priceUsd != null ? ` — ${s.priceUsd} USD/an` : '';
                return `• \`${s.name}\`${price}`;
            }).join('\n');
            await ctx.reply(`Iată câteva alternative disponibile:\n\n${list}\n\nScrie unul din ele sau propune altul.`);
        } else {
            await ctx.reply('Nu am găsit alternative disponibile. Încearcă un alt domeniu.');
        }
        // Stay in domain phase
    }
}

// ---------------------------------------------------------------------------
// Payment phase
// ---------------------------------------------------------------------------

async function _initiatePayment(ctx, session, chatId) {
    // Every site is paid: a one-time build fee, PLUS the domain cost if a custom
    // domain was chosen. The site is published only AFTER payment is confirmed.
    const hasDomain   = Boolean(session.domain && session.domainPriceUsd != null);
    const domainCents = hasDomain ? Math.round(session.domainPriceUsd * 100) + DOMAIN_MARKUP_CENTS : 0;
    const amountCents = BUILD_FEE_CENTS + domainCents;

    if (!stripeOk() || amountCents <= 0) {
        // Payment provider missing/misconfigured. In PRODUCTION this must NOT silently
        // publish for free (revenue leak + abuse). Only the explicit ALLOW_FREE_PUBLISH=1
        // dev flag enables the free path; otherwise refuse and alert the owner.
        if (process.env.ALLOW_FREE_PUBLISH !== '1') {
            console.error('[payment] provider not configured and ALLOW_FREE_PUBLISH != 1 — refusing free publish for chat', chatId);
            notifyAdmin(`🚨 Plata NECONFIGURATĂ — am refuzat publicarea gratuită pentru chat ${chatId}. Configurează providerul de plată (sau setează ALLOW_FREE_PUBLISH=1 pentru teste).`);
            await ctx.reply('⚠️ Momentan nu pot finaliza plata. Am anunțat echipa — te rugăm încearcă din nou mai târziu.');
            session.phase = 'done';
            return;
        }
        // Dev-only free publish.
        await ctx.reply('ℹ️ Plata nu e configurată — public direct (mod dev)...');
        session.phase = 'deploy';
        await _publishAndFinish(ctx, session, chatId);
        return;
    }

    const productName  = hasDomain
        ? `Site web hidook + domeniu ${session.domain}`
        : 'Site web hidook (publicare pe vercel.app)';

    // successUrl / cancelUrl: use Telegram deep-link (polling doesn't need a public URL)
    const uname        = getBotUsername();
    const successUrl   = `https://t.me/${uname}?start=paid`;
    const cancelUrl    = `https://t.me/${uname}?start=cancel`;

    let checkoutId, checkoutUrl;
    try {
        const checkout = await createCheckout({
            amountCents,
            currency:    'usd',
            productName,
            successUrl,
            cancelUrl,
            metadata: { chatId: String(chatId), domain: session.domain },
        });
        checkoutId  = checkout.id;
        checkoutUrl = checkout.url;
    } catch (e) {
        console.error('[createCheckout error]', e);
        await ctx.reply('❌ Eroare la crearea sesiunii de plată: ' + e.message);
        return;
    }

    session.stripeSessionId = checkoutId;
    session.payStartedAt    = Date.now();   // used to abandon never-paid checkouts after PAY_MAX_AGE_MS

    const total = (amountCents / 100).toFixed(2);
    const breakdown = hasDomain
        ? `Taxă site: ${(BUILD_FEE_CENTS / 100).toFixed(2)} USD + domeniu \`${session.domain}\`: ${(domainCents / 100).toFixed(2)} USD`
        : `Taxă unică de construcție site`;
    await ctx.reply(
        `💳 Total de plată: *${total} USD*\n(${breakdown})\n\n` +
        `👉 [Plătește aici](${checkoutUrl})\n\n` +
        '_Verific automat plata în fundal. După confirmare, public site-ul. Nu închide conversația._'
    );

    // Poll in background — don't await so the bot remains responsive
    _pollPaymentBackground(ctx, session, chatId, checkoutId);
}

function _pollPaymentBackground(ctx, session, chatId, checkoutId) {
    if (activePolls.has(chatId)) return;   // never two pollers for one chat
    activePolls.add(chatId);
    pollUntilPaid(checkoutId, { intervalMs: 5000, timeoutMs: 600000 })
        .then(async (paid) => {
            if (!paid) {
                // Not confirmed this window. Keep phase 'pay' so the periodic sweeper
                // re-checks later — covers slow bank/3DS payments past the poll window.
                await ctx.reply(
                    '⏳ Încă n-am primit confirmarea plății. Verific în continuare automat — ' +
                    'public site-ul imediat ce se confirmă. (Sau scrie /anuleaza ca să renunți.)'
                );
                return;
            }
            await ctx.reply('✅ Plată confirmată! Public site-ul...');
            session.phase = 'deploy';
            flushSessions();   // durable: a restart now resumes from 'deploy', not 'pay'
            await _publishAndFinish(ctx, session, chatId);
        })
        .catch(async (e) => {
            console.error('[pollPayment error]', e);
            await ctx.reply('⏳ Verificarea plății a întâmpinat o problemă temporară; reîncerc automat în curând.');
        })
        .finally(() => activePolls.delete(chatId));
}

// ---------------------------------------------------------------------------
// Publish phase (runs AFTER payment is confirmed)
// ---------------------------------------------------------------------------

/** Deploy with a couple of retries + small backoff (transient Vercel/network errors). */
async function _deployWithRetry(siteDir, slug, chatId, attempts = 3) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await deployBuiltSite(siteDir, slug, chatId);
        } catch (e) {
            lastErr = e;
            console.error(`[deploy attempt ${i}/${attempts}]`, e.message);
            if (i < attempts) await new Promise(r => setTimeout(r, 1500 * i));
        }
    }
    throw lastErr;
}

/** Refund the domain portion of a paid order after an unrecoverable domain failure,
 *  then keep the site live on vercel.app. Best-effort: if the refund API is missing or
 *  fails, alert the owner to refund manually — never leave the customer silently charged. */
async function _refundDomainPortion(ctx, session, chatId, err) {
    const domainCents = Math.round(session.domainPriceUsd * 100) + DOMAIN_MARKUP_CENTS;
    let refunded = false;
    try {
        if (typeof _payments.refund === 'function' && session.stripeSessionId) {
            await _payments.refund(session.stripeSessionId, domainCents);
            refunded = true;
        }
    } catch (re) {
        console.error('[refund domain portion]', re);
    }
    notifyAdmin(`⚠️ Domeniu eșuat după plată (chat ${chatId}): ${err.message}. Refund domeniu ${(domainCents / 100).toFixed(2)} USD: ${refunded ? 'OK' : 'MANUAL necesar'}.`);
    await ctx.reply(
        `⚠️ Nu am putut înregistra domeniul \`${session.domain}\`.` +
        (refunded
            ? ` Ți-am returnat costul domeniului (${(domainCents / 100).toFixed(2)} USD).`
            : ' Echipa te va contacta pentru rambursarea costului domeniului.') +
        `\nSite-ul tău rămâne LIVE pe ${session.liveUrl}.`
    );
    // Drop the domain so the order finishes as a normal vercel.app publish.
    session.domain = null;
    session.domainPriceUsd = null;
}

/**
 * Publish the paid site: deploy to Vercel/Cloudflare, and — if a custom domain was paid
 * for — buy + attach it. IDEMPOTENT and RETRYABLE: guarded so a reconciler re-poll, a
 * /retry, and a duplicate update never publish twice; on failure it does NOT discard the
 * paid order — it parks it in 'paid-needs-retry' for /retry or the sweeper to resume.
 */
async function _publishAndFinish(ctx, session, chatId) {
    // Idempotency guards.
    if (session.published) {
        const live = session.domain ? `https://${session.domain}` : session.liveUrl;
        if (live) await ctx.reply(`✅ Site-ul tău e deja live:\n👉 ${live}`);
        return;
    }
    if (session._publishing) return;          // a publish is already in flight for this chat
    session._publishing = true;
    session.phase = 'deploy';
    flushSessions();

    // On any unrecoverable failure: keep the PAID order, park it for retry, alert owner.
    const parkForRetry = async (msg) => {
        session._publishing = false;
        session.phase = 'paid-needs-retry';
        flushSessions();
        notifyAdmin(`⚠️ Publicare eșuată (client PLĂTIT) chat ${chatId}: ${msg}`);
        await ctx.reply(`⚠️ ${msg}\n\nAi plătit deja — datele tale sunt în siguranță. Scrie /retry ca să încerc din nou publicarea.`);
    };

    const siteDir = session.siteDir;
    const slug    = session.siteSlug;
    if (!siteDir || !fs.existsSync(siteDir)) {
        await parkForRetry('Nu găsesc fișierele site-ului pe disc.');
        return;
    }

    // 1) Deploy (with retry)
    let url, projectId;
    try {
        await ctx.reply('🚀 Public site-ul...');
        ({ url, projectId } = await _deployWithRetry(siteDir, slug, chatId));
    } catch (e) {
        console.error('[deploy failed after retries]', e);
        await parkForRetry('Publicarea a eșuat temporar: ' + e.message);
        return;
    }
    if (!url) { await parkForRetry('Deploy-ul nu a returnat un URL.'); return; }
    session.liveUrl   = url;
    session.projectId = projectId;
    flushSessions();

    // 2) Custom domain (paid for) — buy + attach. On failure: refund the domain portion
    //    and finish as a normal vercel.app publish (site stays live).
    if (session.domain && session.domainPriceUsd != null && vercelOk()) {
        await ctx.reply(`🛒 Cumpăr domeniul \`${session.domain}\`...`);
        try {
            await buyDomain(session.domain, session.domainPriceUsd);
            await ctx.reply(`✅ Domeniu \`${session.domain}\` cumpărat!`);
            if (projectId && vercelDeployOk()) {
                await attachDomain(projectId, session.domain);
                await ctx.reply('🔗 Domeniu atașat la site!');
            }
        } catch (e) {
            console.error('[domain finalize error]', e);
            await _refundDomainPortion(ctx, session, chatId, e);
        }
    }

    // 3) Done — mark published BEFORE deleting so a crash here can't re-publish.
    session.published = true;
    session._publishing = false;
    session.phase = 'done';
    flushSessions();

    const liveUrl = session.domain ? `https://${session.domain}` : url;
    notifyAdmin(`💰 PLATĂ + PUBLICARE: chat ${chatId} → ${liveUrl}${session.domain ? ' (domeniu cumpărat)' : ''}`);
    await ctx.reply(
        `🎉 Gata! Site-ul tău e LIVE:\n\n👉 ${liveUrl}\n\n` +
        (session.domain ? '_DNS-ul se propagă în câteva minute._\n' : '') +
        'Felicitări! Scrie /start oricând să faci un site nou.'
    );
    sessions.delete(chatId);
    flushSessions();
}

// ---------------------------------------------------------------------------
// /help and /preturi
// ---------------------------------------------------------------------------

async function handleHelp(ctx) {
    await ctx.reply(
        '🤖 Cum funcționează?\n\n' +
        'Îți construiesc un site web profesional pentru afacerea ta în câteva minute.\n\n' +
        '1️⃣ Scrie /start și povestește-mi despre afacere (nume, ce vinzi, contacte).\n' +
        '2️⃣ Trimite câteva poze cu produsele tale.\n' +
        '3️⃣ Aleg textele, culorile și construiesc site-ul.\n' +
        '4️⃣ Plătești și site-ul tău e LIVE — pe vercel.app sau pe domeniul tău.\n\n' +
        'Comenzi:\n' +
        '/start – construiește un site (chat cu AI)\n' +
        '/wizard – mod pas-cu-pas (manual)\n' +
        '/preturi – vezi prețurile\n' +
        '/anuleaza – resetează\n\n' +
        'Spune-mi orice despre afacerea ta și începem!'
    );
}

async function handlePreturi(ctx) {
    const fee = (BUILD_FEE_CENTS / 100).toFixed(0);
    await ctx.reply(
        '💰 Prețuri\n\n' +
        `• Site complet (pe adresă vercel.app): ${fee} USD, o singură dată.\n` +
        '• + Domeniu custom (ex: afacereata.ro): prețul domeniului (~12–15 USD/an) se adaugă la plată.\n' +
        '• Design la comandă / funcții speciale: de la 500 USD.\n\n' +
        'Scrie /start ca să începem!'
    );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    // Session
    getSession,
    resetSession,
    persistSessions,
    flushSessions,
    sessions,
    setAdminNotifier,
    setBotUsername,
    setMessenger,
    reconcilePending,
    // Handlers
    handleStart,
    handleWizard,
    handleAnuleaza,
    handleRetry,
    handleGata,
    handlePhoto,
    handleDocument,
    handleOther,
    handleText,
    handleHelp,
    handlePreturi,
    // Utilities (exported for testing / bot.js wiring)
    slugify,
    downloadPhoto,
    buildConfig,
    mergeWizardConfig,
    normalizeInstagram,
    normalizeFacebook,
    generateSite,
    STEPS,
};
