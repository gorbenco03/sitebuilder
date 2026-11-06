'use strict';
// Pack declaration contracts; real makePage/preview integration is the browser oracle.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assertBooking, assertFirst5Source, assertPacks } = require('./helpers/integrated-oracle-contracts');
const { execFileSync } = require('node:child_process');
const SB = require('../../builder/blocks/blocks.js');
const packs = require('../../builder/blocks/packs.js');
require('../../builder/blocks/packs-more.js')(packs);
const root = path.resolve(__dirname, '../..');
const base = 'b436cc7b5760abbb29a257c4a792e6f311cc6bbf';
const baseline = { module: { exports: {} } };
vm.runInNewContext(execFileSync('git', ['show', `${base}:builder/blocks/packs-more.js`], { cwd: root, encoding: 'utf8' }), baseline);
const before = baseline.module.exports({});
const ids = ['cafenea', 'mireasa', 'renovari', 'catering', 'cosmetica', 'consultanta', 'contabilitate'];
const plain = x => JSON.parse(JSON.stringify(x));
const units = pack => pack.pages.flatMap(page => page.blocks.map(([type, variant, overrides]) => ({ page: page.name, type, variant, data: { ...pack.content[type], ...overrides?.data } })));

for (const id of ids) {
  test(`${id}: page inventory, declared variants, own content, local original+thumbnail assets`, () => {
    const pack = packs[id];
    assert.deepEqual(pack.pages.map(p => p.name), plain(before[id].pages.map(p => p.name)));
    assert.notDeepEqual(plain(pack.pages), plain(before[id].pages));
    for (const unit of units(pack)) {
      assert.ok(SB.BLOCKS[unit.type]?.variants[unit.variant], `${id}/${unit.type}/${unit.variant}`);
      assert.ok(pack.content[unit.type], 'No fallback to foreign/default business content');
      assert.ok(!['reviews', 'team'].includes(unit.type), 'No fictitious reputation or identities');
      const refs = [...JSON.stringify(unit.data).matchAll(/@tpl\/([^"\\]+)/g)].map(m => m[1]);
      for (const ref of refs) {
        assert.ok(fs.existsSync(path.join(root, 'templates', ref)), ref);
        assert.ok(fs.existsSync(path.join(root, 'builder/blocks/thumbs', ref.replace(/\.jpg$/, '.webp'))), 'thumb ' + ref);
        assert.ok(pack.images.includes('@tpl/' + ref), 'photo pool ' + ref);
      }
    }
    assert.match(JSON.stringify(pack.content), /exemplu|exemple|ilustrativ/);
  });
}

test('all13 accepted pack objects allow only exact approved recovery copy fields', () => {
  assertPacks(packs);
});

test('remaining7 keep23 pages; all13 have distinct intended primary/secondary/column actions', () => {
  assert.equal(ids.reduce((n, id) => n + packs[id].pages.length, 0), 23);
  assert.equal(Object.keys(packs).length, 13);
  const expected = {
    restaurant: ['contact', 'menu', []], salon: ['booking', 'menu', ['menu', 'booking']],
    meserii: ['phone', 'contact', ['contact', 'contact']], profesionisti: ['booking', 'menu', ['menu', 'booking', 'contact']],
    cofetarie: ['contact', 'menu', ['contact', 'menu', 'contact']], gol: ['contact', 'about', ['contact', 'contact', 'contact']],
    cafenea: ['contact', 'menu', ['menu', 'menu']], mireasa: ['contact', 'gallery', ['menu', 'menu', 'contact']],
    renovari: ['contact', 'gallery', ['contact', 'contact', 'contact', 'contact']], catering: ['contact', 'menu', ['menu', 'contact', 'contact']],
    cosmetica: ['booking', 'menu', ['menu', 'contact']], consultanta: ['booking', 'about', ['menu', 'menu', 'booking']],
    contabilitate: ['contact', 'menu', ['contact', 'contact', 'contact']],
  };
  const targetTypes = { menu: ['menu'], booking: ['booking'], contact: ['form', 'hours'], phone: ['form', 'hours'], about: ['about'], gallery: ['gallery'] };
  for (const [id, [primary, secondary, columns]] of Object.entries(expected)) {
    const pack = packs[id];
    assert.equal(pack.actions.nav.cta, primary, id + ' nav');
    assert.equal(pack.actions.hero.cta, primary, id + ' hero');
    assert.equal(pack.actions.hero.cta2, secondary, id + ' secondary');
    assert.equal(pack.actions.cta.cta, primary, id + ' band');
    assert.equal(pack.content.columns?.cols.length || 0, columns.length, id + ' columns inventory');
    columns.forEach((intent, i) => assert.equal(pack.actions.columns[`cols.${i}.cta`], intent, id + ' column ' + i));
    for (const [type, fields] of Object.entries(pack.actions)) {
      for (const [field, intent] of Object.entries(fields)) {
        assert.ok(Object.hasOwn(targetTypes, intent), id + '/' + type + '/' + field);
        // Blank intentionally has no contacts/about; resolver must show configuration guidance.
        if (id !== 'gol') assert.ok(pack.pages.some(p => p.blocks.some(([t]) => targetTypes[intent].includes(t))), id + '/' + intent + ' needs an actual target');
      }
    }
  }
});

test('approved first5 delta retains the original byte lock with only named copy/action/contact exceptions', () => {
  const source = fs.readFileSync(path.join(root, 'builder/blocks/packs.js'), 'utf8');
  assert.equal((source.match(/^    actions: /gm) || []).length, 5);
  assert.equal((source.match(/cta: 'Trimite o cerere'/g) || []).length, 4);
  assertFirst5Source(source);
  const p = packs.cofetarie;
  assert.deepEqual([p.header.cta, p.content.hero.cta, p.content.cta.cta, p.content.columns.cols[0].cta], Array(4).fill('Trimite o cerere'));
  assert.match(p.content.form.text, /nu este o comandă confirmată/);
});

test('Blank starts with one empty Acasă body; neutral data/theme/shared skeleton remain unchanged', () => {
  const { actions, ...blank } = packs.gol;
  assert.deepEqual(plain(before.gol.pages), [{ name: 'Acasă', blocks: [['hero', 'centered'], ['text', 'left']] }]);
  assert.deepEqual(plain(blank), { ...plain(before.gol), pages: [{ name: 'Acasă', blocks: [] }], content: { ...plain(before.gol.content), booking: { ...plain(before.gol.content.booking), text: 'Vezi serviciile și programul de mai jos.' } } });
  assert.ok(actions);
});

test('F10 opening/brunch hours agree on every café page and brunch fits inside opening', () => {
  const p = packs.cafenea;
  assert.doesNotMatch(JSON.stringify(p), /toată ziua|zilnic de la 8/);
  const rows = p.content.hours.hours;
  assert.deepEqual(rows, [
    { day: 'Luni – Vineri', time: '08:00 – 22:00' }, { day: 'Sâmbătă – Duminică', time: '09:00 – 23:00' },
    { day: 'Brunch · Luni – Vineri', time: '08:00 – 15:00' }, { day: 'Brunch · Sâmbătă – Duminică', time: '09:00 – 15:00' },
  ]);
  const opening = 'Luni – Vineri 08:00 – 22:00; Sâmbătă – Duminică 09:00 – 23:00';
  const brunch = 'Brunch: Luni – Vineri 08:00 – 15:00; Sâmbătă – Duminică 09:00 – 15:00';
  for (const text of [p.content.hero.text, p.content.text.text, p.content.menu.note]) {
    assert.ok(text.includes(opening));
    assert.ok(text.includes(brunch));
  }
  for (let i = 0; i < 2; i++) {
    const [from, to] = rows[i].time.split(' – ');
    const [bf, bt] = rows[i + 2].time.split(' – ');
    assert.ok(bf >= from && bt <= to);
  }
  assert.equal(p.pages.flatMap(p => p.blocks).filter(([type]) => type === 'menu').length, 1);
  assert.equal(p.content.columns.cols.length, 2);
});

test('bridal looks and renovation projects declare distinct named units and same-source detail files', () => {
  const bridal = units(packs.mireasa).filter(u => u.type === 'gallery');
  assert.equal(bridal.length, 3);
  assert.equal(new Set(bridal.map(u => u.data.title)).size, 3);
  assert.match(bridal[0].data.title, /01.*Ondulații/);
  assert.match(bridal[1].data.title, /02.*Coc/);
  assert.match(bridal[2].data.title, /03.*Machiaj/);
  const projects = units(packs.renovari).filter(u => u.type === 'gallery');
  assert.equal(projects.length, 2);
  assert.match(projects[0].data.title, /Baie/);
  assert.match(projects[1].data.title, /Bucătărie/);
  for (const unit of [...bridal, ...projects]) {
    assert.match(unit.data.title, /același cadru/);
    assert.ok(unit.data.items.some(it => it.image.includes('nov05-')));
  }
  const copy = JSON.stringify(packs.renovari);
  assert.doesNotMatch(copy, /16 zile|6 mp|trei săptămâni|garanție.*3 ani|48 de ore/);
});

test('cosmetics/consulting keep booking configuration and exact page/index/variant placements', () => {
  const locations = p => p.pages.flatMap(page => page.blocks.flatMap(([type, variant], i) => type === 'booking' ? [[page.name, i, variant]] : []));
  for (const id of ['cosmetica', 'consultanta']) {
    assertBooking(packs[id].content.booking, before[id].content.booking);
    assert.deepEqual(plain(locations(packs[id])), plain(locations(before[id])));
  }
});

test('Café retains its connectable neutral Instagram slot, omitted when publicly disconnected', () => {
  const site = SB.defaultSite('cafenea');
  assert.ok(site.pages[0].blocks.some(b => b.type === 'instagram'));
  assert.deepEqual(packs.cafenea.content.instagram.images, []);
  const html = SB.renderPage(site, site.pages[0].id, { published: true });
  assert.doesNotMatch(html, /<iframe class="b-ig-embed"|@bistrotei|instagram\.com/);
});

test('domain composition contracts: atmosphere→occasion→food→logistics; treatment/duration; method; comparable accounting', () => {
  assert.deepEqual(packs.catering.pages[0].blocks.map(([t]) => t), ['hero', 'columns', 'about', 'text', 'cta']);
  assert.equal(packs.catering.pages[0].blocks[1][1], 'plain');
  assert.doesNotMatch(JSON.stringify(packs.catering), /catering-2|cn-r1|gallery|reviews/);
  assert.ok(packs.cosmetica.content.menu.items.every(x => /minute/.test(x.desc)));
  assert.ok(!packs.consultanta.images.length && packs.consultanta.content.hero.image === '');
  assert.equal(packs.consultanta.pages[0].blocks[1][1], 'numbers');
  assert.deepEqual(packs.contabilitate.content.menu.items.map(x => x.name), ['PFA', 'SRL fără salariați', 'SRL cu salariați']);
  for (const item of packs.contabilitate.content.menu.items) assert.match(item.desc, /Evidență.*declarații.*documente|Evidență.*declarații.*volum/);
  assert.equal(packs.contabilitate.images.length, 0);
});
