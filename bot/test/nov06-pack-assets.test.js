'use strict';
// Dedicated block detail assets retain crop provenance without legacy-template ownership.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const SB = require('../../builder/blocks/blocks.js');
const siteExport = require('../site-export.js');
const packs = require('../../builder/blocks/packs.js');
require('../../builder/blocks/packs-more.js')(packs);
const { records } = require('./fixtures/nov05-block-derivatives.json');
const root = path.resolve(__dirname, '../..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  for (let i = 2; i + 9 < bytes.length;) {
    assert.equal(bytes[i], 0xff);
    const marker = bytes[i + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw Error('JPEG dimensions missing');
}

test('ten block-only detail JPEGs preserve exact source/crop/thumbnail provenance and crop dimensions', () => {
  assert.equal(records.length, 10);
  assert.equal(new Set(records.map(r => r.derivative)).size, 10);
  const declared = JSON.stringify(packs);
  for (const r of records) {
    assert.match(r.derivative, /^templates\/blocks\/images\/nov05-[\w-]+\.jpg$/);
    assert.equal(sha(fs.readFileSync(path.join(root, r.source))), r.sourceSha256);
    const bytes = fs.readFileSync(path.join(root, r.derivative));
    assert.equal(sha(bytes), r.sha256);
    assert.equal(sha(fs.readFileSync(path.join(root, r.thumbnail))), r.thumbnailSha256);
    const [left, top, right, bottom] = r.cropPixels;
    assert.deepEqual(jpegDimensions(bytes), [right - left, bottom - top], 'no upscale or resampling');
    assert.ok(right - left >= 400 && bottom - top >= 350, 'detail scale, not thumbnail chips');
    assert.ok(bytes.length >= 24 * 1024);
    assert.ok(!fs.existsSync(path.join(root, r.previousDerivative)), 'not legacy-owned');
    assert.ok(!fs.existsSync(path.join(root, r.previousThumbnail)), 'no stale candidate thumbnail');
    assert.ok(declared.includes('@tpl/' + r.derivative.slice('templates/'.length)));
  }
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'templates/registry.json')));
  assert.ok(!registry.templates.some(t => t.id === 'blocks'));
});

test('build copies byte-identical detail assets and versioned thumbnails into browser namespace', () => {
  const thumbs = fs.readFileSync(path.join(root, 'builder/generated/thumbs.js'), 'utf8').match(/window\.SB_THUMBS = "([^"]*)"/)[1];
  for (const r of records) {
    const rel = r.derivative.slice('templates/'.length);
    assert.equal(sha(fs.readFileSync(path.join(root, 'builder/generated/template-assets', rel))), r.sha256);
    const thumbnail = path.join(root, 'builder', thumbs.slice('/app/'.length), rel.replace(/\.jpg$/, '.webp'));
    assert.equal(sha(fs.readFileSync(thumbnail)), r.thumbnailSha256);
  }
});

test('static publication tree and real ZIP copy the new namespace bytes without a renderer registry entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nov06-assets-'));
  for (const id of ['mireasa', 'renovari']) {
    // Exercise an owner-editable detail gallery independently of pending tuple integration.
    const cfg = SB.defaultSite(id);
    const expected = records.filter(r => id === 'mireasa' ? r.source.includes('/portfolio/') : r.source.includes('/local-service/'));
    const gallery = SB.makeBlock('gallery', 'grid', id);
    gallery.data.items = expected.map(r => ({ image: '@tpl/' + r.derivative.slice('templates/'.length) }));
    cfg.pages[0].blocks.push(gallery);
    const built = path.join(dir, id);
    siteExport.buildBlocksSiteTree(built, cfg);
    const zipped = siteExport.exportBlocksZip({ config: cfg, slug: id });
    const zip = path.join(dir, id + '.zip');
    fs.writeFileSync(zip, zipped.zip);
    const unpacked = path.join(dir, id + '-unpacked');
    execFileSync('unzip', ['-q', zip, '-d', unpacked]);
    for (const r of expected) {
      const rel = 'assets/' + r.derivative.slice('templates/'.length);
      assert.ok(zipped.files.includes(rel));
      for (const location of [built, unpacked]) assert.equal(sha(fs.readFileSync(path.join(location, rel))), r.sha256);
    }
    assert.match(fs.readFileSync(path.join(unpacked, 'index.html'), 'utf8'), /Build by.*hidook\.tech.*powered by.*hidook\.agency/);
  }
});

test('actual server serves every block detail JPEG and thumbnail with exact image bytes', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nov06-served-assets-'));
  process.env.SERVER_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.CALENDAR_EMAIL_TRANSPORT = 'memory';
  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const thumbs = fs.readFileSync(path.join(root, 'builder/generated/thumbs.js'), 'utf8').match(/window\.SB_THUMBS = "([^"]*)"/)[1];
    for (const r of records) {
      const rel = r.derivative.slice('templates/'.length);
      for (const [url, expected, mime] of [
        ['/app/generated/template-assets/' + rel, r.sha256, 'image/jpeg'],
        [thumbs + rel.replace(/\.jpg$/, '.webp'), r.thumbnailSha256, 'image/webp'],
      ]) {
        const response = await fetch(base + url);
        assert.equal(response.status, 200, url);
        assert.match(response.headers.get('content-type'), new RegExp('^' + mime));
        assert.equal(sha(Buffer.from(await response.arrayBuffer())), expected, url);
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the eight authorized starter phone labels match phone-only input without rewriting saved owner text', () => {
  for (const id of ['restaurant', 'profesionisti', 'cofetarie', 'cafenea', 'mireasa', 'renovari', 'catering', 'consultanta']) {
    assert.equal(packs[id].content.form.lPhone, 'Telefon', id);
    const cfg = SB.defaultSite(id);
    const page = cfg.pages.find(p => p.blocks.some(b => b.type === 'form'));
    const block = page.blocks.find(b => b.type === 'form');
    const html = SB.renderPage(cfg, page.id, { published: true });
    assert.match(html, /name="contact" autocomplete="tel"/);
    block.data.lPhone = 'Telefonul biroului';
    const saved = SB.normalizeSite(JSON.parse(JSON.stringify(cfg)));
    assert.equal(saved.pages.find(p => p.id === page.id).blocks.find(b => b.id === block.id).data.lPhone, 'Telefonul biroului');
    assert.match(SB.renderPage(saved, page.id, { published: true }), /Telefonul biroului/);
  }
});
