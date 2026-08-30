'use strict';
/**
 * Flow 2 catalog preview request-isolation regression oracle.
 *
 * Run: node bot/test/flow2-catalog-preview-isolation.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(ROOT, 'builder/app.js'), 'utf8');

const generationDeclaration = app.match(/let previewModalGeneration\s*=\s*0\s*;/);
assert.ok(generationDeclaration, 'Catalog previews need a request generation counter');

const functionMatch = app.match(/async function openPreviewModal\(templateId\) \{[\s\S]*?\n\}\n\n\/\/ -{20,}/);
assert.ok(functionMatch, 'openPreviewModal remains extractable');
const functionSource = functionMatch[0].replace(/\n\n\/\/ -{20,}[\s\S]*$/, '');

assert.match(
  functionSource,
  /const previewGeneration\s*=\s*\+\+previewModalGeneration\s*;/,
  'Each preview request must stamp a new generation'
);
const loadingWrite = functionSource.indexOf('Se încarcă previzualizarea');
const loadAwait = functionSource.indexOf('await ensureTemplateLoaded(templateId)');
assert.ok(loadingWrite !== -1, 'Preview uses the Romanian loading copy');
assert.ok(loadingWrite < loadAwait, 'Loading srcdoc is assigned before the heavy template await');
assert.match(
  functionSource.slice(loadAwait),
  /if \(previewGeneration !== previewModalGeneration\) return;/,
  'A stale preview request must stop before writing post-await srcdoc'
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function proveLatestRequestWins() {
  const iframe = { srcdoc: '' };
  const elements = {
    'modal-preview-title': { textContent: '' },
    'preview-modal-iframe': iframe,
    'modal-preview-body': { classList: { remove() {} } },
    'modal-preview-desktop': { classList: { add() {} }, setAttribute() {} },
    'modal-preview-mobile': { classList: { remove() {} }, setAttribute() {} },
  };
  const pending = { professionals: deferred(), desserdirina: deferred() };
  const sandbox = {
    window: {
      HidookEngine: {
        renderPreview(_files, config) {
          return `<main>${config.brand}</main>`;
        },
      },
    },
    getTemplateList() {
      return [
        { id: 'professionals', name: 'Profesional' },
        { id: 'desserdirina', name: 'Desserdirina' },
      ];
    },
    $(id) { return elements[id] || null; },
    openModal() {},
    ensureTemplateLoaded(id) { return pending[id].promise; },
    escHtml(value) { return String(value); },
    console,
  };

  vm.runInNewContext(
    `${generationDeclaration[0]}\n${functionSource}\nthis.openPreviewModal = openPreviewModal;`,
    sandbox
  );

  const staleProfessional = sandbox.openPreviewModal('professionals');
  const latestDesserdirina = sandbox.openPreviewModal('desserdirina');
  assert.match(iframe.srcdoc, /Se încarcă previzualizarea/, 'New request clears previous preview with loading copy');

  pending.desserdirina.resolve({
    files: { html: 'desserdirina' },
    presets: [{ config: { brand: 'Desserdirina — prăjituri artizanale' } }],
  });
  await latestDesserdirina;
  assert.match(iframe.srcdoc, /Desserdirina — prăjituri artizanale/, 'Latest Desserdirina request renders its own seed');

  pending.professionals.resolve({
    files: { html: 'professionals' },
    presets: [{ config: { brand: 'Cabinet Juridic Ionescu — PROGRAMEAZĂ' } }],
  });
  await staleProfessional;
  assert.match(iframe.srcdoc, /Desserdirina — prăjituri artizanale/, 'Stale Professional response cannot replace Desserdirina');
  assert.doesNotMatch(iframe.srcdoc, /Cabinet Juridic|Ionescu|PROGRAMEAZĂ/, 'No stale Professional copy remains');
}

proveLatestRequestWins()
  .then(() => console.log('PASS catalog preview keeps only the latest requested template'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
