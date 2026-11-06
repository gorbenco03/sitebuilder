'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const SB = require('../../builder/blocks/blocks.js');
const { assertBooking } = require('./helpers/integrated-oracle-contracts');
const packs = require('../../builder/blocks/packs.js');
const root = path.resolve(__dirname, '../..');
const base = 'b436cc7b5760abbb29a257c4a792e6f311cc6bbf';
const baseline = { module: { exports: {} } };
vm.runInNewContext(execFileSync('git', ['show', `${base}:builder/blocks/packs.js`], { cwd: root, encoding: 'utf8' }), baseline);
const before = baseline.module.exports;
const ids = ['restaurant', 'salon', 'meserii', 'profesionisti', 'cofetarie'];

for (const id of ids) {
  test(`${id}: page inventory, public block API, attribution, editable fields and local assets`, () => {
    const site = SB.defaultSite(id);
    assert.equal(site.pages.length, before[id].pages.length);
    assert.deepEqual(site.pages.map(p => p.name), Array.from(before[id].pages, p => p.name));
    assert.deepEqual(SB.normalizeSite(site), SB.normalizeSite(SB.normalizeSite(site)));
    assert.notEqual(JSON.stringify(packs[id].pages), JSON.stringify(before[id].pages));
    for (const page of site.pages) {
      for (const b of page.blocks) {
        assert.ok(SB.BLOCKS[b.type]);
        assert.ok(SB.BLOCKS[b.type].variants[b.variant]);
        assert.ok(packs[id].content[b.type], `${id} ${b.type}: no foreign/default content`);
      }
      const html = SB.renderPage(site, page.id, { published: true, assetBase: '/assets/' });
      assert.match(html, /<html lang="ro">/);
      assert.match(html, /Build by[\s\S]*hidook\.tech[\s\S]*powered by[\s\S]*hidook\.agency/);
      assert.match(html, /data-f=/);
      const images = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]);
      assert.equal(new Set(images).size, images.length, `${id}/${page.name}: repeated rendered photo`);
      for (const src of images) {
        assert.ok(src.startsWith('/assets/'), `local photo: ${src}`);
        assert.ok(fs.existsSync(path.join(root, 'templates', src.slice('/assets/'.length))), src);
      }
    }
  });
}

test('all five packs keep 17 pages; no starter testimonial/history/credential claims', () => {
  assert.equal(ids.reduce((n, id) => n + packs[id].pages.length, 0), 17);
  for (const id of ids) {
    const site = SB.defaultSite(id);
    assert.ok(!site.pages.some(p => p.blocks.some(b => b.type === 'reviews' || b.type === 'team')));
    assert.match(JSON.stringify(packs[id].content), /exemplu|exemple/);
    assert.doesNotMatch(JSON.stringify(packs[id].content), /din 2008|în 2016|garanție 5 ani|reparate în 48|Patru stiliste/);
  }
});

test('restaurant has exactly one menu presentation, with inspected dish/photo pairing', () => {
  const site = SB.defaultSite('restaurant');
  assert.equal(site.pages.flatMap(p => p.blocks).filter(b => b.type === 'menu').length, 1);
  assert.deepEqual(packs.restaurant.content.menu.items.map(x => [x.name, path.basename(x.image)]), [
    ['Pește cu legume', 'cn-d1.jpg'], ['Friptură de vită', 'cn-d2.jpg'],
    ['Desert de ciocolată', 'cn-d3.jpg'], ['Salată de sezon', 'tv-m1.jpg'],
  ]);
});

test('cofetărie uses only inspected individual frames, no nested collage or repeated tart', () => {
  const p = packs.cofetarie;
  assert.deepEqual(p.images.map(x => path.basename(x)), ['hero.jpg', 'torturi-1.jpg', 'cupcakes-1.jpg', 'catering-1.jpg', 'placinte-1.jpg']);
  assert.equal(p.pages[0].blocks.find(([t]) => t === 'columns')[1], 'numbers');
  assert.ok(p.content.columns.cols.every(x => !x.image));
  const site = SB.defaultSite('cofetarie');
  const rendered = site.pages.map(page => SB.renderPage(site, page.id)).join('');
  assert.equal([...rendered.matchAll(/<img[^>]+torturi-1\.jpg/g)].length, 1);
  assert.doesNotMatch(rendered, /torturi-[234]\.jpg|cupcakes-2\.jpg|catering-2\.jpg/);
});

test('salon result precedes prices; trades examples precede practical contact; professional is honest text-first', () => {
  assert.deepEqual(packs.salon.pages[0].blocks.slice(0, 3), [['hero', 'split'], ['columns', 'images'], ['menu', 'list']]);
  assert.deepEqual(packs.meserii.pages[0].blocks.slice(0, 3), [['hero', 'split'], ['columns', 'images'], ['hours', 'columns']]);
  assert.equal(packs.meserii.theme.fonts, 'solid');
  assert.equal(packs.meserii.content.columns.cols.length, 2);
  assert.equal(packs.profesionisti.pages[0].blocks[0][1], 'centered');
  assert.equal(packs.profesionisti.content.hero.image, '');
  assert.equal(packs.profesionisti.content.about.image, '');
});

test('booking data and calendar locations are unchanged from frozen baseline', () => {
  for (const id of ['salon', 'profesionisti']) {
    assertBooking(packs[id].content.booking, before[id].content.booking);
    const sites = [packs[id], before[id]].map(p => Array.from(p.pages).flatMap(page => Array.from(page.blocks).filter(([type]) => type === 'booking').map(block => [page.name, ...block])));
    assert.equal(JSON.stringify(sites[0]), JSON.stringify(sites[1]));
  }
});
