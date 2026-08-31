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
 */
function normalizeInstagramForPublic(cfg) {
    if (!cfg || !cfg.instagram || typeof cfg.instagram !== 'object') return;
    const ig = Object.assign({}, cfg.instagram);
    const rawEmbed = typeof ig.embedUrl === 'string' ? ig.embedUrl.trim() : '';
    if (isConnectedSocialFeedEmbed(rawEmbed)) {
        ig.embedUrl = rawEmbed;
        // Connected: partner embed only — drop posts/gallery filler on live/preview.
        ig.posts = [];
        ig.gallery = [];
        // Section templates gate on handle; keep a stable handle for @line when present.
        if (typeof ig.handle === 'string') ig.handle = ig.handle.trim();
        if (!ig.handle) ig.handle = 'instagram';
    } else {
        // Not connected: omit the whole public Instagram block.
        ig.embedUrl = '';
        ig.posts = [];
        ig.gallery = [];
        ig.handle = '';
    }
    cfg.instagram = ig;
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
                    // 4. Strip dangerous URL protocols from attribute values.
                    //    Matches: href="javascript:…", xlink:href='data:…', etc.
                    //    Uses a lookahead to find the scheme anywhere inside an attribute
                    //    value. We blank the scheme to "#" so the attribute stays valid SVG.
                    .replace(
                        /((?:xlink:)?href|src|action|formaction)\s*=\s*(['"]?)\s*(?:javascript|data|vbscript)\s*:[^"'\s>]*/gi,
                        '$1=$2#'
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
            return '<span data-hb-edit="' + fullPath + '" data-hb-kind="text">' + escaped + '</span>';
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
            // Treat string 'false' / '0' / 'no' as falsy so schema fields declared as
            // type:text with value 'false' (e.g. showWordmark) work correctly with @if.
            const isFalsyString = typeof ifVal === 'string' && /^(false|0|no)$/i.test(ifVal.trim());
            const truthy = Array.isArray(ifVal) ? ifVal.length > 0 : (!isFalsyString && Boolean(ifVal));
            if (negate ? !truthy : truthy) out += expandEach(block, scope, editOpts);
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
    return html;
}

function build(siteDir = ROOT) {
    const dir = path.resolve(siteDir);
    const configPath = path.join(dir, 'config.json');
    const templatePath = path.join(dir, 'template.html');
    const outputPath = path.join(dir, 'index.html');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const templateHtml = fs.readFileSync(templatePath, 'utf8');

    const html = renderHtml(templateHtml, config);

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
};

// Run from CLI:  node build.js [siteDir]
if (require.main === module) {
    console.log('🔧 Building index.html …');
    const { outputPath, bytes } = build(ROOT);
    console.log(`✅ Wrote ${path.relative(process.cwd(), outputPath)} (${bytes} bytes)`);
}
