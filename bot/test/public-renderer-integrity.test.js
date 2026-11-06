'use strict';
// F01/F19/F20: shared renderer contracts. Browser matrix lives in scripts/oracles/.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const SB = require('../../builder/blocks/blocks.js');

function submit(contact, api = 'http://local.invalid') {
  const site = SB.defaultSite('gol');
  const block = SB.makeBlock('form', 'simple', 'gol');
  block.data.email = 'owner@customer.example';
  site.pages[0].blocks = [block];
  const html = SB.renderPage(site, site.current, { published: true });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const state = { requests: [], status: '', focused: false, invalid: false, href: '' };
  const input = { value: contact, focus() { state.focused = true; }, setAttribute(k, v) { if (k === 'aria-invalid') state.invalid = v === 'true'; }, removeAttribute() { state.invalid = false; } };
  const status = { set textContent(v) { state.status = v; }, hidden: true };
  const button = { disabled: false };
  const form = {
    matches: () => true,
    elements: { name: { value: 'Vizitator' }, contact: input, message: { value: 'O întrebare' } },
    querySelector: (s) => s === '[data-cf-status]' ? status : button,
    getAttribute: (k) => ({ 'data-site-messages-api': api, 'data-site-slug': 'integrity', 'data-mail-to': 'owner@customer.example' })[k],
    reset() {},
  };
  const listeners = {};
  const ctx = {
    document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    fetch: (url, opts) => { state.requests.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); },
    location: { set href(v) { state.href = v; } },
    encodeURIComponent,
  };
  scripts.forEach((src) => vm.runInNewContext(src, ctx));
  listeners.submit({ target: form, preventDefault() {} });
  return state;
}

test('F01 every pack/page retains native page links, current-page semantics and responsive wrapping', () => {
  assert.equal(Object.keys(SB.packs()).length, 13);
  for (const pack of Object.keys(SB.packs())) {
    const site = SB.defaultSite(pack);
    for (const variant of ['bar', 'centered']) {
      site.header.variant = variant;
      for (const page of site.pages) {
        const html = SB.renderPage(site, page.id, { published: true });
        const nav = html.match(/<nav class="b-nav[\s\S]*?<\/nav>/)[0];
        assert.match(nav, /aria-label="Navigare principală"/);
        assert.match(nav, /aria-current="page"/);
        for (const target of site.pages) assert.ok(nav.includes('href="' + SB.pageFile(site, target) + '"'), pack + '/' + page.slug + ' -> ' + target.slug);
        assert.doesNotMatch(SB.themeCss(site.theme), /\.b-nav__links\{display:none/);
      }
    }
  }
});

test('F19 unusable phone never reaches API or static mail fallback; feedback focuses invalid field', () => {
  for (const api of ['http://local.invalid', '']) {
    for (const phone of ['abc', '123', '+40 abc 71234567', '1234567890123456', '07<script>12345678', '++40712345678']) {
      const state = submit(phone, api);
      assert.equal(state.requests.length, 0, phone);
      assert.equal(state.href, '', phone);
      assert.match(state.status, /telefon valid/i, phone);
      assert.ok(state.focused && state.invalid, phone);
    }
  }
});

test('F19 local and international phone formats retain exact contact and email fallback', () => {
  for (const phone of ['0712 345 678', '+40 (712) 345-678', '0044 20 7946 0958', '(021) 123.45.67', '+1 (202) 555-0123']) {
    const state = submit(phone);
    assert.equal(state.requests.length, 1, phone);
    assert.equal(state.requests[0].body.contact, phone);
    const offline = submit(phone, '');
    assert.match(offline.href, /^mailto:owner@customer.example\?/);
    assert.ok(decodeURIComponent(offline.href).includes(phone));
  }
});

test('F20 empty gallery items have replaceable intentional placeholders, never empty img sources', () => {
  const site = SB.defaultSite('gol');
  const gallery = SB.makeBlock('gallery', 'grid', 'gol');
  gallery.data.items = [{ image: '' }, { image: null }];
  site.pages[0].blocks = [gallery];
  for (const published of [false, true]) {
    const html = SB.renderPage(site, site.current, { published });
    assert.doesNotMatch(html, /<img[^>]*src=""/);
    assert.match(html, /data-img="items\.0\.image"/);
    assert.match(html, /Imagine neadăugată/);
  }
  assert.ok(SB.demoLeftovers(site).some((x) => x.key === 'photo' && /galerie/i.test(x.label)));
});

test('F20 valid customer relative assets and uploads are retained; unavailable relative gallery has a non-silent fallback', () => {
  const site = SB.defaultSite('gol');
  const gallery = SB.makeBlock('gallery', 'grid', 'gol');
  gallery.data.items = [{ image: 'images/gallery.jpg' }, { image: 'images/customer-photo.webp' }, { image: 'data:image/png;base64,aGVsbG8=' }];
  site.pages[0].blocks = [gallery];
  const html = SB.renderPage(site, site.current, { published: true });
  assert.match(html, /src="images\/gallery\.jpg"/);
  assert.match(html, /src="images\/customer-photo\.webp"/);
  assert.match(html, /src="data:image\/png;base64,aGVsbG8="/);
  assert.match(html, /Imagine indisponibilă/);
  assert.doesNotMatch(html, /onerror\s*=/i);
  assert.ok(SB.demoLeftovers(site).some((x) => x.key === 'photo' && /Verifică/.test(x.label)));
});

test('F20 gallery guidance is not swallowed by a generic hero-photo warning on the same page', () => {
  const site = SB.defaultSite('gol');
  site.pages[0].blocks.push(SB.makeBlock('hero', 'centered', 'gol'));
  site.pages[0].blocks.push(SB.makeBlock('gallery', 'grid', 'gol'));
  const photos = SB.demoLeftovers(site).filter((x) => x.key === 'photo');
  assert.ok(photos.some((x) => /Galerie: adaugă/.test(x.label)));
  assert.ok(photos.some((x) => /Schimbă poza/.test(x.label)));
});

test('renderer preserves escaping for customer page names, brands and hostile image URLs', () => {
  const site = SB.defaultSite('gol');
  site.header.data.brand = '<script>alert(1)</script>';
  site.pages[0].name = '\"><img src=x>';
  const gallery = SB.makeBlock('gallery', 'grid', 'gol');
  gallery.data.items = [{ image: 'images/photo.jpg\" onload=alert(1)' }];
  site.pages[0].blocks.push(gallery);
  const html = SB.renderPage(site, site.current, { published: true });
  assert.doesNotMatch(html, /<script>alert|<img src=x>|onload=alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x&gt;/);
});
