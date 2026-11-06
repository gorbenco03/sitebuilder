'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contracts = require('./helpers/integrated-oracle-contracts');
const packs = require('../../builder/blocks/packs'); require('../../builder/blocks/packs-more')(packs);
const clone = x => JSON.parse(JSON.stringify(x));
const expected = [
  ['mireasa', 'hero.text', 'Păr prins parțial, ondulații și un accesoriu discret. Trei look-uri de inspirație, nu lucrări ale acestui studio.'],
  ['mireasa', 'about.text', 'Prezentare de exemplu. Adaugă numele, specializarea și portretul real al profesionistului, cu acordul persoanei. Înlocuiește numele Studio Forma cu numele afacerii tale.'],
  ['renovari', 'text.text', 'Lavoar dublu, oglinzi rotunde și zonă de duș. Fotografie ilustrativă, nu o lucrare a echipei.'],
  ['renovari', 'about.text', 'Prezentare de exemplu. Adaugă numele echipei, zona de lucru, specializările și condițiile reale ale serviciilor. Înlocuiește numele Renovări Popescu cu numele afacerii tale.'],
  ['renovari', 'faq.items.2.a', 'Cere condițiile de garanție în scris, pentru lucrările și materialele din oferta ta.'],
  ['renovari', 'faq.items.0.a', 'Costul și durata se stabilesc după evaluarea spațiului. Cere lucrările incluse, materialele și termenul aplicabil înainte de începere.'],
  ['cosmetica', 'about.text', 'Prezentare de exemplu. Adaugă numele persoanei care efectuează tratamentele și pregătirea sa reală. Fotografiile sunt ilustrative, nu prezintă echipa cabinetului.'],
];
const kitchen = 'Fronturi închise la culoare, blat deschis și corpuri suspendate de iluminat. Fotografie ilustrativă, nu un proiect al echipei.';
for (const [id, field, text] of expected) test(id + ': prezentare și condiții fără justificări despre design — ' + field, () => {
  assert.equal(field.split('.').reduce((o,k) => o[k], packs[id].content), text);
});
test('Bucătărie: fotografia rămâne ilustrativă, fără proiect fictiv', () => {
  assert.equal(packs.renovari.pages[0].blocks[4][0], 'text');
  assert.equal(packs.renovari.pages[0].blocks[4][2].data.title, 'O insulă, două zone de lucru.');
  assert.equal(packs.renovari.pages[0].blocks[4][2].data.text, kitchen);
});
test('toate cele 13 designuri păstrează întregul contract; excepțiile nu permit alt text', () => {
  contracts.assertPacks(packs);
  const mutations = [
    p => p.restaurant.content.hero.text += ' changed',
    p => p.mireasa.pages[0].blocks[0][1] = 'centered',
    p => p.renovari.actions.hero.cta = 'phone',
    p => p.cosmetica.content.hero.image = '@tpl/other.jpg',
    p => p.mireasa.theme.radius = 99,
    p => p.gol.content.text.text = 'Unexpected neutral seed',
    p => p.gol.header.brand = 'Unexpected brand',
    p => p.gol.footer.text = 'Unexpected footer',
    p => p.gol.pages[0].blocks = [['hero', 'centered'], ['text', 'left']],
    p => p.renovari.pages[0].blocks[4][2].data.text = 'Garanție nelimitată.',
    ...expected.map(([id,field]) => p => { const keys=field.split('.'), last=keys.pop(); keys.reduce((o,k)=>o[k],p[id].content)[last]='Text neaprobat'; }),
  ];
  for (const mutate of mutations) { const p=clone(packs); mutate(p); assert.throws(() => contracts.assertPacks(p), assert.AssertionError); }
});
test('gestionarea programării folosește echipa, nu presupune un cabinet', () => {
  const source = fs.readFileSync(path.resolve(__dirname,'../calendar-native/manage/manage.js'),'utf8');
  assert.doesNotMatch(source, /cabinet/);
  for (const text of [' (conform regulilor de programare).', 'contactează direct echipa.']) assert.ok(source.includes(text));
  assert.match(source, /Nu mai sunt intervale libere în următoarele zile\. Încearcă mai târziu sau contactează direct echipa\./);
  assert.match(source, /Reîncarcă programarea/);
  assert.match(source, /booking\.minCancelHours != null \? booking\.minCancelHours : 24/);
});
