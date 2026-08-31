'use strict';
/**
 * Keeps customer-visible builder error toasts in Romanian.
 *
 * Run: node bot/test/ro-chrome-toasts.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP_JS = path.resolve(__dirname, '../../builder/app.js');
const app = fs.readFileSync(APP_JS, 'utf8');

const englishToastFragments = [
  'Could not download HTML',
  'This project has large images',
  'Error confirming payment',
  'Error loading the site',
  'Publish failed. Try again',
  'Unexpected response from the server',
  'Initialization failed. Reload the page',
];

for (const fragment of englishToastFragments) {
  assert.ok(
    !app.includes(fragment),
    `builder/app.js must not expose the English toast fragment: ${fragment}`
  );
}

console.log('PASS builder error toasts contain none of the guarded English fragments');
