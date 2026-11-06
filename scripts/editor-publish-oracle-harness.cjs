'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
function publishHarness(source) {
  const nodes = new Map(), handlers = new Map(), requests = [];
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { hidden: false, value: '', disabled: false, textContent: '', focus() {}, addEventListener(k, f) { handlers.set(id + ':' + k, f); } }); return nodes.get(id); };
  const c = vm.createContext({ $, setTimeout, clearTimeout, clearInterval, encodeURIComponent,
    serverReady: true, signedIn: true, siteId: 's1', site: { brand: 'Nume nou' }, serverTimer: null,
    pending: false, draftConflict: null, recoveryRequired: false, editing: null,
    window: { SB: { siteBrand: s => s.brand } }, slugify: s => s.toLowerCase().replace(/ /g, '-'),
    networkError: e => e.message, renderChecklist() {}, saveToServer: async () => {},
    api: (method, url) => new Promise((resolve, reject) => requests.push({ method, url, resolve, reject })),
  });
  const cut = (a, b) => { const start = source.indexOf(a), end = source.indexOf(b, start); assert.ok(start >= 0 && end > start); return source.slice(start, end); };
  vm.runInContext(cut('let authPoll = null;', 'function pubStep(name)'), c);
  vm.runInContext('function pubStep() {} function pubError(s) { $("pub-error").textContent=s; }', c);
  vm.runInContext(cut('function closePublish()', '/**\n * Magic-link sign-in'), c);
  vm.runInContext(cut("$('pub-go').addEventListener", '/** Starter content'), c);
  return { $, handlers, requests, run: s => vm.runInContext(s, c), async tick() { await new Promise(setImmediate); }, async answer(value) { const q = requests.shift(); assert.ok(q); q.resolve(value); await new Promise(setImmediate); } };
}
async function assertPublishLoading(source) {
  const h = publishHarness(source), p = h.run('showSlugStep()'); await h.tick();
  assert.equal(h.$('pub-slug-input').disabled, true); assert.equal(h.$('pub-go').disabled, true);
  await h.handlers.get('pub-go:click')(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'GET');
  h.run('closePublish()'); await h.answer({ site: { paid: true, slug: 'stale-address' } }); await p;
  assert.equal(h.$('pub-slug-input').value, ''); assert.equal(h.$('pub').hidden, true);
}
async function assertCommercialCopy(source, currency) {
  const h = publishHarness(source), p = h.run('showSlugStep()'); await h.tick();
  await h.answer({ site: { id: 's1', paid: false, slug: 'draft' } }); await h.answer({ user: { id: 'owner' } });
  assert.equal(h.requests[0].url, '/api/config'); await h.answer({ amount: 99, renewal: 29, currency }); await p;
  const first = { eur: '99€', gbp: '£99', usd: '$99' }[currency], renewal = { eur: '29€', gbp: '£29', usd: '$29' }[currency];
  assert.equal(h.$('pub-trial').textContent, `Adaugi un card obligatoriu și începi perioada de probă de 14 zile. Site-ul devine public imediat. Dacă nu anulezi, plătești ${first} în ziua 14 pentru primul an, apoi ${renewal}/an până anulezi.`);
  assert.equal(h.$('pub-slug-input').disabled, false); assert.equal(h.$('pub-go').disabled, false);
}
module.exports = { assertPublishLoading, assertCommercialCopy };
