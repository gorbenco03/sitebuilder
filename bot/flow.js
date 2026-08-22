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
const ledger              = require('./ledger.js');
const ai                  = require('./ai.js');
const { getProvider, polishBusinessData } = ai;

/** Append an order-lifecycle record to the audit ledger (best-effort, never throws). */
function _ledger(event, fields) { try { ledger.append({ event, ...fields }); } catch (_) {} }
// Payment provider: Revolut Merchant API when configured (or PAYMENT_PROVIDER=revolut),
// otherwise fall back to Stripe. Both expose the same interface.
const _payments = (process.env.PAYMENT_PROVIDER || '').toLowerCase() === 'stripe'
    ? require('./payments.js')
    : (require('./revolut.js').isConfigured() ? require('./revolut.js') : require('./payments.js'));
const { isConfigured: stripeOk, createCheckout, pollUntilPaid } = _payments;
// domains.js remains on disk but is NOT used (pay-before-publish — no domain automation)
const { isConfigured: vercelDeployOk, deploySite, attachDomain } = require('./deploy-vercel.js');
const cfDeploy = require('./deploy-cloudflare.js');
const { deployToNetlify } = require('./deploy.js');

const registry   = require('./registry.js');
const webpublish = require('./webpublish.js');
const pricing    = require('./pricing.js');

const CONTACT_URL = (process.env.CONTACT_URL || '').trim();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.join(__dirname, '..');
// Built sites + temp uploads live on the persistent volume (DATA_DIR) so a paid,
// not-yet-published order survives a Railway redeploy/restart. Falls back to the
// project root for local runs where DATA_DIR is unset.
const SITES_DIR    = path.join(process.env.DATA_DIR || PROJECT_ROOT, 'sites');
const SHARED_FILES = ['template.html', 'styles.css', 'script.js', 'collage.js'];

/** Fallback label currency when pricing bucket is unavailable. Env: PAYMENT_CURRENCY. */
const PAYMENT_CURRENCY = String(process.env.PAYMENT_CURRENCY || 'eur').toLowerCase();
const CURRENCY_LABEL = PAYMENT_CURRENCY.toUpperCase();

/** Legal/GDPR/ToS link surfaced in the /start consent note. Env: LEGAL_URL. */
const LEGAL_URL = (process.env.LEGAL_URL || '').trim();

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
        stripeSessionId: null,
        projectId: null,
        liveUrl: null,
        registrySiteId: null,  // id in registry after draft is registered
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
 * Build a Vercel-safe project/deploy name from a business name + chat id.
 * Vercel project names must be lowercase, [a-z0-9-] only, no leading/trailing dash,
 * and bounded in length. A raw chatId can be negative (group chats) — we use
 * Math.abs() so the id is always a clean numeric suffix. Defends against an
 * attacker-controlled business name being reflected into the deploy/project name.
 *
 * @param {string} name    business name (untrusted)
 * @param {number|string} chatId
 * @returns {string} safe slug, e.g. "patiseria-mea-123456789"
 */
