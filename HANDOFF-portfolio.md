# HANDOFF — portfolio template (Wave 5, audit 2026-09-06)

Owner of this wave: `templates/portfolio/{template.html,styles.css,script.js,schema.json,presets.json,collage.js}` only. The items below need a change **outside** that ownership (the shared render engine `build.js`, which this wave is not allowed to edit) and are handed off here instead, per the wave's rules.

## 1. `build.js`'s `icon` raw-sink sanitizer does not survive tab/CR/LF or HTML-entity obfuscation (AUDIT-10, re-opened)

**Where:** `build.js`, `replaceTokens()`, the `if (token === 'icon')` branch (around line 364).

**What's there today:**

```js
.replace(
    /((?:xlink:)?href|src|action|formaction)\s*=\s*(['"]?)\s*(?:javascript|data|vbscript)\s*:[^"'\s>]*/gi,
    '$1=$2#'
)
```

**Why it's still bypassable:** the regex only tolerates whitespace *around* the scheme word (`\s*` before the colon), not *inside* it, and it never decodes HTML entities. Two independent bypasses reach the browser's real, normalized interpretation of the URL while producing a string this regex does not recognise as dangerous:

- **Tab/CR/LF inside the word** — `jav<TAB>ascript:...`, `jav<CR>ascript:...`, `jav<LF>ascript:...`. Per the WHATWG URL spec, a browser strips every ASCII tab and CR/LF from a URL string *wherever it occurs* before parsing the scheme — not just at the ends. So `jav\tascript:alert(1)` parses as `javascript:alert(1)` to the browser, but the regex's `(?:javascript|...)` alternation never matches because the literal substring "javascript" doesn't appear contiguously in the source.
- **HTML character references** — `&#106;avascript:...` (decimal) or `&#x6a;avascript:...` (hex) for the letter "j". The HTML parser decodes character references in attribute values as part of parsing the attribute itself, before any application code (including this sanitizer, which runs on the raw string *before* it's ever embedded and re-parsed) sees a "javascript:" substring to blocklist. The sanitizer sees `&#106;avascript:` (no match); the browser's DOM ends up with the attribute value `javascript:...` regardless.

Verified against the actual build+publish pipeline in Chromium (`bot/test/wave5-portfolio-xss-icon.test.js` in this wave's branch, run with the client-side mitigation below disabled): all five obfuscated variants (tab, CR, LF, decimal entity, hex entity) render a live `href` that still says `javascript:...` and executes on click; only the unobfuscated `javascript:` control was blocked by the existing regex.

**Suggested fix**, in the same function, before the existing blocklist check:

```js
if (token === 'icon') {
    const safe = String(value)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/\bon\w+\s*=/gi, 'data-removed=')
        .replace(
            /((?:xlink:)?href|src|action|formaction)\s*=\s*(['"]?)([^"'>]*)/gi,
            (m, attr, q, rawUrl) => {
                // Mirror what the browser will actually do with this string
                // before checking the scheme: strip embedded tab/CR/LF
                // (WHATWG URL §4, "remove all ASCII tab or newline") and
                // decode the handful of entities that can spell out a scheme
                // letter, so the blocklist can't be out-flanked by either.
                const normalized = rawUrl
                    .replace(/[\t\r\n]+/g, '')
                    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(d))
                    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
                if (/^\s*(?:javascript|data|vbscript)\s*:/i.test(normalized)) {
                    return attr + '=' + q + '#';
                }
                return m;
            }
        );
    return safe;
}
```

(The exact regex/entity-decoding approach is a suggestion, not a mandate — the essential requirement is: **normalize embedded tab/CR/LF and decode entities in the candidate URL before running the scheme blocklist**, not after. The same class of bug likely exists for the `contact.address` raw sink too, although that one only allows `<br>` through `sanitizeAddress()` — worth a quick audit of whether an entity-encoded `<br>` such as `&lt;br&gt;` could round-trip unexpectedly; I did not find an exploitable path there but didn't have write access to verify with an oracle.)

**What this wave did in the meantime:** added a client-side defence-in-depth pass in `templates/portfolio/script.js` (`sanitizeIconHrefs()`, runs on `DOMContentLoaded`) that re-checks every `href` inside `.pf-chip__icon` through the browser's own `URL` parser (which performs the identical tab/CR/LF normalization a real navigation would, and reads the attribute value *after* the HTML parser has already decoded any entities) and blanks anything whose resolved `protocol` isn't in `{http:, https:, tel:, mailto:}`. Scoped to `href` only (not `xlink:href`/`src`/`action`/`formaction`) — every icon shipped in `presets.json` is an inline SVG `<a href="…">`, and `bot/test/audit-performance.test.js` pins a hard byte ceiling on this template's bundled JS (`HEAVY_JS_CEILING_BYTES.portfolio`, no comment-stripping happens for JS — see `scripts/build-builder.js`'s `trimJsWhitespace`) that a broader, more defensive version of this function did not fit under. If you land the build.js fix, this covers the identical ground more completely and this template's client-side layer becomes pure redundancy (safe to keep or drop); if you extend this stand-in instead, mind that ceiling.

This closes the vector for any visitor with JavaScript enabled — and a visitor *without* JavaScript cannot be exploited by a `javascript:` href in the first place, since such URIs require a script-capable context to do anything. It is not a substitute for the build.js fix: it only covers this one template's one attribute on one sink, and it depends on `script.js` loading and running, whereas the build-time fix protects the HTML itself regardless.

**Oracle:** `bot/test/wave5-portfolio-xss-icon.test.js` — builds a real site through `build.js`'s `build()` with one crafted `services[].icon` per bypass variant, loads it in Playwright's Chromium, clicks each rendered icon link, and asserts no variant executes injected JS. Currently green because of the script.js mitigation above; re-run it after any build.js change to confirm the server-side fix independently closes the same gap (you can temporarily comment out the `sanitizeIconHrefs()` call in script.js to test build.js's fix in isolation).

## 2. Cookie-consent clearance CSS ships at the end of `<body>` (shared component, fixed at the reference-site level in this wave)

Not a change request — just a note so the next person touching `cookie-banner.css`/`cookie-banner.js` (or `bot/site-legal.js`, which generates them) understands why `templates/portfolio/template.html` now links `cookie-banner.css` from `<head>` instead of the end of `<body>`, and carries an early inline script approximating `cookie-banner.js`'s own `accepted()` check (localStorage only, no cookie fallback — kept to one line to fit `audit-performance.test.js`'s byte ceiling on this template's bundle; a fuller version would also check `document.cookie` the way `cookie-banner.js` itself does):

`cookie-banner.css` gates extra hero-copy clearance padding behind `html.hb-cookie-open` / `body:has(#hb-cookie-banner:not([hidden]))` so the fixed consent card never overlaps a hero CTA. Every template that includes this shared stylesheet at the end of `<body>` (this wave only touched portfolio) will have the same problem: the stylesheet arrives and applies well after the hero has already painted on a slow connection, so the clearance padding snaps in late and shows up as measurable CLS (~0.09-0.13 under the audit's own throttling profile, reproduced in `bot/test/wave5-portfolio-cls.test.js`). If the other four templates (product-menu, local-service, professionals, desserdirina) link `cookie-banner.css` the same way, they likely have the identical CLS source — worth a quick check outside this wave's scope (their `template.html` files aren't owned by this wave).

The general fix that would remove the need for every template to duplicate the `<head>`-hoist + early-class trick: have `bot/site-legal.js` (or whatever writes the final published HTML) inline `cookie-banner.css`'s content directly into `<head>` as a `<style>` block (it's small and shared, no reason it needs to be a separate late-loading request at all), and/or have it inject the "already decided" `hb-cookie-open` class server-side into a `<script>` placed at the very top of `<head>` for every generated site, instead of leaving each template to remember to place the `<link>` early and duplicate the accepted()-check logic.
