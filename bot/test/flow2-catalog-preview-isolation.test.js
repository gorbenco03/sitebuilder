'use strict';
/**
 * Flow 2 catalog preview request-isolation regression oracle.
 *
 * STALE ORACLE RECONCILE (S-legacy G1, 2026-09-05):
 * openPreviewModal gained preview-cookie isolation (document.body class), nested
 * replacePreviewDocument (clone/replace iframe + readiness tokens), and RO loading
 * via that helper — not a direct iframe.srcdoc assignment. The prior harness lacked
 * document / cloneNode stubs and crashed before proving generation isolation.
 * Product still stamps previewModalGeneration and aborts stale post-await writes.
 * Harness aligned with flow1-catalog-preview-completion contract. Not a stranger defect.
 *
 * Run: node bot/test/flow2-catalog-preview-isolation.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(ROOT, 'builder/app.js'), 'utf8');

function extractFunction(source, name) {
  const start = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(source);
  if (!start) return '';
  let index = start.index + start[0].length;
  let depth = 1;
  while (index < source.length && depth > 0) {
    const char = source[index++];
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return source.slice(start.index, index);
}

const generationDeclaration = app.match(/let previewModalGeneration\s*=\s*0\s*;/);
assert.ok(generationDeclaration, 'Catalog previews need a request generation counter');

const openPreviewSource = extractFunction(app, 'openPreviewModal');
const prepareInteractivePreviewSource = extractFunction(app, 'prepareInteractivePreviewDocument');
const waitForInteractivePreviewSource = extractFunction(app, 'waitForInteractivePreview');
assert.ok(openPreviewSource, 'openPreviewModal remains extractable');
assert.ok(prepareInteractivePreviewSource, 'prepareInteractivePreviewDocument remains extractable');
assert.ok(waitForInteractivePreviewSource, 'waitForInteractivePreview remains extractable');
assert.match(
  openPreviewSource,
  /const previewGeneration\s*=\s*\+\+previewModalGeneration\s*;/,
  'Each preview request must stamp a new generation'
);
assert.match(
  openPreviewSource,
  /Se încarcă previzualizarea/,
  'Preview uses the Romanian loading copy'
);
assert.match(
  openPreviewSource,
  /if \(previewGeneration !== previewModalGeneration\) return;/,
  'A stale preview request must stop before writing post-await srcdoc'
);
assert.match(
  openPreviewSource,
  /document\.body\.classList\.add\(['"]preview-cookie-isolated['"]\)/,
  'Catalog preview isolates builder-origin cookie chrome from the modal'
);
const loadingWrite = openPreviewSource.indexOf('Se încarcă previzualizarea');
const loadAwait = openPreviewSource.indexOf('await ensureTemplateLoaded(templateId)');
assert.ok(loadingWrite !== -1 && loadAwait !== -1, 'loading copy and template await remain in openPreviewModal');
assert.ok(loadingWrite < loadAwait, 'Loading document is assigned before the heavy template await');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createIframe() {
  return {
    srcdoc: '',
    dataset: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    getAttribute() { return null; },
    // Prefer simple srcdoc path (no clone) so isolation is observable on one object.
  };
}

async function proveLatestRequestWins() {
  const iframe = createIframe();
  const elements = {
    'modal-preview-title': { textContent: '' },
    'preview-modal-iframe': iframe,
    'modal-preview-body': { classList: { remove() {} } },
    'modal-preview-desktop': { classList: { add() {}, setAttribute() {} }, setAttribute() {} },
    'modal-preview-mobile': { classList: { remove() {}, setAttribute() {} }, setAttribute() {} },
  };
  const pending = { professionals: deferred(), desserdirina: deferred() };
  const sandbox = {
    window: {
      HidookEngine: {
        renderPreview(_files, config) {
          return `<main>${config.brand}</main>`;
        },
      },
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
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

  const supportSource = [
    prepareInteractivePreviewSource,
    waitForInteractivePreviewSource,
  ].filter(Boolean).join('\n');
  vm.runInNewContext(
    `${generationDeclaration[0]}\n${supportSource}\n${openPreviewSource}\nthis.openPreviewModal = openPreviewModal;`,
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
