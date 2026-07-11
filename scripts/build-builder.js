#!/usr/bin/env node
'use strict';
/**
 * scripts/build-builder.js — zero-dep bundler for the browser-side builder.
 *
 * Generates two files in builder/generated/:
 *
 *   engine.js        — window.HidookEngine = { renderHtml, escapeHtml, renderPreview }
 *                      The pure render pipeline from build.js wrapped in an IIFE with
 *                      lightweight shims so it runs in the browser without Node.js.
 *
 *   templates-data.js — window.HIDOOK_TEMPLATES = { registry, templates: { <id>: {
 *                        schema, presets, files: { templateHtml, stylesCss, scriptJs,
 *                        collageJs? } } } }
 *                      All template source files read from templates/ at build time.
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
        // a "Schimbă poza" button over images (the full overlay JS handles the rest).
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

    return html;
}
`;

// Embed the overlay source as a JS string literal that renderPreview can use.
// We JSON.stringify it so it is safe to embed inside a JS string (escapes quotes,
// newlines, backslashes, etc.).
const editOverlayEmbedded = JSON.stringify(editOverlaySrc);

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

${renderPreviewSrc}

// ── Public API ────────────────────────────────────────────────────────────────
window.HidookEngine = { renderHtml: renderHtml, escapeHtml: escapeHtml, renderPreview: renderPreview };

})();
`;

fs.writeFileSync(path.join(GEN_DIR, 'engine.js'), engineIife, 'utf8');
console.log('  engine.js written (' + engineIife.length + ' bytes)');

// ─── 2.  templates-data.js ───────────────────────────────────────────────────

const registryRaw  = fs.readFileSync(path.join(TEMPLATES, 'registry.json'), 'utf8');
const registry     = JSON.parse(registryRaw);

const templatesData = {};

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

    templatesData[id] = { schema, presets, files };
}

const tplDataJs = 'window.HIDOOK_TEMPLATES = ' + JSON.stringify({
    registry,
    templates: templatesData,
}, null, 2) + ';\n';

fs.writeFileSync(path.join(GEN_DIR, 'templates-data.js'), tplDataJs, 'utf8');
console.log('  templates-data.js written (' + tplDataJs.length + ' bytes)');

console.log('build:app done — builder/generated/ ready.');
