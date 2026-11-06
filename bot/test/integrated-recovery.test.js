'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'builder/blocks/editor.js'), 'utf8');
const cut = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
function harness() {
  const nodes = new Map(), handlers = new Map(), requests = [];
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { hidden: false, value: '', disabled: false, textContent: '', focus() {}, addEventListener(k, f) { handlers.set(id + ':' + k, f); } }); return nodes.get(id); };
  const c = vm.createContext({ $, setTimeout, clearTimeout, clearInterval, encodeURIComponent,
    serverReady: true, signedIn: true, siteId: 's1', site: { brand: 'Nume nou' }, serverTimer: null,
    pending: false, draftConflict: null, recoveryRequired: false, editing: null,
    window: { SB: { siteBrand: s => s.brand } }, slugify: s => s.toLowerCase().replace(/ /g, '-'),
    networkError: e => e.message, renderChecklist() {}, saveToServer: async () => {},
    api: (method, url) => new Promise((resolve, reject) => requests.push({ method, url, resolve, reject })),
  });
  vm.runInContext(cut('let authPoll = null;', 'function pubStep(name)'), c);
  vm.runInContext('function pubStep() {} function pubError(s) { $("pub-error").textContent=s; }', c);
  vm.runInContext(cut('function closePublish()', '/**\n * Magic-link sign-in'), c);
  vm.runInContext(cut("$('pub-go').addEventListener", '/** Starter content'), c);
  return { $, requests, handlers, run: s => vm.runInContext(s, c), async tick() { await new Promise(setImmediate); }, async answer(value) { const q = requests.shift(); assert.ok(q); q.resolve(value); await new Promise(setImmediate); } };
}
async function initialize(h, currency = 'eur', paid = false) {
  const promise = h.run('showSlugStep()'); await h.tick();
  await h.answer({ site: { id: 's1', paid, slug: 'fixed-address' } });
  await h.answer({ user: { id: 'owner' } });
  if (!paid) await h.answer({ amount: 99, renewal: 29, currency });
  await promise; return h;
}
test('B02 initialization disables input/action and rejects early synthetic submit', async () => {
  const h = harness(); const pending = h.run('showSlugStep()'); await h.tick();
  assert.equal(h.$('pub-slug-input').disabled, true); assert.equal(h.$('pub-go').disabled, true);
  await h.handlers.get('pub-go:click')(); assert.equal(h.requests.length, 1); assert.match(h.$('pub-slug-note').textContent, /verifică/);
  h.run('closePublish()'); await h.answer({ site: { paid: true, slug: 'old' } }); await pending;
  assert.equal(h.$('pub-slug-input').value, ''); assert.equal(h.$('pub').hidden, true);
});
test('B02 close/reopen drops stale site read while current request initializes', async () => {
  const h = harness(); const old = h.run('showSlugStep()'); await h.tick(); h.run('closePublish(); $("pub").hidden=false');
  const current = h.run('showSlugStep()'); await h.tick();
  await h.answer({ site: { paid: true, slug: 'obsolete' } }); await old;
  assert.equal(h.$('pub-slug-input').value, '');
  await h.answer({ site: { paid: false, slug: 'draft' } }); await h.answer({ user: { id: 'owner' } }); await h.answer({ amount: 99, renewal: 29, currency: 'gbp' }); await current;
  assert.equal(h.$('pub-slug-input').value, 'nume-nou'); assert.equal(h.$('pub-slug-input').disabled, false);
  assert.match(h.$('pub-trial').textContent, /£99.*ziua 14.*£29\/an/);
});
for (const seam of ['site', 'me', 'config']) test('B02 stale ' + seam + ' response cannot modify another site', async () => {
  const h = harness(); const p = h.run('showSlugStep()'); await h.tick();
  if (seam !== 'site') await h.answer({ site: { paid: false, slug: 'a' } });
  if (seam === 'config') await h.answer({ user: { id: 'owner' } });
  h.run('siteId="s2";site={brand:"Other"}');
  await h.answer(seam === 'site' ? { site: { paid: true, slug: 'wrong' } } : seam === 'me' ? { user: { id: 'owner' } } : { amount: 99, renewal: 29, currency: 'eur' }); await p;
  assert.equal(h.$('pub-slug-input').value, ''); assert.equal(h.$('pub-go').disabled, true);
});
for (const currency of ['eur', 'gbp', 'usd']) test('C03 actual configured bucket ' + currency, async () => {
  const h = await initialize(harness(), currency); assert.match(h.$('pub-trial').textContent, /card obligatoriu.*14 zile.*public imediat.*99.*ziua 14.*29/);
  const symbol = { eur: '€', gbp: '£', usd: '$' }[currency]; assert.ok(h.$('pub-trial').textContent.includes(symbol));
});
test('B02 fixed paid address and offline initialization remain protected', async () => {
  const h = await initialize(harness(), 'eur', true); assert.equal(h.$('pub-slug-input').value, 'fixed-address'); assert.equal(h.$('pub-slug-input').disabled, true); assert.equal(h.$('pub-go').disabled, false);
  const offline = harness(); const p = offline.run('showSlugStep()'); await offline.tick(); offline.requests.shift().reject(Error('offline')); await p;
  assert.equal(offline.$('pub-go').disabled, true); assert.equal(offline.$('pub-slug-input').disabled, true); assert.match(offline.$('pub-error').textContent, /offline/);
});
const SB = require('../../builder/blocks/blocks');
test('C15 every booking pack/default intro is neutral in static and live output; owner text survives', () => {
  const seen = [];
  for (const id of Object.keys(SB.packs())) {
    const block = SB.makeBlock('booking', 'split', id); seen.push(id);
    assert.equal(block.data.text, 'Vezi serviciile și programul de mai jos.');
    block.data.phone = '0712345678';
    const staticHTML = SB.renderBlock(block, { published: true });
    assert.match(staticHTML, /Vezi serviciile/); assert.match(staticHTML, /Pentru programare sună/); assert.doesNotMatch(staticHTML, /data-hidook-cal-native/);
    const liveHTML = SB.renderBlock(block, { published: true, booking: { blockId: block.id, apiBase: 'http://127.0.0.1', customerId: 'c', siteId: 's' } });
    assert.match(liveHTML, /data-hidook-cal-native/);
    block.data.text = 'Textul propriu al clientului'; assert.match(SB.renderBlock(block, { published: true }), /Textul propriu al clientului/);
  }
  assert.equal(seen.length, 13);
  assert.equal(SB.BLOCKS.booking.defaults().text, 'Vezi serviciile și programul de mai jos.');
});
test('accepted draft/revision/partial-key machinery preserved exactly from frozen input', () => {
  const before = fs.readFileSync(path.join(root, '04-QA-Evidence/Implementation-2026-11-05/editor-recognition/input/builder/blocks/editor.js'), 'utf8');
  const region = s => s.slice(s.indexOf('const STORE'), s.indexOf('const EDITOR_CSS'));
  assert.equal(region(source), region(before));
});
