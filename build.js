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
 */
function sanitizeAddress(value) {
    // Escape everything, then un-escape only <br> and <br/> (the sole allowed tag).
    return escapeHtml(String(value)).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

function replaceTokens(str, resolver, warn = true) {
    return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, token) => {
        let raw = false;
        if (token[0] === '&') { raw = true; token = token.slice(1).trim(); }
        const value = resolver(token);
        if (value === undefined || value === null) {
            if (warn) console.warn(`  ⚠️  unresolved token: {{${token}}}`);
            return match;
        }
        if (raw) {
            // Per-sink sanitization — each raw sink must be explicitly handled here.
            if (token === 'seo.jsonLd') return sanitizeJsonLd(value);
            if (token === 'contact.address') return sanitizeAddress(value);
            // CSS style-attribute sinks: escapeHtml is correct here because the HTML
            // parser uses literal (unencoded) characters to find attribute boundaries,
            // so &quot; / &#39; do NOT close the attribute, and the encoded characters
            // decode correctly inside the CSS value (e.g. url(&#39;...&#39;) works).
            if (token === 'hero.background') return escapeHtml(value);
            // Fallback: treat unknown raw sinks as regular escaped output (safe default).
            console.warn(`  ⚠️  unknown raw sink {{& ${token}}} — escaping for safety`);
            return escapeHtml(value);
        }
        return escapeHtml(value);
    });
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
 */
function expandEach(str, scope) {
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
            const truthy = Array.isArray(ifVal) ? ifVal.length > 0 : Boolean(ifVal);
            if (negate ? !truthy : truthy) out += expandEach(block, scope);
        } else {
            const value = resolve(scope, dataPath);
            if (!Array.isArray(value)) {
                console.warn(`  ⚠️  @each "${dataPath}" is not an array — skipping`);
            } else {
                out += value.map(item => {
                    const expanded = expandEach(block, item);   // nested loops, item scope
                    return replaceTokens(expanded, token => {
                        if (token === '.') return item;
                        if (typeof item === 'object' && item !== null) return resolve(item, token);
                        return undefined;
                    }, false);   // don't warn: outer/global tokens resolve in the final pass
                }).join('');
            }
        }

        cursor = match.blockEnd;                     // continue after @end/@endif
    }

    return out;
}

function build(siteDir = ROOT) {
    const dir = path.resolve(siteDir);
    const configPath = path.join(dir, 'config.json');
    const templatePath = path.join(dir, 'template.html');
    const outputPath = path.join(dir, 'index.html');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Derived fields: computed after config load, before rendering.
    // contact.addressNoHref — truthy when an address text exists but no map link
    // is provided, so templates can render a plain-text address fallback via
    // <!-- @if contact.addressNoHref --> without duplicating logic in every preset.
    if (config.contact) {
        config.contact.addressNoHref =
            (config.contact.address && !config.contact.addressHref) ? 'true' : '';
    }

    let html = fs.readFileSync(templatePath, 'utf8');

    html = expandEach(html, config);                         // 1) loops first
    html = replaceTokens(html, token => resolve(config, token)); // 2) global tokens

    fs.writeFileSync(outputPath, html, 'utf8');
    return { outputPath, bytes: html.length };
}

module.exports = { build, escapeHtml };

// Run from CLI:  node build.js [siteDir]
if (require.main === module) {
    console.log('🔧 Building index.html …');
    const { outputPath, bytes } = build(ROOT);
    console.log(`✅ Wrote ${path.relative(process.cwd(), outputPath)} (${bytes} bytes)`);
}
