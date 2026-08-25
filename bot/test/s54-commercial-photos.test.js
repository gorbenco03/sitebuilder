'use strict';
/**
 * S54: opened default photography must be commercial scale, not 48×32 chips.
 * Run: node bot/test/s54-commercial-photos.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SYSTEMS = ['product-menu', 'portfolio', 'local-service'];
const MIN_W = 960;
const MIN_H = 640;
const MIN_BYTES = 24 * 1024;
const MIN_EDGE_ANY_FILE = 200;
const FACTORY_HOST_RE = /picsum\.photos|unsplash\.com|placehold|loremflickr/i;

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

/** Collect relative images/… refs from preset JSON (src fields, gallery strings, CSS url(), ogImage). */
function collectImageRefs(raw) {
  const refs = new Set();
  for (const m of raw.matchAll(/url\(\s*['"]?(images\/[^'")\s]+)['"]?\s*\)/gi)) {
    refs.add(m[1].replace(/\\/g, '/'));
  }
  for (const m of raw.matchAll(/"(images\/[^"]+)"/g)) {
    refs.add(m[1]);
  }
  return [...refs];
}

function listImageFiles(systemId) {
  const dir = path.join(ROOT, 'templates', systemId, 'images');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /\.(jpe?g|png)$/i.test(n))
    .map((n) => path.join(dir, n));
}

/** Decode JPEG SOF0/1/2 dimensions or PNG IHDR. */
function imageDimensions(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { w, h, kind: 'png' };
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`not JPEG/PNG: ${absPath}`);
  }
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const seglen = buf.readUInt16BE(i + 2);
    if (seglen < 2) break;
    // SOF0 / SOF1 / SOF2
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h, kind: 'jpeg' };
    }
    i += 2 + seglen;
  }
  throw new Error(`no SOF in JPEG: ${absPath}`);
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
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

const allRefsBySystem = {};
check('relative images/ refs exist on disk under each system', () => {
  for (const id of SYSTEMS) {
    const raw = readPresetsRaw(id);
    const refs = collectImageRefs(raw);
    allRefsBySystem[id] = refs;
    assert.ok(refs.length >= 3, `${id}: expected several images/ refs, got ${refs.length}`);
    const imgDir = path.join(ROOT, 'templates', id);
    for (const rel of refs) {
      assert.ok(!rel.includes('..'), `${id}: path traversal ${rel}`);
      assert.ok(rel.startsWith('images/'), `${id}: expected images/ prefix, got ${rel}`);
      const abs = path.join(imgDir, rel);
      assert.ok(fs.existsSync(abs), `${id}: missing on disk: ${rel}`);
    }
  }
});

check('every referenced image is ≥960×640 and ≥24 KiB', () => {
  for (const id of SYSTEMS) {
    const refs = allRefsBySystem[id] || collectImageRefs(readPresetsRaw(id));
    const imgDir = path.join(ROOT, 'templates', id);
    for (const rel of refs) {
      const abs = path.join(imgDir, rel);
      const st = fs.statSync(abs);
      assert.ok(
        st.size >= MIN_BYTES,
        `${id}/${rel}: size ${st.size} < ${MIN_BYTES} (still a chip?)`
      );
      const { w, h } = imageDimensions(abs);
      assert.ok(
        w >= MIN_W && h >= MIN_H,
        `${id}/${rel}: dims ${w}×${h} < ${MIN_W}×${MIN_H}`
      );
    }
  }
});

check('no leftover chips in three images/ dirs (all files ≥960×640 and ≥24 KiB)', () => {
  for (const id of SYSTEMS) {
    const files = listImageFiles(id);
    assert.ok(files.length > 0, `${id}: empty images/`);
    for (const abs of files) {
      const rel = path.relative(path.join(ROOT, 'templates', id), abs);
      const st = fs.statSync(abs);
      assert.ok(st.size >= MIN_BYTES, `${id}/${rel}: size ${st.size} < ${MIN_BYTES}`);
      const { w, h } = imageDimensions(abs);
      assert.ok(w >= MIN_EDGE_ANY_FILE && h >= MIN_EDGE_ANY_FILE, `${id}/${rel}: edge < 200 (${w}×${h})`);
      assert.ok(
        w >= MIN_W && h >= MIN_H,
        `${id}/${rel}: leftover small image ${w}×${h}`
      );
    }
  }
});

check('referenced preset image paths have unique SHA-256 (no cloned blobs)', () => {
  const seen = new Map();
  for (const id of SYSTEMS) {
    const refs = allRefsBySystem[id] || collectImageRefs(readPresetsRaw(id));
    const imgDir = path.join(ROOT, 'templates', id);
    for (const rel of refs) {
      const abs = path.join(imgDir, rel);
      const hash = sha256File(abs);
      const key = `${id}/${rel}`;
      if (seen.has(hash)) {
        assert.fail(`duplicate blob SHA-256: ${key} == ${seen.get(hash)}`);
      }
      seen.set(hash, key);
    }
  }
  assert.ok(seen.size >= 20, `expected many unique images, got ${seen.size}`);
});

check('system ids stay product-menu / portfolio / local-service', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'registry.json'), 'utf8'));
  const ids = (reg.templates || []).map((t) => t.id);
  for (const id of SYSTEMS) {
    assert.ok(ids.includes(id), `registry missing ${id}`);
  }
  assert.strictEqual(ids.length, 4, 'registry must stay four systems');
});

if (failed) {
  console.error('\ns54-commercial-photos.test.js: FAILED');
  process.exit(1);
}
console.log('\ns54-commercial-photos.test.js: all passed');
