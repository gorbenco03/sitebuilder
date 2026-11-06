'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'bot/calendar-native/manage/manage.js'), 'utf8');
const booking = { id: 'local', status: 'confirmed', statusLabelRo: 'confirmată', startUtc: '2030-04-15T08:00:00Z', endUtc: '2030-04-15T09:00:00Z', timezone: 'Europe/Bucharest', serviceName: 'Consultație locală', visitorName: 'Ana locală', minCancelHours: 24 };
class Element {
  constructor() { this.children = []; this.attrs = {}; this.listeners = {}; this._text = ''; }
  set innerHTML(v) { this.children = []; this._text = v; }
  set textContent(v) { this.children = []; this._text = v; }
  get textContent() { return this._text + this.children.filter(n => !n.hidden).map(n => n.textContent).join(' '); }
  appendChild(n) { this.children.push(n); return n; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  focus() { this.focused = true; }
  querySelector(s) { return this.children.flatMap(n => [n, ...walk(n)]).find(n => s[0] === '#' ? n.id === s.slice(1) : s[0] === '.' ? (n.className || '').split(' ').includes(s.slice(1)) : Object.hasOwn(n.attrs, s.slice(1, -1))) || null; }
}
function walk(n) { return n.children.flatMap(c => [c, ...walk(c)]); }
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const loaded = () => ({ status: 200, body: { ok: true, booking: { ...booking } } });
const slots = () => ({ status: 200, body: { ok: true, slots: [{ startUtc: '2030-04-16T08:00:00Z', endUtc: '2030-04-16T09:00:00Z' }] } });
async function page(responses, script = source) {
  const root = new Element(), body = new Element(), sub = new Element(); body.id = 'hm-body'; sub.id = 'hm-sub'; root.appendChild(body); root.appendChild(sub);
  const calls = [];
  vm.runInNewContext(script, { document: { readyState: 'complete', createElement: () => new Element(), querySelector: s => root.querySelector(s) }, location: { href: 'http://local.invalid/?token=local-only-token' }, URL, Intl, Date, window: { confirm: () => true }, fetch: async url => { calls.push(url); const r = responses.shift(); assert.ok(r, 'unexpected fetch ' + url); if (r instanceof Error) throw r; return { status: r.status, json: async () => r.body }; } });
  await settle();
  return { body, calls, click: async s => { const n = body.querySelector(s); assert.ok(n, s); assert.ok(!n.disabled, s + ' enabled'); n.listeners.click(); await settle(); } };
}
const refusal = 'Intervalul minim înainte de programare a trecut — nu mai poți reprograma din link.';
async function policy(script = source) {
  const p = await page([loaded(), slots(), { status: 400, body: { code: 'WINDOW', error: refusal } }, slots()], script);
  await p.click('[data-hm-reschedule]'); await p.click('.hm__slot');
  assert.ok(p.body.textContent.includes(refusal), 'exact refusal survives all asynchronous pane work');
  assert.ok(p.body.textContent.includes('Consultație locală'));
  assert.ok(p.body.textContent.includes('contactează'));
  assert.equal(p.body.querySelector('.hm__slot'), null, 'policy does not offer another slot as bypass');
  assert.ok(p.body.querySelector('[data-hm-reschedule]').disabled);
}
test('P01 settled policy refusal preserves details and contact recovery without policy bypass', () => policy());
test('P01 taken-slot refusal survives asynchronous slot refresh, then a valid move succeeds', async () => {
  const message = 'Acest interval tocmai a fost ocupat.';
  const p = await page([loaded(), slots(), { status: 409, body: { code: 'SLOT_TAKEN', error: message } }, slots(), { status: 200, body: { ok: true, booking: { ...booking, startUtc: '2030-04-16T08:00:00Z', endUtc: '2030-04-16T09:00:00Z' } } }]);
  await p.click('[data-hm-reschedule]'); await p.click('.hm__slot');
  assert.ok(p.body.textContent.includes(message), 'refusal survives rebuilt slots');
  assert.equal(p.calls.filter(u => u.includes('/slots?')).length, 2);
  await p.click('.hm__slot');
  assert.match(p.body.textContent, /Programare mutată/); assert.match(p.body.textContent, /16 aprilie/);
  assert.ok(!p.body.textContent.includes(message));
});
test('P01 network uncertainty leaves a usable retry and slots-load retry does not lose booking', async () => {
  const p = await page([loaded(), new Error('slots offline'), slots(), new Error('response lost'), loaded(), slots()]);
  await p.click('[data-hm-reschedule]'); assert.match(p.body.textContent, /temporar indisponibile/);
  await p.click('[data-hm-reschedule]'); await p.click('.hm__slot');
  assert.match(p.body.textContent, /Nu am putut reprograma/); assert.match(p.body.textContent, /Consultație locală/);
  await p.click('[data-hm-reload]'); await p.click('[data-hm-reschedule]'); assert.ok(p.body.querySelector('.hm__slot'));
});
test('P02 new Blank has exactly one empty Acasă body and retains explicitly insertable neutral seeds', () => {
  const SB = require('../../builder/blocks/blocks');
  const site = SB.defaultSite('gol');
  assert.equal(site.pages.length, 1); assert.equal(site.pages[0].name, 'Acasă'); assert.deepEqual(site.pages[0].blocks, []);
  for (const type of ['text', 'form', 'gallery', 'booking']) { const b = SB.makeBlock(type, undefined, 'gol'); assert.equal(b.type, type); assert.ok(Object.keys(b.data).length); }
  assert.ok(site.header); assert.ok(site.footer);
});
test('P01 negative control: erasing the server refusal is caught after settle', async () => {
  const changed = source.replace("error: (res.body && res.body.error) || 'Reprogramarea a eșuat.',", "error: '',");
  assert.notEqual(changed, source);
  await assert.rejects(policy(changed), /exact refusal survives/);
});
