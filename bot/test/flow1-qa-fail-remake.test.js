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
  await check('real cancel then reopen selects only for the current hero', async () => {
    const pickerSrc = extractBetween(
      'function openImagePickerForPath',
      '// Sync a drawer field value when it changes via inline editing'
    );
    const inputListeners = new Map();
    const windowListeners = new Map();
    const addListener = (listeners, type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    };
    const removeListener = (listeners, type, handler) => {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    };
    const dispatch = async (listeners, type) => {
      for (const handler of Array.from(listeners.get(type) || [])) await handler();
    };
    const input = {
      files: [],
      value: '',
      addEventListener(type, handler) { addListener(inputListeners, type, handler); },
      removeEventListener(type, handler) { removeListener(inputListeners, type, handler); },
      click() {},
    };
    const hero = { color: '#5b2134', image: 'images/hero-current.jpg' };
    let previousCalls = 0;
    let currentCalls = 0;
    const sandbox = {
      $: (id) => {
        assert.strictEqual(id, 'img-file-input');
        return input;
      },
      window: {
        addEventListener(type, handler) { addListener(windowListeners, type, handler); },
        removeEventListener(type, handler) { removeListener(windowListeners, type, handler); },
      },
      setTimeout,
      FileReader: class {
        readAsDataURL() {
          this.result = 'data:image/jpeg;base64,Q1VSUkVOVA==';
          this.onload();
        }
      },
    };

    vm.runInNewContext(
      `${pickerSrc}\nthis.openImagePickerForPath = openImagePickerForPath;`,
      sandbox
    );

    sandbox.openImagePickerForPath('hero.previous', () => { previousCalls += 1; });
    assert.strictEqual((inputListeners.get('change') || new Set()).size, 1);

    // A real operating-system cancel returns focus without dispatching `change`.
    await dispatch(windowListeners, 'focus');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(previousCalls, 0, 'cancel must not invoke the previous callback');
    assert.deepStrictEqual(hero, { color: '#5b2134', image: 'images/hero-current.jpg' });
    assert.strictEqual(
      (inputListeners.get('change') || new Set()).size,
      0,
      'cancel must remove the pending selection listener'
    );

    sandbox.openImagePickerForPath('hero.current', (image) => {
      currentCalls += 1;
      hero.image = image;
    });
    assert.strictEqual((inputListeners.get('change') || new Set()).size, 1);
    input.files = [{ name: 'current.jpg', type: 'image/jpeg' }];
    await dispatch(inputListeners, 'change');

    assert.strictEqual(previousCalls, 0, 'reopen must not revive a cancelled callback');
    assert.strictEqual(currentCalls, 1, 'the current selection callback must run exactly once');
    assert.strictEqual(hero.color, '#5b2134', 'selecting a photo must preserve the hero color');
    assert.strictEqual(hero.image, 'data:image/jpeg;base64,Q1VSUkVOVA==');
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
