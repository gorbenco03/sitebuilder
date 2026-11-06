'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SB = require('../../builder/blocks/blocks.js');
const lum = (rgb) => rgb.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const rgb = (hex) => hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16));
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);

test('ordinary attribution and helper copy retain 4.5 contrast with their actual opacity on preset solid surfaces', () => {
  for (const [palette, p] of Object.entries(SB.THEMES.palettes)) {
    const css = SB.themeCss({ palette });
    for (const cls of ['b-attr', 'b-note']) {
      const rule = css.match(new RegExp('\\.' + cls + '\\{([^}]+)\\}'));
      assert.ok(rule, cls);
      const opacity = Number(rule[1].match(/opacity:([.\d]+)/)?.[1] || 1);
      for (const [fg, bg] of [[p.fg, p.bg], [p.ink, p.paper], [p.paper, p.ink]]) {
        const background = rgb(bg); const foreground = rgb(fg).map((v, i) => v * opacity + background[i] * (1 - opacity));
        assert.ok(ratio(foreground, background) >= 4.5, `${palette}/${cls}/${bg}: ${ratio(foreground, background)}`);
      }
    }
    assert.ok(css.includes(`--accent:${p.accent};`), 'selected accent is not rewritten');
    assert.match(css, /\.b-book__days \.is-off\{opacity:\.35;/, 'disabled state remains exempt and unchanged');
  }
});

test('attribution is exact noneditable renderer-owned copy in public and preview variants', () => {
  const footer = SB.makeBlock('footer'); footer.data.note = 'owner cannot replace attribution';
  for (const published of [true, false]) {
    const html = SB.renderBlock(footer, { published });
    const attr = html.match(/<p class="b-attr hb-built-by">(.*?)<\/p>/)[1];
    assert.equal(attr.replace(/<[^>]*>/g, ''), 'Build by hidook.tech powered by hidook.agency');
    assert.doesNotMatch(attr, /data-f|contenteditable|owner cannot/);
    assert.equal((attr.match(/rel="noopener noreferrer"/g) || []).length, 2);
  }
});
