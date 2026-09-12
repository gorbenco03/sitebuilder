#!/usr/bin/env node
/**
 * build.js — generates index.html from template.html + config.json
 *
 * Zero dependencies. Run with:  node build.js
 *
 * This is the "render" step of the automated product: an AI agent only needs to
 * produce a valid config.json (and drop the images), then run this script to get
 * a ready-to-deploy static site.
 *
 * Template syntax:
 *   {{a.b.c}}                      → value at that dot-path in config
 *   <!-- @each path --> ... <!-- @end -->   → repeats the block for each item in
 *                                   the array at `path`. Inside the block:
 *                                     {{.}}      → the item itself (for string arrays)
 *                                     {{key}}    → item.key (for object arrays)
 */

const fs = require('fs');
const path = require('path');

// Build any site folder:  node build.js [siteDir]   (defaults to this folder)
const ROOT = path.resolve(process.argv[2] || __dirname);
const CONFIG_PATH = path.join(ROOT, 'config.json');
const TEMPLATE_PATH = path.join(ROOT, 'template.html');
const OUTPUT_PATH = path.join(ROOT, 'index.html');

/** Resolve a dot-path like "contact.instagram.url" against an object. */
function resolve(obj, dotPath) {
    return dotPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * HTML-escape a value so user/AI-supplied config can never inject markup into the
 * generated site (stored XSS). Escapes the five HTML-significant characters; this
 * is safe in both text and double/single-quoted attribute contexts (browsers decode
 * entities in attribute values, so e.g. url(&#39;...&#39;) still works in style="").
 */
/**
 * Decode the encodings a browser resolves before it parses a URL scheme, then
 * decide whether what is left is a scheme this product will serve.
 *
 * Two separate layers conspire here, which is why naive checks keep failing:
 *
 *  - The HTML parser decodes character references while reading the attribute,
 *    so the DOM can hold "javascript:" no matter what the source spelled --
 *    numeric (&#106;, &#x6a;) or named (&colon;, &Tab;, &NewLine;).
 *  - The URL parser then removes every ASCII tab and CR/LF wherever it occurs,
 *    so "jav<TAB>ascript:" resolves to "javascript:".
 *
 * We reproduce both, repeatedly until the string stops changing so nested
 * encodings cannot hide a layer, and only then look at the scheme.
 */
function normalizeUrlForSchemeCheck(raw) {
    let value = String(raw == null ? '' : raw);
    const NAMED = {
        colon: ':', COLON: ':',
        Tab: '\t', NewLine: '\n', newline: '\n',
        sol: '/', SOL: '/',
        lpar: '(', rpar: ')', apos: "'", quot: '"',
        semi: ';', NUM: '#', amp: '&', AMP: '&',
    };
    for (let pass = 0; pass < 5; pass++) {
        const before = value;
        value = value
            .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(Number(dec)))
            .replace(/&([a-zA-Z][a-zA-Z0-9]*);?/g, (whole, name) =>
                Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : whole)
            // Control characters a URL parser discards, plus the C0 range that
            // browsers strip from the front of a URL.
            .replace(/[\t\r\n\f\v\u0000-\u001F\u007F]/g, '');
        if (value === before) break;
    }
    return value.trim();
}

/**
 * Allowlist: a URL is safe when it carries no scheme at all (relative path,
 * fragment, query) or carries one this product actually serves. Anything else
 * -- javascript:, data:, vbscript:, and every scheme nobody has thought of --
 * is refused by default rather than by enumeration.
 */
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'sms', 'ftp']);

