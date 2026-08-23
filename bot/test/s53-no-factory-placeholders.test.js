'use strict';
/**
 * S53: opened default presets must not ship factory CDN photos or leftover English factory copy.
 * Run: node bot/test/s53-no-factory-placeholders.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SYSTEMS = ['product-menu', 'portfolio', 'local-service'];

const FACTORY_HOST_RE = /picsum\.photos|unsplash\.com|placehold|loremflickr/i;
/** Image-looking absolute URLs (http/https) — social profile links are not images. */
const IMAGE_HTTPS_RE =
  /https?:\/\/[^\s"'\\)]+\.(?:jpg|jpeg|png|webp|gif|avif|svg)(?:\?[^\s"'\\)]*)?/gi;
const IMAGE_HTTPS_HOST_RE =
  /https?:\/\/(?:picsum|images\.unsplash|source\.unsplash|placehold|via\.placeholder|loremflickr|placekitten|dummyimage)[^\s"'\\)]*/gi;

const FORBIDDEN_IDENTITY = [/DESSERD/i, /MENU\s*BOARD/i, /chalkboard/i, /\bbakery\b/i, /patisserie/i];

let failed = false;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed = true;
    console.error('FAIL', name, '-', e.message);
  }
}

function presetsPath(id) {
  return path.join(ROOT, 'templates', id, 'presets.json');
}

function readPresetsRaw(id) {
  return fs.readFileSync(presetsPath(id), 'utf8');
}

function readPresets(id) {
  return JSON.parse(readPresetsRaw(id));
}

/** Collect relative images/… refs from preset JSON (src fields, gallery strings, CSS url(), ogImage). */
function collectImageRefs(raw) {
  const refs = new Set();
  // url('images/…') or url("images/…") or url(images/…)
  for (const m of raw.matchAll(/url\(\s*['"]?(images\/[^'")\s]+)['"]?\s*\)/gi)) {
    refs.add(m[1].replace(/\\/g, '/'));
  }
  // bare "images/…" string values
  for (const m of raw.matchAll(/"(images\/[^"]+)"/g)) {
    refs.add(m[1]);
  }
  return [...refs];
}

function walkStrings(obj, fn) {
  if (obj == null) return;
  if (typeof obj === 'string') {
    fn(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) walkStrings(x, fn);
    return;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) walkStrings(v, fn);
  }
}

check('all three systems have presets.json', () => {
  for (const id of SYSTEMS) {
    assert.ok(fs.existsSync(presetsPath(id)), `missing ${id}/presets.json`);
  }
});

check('zero factory CDN hosts in three presets.json', () => {
  for (const id of SYSTEMS) {
    const raw = readPresetsRaw(id);
    assert.ok(!FACTORY_HOST_RE.test(raw), `${id}: still contains factory CDN host`);
  }
});

check('no image-looking https:// URLs in three presets', () => {
  for (const id of SYSTEMS) {
    const raw = readPresetsRaw(id);
    const byExt = raw.match(IMAGE_HTTPS_RE) || [];
    const byHost = raw.match(IMAGE_HTTPS_HOST_RE) || [];
    assert.deepStrictEqual(byExt, [], `${id}: image https by extension: ${byExt.join(', ')}`);
    assert.deepStrictEqual(byHost, [], `${id}: image https by host: ${byHost.join(', ')}`);
  }
});

check('relative images/ refs exist on disk under each system', () => {
  for (const id of SYSTEMS) {
    const raw = readPresetsRaw(id);
    const refs = collectImageRefs(raw);
    assert.ok(refs.length >= 3, `${id}: expected several images/ refs, got ${refs.length}`);
    const imgDir = path.join(ROOT, 'templates', id);
    for (const rel of refs) {
      assert.ok(!rel.includes('..'), `${id}: path traversal ${rel}`);
      assert.ok(rel.startsWith('images/'), `${id}: expected images/ prefix, got ${rel}`);
      const abs = path.join(imgDir, rel);
      assert.ok(fs.existsSync(abs), `${id}: missing on disk: ${rel}`);
      const st = fs.statSync(abs);
      assert.ok(st.isFile() && st.size > 32, `${id}: ${rel} too small or not a file`);
    }
  }
});

check('salon (portfolio) presets have no Book now', () => {
  const raw = readPresetsRaw('portfolio');
  assert.ok(!/Book\s+now/i.test(raw), 'portfolio still contains Book now');
  const data = readPresets('portfolio');
  for (const p of data.presets || []) {
    const cta = p.config && p.config.hero && p.config.hero.ctaLabel;
    assert.ok(cta, `${p.id}: missing hero.ctaLabel`);
    assert.ok(!/book\s*now/i.test(String(cta)), `${p.id}: cta still Book now`);
    // Romanian booking CTA (Programare family)
    assert.ok(
      /program/i.test(String(cta)),
      `${p.id}: salon CTA should be Romanian programare-family, got ${JSON.stringify(cta)}`
    );
  }
});