function safeProjectName(name, chatId) {
    const idPart = String(Math.abs(Number(chatId)) || 0);
    let base = slugify(name);                       // already lowercase [a-z0-9-]
    // Reserve room for the "-<id>" suffix within the ~50 char budget.
    const budget = Math.max(1, 50 - idPart.length - 1);
    base = base.slice(0, budget);
    let slug = `${base}-${idPart}`
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')   // belt-and-suspenders
        .replace(/-+/g, '-')            // collapse runs of dashes
        .replace(/^-+|-+$/g, '')        // trim leading/trailing dash
        .slice(0, 50)
        .replace(/^-+|-+$/g, '');       // re-trim after the slice
    return slug || `site-${idPart}`;
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

/**
 * Read the raw image buffers a client uploaded this session from the temp dir
 * (logo + gallery photos) so they can be sent to image moderation BEFORE the
 * temp dir is consumed/deleted by generateSite(). Best-effort: skips any file
 * that can't be read.
 * @param {number|string} chatId
 * @param {Session} session
 * @returns {Buffer[]}
 */
function _collectTmpImageBuffers(chatId, session) {
    const tmpDir = path.join(SITES_DIR, '_tmp-' + chatId);
    const names = [];
    if (fs.existsSync(path.join(tmpDir, 'logo.jpg'))) names.push('logo.jpg');
    for (const g of (session.gallery || [])) names.push(g);
    const buffers = [];
    for (const n of names) {
        try {
            const p = path.join(tmpDir, n);
            if (fs.existsSync(p)) buffers.push(fs.readFileSync(p));
        } catch (_) { /* skip unreadable file */ }
    }
    return buffers;
}

// ---------------------------------------------------------------------------
// Contact normalization helpers
// ---------------------------------------------------------------------------

const isSkip = (v) => !v || !String(v).trim() || String(v).trim().toLowerCase() === 'skip';

/** True only for 1:1 private chats. The builder collects personal/business data and
 *  issues payments, so we refuse group/channel/supergroup contexts gracefully. */
function isPrivateChat(ctx) {
    const t = ctx && ctx.chat && ctx.chat.type;
    return !t || t === 'private';
}

/** One-line GDPR/ToS consent note appended to the greeting. Uses LEGAL_URL when set,
 *  otherwise a generic note. */
function consentNote() {
    const tail = LEGAL_URL
        ? `Termeni & confidențialitate: ${LEGAL_URL}`
        : 'Datele se folosesc doar pentru a-ți construi și publica site-ul.';
    return `ℹ️ Folosind acest bot ești de acord cu prelucrarea datelor pentru crearea site-ului tău (GDPR). ${tail} Poți șterge oricând datele cu /sterge.`;
}

/** Validate a #rgb / #rrggbb hex color; return `fallback` for anything else.
 *  Theme colors land inside a <style> block (CSS context), where HTML-escaping does
 *  NOT neutralize injection — so we validate the value instead. */
const HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
function safeHex(v, fallback) {
    return (typeof v === 'string' && HEX_RE.test(v.trim())) ? v.trim() : fallback;
}

/** The mechanical/default theme (also reused as the safe fallback for bad AI colors). */
const DEFAULT_THEME = { primary: '#E8588C', primaryLight: '#f07aa5', primaryDark: '#d14477', cream: '#faf8f8' };

/** RO UI labels (CONTRACT §1). Always present; the AI may refine titles later. */
function defaultLabels() {
    return {
        about:       'Despre noi',
        instaTitle:  'Urmărește-ne pe Instagram',
        instaFollow: 'Urmărește',
        scroll:      'Derulează',
        waQr:        'Deschide WhatsApp pe telefon',
        waOpen:      'Sau deschide WhatsApp Web',
    };
}

/**
 * Build the SEO object (CONTRACT §3): ogImage + a complete, </script>-safe schema.org
 * LocalBusiness JSON-LD string.
 *
 * @param {object} args
 * @param {object} args.business      { name, metaDescription, ... }
 * @param {object} args.footer        { address } — PLAIN text address for JSON-LD
 * @param {object} args.contact       { whatsapp } — digits-only phone, or ''
 * @param {{handle:string,url:string}} args.ig  normalized IG ('' fields when none)
 * @param {{url:string,label:string}} args.fb   normalized FB ('' url when none)
 * @param {string[]} args.galleryFiles
 * @param {boolean}  args.hasLogo
 * @returns {{ogImage:string, jsonLd:string}}
 */
function buildSeo({ business, footer, contact, ig, fb, galleryFiles, hasLogo }) {
    const ogImage =
        (galleryFiles && galleryFiles[0]) ? `images/${galleryFiles[0]}`
        : hasLogo                          ? 'images/logo.jpg'
        : '';

    const name        = (business && business.name) || '';
    const description = (business && business.metaDescription) || '';
    const address     = (footer && footer.address) || '';   // PLAIN text (no HTML)
    const phone       = (contact && contact.whatsapp) ? `+${contact.whatsapp}` : '';
    const sameAs      = [ig && ig.url, fb && fb.url].filter(Boolean);

    // Only emit JSON-LD if there's something genuinely useful to describe.
    const useful = name || description || address || phone || sameAs.length;
    if (!useful) return { ogImage, jsonLd: '' };

    const ld = { '@context': 'https://schema.org', '@type': 'LocalBusiness' };
    if (name)          ld.name = name;
    if (description)   ld.description = description;
    if (address)       ld.address = address;
    if (phone)         ld.telephone = phone;
    if (sameAs.length) ld.sameAs = sameAs;

    // JSON.stringify, then make it safe to embed inside a <script> element by
    // neutralizing any "<" (covers a smuggled "</script>" sequence).
    const jsonLd = JSON.stringify(ld).replace(/</g, '\\u003c');
    return { ogImage, jsonLd };
}

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

/** Human-readable WhatsApp number for display next to the WhatsApp link.
 *  Keeps only phone-ish characters; preserves a leading '+' the owner typed,
 *  otherwise prefixes one. Empty when skipped. Rendered HTML-escaped by the template. */
function formatWhatsappDisplay(raw) {
    if (isSkip(raw)) return '';
    const cleaned = String(raw).trim().replace(/[^\d+\-() ]/g, '').replace(/\s+/g, ' ').trim();
    const digits = cleaned.replace(/\D/g, '');
    if (!digits) return '';
    return cleaned.startsWith('+') ? cleaned : '+' + digits;
}

/** Default pre-filled WhatsApp inquiry message (Romanian). Env: WA_DEFAULT_MSG. */
const WA_DEFAULT_MSG = process.env.WA_DEFAULT_MSG || 'Salut! Aș vrea mai multe informații despre serviciile dumneavoastră.';

/** Build a wa.me link that opens WhatsApp with a message ready to send. Empty on skip. */
function buildWaHref(raw, msg) {
    if (isSkip(raw)) return '';
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return '';
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg || WA_DEFAULT_MSG);
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

    // CONTRACT §2: skipped contacts become '' (empty), NOT '#', so the template can
    // @if-hide them.
    const contact = {
        title: 'Contactează-ne',
        intro: 'Scrie-ne un mesaj direct sau vizitează-ne.',
        instagram: { url: ig ? ig.url : '', label: ig ? '@' + ig.handle : 'Instagram' },
        facebook:  { url: fb ? fb.url : '', label: fb ? fb.label : 'Facebook' },
        whatsapp:  isSkip(data.whatsapp) ? '' : String(data.whatsapp).replace(/\D/g, ''),
        phone:        isSkip(data.whatsapp) ? '' : '+' + String(data.whatsapp).replace(/\D/g, ''),
        phoneDisplay: formatWhatsappDisplay(data.whatsapp),
        waHref:       buildWaHref(data.whatsapp),
        address:   isSkip(data.address)  ? '' : formatAddressHtml(data.address),
        addressHref: isSkip(data.address) ? '' : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(data.address).replace(/\n/g, ', ')),
    };

    const categories = [
        {
            title:  '',
            blurb:  '',
            photos: galleryFiles.map((f, i) => ({ src: `images/${f}`, alt: `${data.name || 'Produs'} ${i + 1}` })),
        },
    ];

    const business = {
        name:            data.name || '',
        tagline:         data.tagline || '',
        title:           `${data.name || ''}`,
        metaDescription: (data.about || '').slice(0, 160),
        about:           data.about || '',
        lang:            'ro',
    };
    const footer = {
        address: isSkip(data.address) ? '' : String(data.address).replace(/\n/g, ', '),
        year:    new Date().getFullYear(),
        note:    'Creat cu drag.',
    };

    return {
        business,
        labels: defaultLabels(),
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
            url:     ig ? ig.url : '',
            gallery: ig ? galleryFiles.slice(0, 6).map(f => 'images/' + f) : [],
        },
        contact,
        seo: buildSeo({ business, footer, contact, ig: ig || { handle: '', url: '' }, fb: fb || { url: '', label: '' }, galleryFiles, hasLogo }),
        footer,
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

    // CONTRACT §1: RO UI labels always present. The AI may refine titles, so we merge
    // any string labels it provided over the RO defaults (ignoring non-strings).
    const baseLabels = defaultLabels();
    const aiLabels   = (cfg.labels && typeof cfg.labels === 'object') ? cfg.labels : {};
    cfg.labels = {
        about:       typeof aiLabels.about       === 'string' && aiLabels.about.trim()       ? aiLabels.about       : baseLabels.about,
        instaTitle:  typeof aiLabels.instaTitle  === 'string' && aiLabels.instaTitle.trim()  ? aiLabels.instaTitle  : baseLabels.instaTitle,
        instaFollow: typeof aiLabels.instaFollow === 'string' && aiLabels.instaFollow.trim() ? aiLabels.instaFollow : baseLabels.instaFollow,
        scroll:      typeof aiLabels.scroll      === 'string' && aiLabels.scroll.trim()      ? aiLabels.scroll      : baseLabels.scroll,
    };

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

    // Contacts — normalized from the owner's raw input (AI only gave title/intro).
    // CONTRACT §2: skipped contacts become '' (NOT '#') so the template can @if-hide them.
    const aiContact = cfg.contact || {};
    cfg.contact = {
        title: aiContact.title || 'Contactează-ne',
        intro: aiContact.intro || 'Scrie-ne un mesaj direct sau vizitează-ne.',
        instagram: { url: ig ? ig.url : '', label: ig ? '@' + ig.handle : 'Instagram' },
        facebook:  { url: fb ? fb.url : '', label: fb ? fb.label : 'Facebook' },
        whatsapp:  isSkip(data.whatsapp) ? '' : String(data.whatsapp).replace(/\D/g, ''),
        phone:        isSkip(data.whatsapp) ? '' : '+' + String(data.whatsapp).replace(/\D/g, ''),
        phoneDisplay: formatWhatsappDisplay(data.whatsapp),
        waHref:       buildWaHref(data.whatsapp),
        address:   isSkip(data.address)  ? '' : formatAddressHtml(data.address),
        addressHref: isSkip(data.address) ? '' : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(data.address).replace(/\n/g, ', ')),
    };

    // Instagram photo-grid section (handle/url '' and gallery [] when no IG)
    cfg.instagram = {
        handle:  ig ? ig.handle : '',
        url:     ig ? ig.url : '',
        gallery: ig ? galleryFiles.slice(0, 6).map(f => 'images/' + f) : [],
    };

    // Footer
    cfg.footer = {
        address: isSkip(data.address) ? '' : String(data.address).replace(/\n/g, ', '),
        year:    new Date().getFullYear(),
        note:    (cfg.footer && cfg.footer.note) || 'Creat cu drag.',
    };

    // CONTRACT §3: SEO (ogImage + </script>-safe LocalBusiness JSON-LD). Built from the
    // finalized business/footer/contact above so address is PLAIN and phone is the
    // normalized whatsapp.
    cfg.seo = buildSeo({
        business: cfg.business,
        footer:   cfg.footer,
        contact:  cfg.contact,
        ig:       ig || { handle: '', url: '' },
        fb:       fb || { url: '', label: '' },
        galleryFiles,
        hasLogo,
    });

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

    // Vercel-safe project/deploy name: lowercase [a-z0-9-], Math.abs(chatId) suffix,
    // bounded length, no leading/trailing dash. Also keeps siteDir path-safe.
    const slug    = safeProjectName(name, chatId);
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
 * Deploy the built site. Provider precedence:
 *   1. Cloudflare Pages — when DEPLOY_PROVIDER=cloudflare AND CF creds are set
 *      (free tier is commercial-OK; each site gets https://<slug>.pages.dev)
 *   2. Vercel (current default — unchanged until the migration is flipped)
 *   3. Netlify (legacy fallback)
 * Returns the live URL string, or null if nothing is configured.
 *
 * @param {string} siteDir
 * @param {string} slug
 * @param {number|string} chatId
 * @returns {Promise<{url:string|null, projectId:string|null}>}
 */
async function deployBuiltSite(siteDir, slug, chatId) {
    const prefer = String(process.env.DEPLOY_PROVIDER || '').toLowerCase();
    if (prefer === 'cloudflare' && cfDeploy.isConfigured()) {
        const result = await cfDeploy.deploySite(siteDir, { name: slug });
        return { url: result.url, projectId: result.projectId || slug, provider: 'cloudflare' };
    }
    if (prefer === 'cloudflare' && !cfDeploy.isConfigured()) {
        console.warn('[deploy] DEPLOY_PROVIDER=cloudflare but CLOUDFLARE_* env missing — falling back to Vercel/Netlify.');
    }

    if (vercelDeployOk()) {
        const result = await deploySite(siteDir, { name: slug });
        return { url: result.url, projectId: result.projectId || slug, provider: 'vercel' };
    }

    const netlifyToken = process.env.NETLIFY_TOKEN;
    if (netlifyToken) {
        const existingId = loadSitesMap()[chatId];
        const result = await deployToNetlify(siteDir, netlifyToken, existingId);
        saveSiteId(chatId, result.siteId);
        return { url: result.url, projectId: null, provider: 'netlify' };
    }

    return { url: null, projectId: null, provider: null };
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

    // This flow collects personal/business data and issues payments — only in 1:1 chats.
    if (!isPrivateChat(ctx)) {
        return ctx.reply('👋 Scrie-mi în privat (mesaj direct) ca să-ți construiesc site-ul. Aici, într-un grup, nu pot.');
    }

    // Returning from a checkout deep-link (t.me/bot?start=paid|cancel): NEVER reset a
    // session that is mid-payment/publish, or we'd orphan the paid-but-unpublished build.
    const payload  = (ctx.match || '').toString().trim().toLowerCase();
    const existing = sessions.get(chatId);
    if ((payload === 'paid' || payload === 'cancel') && existing &&
        (existing.phase === 'pay' || existing.phase === 'deploy')) {
        if (payload === 'cancel') {
            return ctx.reply('Ai întrerupt plata. Redeschide linkul de plată ca să finalizezi, sau scrie /anuleaza ca să o iei de la capăt.');
        }
        // Leftover start=paid deep-link: Telegram does not publish. Steer to same Hidook draft.
        return ctx.reply(
            '✅ Mulțumim! Continuă în builderul Hidook Site Builder — deschide același draft în /app/ ' +
            'ca să editezi și să plătești înainte de publicare. Publicarea live nu se face din Telegram.'
        );
    }

    const session = resetSession(chatId);
    session.phase     = 'wizard';
    session.stepIndex = 0;
    // Welcome: Telegram is intake only — same unpaid Hidook builder draft; pay/publish in /app/.
    await ctx.reply(
        '👋 Salut! Îți construiesc un site web profesional pentru afacerea ta.\n\n' +
        'Îți pun câteva întrebări scurte despre afacere, apoi un AI îți aranjează frumos ' +
        'textele și culorile. După aceea deschid același draft în builderul Hidook, unde ' +
        'poți edita și plăti înainte de publicare. Hai să începem!\n\n' +
        'Oricând poți scrie /anuleaza ca să o iei de la capăt.\n\n' +
        consentNote()
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
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        const appHint = publicUrl ? `${publicUrl}/app/` : '/app/';
        return ctx.reply(
            'Ai o comandă deja PLĂTITĂ — nu o anulez ca să nu pierzi banii. ' +
            `Continuă în builderul Hidook (${appHint}) — acolo editezi și publici după plată. ` +
            'Scrie /retry dacă vrei din nou linkul către builder.'
        );
    }
    resetSession(chatId);
    await ctx.reply('🔄 Am resetat sesiunea. Scrie /start ca să o iei de la capăt.');
}

/**
 * /sterge — GDPR data deletion. Permanently removes the user's session, temp uploads,
 * built site folder and any site-map entry, then confirms. Refuses to wipe a PAID,
 * not-yet-published order (that would lose the customer's money + the thing they paid
 * for) — they must finish or contact support first.
 */
async function handleSterge(ctx) {
    const chatId = ctx.chat.id;
    const s = sessions.get(chatId);

    // Guard a paid-but-unpublished order, same as /anuleaza.
    if (s && (s.phase === 'deploy' || s.phase === 'paid-needs-retry')) {
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        const appHint = publicUrl ? `${publicUrl}/app/` : '/app/';
        return ctx.reply(
            'Ai o comandă deja PLĂTITĂ — nu o pot șterge acum ca să nu pierzi banii. ' +
            `Continuă în builderul Hidook (${appHint}) — acolo editezi și publici după plată; ` +
            'după aceea poți cere ștergerea datelor. Scrie /retry dacă vrei din nou linkul către builder.'
        );
    }

    // 1) Temp uploads
    try { fs.rmSync(path.join(SITES_DIR, '_tmp-' + chatId), { recursive: true, force: true }); } catch (_) {}
    // 2) Built site folder (if any was generated)
    try {
        if (s && s.siteDir) fs.rmSync(s.siteDir, { recursive: true, force: true });
    } catch (_) {}
    // 3) Netlify site-map entry
    try {
        const m = loadSitesMap();
        if (Object.prototype.hasOwnProperty.call(m, chatId)) {
            delete m[chatId];
            fs.writeFileSync(SITES_MAP_FILE, JSON.stringify(m, null, 2));
        }
    } catch (_) {}
    // 4) Registry sites for this chat — mark deleted (GDPR). Do not replace a
    // live URL with an expiry placeholder; mark deleted (pay-before-publish).
    try {
        const tgUser = registry.getOrCreateUserByTelegram(chatId);
        const regSites = registry.listSites(tgUser.id);
        for (const site of regSites) {
            if (site.status === 'deleted') continue;
            registry.updateSite(site.id, { status: 'deleted', url: null });
        }
    } catch (_) {}
    // 5) Session itself — remove entirely (not just reset) and flush durably.
    sessions.delete(chatId);
    flushSessions();

    await ctx.reply(
        '🗑️ Am șters toate datele tale (sesiune, poze încărcate, fișierele site-ului și site-urile înregistrate) din sistemele noastre.\n\n' +
        'Scrie /start oricând ca să începi din nou.'
    );
}

/**
 * /retry — leftover paid-needs-retry / deploy sessions: steer to builder (no TG deploy).
 */
async function handleRetry(ctx) {
    const chatId  = ctx.chat.id;
    const session = getSession(chatId);

    // Legacy in-memory retry → builder only (S11)
    if (session.phase === 'paid-needs-retry' || session.phase === 'deploy') {
        await _publishAndFinish(ctx, session, chatId);
        return;
    }
    if (session.phase === 'pay') {
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        const appHint = publicUrl ? `${publicUrl}/app/` : '/app/';
        return ctx.reply(
            'Încă aștept confirmarea plății pe calea veche din Telegram. ' +
            `Continuă în builder (${appHint}) — acolo editezi și plătești înainte de publicare.`
        );
    }

    // Registry leftover needs-retry: never deploy from Telegram — steer to builder (S42).
    try {
        const tgUser = registry.getOrCreateUserByTelegram(chatId);
        const regSites = registry.listSites(tgUser.id).filter(s => s.status === 'needs-retry');
        if (regSites.length > 0) {
            const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
            const appHint = publicUrl ? `${publicUrl}/app/` : '/app/';
            return ctx.reply(
                'Ai o ciornă neterminată legată de contul tău. ' +
                `Continuă în builderul Hidook (${appHint}) — acolo editezi și publici după plată. ` +
                'Publicarea live nu se mai face din Telegram.'
            );
        }
    } catch (_) {}

    return ctx.reply('Nu ai o sesiune de reluat. Scrie /start ca să creezi un site.');
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

    // 1b) Image moderation — read the uploaded image buffers from the temp dir and
    //     gate them BEFORE building/publishing (generateSite consumes the temp dir).
    //     If anything is blocked, refuse with the reason and reset — never publish.
    if (typeof ai.moderateImages === 'function') {
        try {
            const buffers = _collectTmpImageBuffers(chatId, session);
            if (buffers.length) {
                const verdict = await ai.moderateImages(buffers, 'ro');
                if (verdict && verdict.blocked) {
                    await ctx.reply('🚫 ' + (verdict.reason || 'Una dintre imagini nu respectă regulile noastre.') + '\n\nScrie /start ca să încerci din nou cu alte poze.');
                    resetSession(chatId);
                    return;
                }
            }
        } catch (e) {
            // A transient moderation failure must not block a legitimate client; log and proceed.
            console.error('[moderateImages error]', e);
        }
    }

    // 2) Build the site from the (polished or fallback) config
    try {
        await generateSite(chatId, session);
    } catch (e) {
        console.error('[/gata error]', e);
        await ctx.reply('❌ Eroare la generarea site-ului: ' + e.message + '\nScrie /anuleaza și încearcă din nou.');
        return;
    }

    // 3) Pay-before-publish: register draft + checkout (no unpaid live deploy)
    await _prepareCheckoutAndFinish(ctx, session, chatId);
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

    // ----- PAY (legacy sessions still in-flight) -----
    // No new Telegram checkout/deploy happy path — steer to the browser builder.
    if (session.phase === 'pay') {
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        const appHint = publicUrl ? `${publicUrl}/app/` : '/app/';
        await ctx.reply(
            'Această plată din Telegram nu mai e calea comercială.\n\n' +
            `Continuă în site builder (${appHint}) — acolo editezi ciorna și plătești înainte de publicare.\n` +
            'Dacă ai deja un link de plată vechi și ai probleme, scrie /anuleaza și /start din nou.'
        );
        return;
    }

    // ----- DEPLOY (legacy) -----
    if (session.phase === 'deploy') {
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        const appHint = publicUrl ? `${publicUrl}/app/` : '/app/';
        await ctx.reply(
            'Publicarea din Telegram e pe cale de a fi înlocuită de builder.\n\n' +
            `Deschide ${appHint} ca să vezi proiectele tale. Dacă ai o comandă deja plătită, scrie /retry.`
        );
        return;
    }
}

// ---------------------------------------------------------------------------
// After build: register draft + checkout (pay before first public publish)
// ---------------------------------------------------------------------------

/** Commercial catalog ids (S3). Never patiserie / removed verticals. */
const CATALOG_TEMPLATE_IDS = new Set(['product-menu', 'local-service', 'portfolio']);

/**
 * Resolve templateId for a Telegram intake draft.
 * Prefer session picker (session.templateId), then session.data.templateId, else catalog default.
 */
function resolveIntakeTemplateId(session) {
    const raw =
        (session && session.templateId) ||
        (session && session.data && session.data.templateId) ||
        'product-menu';
    return CATALOG_TEMPLATE_IDS.has(raw) ? raw : 'product-menu';
}

/**
 * Telegram intake finish — same draft as the browser builder.
 * 1. Register draft site (getOrCreateUserByTelegram + createSite; unpaid draft).
 * 2. Do NOT deploy. Do NOT create a Telegram Stripe/Revolut checkout.
 * 3. Magic-link via createLoginToken + /auth/verify so the user opens that draft in /app/.
 * 4. Pay stays browser /api/publish (platform: web).
 *
 * Exported as finishTelegramIntake for tests; _prepareCheckoutAndFinish kept as alias.
 */
async function finishTelegramIntake(ctx, session, chatId) {
    const bizName = (session.siteConfig && session.siteConfig.business && session.siteConfig.business.name)
        || (session.data && session.data.name)
        || 'necunoscut';

    const tgUser = registry.getOrCreateUserByTelegram(chatId, {
        username:  ctx.from && ctx.from.username,
        firstName: ctx.from && ctx.from.first_name,
    });

    const slug = session.siteSlug || safeProjectName(bizName, chatId);
    const templateId = resolveIntakeTemplateId(session);
    const templateVersion = (session && session.templateVersion != null)
        ? session.templateVersion
        : null;

    const regSite = registry.createSite({
        userId:          tgUser.id,
        templateId,
        templateVersion,
        slug,
        platform:    'telegram',
    });

    registry.updateSite(regSite.id, {
        ownerChatId: String(chatId),
        businessName: bizName,
        status: 'draft',
        paid: false,
    });
    session.registrySiteId = regSite.id;

    let config = null;
    try {
        const cfgPath = path.join(session.siteDir, 'config.json');
        config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (_) {}
    if (config) {
        try { registry.saveVersion(regSite.id, config); } catch (_) {}
    }

    const price = pricing.getPricing();
    const fee = String(price.amount);
    const cur = String(price.currency).toUpperCase();
    const domainMsg = CONTACT_URL
        ? `Vrei domeniul tău propriu (ex: firma-ta.ro)? ${CONTACT_URL}`
        : 'Vrei domeniul tău propriu (ex: firma-ta.ro)? Scrie-ne și îl setăm noi pentru tine.';

    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    let builderUrl = publicUrl ? `${publicUrl}/app/` : '/app/';
    try {
        const { token } = registry.createLoginToken({
            userId: tgUser.id,
            siteId: regSite.id,
            purpose: 'telegram-intake',
        });
        builderUrl = publicUrl
            ? `${publicUrl}/auth/verify?token=${token}`
            : `/auth/verify?token=${token}`;
    } catch (e) {
        console.error('[finishTelegramIntake] createLoginToken failed', e);
    }

    notifyAdmin(`📝 Draft Telegram → builder: "${bizName}" (chat ${chatId}) site=${regSite.id}`);
    _ledger('draft_ready', { chatId, siteId: regSite.id });

    await ctx.reply(
        `✅ Ciorna *${bizName}* e gata în site builder.\n\n` +
        `Continuă în editor ca să editezi textele/pozele și să publici după plată ` +
        `(*${fee} ${cur}*, include 12 luni hosting; reînnoire ${price.renewal} ${cur}/an):\n` +
        `👉 ${builderUrl}\n\n` +
        `${domainMsg}\n\n` +
        'Plata și publicarea live se fac din builder — nu din Telegram. ' +
        'Scrie /start oricând pentru un site nou.'
    );

    session.phase     = 'done';
    session.published = false;
    sessions.delete(chatId);
    flushSessions();
}

/** @deprecated name — calls finishTelegramIntake (no Telegram checkout). */
async function _prepareCheckoutAndFinish(ctx, session, chatId) {
    return finishTelegramIntake(ctx, session, chatId);
}

/**
 * Builder URL for a leftover Telegram session: magic-link when registry site exists,
 * otherwise plain /app/. Same intake pattern as finishTelegramIntake — no new checkout.
 */
function _builderUrlForSession(session, chatId, from) {
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    let builderUrl = publicUrl ? `${publicUrl}/app/` : '/app/';
    const siteId = session && session.registrySiteId;
    if (!siteId) return builderUrl;
    try {
        const tgUser = registry.getOrCreateUserByTelegram(chatId, {
            username:  from && from.username,
            firstName: from && from.first_name,
        });
        const site = registry.getSite(siteId);
        if (!site || site.userId !== tgUser.id) return builderUrl;
        const { token } = registry.createLoginToken({
            userId: tgUser.id,
            siteId,
            purpose: 'telegram-intake',
        });
        builderUrl = publicUrl
            ? `${publicUrl}/auth/verify?token=${token}`
            : `/auth/verify?token=${token}`;
    } catch (e) {
        console.error('[_builderUrlForSession] createLoginToken failed', e);
    }
    return builderUrl;
}

/**
 * Close a legacy pay/deploy session and steer the user to the Hidook builder draft.
 * Does NOT deploy. Does NOT open Telegram checkout.
 */
async function _steerSessionToBuilder(ctx, session, chatId, leadText) {
    const builderUrl = _builderUrlForSession(session, chatId, ctx && ctx.from);
    const lead = leadText ||
        'Continuă în builderul Hidook — acolo editezi ciorna și plătești înainte de publicare.';
    await ctx.reply(
        `${lead}\n\n` +
        `👉 ${builderUrl}\n\n` +
        'Plata și publicarea live se fac din builder (/app/) — nu din Telegram. ' +
        'Scrie /start oricând pentru un site nou.'
    );
    if (session) {
        session._publishing = false;
        session.published = false;
        session.phase = 'done';
        delete session.liveUrl;
    }
    sessions.delete(chatId);
    flushSessions();
    _ledger('steer_builder', { chatId, siteId: session && session.registrySiteId });
}

// ---------------------------------------------------------------------------
// Payment phase (LEGACY — for sessions created before pay-before-publish)
// ---------------------------------------------------------------------------

async function _initiatePayment(ctx, session, chatId) {
    const price = pricing.getPricing();
    const amountCents = price.amountCents;

    if (!stripeOk() || amountCents <= 0) {
        if (process.env.ALLOW_FREE_PUBLISH !== '1') {
            console.error('[payment] provider not configured and ALLOW_FREE_PUBLISH != 1 — refusing free publish for chat', chatId);
            notifyAdmin(`🚨 Plata NECONFIGURATĂ — am refuzat publicarea gratuită pentru chat ${chatId}.`);
            await ctx.reply('⚠️ Momentan nu pot finaliza plata. Am anunțat echipa — te rugăm încearcă din nou mai târziu.');
            session.phase = 'done';
            return;
        }
        // Dev path: no Telegram live deploy — same unpaid builder draft.
        await ctx.reply('ℹ️ Plata nu e configurată (mod dev). Te trimit în builder...');
        await _steerSessionToBuilder(ctx, session, chatId,
            'ℹ️ Mod dev: deschide builderul Hidook ca să editezi ciorna (fără deploy din Telegram).');
        return;
    }

    const productName = 'Hidook Site Builder';
    const uname       = getBotUsername();
    const successUrl  = `https://t.me/${uname}?start=paid`;
    const cancelUrl   = `https://t.me/${uname}?start=cancel`;

    let checkoutId, checkoutUrl;
    try {
        const checkout = await createCheckout({
            amountCents,
            currency:    price.currency,
            productName,
            successUrl,
            cancelUrl,
            metadata: { chatId: String(chatId), platform: 'telegram' },
            clientReferenceId: `tg-${chatId}`,
        });
        checkoutId  = checkout.id;
        checkoutUrl = checkout.url;
    } catch (e) {
        console.error('[createCheckout error]', e);
        await ctx.reply('❌ Eroare la crearea sesiunii de plată: ' + e.message);
        return;
    }

    session.stripeSessionId = checkoutId;
    session.payStartedAt    = Date.now();
    _ledger('checkout', { chatId, amountCents, currency: price.currency });

    const total = (amountCents / 100).toFixed(2);
    const curLabel = String(price.currency).toUpperCase();
    // Legacy helper remains uncalled from /start; copy must not promise TG deploy.
    await ctx.reply(
        `💳 Total de plată: *${total} ${curLabel}*\n\n` +
        `👉 [Plătește aici](${checkoutUrl})\n\n` +
        '_Această cale e învechită. După confirmare te trimit în builderul Hidook — ' +
        'publicarea live se face din /app/, nu din Telegram._'
    );

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
                const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
                const appHint = publicUrl ? `${publicUrl}/app/` : '/app/';
                await ctx.reply(
                    '⏳ Încă n-am primit confirmarea plății. Verific în continuare automat. ' +
                    `Poți continua oricând în builderul Hidook (${appHint}) — acolo editezi și plătești înainte de publicare. ` +
                    '(Sau scrie /anuleaza ca să renunți.)'
                );
                return;
            }
            // Paid legacy session: never deploy from Telegram — steer to same builder draft.
            _ledger('paid', { chatId, via: 'poller', sessionId: checkoutId });
            await _steerSessionToBuilder(ctx, session, chatId,
                '✅ Plată confirmată. Publicarea live nu se mai face din Telegram — ' +
                'continuă în builderul Hidook (edit + plată/publicare în /app/).');
        })
        .catch(async (e) => {
            console.error('[pollPayment error]', e);
            await ctx.reply('⏳ Verificarea plății a întâmpinat o problemă temporară; reîncerc automat în curând.');
        })
        .finally(() => activePolls.delete(chatId));
}

