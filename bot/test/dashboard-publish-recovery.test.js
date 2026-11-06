'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.DASHBOARD_RECOVERY_SOURCE || path.join(__dirname, '../../builder/app.js'), 'utf8');
const SB = require('../../builder/blocks/blocks.js');
class Element {
  constructor() { this.children = []; this.attributes = {}; this.className = ''; this.classList = { add() {} }; }
  appendChild(child) { this.children.push(child); }
  addEventListener() {}
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.className.split(' ').includes(selector.slice(1))) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}
for (const scenario of [
  { name: 'personalized business', config: { v: 2, header: { data: { brand: 'Salon Ștefania' } } }, expected: 'Salon Ștefania' },
  { name: 'HTML treated as text, never markup', config: { v: 2, header: { data: { brand: '<b>Ștefania</b>' } } }, expected: 'Ștefania' },
  { name: 'unchanged Blank', config: { v: 2, header: { data: { brand: 'Numele afacerii' } } }, expected: 'adresa‑mea' },
  { name: 'missing business name', config: { v: 2 }, expected: 'adresa‑mea' },
  { name: 'unavailable config', config: null, expected: 'adresa‑mea' },
  { name: 'failed config request', reject: true, expected: 'adresa‑mea' },
  { name: 'legacy project', templateId: 'portfolio', expected: 'adresa‑mea' },
]) {
  test('Dashboard name: ' + scenario.name, async () => {
    const context = {
      document: { createElement: () => new Element() },
      window: { SB: { siteBrand: SB.siteBrand, setAssetBase() {}, withThumbs: () => '' } },
      apiGet: async () => { if (scenario.reject) throw new Error('offline'); return { config: scenario.config }; },
      location: { origin: 'http://localhost' }, freePublish: true,
      isHostingExpired: () => false,
    };
    vm.createContext(context);
    // Load the real resolver and its per-site cache, not a name-returning stub.
    const resolverStart = source.indexOf('const siteDisplayNames = new WeakMap();');
    const resolverEnd = source.indexOf('function buildSiteCard(', resolverStart);
    assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
    vm.runInContext(source.slice(resolverStart, resolverEnd) + extract('buildSiteCard'), context);
    const card = context.buildSiteCard({ id: 'local-id', templateId: scenario.templateId || 'blocks', projectName: 'adresa-mea', slug: 'adresa-mea', status: 'draft', paid: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(card.querySelector('.site-card-name').textContent, scenario.expected);
    if (scenario.expected === 'Salon Ștefania') assert.equal(card.querySelector('.site-card-edit').attributes['aria-label'], 'Editează site-ul Salon Ștefania');
  });
}
function extract(name) {
  const match = new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{').exec(source);
  assert.ok(match, name);
  let end = match.index + match[0].length, depth = 1;
  while (depth && end < source.length) {
    const char = source[end++];
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  return source.slice(match.index, end);
}
for (const code of ['BOOKING_SYNC', 'MODERATION', 'PUBLISH_FAILED']) {
  test('Publication recovery explains retry without another payment: ' + code, async () => {
    const toasts = [];
    const message = 'Nu am putut publica site-ul. Revino în editor și apasă Publică, fără o plată nouă.';
    const context = {
      RO: { PAYMENT_CONFIRM_FAILED: 'Nu am putut confirma plata. Încearcă din nou.' },
      apiPost: async () => { throw Object.assign(new Error(message), { status: 503, fromServer: true, code }); },
      setLoading() {}, showToast: (...args) => toasts.push(args),
    };
    vm.createContext(context);
    vm.runInContext(extract('safeServerMessage') + '\n' + extract('completeTestCheckout'), context);
    await context.completeTestCheckout('cs_test_123');
    assert.match(toasts[0][0], /Publicarea nu a reușit/);
    assert.ok(toasts[0][0].includes(message));
    assert.equal(toasts[0][1], 'error');
    assert.doesNotMatch(toasts[0][0], /confirma plata/);
  });
}
test('Unknown server and network failures never expose technical details', async () => {
  for (const failure of [Object.assign(new Error('provider SQL secret'), { status: 503, fromServer: true, code: 'UNKNOWN' }), new TypeError('Failed to fetch')]) {
    const toasts = [];
    const context = { RO: { PAYMENT_CONFIRM_FAILED: 'Nu am putut confirma plata. Încearcă din nou.' }, apiPost: async () => { throw failure; }, setLoading() {}, showToast: (...args) => toasts.push(args) };
    vm.createContext(context);
    vm.runInContext(extract('safeServerMessage') + '\n' + extract('completeTestCheckout'), context);
    await context.completeTestCheckout('cs_test_123');
    assert.equal(toasts[0][0], context.RO.PAYMENT_CONFIRM_FAILED);
    assert.equal(toasts[0][1], 'error');
  }
});
