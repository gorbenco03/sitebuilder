#!/usr/bin/env node
'use strict';
/**
 * scripts/build-builder.js — zero-dep bundler for the browser-side builder.
 *
 * Generates in builder/generated/:
 *
 *   engine.js           — window.HidookEngine = { renderHtml, escapeHtml, renderPreview }
 *   templates-data.js   — LIGHT registry only (id/name/description/thumbnail). No heavy
 *                         schema/presets/files and NO base64 images — boots the catalog
 *                         grid immediately on throttled networks.
 *   templates/<id>.js   — heavy payload per template (schema, presets, files). Fetched
 *                         on demand at Start / Preview / editor restore.
 *   template-assets/<id>/images/* — real cacheable static image files (not base64-in-JS).
 *   thumbs/<id>.*       — catalog card thumbnails.
 *
 * Run:  node scripts/build-builder.js
 *       npm run build:app
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const TEMPLATES   = path.join(ROOT, 'templates');
const BUILDER_DIR = path.join(ROOT, 'builder');
const GEN_DIR     = path.join(BUILDER_DIR, 'generated');

// Ensure output directory exists.
fs.mkdirSync(GEN_DIR, { recursive: true });

// ─── 1.  engine.js ───────────────────────────────────────────────────────────

// Read build.js source as text — we'll extract the pure functions from it.
const buildSrc = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');

// Strip the Node.js-specific top (require statements, ROOT/CONFIG/… path lines,
// and the CLI runner block) leaving only the pure functions.
// Strategy: grab everything between the first `function` and `module.exports`.
const fnStart = buildSrc.indexOf('\n/** Resolve a dot-path');
const exportsLine = buildSrc.indexOf('\nmodule.exports');
const pureFunctions = buildSrc.slice(fnStart, exportsLine).trim();

// Read the edit overlay script if it exists. The overlay agent writes this file;
// if it hasn't been created yet, we embed an empty placeholder and leave a TODO.
// TODO: replace placeholder once builder/edit-overlay.js is written by overlay agent.
const editOverlayPath = path.join(BUILDER_DIR, 'edit-overlay.js');
const editOverlaySrc = fs.existsSync(editOverlayPath)
    ? fs.readFileSync(editOverlayPath, 'utf8')
    : '/* TODO: builder/edit-overlay.js not found — overlay agent must create it */';

// Pure site-legal generators + cookie banner assets for preview isolation.
// Strips Node fs/path + writeLegalSiteFiles so the browser engine stays pure.
const siteLegalSrc = fs.readFileSync(path.join(ROOT, 'bot/site-legal.js'), 'utf8');
const siteLegalPure = siteLegalSrc
    .replace(/^[\s\S]*?\nconst fs = require\('fs'\);\nconst path = require\('path'\);\n/, '')
    .replace(
        /\n\/\*\*\n \* Write privacy\.html[\s\S]*?\nfunction writeLegalSiteFiles\(siteDir, config\) \{[\s\S]*?\n\}\n/,
        '\n'
    )
    .replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '\n');

