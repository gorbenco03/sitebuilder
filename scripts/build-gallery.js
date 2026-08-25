#!/usr/bin/env node
/**
 * build-gallery.js — generates dist-gallery/ with demos per template × preset
 *
 * Zero external dependencies (Node CommonJS).
 * Run: node scripts/build-gallery.js
 *
 * Logic:
 *  1. Reads templates/registry.json
 *  2. For each templateId × presetId:
 *     - Creates dist-gallery/<templateId>-<presetId>/
 *     - Copies template.html, styles.css, script.js (and any other .js in the folder)
 *     - Writes config.json from the preset data
 *     - Runs build.js on that folder → generates index.html
 *  3. Generates dist-gallery/index.html (showcase)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT          = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const DIST_DIR      = path.join(ROOT, 'dist-gallery');
const REGISTRY_PATH = path.join(TEMPLATES_DIR, 'registry.json');

// Files that are NOT copied into the demo (source / meta)
const SKIP_FILES = new Set(['schema.json', 'presets.json', 'README.md', 'collage.js']);

// ─── helpers ────────────────────────────────────────────────────────────────

function mkdirp(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
    fs.copyFileSync(src, dest);
}

/**
 * Copies the relevant files from srcDir to destDir.
 * Skips files in SKIP_FILES and subdirectories.
 */
function copyTemplateFiles(srcDir, destDir) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (SKIP_FILES.has(entry.name)) continue;
        copyFile(path.join(srcDir, entry.name), path.join(destDir, entry.name));
    }
}

// ─── main ────────────────────────────────────────────────────────────────────

function main() {
    // 1. Read registry
    if (!fs.existsSync(REGISTRY_PATH)) {
        console.error('ERROR: registry.json not found at', REGISTRY_PATH);
        process.exit(1);
    }
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

    mkdirp(DIST_DIR);

    // 1b. Compute the set of directories that will be generated in this run
    const expectedDirs = new Set(['index.html']);
    for (const tpl of registry.templates) {
        const tplDir = path.join(TEMPLATES_DIR, tpl.id);
        if (!fs.existsSync(tplDir)) continue;
        const presetsPath = path.join(tplDir, 'presets.json');
        if (!fs.existsSync(presetsPath)) continue;
        let presetsData;
        try { presetsData = JSON.parse(fs.readFileSync(presetsPath, 'utf8')); } catch (e) { continue; }
        if (!Array.isArray(presetsData.presets)) continue;
        for (const preset of presetsData.presets) {
            expectedDirs.add(`${tpl.id}-${preset.id}`);
        }
    }

    // Delete stale directories (not in the current set)
    if (fs.existsSync(DIST_DIR)) {
        const existing = fs.readdirSync(DIST_DIR);
        for (const entry of existing) {
            if (!expectedDirs.has(entry)) {
                const stalePath = path.join(DIST_DIR, entry);
                const stat = fs.statSync(stalePath);
                if (stat.isDirectory()) {
                    fs.rmSync(stalePath, { recursive: true, force: true });
                    console.log(`  🗑  Removed stale directory: ${entry}`);
                }
            }
        }
    }

    // Structure for index.html: { vertical, templateName, templateDesc, demos: [] }
    const verticals = {};   // vertical → { name, description, demos[] }

    // Load build.js once
    const { build } = require(path.join(ROOT, 'build.js'));

    let totalBuilt = 0;
    let totalSkipped = 0;

    // 2. Iterate template × preset
    for (const tpl of registry.templates) {
        const tplDir = path.join(TEMPLATES_DIR, tpl.id);

        // Check it exists on disk
        if (!fs.existsSync(tplDir)) {
            console.warn(`WARNING: template "${tpl.id}" not found on disk (${tplDir}) — skipped.`);
            totalSkipped++;
            continue;
        }

        const presetsPath = path.join(tplDir, 'presets.json');
        if (!fs.existsSync(presetsPath)) {
            console.warn(`WARNING: presets.json missing for "${tpl.id}" — skipped.`);
            totalSkipped++;
            continue;
        }

        const presetsData = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));

        if (!Array.isArray(presetsData.presets) || presetsData.presets.length === 0) {
            console.warn(`WARNING: no valid preset in "${tpl.id}/presets.json" — skipped.`);
            totalSkipped++;
            continue;
        }

        // Group by vertical for index.html
        const vertical = tpl.vertical || tpl.id;
        if (!verticals[vertical]) {
            verticals[vertical] = {
                name:        tpl.name,
                description: tpl.description || '',
                demos:       [],
            };
        }

        for (const preset of presetsData.presets) {
            const demoId  = `${tpl.id}-${preset.id}`;
            const demoDir = path.join(DIST_DIR, demoId);

            console.log(`  → building ${demoId} …`);
            // Clean the demo dir before copying so no stale files remain
            if (fs.existsSync(demoDir)) {
                fs.rmSync(demoDir, { recursive: true, force: true });
            }
            mkdirp(demoDir);

            // Copy the template files (excluding schema/presets/md/template.html)
            copyTemplateFiles(tplDir, demoDir);

            // Write config.json from the preset
            fs.writeFileSync(
                path.join(demoDir, 'config.json'),
                JSON.stringify(preset.config, null, 2),
                'utf8'
            );

            // Run build.js → index.html
            try {
                const result = build(demoDir);
                console.log(`     ✓ ${path.relative(ROOT, result.outputPath)} (${result.bytes} bytes)`);
                totalBuilt++;
            } catch (err) {
                console.error(`     ✗ Build error for ${demoId}:`, err.message);
                totalSkipped++;
                continue;
            }

            // Remove template.html from the output — not needed at runtime and contains unresolved {{
            const tplCopy = path.join(demoDir, 'template.html');
            if (fs.existsSync(tplCopy)) fs.unlinkSync(tplCopy);

            // Add to the demo list for the showcase
            const businessName = (preset.config.business && preset.config.business.name)
                ? preset.config.business.name
                : preset.name;

            verticals[vertical].demos.push({
                demoId,
                presetName:   preset.name,
                businessName,
                templateName: tpl.name,
                description:  tpl.description || '',
            });
        }
    }

    // 3. Generate index.html — showcase
    generateGalleryIndex(verticals);

    console.log(`\nDone! Built: ${totalBuilt} demos | Skipped: ${totalSkipped}`);
    console.log(`Gallery: ${path.join(DIST_DIR, 'index.html')}`);
}

