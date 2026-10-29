#!/usr/bin/env node
'use strict';
/**
 * Small WebP copies of every template photo the starter packs use, for the
 * previews on the landing, in Site-urile mele and in the editor's pickers.
 * A preview shows a whole page shrunk to a card, so the full photos
 * (250-330 KB each, ~14 MB for the landing) were downloaded to be shown at
 * thumbnail size. Published sites and the editor canvas keep the full photos.
 *
 * Dev-time only (needs `cwebp`, e.g. `brew install webp`); the output is
 * committed under builder/blocks/thumbs/ and versioned by build-builder.js.
 * Re-run after adding or replacing a pack photo:
 *   node scripts/make-preview-thumbs.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'builder', 'blocks', 'thumbs');
const WIDTH = 640;
const QUALITY = 70;

function referencedPhotos() {
    const ctx = { window: {} };
    vm.createContext(ctx);
    let text = '';
    for (const f of ['packs.js', 'packs-more.js', 'blocks.js']) {
        const src = fs.readFileSync(path.join(ROOT, 'builder', 'blocks', f), 'utf8');
        vm.runInContext(src, ctx);
        text += src;
    }
    text += JSON.stringify(ctx.window.SB_PACKS) + JSON.stringify(ctx.window.SB.IMAGES);
    return [...new Set(text.match(/@tpl\/[\w-]+\/images\/[\w.-]+\.(?:jpe?g|png)/g) || [])].map((r) => r.slice(5));
}

const photos = referencedPhotos();
const keep = new Set();
let before = 0;
let after = 0;
for (const rel of photos) {
    const src = path.join(ROOT, 'templates', rel);
    const dest = path.join(OUT, rel.replace(/\.(jpe?g|png)$/i, '.webp'));
    keep.add(dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', '-metadata', 'none', src, '-o', dest]);
    before += fs.statSync(src).size;
    after += fs.statSync(dest).size;
}

// Drop thumbnails of photos no pack uses any more.
(function prune(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (fs.statSync(abs).isDirectory()) prune(abs);
        else if (!keep.has(abs)) fs.unlinkSync(abs);
    }
})(OUT);

console.log(`${photos.length} photos: ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB`);
