'use strict';
/**
 * Regression coverage for the Flow 1 stranger-QA failure packet.
 *
 * Run: node bot/test/flow1-qa-fail-remake.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const appSrc = fs.readFileSync(path.join(ROOT, 'builder', 'app.js'), 'utf8');

function extractBetween(start, end) {
  const startAt = appSrc.indexOf(start);
  assert.notStrictEqual(startAt, -1, `missing ${start}`);
  const endAt = appSrc.indexOf(end, startAt);
  assert.notStrictEqual(endAt, -1, `missing marker after ${start}`);
  return appSrc.slice(startAt, endAt).trim();
}

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log('PASS', name),
        (error) => {
          console.error('FAIL', name, '-', error.message);
          process.exitCode = 1;
        }
      );
    }
    console.log('PASS', name);
    return Promise.resolve();
  } catch (error) {
    console.error('FAIL', name, '-', error.message);
    process.exitCode = 1;
    return Promise.resolve();
  }
}

(async () => {
  await check('empty image selection keeps the existing hero photo', () => {
    const pickerSrc = extractBetween(
      'function openImagePickerForPath',
      '// Sync a drawer field value when it changes via inline editing'
    );
    let changeHandler = null;
    const input = {
      files: [],
      value: '',
      addEventListener(type, handler) {
        if (type === 'change') changeHandler = handler;
      },
      removeEventListener() {},
      click() {
        assert.ok(changeHandler, 'picker must listen for a file selection');
        changeHandler();
      },
    };
    let heroImage = 'images/hero.jpg';
    let callbackCalls = 0;
    const sandbox = {
      $: (id) => {
        assert.strictEqual(id, 'img-file-input');
        return input;
      },
      keepHeroImage(value) {
        callbackCalls += 1;
        heroImage = value;
      },
    };

    vm.runInNewContext(
      `${pickerSrc}\nopenImagePickerForPath('hero.background', keepHeroImage);`,
      sandbox
    );

    assert.strictEqual(callbackCalls, 0, 'cancel/empty selection must not invoke replacement callback');
    assert.strictEqual(heroImage, 'images/hero.jpg');
  });

  await check('empty registry offers Romanian retry wired to a registry refetch', () => {
    const renderSrc = extractBetween('function renderTemplatesGrid', 'let activeCatalogFilter');
    assert.ok(renderSrc.includes('Reîncearcă'), 'empty state must show Reîncearcă');
    assert.ok(renderSrc.includes('btn-retry-templates'), 'empty state must expose a retry control');
    assert.ok(
      renderSrc.includes("addEventListener('click', reloadTemplateRegistry)"),
      'retry control must call the registry reload hook'
    );

    const reloadSrc = extractBetween('async function reloadTemplateRegistry', 'function renderTemplatesGrid');
    assert.ok(
      /fetch\(['"]\/app\/generated\/templates-data\.js['"]/.test(reloadSrc),
      'reload hook must re-fetch the light registry'
    );
    assert.ok(reloadSrc.includes('renderTemplatesGrid()'), 'successful reload must re-render the grid');
  });

  if (process.exitCode) {
    console.error('\nflow1-qa-fail-remake.test.js: FAILED');
    return;
  }
  console.log('\nflow1-qa-fail-remake.test.js: all checks passed');
})();
