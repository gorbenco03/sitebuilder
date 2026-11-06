'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertRecognitionPreserved } = require('../../scripts/editor-recognition-preservation.cjs');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = read('builder/blocks/editor.js');
const before = read('04-QA-Evidence/Implementation-2026-11-05/editor-recognition/input/builder/blocks/editor.js');
const b01 = read('04-QA-Evidence/Implementation-2026-11-05/painted-layout-recovery/input/builder/blocks/editor.js');
const mutate = (from, to) => {
  assert.equal(source.split(from).length - 1, 1, 'mutation targets one exact fragment');
  return source.replace(from, to);
};
test('approved readable block controls and earlier wrapping both preserve all protected behavior', () => {
  assertRecognitionPreserved(source, before);
  assertRecognitionPreserved(b01, before);
});
for (const [name, from, to] of [
  ['draft storage', "const STORE = 'hb.blocks.draft.v1'", "const STORE = 'hb.blocks.draft.v2'"],
  ['immutable revision', 'let baseVersion;', 'let baseVersion = null;'],
  ['publish step', 'function pubStep(name)', 'function pubStep(other)'],
  ['magic-link return', "resume = 'auth';", "resume = 'checkout';"],
  ['starter identity', 'function identityLeftovers(draft)', 'function identityLeftovers(other)'],
  ['legal checklist', 'Câmpurile PLACEHOLDER rămân de completat.', 'Conformitate garantată.'],
  ['unchanged drag CSS', '.ed-drag{cursor:grab}', '.ed-drag{cursor:auto}'],
  ['unchanged canvas function', 'function renderCanvas()', 'function renderCanvas(other)'],
  ['grid identity layout', 'display:grid;gap:6px', 'display:grid;gap:5px'],
  ['single counter-scaling', '.ed-chrome,.ed-add,.ed-tt{zoom:var(--ed-z,1)}', '.ed-chrome,.ed-add,.ed-tt{zoom:1}'],
  ['identity container', "chrome.className = 'ed-chrome';", "chrome.className = 'ed-label';"],
  ['toolbar parent', 'if (tools.innerHTML) chrome.appendChild(tools);', 'if (tools.innerHTML) el.appendChild(tools);'],
  ['selected Add parent', 'if (b.id === selId) chrome.appendChild(add);', 'if (b.id !== selId) chrome.appendChild(add);'],
  ['selection cleanup', "':scope > .ed-chrome > .ed-tools'", "':scope > .ed-tools'"],
  ['inline action changed', 'data-act="variant" title="Schimbă aspectul"', 'data-act="other" title="Schimbă aspectul"'],
  ['inline action removed', '<button type="button" data-act="up" title="Mută sus">↑</button>', ''],
]) test('rejects unauthorized change to ' + name, () => {
  assert.throws(() => assertRecognitionPreserved(mutate(from, to), before), assert.AssertionError);
});
