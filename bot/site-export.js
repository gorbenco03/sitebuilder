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
        } else if (st.isDirectory() && entry === 'images') {
            for (const img of fs.readdirSync(src)) {
                const from = path.join(src, img);
                if (fs.statSync(from).isFile()) {
                    fs.copyFileSync(from, path.join(imagesDir, img));
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
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfgCopy, null, 2), 'utf8');
    build(dir);
    // build.js already writes legal pages; ensure present even if older build
    writeLegalSiteFiles(dir, cfgCopy);

    // Self-host README (no secrets, no Hidook runtime required)
    const readme =
        '# Site static exportat din Hidook Site Builder\n\n' +
        'Deschide `index.html` pe orice host static (nginx, Netlify, Cloudflare Pages, S3…).\n' +
        'Nu este necesar runtime Hidook. Pagini legale: privacy.html, terms.html, cookies.html.\n' +
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

module.exports = {
    buildStaticSiteTree,
    exportSiteZip,
    materializeImages,
};