/**
 * Handle a signature-verified Stripe webhook event.
 *
 * Dispatcher:
 *   1. Registry orders (browser /api/publish) → webpublish.handleStripePaid.
 *   2. Legacy in-memory Telegram pay sessions → steer to builder (NO deploy).
 *
 * @param {object} event  Parsed Stripe event.
 * @returns {Promise<{handled: boolean, reason?: string}>}
 */
async function handleStripeWebhookEvent(event) {
    const type = event && event.type;
    if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
        return { handled: false, reason: 'ignored event type' };
    }

    const cs = event.data && event.data.object;
    if (!cs || cs.payment_status !== 'paid') {
        return { handled: false, reason: 'not paid yet' };
    }

    // 1. Try registry-based handling first (browser pay / durable orders)
    try {
        const orderInRegistry = registry.getOrderBySession(cs.id);
        if (orderInRegistry) {
            await webpublish.handleStripePaid(event, {
                messenger:   sendMessageRaw,
                notifyAdmin: adminNotify,
            });
            _ledger('paid', { via: 'webhook-registry', sessionId: cs.id });
            return { handled: true, reason: 'registry order handled' };
        }
    } catch (e) {
        console.error('[handleStripeWebhookEvent] registry path error:', e.message);
        // Fall through to legacy
    }

    // 2. Legacy: in-memory session lookup by chatId metadata — NO Telegram deploy
    const rawChatId = cs.metadata && cs.metadata.chatId;
    if (!rawChatId) return { handled: false, reason: 'no chatId metadata' };
    const chatId  = Number(rawChatId);
    const session = sessions.get(chatId) || sessions.get(String(rawChatId));
    if (!session) {
        _ledger('paid', { chatId, via: 'webhook', sessionId: cs.id, note: 'no-session' });
        return { handled: true, reason: 'no session (already finished?)' };
    }
    if (session.stripeSessionId && session.stripeSessionId !== cs.id) {
        return { handled: false, reason: 'checkout session id mismatch' };
    }
    if (session.published || session._publishing) {
        return { handled: true, reason: 'already published/publishing' };
    }
    if (session.phase !== 'pay' && session.phase !== 'deploy' && session.phase !== 'paid-needs-retry') {
        return { handled: false, reason: `unexpected phase ${session.phase}` };
    }

    _ledger('paid', { chatId, via: 'webhook', sessionId: cs.id });
    const ctx = _ctxShim(chatId);
    await _steerSessionToBuilder(ctx, session, chatId,
        '✅ Plată confirmată. Publicarea live nu se mai face din Telegram — ' +
        'continuă în builderul Hidook (edit + plată/publicare în /app/).');
    return { handled: true, reason: 'legacy steered to builder' };
}

