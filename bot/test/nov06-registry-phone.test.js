'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const SB = require('../../builder/blocks/blocks.js');
const packs = require('../../builder/blocks/packs.js');
require('../../builder/blocks/packs-more.js')(packs);
const registry = require('../../templates/registry.json').templates;

test('pricing legacy fixture ignores namespace-only directories and directory ordering', () => {
  const file = path.join(__dirname, 'pricing.test.js');
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('    const templatesDir =');
  const end = source.indexOf('    const MINIMAL_CONFIG =', start);
  assert.ok(start >= 0 && end > start, 'exercise the actual pricing fixture selection');
  for (const directories of [
    ['blocks', 'assets-only', ...registry.map(t => t.id)],
    ['assets-only', ...registry.map(t => t.id).reverse(), 'blocks'],
  ]) {
    const context = {
      __dirname, path, assert, require: createRequire(file),
      fs: { ...fs, readdirSync: () => directories, statSync: () => ({ isDirectory: () => true }) },
    };
    const id = vm.runInNewContext(source.slice(start, end) + '\ntplId;', context);
    assert.equal(id, 'product-menu', 'MINIMAL_CONFIG uses a stable supported legacy fixture');
    assert.ok(registry.some(t => t.id === id));
    assert.ok(!['blocks', 'assets-only'].includes(id));
  }
});

test('all 13 starters use phone-only form labels and preserve saved custom labels', () => {
  const ids = Object.keys(packs);
  assert.equal(ids.length, 13);
  for (const id of ids) {
    assert.equal(packs[id].content.form.lPhone, 'Telefon', id);
    const config = SB.defaultSite(id);
    // Blank has no form on its initial page; exercise its starter form data too.
    if (!config.pages.some(p => p.blocks.some(b => b.type === 'form'))) {
      config.pages[0].blocks.push(SB.makeBlock('form', 'split', id));
    }
    const page = config.pages.find(p => p.blocks.some(b => b.type === 'form'));
    const block = page.blocks.find(b => b.type === 'form');
    assert.equal(block.data.lPhone, 'Telefon', id);
    assert.match(SB.renderPage(config, page.id, { published: true }), /name="contact" autocomplete="tel"/);
    block.data.lPhone = 'Numărul meu personalizat';
    const saved = SB.normalizeSite(JSON.parse(JSON.stringify(config)));
    assert.equal(saved.pages.find(p => p.id === page.id).blocks.find(b => b.id === block.id).data.lPhone, 'Numărul meu personalizat', id);
    assert.match(SB.renderPage(saved, page.id, { published: true }), /Numărul meu personalizat/);
  }
});
