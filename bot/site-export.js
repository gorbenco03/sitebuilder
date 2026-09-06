'use strict';
/**
 * bot/site-export.js — build a complete static site tree + ZIP for self-deploy.
 * No Hidook runtime required after unzip. Zero new npm deps.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../build.js');
const { createZip } = require('./zip.js');
const { writeLegalSiteFiles } = require('./site-legal.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const TEMPLATE_EXCLUDES = /^(schema\.json|presets\.json)$|\.md$/i;

function decodeDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const m = String(dataUrl).replace(/\s+/g, '').match(
        /^data:(image\/(?:jpeg|jpg|png|webp|gif|avif));base64,([A-Za-z0-9+/=]+)$/i
    );
    if (!m) return null;
    try {
        return { mimeType: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
    } catch {
        return null;
    }
}

function extFromMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    if (m.includes('gif')) return 'gif';
    if (m.includes('avif')) return 'avif';
    return 'jpg';
}

function imageFilename(name, mimeHint) {
    const lower = String(name || 'img').toLowerCase().replace(/\.[a-z0-9]+$/, '');
    const ext = extFromMime(mimeHint);
    if (lower === 'logo') return 'logo.' + ext;
    if (lower === 'hero') return 'hero.' + ext;
    if (/^gallery-\d+$/.test(lower)) return lower + '.' + ext;
    if (/^hero-\d+$/.test(lower)) return lower + '.' + ext;
    const safe = lower.replace(/[^a-z0-9-]/g, '').slice(0, 40);
    return safe ? safe + '.' + ext : null;
}

function rewriteDataUrl(obj, dataUrl, localPath) {
    if (!obj || typeof obj !== 'object') return;
    const bare = String(dataUrl || '').replace(/\s+/g, '');
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string') {
            const compact = val.replace(/\s+/g, '');
            if (val === dataUrl || compact === bare) {
                if (/background|style|gradient/i.test(key)) {
                    obj[key] = "url('" + localPath + "')";
                } else {
                    obj[key] = localPath;
                }
            } else if (val.includes(dataUrl) || (bare && compact.includes(bare))) {
                if (val.includes(dataUrl)) {
                    obj[key] = val.split(dataUrl).join(localPath);
                } else {
                    obj[key] = val.replace(
                        /data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+/gi,
                        (m) => (m.replace(/\s+/g, '') === bare ? localPath : m)
                    );
                }
            }
        } else if (typeof val === 'object' && val !== null) {
            rewriteDataUrl(val, dataUrl, localPath);
        }
    }
}

function materializeImages(cfg, imagesDir, explicitImages) {
    const written = new Set();
    function writeOne(name, dataUrl) {
        const decoded = decodeDataUrl(dataUrl);
        if (!decoded) return null;
        let fname = imageFilename(name, decoded.mimeType);
        if (!fname) return null;
        if (written.has(fname)) {
            const base = fname.replace(/\.(jpe?g|png|webp|gif|avif)$/i, '');
            const ext = (fname.match(/\.(jpe?g|png|webp|gif|avif)$/i) || ['.jpg'])[0];
            let n = 2;
            while (written.has(base + '-' + n + ext)) n++;
            fname = base + '-' + n + ext;
        }
        fs.mkdirSync(imagesDir, { recursive: true });
        fs.writeFileSync(path.join(imagesDir, fname), decoded.buffer);
        written.add(fname);
        const localPath = 'images/' + fname;
        rewriteDataUrl(cfg, dataUrl, localPath);
        return localPath;
    }
    for (const img of explicitImages || []) {
        if (!img || !img.dataUrl || !img.name) continue;
        writeOne(img.name, img.dataUrl);
    }
    const DATA_RE = /data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+/gi;
    function walkLeftovers(obj, parentKey) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => walkLeftovers(item, parentKey || String(i)));
            return;
        }
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string' && val.includes('data:image/')) {
                if (val.startsWith('data:image/')) {
                    const hint = /logo/i.test(key) ? 'logo' : /background/i.test(key) ? 'hero' : 'gallery';
                    writeOne(hint, val);
                } else {
                    const found = val.match(DATA_RE) || [];
                    let n = 0;
                    for (const raw of found) {
                        n++;
                        const hint = /background/i.test(key) ? (n === 1 ? 'hero' : 'hero-' + n) : 'gallery';
                        writeOne(hint, raw);
                    }
                }
            } else if (typeof val === 'object' && val !== null) {
                walkLeftovers(val, key);
            }
        }
    }
    walkLeftovers(cfg, '');
}

function copyTemplateTree(templateId, siteDir) {
    const templateDir = path.join(TEMPLATES_DIR, templateId);
    const imagesDir = path.join(siteDir, 'images');
    if (!fs.existsSync(templateDir)) {
        const err = new Error('Template not found: ' + templateId);
        err.code = 'TEMPLATE_MISSING';
        throw err;
    }
    fs.mkdirSync(siteDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });
    for (const entry of fs.readdirSync(templateDir)) {
        if (TEMPLATE_EXCLUDES.test(entry)) continue;
        const src = path.join(templateDir, entry);
        const st = fs.statSync(src);
        if (st.isFile()) {
            fs.copyFileSync(src, path.join(siteDir, entry));
        } else if (st.isDirectory()) {
            // Any asset directory a template ships, not just images/. This
            // used to be `entry === 'images'`, which silently dropped
            // desserdirina's self-hosted fonts/ -- the published site kept
            // the @font-face rules and lost the files they point at.
            const destDir = entry === 'images' ? imagesDir : path.join(siteDir, entry);
            fs.mkdirSync(destDir, { recursive: true });
            for (const asset of fs.readdirSync(src)) {
                const from = path.join(src, asset);
                if (fs.statSync(from).isFile()) {
                    fs.copyFileSync(from, path.join(destDir, asset));
                }
            }
        }
    }
}

function walkFiles(dir, base, out) {
    for (const entry of fs.readdirSync(dir)) {
        if (entry === '.' || entry === '..') continue;
        // Skip build inputs not needed for static serve
        if (/^(template\.html|config\.json|schema\.json|presets\.json)$/i.test(entry)) continue;
        if (/\.md$/i.test(entry)) continue;
        const full = path.join(dir, entry);
        const rel = base ? base + '/' + entry : entry;
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            walkFiles(full, rel, out);
        } else if (st.isFile()) {
            out.push({ name: rel.replace(/\\/g, '/'), full });
        }
    }
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mimeTypeForImage(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.avif') return 'image/avif';
    if (ext === '.svg') return 'image/svg+xml';
    return 'image/jpeg';
}

function inlineTreeAssets(html, siteDir) {
    let out = String(html || '');
    for (const name of ['styles.css', 'cookie-banner.css']) {
        const file = path.join(siteDir, name);
        if (!fs.existsSync(file)) continue;
        const css = fs.readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style');
        out = out.replace(
            new RegExp('<link\\s[^>]*href=["\']' + escapeRegExp(name) + '["\'][^>]*>', 'gi'),
            '<style data-hb-inline="' + name + '">' + css + '</style>'
        );
    }
    for (const name of ['qrcode.js', 'script.js', 'collage.js', 'cookie-banner.js']) {
        const file = path.join(siteDir, name);
        if (!fs.existsSync(file)) continue;
        const js = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
        out = out.replace(
            new RegExp('<script\\s[^>]*src=["\']' + escapeRegExp(name) + '["\'][^>]*>\\s*<\\/script>', 'gi'),
            '<script data-hb-inline="' + name + '">' + js + '</script>'
        );
    }
    const imagesDir = path.join(siteDir, 'images');
    if (fs.existsSync(imagesDir)) {
        for (const name of fs.readdirSync(imagesDir)) {
            const file = path.join(imagesDir, name);
            if (!fs.statSync(file).isFile()) continue;
            const rel = 'images/' + name;
            const dataUrl = 'data:' + mimeTypeForImage(name) + ';base64,' + fs.readFileSync(file).toString('base64');
            out = out.split(rel).join(dataUrl);
        }
    }
    return out;
}

const STANDALONE_LEGAL_NAV_JS = `(function () {
  function documents() {
    var node = document.getElementById('hb-export-documents');
    return node ? JSON.parse(node.textContent) : {};
  }
  function bootMarkup() {
    var data = document.getElementById('hb-export-documents');
    var boot = document.querySelector('script[data-hb-export-nav]');
    if (!data || !boot) return '';
    return '<scr' + 'ipt type="application/json" id="hb-export-documents">' + data.textContent +
      '</scr' + 'ipt><scr' + 'ipt data-hb-export-nav>' + boot.textContent + '</scr' + 'ipt>';
  }
  function show(name) {
    var page = documents()[name];
    if (!page) return;
    page = String(page).replace(/<\\/body>/i, bootMarkup() + '</body>');
    document.open(); document.write(page); document.close();
    try { window.scrollTo(0, 0); } catch (_) {}
  }
  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('a[data-hb-export-page]') : null;
    if (!target) return;
    event.preventDefault();
    show(target.getAttribute('data-hb-export-page'));
  });
})();`;

function rewriteStandalonePageLinks(html) {
    return String(html || '').replace(
        /href=(["'])(index|privacy|terms|cookies)\.html\1/gi,
        (_match, _quote, page) => 'href="#hb-export-' + page + '" data-hb-export-page="' + page + '.html"'
    );
}

function appendStandaloneDocuments(html, documents) {
    const json = JSON.stringify(documents).replace(/</g, '\\u003c');
    const boot = '<script type="application/json" id="hb-export-documents">' + json + '</script>' +
        '<script data-hb-export-nav>' + STANDALONE_LEGAL_NAV_JS + '</script>';
    const bodyAt = html.toLowerCase().lastIndexOf('</body>');
    if (bodyAt < 0) return html + boot;
    return html.slice(0, bodyAt) + boot + html.slice(bodyAt);
}

/**
 * F6 — robots.txt / sitemap.xml content for a built site directory. Shared by
 * this module's own exports (ZIP / standalone HTML) and required from
 * bot/webpublish.js so the LIVE publish path gets byte-for-byte the same
 * shape instead of a second hand-written copy.
 *
 * `origin` is the absolute "https://host" (no trailing slash, no path) the
 * site is expected to be served from. When it is not yet known — an offline
 * export that was never published through Hidook has no live URL to derive
 * one from — callers pass '' and this falls back to an RFC 2606 "invalid"
 * placeholder host. That keeps the sitemap syntactically valid XML with
 * absolute <loc> values (the sitemap protocol requires them) without ever
 * asking the client to type a domain (owner ruled that out, 2026-09-02
 * feedback) — bot/webpublish.js's live path always predicts or corrects the
 * real origin instead of ever shipping this placeholder to a live site.
 *
 * `pages` is the ordered list of page filenames known to exist in the site
 * directory, e.g. ['index.html','privacy.html','terms.html','cookies.html'].
 * A single-page site legitimately gets a single-entry sitemap.
 *
 * @param {string} origin
 * @param {string[]} pages
 * @returns {{ robotsTxt: string, sitemapXml: string, base: string }}
 */