// ---------------------------------------------------------------------------
// Legacy "publish" phase — S11: no longer deploys; steers to builder
// ---------------------------------------------------------------------------

/** @deprecated kept for callers; does not deploy. Prefer browser /api/publish. */
async function _deployWithRetry(siteDir, slug, chatId, attempts = 3) {
    // Intentionally unused by active Telegram paths after S11.
    void siteDir; void slug; void chatId; void attempts;
    throw new Error('Telegram deploy path removed; use builder /app/ publish');
}

/**
 * LEGACY name kept for reconcilePending / handleRetry.
 * S11: does NOT deploy. Steers leftover sessions to the Hidook builder draft.
 */
async function _publishAndFinish(ctx, session, chatId) {
    if (session && session.published && session.liveUrl) {
        await ctx.reply(
            `✅ Ai deja un URL salvat dintr-o sesiune veche:\n👉 ${session.liveUrl}\n\n` +
            'Pentru editări și republicare folosește builderul Hidook (/app/).'
        );
        sessions.delete(chatId);
        flushSessions();
        return;
    }
    if (session && session._publishing) return;
    await _steerSessionToBuilder(ctx, session, chatId,
        'Publicarea din Telegram nu mai e disponibilă. Continuă în builderul Hidook ' +
        'ca să editezi ciorna și să publici după plată din /app/.');
}

