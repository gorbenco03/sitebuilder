'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const legal = require('../site-legal');
const notice = /Ciornă juridică incompletă[^<]*—[^<]*nu este pregătită pentru utilizare comercială/;
for (const name of ['privacyHtml', 'termsHtml', 'cookiesHtml']) {
  test(name + ': explicit owner gate, placeholders, escaped identity, attribution', () => {
    const html = legal[name]({ business: { name: '<script>bad()</script>' } });
    assert.match(html, notice);
    for (const phrase of ['denumirea legală', 'CUI/VAT', 'adresa sediului', 'operatorul și procesatorii', 'retenția datelor', 'subprocesorii', 'jurisdicția', 'textul legal final']) assert.ok(html.includes(phrase), phrase);
    assert.match(html, /\[PLACEHOLDER/);
    assert.ok(!html.includes('<script>bad()'));
    assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
    assert.match(html, /Build by <a[^>]*>hidook.tech<\/a> powered by <a[^>]*>hidook.agency<\/a>/);
    for (const file of ['privacy.html','terms.html','cookies.html']) assert.ok(html.includes('href="'+file+'"'));
  });
}
test('publish checklist always discloses legal gate without mutating site or disabling publication', () => {
  const source = fs.readFileSync(require.resolve('../../builder/blocks/editor.js'), 'utf8');
  const fn = source.slice(source.indexOf('function renderChecklist()'), source.indexOf('/* ---------- starter-aware identity'));
  const nodes = { 'pub-check': {hidden:true}, 'pub-check-list':{innerHTML:''} };
  const site = { pages: [] }; const before = JSON.stringify(site);
  vm.runInNewContext(fn+';renderChecklist();', {site, window:{SB:{demoLeftovers:()=>[]}}, identityLeftovers:()=>[], $:id=>nodes[id], esc:s=>s});
  assert.equal(nodes['pub-check'].hidden,false);
  assert.match(nodes['pub-check-list'].innerHTML,/Pagini juridice incomplete/);
  assert.match(nodes['pub-check-list'].innerHTML,/Înainte de utilizarea comercială, proprietarul trebuie să furnizeze și să aprobe/);
  assert.equal(JSON.stringify(site),before);
  assert.ok(!/disabled|pub-go|throw|return false/.test(fn));
});