const SEO_PLACEHOLDER_ORIGIN = 'https://export.invalid';

function buildSeoFiles(origin, pages) {
    const base = (origin && /^https?:\/\//i.test(origin))
        ? origin.replace(/\/+$/, '')
        : SEO_PLACEHOLDER_ORIGIN;
    const locs = (pages || [])
        .filter(Boolean)
        .map((p) => (p === 'index.html' ? `${base}/` : `${base}/${p}`));
    const robotsTxt = `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
    const items = locs.map((loc) => `  <url><loc>${loc}</loc></url>`).join('\n');
    const sitemapXml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        items + '\n</urlset>\n';
    return { robotsTxt, sitemapXml, base };
}

/** Absolute origin (scheme+host, no path) from a config's seo.canonical, or ''. */
function originFromCanonical(canonical) {
    if (!canonical || !/^https?:\/\//i.test(String(canonical))) return '';
    try {
        return new URL(canonical).origin;
    } catch (_) {
        return '';
    }
}

/**
 * Build a complete static site directory (HTML/CSS/JS/images/legal/badge).
 * @returns {{ siteDir: string, cleanup: function }}
 */
function buildStaticSiteTree({ templateId, config, images, siteDir }) {
    const dir = siteDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-export-'));
    const tpl = templateId || 'product-menu';
    copyTemplateTree(tpl, dir);
    const cfgCopy = JSON.parse(JSON.stringify(config || {}));
    materializeImages(cfgCopy, path.join(dir, 'images'), images || []);

    // F5/F6: this config was already published through Hidook → its
    // seo.canonical origin is the real live/custom domain, reuse it. Never
    // published (fresh ZIP/HTML export) → fall back to the same RFC 2606
    // placeholder buildSeoFiles uses, so the template's `@if seo.canonical`
    // guard still emits <link rel="canonical">/<meta property="og:url">
    // (own og:image stays relative — build.js's deriveSocialImage is
    // deliberately host-agnostic for offline exports; see webpublish.js's F3
    // section). README-EXPORT.txt below tells the client to regenerate the
    // export after publishing so both correct themselves automatically.
    cfgCopy.seo = (cfgCopy.seo && typeof cfgCopy.seo === 'object') ? cfgCopy.seo : {};
    const exportOrigin = originFromCanonical(cfgCopy.seo.canonical) || SEO_PLACEHOLDER_ORIGIN;
    if (!cfgCopy.seo.canonical) {
        cfgCopy.seo.canonical = `${exportOrigin}/`;
    }

    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfgCopy, null, 2), 'utf8');
    build(dir);
    // build.js already writes legal pages; ensure present even if older build
    writeLegalSiteFiles(dir, cfgCopy);

    // F6: robots.txt + sitemap.xml — every export gets both (live publish
    // path is bot/webpublish.js, wired the same way via buildSeoFiles), using
    // the same origin as the canonical link above.
    const seoPages = ['index.html'];
    for (const p of ['privacy.html', 'terms.html', 'cookies.html']) {
        if (fs.existsSync(path.join(dir, p))) seoPages.push(p);
    }
    const { robotsTxt, sitemapXml } = buildSeoFiles(exportOrigin, seoPages);
    fs.writeFileSync(path.join(dir, 'robots.txt'), robotsTxt, 'utf8');
    fs.writeFileSync(path.join(dir, 'sitemap.xml'), sitemapXml, 'utf8');

    // Self-host README (no secrets, no Hidook runtime required)
    const readme =
        '# Site static exportat din Hidook Site Builder\n\n' +
        'Deschide `index.html` pe orice host static (nginx, Netlify, Cloudflare Pages, S3…).\n' +
        'Nu este necesar runtime Hidook. Pagini legale: privacy.html, terms.html, cookies.html.\n' +
        'robots.txt și sitemap.xml sunt incluse; dacă publici pe alt domeniu decât cel din\n' +
        'sitemap.xml, regenerează exportul din Hidook după publicare ca să se actualizeze automat.\n' +
        'Mențiune: Build by hidook.tech powered by hidook.agency\n';
    fs.writeFileSync(path.join(dir, 'README-EXPORT.txt'), readme, 'utf8');

    return {
        siteDir: dir,
        cleanup: () => {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch (_) {}
        },
    };
}

/**
 * @returns {{ zip: Buffer, filename: string, files: string[] }}
 */
function exportSiteZip(opts) {
    const built = buildStaticSiteTree(opts);
    try {
        const list = [];
        walkFiles(built.siteDir, '', list);
        const entries = list.map((f) => ({
            name: f.name,
            data: fs.readFileSync(f.full),
        }));
        // Ensure legal pages are in the archive even if walk skipped somehow
        for (const must of ['index.html', 'privacy.html', 'terms.html', 'cookies.html', 'cookie-banner.js', 'cookie-banner.css']) {
            if (!entries.some((e) => e.name === must)) {
                const p = path.join(built.siteDir, must);
                if (fs.existsSync(p)) entries.push({ name: must, data: fs.readFileSync(p) });
            }
        }
        const zip = createZip(entries);
        const raw =
            (opts && opts.slug) ||
            (opts && opts.config && opts.config.business && opts.config.business.name) ||
            'site';
        const base = String(raw)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'site';
        return {
            zip,
            filename: base + '.zip',
            files: entries.map((e) => e.name),
        };
    } finally {
        if (!opts || !opts.siteDir) built.cleanup();
    }
}

/** Build one browser-openable HTML document with all local assets and legal pages embedded. */
function exportSiteHtml(opts) {
    const built = buildStaticSiteTree(opts);
    try {
        const documents = {};
        for (const name of ['index.html', 'privacy.html', 'terms.html', 'cookies.html']) {
            const file = path.join(built.siteDir, name);
            if (!fs.existsSync(file)) continue;
            documents[name] = rewriteStandalonePageLinks(
                inlineTreeAssets(fs.readFileSync(file, 'utf8'), built.siteDir)
            );
        }
        return { html: appendStandaloneDocuments(documents['index.html'] || '', documents) };
    } finally {
        if (!opts || !opts.siteDir) built.cleanup();
    }
}

module.exports = {
    buildStaticSiteTree,
    exportSiteHtml,
    exportSiteZip,
    materializeImages,
    buildSeoFiles,
    // Exported for bot/test/wave5-template-asset-dirs.test.js, which asserts
    // that a template's asset directories (fonts/, not just images/) reach
    // the copied site.
    copyTemplateTree,
};