// ---------------------------------------------------------------------------
// /help and /preturi
// ---------------------------------------------------------------------------

async function handleHelp(ctx) {
    const domainMsg = CONTACT_URL
        ? `Domeniu propriu? Scrie-ne: ${CONTACT_URL}`
        : 'Domeniu propriu (ex: firma-ta.ro)? Scrie-ne și îl setăm noi pentru tine.';
    const p = pricing.getPricing();
    const fee = String(p.amount);
    const cur = String(p.currency).toUpperCase();
    await ctx.reply(
        '🤖 Cum funcționează?\n\n' +
        'Îți pregătesc un site web profesional; publicarea live se face după plată.\n\n' +
        `1️⃣ Scrie /start și povestește-mi despre afacere (nume, ce vinzi, contacte).\n` +
        `2️⃣ Trimite câteva poze cu produsele tale.\n` +
        `3️⃣ Aleg textele, culorile și construiesc ciorna.\n` +
        `4️⃣ Plătești ${fee} ${cur} → site LIVE pe HTTPS (include 12 luni hosting).\n` +
        `5️⃣ Reînnoire ${p.renewal} ${cur}/an. Editezi și republici oricând din builder.\n` +
        `6️⃣ ${domainMsg}\n\n` +
        'Comenzi:\n' +
        '/start – construiește un site\n' +
        '/wizard – mod pas-cu-pas (manual)\n' +
        '/preturi – vezi prețurile\n' +
        '/anuleaza – resetează\n' +
        '/sterge – șterge toate datele tale (GDPR)\n\n' +
        'Spune-mi orice despre afacerea ta și începem!'
    );
}

