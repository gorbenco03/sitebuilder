'use strict';
/**
 * Flow 1 catalog preview completion regression oracle.
 *
 * Simulates Chromium retaining the first document when srcdoc is assigned twice
 * to the same sandboxed iframe. The preview must publish the final document via
 * a fresh iframe, fail with Romanian copy, and keep latest-request isolation.
 *
 * Run: node bot/test/flow1-catalog-preview-completion.test.js
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
const openPreviewSource = extractFunction(app, 'openPreviewModal');
const replaceDocumentSource = extractFunction(app, 'replacePreviewModalDocument');
assert.ok(generationDeclaration, 'Catalog previews need a request generation counter');
assert.ok(openPreviewSource, 'openPreviewModal remains extractable');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function makeHarness(ensureTemplateLoaded, { engineAvailable = true } = {}) {
  let currentIframe;

  function createStickyIframe() {
    let acceptedDocument = '';
    let assignmentCount = 0;
    return {
      get srcdoc() { return acceptedDocument; },
      set srcdoc(value) {
        assignmentCount++;
        if (assignmentCount === 1) acceptedDocument = String(value);
      },
      cloneNode() { return createStickyIframe(); },
      replaceWith(nextIframe) {
        if (currentIframe === this) currentIframe = nextIframe;
      },
    };
  }

  currentIframe = createStickyIframe();
  const elements = {
    'modal-preview-title': { textContent: '' },
    'modal-preview-body': { classList: { remove() {} } },
    'modal-preview-desktop': { classList: { add() {} }, setAttribute() {} },
    'modal-preview-mobile': { classList: { remove() {} }, setAttribute() {} },
  };
  const sandbox = {
    window: {
      HidookEngine: engineAvailable ? {
        renderPreview(_files, config) {
          return `<main data-preview="ready">${config.brand}</main>`;
        },
      } : null,
    },
    getTemplateList() {
      return [
        { id: 'product-menu', name: 'Restaurant' },
        { id: 'professionals', name: 'Servicii profesionale' },
      ];
    },
    $(id) { return id === 'preview-modal-iframe' ? currentIframe : (elements[id] || null); },
    openModal() {},
    ensureTemplateLoaded,
    escHtml(value) { return String(value); },
    console,
  };
  const supportSource = replaceDocumentSource ? `${replaceDocumentSource}\n` : '';
  vm.runInNewContext(
    `${generationDeclaration[0]}\n${supportSource}${openPreviewSource}\nthis.openPreviewModal = openPreviewModal;`,
    sandbox
  );
  return { sandbox, getIframe: () => currentIframe };
}

async function proveRenderedPreviewReplacesStickyLoadingDocument() {
  const harness = makeHarness(async () => ({
    files: { templateHtml: '<main></main>' },
    presets: [{ config: { brand: 'Casa Nord — MENIU' } }],
  }));

  await harness.sandbox.openPreviewModal('product-menu');
  assert.match(harness.getIframe().srcdoc, /data-preview="ready"/i, 'Successful preview publishes rendered HTML');
  assert.match(harness.getIframe().srcdoc, /Casa Nord — MENIU/, 'Successful preview uses the selected template seed');
  assert.doesNotMatch(harness.getIframe().srcdoc, /Se încarcă previzualizarea/, 'Successful preview leaves loading copy');
}

async function proveFailureReplacesStickyLoadingDocument() {
  let attempts = 0;
  const harness = makeHarness(async () => {
    attempts++;
    if (attempts === 1) throw new Error('payload indisponibil');
    return {
      files: { templateHtml: '<main></main>' },
      presets: [{ config: { brand: 'Casa Nord — reîncercare' } }],
    };
  });

  await harness.sandbox.openPreviewModal('product-menu');
  assert.match(
    harness.getIframe().srcdoc,
    /Nu am putut încărca previzualizarea\. Încearcă din nou\./,
    'Failed preview publishes the existing Romanian error copy'
  );
  assert.doesNotMatch(harness.getIframe().srcdoc, /Se încarcă previzualizarea/, 'Failed preview never remains on loading copy');

  await harness.sandbox.openPreviewModal('product-menu');
  assert.match(harness.getIframe().srcdoc, /Casa Nord — reîncercare/, 'Reopening the same template can recover after a failed load');
  assert.doesNotMatch(harness.getIframe().srcdoc, /Se încarcă previzualizarea/, 'Successful retry leaves loading copy');
}

async function proveMissingEngineShowsStandardError() {
  const harness = makeHarness(async () => ({
    files: { templateHtml: '<main></main>' },
    presets: [{ config: { brand: 'Casa Nord' } }],
  }), { engineAvailable: false });

  await harness.sandbox.openPreviewModal('product-menu');
  assert.match(
    harness.getIframe().srcdoc,
    /Nu am putut încărca previzualizarea\. Încearcă din nou\./,
    'Missing engine publishes the standard Romanian error copy'
  );
  assert.doesNotMatch(harness.getIframe().srcdoc, /Cannot read|renderPreview/, 'Missing engine does not expose an internal error');
}

async function proveStaleGenerationCannotReplaceLatestPreview() {
  const pending = { 'product-menu': deferred(), professionals: deferred() };
  const harness = makeHarness((id) => pending[id].promise);

  const staleRestaurant = harness.sandbox.openPreviewModal('product-menu');
  const latestProfessional = harness.sandbox.openPreviewModal('professionals');
  pending.professionals.resolve({
    files: { templateHtml: '<main></main>' },
    presets: [{ config: { brand: 'Cabinet Ionescu — PROGRAMEAZĂ' } }],
  });
  await latestProfessional;
  assert.match(harness.getIframe().srcdoc, /Cabinet Ionescu — PROGRAMEAZĂ/, 'Latest preview renders first');

  pending['product-menu'].resolve({
    files: { templateHtml: '<main></main>' },
    presets: [{ config: { brand: 'Casa Nord — MENIU' } }],
  });
  await staleRestaurant;
  assert.match(harness.getIframe().srcdoc, /Cabinet Ionescu — PROGRAMEAZĂ/, 'Stale response cannot replace latest preview');
  assert.doesNotMatch(harness.getIframe().srcdoc, /Casa Nord — MENIU/, 'No stale Restaurant copy remains');
}

Promise.resolve()
  .then(proveRenderedPreviewReplacesStickyLoadingDocument)
  .then(proveFailureReplacesStickyLoadingDocument)
  .then(proveMissingEngineShowsStandardError)
  .then(proveStaleGenerationCannotReplaceLatestPreview)
  .then(() => console.log('PASS catalog preview always leaves loading copy without losing request isolation'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
