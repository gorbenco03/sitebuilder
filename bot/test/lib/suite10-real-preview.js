'use strict';
/**
 * bot/test/lib/suite10-real-preview.js
 *
 * Shared helper for suite10's a11y-contrast test and its evidence script:
 * render the ACTUAL builder-preview HTML — the real
 * `builder/generated/engine.js` bundle (build.js's pure renderHtml() +
 * builder/edit-overlay.js's behaviour, exactly what `window.HidookEngine
 * .renderPreview()` produces for the real iframe srcdoc in builder/app.js —
 * see its `buildSrcdoc()`) — rather than reimplementing the Instagram-
 * teaser reveal (`.is-revealed` class + un-hiding `.hb-ig-teaser__veil`) by
 * hand. That reveal is real JS behaviour owned by edit-overlay.js
 * (click-to-reveal, blurs the grid via `.is-revealed`, flips the veil's
 * `hidden` attribute) — simulating it independently would silently drift
 * from whatever that file actually does. Using the real bundle means a
 * Playwright click on the section IS the same interaction a customer's
 * browser performs, including the blur and the button's real
 * position:relative/z-index stacking fix.
 *
 * `builder/generated/engine.js` is a build artifact (gitignored, see
 * .gitignore) — callers must `npm run build:app` first if it may be stale
 * for the templates/build.js/edit-overlay.js currently on disk.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../../..');

let cachedEngine = null;
function loadEngine() {
    if (cachedEngine) return cachedEngine;
    const enginePath = path.join(ROOT, 'builder', 'generated', 'engine.js');
    if (!fs.existsSync(enginePath)) {
        throw new Error(
            'builder/generated/engine.js not found — run `npm run build:app` first ' +
            '(it is a gitignored build artifact, not checked in).'
        );
    }
    const src = fs.readFileSync(enginePath, 'utf8');
    const sandbox = { window: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'engine.js' });
    if (!sandbox.window.HidookEngine || typeof sandbox.window.HidookEngine.renderPreview !== 'function') {
        throw new Error('builder/generated/engine.js loaded but window.HidookEngine.renderPreview is missing');
    }
    cachedEngine = sandbox.window.HidookEngine;
    return cachedEngine;
}

function readTemplateFiles(tpl) {
    const dir = path.join(ROOT, 'templates', tpl);
    const files = {
        templateHtml: fs.readFileSync(path.join(dir, 'template.html'), 'utf8'),
        stylesCss: fs.readFileSync(path.join(dir, 'styles.css'), 'utf8'),
        scriptJs: fs.readFileSync(path.join(dir, 'script.js'), 'utf8'),
    };
    const collagePath = path.join(dir, 'collage.js');
    if (fs.existsSync(collagePath)) files.collageJs = fs.readFileSync(collagePath, 'utf8');
    return files;
}

/**
 * Render the real builder-preview HTML (editMode:true, edit-overlay.js
 * behaviour included) for one template/config. Image `src="images/…"`
 * references are left relative (no imageMap passed) — pair with
 * materializePreviewSite() below to get a file:// loadable directory, or
 * inline your own imageMap if you need a fully self-contained string.
 */
function renderRealPreviewHtml(tpl, config) {
    const engine = loadEngine();
    const files = readTemplateFiles(tpl);
    return engine.renderPreview(files, config, { editMode: true });
}

/**
 * Write the real preview HTML plus the template's actual images/ directory
 * to a fresh temp dir, so it can be opened with Playwright over file://
 * with every `images/…` reference resolving for real (no data-URL
 * inlining, no synthetic assets).
 *
 * @returns {string} the temp directory (caller must fs.rmSync it when done)
 */
function materializePreviewSite(tpl, config) {
    let html = renderRealPreviewHtml(tpl, config);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite10-preview-' + tpl + '-'));
    const tplDir = path.join(ROOT, 'templates', tpl);
    // Copy every asset DIRECTORY the template ships next to its source files
    // — not just images/. desserdirina also ships templates/desserdirina/
    // fonts/ (self-hosted @font-face woff2s, referenced by relative path
    // from styles.css); a hardcoded "images only" copy left those 404ing
    // here even though the real published/preview page serves them fine.
    for (const entry of fs.readdirSync(tplDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        fs.cpSync(path.join(tplDir, entry.name), path.join(dir, entry.name), { recursive: true });
    }
    // renderPreview() rewrites <script src="qrcode.js"> to the ROOT-ABSOLUTE
    // "/app/generated/qrcode.js" (scripts/build-builder.js) — correct for the
    // real builder server, but this harness serves a standalone file:// page
    // with no server at "/", so that 404s here with no bearing on the
    // Instagram teaser. Point it at a real, working copy instead, purely so
    // this harness's console-error/network checks reflect the teaser, not
    // this unrelated, pre-existing WhatsApp-QR asset-path quirk of testing
    // renderPreview() outside its normal iframe/server context.
    const qrSrc = path.join(ROOT, 'builder', 'generated', 'qrcode.js');
    if (html.includes('/app/generated/qrcode.js') && fs.existsSync(qrSrc)) {
        fs.copyFileSync(qrSrc, path.join(dir, 'qrcode.js'));
        html = html.split('/app/generated/qrcode.js').join('qrcode.js');
    }
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    return dir;
}

module.exports = { loadEngine, renderRealPreviewHtml, materializePreviewSite, readTemplateFiles, ROOT };