async function handlePreturi(ctx) {
    const p = pricing.getPricing();
    const fee = String(p.amount);
    const cur = String(p.currency).toUpperCase();
    const domainMsg = CONTACT_URL
        ? `Domeniu custom (ex: firma-ta.ro): Scrie-ne la ${CONTACT_URL} și îl setăm noi.`
        : 'Domeniu custom (ex: firma-ta.ro): Scrie-ne și îl setăm noi pentru tine.';
    await ctx.reply(
        '💰 Prețuri\n\n' +
        `• Primul public live: *${fee} ${cur}* (builder + publish + 12 luni hosting gestionat).\n` +
        `• Reînnoire: *${p.renewal} ${cur}*/an.\n` +
        `• ${domainMsg}\n\n` +
        'Nu există perioadă de probă publică neplătită. Scrie /start ca să începem!'
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
    handleStripeWebhookEvent,
    // Handlers
    handleStart,
    handleWizard,
    handleAnuleaza,
    handleSterge,
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
    safeProjectName,
    downloadPhoto,
    buildConfig,
    mergeWizardConfig,
    normalizeInstagram,
    normalizeFacebook,
    generateSite,
    STEPS,
    // Telegram intake → same browser draft (S4)
    finishTelegramIntake,
    resolveIntakeTemplateId,
    // Deploy helper (used by webpublish.js)
    deployBuiltSite,
};