// The renderPreview helper: inlines CSS/JS assets into the rendered HTML so it
// can be used as an <iframe srcdoc="…"> without cross-origin issues.
const renderPreviewSrc = `
/**
 * renderPreview(files, config, opts) -> htmlString
 *
 * Renders the template with the given config then inlines all asset references
 * so the result is a self-contained HTML document suitable for iframe srcdoc.
 *
 * @param {object} files
 *   { templateHtml: string, stylesCss: string, scriptJs: string, collageJs?: string }
 * @param {object} config  — the site config object
 * @param {object} [opts]  — optional render options; opts.editMode triggers edit UI
 * @returns {string}
 */
function renderPreview(files, config, opts) {
    let html = renderHtml(files.templateHtml, config, opts);

    // Inline local template images (images/…) as data URLs so iframe srcdoc
    // previews show opened default presets without a network fetch.
    if (files.imageMap && typeof files.imageMap === 'object') {
        const keys = Object.keys(files.imageMap).sort(function (a, b) { return b.length - a.length; });
        for (var ki = 0; ki < keys.length; ki++) {
            var rel = keys[ki];
            var dataUrl = files.imageMap[rel];
            if (!rel || !dataUrl) continue;
            html = html.split(rel).join(dataUrl);
        }
    }

    // Inline <link rel="stylesheet" href="styles.css">
    html = html.replace(
        /<link\\s[^>]*rel=["']stylesheet["'][^>]*href=["']styles\\.css["'][^>]*>/gi,
        '<style>' + (files.stylesCss || '') + '</style>'
    );
    html = html.replace(
        /<link\\s[^>]*href=["']styles\\.css["'][^>]*rel=["']stylesheet["'][^>]*>/gi,
        '<style>' + (files.stylesCss || '') + '</style>'
    );

    // Inline <script src="script.js"></script>
    html = html.replace(
        /<script\\s[^>]*src=["']script\\.js["'][^>]*>\\s*<\\/script>/gi,
        '<script>' + (files.scriptJs || '') + '</script>'
    );

    // Inline <script src="collage.js"></script> only if collageJs is provided
    if (files.collageJs) {
        html = html.replace(
            /<script\\s[^>]*src=["']collage\\.js["'][^>]*>\\s*<\\/script>/gi,
            '<script>' + files.collageJs + '</script>'
        );
    }

    // Flow 3 preview isolation: cookie-banner.css/js are written beside live/ZIP
    // index.html, not shipped in template files. Without inlining, srcdoc keeps
    // #hb-cookie-banner[hidden] forever and relative legal links escape to
    // builder chrome /app/privacy|terms|cookies.html.
    html = html.replace(
        /<link\\s[^>]*href=["']cookie-banner\\.css["'][^>]*>/gi,
        '<style data-hb-cookie-banner>' + COOKIE_BANNER_CSS + '</style>'
    );
    html = html.replace(
        /<script\\s[^>]*src=["']cookie-banner\\.js["'][^>]*>\\s*<\\/script>/gi,
        '<script data-hb-cookie-banner>' + COOKIE_BANNER_JS + '</script>'
    );

    // PREVIEW MODE: complete every entry animation instantly (keeping the
    // \`forwards\` end state). Two reasons: (1) each debounced re-render would
    // otherwise restart all fade-ins — janky while typing; (2) Chrome throttles
    // animation timelines in hidden/offscreen cross-origin iframes, which can
    // leave opacity-0 entry animations stuck at frame 0 (blank preview).
    // Published sites are NOT affected — this style exists only in srcdoc.
    html = html.replace(
        '</head>',
        '<style data-hidook-preview>*, *::before, *::after {' +
        ' animation-duration: 0.01ms !important;' +
        ' animation-delay: 0ms !important;' +
        ' animation-iteration-count: 1 !important;' +   // infinite loops would restart every 0.01ms = visible trembling
        ' transition-duration: 0.01ms !important; }</style></head>'
    );

    // PREVIEW MODE, belt-and-suspenders: paused animation timelines (throttled
    // sandboxed iframes) leave entry-animated elements stuck at opacity 0 even
    // with the 0.01ms override above — the preview must not DEPEND on animations
    // at all. Every template already declares its "must be visible without JS"
    // classes in a <noscript><style> block; re-activate that CSS unconditionally
    // inside the preview so content is always visible. Published sites keep
    // their animations (noscript stays inert there).
    {
        const revealCss = Array.from(
            html.matchAll(/<noscript>\\s*<style[^>]*>([\\s\\S]*?)<\\/style>\\s*<\\/noscript>/gi),
            (m) => m[1]
        ).join('\\n');
        if (revealCss) {
            html = html.replace(
                '</head>',
                '<style data-hidook-reveal>' + revealCss + '</style></head>'
            );
        }
    }

    // PREVIEW MODE, universal forcer: the per-template noscript lists can miss
    // classes (e.g. hero elements whose reveal is a "pure CSS" keyframe that a
    // throttled iframe never plays). Deterministic sweep: any element that an
    // entry animation left at computed opacity 0 gets forced visible. Runs only
    // inside the srcdoc preview, never on published sites.
    html = html.replace(
        '</body>',
        '<scr' + 'ipt data-hidook-forcer>(function(){function force(){var els=document.querySelectorAll("*");for(var i=0;i<els.length;i++){var cs=getComputedStyle(els[i]);if(cs.opacity==="0"&&cs.animationName!=="none"){els[i].style.setProperty("opacity","1","important");els[i].style.setProperty("transform","none","important");}}}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",function(){setTimeout(force,60);});}else{setTimeout(force,60);}window.addEventListener("load",function(){setTimeout(force,120);});})();</scr' + 'ipt></body>'
    );

    // EDIT MODE: inject the edit overlay (affordances + postMessage bridge) and
    // minimal hover/outline styles for [data-hb-edit] elements.
    if (opts && opts.editMode) {
        // Minimal CSS affordances: outline editable text nodes on hover, show
        // a "Replace photo" button over images (the full overlay JS handles the rest).
        const editStyles =
            '[data-hb-edit]{outline:2px dashed rgba(99,102,241,.55);outline-offset:2px;cursor:text;border-radius:2px;}' +
            '[data-hb-edit]:hover,[data-hb-edit]:focus{outline-color:rgba(99,102,241,1);background:rgba(99,102,241,.07);}' +
            'img.hb-img-hover{outline:2px dashed rgba(99,102,241,.55);outline-offset:2px;}';
        html = html.replace(
            '</head>',
            '<style data-hidook-edit-affordances>' + editStyles + '</style></head>'
        );
        // Inject the overlay script at end of body (after template scripts so it
        // can observe the fully rendered DOM).
        html = html.replace(
            '</body>',
            '<script data-hidook-edit-overlay>' + EDIT_OVERLAY_SRC + '</script></body>'
        );
    }

    // Business legal pages: hash hrefs + in-iframe click interceptor.
    // Chromium will not open top-level data:text/html navigations from srcdoc
    // (and build.js already treats data:text/html as hostile). Relative
    // privacy.html would resolve against /app/ builder chrome. Instead: store
    // generated RO pages as JSON, rewrite links to #hb-preview-legal-*, and on
    // real click document.write the page inside the sandboxed preview iframe.
    {
        var legalDocs = {
            'privacy.html': privacyHtml(config),
            'terms.html': termsHtml(config),
            'cookies.html': cookiesHtml(config),
        };
        var legalNames = Object.keys(legalDocs);
        for (var li = 0; li < legalNames.length; li++) {
            var legalName = legalNames[li];
            var pageHtml = String(legalDocs[legalName] || '');
            pageHtml = pageHtml
                .replace(/<link\\s[^>]*href=["']styles\\.css["'][^>]*>/gi, '')
                .replace(/<script\\s[^>]*src=["']cookie-banner\\.js["'][^>]*>\\s*<\\/script>/gi, '');
            legalDocs[legalName] = pageHtml;
            html = html.replace(
                new RegExp('href=(["\\'])' + legalName.replace('.', '\\\\.') + '\\\\1', 'gi'),
                'href="#hb-preview-legal-' + legalName + '" data-hb-preview-legal="' + legalName + '"'
            );
        }
        // Escape < so a </script> inside legal HTML cannot break out of the JSON script tag.
        var legalJson = JSON.stringify(legalDocs).replace(/</g, '\\\\u003c');
        // Append at the final </body> so earlier preview injects (forcer/edit) cannot
        // splice into this payload if it ever contained that substring.
        var closeBodyTag = '</bod' + 'y>';
        var legalBoot = '<script type="application/json" id="hb-preview-legal-docs">' + legalJson + '</script>' +
            '<script data-hb-preview-legal-nav>' + PREVIEW_LEGAL_NAV_SRC + '</script>' + closeBodyTag;
        var bodyCloseAt = html.lastIndexOf(closeBodyTag);
        if (bodyCloseAt === -1) bodyCloseAt = html.toLowerCase().lastIndexOf(closeBodyTag);
        if (bodyCloseAt !== -1) html = html.slice(0, bodyCloseAt) + legalBoot + html.slice(bodyCloseAt + closeBodyTag.length);
        else html += legalBoot;
    }


    return html;
}
`;

