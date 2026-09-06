'use strict';
/**
 * bot/test/wave7-images-responsive.test.js
 *
 * Wave7: responsive image pipeline (2-3 width variants per source photo,
 * WebP + JPEG/PNG fallback, srcset/sizes/width/height emission, CLS
 * protection for owner-uploaded photos).
 *
 * Covers:
 *  - build.js's injectResponsiveImages()/decodeRasterDims() unit behaviour
 *    (picture-wrapping, width/height emission, data: URI CLS fix,
 *    idempotency, and everything it must leave alone).
 *  - scripts/generate-image-variants.js's committed output (images/
 *    variants.json + the *.webp files it points at) for every template
 *    that has one.
 *  - End-to-end: rendering a real preset through build.js produces valid
 *    <picture> markup whose files actually exist on disk.
 *  - package.json gained zero new (non-dev) dependencies for this.
 *
 * Run: node bot/test/wave7-images-responsive.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { injectResponsiveImages, decodeRasterDims, renderHtml } = require(path.join(ROOT, 'build.js'));

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

// ── unit: injectResponsiveImages ───────────────────────────────────────────

const FIXTURE_DIR = path.join(ROOT, 'templates', 'local-service');

check('manifest-covered <img> becomes a <picture> with webp srcset + width/height', () => {
  const html = '<figure><img src="images/pr-baie1.jpg" alt="x" loading="lazy" decoding="async"></figure>';
  const out = injectResponsiveImages(html, FIXTURE_DIR);
  assert.ok(out.includes('<picture>'), 'expected a <picture> wrapper');
  assert.ok(out.includes('type="image/webp"'), 'expected a webp <source>');
  assert.ok(/srcset="images\/pr-baie1-480w\.webp 480w, images\/pr-baie1-960w\.webp 960w"/.test(out), 'unexpected srcset: ' + out);
  assert.ok(/sizes="[^"]+"/.test(out), 'expected a sizes attribute');
  assert.ok(/<img[^>]*src="images\/pr-baie1\.jpg"[^>]*width="960"[^>]*height="960"/.test(out), 'fallback <img> missing width/height: ' + out);
  assert.ok(out.includes('alt="x"') && out.includes('loading="lazy") '.trim().slice(0, -1)) || out.includes('loading="lazy"'), 'original attributes must survive');
});

check('data: URI photo (owner upload) gets width/height but no <picture>/srcset', () => {
  const buf = fs.readFileSync(path.join(FIXTURE_DIR, 'images', 'pr-baie1.jpg'));
  const html = `<img src="data:image/jpeg;base64,${buf.toString('base64')}" alt="logo">`;
  const out = injectResponsiveImages(html, FIXTURE_DIR);
  assert.ok(!out.includes('<picture>'), 'a raw data: URI must not be picture-wrapped (no build-time variants exist)');
  assert.ok(!out.includes('srcset'), 'a raw data: URI must not gain a srcset');
  assert.ok(/width="960"\s+height="960"/.test(out), 'expected decoded intrinsic dimensions on the <img>: ' + out.slice(-80));
});

check('image without a manifest entry still gets width/height from the file on disk', () => {
  // pr-hero.jpg is a real file in this template's images/ dir but is used
  // only via CSS background: url(...), so the generator deliberately never
  // made it a variants.json entry (see scripts/generate-image-variants.js).
  const html = '<img src="images/pr-hero.jpg" alt="hero">';
  const out = injectResponsiveImages(html, FIXTURE_DIR);
  assert.ok(!out.includes('<picture>'), 'no manifest entry means no <picture> wrap');
  assert.ok(/width="1066"\s+height="1600"/.test(out), 'expected real on-disk dimensions: ' + out);
});

check('already-sized <img> (e.g. the WhatsApp QR slot) is left untouched — idempotent', () => {
  const html = '<img id="wa-qr-img" alt="QR" width="240" height="240">';
  const out = injectResponsiveImages(html, FIXTURE_DIR);
  assert.strictEqual(out, html, 'an <img> that already has width= must not be modified');
});

check('empty src, "#", and external URLs are left untouched', () => {
  for (const src of ['', '#', 'https://example.com/x.jpg']) {
    const html = `<img src="${src}" alt="x">`;
    const out = injectResponsiveImages(html, FIXTURE_DIR);
    assert.strictEqual(out, html, `src="${src}" must not be modified`);
  }
});

check('CSS hero background url(...) is never touched (only <img> tags are processed)', () => {
  const html = '<div style="background: url(\'images/pr-hero.jpg\') center/cover"></div>';
  const out = injectResponsiveImages(html, FIXTURE_DIR);
  assert.strictEqual(out, html, 'CSS background url() must be byte-identical — no <img>, nothing to wrap');
});

check('decodeRasterDims reads JPEG and PNG headers and returns null for junk', () => {
  const jpeg = fs.readFileSync(path.join(FIXTURE_DIR, 'images', 'pr-baie1.jpg'));
  assert.deepStrictEqual(decodeRasterDims(jpeg), { width: 960, height: 960 });
  assert.strictEqual(decodeRasterDims(Buffer.from('not an image')), null);
});

// ── manifest + committed variant files, for every template that has one ───

const TEMPLATES_DIR = path.join(ROOT, 'templates');
const ALL_TEMPLATE_IDS = fs
  .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((id) => fs.existsSync(path.join(TEMPLATES_DIR, id, 'presets.json')));

check('every template has a committed images/variants.json (Wave7 ran everywhere)', () => {
  for (const id of ALL_TEMPLATE_IDS) {
    const p = path.join(TEMPLATES_DIR, id, 'images', 'variants.json');
    assert.ok(fs.existsSync(p), `missing ${path.relative(ROOT, p)}`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(p, 'utf8')), `${id}: variants.json is not valid JSON`);
  }
});

check('every variants.json entry points at real, non-empty webp files with correct manifest byte counts', () => {
  let totalVariantFiles = 0;
  for (const id of ALL_TEMPLATE_IDS) {
    const manifestPath = path.join(TEMPLATES_DIR, id, 'images', 'variants.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [rel, entry] of Object.entries(manifest)) {
      assert.ok(/^images\/[^/]+\.(?:jpe?g|png)$/i.test(rel), `${id}: unexpected manifest key ${rel}`);
      assert.ok(fs.existsSync(path.join(TEMPLATES_DIR, id, rel)), `${id}: manifest references missing original ${rel}`);
      assert.ok(typeof entry.width === 'number' && entry.width > 0, `${id}/${rel}: bad width`);
      assert.ok(typeof entry.height === 'number' && entry.height > 0, `${id}/${rel}: bad height`);
      assert.ok(Array.isArray(entry.variants) && entry.variants.length >= 2 && entry.variants.length <= 3,
        `${id}/${rel}: expected 2-3 variants, got ${entry.variants && entry.variants.length}`);
      const widths = new Set();
      for (const v of entry.variants) {
        const abs = path.join(TEMPLATES_DIR, id, v.webp);
        assert.ok(fs.existsSync(abs), `${id}: missing variant file ${v.webp}`);
        const st = fs.statSync(abs);
        assert.ok(st.size > 0, `${id}: empty variant file ${v.webp}`);
        assert.strictEqual(st.size, v.bytes, `${id}/${v.webp}: manifest bytes stale (${v.bytes} vs real ${st.size})`);
        assert.ok(v.width <= entry.width, `${id}/${v.webp}: variant width ${v.width} exceeds source width ${entry.width} (upscaled!)`);
        widths.add(v.width);
        totalVariantFiles++;
      }
      assert.strictEqual(widths.size, entry.variants.length, `${id}/${rel}: duplicate widths in variants`);
    }
  }
  assert.ok(totalVariantFiles > 50, `expected many variant files across all templates, found ${totalVariantFiles}`);
});

check('generator never wrote a .jpg/.png (would collide with s54/s55\'s file-extension scan)', () => {
  for (const id of ALL_TEMPLATE_IDS) {
    const manifestPath = path.join(TEMPLATES_DIR, id, 'images', 'variants.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const entry of Object.values(manifest)) {
      for (const v of entry.variants) {
        assert.ok(/\.webp$/i.test(v.webp), `variant ${v.webp} is not a .webp file`);
      }
    }
  }
});

check('hero/OG images (referenced only via CSS url() or *-og naming) never got a variants.json entry', () => {
  for (const id of ['local-service', 'portfolio', 'product-menu']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, id, 'images', 'variants.json'), 'utf8'));
    for (const rel of Object.keys(manifest)) {
      assert.ok(!/-hero\.jpe?g$|^images\/hero\.jpe?g$/i.test(rel), `${id}: hero image ${rel} unexpectedly has variants`);
      assert.ok(!/-?og\.jpe?g$/i.test(rel), `${id}: OG image ${rel} unexpectedly has variants`);
    }
  }
});

// ── end-to-end: a real preset renders valid, resolvable <picture> markup ──

for (const id of ['local-service', 'portfolio', 'product-menu', 'desserdirina']) {
  check(`${id}: rendering the first preset through build.js's full pipeline produces resolvable <picture> markup`, () => {
    const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, id, 'presets.json'), 'utf8'));
    const config = presets.presets[0].config;
    const templateHtml = fs.readFileSync(path.join(TEMPLATES_DIR, id, 'template.html'), 'utf8');
    let html = renderHtml(templateHtml, config);
    html = injectResponsiveImages(html, path.join(TEMPLATES_DIR, id));

    const pictures = html.match(/<picture>[\s\S]*?<\/picture>/g) || [];
    assert.ok(pictures.length > 0, `${id}: expected at least one <picture> in the rendered preset`);
    for (const block of pictures) {
      const srcsetMatch = /srcset="([^"]+)"/.exec(block);
      assert.ok(srcsetMatch, `${id}: <picture> missing srcset: ${block}`);
      for (const candidate of srcsetMatch[1].split(',')) {
        const [rel] = candidate.trim().split(/\s+/);
        assert.ok(fs.existsSync(path.join(TEMPLATES_DIR, id, rel)), `${id}: srcset points at missing file ${rel}`);
      }
      const imgMatch = /<img[^>]*>/.exec(block);
      assert.ok(imgMatch && /width="\d+"/.test(imgMatch[0]) && /height="\d+"/.test(imgMatch[0]),
        `${id}: fallback <img> missing width/height: ${imgMatch && imgMatch[0]}`);
      const fallbackSrc = /src="([^"]+)"/.exec(imgMatch[0]);
      assert.ok(fallbackSrc && fs.existsSync(path.join(TEMPLATES_DIR, id, fallbackSrc[1])),
        `${id}: <picture> fallback <img> src missing on disk: ${fallbackSrc && fallbackSrc[1]}`);
    }

    // Hero background must still be present, untouched, as a plain CSS value
    // (no <picture>, no width/height games — see this test file's header).
    assert.ok(/background:[^"]*url\(/.test(html), `${id}: hero background missing from rendered output`);
  });
}

check('renderHtml stays filesystem-free (still safe to bundle for the browser builder)', () => {
  // renderHtml must not reference the Node `fs` module anywhere in its own
  // source text — Wave7 deliberately put all new fs-touching logic in a
  // separate injectResponsiveImages() called only from build()'s Node path.
  const src = renderHtml.toString();
  assert.ok(!/\bfs\.\w+\(/.test(src), 'renderHtml must not call into fs — that would break the browser bundle');
});

check('package.json gained no new runtime dependency for the image pipeline', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    'expected zero "dependencies" — the image pipeline uses local sips/cwebp binaries, not an npm package');
});

if (failed) {
  console.error('\nwave7-images-responsive.test.js: FAILED');
  process.exit(1);
}
console.log('\nwave7-images-responsive.test.js: all passed');