function isSafeAttributeUrl(rawUrl) {
    const normalized = normalizeUrlForSchemeCheck(rawUrl);
    if (normalized === '') return true;
    // A scheme is [a-z][a-z0-9+.-]* before the first colon, and only counts as
    // one when no /, ? or # appears first -- "foo/bar:baz" is a path.
    const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(normalized);
    if (!m) return true;
    const beforeColon = normalized.slice(0, m.index + m[1].length);
    if (/[/?#]/.test(beforeColon)) return true;
    return SAFE_URL_SCHEMES.has(m[1].toLowerCase());
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitize a URL value so that `javascript:` (and similar dangerous protocol)
 * payloads cannot be injected into href attributes.
 *
 * Allowed protocols: https?, tel:, mailto:, protocol-relative (//).
 * Anything else (including javascript:, data:, vbscript:) is replaced with '#'.
 * Empty/falsy values pass through unchanged (template @if guards handle hiding).
 */
function sanitizeUrl(value) {
    const str = String(value).trim();
    if (!str) return str;
    // Allow safe protocols only.
    if (/^(https?:|tel:|mailto:|\/\/)/i.test(str)) return str;
    console.warn(`  ⚠️  unsafe URL protocol stripped: "${str.slice(0, 60)}"`);
    return '#';
}

/**
 * Raster image data URLs the builder itself produces when a customer replaces a
 * photo. SVG is deliberately excluded — an SVG document can carry <script>.
 */
const SAFE_CSS_DATA_IMAGE =
    /^data:image\/(?:jpeg|jpg|png|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i;

/**
 * Sanitize the url() values inside a CSS style-attribute sink.
 *
 * Kept:    scheme-less paths (images/hero.jpg), protocol-relative, https?:, and
 *          base64 raster data: URLs. The builder stores a replaced photo as a
 *          data: URL, so blanket-blocking that scheme silently erased every
 *          image the customer uploaded in the editor preview.
 * Dropped: javascript:, vbscript:, data:text/html, data:image/svg+xml and any
 *          other scheme — replaced with url(about:blank).
 */
function sanitizeCssUrls(value) {
    // Quoted forms must allow ')' inside the payload — otherwise a value such as
    // url('javascript:alert(1)') slips through the scheme check unmatched.
    return String(value).replace(
        /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi,
        (match, dq, sq, bare) => {
            const inner = dq !== undefined ? dq : (sq !== undefined ? sq : bare);
            const url = String(inner || '').trim();
            // No scheme at all → relative/protocol-relative path, nothing to police.
            if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return match;
            if (/^https?:/i.test(url)) return match;
            if (SAFE_CSS_DATA_IMAGE.test(url.replace(/\s+/g, ''))) return match;
            console.warn(`  ⚠️  unsafe CSS url() scheme stripped: "${url.slice(0, 40)}"`);
            return 'url(about:blank)';
        }
    );
}

/** URL token paths that appear in href attributes and must be sanitized. */
const URL_TOKENS = new Set([
    'contact.waHref',
    'contact.addressHref',
    'contact.instagram.url',
    'contact.facebook.url',
    'instagram.url',
    'instagram.embedUrl',
    'seo.canonical',
]);

/**
 * True only for a real social-feed partner embed (Instafidget / isolated stub / tests).
 * Direct instagram.com (and related) profile URLs are never valid iframe targets —
 * Instagram sets X-Frame-Options: deny and the live site shows a gray hole.
 */
function isConnectedSocialFeedEmbed(url) {
    if (typeof url !== 'string') return false;
    const s = url.trim();
    if (!s) return false;
    if (!/^https?:\/\//i.test(s)) return false;
    try {
        const u = new URL(s);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'instagram.com' || host.endsWith('.instagram.com')) return false;
        if (host === 'instagr.am' || host.endsWith('.instagr.am')) return false;
        if (host === 'facebook.com' || host.endsWith('.facebook.com')) return false;
        if (host === 'fb.com' || host.endsWith('.fb.com')) return false;
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * S111 owner policy: public Instagram section only when Instafidget (or partner) is
 * connected. No direct instagram.com iframe, no empty section, no fake gallery
 * pretending to be a live feed. Mutates the shallow-cloned render config only.
 *
 * S9B: `instagram.gallery` (manual photo list) and `instagram.posts` (never
 * schema-declared on any template) used to be force-cleared here too, on
 * both branches below. No template.html has read either key since S9B
 * removed the markup that once rendered them — this function used to be the
 * ONLY thing standing between a customer-entered gallery/posts value and a
 * fake "live feed" appearing on the public site (see the removed field's
 * schema.json history and bot/test/suite2-string-gallery-in-photos-panel.
 * test.js for the full story) — so with the markup gone there is nothing
 * left for this function to protect on those two keys, and stripping them
 * here would just be busywork on an object no longer read downstream.
 */
function normalizeInstagramForPublic(cfg) {
    if (!cfg || !cfg.instagram || typeof cfg.instagram !== 'object') return;
    const ig = Object.assign({}, cfg.instagram);
    const rawEmbed = typeof ig.embedUrl === 'string' ? ig.embedUrl.trim() : '';
    if (isConnectedSocialFeedEmbed(rawEmbed)) {
        ig.embedUrl = rawEmbed;
        // Section templates gate on handle; keep a stable handle for @line when present.
        if (typeof ig.handle === 'string') ig.handle = ig.handle.trim();
        if (!ig.handle) ig.handle = 'instagram';
    } else {
        // Not connected: omit the whole public Instagram block.
        ig.embedUrl = '';
        ig.handle = '';
    }
    cfg.instagram = ig;
}

/** Return a safe image URL/path already present in customer site data. */
function isUsableSocialImage(value) {
    const image = typeof value === 'string' ? value.trim() : '';
    if (!image || image === '#' || /^about:/i.test(image)) return false;
    if (SAFE_CSS_DATA_IMAGE.test(image.replace(/\s+/g, ''))) return true;
    if (/^https?:\/\//i.test(image) || /^\/\//.test(image)) return true;
    // Relative site assets only; reject protocols and CSS/HTML control characters.
    return !/^[a-z][a-z0-9+.-]*:/i.test(image) && !/[<>{}"'()]/.test(image);
}

/** Extract the first image URL from the structured hero background value. */
function imageFromHeroBackground(value) {
    const css = typeof value === 'string' ? value : '';
    const match = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/i.exec(css);
    if (!match) return '';
    const image = String(match[1] !== undefined ? match[1]
        : (match[2] !== undefined ? match[2] : match[3])).trim();
    return isUsableSocialImage(image) ? image : '';
}

/**
 * Pick social preview artwork automatically: hero first, then an existing
 * business/gallery photo. `seo` is skipped so a legacy pasted URL cannot win.
 */
function deriveSocialImage(config) {
    const heroImage = imageFromHeroBackground(config && config.hero && config.hero.background);
    if (heroImage) return heroImage;

    let found = '';
    function visit(value, parentKey) {
        if (found || value == null || parentKey === 'seo') return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item, '');
            return;
        }
        if (typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (found || key === 'seo') continue;
            if (/^(?:image|imageUrl|photo|logo|src)$/i.test(key)
                && typeof child === 'string'
                && isUsableSocialImage(child)) {
                found = child.trim();
                return;
            }
            visit(child, key);
        }
    }
    visit(config, '');
    return found;
}

/** Backfill customer configs saved before newer visible labels were introduced. */
function normalizeConfigForRender(config) {
    const cfg = Object.assign({}, config);
    const labels = cfg.labels && typeof cfg.labels === 'object'
        ? Object.assign({}, cfg.labels)
        : {};
    if (typeof labels.menuLang !== 'string' || !labels.menuLang.trim()) {
        labels.menuLang = 'Limba meniului';
    }
    cfg.labels = labels;
    if (cfg.appointment && typeof cfg.appointment === 'object') {
        cfg.appointment = Object.assign({}, cfg.appointment);
        // Staged native cutover (VISION §8 e): empty/falsy keeps legacy form.
        // Tenant ids are injected at publish — never invent them here.
        if (cfg.appointment.nativeCustomerId == null) cfg.appointment.nativeCustomerId = '';
        if (cfg.appointment.nativeSiteId == null) cfg.appointment.nativeSiteId = '';
        if (cfg.appointment.nativeBooking == null) cfg.appointment.nativeBooking = '';
        // Empty = same-origin; publish injects CALENDAR_PUBLIC_BASE_URL when set.
        if (cfg.appointment.nativeApiBase == null) cfg.appointment.nativeApiBase = '';
    }
    // Social cards follow the customer's current site photography. Never rely on
    // the removed customer-facing seo.ogImage URL control or a stale saved value.
    cfg.seo = cfg.seo && typeof cfg.seo === 'object' ? Object.assign({}, cfg.seo) : {};
    cfg.seo.ogImage = deriveSocialImage(cfg);
    return cfg;
}

/**
 * Phone number tokens that appear in tel: href attributes.
 * We sanitize these by stripping everything except digits, +, -, (, ), and spaces
 * so that a value like 'javascript:alert(x)' cannot be injected into tel: hrefs.
 * (Modern browsers do not execute javascript: in tel: URIs, but we make the guard
 * explicit and consistent with the URL_TOKENS system.)
 */
const PHONE_TOKENS = new Set(['contact.phone']);

function sanitizePhone(value) {
    const str = String(value).trim();
    if (!str) return str;
    // Keep only characters valid in telephone numbers (E.164 + display variants).
    const stripped = str.replace(/[^0-9+\-() ]/g, '');
    if (stripped !== str) {
        console.warn(`  ⚠️  phone value sanitized (non-phone characters removed): "${str.slice(0, 60)}"`);
    }
    return stripped;
}

/**
 * Sanitize a value destined for {{& seo.jsonLd}} — raw output inside a
 * <script type="application/ld+json"> block.
 *
 * The only dangerous sequence in that context is "</script" (case-insensitive),
 * which can break out of the script element and inject arbitrary HTML.
 * We replace every occurrence with the JSON-safe Unicode escape "<\/script"
 * (the backslash is valid inside a JSON string value and ignored by JSON.parse).
 *
 * We also validate that the value is parseable JSON so a non-JSON string
 * cannot be used as a XSS vector (e.g. injecting a raw script tag as the
 * entire value).  If the value is not valid JSON we drop it and emit an empty
 * ld+json block, which is harmless.
 */
function sanitizeJsonLd(value) {
    const str = String(value);
    // Validate: must parse as JSON (object or array).
    try {
        const parsed = JSON.parse(str);
        if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    } catch (e) {
        console.warn('  ⚠️  seo.jsonLd is not valid JSON — omitting to prevent XSS');
        return '';
    }
    // Escape </script (case-insensitive) inside the JSON string so the browser
    // cannot interpret it as closing the <script> element.
    return str.replace(/<\/script/gi, '<\\/script');
}

/**
 * Replace {{token}} occurrences in `str` using a resolver function.
 *
 * Values are HTML-ESCAPED by default. A token may opt out of escaping with a
 * leading ampersand — `{{& token}}` — but ONLY use that for values the build
 * pipeline itself controls (never raw client/AI input), since it is a stored-XSS
 * sink.  Currently two raw sinks exist:
 *   • {{& seo.jsonLd}}   — sanitised via sanitizeJsonLd() (</script escaped)
 *   • {{& contact.address}} — allowed ONLY <br> tags; all other HTML is stripped
 *
 * `warn` is false during loop/if item-scope passes (a token may legitimately
 * belong to the outer/global scope and gets resolved by the final global pass).
 *
 * `editOpts` (optional): { editMode: bool, pathPrefix: string, inTextCtx: bool }
 *   When editMode is true AND inTextCtx is true the resolved value is wrapped in
 *   <span data-hb-edit="PATH" data-hb-kind="text">VALUE</span> for inline editing.
 *   pathPrefix is prepended to the token to build the full config path.
 *   When inTextCtx is false (we're inside a tag/attribute) no wrapping happens.
 *   Raw sinks ({{& …}}) are never wrapped regardless of context.
 */
function sanitizeAddress(value) {
    // Escape everything, then un-escape only <br> and <br/> (the sole allowed tag).
    return escapeHtml(String(value)).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

/**
 * Editor-only, single-convention placeholder text for an empty
 * `[data-hb-edit]` field — PLAN-QA-2026-09-12 §3 Suite 1 (B2/M1): an empty
 * contenteditable span has nothing to show a user where to click or what to
 * type, on any of the 5 templates. Rather than every template inventing its
 * own wording, one small dictionary here (keyed by the LAST dot-path
 * segment — itemShape has no per-field human label to draw on, only a
 * type) drives a `data-hb-placeholder` attribute; the CSS that paints it is
 * `[data-hb-edit]:empty::before { content: attr(data-hb-placeholder) }` in
 * builder/edit-overlay.js, so it only ever appears when the field is
 * genuinely empty and NEVER in the exported/published HTML (this attribute
 * is inert without that editor-only CSS rule, and edit-overlay.js itself
 * only runs inside editMode's srcdoc — see its file header).
 */
const FIELD_PLACEHOLDER_LABELS = {
    price: 'Adaugă preț',
    blurb: 'Adaugă o descriere…',
    text: 'Adaugă o descriere…',
    bio: 'Adaugă o descriere…',
    description: 'Adaugă o descriere…',
    lead: 'Adaugă textul introductiv',
    subtitle: 'Adaugă un subtitlu',
    label: 'Scrie textul aici…',
    title: 'Scrie titlul aici…',
    name: 'Scrie numele aici…',
    q: 'Scrie întrebarea aici…',
    a: 'Scrie răspunsul aici…',
    role: 'Adaugă rolul',
    day: 'Adaugă ziua',
    hours: 'Adaugă programul',
};
function placeholderLabelForToken(token) {
    if (!token || token === '.') return 'Scrie aici…';
    const last = token.split('.').pop();
    return FIELD_PLACEHOLDER_LABELS[last] || 'Scrie aici…';
}

function replaceTokens(str, resolver, warn = true, editOpts) {
    return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, token) => {
        let raw = false;
        if (token[0] === '&') { raw = true; token = token.slice(1).trim(); }
        const value = resolver(token);
        if (value === undefined || value === null) {
            // Never leave factory mustache in published/preview HTML (S78/S80).
            // Missing keys render empty — stranger-visible {{labels.about}} is a defect.
            if (warn) console.warn(`  ⚠️  unresolved token: {{${token}}} (omitted)`);
            return '';
        }
        if (raw) {
            // Per-sink sanitization — each raw sink must be explicitly handled here.
            if (token === 'seo.jsonLd') return sanitizeJsonLd(value);
            if (token === 'contact.address') return sanitizeAddress(value);
            // CSS style-attribute sinks: escapeHtml is correct here because the HTML
            // parser uses literal (unencoded) characters to find attribute boundaries,
            // so &quot; / &#39; do NOT close the attribute, and the encoded characters
            // decode correctly inside the CSS value (e.g. url(&#39;...&#39;) works).
            // Additionally strip dangerous CSS url() schemes (javascript:, vbscript:,
            // data:text/html, data:image/svg+xml) so they cannot be embedded as
            // background values. Base64 raster data: URLs are kept — that is how the
            // builder stores a photo the customer replaced in the editor.
            if (token === 'hero.background') {
                return escapeHtml(sanitizeCssUrls(value));
            }
            // Inline SVG icons inside @each services blocks — builder/bot-generated,
            // never raw user input. Strip dangerous constructs before emitting so
            // the sink is safe even if config is tampered with:
            //   • <script>…</script> blocks
            //   • on*= event-handler attributes
            //   • javascript: / data: / vbscript: in any attribute value
            //     (covers href, xlink:href, src, action, etc. — case-insensitive,
            //      tolerates URL-encoded colons and whitespace padding)
            //   • <foreignObject>…</foreignObject> (allows HTML injection inside SVG)
            if (token === 'icon') {
                const safe = String(value)
                    // 1. Remove <script> blocks (including content).
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    // 2. Remove <foreignObject> blocks (including content).
                    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
                    // 3. Remove on*= event-handler attributes (replace with harmless marker).
                    .replace(/\bon\w+\s*=/gi, 'data-removed=')
                    // 4. Only allow known-safe URL schemes in attribute values.
                    //
                    //    This was a blocklist -- reject javascript:, data:,
                    //    vbscript: -- and a blocklist keeps losing here. The
                    //    first version missed tab/CR/LF inside the scheme word.
                    //    The second decoded numeric character references and
                    //    still missed NAMED ones, so `javascript&colon;alert(1)`
                    //    and `jav&Tab;ascript:` both executed. Each fix closed
                    //    the variants someone had thought of.
                    //
                    //    An allowlist inverts that: anything carrying a scheme
                    //    this product has no use for is neutralised, whether or
                    //    not anyone anticipated the spelling.
                    .replace(
                        /((?:xlink:)?href|src|action|formaction)\s*=\s*(['"]?)([^"'>]*)/gi,
                        (match, attr, quote, rawUrl) => {
                            return isSafeAttributeUrl(rawUrl)
                                ? match
                                : attr + '=' + quote + '#';
                        }
                    );
                return safe;
            }
            // Fallback: treat unknown raw sinks as regular escaped output (safe default).
            console.warn(`  ⚠️  unknown raw sink {{& ${token}}} — escaping for safety`);
            return escapeHtml(value);
        }
        // Sanitize URL fields before HTML-escaping to block javascript: protocol XSS.
        // Sanitize phone fields to strip non-telephone characters (consistent guard).
        const safeValue = URL_TOKENS.has(token)   ? sanitizeUrl(value)
                        : PHONE_TOKENS.has(token) ? sanitizePhone(value)
                        : value;
        const escaped = escapeHtml(safeValue);

        // editMode: wrap text-context tokens in an editable span.
        if (editOpts && editOpts.editMode && editOpts.inTextCtx) {
            const prefix = editOpts.pathPrefix;
            // Build full config path: for {{.}} on a string array the path IS the prefix.
            const fullPath = token === '.'
                ? (prefix || '.')
                : (prefix ? prefix + '.' + token : token);
            // Baked in unconditionally (not only when currently empty): text
            // edits happen live in the browser without a full re-render (see
            // edit-overlay.js), so a field that starts non-empty and is later
            // cleared by the owner must already carry the attribute the
            // `:empty::before` placeholder CSS reads — see
            // placeholderLabelForToken() doc comment above (B2).
            const placeholderAttr = ' data-hb-placeholder="' + escapeHtml(placeholderLabelForToken(token)) + '"';
            return '<span data-hb-edit="' + fullPath + '" data-hb-kind="text"' + placeholderAttr + '>' + escaped + '</span>';
        }

        return escaped;
    });
}

/**
 * Segment `str` into alternating text/tag regions and call replaceTokens on each.
 *
 * Tag regions (content between < and >) have inTextCtx=false → tokens there are
 * resolved but NOT wrapped in edit spans (they live in attributes/tag bodies).
 * Text regions (content between > and <) have inTextCtx=true → tokens are wrapped.
 *
 * Special handling: <!-- comment --> regions are treated as tag context (not editable).
 * Script/style element content is also treated as non-text-context.
 *
 * editOpts must include { editMode: true, pathPrefix: string }.
 */
function replaceTokensWithEditMode(str, resolver, warn, editOpts) {
    // Fast-path: no edit mode → plain replaceTokens.
    if (!editOpts || !editOpts.editMode) return replaceTokens(str, resolver, warn);

    let out = '';
    let i   = 0;
    const len = str.length;

    // Track whether we're currently inside a <…> tag (or comment/script/style).
    // Start in text context (before any tag).
    let inTag = false;

    // We walk character by character, accumulating runs and flushing them when
    // context switches. This avoids a full HTML parse while being accurate enough
    // for our template syntax (templates are well-formed).
    let runStart = 0;

    function flush(end, isTagCtx) {
        if (end <= runStart) return;
        const chunk = str.slice(runStart, end);
        const opts  = Object.assign({}, editOpts, { inTextCtx: !isTagCtx });
        out += replaceTokens(chunk, resolver, warn, opts);
        runStart = end;
    }

    // Raw-text elements: their CONTENT is not visible editable text — a wrapper
    // <span> inside <style> would corrupt the whole stylesheet (blank page).
    const RAW_TEXT_OPEN = /^<(script|style|title|textarea|noscript)\b/i;

    while (i < len) {
        if (!inTag && str[i] === '<') {
            // Flush the text run just ended.
            flush(i, false);
            inTag = true;
            // Check for comment: <!-- ... -->
            if (str.startsWith('<!--', i)) {
                const closeIdx = str.indexOf('-->', i + 4);
                const end = closeIdx === -1 ? len : closeIdx + 3;
                // Comments are tag-context (not editable).
                flush(i, true); // nothing to flush yet but sets runStart
                runStart = i;
                flush(end, true);
                i = end;
                inTag = false;
                continue;
            }
            // Raw-text element: consume the WHOLE element (open tag + content +
            // close tag) as tag context so its content is never span-wrapped.
            const rawMatch = RAW_TEXT_OPEN.exec(str.slice(i, i + 12));
            if (rawMatch) {
                const tagName  = rawMatch[1].toLowerCase();
                const lower    = str.toLowerCase();
                const closeIdx = lower.indexOf('</' + tagName, i);
                let end;
                if (closeIdx === -1) {
                    end = len;
                } else {
                    const gt = str.indexOf('>', closeIdx);
                    end = gt === -1 ? len : gt + 1;
                }
                runStart = i;
                flush(end, true);
                i = end;
                inTag = false;
                continue;
            }
            runStart = i;
        } else if (inTag && str[i] === '>') {
            // Flush the tag run including the '>'.
            flush(i + 1, true);
            inTag = false;
            runStart = i + 1;
        }
        i++;
    }
    // Flush any trailing content.
    flush(len, inTag);
    return out;
}

/**
 * Find the <!-- @end --> that matches the opening @each whose block starts at
 * `startIndex`, respecting nesting depth. Returns `{ contentEnd, blockEnd }`
 * where `contentEnd` is the index where the matching @end tag begins (i.e. the
 * end of the block body) and `blockEnd` is the index right after that @end tag.
 * Returns null when there is no matching @end.
 */
function findMatchingEnd(str, startIndex) {
    const openRe  = /<!--\s*@(?:each|if)\s+!?[\w.]+\s*-->/g;
    const closeRe = /<!--\s*@end(?:if)?\s*-->/g;
    openRe.lastIndex  = startIndex;
    closeRe.lastIndex = startIndex;

    let depth = 1;
    while (depth > 0) {
        const nextOpen  = openRe.exec(str);
        const nextClose = closeRe.exec(str);

        if (!nextClose) return null; // unmatched @each

        if (nextOpen && nextOpen.index < nextClose.index) {
            depth++;
            openRe.lastIndex  = nextOpen.index  + nextOpen[0].length;
            closeRe.lastIndex = openRe.lastIndex;
        } else {
            depth--;
            if (depth === 0) return { contentEnd: nextClose.index, blockEnd: nextClose.index + nextClose[0].length };
            openRe.lastIndex  = nextClose.index + nextClose[0].length;
            closeRe.lastIndex = openRe.lastIndex;
        }
    }
    return null;
}

/**
 * Expand every <!-- @each path --> ... <!-- @end --> block in `str`, including
 * nested ones, resolving `path` against the current `scope`.
 *
 * For each item the block is processed recursively: inner @each blocks are
 * expanded with the item as their scope FIRST, then the item's own {{token}}s
 * are filled in. This keeps each loop's tokens bound to its own item — an inner
 * `@each photos` inside `@each categories` resolves `photos` on the category,
 * and `{{src}}` on each photo. Top-level/global tokens are left intact here and
 * filled by the final global pass in build().
 *
 * `editOpts` (optional): { editMode: bool, pathPrefix: string }
 *   When editMode is true, tokens inside @each blocks are given indexed paths
 *   such as "services.0.label" so the edit overlay knows which config value to
 *   update.  pathPrefix tracks the current dot-path prefix from outer loops.
 */
function expandEach(str, scope, editOpts) {
    // Matches either <!-- @each path --> or <!-- @if [!]path -->
    const dirRe = /<!--\s*@(each|if)\s+(!?[\w.]+)\s*-->/g;
    let out = '';
    let cursor = 0;

    while (true) {
        dirRe.lastIndex = cursor;
        const m = dirRe.exec(str);
        if (!m) { out += str.slice(cursor); break; }

        out += str.slice(cursor, m.index);          // text before this directive

        const type       = m[1];                    // 'each' | 'if'
        const dataPath   = m[2];
        const blockStart = m.index + m[0].length;
        const match      = findMatchingEnd(str, blockStart);

        if (!match) {
            console.warn(`  ⚠️  unmatched @${type} "${dataPath}" — skipping`);
            out += str.slice(m.index);
            break;
        }

        const block = str.slice(blockStart, match.contentEnd);

        if (type === 'if') {
            // Support negated paths: <!-- @if !path --> renders when the value is falsy.
            const negate = dataPath[0] === '!';
            const resolvedPath = negate ? dataPath.slice(1) : dataPath;
            const ifVal = resolve(scope, resolvedPath);
            // Treat string 'false' / '0' / 'no' / 'nu' as falsy so schema fields declared as
            // type:text with value 'false'/'nu' (e.g. showWordmark, nativeBooking) work with @if.
            const isFalsyString = typeof ifVal === 'string' && /^(false|0|no|nu)$/i.test(ifVal.trim());
            const truthy = Array.isArray(ifVal) ? ifVal.length > 0 : (!isFalsyString && Boolean(ifVal));
            // PLAN-QA-2026-09-12 §3 Suite 1 (M1): `<!-- @if price -->`/`<!-- @if
            // blurb -->` correctly hide an empty optional field on the
            // PUBLISHED site (no empty <p></p>), but in the EDITOR that same
            // guard means the field's [data-hb-edit] span never exists at
            // all -- nothing to click to type a price/description into (an
            // owner adding a service has no way to give it one). Render the
            // block anyway when ALL of this holds:
            //   - editOpts.editMode is on (never on export/publish — see
            //     renderHtml()'s opts.editMode doc comment)
            //   - editOpts.pathPrefix is set, i.e. we are inside an @each
            //     ITEM's own scope (an itemShape leaf), not a page-level
            //     toggle like `@if pricing` or `@if showWordmark`
            //   - the directive is a plain (non-negated) local field name —
            //     dataPath has no dot, so it cannot be a nested @each list
            //     re-check reached through the item
            //   - the value is not an array — an empty `photos` array stays
            //     hidden here; Suite 2 (findPhotoPaths) owns that field, not
            //     this one, and forcing an @each-less shell open for it would
            //     invite a broken half-rendered gallery block
            // The emptied span still gets a placeholder (see
            // placeholderLabelForToken() in replaceTokens()) so it is
            // visible and clickable, not just present.
            //
            // One more guard: `ifVal !== undefined`, i.e. the item genuinely
            // HAS this key (onListAdd() always sets every itemShape key, even
            // to '' — see its own doc comment), just empty/falsy. Without
            // this, product-menu's `<!-- @if empty -->` inside `@each
            // menu.en` would force-render too: "empty" is a synthetic flag
            // no config item has ever actually carried (grep confirms it),
            // so it always resolves to `undefined` and was always meant to
            // stay unreachable — forcing it on would duplicate the category
            // header on every menu section in the editor for no reason.
            const isEditorItemField = !!(
                editOpts && editOpts.editMode && editOpts.pathPrefix &&
                !negate && dataPath.indexOf('.') === -1 && !Array.isArray(ifVal) &&
                ifVal !== undefined && ifVal !== null
            );
            if ((negate ? !truthy : truthy) || isEditorItemField) out += expandEach(block, scope, editOpts);
        } else {
            const value = resolve(scope, dataPath);
            if (!Array.isArray(value)) {
                console.warn(`  ⚠️  @each "${dataPath}" is not an array — skipping`);
            } else {
                out += value.map((item, idx) => {
                    // Build the full dot-path prefix for this loop item, e.g. "services.0"
                    // or "categories.1.photos.2" for nested loops.
                    const outerPrefix = editOpts && editOpts.pathPrefix ? editOpts.pathPrefix + '.' : '';
                    const itemPrefix  = outerPrefix + dataPath + '.' + idx;
                    const itemEditOpts = editOpts
                        ? Object.assign({}, editOpts, { pathPrefix: itemPrefix })
                        : undefined;

                    const expanded = expandEach(block, item, itemEditOpts);   // nested loops, item scope
                    return replaceTokensWithEditMode(expanded, token => {
                        if (token === '.') return item;
                        if (typeof item === 'object' && item !== null) return resolve(item, token);
                        return undefined;
                    }, false, itemEditOpts);   // don't warn: outer/global tokens resolve in the final pass
                }).join('');
            }
        }

        cursor = match.blockEnd;                     // continue after @end/@endif
    }

    return out;
}

/**
 * Section ids that must always render regardless of what `config.sections`
 * claims — Wave 7 guardrail (site owners can add/remove/reorder page
 * sections, but some sections are structural to the product, not
 * decorative). This is enforced HERE, in the render pipeline itself, not
 * only by disabling a button in the builder UI: a hand-edited config.json
 * (a customer's local draft, or a ZIP re-imported by hand) must not be able
 * to drop these sections either.
 *
 * "about" carries the site owner's identity/credentials — a professional
 * services site with no about content reads as fake. "contact" is the
 * entire reason a visitor lands on the page. The legal footer and cookie
 * banner are never candidates for removal in the first place: they are not
 * part of the addressable/removable section set at all (see
 * REORDERABLE_SECTION note below), so no config value can touch them.
 */
const NON_REMOVABLE_SECTION_IDS = new Set(['about', 'contact']);

/**
 * Reorder/remove the top-level `<section id="…">` blocks inside the
 * already-fully-rendered `html` string, according to `sectionsMeta` — an
 * ordered array of `{ id, removed }` read from `config.sections`.
 *
 * Backward compatibility (Wave 7 requirement): a config saved before this
 * feature existed has no `sections` key at all. `renderHtml()` only calls
 * this function when `cfg.sections` is a non-empty array, so such a config
 * takes the exact same code path it always did and produces BYTE-IDENTICAL
 * output — see bot/test/wave7-sections-backward-compat.test.js.
 *
 * Only sections that are (a) present in the rendered HTML as a top-level
 * `<section id="…">…</section>` block AND (b) named in `sectionsMeta` are
 * moved/hidden. Everything else — the hero (no id, always first), the
 * footer/legal/cookie-banner markup (no id, always last/fixed), and any
 * section id NOT mentioned in `sectionsMeta` — is left exactly where the
 * template already puts it. A section marked removed is skipped UNLESS its
 * id is in NON_REMOVABLE_SECTION_IDS, in which case the removal is ignored
 * and the section renders anyway (server-side guardrail).
 *
 * Implemented as a post-process over the rendered string (not a template
 * change) because templates/*\/template.html is owned by a different wave
 * this cycle; see HANDOFF-sections.md.
 */
function reorderSections(html, sectionsMeta) {
    if (!Array.isArray(sectionsMeta) || sectionsMeta.length === 0) return html;

    // Locate every top-level <section id="…">…</section> block, tracking
    // nested <section> depth generically (today's templates never nest
    // sections, but this stays correct if one ever does).
    const openRe = /<section\b[^>]*\bid="([a-zA-Z0-9_-]+)"[^>]*>/g;
    const tagRe = /<section\b[^>]*>|<\/section\s*>/gi;
    const blocks = []; // [{ id, start, end }], in document order
    let m;
    while ((m = openRe.exec(html))) {
        const id = m[1];
        const start = m.index;
        let depth = 1;
        tagRe.lastIndex = openRe.lastIndex;
        let end = -1;
        let t;
        while ((t = tagRe.exec(html))) {
            if (/^<\/section/i.test(t[0])) {
                depth--;
                if (depth === 0) { end = tagRe.lastIndex; break; }
            } else {
                depth++;
            }
        }
        if (end === -1) { openRe.lastIndex = m.index + m[0].length; continue; } // malformed — leave untouched
        blocks.push({ id, start, end });
        openRe.lastIndex = end; // resume scanning after this whole block
    }

    if (blocks.length === 0) return html;

    const byId = new Map(blocks.map((b) => [b.id, b]));
    const spanStart = blocks[0].start;
    const spanEnd = blocks[blocks.length - 1].end;

    const seen = new Set();
    const ordered = [];
    sectionsMeta.forEach((entry) => {
        if (!entry || typeof entry.id !== 'string') return;
        const block = byId.get(entry.id);
        if (!block || seen.has(entry.id)) return;
        seen.add(entry.id);
        const removed = !!entry.removed && !NON_REMOVABLE_SECTION_IDS.has(entry.id);
        if (!removed) ordered.push(block);
    });
    // Any rendered section NOT mentioned in sectionsMeta (older config saved
    // before a template gained a new section, or a section id the config
    // never listed) keeps rendering, appended in its original position —
    // never silently dropped by an incomplete section list.
    blocks.forEach((b) => { if (!seen.has(b.id)) ordered.push(b); });

    // Everything between the first and last section is about to be replaced by
    // the reordered blocks, so anything living BETWEEN them -- a divider, a
    // decorative strip, a stray script -- would be deleted without a trace.
    // No shipped template has such content today, which is exactly why this
    // has to be checked rather than assumed: the day someone adds a divider
    // between two sections, the first owner who reorders would silently lose
    // it, and nothing would point at this function.
    //
    // Refuse the reorder instead. A section list that does not reorder is a
    // visible, reportable disappointment; markup that vanishes from a paying
    // customer's live site is not.
    for (let i = 1; i < blocks.length; i++) {
        const gap = html.slice(blocks[i - 1].end, blocks[i].start);
        if (gap.trim() !== '') {
            console.warn(
                '  ⚠️  section reorder skipped: non-whitespace content between sections "' +
                blocks[i - 1].id + '" and "' + blocks[i].id + '" would be lost'
            );
            return html;
        }
    }

    const replacement = ordered.map((b) => html.slice(b.start, b.end)).join('\n\n        ');
    return html.slice(0, spanStart) + replacement + html.slice(spanEnd);
}

/**
 * renderHtml(templateHtml, config, opts={}) — pure render pipeline, no fs.
 *
 * Applies derived fields (contact.addressNoHref), expands @each/@if blocks,
 * and replaces all {{token}} placeholders against `config`.
 *
 * This is the heart of the engine and is exported so it can run in the browser
 * (via scripts/build-builder.js) without any Node.js file-system calls.
 *
 * opts.editMode (boolean, default false):
 *   When true, text-context tokens are wrapped in <span data-hb-edit="PATH"
 *   data-hb-kind="text">VALUE</span> for inline editing.  Tokens inside tag/
 *   attribute contexts (href, src, style, content, alt, class, etc.) are left
 *   untouched.  Tokens inside @each loops carry indexed paths (services.0.label).
 *   When false/absent the output is BYTE-IDENTICAL to the non-opts call.
 */
function renderHtml(templateHtml, config, opts) {
    // Normalize a shallow clone so old local/server drafts render with current defaults.
    const cfg = normalizeConfigForRender(config);
    if (cfg.contact) {
        cfg.contact = Object.assign({}, cfg.contact);
        cfg.contact.addressNoHref =
            (cfg.contact.address && !cfg.contact.addressHref) ? 'true' : '';
    }
    // Public Instagram: Instafidget embed only when connected (S111).
    normalizeInstagramForPublic(cfg);

    const editMode  = !!(opts && opts.editMode);
    const editOpts  = editMode ? { editMode: true, pathPrefix: '' } : undefined;

    let html = templateHtml;
    html = expandEach(html, cfg, editOpts);                                        // 1) loops first
    html = replaceTokensWithEditMode(                                              // 2) global tokens
        html,
        token => resolve(cfg, token),
        true,
        editOpts
    );
    // 3) Wave 7: honour config.sections (add/remove/reorder page sections).
    // Only touches output when the config actually carries section metadata
    // — see reorderSections()'s doc comment for the backward-compat guarantee.
    if (Array.isArray(cfg.sections) && cfg.sections.length > 0) {
        html = reorderSections(html, cfg.sections);
    }
    return html;
}

/**
 * Decode intrinsic width/height from a JPEG or PNG buffer. Returns null when
 * the buffer isn't a recognizable raster image (never throws — callers treat
 * that as "leave the <img> tag alone").
 */
function decodeRasterDims(buf) {
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
        const seglen = buf.readUInt16BE(i + 2);
        if (seglen < 2) break;
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + seglen;
    }
    return null;
}

/**
 * `sizes` for gallery/portfolio/Instagram photo-grid <img>s. Every template's
 * grid is 1 column on mobile, 2 columns from ~640-720px, 3 columns from
 * ~960-1024px, inside a ~1200-1280px max-width wrap — this is a deliberately
 * generic value covering all five systems, not a per-template pixel-exact
 * one. If a template owner wants tighter per-breakpoint values, that markup
 * decision belongs with whoever owns template.html/styles.css — see
 * HANDOFF-images.md.
 */
const RESPONSIVE_IMG_SIZES = '(min-width: 1024px) 33vw, (min-width: 640px) 48vw, 94vw';

/** Read `<siteDir>/images/variants.json` (Wave7 responsive-image manifest), if present. */
function loadImageManifest(siteDir) {
    try {
        const manifestPath = path.join(siteDir, 'images', 'variants.json');
        if (!fs.existsSync(manifestPath)) return null;
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        console.warn('  ⚠️  could not read images/variants.json:', e && e.message ? e.message : e);
        return null;
    }
}

/**
 * Node-only post-render pass — NOT part of renderHtml(), which must stay
 * filesystem-free so it keeps working inside the browser-bundled builder
 * (scripts/build-builder.js). Two independent things happen here, both
 * scoped to <img> tags only (CSS `background: url(...)` hero images are
 * untouched — see scripts/generate-image-variants.js's file header for why):
 *
 *  1. Every <img> whose intrinsic size can be determined — a local
 *     images/*.jpg|png file, OR an owner's own photo embedded as a
 *     data:image/...;base64 URI (uploaded photos never run through the
 *     build-time variant generator, so this is the only pipeline coverage
 *     they get) — gets width/height attributes, so the browser reserves
 *     its box before the image loads (CLS).
 *  2. Only images with a Wave7 manifest entry (scripts/generate-image-
 *     variants.js output — currently the shipped demo/preset photos) are
 *     additionally upgraded from a bare <img> into a <picture> offering
 *     WebP srcset candidates at 480w/960w, with the original JPEG/PNG as
 *     the universal fallback <img>.
 */
function injectResponsiveImages(html, siteDir) {
    const manifest = loadImageManifest(siteDir);

    return html.replace(/<img\b([^>]*?)\s*(\/?)>/gi, (full, attrs, selfClose) => {
        const srcMatch = /\bsrc\s*=\s*"([^"]*)"/i.exec(attrs) || /\bsrc\s*=\s*'([^']*)'/i.exec(attrs);
        if (!srcMatch) return full;
        const src = srcMatch[1];
        if (!src || src === '#') return full;
        if (/\bwidth\s*=/i.test(attrs)) return full; // already sized — leave alone (idempotent)

        const close = selfClose ? ' /' : '';

        // Owner-uploaded photo embedded directly as a data: URI — no build-time
        // variants exist for these, but we can still read the real dimensions
        // straight out of the embedded bytes to stop it shifting layout.
        const dataMatch = /^data:image\/(?:jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i.exec(src);
        if (dataMatch) {
            try {
                const dims = decodeRasterDims(Buffer.from(dataMatch[1], 'base64'));
                if (dims) return `<img${attrs} width="${dims.width}" height="${dims.height}"${close}>`;
            } catch (e) { /* undecodable — leave the tag untouched */ }
            return full;
        }

        if (!/^images\//.test(src) || !/\.(?:jpe?g|png)$/i.test(src)) return full;

        const entry = manifest && manifest[src];
        if (entry && Array.isArray(entry.variants) && entry.variants.length) {
            const srcset = entry.variants.map((v) => `${v.webp} ${v.width}w`).join(', ');
            const img = `<img${attrs} width="${entry.width}" height="${entry.height}"${close}>`;
            return `<picture><source type="image/webp" srcset="${srcset}" sizes="${RESPONSIVE_IMG_SIZES}">${img}</picture>`;
        }

        // No manifest entry (hero/og/unreferenced file) — still size the <img>
        // when the file is readable on disk, so every image with a knowable
        // intrinsic size reserves its box, not just the ones with variants.
        try {
            const abs = path.join(siteDir, src);
            if (fs.existsSync(abs)) {
                const dims = decodeRasterDims(fs.readFileSync(abs));
                if (dims) return `<img${attrs} width="${dims.width}" height="${dims.height}"${close}>`;
            }
        } catch (e) { /* unreadable/undecodable — leave the tag untouched */ }
        return full;
    });
}

function build(siteDir = ROOT) {
    const dir = path.resolve(siteDir);
    const configPath = path.join(dir, 'config.json');
    const templatePath = path.join(dir, 'template.html');
    const outputPath = path.join(dir, 'index.html');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const templateHtml = fs.readFileSync(templatePath, 'utf8');

    let html = renderHtml(templateHtml, config);
    html = injectResponsiveImages(html, dir);

    fs.writeFileSync(outputPath, html, 'utf8');

    // Flow 3: Privacy / Terms / Cookies + cookie-banner assets beside index.html
    let legalFiles = [];
    try {
        const { writeLegalSiteFiles } = require('./bot/site-legal.js');
        legalFiles = writeLegalSiteFiles(dir, config).files || [];
    } catch (e) {
        console.warn('  ⚠️  legal pages skipped:', e && e.message ? e.message : e);
    }

    return { outputPath, bytes: html.length, legalFiles };
}

module.exports = {
    build,
    escapeHtml,
    renderHtml,
    isConnectedSocialFeedEmbed,
    normalizeInstagramForPublic,
    reorderSections,
    NON_REMOVABLE_SECTION_IDS,
    injectResponsiveImages,
    decodeRasterDims,
};

// Run from CLI:  node build.js [siteDir]
if (require.main === module) {
    console.log('🔧 Building index.html …');
    const { outputPath, bytes } = build(ROOT);
    console.log(`✅ Wrote ${path.relative(process.cwd(), outputPath)} (${bytes} bytes)`);
}
