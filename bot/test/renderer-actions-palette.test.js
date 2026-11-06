'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SB = require('../../builder/blocks/blocks.js');
const rgb = (hex) => hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16) / 255);
const lum = (hex) => rgb(hex).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);

test('UI01/UI02 derive separate readable text and on-accent without changing selected surface', () => {
  for (const [palette, p] of Object.entries(SB.THEMES.palettes)) {
    const css = SB.themeCss({ palette, fonts: 'clasic', radius: 10 });
    const root = css.split('}')[0];
    const token = (name) => { const m = root.match(new RegExp('--' + name + ':(#[a-f0-9]{6})')); assert.ok(m, name + '/' + palette); return m[1]; };
    assert.equal(token('accent'), p.accent);
    assert.ok(ratio(token('on'), p.accent) >= 4.5, palette + ' button');
    for (const [suffix, bg] of [['auto', p.bg], ['light', p.paper], ['dark', p.ink], ['surface', p.accent]]) {
      assert.ok(ratio(token('accent-text-' + suffix), bg) >= 4.5, palette + '/' + suffix);
    }
  }
  assert.match(SB.themeCss({ palette: 'santier' }), /--accent:#ffd23f;--on:#111111/);
});

test('UI01/UI02 accent text consumers and owner element overrides use scoped text token', () => {
  const css = SB.themeCss({ palette: 'beton' });
  assert.doesNotMatch(css, /[;{]color:var\(--accent\)/);
  const block = SB.makeBlock('text');
  block.el = { title: { color: 'accent' } };
  assert.match(SB.renderBlock(block, {}), /color:var\(--accent-text\)/);
  assert.match(css, /\.b-book__card\{[^}]*--accent-text:var\(--accent-text-light\)/);
  assert.doesNotMatch(css, /filter:brightness/);
});

test('F03 explicit action intents survive normalization and use real renamed pages and block IDs', () => {
  const pack = SB.packs().restaurant;
  const before = pack.actions;
  try {
    pack.actions = { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'menu' } };
    const site = SB.normalizeSite(SB.defaultSite('restaurant'));
    const hero = site.pages[0].blocks.find((b) => b.type === 'hero');
    assert.equal(hero.el.cta.action, 'contact');
    assert.equal(hero.el.cta2.action, 'menu');
    const menuPage = site.pages.find((p) => p.blocks.some((b) => b.type === 'menu'));
    menuPage.slug = 'oferta-mea'; menuPage.name = 'Ofertă personalizată';
    const target = menuPage.blocks.find((b) => b.type === 'menu');
    const html = SB.renderPage(site, site.current, { published: true });
    assert.ok(html.includes(`href="oferta-mea.html#${target.id}"`));
    assert.ok(html.includes(`data-action-target="${target.id}"`));
    assert.ok(SB.renderPage(site, menuPage.id, { published: true }).includes(`id="${target.id}"`));
    hero.el.cta2.href = 'https://customer.example/menu';
    assert.match(SB.renderPage(site, site.current, { published: true }), /href="https:\/\/customer.example\/menu"/);
    assert.equal(SB.normalizeSite(site).pages[0].blocks[0].el.cta2.href, 'https://customer.example/menu');
  } finally { if (before) pack.actions = before; else delete pack.actions; }
});

test('F03 no metadata or missing target gives visible honest guidance, never a dead hash action', () => {
  const site = SB.defaultSite('gol');
  site.pages[0].blocks.push(SB.makeBlock('hero', 'centered', 'gol'));
  const hero = site.pages[0].blocks.find((b) => b.type === 'hero');
  hero.el = { cta: { action: 'menu' }, cta2: { action: 'phone' } };
  const html = SB.renderPage(site, site.current, { published: true });
  assert.doesNotMatch(html, /<a href="#"[^>]*data-f="cta/);
  assert.match(html, /Configurează destinația/);
  assert.match(html, /<a aria-disabled="true"[^>]*data-f="cta"[^>]*>[^<]*<\/a><small class="b-action-help">/);
  hero.el.cta = { href: 'https://customer.example/contact' };
  assert.match(SB.renderPage(site, site.current, { published: true }), /href="https:\/\/customer.example\/contact"/);
});

test('preview form submission is disabled, not a missing navigation destination', () => {
  const block = SB.makeBlock('form', 'simple', 'gol');
  const preview = SB.renderBlock(block, { published: false, pages: [] });
  assert.doesNotMatch(preview, /Configurează destinația/);
  assert.match(preview, /<span class="b-btn" data-f="cta" role="button" aria-disabled="true">/);
  const published = SB.renderBlock(block, { published: true, pages: [] });
  assert.match(published, /<button type="submit" class="b-btn">/);
});

test('F03 phone intent uses only usable number; placeholder falls back to actual form', () => {
  const site = SB.defaultSite('meserii');
  site.header.el = { cta: { action: 'phone' } };
  const targetPage = site.pages.find((p) => p.blocks.some((b) => b.type === 'form'));
  const form = targetPage.blocks.find((b) => b.type === 'form');
  assert.ok(SB.renderPage(site, site.current, { published: true }).includes(`href="${targetPage.slug}.html#${form.id}"`));
  form.data.phone = '+40 (712) 345-678';
  assert.match(SB.renderPage(site, site.current, { published: true }), /href="tel:\+40712345678"/);
  site.header.el.cta.action = '__proto__';
  assert.equal(SB.normalizeSite(site).header.el.cta.action, undefined);
});

test('pack tuple3 clones top-level data and per-instance actions, leaving legacy tuples identical', () => {
  const overlay = { data: { title: 'Look natural', cols: [{ title: 'Detaliu' }] }, actions: { 'cols.0.cta': 'gallery' } };
  const page = SB.makePage('Exemple', [['columns', 'images', overlay], ['columns', 'images', { data: { title: 'Look de seară' } }], ['columns', 'images']], 'salon');
  assert.equal(page.blocks[0].data.title, 'Look natural');
  assert.equal(page.blocks[1].data.title, 'Look de seară');
  assert.equal(page.blocks[0].el['cols.0.cta'].action, 'gallery');
  const legacy = SB.makeBlock('columns', 'images', 'salon');
  const stripId = (b) => { const copy = JSON.parse(JSON.stringify(b)); delete copy.id; return copy; };
  assert.deepEqual(stripId(page.blocks[2]), stripId(legacy));
  page.blocks[0].data.cols[0].title = 'Modificat';
  assert.equal(overlay.data.cols[0].title, 'Detaliu');
  assert.notEqual(page.blocks[1].data.cols[0].title, 'Modificat');
  const again = SB.makePage('Altul', [['columns', 'images', overlay]], 'salon');
  assert.equal(again.blocks[0].data.cols[0].title, 'Detaliu');
});

test('pack tuple3 action overlay inherits unspecified paths and safely ignores malformed values', () => {
  const pack = SB.packs().salon, before = pack.actions;
  try {
    pack.actions = { hero: { cta: 'booking', cta2: 'menu' } };
    const page = SB.makePage('Acasă', [['hero', 'split', { data: { title: 'Alt titlu' }, actions: { cta: 'contact', cta2: 'javascript:bad', evil: '__proto__' } }], ['hero', 'split', { data: [], actions: [] }]], 'salon');
    assert.equal(page.blocks[0].el.cta.action, 'contact');
    assert.equal(page.blocks[0].el.cta2.action, 'menu');
    assert.equal(page.blocks[0].el.evil, undefined);
    assert.equal(page.blocks[1].data.title, SB.makeBlock('hero', 'split', 'salon').data.title);
    const malformed = SB.makePage('Invalid', [['columns', 'images', { data: { cols: 'not a list' } }]], 'salon');
    assert.ok(Array.isArray(malformed.blocks[0].data.cols));
    const normalized = SB.normalizeSite({ ...SB.defaultSite('salon'), pages: [page], current: page.id });
    assert.equal(normalized.pages[0].blocks[0].el.cta.action, 'contact');
  } finally { if (before) pack.actions = before; else delete pack.actions; }
});
