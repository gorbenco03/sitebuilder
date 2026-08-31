'use strict';
/**
 * Keeps customer-visible template aria-labels in Romanian.
 *
 * Authority: VISION.md §3 + Flow 2 (all customer/site surfaces in Romanian).
 * Run: node bot/test/flow2-ro-aria-labels.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates');
const englishAriaLabels = [
  'aria-label="Navigation"',
  'aria-label="Credibility"',
  'aria-label="Close"',
  'aria-label="Previous"',
  'aria-label="Next"',
];

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

const leaks = [];
for (const file of filesUnder(TEMPLATES_DIR)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const label of englishAriaLabels) {
    if (source.includes(label)) {
      leaks.push(`${path.relative(TEMPLATES_DIR, file)}: ${label}`);
    }
  }
}

assert.deepStrictEqual(
  leaks,
  [],
  `templates must not expose guarded English aria-labels:\n${leaks.join('\n')}`
);

console.log('PASS templates contain none of the guarded English aria-labels');