check('product-menu Romanian Casa Nord has no Starters/Mains category labels', () => {
  const data = readPresets('product-menu');
  const casa = (data.presets || []).find((p) => p.id === 'casa-nord' || /casa\s*nord/i.test(p.name || ''));
  assert.ok(casa, 'casa-nord preset required');
  const menu = casa.config && casa.config.menu;
  assert.ok(menu, 'casa-nord menu required');
  const cats = [];
  for (const lang of ['ro', 'en']) {
    const arr = menu[lang];
    if (!Array.isArray(arr)) continue;
    for (const block of arr) {
      if (block && block.category) cats.push(String(block.category));
    }
  }
  assert.ok(cats.length > 0, 'casa-nord must have menu categories');
  for (const c of cats) {
    assert.ok(!/^starters$/i.test(c.trim()), `leftover category Starters: ${c}`);
    assert.ok(!/^mains$/i.test(c.trim()), `leftover category Mains: ${c}`);
  }
});

check('no DESSERD / bakery / chalkboard / MENU BOARD in three presets', () => {
  for (const id of SYSTEMS) {
    const raw = readPresetsRaw(id);
    for (const re of FORBIDDEN_IDENTITY) {
      assert.ok(!re.test(raw), `${id}: forbidden identity ${re}`);
    }
  }
});

check('system ids stay product-menu / portfolio / local-service with ≥2 presets each', () => {
  for (const id of SYSTEMS) {
    const data = readPresets(id);
    assert.ok(Array.isArray(data.presets) && data.presets.length >= 2, `${id} needs ≥2 presets`);
  }
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'registry.json'), 'utf8'));
  const ids = (reg.templates || []).map((t) => t.id);
  for (const id of SYSTEMS) {
    assert.ok(ids.includes(id), `registry missing ${id}`);
  }
  assert.strictEqual(ids.length, 3, 'registry must stay three systems');
});

check('instagram embed + gallery fallback still present on presets', () => {
  for (const id of SYSTEMS) {
    const data = readPresets(id);
    for (const p of data.presets || []) {
      const ig = p.config && p.config.instagram;
      assert.ok(ig, `${id}/${p.id}: missing instagram`);
      assert.ok(ig.embedUrl || ig.url, `${id}/${p.id}: need embedUrl or url`);
      assert.ok(Array.isArray(ig.gallery) && ig.gallery.length >= 1, `${id}/${p.id}: gallery fallback`);
      for (const g of ig.gallery) {
        assert.ok(typeof g === 'string' && g.startsWith('images/'), `${id}/${p.id}: ig gallery must be images/…`);
      }
    }
  }
});

// Sanity: hero/og/gallery image fields are local when present
check('hero CSS url, ogImage, gallery photo srcs are local images/', () => {
  for (const id of SYSTEMS) {
    const data = readPresets(id);
    for (const p of data.presets || []) {
      const cfg = p.config || {};
      const label = `${id}/${p.id}`;
      if (cfg.hero && cfg.hero.background) {
        const bg = String(cfg.hero.background);
        assert.ok(!FACTORY_HOST_RE.test(bg), `${label}: hero still factory CDN`);
        if (/url\s*\(/i.test(bg)) {
          assert.ok(/url\(\s*['"]?images\//i.test(bg), `${label}: hero url must be images/…`);
        }
      }
      if (cfg.seo && cfg.seo.ogImage) {
        assert.ok(String(cfg.seo.ogImage).startsWith('images/'), `${label}: ogImage must be images/…`);
      }
      walkStrings(cfg.categories, (s) => {
        if (/\.(jpe?g|png|webp|gif)$/i.test(s) || s.startsWith('images/')) {
          assert.ok(s.startsWith('images/'), `${label}: category photo not local: ${s}`);
        }
      });
      if (cfg.team && Array.isArray(cfg.team.members)) {
        for (const m of cfg.team.members) {
          if (m && m.photo) {
            assert.ok(String(m.photo).startsWith('images/'), `${label}: team photo not local`);
          }
        }
      }
    }
  }
});

if (failed) {
  console.error('\ns53-no-factory-placeholders.test.js: FAILED');
  process.exit(1);
}
console.log('\ns53-no-factory-placeholders.test.js: all passed');