// Embed the overlay source as a JS string literal that renderPreview can use.
// We JSON.stringify it so it is safe to embed inside a JS string (escapes quotes,
// newlines, backslashes, etc.).
const editOverlayEmbedded = JSON.stringify(editOverlaySrc);

// Click-interceptor source embedded for renderPreview legal isolation.
const previewLegalNavSrc = "(function () {\n  function docs() {\n    var el = document.getElementById('hb-preview-legal-docs');\n    return el ? JSON.parse(el.textContent) : {};\n  }\n  function bootScripts() {\n    var j = document.getElementById('hb-preview-legal-docs');\n    var n = document.querySelector('script[data-hb-preview-legal-nav]');\n    if (!j || !n) return '';\n    return (\n      '<scr' + 'ipt type=\"application/json\" id=\"hb-preview-legal-docs\">' +\n      j.textContent +\n      '</scr' + 'ipt>' +\n      '<scr' + 'ipt data-hb-preview-legal-nav>' +\n      n.textContent +\n      '</scr' + 'ipt>'\n    );\n  }\n  function prepare(html) {\n    html = String(html || '');\n    html = html.replace(/href=([\"'])(privacy|terms|cookies)\\.html\\1/gi, function (_m, _q, p) {\n      return 'href=\"#hb-preview-legal-' + p + '.html\" data-hb-preview-legal=\"' + p + '.html\"';\n    });\n    html = html.replace(/href=([\"'])index\\.html\\1/gi, 'href=\"#hb-preview-home\" data-hb-preview-home=\"1\"');\n    if (!/id=[\"']hb-preview-legal-docs[\"']/.test(html)) {\n      var closeBody = '</bod' + 'y>';\n      var reBody = new RegExp(closeBody.replace('/', '\\\\/'), 'i');\n      if (reBody.test(html)) html = html.replace(reBody, bootScripts() + closeBody);\n      else html += bootScripts();\n    }\n    return html;\n  }\n  function show(name) {\n    var page = docs()[name];\n    if (!page) return;\n    document.open();\n    document.write(prepare(page));\n    document.close();\n  }\n  document.addEventListener('click', function (e) {\n    var t = e.target;\n    if (t && t.nodeType === 3) t = t.parentElement;\n    var a = t && t.closest ? t.closest('a') : null;\n    if (!a) return;\n    if (a.getAttribute('data-hb-preview-home') === '1') {\n      e.preventDefault();\n      try { location.reload(); } catch (err) {}\n      return;\n    }\n    var name = a.getAttribute('data-hb-preview-legal');\n    if (!name) return;\n    e.preventDefault();\n    if (e.stopPropagation) e.stopPropagation();\n    show(name);\n  }, true);\n})();";
const previewLegalNavEmbedded = JSON.stringify(previewLegalNavSrc);

