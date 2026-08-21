#!/usr/bin/env node
'use strict';
/**
 * scripts/build-site.js — assemble a sample static site into dist/ for local/dev
 * static hosting checks. Zero dependencies, Node 18+.
 *
 *   node scripts/build-site.js        (or:  npm run build)
 *
 * Commercial product identity is Hidook Site Builder (browser builder via
 * `npm run build:app`). This script only packs the root sample landing page —
 * do not treat legacy sample labels as the product.
 *
 * It renders index.html from template.html + config.json, then copies ONLY the
 * files that make up the live site into dist/ (build inputs like template.html and
 * config.json are NOT shipped). Only images actually referenced by the page are
 * copied, so dist/ stays lean.
 */

const fs   = require('fs');
const path = require('path');
const { build } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 1) Render index.html from template.html + config.json
build(ROOT);

// 2) Fresh dist/
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'images'), { recursive: true });

// 3) Copy the static files that make up the site
const FILES = ['index.html', 'styles.css', 'script.js', 'collage.js', 'robots.txt', 'sitemap.xml'];
let files = 0;
for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(DIST, f)); files++; }
}

// 4) Copy only images actually referenced by the built page (keeps dist lean)
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const used = new Set([...html.matchAll(/images\/([A-Za-z0-9._-]+\.[A-Za-z0-9]+)/g)].map(m => m[1]));
let imgs = 0;
for (const name of used) {
    const src = path.join(ROOT, 'images', name);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(DIST, 'images', name)); imgs++; }
    else console.warn('  ⚠️  referenced image missing:', name);
}

// 5) Cloudflare Pages headers: long-cache immutable assets + basic security headers
fs.writeFileSync(path.join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/images/*
  Cache-Control: public, max-age=31536000, immutable

/styles.css
  Cache-Control: public, max-age=86400
/script.js
  Cache-Control: public, max-age=86400
/collage.js
  Cache-Control: public, max-age=86400
`);

console.log(`✅ dist/ ready — ${files} files + ${imgs} images.`);
console.log('   Sample static assemble only (local/dev). Commercial product: browser builder (npm run build:app).');
console.log('   Do not deploy this sample as Hidook Site Builder identity; see CLOUDFLARE-DEPLOY.md.');
