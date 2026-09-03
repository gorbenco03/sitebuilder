'use strict';
/**
 * OF-3 regression oracle: Details opens for each newly selected design.
 *
 * Run: node bot/test/of3-details-new-design.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const APP_CSS = path.join(ROOT, 'builder', 'app.css');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const BASE_SHA = '9fab0d0500e6aa20946aa9ab85045b084b86939c';

function blobAt(ref, rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${rel}`], { encoding: 'utf8' });
}

function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  assert.ok(match, `${name} must exist`);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth++;
    } else if (char === '}' && --depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function runDrawerPolicy(source, initialPreference) {
  const state = new Map();
  if (initialPreference !== null) state.set('hb-details-drawer-pref', initialPreference);
  const localStorage = {
    getItem(key) { return state.has(key) ? state.get(key) : null; },
    setItem(key, value) { state.set(key, String(value)); },
  };
  const sandbox = { localStorage, DRAWER_PREF_KEY: 'hb-details-drawer-pref' };
  vm.createContext(sandbox);
  const functions = ['getDrawerPref', 'setDrawerPref', 'shouldAutoOpenDrawer'];
  if (/function\s+prepareDrawerForNewDesign\s*\(/.test(source)) functions.push('prepareDrawerForNewDesign');
  vm.runInContext(functions.map((name) => extractFunction(source, name)).join('\n'), sandbox);
  return { sandbox, state };
}

function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    console.error('FAIL', name, '-', error.message);
    process.exitCode = 1;
  }
}

const baseApp = blobAt(BASE_SHA, 'builder/app.js');
const app = fs.readFileSync(APP_JS, 'utf8');
const css = fs.readFileSync(APP_CSS, 'utf8');
const html = fs.readFileSync(INDEX_HTML, 'utf8');

check('causal RED: dismissed drawer stays closed on the accepted base', () => {
  const { sandbox, state } = runDrawerPolicy(baseApp, 'closed');
  assert.strictEqual(sandbox.shouldAutoOpenDrawer(), false);
  assert.strictEqual(state.get('hb-details-drawer-pref'), 'closed');
  assert.doesNotMatch(extractFunction(baseApp, 'startWithTemplate'), /prepareDrawerForNewDesign\s*\(/);
});

check('new design selection resets a prior dismissal to open', () => {
  const { sandbox, state } = runDrawerPolicy(app, 'closed');
  assert.strictEqual(typeof sandbox.prepareDrawerForNewDesign, 'function');
  sandbox.prepareDrawerForNewDesign();
  assert.strictEqual(state.get('hb-details-drawer-pref'), 'open');
  assert.strictEqual(sandbox.shouldAutoOpenDrawer(), true);
});

check('the reset happens only after a design loaded and before editor navigation', () => {
  const start = extractFunction(app, 'startWithTemplate');
  const loaded = start.indexOf('currentTemplate = { meta, data: tplData };');
  const reset = start.indexOf('prepareDrawerForNewDesign();');
  const navigate = start.indexOf("window.location.hash = '#edit';");
  assert.ok(loaded >= 0 && reset > loaded && navigate > reset, 'new-design drawer reset must be scoped to successful template selection');
  assert.doesNotMatch(extractFunction(app, 'fullRerender'), /prepareDrawerForNewDesign\s*\(/);
});

check('manual close remains available for the current design', () => {
  assert.match(extractFunction(app, 'closeDrawer'), /setDrawerPref\('closed'\)/);
});

check('Details chrome has a product-grade heading bar', () => {
  assert.match(html, /class="drawer-heading"/);
  assert.match(html, /class="drawer-kicker">Design activ</);
  assert.match(html, /class="drawer-subtitle">Conținut, contact și setări/);
  assert.match(css, /\.drawer-heading-icon\s*\{/);
  assert.match(css, /\.drawer-close\s*\{/);
});

if (!process.exitCode) console.log('PASS OF-3 Details new-design oracle');
