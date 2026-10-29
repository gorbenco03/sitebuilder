'use strict';
/**
 * Pages shown shrunk to a card (landing catalog, Site-urile mele, the editor's
 * pickers) use small WebP copies of the pack photos; published sites and the
 * editor canvas keep the full ones. Guards:
 *   - every template photo a pack can show has a committed thumbnail
 *     (otherwise that preview shows a broken image);
 *   - SB.withThumbs swaps only @tpl photos, only while it runs, and falls back
 *     to the full photos when the build shipped no thumbnails;
 *   - the build versions them by content and the server caches them for a year.
 */
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function loadSB(thumbsBase) {
  const ctx = { window: thumbsBase === undefined ? {} : { SB_THUMBS: thumbsBase } };
  vm.createContext(ctx);
  for (const f of ['packs.js', 'packs-more.js', 'blocks.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'builder', 'blocks', f), 'utf8'), ctx);
  }
  return { SB: ctx.window.SB, PACKS: ctx.window.SB_PACKS };
}

test('every pack photo has a committed preview thumbnail', () => {
  const { SB, PACKS } = loadSB();
  const text = JSON.stringify(PACKS) + JSON.stringify(SB.IMAGES) +
    fs.readFileSync(path.join(ROOT, 'builder', 'blocks', 'blocks.js'), 'utf8');
  const refs = [...new Set(text.match(/@tpl\/[\w-]+\/images\/[\w.-]+\.(?:jpe?g|png)/g))];
  assert.ok(refs.length > 50, 'found the pack photos');
  const missing = refs.map((r) => r.slice(5).replace(/\.(jpe?g|png)$/i, '.webp'))
    .filter((rel) => !fs.existsSync(path.join(ROOT, 'builder', 'blocks', 'thumbs', rel)));
  assert.deepStrictEqual(missing, [], 'run node scripts/make-preview-thumbs.js');
});

test('withThumbs swaps pack photos for thumbnails only while it runs', () => {
  const { SB } = loadSB('/app/generated/previews/abc/');
  SB.setAssetBase('/app/generated/template-assets/');
  const site = SB.defaultSite('restaurant');
  const full = SB.renderPage(site, site.pages[0].id, 'https://x/app/');
  const small = SB.withThumbs(() => SB.renderPage(site, site.pages[0].id, 'https://x/app/'));
  assert.match(full, /\/app\/generated\/template-assets\/product-menu\/images\/[\w-]+\.jpg/);
  assert.doesNotMatch(full, /generated\/previews\//);
  assert.match(small, /\/app\/generated\/previews\/abc\/product-menu\/images\/[\w-]+\.webp/);
  assert.doesNotMatch(small, /template-assets\/[\w-]+\/images\//);
  assert.strictEqual(SB.renderPage(site, site.pages[0].id, 'https://x/app/'), full, 'flag restored');
  assert.strictEqual(SB.asset('images/own.jpg'), 'images/own.jpg');
  assert.strictEqual(SB.withThumbs(() => SB.asset('images/own.jpg')), 'images/own.jpg', 'uploads untouched');
});

test('without shipped thumbnails, previews keep the full photos', () => {
  const { SB } = loadSB();
  SB.setAssetBase('/app/generated/template-assets/');
  const site = SB.defaultSite('salon');
  const html = SB.withThumbs(() => SB.renderPage(site, site.pages[0].id, 'https://x/app/'));
  assert.match(html, /\/app\/generated\/template-assets\/[\w-]+\/images\/[\w-]+\.jpg/);
});

test('build versions thumbnails by content; both shells load them before blocks.js', () => {
  const gen = path.join(ROOT, 'builder', 'generated');
  if (!fs.existsSync(path.join(gen, 'thumbs.js'))) return test.skip('run npm run build:app first');
  const base = /window\.SB_THUMBS = "([^"]*)"/.exec(fs.readFileSync(path.join(gen, 'thumbs.js'), 'utf8'))[1];
  assert.match(base, /^\/app\/generated\/previews\/[0-9a-f]{10}\/$/);
  assert.ok(fs.existsSync(path.join(ROOT, 'builder', base.slice('/app/'.length), 'product-menu', 'images', 'cn-hero.webp')));
  for (const shell of ['builder/index.html', 'builder/blocks/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, shell), 'utf8');
    const t = html.indexOf('/app/generated/thumbs.js');
    assert.ok(t > 0 && t < html.indexOf('blocks.js"'), shell);
  }
  const server = fs.readFileSync(path.join(ROOT, 'bot', 'server.js'), 'utf8');
  assert.match(server, /'previews' \+ path\.sep\)\) \{\s*return 'public, max-age=31536000, immutable';/);
});