// ─── generate index.html ─────────────────────────────────────────────────────

function generateGalleryIndex(verticals) {
    const verticalKeys = Object.keys(verticals);

    // Build the card sections, grouped by vertical
    let sections = '';
    for (const vKey of verticalKeys) {
        const v = verticals[vKey];
        if (v.demos.length === 0) continue;

        let cards = '';
        for (const demo of v.demos) {
            cards += `
        <article class="card">
          <div class="card-preview">
            <iframe
              src="./${demo.demoId}/index.html"
              loading="lazy"
              title="Preview ${escapeAttr(demo.businessName)}"
              scrolling="no"
              tabindex="-1"
            ></iframe>
            <div class="card-overlay" aria-hidden="true"></div>
          </div>
          <div class="card-body">
            <p class="card-vertical">${escapeHtml(v.name)}</p>
            <h3 class="card-title">${escapeHtml(demo.businessName)}</h3>
            <p class="card-desc">${escapeHtml(demo.description)}</p>
            <a
              class="card-cta"
              href="./${demo.demoId}/index.html"
              target="_blank"
              rel="noopener"
            >View demo &rarr;</a>
          </div>
        </article>`;
        }

        sections += `
      <section class="vertical-section" id="vertical-${escapeAttr(vKey)}">
        <h2 class="vertical-title">${escapeHtml(v.name)}</h2>
        <p class="vertical-desc">${escapeHtml(v.description)}</p>
        <div class="cards-grid">
          ${cards}
        </div>
      </section>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Choose your site template</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --accent:     #4f46e5;
      --accent-lt:  #818cf8;
      --bg:         #f8f9fc;
      --surface:    #ffffff;
      --border:     #e2e6ef;
      --text:       #1e2235;
      --muted:      #6b7280;
      --radius:     14px;
      --shadow:     0 2px 12px rgba(0,0,0,.08);
      --shadow-hov: 0 8px 32px rgba(0,0,0,.14);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }

    /* ── header ── */
    .site-header {
      background: linear-gradient(135deg, #312e81 0%, #4f46e5 100%);
      color: #fff;
      text-align: center;
      padding: 3.5rem 1.5rem 2.5rem;
    }
    .site-header h1 {
      font-size: clamp(1.6rem, 4vw, 2.6rem);
      font-weight: 800;
      letter-spacing: -.02em;
      margin-bottom: .6rem;
    }
    .site-header p {
      font-size: 1.05rem;
      opacity: .85;
      max-width: 52ch;
      margin: 0 auto;
    }

    /* ── nav tabs ── */
    .tab-nav {
      display: flex;
      justify-content: center;
      gap: .5rem;
      flex-wrap: wrap;
      padding: 1.2rem 1rem .8rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .tab-nav a {
      text-decoration: none;
      color: var(--muted);
      font-size: .875rem;
      font-weight: 600;
      padding: .38rem .9rem;
      border-radius: 999px;
      border: 1.5px solid var(--border);
      transition: all .18s;
    }
    .tab-nav a:hover {
      color: var(--accent);
      border-color: var(--accent-lt);
      background: #eef2ff;
    }

    /* ── main content ── */
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4rem;
    }

    .vertical-section { margin-bottom: 3.5rem; }
    .vertical-title {
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: .25rem;
    }
    .vertical-desc {
      font-size: .9rem;
      color: var(--muted);
      margin-bottom: 1.4rem;
    }

    /* ── cards grid ── */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: var(--shadow);
      transition: transform .22s, box-shadow .22s;
      display: flex;
      flex-direction: column;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: var(--shadow-hov);
    }

    /* iframe preview */
    .card-preview {
      position: relative;
      height: 200px;
      overflow: hidden;
      background: #e8eaf0;
    }
    .card-preview iframe {
      width: 1200px;
      height: 900px;
      border: none;
      transform: scale(0.25);
      transform-origin: top left;
      pointer-events: none;
    }
    .card-overlay {
      position: absolute;
      inset: 0;
    }

    /* card body */
    .card-body {
      padding: 1.1rem 1.2rem 1.3rem;
      display: flex;
      flex-direction: column;
      gap: .4rem;
      flex: 1;
    }
    .card-vertical {
      font-size: .72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: var(--accent);
    }
    .card-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
    }
    .card-desc {
      font-size: .84rem;
      color: var(--muted);
      flex: 1;
    }
    .card-cta {
      display: inline-block;
      margin-top: .6rem;
      padding: .48rem 1.1rem;
      background: var(--accent);
      color: #fff;
      font-size: .85rem;
      font-weight: 600;
      border-radius: 8px;
      text-decoration: none;
      align-self: flex-start;
      transition: background .18s;
    }
    .card-cta:hover { background: #4338ca; }

    /* ── footer ── */
    .site-footer {
      text-align: center;
      font-size: .8rem;
      color: var(--muted);
      padding: 1.5rem;
      border-top: 1px solid var(--border);
    }

    /* ── responsive ── */
    @media (max-width: 600px) {
      .cards-grid { grid-template-columns: 1fr; }
      .card-preview { height: 160px; }
      .card-preview iframe {
        width: 960px;
        height: 720px;
        transform: scale(0.2);
      }
    }
  </style>
</head>
<body>

<header class="site-header">
  <h1>Choose your site template</h1>
  <p>Real demos for every kind of business &mdash; pick one, personalize it, and launch in minutes.</p>
</header>

<nav class="tab-nav" aria-label="Categories">
  ${verticalKeys.map(vk => `<a href="#vertical-${escapeAttr(vk)}">${escapeHtml(verticals[vk].name)}</a>`).join('\n  ')}
</nav>

<main>
  ${sections}
</main>

<footer class="site-footer">
  &copy; ${new Date().getFullYear()} &mdash; Auto-generated template gallery.
</footer>

</body>
</html>`;

    const indexPath = path.join(DIST_DIR, 'index.html');
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`  ✓ Gallery: ${path.relative(ROOT, indexPath)}`);
}

// ─── escape helpers ───────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─── run ─────────────────────────────────────────────────────────────────────

console.log('🏗  build-gallery.js — started\n');
main();
