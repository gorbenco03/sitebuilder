'use strict';
/**
 * bot/test/suite10-instagram-teaser-editmode.test.js
 *
 * Today, when a customer has not connected Instagram,
 * normalizeInstagramForPublic() in build.js blanks instagram.embedUrl/handle
 * so the whole Instagram section disappears. Because it runs BEFORE the
 * editMode branch in renderHtml(), it disappeared from the BUILDER PREVIEW
 * too — the owner never sees where Instagram would go, so they never
 * discover the feature exists.
 *
 * Fix: in EDIT MODE ONLY, when Instagram is not connected, renderHtml() sets
 * a render-only cfg.instagram.showTeaser flag (see its build.js comment),
 * which each templates/*\/template.html reads via
 * `<!-- @if instagram.showTeaser -->` to render a fixed-contract "example"
 * section (`<section class="hb-ig-teaser" data-hb-ig-teaser>`) instead of
 * nothing. A real connected embed still renders exactly as before, in both
 * modes, and the teaser must never reach a published site.
 *
 * This suite asserts, for all five templates:
 *   1. editMode + NOT connected  -> teaser renders (and the real section doesn't).
 *   2. editMode + connected      -> teaser does NOT render (real embed renders).
 *   3. published (no editMode), connected or not -> teaser NEVER renders.
 *
 * Run: node --test bot/test/suite10-instagram-teaser-editmode.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TEMPLATE_IDS = fs.readdirSync(TEMPLATES_DIR).filter((name) => {
  return fs.existsSync(path.join(TEMPLATES_DIR, name, 'template.html'));
}).sort();

const { renderHtml } = require(path.join(ROOT, 'build.js'));

test('fixture sanity: all 5 commercial templates are present', () => {
  assert.ok(TEMPLATE_IDS.length >= 5, `expected >=5 templates, found: ${TEMPLATE_IDS.join(', ')}`);
});

function baseConfig(instagram) {
  return {
    business: { name: 'Test Business' },
    labels: { instaTitle: 'Instagram', instaFollow: 'Urmărește' },
    footer: { address: 'Str. Exemplu 1', year: '2026', note: 'Toate drepturile rezervate.' },
    contact: {},
    instagram,
  };
}

const NOT_CONNECTED = { handle: '', url: '', embedUrl: '' };
const CONNECTED = {
  handle: 'demo.handle',
  url: 'https://www.instagram.com/demo.handle',
  embedUrl: 'https://partner.example/embed/ig?k=suite10',
};

for (const templateId of TEMPLATE_IDS) {
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, templateId, 'template.html'), 'utf8');

  test(`[${templateId}] editMode + Instagram NOT connected renders the teaser`, () => {
    const html = renderHtml(tpl, baseConfig(NOT_CONNECTED), { editMode: true });
    assert.match(html, /data-hb-ig-teaser/, 'teaser section must render');
    assert.match(html, /class="hb-ig-teaser"/, 'teaser must carry its fixed class');
    assert.match(html, /hb-ig-teaser__badge/, 'teaser badge must render');
    assert.match(html, /Exemplu\s*—\s*așa va arăta pe site/, 'teaser badge copy must render');
    assert.match(html, /hb-ig-teaser__veil/, 'teaser veil must render');
    assert.match(html, /class="hb-ig-teaser__veil"[^>]*\bhidden\b/, 'veil must start hidden');
    assert.match(html, /data-hb-ig-connect/, 'teaser CTA button must render');
    const tiles = html.match(/hb-ig-teaser__grid[\s\S]*?<\/ul>/);
    assert.ok(tiles, 'teaser grid must render');
    // Count tiles, not <img>: professionals ships exactly one photo, so its six
    // tiles are CSS panels rather than six copies of the same picture. What the
    // contract promises is six tiles; how a template fills them is its own call.
    const tileCount = (tiles[0].match(/<li\b/g) || []).length;
    assert.equal(tileCount, 6, `teaser must render exactly 6 tiles, got ${tileCount}`);
    // The real (public) section must still be absent — it is gated on
    // instagram.handle, which stays blank when not connected.
    assert.ok(
      !/<iframe[^>]+instagram/i.test(html) && !/class="instagram-embed-iframe"/.test(html),
      'no real Instagram iframe when not connected'
    );
  });

  test(`[${templateId}] editMode + Instagram connected does NOT render the teaser`, () => {
    const html = renderHtml(tpl, baseConfig(CONNECTED), { editMode: true });
    assert.ok(!/data-hb-ig-teaser/.test(html), 'teaser must not render when connected');
    assert.ok(!/hb-ig-teaser/.test(html), 'no teaser class fragments at all when connected');
    assert.ok(html.includes(CONNECTED.embedUrl), 'real partner embed must render');
    assert.ok(html.includes('instagram-embed-iframe'), 'real iframe class must render');
  });

  test(`[${templateId}] published output NEVER renders the teaser (connected or not)`, () => {
    const htmlNotConnected = renderHtml(tpl, baseConfig(NOT_CONNECTED));
    assert.ok(!/hb-ig-teaser/.test(htmlNotConnected), 'no teaser in published output when not connected');
    assert.ok(!/data-hb-ig-connect/.test(htmlNotConnected), 'no teaser CTA in published output');

    const htmlConnected = renderHtml(tpl, baseConfig(CONNECTED));
    assert.ok(!/hb-ig-teaser/.test(htmlConnected), 'no teaser in published output when connected');
    assert.ok(htmlConnected.includes(CONNECTED.embedUrl), 'real partner embed still renders published');
  });

  test(`[${templateId}] published output is byte-identical whether opts is omitted or {editMode:false}`, () => {
    const a = renderHtml(tpl, baseConfig(NOT_CONNECTED));
    const b = renderHtml(tpl, baseConfig(NOT_CONNECTED), { editMode: false });
    assert.equal(a, b);
  });
}
