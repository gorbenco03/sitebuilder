'use strict';
/**
 * Regression coverage for the Flow 1 stranger-QA failure packet.
 *
 * Form editor removed 2026-10-28: the image-picker cancel/reopen check
 * (openImagePickerForPath, used for the editor's hero photo) was dropped; the
 * catalog's empty-state retry survives.
 *
 * Run: node bot/test/flow1-qa-fail-remake.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  await check('empty registry offers Romanian retry wired to a registry refetch', () => {
    const renderSrc = extractBetween('function renderTemplatesGrid', 'let activeCatalogFilter');
    assert.ok(renderSrc.includes('Reîncearcă'), 'empty state must show Reîncearcă');
    assert.ok(renderSrc.includes('btn-retry-templates'), 'empty state must expose a retry control');
    // The catalog is the block starter packs (builder/blocks/packs*.js); the
    // retry reloads those scripts and redraws the grid.
    assert.ok(
      renderSrc.includes("addEventListener('click', reloadDesignPacks)"),
      'retry control must call the pack reload hook'
    );

    const reloadSrc = extractBetween('function reloadDesignPacks', 'function startBlocksSite');
    assert.ok(reloadSrc.includes('/app/blocks/packs.js'), 'reload hook must re-load the starter packs');
    assert.ok(reloadSrc.includes('renderTemplatesGrid()'), 'reload must re-render the grid');
  });

  if (process.exitCode) {
    console.error('\nflow1-qa-fail-remake.test.js: FAILED');
    return;
  }
  console.log('\nflow1-qa-fail-remake.test.js: all checks passed');
})();