const engineIife = `(function () {
'use strict';

// ── Node.js shims — blow up loudly if renderHtml somehow tries to use fs/path.
var module = { exports: {} };
function require(mod) {
    throw new Error('HidookEngine: require("' + mod + '") called — renderHtml must be pure (no fs/path).');
}
var __dirname = '';

${pureFunctions}

// ── Edit overlay source (inlined by bundler from builder/edit-overlay.js) ────
// Used by renderPreview in editMode to inject the overlay script into srcdoc.
var EDIT_OVERLAY_SRC = ${editOverlayEmbedded};

// ── Preview legal click interceptor (in-iframe document.write; no data: hrefs) ─
var PREVIEW_LEGAL_NAV_SRC = ${previewLegalNavEmbedded};

// ── Generated-site legal + cookie banner (pure; from bot/site-legal.js) ──────
${siteLegalPure}

${renderPreviewSrc}

// ── Public API ────────────────────────────────────────────────────────────────
window.HidookEngine = { renderHtml: renderHtml, escapeHtml: escapeHtml, renderPreview: renderPreview };

})();
`;

fs.writeFileSync(path.join(GEN_DIR, 'engine.js'), engineIife, 'utf8');
console.log('  engine.js written (' + engineIife.length + ' bytes)');

// ─── 2.  Light registry + per-template heavy payloads + static assets ────────

const registryRaw = fs.readFileSync(path.join(TEMPLATES, 'registry.json'), 'utf8');
const registry    = JSON.parse(registryRaw);

const HEAVY_DIR   = path.join(GEN_DIR, 'templates');
const ASSETS_DIR  = path.join(GEN_DIR, 'template-assets');
const THUMBS_DIR  = path.join(GEN_DIR, 'thumbs');
fs.mkdirSync(HEAVY_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);

