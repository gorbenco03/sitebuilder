'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contracts = require('./helpers/integrated-oracle-contracts');
const { assertRecognitionPreserved } = require('../../scripts/editor-recognition-preservation.cjs');
const { assertPublishLoading, assertCommercialCopy } = require('../../scripts/editor-publish-oracle-harness.cjs');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const packs = require('../../builder/blocks/packs'); require('../../builder/blocks/packs-more')(packs);
const clone = x => JSON.parse(JSON.stringify(x));
const source = read('builder/blocks/editor.js');
const before = read('04-QA-Evidence/Implementation-2026-11-05/editor-recognition/input/builder/blocks/editor.js');
const replace = (s, from, to) => { assert.ok(s.includes(from), from); return s.replace(from, to); };

test('counterfactual pack data/theme/order/variants/actions/booking mutations are all rejected', () => {
  contracts.assertPacks(packs);
  const mutations = [
    p => p.gol.pages[0].blocks.push(['hero', 'centered']),
    p => p.gol.pages[0].blocks.push(['text', 'left']),
    p => p.gol.pages.push({ name: 'Nouă', blocks: [] }),
    p => p.gol.pages[0].name = 'Altă pagină',
    p => p.gol.header.brand = 'Changed',
    p => p.gol.footer.text = 'Changed',
    p => p.gol.theme.radius = 99,
    p => p.gol.actions.nav.cta = 'phone',
    ...Object.keys(packs).filter(id => id !== 'gol').map(id => p => p[id].label += ' changed'),
    p => p.restaurant.content.menu.items[0].price = '999 lei',
    p => p.meserii.theme.palette = 'alb',
    p => p.cafenea.pages.reverse(),
    p => p.mireasa.pages[0].blocks.reverse(),
    p => p.renovari.pages[0].blocks[0][1] = 'centered',
    p => p.cofetarie.actions.hero.cta = 'phone',
    p => p.salon.content.booking.services[0].min = '15',
    p => p.profesionisti.content.booking.week[0].to = '23:00',
    p => p.cosmetica.content.booking.phone = '0712345678',
    p => p.consultanta.pages[1].blocks.push(['booking', 'split']),
    p => p.gol.content.hero.title = 'Unexpected starter data',
    p => p.contabilitate.content.about.text = 'Guaranteed credentials',
    p => p.catering.content.hero.title = 'Other business',
  ];
  for (const change of mutations) { const p = clone(packs); change(p); assert.throws(() => contracts.assertPacks(p), assert.AssertionError); }
  const first5 = read('builder/blocks/packs.js'); contracts.assertFirst5Source(first5);
  assert.throws(() => contracts.assertFirst5Source(replace(first5, "min: '60'", "min: '15'")), assert.AssertionError);
});
test('counterfactual C02 is not a global foreign/factory-word exemption', () => {
  const index = read('builder/index.html'); contracts.assertLandingCopy(index);
  for (const changed of [
    replace(index, '<h3>Domeniul tău</h3>', '<h3>Instafidget</h3>'),
    replace(index, 'Instagram pe site', 'Widgetul Instagram pe site'),
    replace(index, 'Instagram pe site', 'partner feed (iframe)'),
    replace(index, contracts.disclosure, contracts.disclosure.replace('12 luni', '24 luni')),
    replace(index, '<h3>Domeniul tău</h3>', `<h3>Domeniul tău</h3><p>${contracts.disclosure}</p>`),
    replace(index, '<div class="gift-card">\n          <h3>Instagram pe site', '<div class="catalog-card">\n          <h3>Instagram pe site'),
  ]) assert.throws(() => contracts.assertLandingCopy(changed), assert.AssertionError);
});
test('counterfactual persistence, immutable revision, identity and sign-in mutations still violate byte preservation', () => {
  assertRecognitionPreserved(source, before);
  for (const [from, to] of [
    ["const STORE = 'hb.blocks.draft.v1'", "const STORE = 'changed-key'"],
    ['let baseVersion;', 'let baseVersion = "unsafe";'],
    ['function identityLeftovers(draft)', 'function identityLeftovers(other)'],
    ["resume = 'auth';", "resume = 'checkout';"],
    ['Câmpurile PLACEHOLDER rămân de completat.', 'Conformitate garantată.'],
  ]) assert.throws(() => assertRecognitionPreserved(replace(source, from, to), before), assert.AssertionError);
});
test('counterfactual enabled loading controls and misleading commercial copy fail executed behavior assertions', async () => {
  await assertPublishLoading(source); await assertCommercialCopy(source, 'eur');
  await assert.rejects(assertPublishLoading(replace(source, "$('pub-slug-input').disabled = true;", "$('pub-slug-input').disabled = false;")), assert.AssertionError);
  for (const [from, to] of [['card obligatoriu', 'card opțional'], ['în ziua 14 pentru primul an', 'astăzi pentru primul an'], ['apoi ${renewal}/an', 'apoi gratuit'], ['configuredMoney(cfg.renewal, cfg.currency)', 'configuredMoney(0, cfg.currency)']]) {
    await assert.rejects(assertCommercialCopy(replace(source, from, to), 'eur'), assert.AssertionError);
  }
});