function pickThumbnailSource(dir, id) {
    const preferred = [
        'images/cn-hero.jpg', 'images/pr-hero.jpg', 'images/ct-hero.jpg',
        'images/iv-hero.jpg', 'images/sf-hero.jpg',
        // Clean pastry collage before portrait cake hero (avoids legacy promo chrome).
        'images/torturi-1.jpg', 'images/hero.jpg',
    ];
    for (const rel of preferred) {
        const abs = path.join(dir, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    }
    const imgDir = path.join(dir, 'images');
    if (fs.existsSync(imgDir) && fs.statSync(imgDir).isDirectory()) {
        const names = fs.readdirSync(imgDir).filter((n) => IMAGE_EXTS.has(path.extname(n).toLowerCase()));
        // Prefer larger files (real photos) over tiny chips when falling back alphabetically.
        names.sort((a, b) => {
            try {
                return fs.statSync(path.join(imgDir, b)).size - fs.statSync(path.join(imgDir, a)).size;
            } catch (_) {
                return a.localeCompare(b);
            }
        });
        if (names.length) return path.join(imgDir, names[0]);
    }
    return null;
}

function writeFallbackThumb(id) {
    // Simple SVG placeholder when a template has no local photos (e.g. professionals).
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">' +
        '<rect width="640" height="400" fill="#F3EFE8"/>' +
        '<rect x="48" y="48" width="544" height="304" fill="none" stroke="#9A4030" stroke-width="3"/>' +
        '<text x="320" y="210" text-anchor="middle" font-family="Georgia,serif" font-size="28" fill="#14120F">' +
        String(id).replace(/[<>&]/g, '') +
        '</text></svg>';
    clearThumbsForId(id);
    const dest = path.join(THUMBS_DIR, id + '.svg');
    fs.writeFileSync(dest, svg, 'utf8');
    return '/app/generated/thumbs/' + id + '.svg';
}

function clearThumbsForId(id) {
    // Drop stale extensions so a photo source does not leave professionals.svg beside professionals.jpg.
    if (!fs.existsSync(THUMBS_DIR)) return;
    for (const name of fs.readdirSync(THUMBS_DIR)) {
        if (name === id || name.startsWith(id + '.')) {
            try { fs.unlinkSync(path.join(THUMBS_DIR, name)); } catch (_) { /* ignore */ }
        }
    }
}

const lightEntries = [];

for (const entry of registry.templates) {
    const id  = entry.id;
    const dir = path.join(TEMPLATES, id);

    const schema  = JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'),  'utf8'));
    const presets = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets;

    const files = {
        templateHtml: fs.readFileSync(path.join(dir, 'template.html'), 'utf8'),
        stylesCss:    fs.readFileSync(path.join(dir, 'styles.css'),    'utf8'),
        scriptJs:     fs.readFileSync(path.join(dir, 'script.js'),     'utf8'),
    };

    const collageFile = path.join(dir, 'collage.js');
    if (fs.existsSync(collageFile)) {
        files.collageJs = fs.readFileSync(collageFile, 'utf8');
    }

    // Copy images to cacheable static files; map relative paths → /app/generated/… URLs
    // (srcdoc previews resolve absolute same-origin URLs; no base64 bloat in JS).
    const imgDir = path.join(dir, 'images');
    const assetOut = path.join(ASSETS_DIR, id, 'images');
    if (fs.existsSync(imgDir) && fs.statSync(imgDir).isDirectory()) {
        fs.mkdirSync(assetOut, { recursive: true });
        const imageMap = {};
        for (const name of fs.readdirSync(imgDir)) {
            const abs = path.join(imgDir, name);
            if (!fs.statSync(abs).isFile()) continue;
            const ext = path.extname(name).toLowerCase();
            if (!IMAGE_EXTS.has(ext)) continue;
            const dest = path.join(assetOut, name);
            fs.copyFileSync(abs, dest);
            imageMap['images/' + name] = '/app/generated/template-assets/' + id + '/images/' + name;
        }
        if (Object.keys(imageMap).length) files.imageMap = imageMap;
    }

    const heavy = { id, schema, presets, files };
    const heavyJs =
        'window.HIDOOK_TEMPLATE_HEAVY = window.HIDOOK_TEMPLATE_HEAVY || {};\n' +
        'window.HIDOOK_TEMPLATE_HEAVY[' + JSON.stringify(id) + '] = ' +
        JSON.stringify(heavy) + ';\n';
    fs.writeFileSync(path.join(HEAVY_DIR, id + '.js'), heavyJs, 'utf8');
    console.log('  templates/' + id + '.js written (' + heavyJs.length + ' bytes)');

    // Thumbnail for catalog cards (grid paints immediately without heavy payload).
    let thumbnail;
    const thumbSrc = pickThumbnailSource(dir, id);
    if (thumbSrc) {
        const ext = path.extname(thumbSrc).toLowerCase() || '.jpg';
        const thumbName = id + ext;
        clearThumbsForId(id);
        fs.copyFileSync(thumbSrc, path.join(THUMBS_DIR, thumbName));
        thumbnail = '/app/generated/thumbs/' + thumbName;
    } else {
        thumbnail = writeFallbackThumb(id);
    }

    lightEntries.push({
        id: entry.id,
        name: entry.name,
        vertical: entry.vertical || entry.id,
        description: entry.description || '',
        version: entry.version || 1,
        thumbnail: thumbnail,
    });
}

const lightRegistry = {
    registry: { templates: lightEntries },
    // templates stays empty in the boot bundle — filled on demand via ensureTemplateLoaded.
    templates: {},
    heavyPathPrefix: '/app/generated/templates/',
};

const tplDataJs = 'window.HIDOOK_TEMPLATES = ' + JSON.stringify(lightRegistry, null, 2) + ';\n';
fs.writeFileSync(path.join(GEN_DIR, 'templates-data.js'), tplDataJs, 'utf8');
console.log('  templates-data.js written (' + tplDataJs.length + ' bytes) [light registry]');

console.log('build:app done — builder/generated/ ready.');
